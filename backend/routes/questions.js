const { Router } = require('express');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// Get questions for an exam (student taking exam) — per-student random selection + shuffle
router.get('/exam/:examId', authenticate, async (req, res) => {
  try {
    const studentId = req.user.id;
    const examId = req.params.examId;

    // Check if student already has a persisted question set
    const { rows: attempt } = await pool.query(
      `SELECT id FROM exam_attempts WHERE exam_id = $1 AND student_id = $2`,
      [examId, studentId]
    );

    if (attempt.length > 0) {
      // Check for previously saved answers to determine which questions were assigned
      const { rows: savedAnswers } = await pool.query(
        `SELECT question_id FROM answers WHERE attempt_id = $1`,
        [attempt[0].id]
      );
      const answeredIds = savedAnswers.map(r => r.question_id);

      // If we have saved answers, get those questions + fill to questionsToAnswer
      if (answeredIds.length > 0) {
        // Get all questions from exam pool
        const { rows: allQ } = await pool.query(
          `SELECT q.id, q.type, q.text, q.options, q.difficulty, q.image_url
           FROM questions q JOIN exam_questions eq ON q.id = eq.question_id
           WHERE eq.exam_id = $1`,
          [examId]
        );

        const { rows: examInfo } = await pool.query(`SELECT questions_to_answer FROM exams WHERE id = $1`, [examId]);
        const qta = examInfo[0]?.questions_to_answer || allQ.length;

        // Prioritize already-answered questions, then fill randomly
        const answeredQ = allQ.filter(q => answeredIds.includes(q.id));
        const remaining = allQ.filter(q => !answeredIds.includes(q.id));
        const shuffled = remaining.sort(() => Math.random() - 0.5);
        const selected = [...answeredQ, ...shuffled].slice(0, qta);

        // Shuffle the final set and shuffle options
        const finalQ = selected.sort(() => Math.random() - 0.5);

        return res.json(finalQ.map(q => ({
          id: q.id, type: q.type, text: q.text,
          options: q.options ? shuffleArray([...q.options]) : q.options,
          difficulty: q.difficulty, imageUrl: q.image_url || null,
        })));
      }
    }

    // Fresh exam start: randomly select questionsToAnswer from the pool
    const { rows: examInfo } = await pool.query(`SELECT questions_to_answer FROM exams WHERE id = $1`, [examId]);
    const qta = examInfo[0]?.questions_to_answer || 20;

    const { rows } = await pool.query(
      `SELECT q.id, q.type, q.text, q.options, q.difficulty, q.image_url
       FROM questions q
       JOIN exam_questions eq ON q.id = eq.question_id
       WHERE eq.exam_id = $1
       ORDER BY RANDOM()
       LIMIT $2`,
      [examId, qta]
    );

    // Shuffle options for each question
    const shuffledQuestions = rows.sort(() => Math.random() - 0.5);

    res.json(shuffledQuestions.map(q => ({
      id: q.id, type: q.type, text: q.text,
      options: q.options ? shuffleArray([...q.options]) : q.options,
      difficulty: q.difficulty, imageUrl: q.image_url || null,
    })));
  } catch (err) {
    console.error('Get exam questions error:', err);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Get question bank (staff)
router.get('/bank', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  try {
    const { courseId, createdBy } = req.query;
    let query = `SELECT q.*, c.code as course_code FROM questions q JOIN courses c ON q.course_id = c.id WHERE 1=1`;
    const params = [];
    if (courseId) { params.push(courseId); query += ` AND q.course_id = $${params.length}`; }
    if (createdBy) { params.push(createdBy); query += ` AND q.created_by = $${params.length}`; }
    query += ' ORDER BY q.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows.map(q => ({
      id: q.id, type: q.type, text: q.text,
      options: q.options, correctAnswer: q.correct_answer,
      difficulty: q.difficulty, course: q.course_code,
      createdBy: q.created_by, imageUrl: q.image_url || null,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch question bank' });
  }
});

// Create question
router.post('/', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  const { type, text, options, correctAnswer, difficulty, courseId, imageUrl } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO questions (type, text, options, correct_answer, difficulty, course_id, created_by, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [type, text, JSON.stringify(options), JSON.stringify(correctAnswer), difficulty, courseId, req.user.id, imageUrl || null]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error('Create question error:', err);
    res.status(500).json({ error: 'Failed to create question' });
  }
});

// Update question
router.put('/:id', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  const { type, text, options, correctAnswer, difficulty, courseId, imageUrl } = req.body;
  try {
    await pool.query(
      `UPDATE questions SET type=$1, text=$2, options=$3, correct_answer=$4, difficulty=$5, course_id=$6, image_url=$7 WHERE id=$8`,
      [type, text, options ? JSON.stringify(options) : null, correctAnswer ? JSON.stringify(correctAnswer) : null, difficulty, courseId, imageUrl || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update question error:', err);
    res.status(500).json({ error: 'Failed to update question' });
  }
});

// Delete question
router.delete('/:id', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM questions WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

module.exports = router;
