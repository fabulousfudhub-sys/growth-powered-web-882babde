const express = require('express');
const path = require('path');
const cors = require('cors');
const { pool, testConnection } = require('./db/pool');
const authRoutes = require('./routes/auth');
const examRoutes = require('./routes/exams');
const questionRoutes = require('./routes/questions');
const answerRoutes = require('./routes/answers');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');
const importRoutes = require('./routes/import');
const settingsRoutes = require('./routes/settings');
const uploadRoutes = require('./routes/uploads');
const licenseRoutes = require('./routes/license');
const { startSyncService } = require('./services/sync');
const { autoSubmitAttempt } = require('./routes/auth');
const { enforceSystemLock } = require('./middleware/systemLock');
const { getCachedLicense } = require('./license/license');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json({ limit: '10mb' }));

// CORS — restrict origins in production via ALLOWED_ORIGINS env
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  credentials: true,
}));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// NOTE: enforceSystemLock is applied per-route AFTER `authenticate`
// (mounted inside individual route files) so that login endpoints stay reachable.

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString(), connections: pool.totalCount });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/answers', answerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/import', importRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/license', licenseRoutes);

// Serve frontend build
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.stack || err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Exam Scheduler: auto-activate/complete exams based on start_date/end_date ──
// Uses Nigeria Time (WAT = UTC+1) — all dates stored as TIMESTAMPTZ
async function runExamScheduler() {
  try {
    // Activate scheduled exams whose start_date has passed
    const { rowCount: activated } = await pool.query(
      `UPDATE exams SET status = 'active'
       WHERE status IN ('draft', 'scheduled') AND start_date IS NOT NULL AND start_date <= NOW()`
    );
    if (activated > 0) console.log(`[SCHEDULER] Activated ${activated} exam(s)`);

    // Complete active exams whose end_date has passed
    const { rows: expiredExams } = await pool.query(
      `SELECT id FROM exams WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= NOW()`
    );
    for (const exam of expiredExams) {
      // Auto-submit all in-progress attempts
      const { rows: activeAttempts } = await pool.query(
        `SELECT id FROM exam_attempts WHERE exam_id = $1 AND status = 'in_progress'`,
        [exam.id]
      );
      for (const attempt of activeAttempts) {
        await autoSubmitAttempt(attempt.id);
      }
      await pool.query(`UPDATE exams SET status = 'completed' WHERE id = $1`, [exam.id]);
    }
    if (expiredExams.length > 0) console.log(`[SCHEDULER] Completed ${expiredExams.length} exam(s)`);

    // Auto-submit attempts where timer has elapsed (safety net)
    const { rows: timedOutAttempts } = await pool.query(
      `SELECT ea.id FROM exam_attempts ea
       JOIN exams e ON ea.exam_id = e.id
       WHERE ea.status = 'in_progress' AND ea.started_at IS NOT NULL
         AND (NOW() - ea.started_at) > (e.duration * interval '1 minute')`
    );
    for (const attempt of timedOutAttempts) {
      await autoSubmitAttempt(attempt.id);
    }
    if (timedOutAttempts.length > 0) console.log(`[SCHEDULER] Auto-submitted ${timedOutAttempts.length} timed-out attempt(s)`);
  } catch (err) {
    console.error('[SCHEDULER] Error:', err.message);
  }
}

// async function start() {
//   await testConnection();
//   app.listen(PORT, '0.0.0.0', () => {
//     console.log(`\n🎓 ATAPOLY CBT Server running on http://0.0.0.0:${PORT}`);
//     console.log(`   Clients connect via: http://<HOST_IP>:${PORT}`);
//     console.log(`   Max pool size: ${pool.options?.max || 100} connections\n`);
//   });
//   // Start background sync
//   startSyncService();
//   // Run exam scheduler every 30 seconds
//   setInterval(runExamScheduler, 30000);
//   runExamScheduler(); // Run immediately on start
// }



async function start() {
  // 🔒 LICENSE CHECK FIRST
  const licenseKey = getCachedLicense();

  if (!licenseKey) {
    console.error("\n❌ No valid license found. CBT is LOCKED.");
    console.error("👉 Please activate the system with a valid license.\n");
    process.exit(1);
  }

  console.log("✅ License valid. Starting CBT server...\n");

  // Continue normal startup
  await testConnection();
  try {
    const { runMigrations } = require('./db/migrate');
    await runMigrations();
  } catch (e) {
    console.warn('[MIGRATE] error:', e.message);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎓 ATAPOLY CBT Server running on http://0.0.0.0:${PORT}`);
    console.log(`   Clients connect via: http://<HOST_IP>:${PORT}`);
    console.log(`   Max pool size: ${pool.options?.max || 100} connections\n`);
  });

  // Background services
  startSyncService();

  setInterval(runExamScheduler, 30000);
  runExamScheduler();
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
