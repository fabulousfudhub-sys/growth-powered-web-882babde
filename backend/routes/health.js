const { Router } = require('express');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { getSyncStatus, checkOnlineConnectivity } = require('../services/sync');
const { getCachedLicense } = require('../license/license');
const os = require('os');

const router = Router();

// System health overview — super_admin / admin only
router.get('/', authenticate, requireRole('super_admin', 'admin'), async (_req, res) => {
  const out = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    node: process.version,
    memory: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
      systemFreeMb: Math.round(os.freemem() / 1024 / 1024),
      systemTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    },
    cpu: { loadAvg: os.loadavg(), cores: os.cpus().length },
    db: { reachable: false, latencyMs: null, pool: null },
    sync: null,
    license: { active: false, expiresAt: null, daysRemaining: null },
    backups: { last: null, count: 0 },
    pendingEssayGrading: 0,
    activeExams: 0,
    activeAttempts: 0,
  };

  // DB latency
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    out.db.reachable = true;
    out.db.latencyMs = Date.now() - t0;
    out.db.pool = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
  } catch (e) {
    out.db.error = e.message;
  }

  // Sync
  try {
    out.sync = await getSyncStatus();
  } catch (e) {
    out.sync = { error: e.message };
  }

  // License
  try {
    const lic = await getCachedLicense();
    if (lic) {
      out.license.active = true;
      if (lic.expiresAt) {
        out.license.expiresAt = lic.expiresAt;
        const days = Math.ceil((new Date(lic.expiresAt).getTime() - Date.now()) / 86400000);
        out.license.daysRemaining = days;
      }
    }
  } catch { /* ignore */ }

  // Backups
  try {
    const { rows } = await pool.query(
      `SELECT created_at, filename, size_bytes, status FROM backups ORDER BY created_at DESC LIMIT 1`
    );
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM backups`);
    out.backups.last = rows[0] || null;
    out.backups.count = parseInt(countRows[0].count, 10);
  } catch { /* table may not exist */ }

  // Active exams + attempts
  try {
    const { rows: ae } = await pool.query(`SELECT COUNT(*) FROM exams WHERE status='active'`);
    out.activeExams = parseInt(ae[0].count, 10);
    const { rows: aa } = await pool.query(`SELECT COUNT(*) FROM exam_attempts WHERE status='in_progress'`);
    out.activeAttempts = parseInt(aa[0].count, 10);
    const { rows: pg } = await pool.query(
      `SELECT COUNT(*) FROM answers WHERE requires_grading = TRUE AND essay_score IS NULL`
    );
    out.pendingEssayGrading = parseInt(pg[0].count, 10);
  } catch { /* ignore */ }

  res.json(out);
});

module.exports = router;
