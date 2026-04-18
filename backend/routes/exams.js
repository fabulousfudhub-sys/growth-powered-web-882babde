const { Router } = require('express');
const crypto = require('crypto');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { v4: uuid } = require('uuid');
const { logAudit } = require('../services/audit');
const { autoSubmitAttempt } = require('./auth');
const { enforceSystemLock } = require('../middleware/systemLock');

const router = Router();
// All exam routes require auth + system lock check (after auth)
router.use(authenticate, enforceSystemLock);

// Crypto-secure 8-digit PIN generator with collision retry
async function generateUniquePin(examId, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const n = crypto.randomInt(10000000, 100000000); // 8 digits
    const pin = String(n);
    const { rows } = await pool.query(
      `SELECT 1 FROM exam_pins WHERE exam_id = $1 AND pin = $2 LIMIT 1`,
      [examId, pin]
    );
    if (rows.length === 0) return pin;
  }
  throw new Error('Failed to generate unique PIN after retries');
}

// List exams
router.get('/', authenticate, async (req, res) => {
  try {
    const { department, status } = req.query;
    let query = `
      SELECT e.*, c.code as course_code, c.title as course_title,
             d.name as dept_name, s.name as school_name,
             (SELECT COUNT(*) FROM exam_pins WHERE exam_id = e.id) as pin_students,
             CASE WHEN e.pin_mode = 'shared' THEN
               (SELECT COUNT(*) FROM users u WHERE u.role = 'student' AND u.department_id = e.department_id AND u.level = e.level)
             ELSE
               (SELECT COUNT(*) FROM exam_pins WHERE exam_id = e.id)
             END as enrolled_students
      FROM exams e
      JOIN courses c ON e.course_id = c.id
      JOIN departments d ON e.department_id = d.id
      JOIN schools s ON e.school_id = s.id WHERE 1=1`;
    const params = [];
    if (department) { params.push(department); query += ` AND d.name = $${params.length}`; }
    if (status) { params.push(status); query += ` AND e.status = $${params.length}`; }
    query += ' ORDER BY e.created_at DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({
      id: r.id, title: r.title, course: r.course_code, courseTitle: r.course_title,
      department: r.dept_name, school: r.school_name, programme: r.programme,
      level: r.level, duration: r.duration, totalQuestions: r.total_questions,
      questionsToAnswer: r.questions_to_answer, totalMarks: parseFloat(r.total_marks),
      startDate: r.start_date, endDate: r.end_date, status: r.status,
      instructions: r.instructions, enrolledStudents: parseInt(r.enrolled_students),
      createdBy: r.created_by, pinMode: r.pin_mode, sharedPin: r.shared_pin,
      examType: r.exam_type || 'exam', caNumber: r.ca_number || 1,
      semester: r.semester || null,
      showResult: r.show_result !== false,
    })));
  } catch (err) {
    console.error('Get exams error:', err);
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
});

// Get single exam
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, c.code as course_code, c.title as course_title,
              d.name as dept_name, s.name as school_name,
              (SELECT COUNT(*) FROM exam_pins WHERE exam_id = e.id) as enrolled_students
       FROM exams e JOIN courses c ON e.course_id = c.id
       JOIN departments d ON e.department_id = d.id JOIN schools s ON e.school_id = s.id
       WHERE e.id = $1`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Exam not found' });
    const r = rows[0];
    let enrolledStudents = parseInt(r.enrolled_students);
    if (r.pin_mode === 'shared') {
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) FROM users WHERE role = 'student' AND department_id = $1 AND level = $2`,
        [r.department_id, r.level]
      );
      enrolledStudents = parseInt(countRows[0].count);
    }
    res.json({
      id: r.id, title: r.title, course: r.course_code, courseTitle: r.course_title,
      department: r.dept_name, school: r.school_name, programme: r.programme,
      level: r.level, duration: r.duration, totalQuestions: r.total_questions,
      questionsToAnswer: r.questions_to_answer, totalMarks: parseFloat(r.total_marks),
      startDate: r.start_date, endDate: r.end_date, status: r.status,
      instructions: r.instructions, enrolledStudents,
      createdBy: r.created_by, pinMode: r.pin_mode, sharedPin: r.shared_pin,
      examType: r.exam_type || 'exam', caNumber: r.ca_number || 1,
      semester: r.semester || null,
      showResult: r.show_result !== false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch exam' });
  }
});

// Create exam — lab_admin CANNOT create
router.post('/', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const {
    title, courseId, departmentId, programme, level, duration,
    totalQuestions, questionsToAnswer, totalMarks, startDate, endDate, instructions,
    carryoverStudentIds, examType, caNumber, semester, showResult,
  } = req.body;

  if (!title || !courseId || !departmentId) {
    return res.status(400).json({ error: 'title, courseId, and departmentId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: courses } = await client.query(
      `SELECT school_id, department_id FROM courses WHERE id = $1`, [courseId]
    );
    if (courses.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Invalid courseId' }); }
    const finalSchoolId = courses[0].school_id;

    const pinMode = req.body.pinMode || 'individual';
    const finalExamType = examType || 'exam';
    const finalCaNumber = caNumber || 1;
    const finalSemester = semester || null;
    const finalShowResult = showResult !== false;
    const finalTotalMarks = parseFloat(totalMarks) || 0;

    // ── Mark allocation guard: CA1 + CA2 + Exam must not exceed 100; weights enforced.
    //    Includes ALL exams (incl. completed) so admins cannot bypass by stopping prior exams.
    const allocParams = [courseId];
    let allocWhere = `course_id = $1`;
    if (level) { allocParams.push(level); allocWhere += ` AND level = $${allocParams.length}`; }
    if (finalSemester) { allocParams.push(finalSemester); allocWhere += ` AND semester = $${allocParams.length}`; }
    if (level) { allocParams.push(level); allocWhere += ` AND level = $${allocParams.length}`; }
    if (finalSemester) { allocParams.push(finalSemester); allocWhere += ` AND semester = $${allocParams.length}`; }

    const { rows: existing } = await client.query(
      `SELECT id, exam_type, ca_number, total_marks FROM exams WHERE ${allocWhere}`,
      allocParams,
    );
    const { rows: courseFull } = await client.query(
      `SELECT ca_weight, exam_weight FROM courses WHERE id = $1`, [courseId],
    );
    const caWeight = parseFloat(courseFull[0]?.ca_weight) || 30;
    const examWeight = parseFloat(courseFull[0]?.exam_weight) || 70;
    let exCa1 = 0, exCa2 = 0, exExam = 0;
    for (const r of existing) {
      const m = parseFloat(r.total_marks) || 0;
      if (r.exam_type === 'ca' && Number(r.ca_number) === 1) exCa1 += m;
      else if (r.exam_type === 'ca' && Number(r.ca_number) === 2) exCa2 += m;
      else if (r.exam_type === 'exam') exExam += m;
    }
    let projCa1 = exCa1, projCa2 = exCa2, projExam = exExam;
    if (finalExamType === 'ca' && Number(finalCaNumber) === 1) projCa1 += finalTotalMarks;
    else if (finalExamType === 'ca' && Number(finalCaNumber) === 2) projCa2 += finalTotalMarks;
    else if (finalExamType === 'exam') projExam += finalTotalMarks;

    if (projCa1 + projCa2 > caWeight) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `CA1 + CA2 (${projCa1 + projCa2}) cannot exceed CA weight of ${caWeight}%` });
    }
    if (projExam > examWeight) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Exam total (${projExam}) cannot exceed Exam weight of ${examWeight}%` });
    }
    if (projCa1 + projCa2 + projExam > 100) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `CA1 + CA2 + Exam total (${projCa1 + projCa2 + projExam}) cannot exceed 100` });
    }

    const { rows } = await client.query(
      `INSERT INTO exams (title, course_id, department_id, school_id, programme, level,
       duration, total_questions, questions_to_answer, total_marks, start_date, end_date,
       instructions, pin_mode, exam_type, ca_number, semester, show_result, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [title, courseId, departmentId, finalSchoolId, programme || null, level || null,
       duration || 45, totalQuestions || 20, questionsToAnswer || 20,
       finalTotalMarks || 40, startDate || null, endDate || null, instructions || null,
       pinMode, finalExamType, finalCaNumber, finalSemester, finalShowResult, req.user.id]
    );
    const examId = rows[0].id;

    const qCount = totalQuestions || 20;
    const { rows: bankQuestions } = await client.query(
      `SELECT id FROM questions WHERE course_id = $1 ORDER BY RANDOM() LIMIT $2`,
      [courseId, qCount]
    );

    for (let i = 0; i < bankQuestions.length; i++) {
      await client.query(
        `INSERT INTO exam_questions (exam_id, question_id, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [examId, bankQuestions[i].id, i + 1]
      );
    }

    if (carryoverStudentIds && carryoverStudentIds.length > 0) {
      for (const sid of carryoverStudentIds) {
        const pin = await generateUniquePin(examId);
        await client.query(
          `INSERT INTO exam_pins (exam_id, student_id, pin) VALUES ($1, $2, $3)
           ON CONFLICT (exam_id, student_id) DO NOTHING`,
          [examId, sid, pin]
        );
      }
    }

    await client.query('COMMIT');
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'Exam Created', category: 'exam', details: `Created exam: ${title}`, ip: req.ip });
    res.status(201).json({ id: examId, questionsAssigned: bankQuestions.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create exam error:', err);
    res.status(500).json({ error: 'Failed to create exam. Please verify the course, department, and exam configuration.' });
  } finally {
    client.release();
  }
});

// Update exam
router.put('/:id', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const { title, courseId, departmentId, schoolId, programme, level, duration,
    totalQuestions, questionsToAnswer, totalMarks, startDate, endDate, instructions, status,
    semester, showResult, examType, caNumber } = req.body;
  try {
    let finalSchoolId = schoolId;
    if (!finalSchoolId && departmentId) {
      const { rows: depts } = await pool.query(`SELECT school_id FROM departments WHERE id = $1`, [departmentId]);
      if (depts.length > 0) finalSchoolId = depts[0].school_id;
    }
    const fields = [
      'title', 'course_id', 'department_id', 'school_id', 'programme', 'level',
      'duration', 'total_questions', 'questions_to_answer', 'total_marks',
      'start_date', 'end_date', 'instructions', 'semester', 'show_result',
      'exam_type', 'ca_number',
    ];
    const values = [
      title, courseId, departmentId, finalSchoolId, programme, level,
      duration, totalQuestions, questionsToAnswer, totalMarks,
      startDate, endDate, instructions,
      semester || null,
      showResult !== false,
      examType || 'exam',
      caNumber || 1,
    ];
    if (status) { fields.push('status'); values.push(status); }
    const setClause = fields.map((f, i) => `${f}=$${i + 1}`).join(', ');
    values.push(req.params.id);
    await pool.query(
      `UPDATE exams SET ${setClause} WHERE id=$${values.length}`,
      values
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Update exam error:', err);
    res.status(500).json({ error: 'Failed to update exam. Please review the values and try again.' });
  }
});

// Delete exam — also writes a tombstone for sync delete-propagation
router.delete('/:id', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM exams WHERE id = $1`, [req.params.id]);
    try {
      await pool.query(
        `INSERT INTO sync_tombstones (table_name, record_id) VALUES ('exams', $1)`,
        [req.params.id]
      );
    } catch { /* tombstones table may not exist on older DB */ }
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'Exam Deleted', category: 'exam', details: `Deleted exam ID: ${req.params.id}`, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete exam' });
  }
});

// Update exam status — lab_admin CAN start/stop
// When stopping (completed), auto-submit ALL active attempts
router.patch('/:id/status', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  const newStatus = req.body.status;
  try {
    await pool.query(`UPDATE exams SET status = $1 WHERE id = $2`, [newStatus, req.params.id]);

    // If stopping the exam, auto-submit all in_progress attempts
    if (newStatus === 'completed') {
      const { rows: activeAttempts } = await pool.query(
        `SELECT id FROM exam_attempts WHERE exam_id = $1 AND status = 'in_progress'`,
        [req.params.id]
      );
      for (const attempt of activeAttempts) {
        await autoSubmitAttempt(attempt.id);
      }
      await logAudit({
        userId: req.user.id, userName: req.user.name, role: req.user.role,
        action: 'Exam Stopped', category: 'exam',
        details: `Stopped exam ${req.params.id}. Auto-submitted ${activeAttempts.length} active attempts.`,
        ip: req.ip,
      });
    } else {
      await logAudit({
        userId: req.user.id, userName: req.user.name, role: req.user.role,
        action: `Exam Status: ${newStatus}`, category: 'exam',
        details: `Changed exam ${req.params.id} status to ${newStatus}`,
        ip: req.ip,
      });
    }

    res.json({ success: true, autoSubmitted: newStatus === 'completed' ? true : false });
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Generate PINs
router.post('/:id/generate-pins', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  const examId = req.params.id;
  const mode = req.body.mode || 'individual';
  try {
    const { rows: exams } = await pool.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
    if (exams.length === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = exams[0];

    if (mode === 'shared') {
      // Crypto-secure 8-digit shared PIN
      const sharedPin = String(crypto.randomInt(10000000, 100000000));
      await pool.query(
        `UPDATE exams SET pin_mode = 'shared', shared_pin = $1 WHERE id = $2`,
        [sharedPin, examId]
      );
      return res.json({
        pins: [{ studentName: 'All Eligible Students', matricNumber: '—', pin: sharedPin }],
        count: 1, mode: 'shared',
      });
    }

    const { rows: students } = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.reg_number FROM users u
       LEFT JOIN exam_pins ep ON ep.student_id = u.id AND ep.exam_id = $1
       WHERE (u.role = 'student' AND u.department_id = $2 AND u.level = $3)
          OR ep.exam_id = $1`,
      [examId, exam.department_id, exam.level]
    );

    if (students.length === 0) return res.json({ pins: [], count: 0, message: 'No eligible students found' });

    const pins = [];
    for (const student of students) {
      const pin = await generateUniquePin(examId);
      await pool.query(
        `INSERT INTO exam_pins (exam_id, student_id, pin) VALUES ($1, $2, $3)
         ON CONFLICT (exam_id, student_id) DO UPDATE SET pin = $3, used = FALSE`,
        [examId, student.id, pin]
      );
      pins.push({ studentName: student.name, matricNumber: student.reg_number, pin });
    }

    await pool.query(`UPDATE exams SET pin_mode = 'individual', shared_pin = NULL WHERE id = $1`, [examId]);
    res.json({ pins, count: pins.length, mode: 'individual' });
  } catch (err) {
    console.error('Generate pins error:', err);
    res.status(500).json({ error: 'Failed to generate pins' });
  }
});

// Get PINs
router.get('/:id/pins', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ep.pin, u.name as student_name, u.reg_number as matric_number, ep.used
       FROM exam_pins ep JOIN users u ON ep.student_id = u.id
       WHERE ep.exam_id = $1 ORDER BY u.name`,
      [req.params.id]
    );
    res.json(rows.map(r => ({
      pin: r.pin, studentName: r.student_name, matricNumber: r.matric_number, used: r.used,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pins' });
  }
});

// Monitoring
router.get('/:id/monitoring', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  try {
    const { rows: examRows } = await pool.query(
      `SELECT e.*, c.code as course_code FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (examRows.length === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = examRows[0];

    const { rows: attempts } = await pool.query(
      `SELECT ea.id, ea.student_id, ea.started_at, ea.status, ea.submitted_at, ea.score,
              ea.device_fingerprint, ea.device_locked_at,
              u.name as student_name, u.reg_number,
              (SELECT COUNT(*) FROM answers WHERE attempt_id = ea.id) as answered_count
       FROM exam_attempts ea JOIN users u ON ea.student_id = u.id
       WHERE ea.exam_id = $1
       ORDER BY ea.started_at DESC NULLS LAST`,
      [req.params.id]
    );

    const now = new Date();
    const students = attempts.map(a => {
      let remainingSeconds = 0;
      if (a.status === 'in_progress' && a.started_at) {
        const startedAt = new Date(a.started_at);
        const elapsedSeconds = Math.floor((now - startedAt) / 1000);
        remainingSeconds = Math.max(0, exam.duration * 60 - elapsedSeconds);
      } else if (a.status === 'in_progress' && !a.started_at) {
        remainingSeconds = exam.duration * 60; // Not yet started
      }
      const progress = exam.questions_to_answer > 0
        ? Math.round((parseInt(a.answered_count) / exam.questions_to_answer) * 100) : 0;

      return {
        attemptId: a.id, studentId: a.student_id, studentName: a.student_name,
        regNumber: a.reg_number, status: a.status, startedAt: a.started_at,
        submittedAt: a.submitted_at, score: a.score ? parseFloat(a.score) : null,
        answeredCount: parseInt(a.answered_count), totalQuestions: exam.questions_to_answer,
        progress, remainingSeconds,
        deviceFingerprint: a.device_fingerprint || null,
        deviceLockedAt: a.device_locked_at || null,
      };
    });

    const activeCount = students.filter(s => s.status === 'in_progress').length;
    const submittedCount = students.filter(s => s.status === 'submitted' || s.status === 'graded').length;

    res.json({
      examId: exam.id, examTitle: exam.title, course: exam.course_code,
      duration: exam.duration, totalQuestions: exam.questions_to_answer,
      activeStudents: activeCount, submittedStudents: submittedCount,
      totalEnrolled: students.length, students,
    });
  } catch (err) {
    console.error('Monitoring error:', err);
    res.status(500).json({ error: 'Failed to fetch monitoring data' });
  }
});

// Reset attempt
router.post('/:id/reset-attempt', authenticate, requireRole('super_admin', 'admin', 'examiner', 'lab_admin'), async (req, res) => {
  const { studentId } = req.body;
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM answers WHERE attempt_id IN (
        SELECT id FROM exam_attempts WHERE exam_id = $1 AND student_id = $2
      )`, [req.params.id, studentId]
    );
    await client.query(
      `DELETE FROM exam_attempts WHERE exam_id = $1 AND student_id = $2`,
      [req.params.id, studentId]
    );
    await client.query(
      `UPDATE exam_pins SET used = FALSE, used_at = NULL WHERE exam_id = $1 AND student_id = $2`,
      [req.params.id, studentId]
    );
    await client.query('COMMIT');
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role, action: 'Exam Reset', category: 'exam', details: `Reset attempt for student ${studentId} on exam ${req.params.id}`, ip: req.ip });
    res.json({ success: true, message: 'Exam attempt reset. Student can retry.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Reset attempt error:', err);
    res.status(500).json({ error: 'Failed to reset attempt' });
  } finally {
    client.release();
  }
});

// Reassign questions
router.post('/:id/assign-questions', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const examId = req.params.id;
  try {
    const { rows: exams } = await pool.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
    if (exams.length === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = exams[0];

    await pool.query(`DELETE FROM exam_questions WHERE exam_id = $1`, [examId]);

    const { rows: bankQuestions } = await pool.query(
      `SELECT id FROM questions WHERE course_id = $1 ORDER BY RANDOM() LIMIT $2`,
      [exam.course_id, exam.total_questions]
    );

    for (let i = 0; i < bankQuestions.length; i++) {
      await pool.query(
        `INSERT INTO exam_questions (exam_id, question_id, sort_order) VALUES ($1, $2, $3)`,
        [examId, bankQuestions[i].id, i + 1]
      );
    }

    res.json({ success: true, assigned: bankQuestions.length });
  } catch (err) {
    console.error('Assign questions error:', err);
    res.status(500).json({ error: 'Failed to assign questions' });
  }
});

// Add carryover students
router.post('/:id/carryover-students', authenticate, requireRole('super_admin', 'admin', 'examiner'), async (req, res) => {
  const { studentIds } = req.body;
  if (!studentIds || !studentIds.length) return res.status(400).json({ error: 'studentIds required' });
  try {
    let added = 0;
    for (const sid of studentIds) {
      const pin = String(Math.floor(10000000 + Math.random() * 90000000));
      const { rowCount } = await pool.query(
        `INSERT INTO exam_pins (exam_id, student_id, pin) VALUES ($1, $2, $3)
         ON CONFLICT (exam_id, student_id) DO NOTHING`,
        [req.params.id, sid, pin]
      );
      if (rowCount > 0) added++;
    }
    res.json({ success: true, added });
  } catch (err) {
    console.error('Carryover error:', err);
    res.status(500).json({ error: 'Failed to add carryover students' });
  }
});

// Get existing mark allocation for a course/level/semester (CA1, CA2, Exam)
// Used by CreateExam dialog to ensure CA1+CA2+Exam total <= 100 and respects course weights
router.get('/allocation/summary', authenticate, async (req, res) => {
  try {
    const { courseId, level, semester, excludeExamId } = req.query;
    if (!courseId) return res.status(400).json({ error: 'courseId is required' });

    const params = [courseId];
    let where = `course_id = $1 AND status != 'completed'`;
    if (level) { params.push(level); where += ` AND level = $${params.length}`; }
    if (semester) { params.push(semester); where += ` AND semester = $${params.length}`; }
    if (excludeExamId) { params.push(excludeExamId); where += ` AND id != $${params.length}`; }

    const { rows: existing } = await pool.query(
      `SELECT id, exam_type, ca_number, total_marks
       FROM exams WHERE ${where}`,
      params,
    );

    const { rows: courseRows } = await pool.query(
      `SELECT ca_weight, exam_weight, max_cas FROM courses WHERE id = $1`,
      [courseId],
    );
    const course = courseRows[0] || { ca_weight: 30, exam_weight: 70, max_cas: 2 };

    let ca1 = 0, ca2 = 0, examMarks = 0;
    let ca1ExamId = null, ca2ExamId = null, examExamId = null;
    for (const r of existing) {
      const m = parseFloat(r.total_marks) || 0;
      if (r.exam_type === 'ca' && Number(r.ca_number) === 1) { ca1 += m; ca1ExamId = r.id; }
      else if (r.exam_type === 'ca' && Number(r.ca_number) === 2) { ca2 += m; ca2ExamId = r.id; }
      else if (r.exam_type === 'exam') { examMarks += m; examExamId = r.id; }
    }

    res.json({
      caWeight: parseFloat(course.ca_weight) || 30,
      examWeight: parseFloat(course.exam_weight) || 70,
      maxCas: parseInt(course.max_cas) || 2,
      existing: { ca1, ca2, exam: examMarks },
      existingIds: { ca1: ca1ExamId, ca2: ca2ExamId, exam: examExamId },
      total: ca1 + ca2 + examMarks,
    });
  } catch (err) {
    console.error('Allocation summary error:', err);
    res.status(500).json({ error: 'Failed to fetch allocation summary' });
  }
});

module.exports = router;
