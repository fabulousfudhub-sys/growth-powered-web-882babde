const { Router } = require('express');
const { pool, getDbInfo } = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { resetSystemLockCache } = require('../middleware/systemLock');
const { invalidateSyncConfigCache } = require('../services/sync');

const router = Router();

// Get site settings (public - no auth needed for branding)
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    res.json(rows.length > 0 ? rows[0].settings : {});
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update site settings (super_admin only)
router.put('/', authenticate, requireRole('super_admin'), async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Invalid settings object' });
  }
  try {
    await pool.query(
      `INSERT INTO site_settings (id, settings, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET settings = $1, updated_at = NOW()`,
      [JSON.stringify(settings)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Save settings error:', err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Get system status (lock + deactivation)
router.get('/system-status', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    const settings = rows.length > 0 ? rows[0].settings : {};
    res.json({
      locked: settings.systemLocked || false,
      deactivated: settings.systemDeactivated || false,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch system status' });
  }
});

// Set system lock (super_admin/admin)
router.post('/system-lock', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { locked } = req.body;
  try {
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    const current = rows.length > 0 ? rows[0].settings : {};
    current.systemLocked = !!locked;
    await pool.query(
      `INSERT INTO site_settings (id, settings, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET settings = $1, updated_at = NOW()`,
      [JSON.stringify(current)]
    );
    res.json({ success: true, locked: !!locked });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update system lock' });
  }
});

// Set system active/deactivated (super_admin ONLY — license toggle)
router.post('/system-active', authenticate, requireRole('super_admin'), async (req, res) => {
  const { active } = req.body;
  try {
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    const current = rows.length > 0 ? rows[0].settings : {};
    current.systemDeactivated = !active;
    await pool.query(
      `INSERT INTO site_settings (id, settings, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET settings = $1, updated_at = NOW()`,
      [JSON.stringify(current)]
    );
    res.json({ success: true, deactivated: !active });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update system status' });
  }
});

// ── Sync Configuration ──

// Get current DB and sync configuration
router.get('/db-config', authenticate, requireRole('super_admin'), async (_req, res) => {
  try {
    const dbInfo = getDbInfo();
    // Get sync config from site_settings
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    const settings = rows.length > 0 ? rows[0].settings : {};
    
    res.json({
      primary: {
        host: dbInfo.host,
        port: dbInfo.port,
        database: dbInfo.database,
        user: dbInfo.user,
        ssl: dbInfo.ssl,
        type: dbInfo.type,
        isLocal: dbInfo.isLocal,
      },
      sync: {
        onlineDbHost: process.env.ONLINE_DB_HOST || settings.syncOnlineDbHost || '',
        onlineDbPort: parseInt(process.env.ONLINE_DB_PORT || settings.syncOnlineDbPort || '5432'),
        onlineDbName: process.env.ONLINE_DB_NAME || settings.syncOnlineDbName || 'postgres',
        onlineDbUser: process.env.ONLINE_DB_USER || settings.syncOnlineDbUser || 'postgres',
        onlineDbSsl: process.env.ONLINE_DB_SSL !== 'false',
        syncInterval: parseInt(process.env.SYNC_INTERVAL || settings.syncInterval || '18000000'),
        autoSync: settings.autoSync || false,
        configured: !!(process.env.ONLINE_DB_HOST || settings.syncOnlineDbHost),
      },
    });
  } catch (err) {
    console.error('Get db-config error:', err);
    res.status(500).json({ error: 'Failed to fetch database configuration' });
  }
});

// Save sync configuration to site_settings (so it persists without .env changes)
router.put('/sync-config', authenticate, requireRole('super_admin'), async (req, res) => {
  const { onlineDbHost, onlineDbPort, onlineDbName, onlineDbUser, onlineDbPassword, onlineDbSsl, syncInterval, autoSync } = req.body;
  
  if (onlineDbHost && typeof onlineDbHost !== 'string') {
    return res.status(400).json({ error: 'Invalid database host' });
  }

  try {
    const { rows } = await pool.query(`SELECT settings FROM site_settings WHERE id = 1`);
    const current = rows.length > 0 ? rows[0].settings : {};
    
    // Store sync config in settings
    current.syncOnlineDbHost = onlineDbHost || '';
    current.syncOnlineDbPort = onlineDbPort || '5432';
    current.syncOnlineDbName = onlineDbName || 'postgres';
    current.syncOnlineDbUser = onlineDbUser || 'postgres';
    if (onlineDbPassword) current.syncOnlineDbPassword = onlineDbPassword; // Only update if provided
    current.syncOnlineDbSsl = onlineDbSsl !== false;
    current.syncInterval = syncInterval || 18000000;
    current.autoSync = !!autoSync;
    
    await pool.query(
      `INSERT INTO site_settings (id, settings, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET settings = $1, updated_at = NOW()`,
      [JSON.stringify(current)]
    );
    
    res.json({ success: true, message: 'Sync configuration saved. Restart the server or trigger a sync to apply.' });
  } catch (err) {
    console.error('Save sync-config error:', err);
    res.status(500).json({ error: 'Failed to save sync configuration' });
  }
});

// Test sync connection
router.post('/test-sync-connection', authenticate, requireRole('super_admin'), async (req, res) => {
  const { host, port, database, user, password, ssl } = req.body;
  
  if (!host) return res.status(400).json({ error: 'Database host is required' });
  
  const { Pool: PgPool } = require('pg');
  const testPool = new PgPool({
    host, port: parseInt(port || '5432'), database: database || 'postgres',
    user: user || 'postgres', password: password || '',
    ssl: ssl !== false ? { rejectUnauthorized: false } : false,
    max: 1, connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await testPool.connect();
    const { rows } = await client.query('SELECT NOW() AS time, current_database() AS db');
    client.release();
    await testPool.end();
    res.json({ success: true, time: rows[0].time, database: rows[0].db });
  } catch (err) {
    try { await testPool.end(); } catch {}
    res.status(400).json({ error: `Connection failed: ${err.message}` });
  }
});

module.exports = router;
