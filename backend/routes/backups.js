const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit } = require('../services/audit');

const router = Router();

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

function ensureBackupDir() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (e) {
    console.warn('[BACKUP] cannot create dir:', e.message);
  }
}

// Pure-SQL backup (works on any Postgres, no pg_dump required)
async function performBackup(triggeredBy = 'auto') {
  ensureBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `cbt-backup-${ts}.json`;
  const filepath = path.join(BACKUP_DIR, filename);

  const TABLES = [
    'schools', 'departments', 'users', 'courses', 'questions',
    'exams', 'exam_questions', 'exam_pins', 'exam_attempts', 'answers', 'site_settings',
  ];

  const dump = { meta: { exportedAt: new Date().toISOString(), version: 1 }, tables: {} };
  let totalRows = 0;

  try {
    for (const t of TABLES) {
      try {
        const { rows } = await pool.query(`SELECT * FROM ${t}`);
        dump.tables[t] = rows;
        totalRows += rows.length;
      } catch (e) {
        dump.tables[t] = { error: e.message };
      }
    }
    fs.writeFileSync(filepath, JSON.stringify(dump));
    const stat = fs.statSync(filepath);

    await pool.query(
      `INSERT INTO backups (filename, size_bytes, table_count, row_count, status, triggered_by)
       VALUES ($1, $2, $3, $4, 'completed', $5)`,
      [filename, stat.size, TABLES.length, totalRows, triggeredBy]
    );

    // Retain only last 7 backups locally
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('cbt-backup-') && f.endsWith('.json'))
        .map(f => ({ f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
        .sort((a, b) => b.mtime - a.mtime);
      for (const old of files.slice(7)) {
        fs.unlinkSync(path.join(BACKUP_DIR, old.f));
      }
    } catch { /* retention errors are non-fatal */ }

    return { ok: true, filename, sizeBytes: stat.size, rowCount: totalRows };
  } catch (err) {
    try {
      await pool.query(
        `INSERT INTO backups (filename, status, error_message, triggered_by)
         VALUES ($1, 'failed', $2, $3)`,
        [filename, err.message, triggeredBy]
      );
    } catch { /* ignore */ }
    throw err;
  }
}

// List backups
router.get('/', authenticate, requireRole('super_admin', 'admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, size_bytes, table_count, row_count, status,
              error_message, triggered_by, created_at
       FROM backups ORDER BY created_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch {
    res.json([]);
  }
});

// Trigger manual backup
router.post('/trigger', authenticate, requireRole('super_admin'), async (req, res) => {
  try {
    const result = await performBackup('manual');
    await logAudit({ userId: req.user.id, userName: req.user.name, role: req.user.role,
      action: 'Backup Created', category: 'system', details: `Manual backup ${result.filename}`, ip: req.ip });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Backup failed', message: err.message });
  }
});

// Download a backup file
router.get('/download/:filename', authenticate, requireRole('super_admin'), (req, res) => {
  const safe = path.basename(req.params.filename);
  const fp = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Backup not found' });
  res.download(fp, safe);
});

// Background nightly auto-backup at 02:00 server time
function startAutoBackup() {
  console.log('[BACKUP] Auto-backup service enabled (daily 02:00 + on-demand)');
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 2 && now.getMinutes() < 5) {
      try {
        const last = await pool.query(
          `SELECT created_at FROM backups WHERE created_at > NOW() - INTERVAL '23 hours' LIMIT 1`
        );
        if (last.rows.length === 0) {
          console.log('[BACKUP] Running nightly auto-backup');
          await performBackup('auto');
        }
      } catch (e) {
        console.warn('[BACKUP] auto-backup error:', e.message);
      }
    }
  }, 60000); // check every minute
}

module.exports = router;
module.exports.startAutoBackup = startAutoBackup;
module.exports.performBackup = performBackup;
