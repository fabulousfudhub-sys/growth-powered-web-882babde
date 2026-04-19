const { Router } = require('express');
const bcrypt = require('bcrypt');
const { pool } = require('../db/pool');
const { generateToken, authenticate } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = Router();

// Auto-submit helper (shared)
// Uses per-question marks from `questions.marks`. Falls back to even split when marks not set.
async function autoSubmitAttempt(attemptId, client) {
  const conn = client || await pool.connect();
  const shouldRelease = !client;
  try {
    if (!client) await conn.query('BEGIN');
    const { rows: attempts } = await conn.query(
      `SELECT ea.*, e.total_marks, e.questions_to_answer
       FROM exam_attempts ea JOIN exams e ON ea.exam_id = e.id WHERE ea.id = $1 AND ea.status = 'in_progress'`,
      [attemptId]
    );
    if (attempts.length === 0) { if (!client) await conn.query('ROLLBACK'); return null; }
    const attempt = attempts[0];

    const { rows: studentAnswers } = await conn.query(
      `SELECT a.id as answer_id, a.question_id, a.answer, q.correct_answer, q.type,
              COALESCE(q.marks, 0) AS marks
       FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.attempt_id = $1`,
      [attemptId]
    );

    const totalMarks = parseFloat(attempt.total_marks) || 0;
    // Uniform per-question marks: total_marks / questions_to_answer.
    // No per-question scoring — MCQ/T-F/etc. all carry the same weight.
    // Essays/short-answer use the same allotment but are graded manually later.
    const evenSplit = attempt.questions_to_answer > 0 ? totalMarks / attempt.questions_to_answer : 0;

    let earned = 0;
    let pendingManual = 0;
    const requiresGradingIds = [];

    for (const sa of studentAnswers) {
      const qMarks = evenSplit;

      if (sa.type === 'essay' || sa.type === 'short_answer') {
        pendingManual += qMarks;
        requiresGradingIds.push(sa.answer_id);
        continue;
      }

      const correctAns = sa.correct_answer;
      const studentAns = (sa.answer || '').toLowerCase().trim();
      let isCorrect = false;
      if (typeof correctAns === 'string' && studentAns === correctAns.toLowerCase().trim()) {
        isCorrect = true;
      } else if (Array.isArray(correctAns)) {
        const acceptable = correctAns.map(a => String(a).toLowerCase().trim());
        if (acceptable.includes(studentAns)) isCorrect = true;
      }
      if (isCorrect) earned += qMarks;
    }

    if (requiresGradingIds.length > 0) {
      try {
        await conn.query(
          `UPDATE answers SET requires_grading = TRUE WHERE id = ANY($1::uuid[])`,
          [requiresGradingIds],
        );
      } catch { /* column may be missing on older DBs */ }
    }

    await conn.query(
      `UPDATE exam_attempts SET submitted_at = NOW(), score = $1, total_marks = $2, status = 'submitted' WHERE id = $3`,
      [earned, totalMarks, attemptId]
    );
    if (!client) await conn.query('COMMIT');
    return {
      score: Math.round(earned * 100) / 100,
      total: totalMarks,
      pendingManual: Math.round(pendingManual * 100) / 100,
    };
  } catch (err) {
    if (!client) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    }
    console.error('Auto-submit error:', err);
    return null;
  } finally {
    if (shouldRelease) {
      try { conn.release(); } catch { /* ignore */ }
    }
  }
}

// Restore session from JWT token
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, d.name as department_name, s.name as school_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN schools s ON d.school_id = s.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    const response = {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        regNumber: user.reg_number, department: user.department_name, level: user.level,
      },
    };

    // If student, check for active exam attempt
    if (user.role === 'student') {
      const { rows: attempts } = await pool.query(
        `SELECT ea.id as attempt_id, ea.exam_id, e.title, e.duration, e.total_questions,
                e.questions_to_answer, e.total_marks, e.instructions, e.status as exam_status,
                e.programme, e.level as exam_level, ea.started_at, ea.status as attempt_status,
                c.code as course_code, d2.name as dept_name, s2.name as school_name,
                e.end_date
         FROM exam_attempts ea
         JOIN exams e ON ea.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         JOIN departments d2 ON e.department_id = d2.id
         JOIN schools s2 ON e.school_id = s2.id
         WHERE ea.student_id = $1 AND ea.status = 'in_progress'
         ORDER BY ea.created_at DESC LIMIT 1`,
        [user.id]
      );
      if (attempts.length > 0) {
        const a = attempts[0];

        // If started_at is set, check if timer has elapsed
        if (a.started_at !== null) {
          const startedAt = new Date(a.started_at).getTime();
          const durationMs = a.duration * 60 * 1000;
          const now = Date.now();
          const examEndDate = a.end_date ? new Date(a.end_date).getTime() : null;

          if (now - startedAt >= durationMs || (examEndDate && now >= examEndDate)) {
            await autoSubmitAttempt(a.attempt_id);
            // Don't return exam — it's submitted
          } else {
            response.exam = buildExamResponse(a);
            response.attemptId = a.attempt_id;
            response.startedAt = a.started_at;
          }
        } else {
          // Not yet started (student hasn't clicked Begin) — return exam info
          response.exam = buildExamResponse(a);
          response.attemptId = a.attempt_id;
          response.startedAt = null;
        }
      }
    }

    res.json(response);
  } catch (err) {
    console.error('Auth /me error:', err);
    res.status(500).json({ error: 'Failed to restore session' });
  }
});

function buildExamResponse(a) {
  return {
    id: a.exam_id, title: a.title, course: a.course_code,
    department: a.dept_name, school: a.school_name,
    programme: a.programme, level: a.exam_level,
    duration: a.duration, totalQuestions: a.total_questions,
    questionsToAnswer: a.questions_to_answer, totalMarks: parseFloat(a.total_marks),
    startDate: null, endDate: a.end_date,
    instructions: a.instructions, status: a.exam_status,
    createdBy: null, enrolledStudents: 0,
  };
}

// Staff login
router.post('/staff/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await pool.query(
      `SELECT u.*, d.name as department_name, s.name as school_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN schools s ON d.school_id = s.id
       WHERE u.email = $1 AND u.role != 'student'`,
      [email]
    );
    if (rows.length === 0) {
      await logAudit({ action: 'Login Failed', category: 'auth', details: `Failed staff login attempt for ${email}`, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logAudit({ userId: user.id, userName: user.name, role: user.role, action: 'Login Failed', category: 'auth', details: `Invalid password for ${email}`, ip: req.ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);
    await logAudit({ userId: user.id, userName: user.name, role: user.role, action: 'Staff Login', category: 'auth', details: `${user.name} logged in as ${user.role}`, ip: req.ip });

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        department: user.department_name, level: user.level,
      },
    });
  } catch (err) {
    console.error('Staff login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Student login with exam PIN
router.post('/student/login', async (req, res) => {
  const { matricNumber, examPin } = req.body;
  if (!matricNumber || !examPin) return res.status(400).json({ error: 'Reg. Number and PIN required' });

  try {
    // Find student
    const { rows: students } = await pool.query(
      `SELECT id, name, reg_number, department_id, level FROM users WHERE reg_number = $1 AND role = 'student'`,
      [matricNumber]
    );
    if (students.length === 0) {
      await logAudit({ action: 'Login Failed', category: 'auth', details: `Invalid student reg number: ${matricNumber}`, ip: req.ip });
      return res.status(401).json({ error: 'Invalid Reg. Number' });
    }
    const student = students[0];

    // Check if student has an existing in_progress attempt (allow resume)
    const { rows: existingInProgress } = await pool.query(
      `SELECT ea.id as attempt_id, ea.exam_id, ea.started_at, e.title, e.duration, e.total_questions,
              e.questions_to_answer, e.total_marks, e.instructions, e.status as exam_status,
              e.programme, e.level as exam_level, e.end_date,
              c.code as course_code, d.name as dept_name, s.name as school_name
       FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       JOIN courses c ON e.course_id = c.id
       JOIN departments d ON e.department_id = d.id
       JOIN schools s ON e.school_id = s.id
       WHERE ea.student_id = $1 AND ea.status = 'in_progress'
       ORDER BY ea.created_at DESC LIMIT 1`,
      [student.id]
    );

    if (existingInProgress.length > 0) {
      const a = existingInProgress[0];

      // If started_at is set, check if timer elapsed
      if (a.started_at !== null) {
        const startedAt = new Date(a.started_at).getTime();
        const durationMs = a.duration * 60 * 1000;
        const now = Date.now();
        const examEndDate = a.end_date ? new Date(a.end_date).getTime() : null;

        if (now - startedAt >= durationMs || (examEndDate && now >= examEndDate)) {
          await autoSubmitAttempt(a.attempt_id);
          return res.status(401).json({ error: 'Your exam time has elapsed. The exam has been auto-submitted.' });
        }
      }

      // Allow resume — timer still running or not yet started
      await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [student.id]);
      await logAudit({ userId: student.id, userName: student.name, role: 'student', action: 'Exam Resumed', category: 'exam', details: `${student.name} resumed exam: ${a.title}`, ip: req.ip });

      const token = generateToken({ id: student.id, role: 'student', name: student.name });
      return res.json({
        token,
        user: { id: student.id, name: student.name, regNumber: student.reg_number, role: 'student' },
        exam: buildExamResponse(a),
        attemptId: a.attempt_id,
        startedAt: a.started_at, // Could be null if not yet begun
        resumed: true,
      });
    }

    // No existing attempt — validate PIN and create new attempt

    // First check for shared PIN exams
    const { rows: sharedExams } = await pool.query(
      `SELECT e.id as exam_id, e.title, e.duration, e.total_questions,
              e.questions_to_answer, e.total_marks, e.instructions, e.status,
              c.code as course_code, d.name as dept_name, s.name as school_name,
              e.programme, e.level as exam_level, e.end_date
       FROM exams e
       JOIN courses c ON e.course_id = c.id
       JOIN departments d ON e.department_id = d.id
       JOIN schools s ON e.school_id = s.id
       WHERE e.pin_mode = 'shared' AND e.shared_pin = $1 AND e.status = 'active'
         AND e.department_id = $2 AND (e.level = $3 OR e.level IS NULL)`,
      [examPin, student.department_id, student.level]
    );

    let pin = null;
    let isSharedPin = false;

    if (sharedExams.length > 0) {
      const exam = sharedExams[0];
      // Check if already submitted
      const { rows: existingAttempts } = await pool.query(
        `SELECT id, status FROM exam_attempts WHERE exam_id = $1 AND student_id = $2`,
        [exam.exam_id, student.id]
      );
      if (existingAttempts.length > 0 && existingAttempts[0].status !== 'in_progress') {
        return res.status(401).json({ error: 'You have already taken this exam' });
      }
      pin = exam;
      isSharedPin = true;
    } else {
      // Individual PIN lookup
      const { rows: pins } = await pool.query(
        `SELECT ep.*, e.id as exam_id, e.title, e.duration, e.total_questions,
                e.questions_to_answer, e.total_marks, e.instructions, e.status,
                c.code as course_code, d.name as dept_name, s.name as school_name,
                e.programme, e.level as exam_level, e.end_date
         FROM exam_pins ep
         JOIN exams e ON ep.exam_id = e.id
         JOIN courses c ON e.course_id = c.id
         JOIN departments d ON e.department_id = d.id
         JOIN schools s ON e.school_id = s.id
         WHERE ep.student_id = $1 AND ep.pin = $2 AND e.status = 'active' AND ep.used = FALSE`,
        [student.id, examPin]
      );
      if (pins.length === 0) return res.status(401).json({ error: 'Invalid or used exam PIN' });
      pin = pins[0];

      // Reject if already submitted/graded
      const { rows: priorAttempts } = await pool.query(
        `SELECT id, status FROM exam_attempts WHERE exam_id = $1 AND student_id = $2`,
        [pin.exam_id, student.id]
      );
      if (priorAttempts.length > 0 && priorAttempts[0].status !== 'in_progress') {
        return res.status(401).json({ error: 'You have already taken this exam' });
      }
    }

    // Mark individual PIN as used
    if (!isSharedPin) {
      await pool.query(`UPDATE exam_pins SET used = TRUE, used_at = NOW() WHERE id = $1`, [pin.id]);
    }
    await pool.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [student.id]);

    // Single-device fingerprint lock (sent by client)
    const fingerprint = (req.body.deviceFingerprint || req.headers['x-device-fingerprint'] || '').toString().slice(0, 128) || null;

    // Create attempt — only allow status reset if previous was in_progress (never reset graded attempts).
    // Cast $3 explicitly to VARCHAR so Postgres can resolve param type when fingerprint is null.
    const { rows: attempts } = await pool.query(
      `INSERT INTO exam_attempts (exam_id, student_id, started_at, device_fingerprint, device_locked_at)
       VALUES ($1, $2, NULL, $3::varchar, CASE WHEN $3::varchar IS NULL THEN NULL ELSE NOW() END)
       ON CONFLICT (exam_id, student_id) DO UPDATE
         SET device_fingerprint = COALESCE(exam_attempts.device_fingerprint, EXCLUDED.device_fingerprint),
             device_locked_at = COALESCE(exam_attempts.device_locked_at, EXCLUDED.device_locked_at)
       WHERE exam_attempts.status = 'in_progress'
       RETURNING id, started_at, device_fingerprint`,
      [pin.exam_id, student.id, fingerprint]
    );
    if (attempts.length === 0) {
      return res.status(401).json({ error: 'You have already taken this exam' });
    }
    if (fingerprint && attempts[0].device_fingerprint && attempts[0].device_fingerprint !== fingerprint) {
      await logAudit({
        userId: student.id, userName: student.name, role: 'student',
        action: 'Device Mismatch', category: 'security',
        details: `Blocked login for ${student.name} on exam ${pin.title}. Locked device: ${attempts[0].device_fingerprint.slice(0,8)}…, attempted device: ${fingerprint.slice(0,8)}… | examId:${pin.exam_id} | studentId:${student.id}`,
        ip: req.ip,
      });
      return res.status(403).json({ error: 'This exam is locked to another device. Contact your invigilator.' });
    }

    await logAudit({ userId: student.id, userName: student.name, role: 'student', action: 'Exam Login', category: 'exam', details: `${student.name} logged in for exam: ${pin.title}`, ip: req.ip });

    const token = generateToken({ id: student.id, role: 'student', name: student.name });

    res.json({
      token,
      user: { id: student.id, name: student.name, regNumber: student.reg_number, role: 'student' },
      exam: {
        id: pin.exam_id, title: pin.title, course: pin.course_code,
        department: pin.dept_name, school: pin.school_name,
        programme: pin.programme, level: pin.exam_level,
        duration: pin.duration, totalQuestions: pin.total_questions,
        questionsToAnswer: pin.questions_to_answer, totalMarks: parseFloat(pin.total_marks),
        startDate: null, endDate: pin.end_date,
        instructions: pin.instructions, status: pin.status,
        createdBy: null, enrolledStudents: 0,
      },
      attemptId: attempts[0].id,
      startedAt: attempts[0].started_at, // NULL — timer not started yet
    });
  } catch (err) {
    console.error('Student login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Check attempt status (polling endpoint for students)
router.get('/attempt-status/:attemptId', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ea.status, ea.score, ea.total_marks, ea.submitted_at,
              e.status as exam_status, e.show_result
       FROM exam_attempts ea JOIN exams e ON ea.exam_id = e.id
       WHERE ea.id = $1 AND ea.student_id = $2`,
      [req.params.attemptId, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = rows[0];
    const showResult = row.show_result !== false;
    res.json({
      status: row.status,
      submitted_at: row.submitted_at,
      exam_status: row.exam_status,
      showResult,
      // Strip score/total when admin disabled result display
      score: showResult ? row.score : undefined,
      total_marks: showResult ? row.total_marks : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
module.exports.autoSubmitAttempt = autoSubmitAttempt;
