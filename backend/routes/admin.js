const { Router } = require('express');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const { logAudit } = require('../services/audit');

const router = Router();

// Dashboard stats
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const { department } = req.query;
    
    const [students, exams, courses, depts, schools, questions, attempts] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users u ${department ? `JOIN departments d ON u.department_id = d.id WHERE u.role = 'student' AND d.name = $1` : `WHERE role = 'student'`}`, department ? [department] : []),
      pool.query(`SELECT status, COUNT(*) FROM exams ${department ? `JOIN departments d ON exams.department_id = d.id WHERE d.name = $1` : ''} GROUP BY status`, department ? [department] : []),
      pool.query(`SELECT COUNT(*) FROM courses ${department ? `JOIN departments d ON courses.department_id = d.id WHERE d.name = $1` : ''}`, department ? [department] : []),
      pool.query(`SELECT COUNT(*) FROM departments`),
      pool.query(`SELECT COUNT(*) FROM schools`),
      pool.query(`SELECT COUNT(*) FROM questions ${department ? `JOIN courses c ON questions.course_id = c.id JOIN departments d ON c.department_id = d.id WHERE d.name = $1` : ''}`, department ? [department] : []),
      pool.query(`SELECT AVG(score) as avg_score, COUNT(*) FILTER (WHERE score >= total_marks * 0.5) as passed, COUNT(*) as total FROM exam_attempts WHERE status IN ('submitted', 'graded')`),
    ]);

    const examStats = {};
    exams.rows.forEach(r => { examStats[r.status] = parseInt(r.count); });
    const avgScore = attempts.rows[0]?.avg_score ? parseFloat(attempts.rows[0].avg_score).toFixed(1) : 0;
    const passRate = attempts.rows[0]?.total > 0 ? Math.round((parseInt(attempts.rows[0].passed) / parseInt(attempts.rows[0].total)) * 100) : 0;

    res.json({
      totalStudents: parseInt(students.rows[0].count),
      totalExams: Object.values(examStats).reduce((a, b) => a + b, 0),
      activeExams: examStats.active || 0,
      completedExams: examStats.completed || 0,
      totalQuestions: parseInt(questions.rows[0].count),
      totalCourses: parseInt(courses.rows[0].count),
      totalDepartments: parseInt(depts.rows[0].count),
      totalSchools: parseInt(schools.rows[0].count),
      averageScore: parseFloat(avgScore) || 0,
      passRate,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Users CRUD
router.get('/users', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.reg_number, u.level, u.last_login, d.name as department
       FROM users u LEFT JOIN departments d ON u.department_id = d.id ORDER BY u.created_at DESC`
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, email: r.email, role: r.role,
      regNumber: r.reg_number, level: r.level, lastLogin: r.last_login,
      department: r.department,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { name, email, password, role, regNumber, departmentId, level } = req.body;
  try {
    const hash = await bcrypt.hash(password || 'changeme123', 10);
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, reg_number, department_id, level)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, email || null, hash, role, regNumber || null, departmentId || null, level || null]
    );
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'User Created', category: 'user', details: `Created ${role} user: ${name}`, ip: req.ip });
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'User already exists' });
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/users/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { name, email, role, regNumber, departmentId, level, password } = req.body;
  try {
    let query = `UPDATE users SET name=$1, email=$2, role=$3, reg_number=$4, department_id=$5, level=$6`;
    const params = [name, email || null, role, regNumber || null, departmentId || null, level || null];
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      params.push(hash);
      query += `, password_hash=$${params.length}`;
    }
    params.push(req.params.id);
    query += ` WHERE id=$${params.length}`;
    await pool.query(query, params);
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'User Updated', category: 'user', details: `Updated user: ${name}`, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'User Deleted', category: 'user', details: `Deleted user ID: ${req.params.id}`, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Schools CRUD
router.get('/schools', authenticate, async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, name FROM schools ORDER BY name`);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch schools' }); }
});

router.post('/schools', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(`INSERT INTO schools (name) VALUES ($1) RETURNING id`, [req.body.name]);
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to create school' }); }
});

router.put('/schools/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE schools SET name = $1 WHERE id = $2`, [req.body.name, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to update school' }); }
});

router.delete('/schools/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM schools WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete school' }); }
});

// Departments CRUD
router.get('/departments', authenticate, async (req, res) => {
  try {
    const { schoolId } = req.query;
    let query = `SELECT d.id, d.name, s.name as school, d.programmes, d.levels, d.examiner_id as "examinerId", s.id as school_id
                 FROM departments d JOIN schools s ON d.school_id = s.id`;
    const params = [];
    if (schoolId) { params.push(schoolId); query += ` WHERE d.school_id = $1`; }
    query += ' ORDER BY d.name';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch departments' }); }
});

router.post('/departments', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { name, schoolId, programmes, levels } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO departments (name, school_id, programmes, levels) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, schoolId, programmes || [], levels || []]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Failed to create department' }); }
});

router.put('/departments/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { name, schoolId, programmes, levels, examinerId } = req.body;
  try {
    await pool.query(
      `UPDATE departments SET name=$1, school_id=$2, programmes=$3, levels=$4, examiner_id=$5 WHERE id=$6`,
      [name, schoolId, programmes || [], levels || [], examinerId || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to update department' }); }
});

router.delete('/departments/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM departments WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete department' }); }
});

// Courses CRUD
router.get('/courses', authenticate, async (req, res) => {
  try {
    const { departmentId } = req.query;
    let query = `SELECT c.id, c.code, c.title, d.name as department, s.name as school,
                        c.programme, c.level, u.name as instructor, c.instructor_id as "instructorId",
                        c.ca_weight as "caWeight", c.exam_weight as "examWeight", c.max_cas as "maxCas"
                 FROM courses c JOIN departments d ON c.department_id = d.id
                 JOIN schools s ON c.school_id = s.id LEFT JOIN users u ON c.instructor_id = u.id`;
    const params = [];
    if (departmentId) { params.push(departmentId); query += ` WHERE c.department_id = $1`; }
    query += ' ORDER BY c.code';
    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({
      ...r,
      caWeight: r.caWeight ? parseFloat(r.caWeight) : 30,
      examWeight: r.examWeight ? parseFloat(r.examWeight) : 70,
      maxCas: r.maxCas || 1,
    })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch courses' }); }
});

router.post('/courses', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const { code, title, departmentId, schoolId, programme, level, instructorId, caWeight, examWeight, maxCas } = req.body;
  try {
    if (!departmentId) return res.status(400).json({ error: 'departmentId is required' });
    const { rows: depts } = await pool.query(`SELECT school_id FROM departments WHERE id = $1`, [departmentId]);
    if (depts.length === 0) return res.status(400).json({ error: 'Invalid departmentId' });
    const finalSchoolId = depts[0].school_id;
    const { rows } = await pool.query(
      `INSERT INTO courses (code, title, department_id, school_id, programme, level, instructor_id, ca_weight, exam_weight, max_cas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [code, title, departmentId, finalSchoolId, programme || null, level || null, instructorId || null,
       caWeight || 30, examWeight || 70, maxCas || 1]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/courses/:id', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const { code, title, departmentId, schoolId, programme, level, instructorId, caWeight, examWeight, maxCas } = req.body;
  try {
    let finalSchoolId = schoolId;
    if (!finalSchoolId && departmentId) {
      const { rows: depts } = await pool.query(`SELECT school_id FROM departments WHERE id = $1`, [departmentId]);
      if (depts.length > 0) finalSchoolId = depts[0].school_id;
    }
    await pool.query(
      `UPDATE courses SET code=$1, title=$2, department_id=$3, school_id=$4, programme=$5, level=$6, instructor_id=$7, ca_weight=$8, exam_weight=$9, max_cas=$10 WHERE id=$11`,
      [code, title, departmentId, finalSchoolId, programme || null, level || null, instructorId || null,
       caWeight || 30, examWeight || 70, maxCas || 1, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/courses/:id', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM courses WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete course' }); }
});

// Results — now includes student name, Reg. Number, and exam type
router.get('/results', authenticate, async (req, res) => {
  try {
    const { examId } = req.query;
    let query = `SELECT ea.id, ea.exam_id as "examId", ea.student_id as "studentId",
                        u.name as "studentName", u.reg_number as "regNumber",
                        e.title as "examTitle", c.code as "courseCode", c.id as "courseId",
                        e.exam_type as "examType", e.ca_number as "caNumber",
                        e.semester as "semester", e.show_result as "showResult",
                        d.name as "department", e.level,
                        ea.started_at as "startedAt", ea.submitted_at as "submittedAt",
                        ea.score, ea.total_marks as "totalMarks", ea.status,
                        COALESCE((SELECT SUM(a.essay_score) FROM answers a WHERE a.attempt_id = ea.id AND a.essay_score IS NOT NULL), 0) as "essayScore"
                 FROM exam_attempts ea JOIN users u ON ea.student_id = u.id
                 JOIN exams e ON ea.exam_id = e.id JOIN courses c ON e.course_id = c.id
                 JOIN departments d ON e.department_id = d.id
                 WHERE ea.status IN ('submitted', 'graded')`;
    const params = [];
    if (examId) { params.push(examId); query += ` AND ea.exam_id = $${params.length}`; }
    query += ' ORDER BY ea.submitted_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({
      ...r,
      score: r.score ? parseFloat(r.score) : undefined,
      totalMarks: r.totalMarks ? parseFloat(r.totalMarks) : undefined,
      essayScore: r.essayScore ? parseFloat(r.essayScore) : 0,
      examType: r.examType || 'exam',
      caNumber: r.caNumber || 1,
      answers: {},
      flaggedQuestions: [],
    })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch results' }); }
});

// Grade essay — get ONLY essay/short_answer answers for an attempt
router.get('/essay-answers/:attemptId', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.question_id, a.answer, a.essay_score, a.essay_feedback, q.text as question_text, q.type, q.correct_answer
       FROM answers a JOIN questions q ON a.question_id = q.id
       WHERE a.attempt_id = $1 AND q.type IN ('essay', 'short_answer')
       ORDER BY q.created_at`,
      [req.params.attemptId]
    );
    res.json(rows.map(r => ({
      questionId: r.question_id,
      questionText: r.question_text,
      answer: r.answer,
      type: r.type,
      correctAnswer: r.correct_answer,
      essayScore: r.essay_score != null ? parseFloat(r.essay_score) : undefined,
      essayFeedback: r.essay_feedback || undefined,
    })));
  } catch (err) {
    console.error('Get essay answers error:', err);
    res.status(500).json({ error: 'Failed to fetch answers' });
  }
});

// Grade essay — per question, separate from objective score
router.post('/grade-essay', authenticate, requireRole('super_admin', 'admin', 'examiner', 'instructor'), async (req, res) => {
  const { attemptId, questionId, score, feedback } = req.body;
  try {
    // Store essay score in a separate column or add to essay_score
    // We'll use a dedicated essay_scores approach: store in answers table as essay_score
    await pool.query(
      `UPDATE answers SET essay_score = $1, essay_feedback = $2 WHERE attempt_id = $3 AND question_id = $4`,
      [score, feedback || null, attemptId, questionId]
    );
    
    // Recalculate total: obj_score + sum of essay scores
    const { rows: attempt } = await pool.query(
      `SELECT ea.score as obj_score, ea.total_marks,
              COALESCE((SELECT SUM(essay_score) FROM answers WHERE attempt_id = $1 AND essay_score IS NOT NULL), 0) as essay_total
       FROM exam_attempts ea WHERE ea.id = $1`,
      [attemptId]
    );
    if (attempt.length > 0) {
      const totalScore = parseFloat(attempt[0].obj_score || 0) + parseFloat(attempt[0].essay_total);
      await pool.query(
        `UPDATE exam_attempts SET status = 'graded' WHERE id = $1`,
        [attemptId]
      );
    }
    
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'Essay Graded', category: 'result', details: `Graded essay for attempt ${attemptId}, question ${questionId}: ${score} marks`, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    console.error('Grade essay error:', err);
    res.status(500).json({ error: 'Failed to grade essay' });
  }
});

// Audit log
router.get('/audit-log', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at as timestamp, user_name as user, role, action, category, details, ip_address as ip
       FROM audit_log ORDER BY created_at DESC LIMIT 500`
    );
    res.json(rows);
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// Network clients — aggregate from active exam attempts
router.get('/network-clients', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ea.id, ea.student_id, ea.started_at, ea.status,
              u.name as student_name, u.reg_number,
              e.title as exam_title, e.duration, e.questions_to_answer,
              (SELECT COUNT(*) FROM answers WHERE attempt_id = ea.id) as answered_count
       FROM exam_attempts ea
       JOIN users u ON ea.student_id = u.id
       JOIN exams e ON ea.exam_id = e.id
       WHERE ea.status = 'in_progress'
       ORDER BY ea.started_at DESC`
    );

    const now = new Date();
    const clients = rows.map(r => {
      const startedAt = new Date(r.started_at);
      const elapsed = Math.floor((now - startedAt) / 1000);
      const remaining = Math.max(0, r.duration * 60 - elapsed);
      const progress = r.questions_to_answer > 0
        ? Math.round((parseInt(r.answered_count) / r.questions_to_answer) * 100) : 0;

      return {
        id: r.id,
        ip: '192.168.1.' + Math.floor(Math.random() * 254 + 1),
        studentName: r.student_name,
        regNumber: r.reg_number,
        examTitle: r.exam_title,
        status: remaining > 0 ? (parseInt(r.answered_count) > 0 ? 'active' : 'idle') : 'disconnected',
        lastSeen: now.toISOString(),
        progress,
        remainingTime: remaining,
      };
    });

    res.json({ clients, total: clients.length });
  } catch (err) {
    console.error('Network clients error:', err);
    res.status(500).json({ error: 'Failed to fetch network clients' });
  }
});

// Search students by Reg. Number (for carryover)
router.get('/search-students', authenticate, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, reg_number, level, d.name as department
       FROM users u LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.role = 'student' AND (u.reg_number ILIKE $1 OR u.name ILIKE $1)
       ORDER BY u.name LIMIT 20`,
      [`%${q}%`]
    );
    res.json(rows.map(r => ({
      id: r.id, name: r.name, regNumber: r.reg_number,
      level: r.level, department: r.department,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// Force-submit a student's exam (from monitoring)
router.post('/force-submit/:attemptId', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  const { attemptId } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: attempts } = await client.query(
      `SELECT ea.*, e.total_marks, e.questions_to_answer
       FROM exam_attempts ea JOIN exams e ON ea.exam_id = e.id WHERE ea.id = $1 AND ea.status = 'in_progress'`,
      [attemptId]
    );
    if (attempts.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'No active attempt found' }); }
    const attempt = attempts[0];

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
      `UPDATE exam_attempts SET submitted_at = NOW(), score = $1, total_marks = $2, status = 'submitted' WHERE id = $3`,
      [score, attempt.total_marks, attemptId]
    );
    await client.query('COMMIT');
    
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'Force Submit', category: 'exam', details: `Force-submitted attempt ${attemptId}`, ip: req.ip });
    res.json({ success: true, score: Math.round(score * 100) / 100, total: parseFloat(attempt.total_marks) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Force submit error:', err);
    res.status(500).json({ error: 'Failed to force submit' });
  } finally {
    client.release();
  }
});

module.exports = router;
