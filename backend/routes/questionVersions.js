const { Router } = require('express');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = Router();

// List version history for a question
router.get('/:questionId/versions', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT qv.*, u.name AS edited_by_user
       FROM question_versions qv
       LEFT JOIN users u ON qv.edited_by = u.id
       WHERE qv.question_id = $1
       ORDER BY qv.version DESC`,
      [req.params.questionId]
    );
    res.json(rows);
  } catch (err) {
    console.error('versions list error:', err);
    res.status(500).json({ error: 'Failed to fetch versions' });
  }
});

// Restore a previous version
router.post('/:questionId/versions/:versionId/restore',
  authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: vrows } = await client.query(
        `SELECT * FROM question_versions WHERE id = $1 AND question_id = $2`,
        [req.params.versionId, req.params.questionId]
      );
      if (vrows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Version not found' }); }
      const v = vrows[0];

      // Snapshot current question first (so restore is reversible)
      await snapshotQuestion(client, req.params.questionId, req.user);

      await client.query(
        `UPDATE questions
         SET text = $1, options = $2, correct_answer = $3, difficulty = $4,
             marks = COALESCE($5, marks), image_url = $6, type = $7, synced = FALSE
         WHERE id = $8`,
        [v.text, v.options, v.correct_answer, v.difficulty, v.marks, v.image_url, v.type, req.params.questionId]
      );

      await client.query('COMMIT');
      await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role,
        action: 'Question Restored', category: 'question',
        details: `Restored question ${req.params.questionId} to version ${v.version}`, ip: req.ip });
      res.json({ success: true });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      res.status(500).json({ error: 'Restore failed', message: err.message });
    } finally {
      client.release();
    }
  }
);

// Helper used by questions.js when editing
async function snapshotQuestion(client, questionId, user) {
  const { rows } = await client.query(`SELECT * FROM questions WHERE id = $1`, [questionId]);
  if (rows.length === 0) return null;
  const q = rows[0];
  const { rows: vRows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM question_versions WHERE question_id = $1`,
    [questionId]
  );
  const next = vRows[0].next_version;
  await client.query(
    `INSERT INTO question_versions
       (question_id, version, type, text, options, correct_answer, difficulty,
        marks, image_url, edited_by, edited_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      questionId, next, q.type, q.text,
      q.options ? JSON.stringify(q.options) : null,
      q.correct_answer ? JSON.stringify(q.correct_answer) : null,
      q.difficulty, q.marks, q.image_url,
      user?.id || null, user?.name || null,
    ]
  );
  return next;
}

module.exports = router;
module.exports.snapshotQuestion = snapshotQuestion;
