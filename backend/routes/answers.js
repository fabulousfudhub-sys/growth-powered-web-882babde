const { Router } = require('express');
const { pool } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = Router();

// Auto-save a single answer
router.post('/save', authenticate, async (req, res) => {
  const { attemptId, questionId, answer } = req.body;
  if (!attemptId || !questionId) return res.status(400).json({ error: 'Missing attemptId or questionId' });

  try {
    await pool.query(
      `INSERT INTO answers (attempt_id, question_id, answer, saved_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (attempt_id, question_id)
       DO UPDATE SET answer = $3, saved_at = NOW(), synced = FALSE`,
      [attemptId, questionId, answer || '']
    );
    res.json({ saved: true });
  } catch (err) {
    console.error('Save answer error:', err);
    res.status(500).json({ error: 'Failed to save answer' });
  }
});

// Batch auto-save
router.post('/save-batch', authenticate, async (req, res) => {
  const { attemptId, answers } = req.body;
  if (!attemptId || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'Missing attemptId or answers array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { questionId, answer } of answers) {
      await client.query(
        `INSERT INTO answers (attempt_id, question_id, answer, saved_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (attempt_id, question_id)
         DO UPDATE SET answer = $3, saved_at = NOW(), synced = FALSE`,
        [attemptId, questionId, answer || '']
      );
    }
    await client.query('COMMIT');
    res.json({ saved: true, count: answers.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Batch save error:', err);
    res.status(500).json({ error: 'Failed to save answers' });
  } finally {
    client.release();
  }
});

// Begin exam — sets started_at to NOW() (timer starts here)
router.post('/attempt/:attemptId/begin', authenticate, async (req, res) => {
  try {
    // Only set started_at if it's NULL (first begin) — for resume, don't reset
    const { rows } = await pool.query(
      `UPDATE exam_attempts
       SET started_at = CASE WHEN started_at IS NULL THEN NOW() ELSE started_at END
       WHERE id = $1 AND student_id = $2 AND status = 'in_progress'
       RETURNING started_at, exam_id`,
      [req.params.attemptId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Attempt not found' });

    await logAudit({
      userId: req.user.id, userName: req.user.name, role: 'student',
      action: 'Exam Started', category: 'exam',
      details: `Student began exam attempt ${req.params.attemptId}`,
      ip: req.ip,
    });

    res.json({ startedAt: rows[0].started_at });
  } catch (err) {
    console.error('Begin exam error:', err);
    res.status(500).json({ error: 'Failed to begin exam' });
  }
});

// Submit exam
router.post('/submit', authenticate, async (req, res) => {
  const { attemptId } = req.body;
  if (!attemptId) return res.status(400).json({ error: 'Missing attemptId' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: attempts } = await client.query(
      `SELECT ea.*, e.total_marks, e.questions_to_answer, e.show_result
       FROM exam_attempts ea JOIN exams e ON ea.exam_id = e.id WHERE ea.id = $1`,
      [attemptId]
    );
    if (attempts.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Attempt not found' }); }
    const attempt = attempts[0];
    const showResult = attempt.show_result !== false;

    // Already submitted — return existing score (or hide if showResult is OFF)
    if (attempt.status !== 'in_progress') {
      await client.query('ROLLBACK');
      if (!showResult) return res.json({ submitted: true, showResult: false });
      return res.json({ score: parseFloat(attempt.score || 0), total: parseFloat(attempt.total_marks), showResult: true });
    }

    const { rows: studentAnswers } = await client.query(
      `SELECT a.question_id, a.answer, q.correct_answer, q.type
       FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.attempt_id = $1`,
      [attemptId]
    );

    let correct = 0;
    const marksPerQ = parseFloat(attempt.total_marks) / attempt.questions_to_answer;

    for (const sa of studentAnswers) {
      if (sa.type === 'essay' || sa.type === 'short_answer') continue;
      const correctAns = sa.correct_answer;
      if (typeof correctAns === 'string' && sa.answer?.toLowerCase() === correctAns.toLowerCase()) correct++;
      else if (Array.isArray(correctAns) && correctAns.map(a => a.toLowerCase()).includes(sa.answer?.toLowerCase())) correct++;
    }

    const score = correct * marksPerQ;

    await client.query(
      `UPDATE exam_attempts SET submitted_at = NOW(), score = $1, total_marks = $2, status = 'submitted'
       WHERE id = $3`,
      [score, attempt.total_marks, attemptId]
    );

    await client.query('COMMIT');
    if (!showResult) {
      return res.json({ submitted: true, showResult: false });
    }
    res.json({ score: Math.round(score * 100) / 100, total: parseFloat(attempt.total_marks), showResult: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Submit error:', err);
    res.status(500).json({ error: 'Failed to submit exam' });
  } finally {
    client.release();
  }
});

// Get saved answers for an attempt
router.get('/attempt/:attemptId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT question_id, answer FROM answers WHERE attempt_id = $1`,
      [req.params.attemptId]
    );
    const answers = {};
    rows.forEach(r => { answers[r.question_id] = r.answer; });
    res.json(answers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch answers' });
  }
});

// Update current question index
router.patch('/attempt/:attemptId/current-question', authenticate, async (req, res) => {
  const { currentQuestion } = req.body;
  try {
    await pool.query(
      `UPDATE exam_attempts SET current_question = $1 WHERE id = $2 AND student_id = $3`,
      [currentQuestion || 0, req.params.attemptId, req.user.id]
    );
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update current question' });
  }
});

// Get full attempt state
router.get('/attempt/:attemptId/state', authenticate, async (req, res) => {
  try {
    const { rows: attempts } = await pool.query(
      `SELECT ea.started_at, ea.status, ea.current_question, e.duration
       FROM exam_attempts ea JOIN exams e ON ea.exam_id = e.id
       WHERE ea.id = $1 AND ea.student_id = $2`,
      [req.params.attemptId, req.user.id]
    );
    if (attempts.length === 0) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attempts[0];

    const { rows: answerRows } = await pool.query(
      `SELECT question_id, answer FROM answers WHERE attempt_id = $1`,
      [req.params.attemptId]
    );
    const answers = {};
    answerRows.forEach(r => { answers[r.question_id] = r.answer; });

    res.json({
      startedAt: attempt.started_at,
      status: attempt.status,
      currentQuestion: attempt.current_question || 0,
      duration: attempt.duration,
      answers,
    });
  } catch (err) {
    console.error('Get attempt state error:', err);
    res.status(500).json({ error: 'Failed to fetch attempt state' });
  }
});

module.exports = router;
