const { pool } = require('../db/pool');
const { Pool } = require('pg');

// ── Configuration ──
// For ONLINE mode: Express connects directly to Supabase PostgreSQL
// ONLINE_DB_* = Supabase DB credentials (used for sync)
// SYNC_SECRET = shared secret for server-to-server authentication
const ONLINE_DB_HOST = process.env.ONLINE_DB_HOST || 'aws-1-eu-west-1.pooler.supabase.com';
const ONLINE_DB_PORT = parseInt(process.env.ONLINE_DB_PORT || '6543');
const ONLINE_DB_NAME = process.env.ONLINE_DB_NAME || 'postgres';
const ONLINE_DB_USER = process.env.ONLINE_DB_USER || 'postgres.ihgcgmyjvnexaqcluoay';
const ONLINE_DB_PASSWORD = process.env.ONLINE_DB_PASSWORD || 'atapolycbt26';
const ONLINE_DB_SSL = process.env.ONLINE_DB_SSL !== 'false'; // default true for Supabase

const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL || '18000000'); // 5hrs
const SYNC_BATCH_SIZE = 200;
const SYNC_SECRET = process.env.SYNC_SECRET || '';

let isSyncing = false;
let syncTimer = null;
let onlinePool = null;

function getOnlinePool() {
  if (!ONLINE_DB_HOST) return null;
  if (onlinePool) return onlinePool;

  onlinePool = new Pool({
    host: ONLINE_DB_HOST,
    port: ONLINE_DB_PORT,
    database: ONLINE_DB_NAME,
    user: ONLINE_DB_USER,
    password: ONLINE_DB_PASSWORD,
    ssl: ONLINE_DB_SSL ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  onlinePool.on('error', (err) => {
    console.error('[SYNC POOL ERROR]', err.message);
  });

  return onlinePool;
}

const SYNC_TABLES = [
  'schools',
  'departments',
  'users',
  'courses',
  'questions',
  'exams',
  'exam_questions',
  'exam_pins',
  'exam_attempts',
  'answers',
  'site_settings',
];

const LOCKED_DURING_EXAM = ['questions', 'exam_questions'];

const TABLE_TS_COLUMN = {
  answers: 'saved_at',
  exam_attempts: 'created_at',
  exam_pins: 'used_at',
  site_settings: 'updated_at',
};

const TABLE_JSON_COLUMNS = {
  questions: new Set(['options', 'correct_answer']),
  site_settings: new Set(['settings']),
};

const TABLES_WITH_SYNC_FLAG = new Set([
  'schools', 'departments', 'users', 'courses',
  'questions', 'exams', 'exam_attempts', 'answers',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Tables with composite PK
const COMPOSITE_PK_TABLES = { exam_questions: ['exam_id', 'question_id'] };

const HAS_UPDATED_AT = new Set([
  'exams', 'questions', 'users', 'courses', 'departments', 'schools', 'site_settings',
]);

function getTsColumn(tableName) {
  return TABLE_TS_COLUMN[tableName] || 'updated_at';
}

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

function toDbValue(tableName, columnName, value) {
  if (value === undefined) return undefined;
  const jsonCols = TABLE_JSON_COLUMNS[tableName];
  if (jsonCols?.has(columnName)) {
    if (value === null) return null;
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  return value;
}

function hasSyncedFlag(tableName) {
  return TABLES_WITH_SYNC_FLAG.has(tableName);
}

function toMs(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// ── Connectivity Check (direct DB ping) ──
async function checkOnlineConnectivity() {
  const remote = getOnlinePool();
  if (!remote) return false;
  try {
    const client = await remote.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
}

// ── Sync log helpers ──
async function getLastSuccessfulSync(client, tableName, operation) {
  const { rows } = await client.query(
    `SELECT MAX(synced_at) AS ts FROM sync_log WHERE table_name = $1 AND operation = $2 AND status = 'synced'`,
    [tableName, operation],
  );
  return rows[0]?.ts || null;
}

async function logSyncSuccess(client, tableName, operation, recordIds = []) {
  const uuidIds = recordIds.filter(isUuid);
  if (uuidIds.length > 0) {
    await client.query(
      `INSERT INTO sync_log (table_name, record_id, operation, status, synced_at, attempted_at)
       SELECT $1, id, $2, 'synced', NOW(), NOW() FROM unnest($3::uuid[]) AS id`,
      [tableName, operation, uuidIds],
    );
    return;
  }
  await client.query(
    `INSERT INTO sync_log (table_name, record_id, operation, status, synced_at, attempted_at)
     VALUES ($1, gen_random_uuid(), $2, 'synced', NOW(), NOW())`,
    [tableName, operation],
  );
}

async function logSyncFailure(client, tableName, operation, errorMessage) {
  await client.query(
    `INSERT INTO sync_log (table_name, record_id, operation, status, error_message, attempted_at)
     VALUES ($1, gen_random_uuid(), $2, 'failed', $3, NOW())`,
    [tableName, operation, errorMessage?.slice(0, 2000) || 'Unknown sync error'],
  );
}

// ── Push candidate selectors ──
async function getPushCandidates(client, tableName, limit) {
  if (hasSyncedFlag(tableName)) {
    const tsCol = getTsColumn(tableName);
    try {
      const { rows } = await client.query(
        `SELECT * FROM ${tableName} WHERE synced = FALSE ORDER BY ${tsCol} ASC NULLS FIRST LIMIT $1`,
        [limit],
      );
      return rows;
    } catch {
      return [];
    }
  }

  if (tableName === 'exam_pins') {
    const { rows } = await client.query(
      `SELECT ep.* FROM exam_pins ep
       LEFT JOIN (
         SELECT record_id, MAX(synced_at) AS last_pushed
         FROM sync_log WHERE table_name = 'exam_pins' AND operation = 'PUSH' AND status = 'synced'
         GROUP BY record_id
       ) pushed ON pushed.record_id = ep.id
       WHERE pushed.record_id IS NULL
          OR (ep.used_at IS NOT NULL AND (pushed.last_pushed IS NULL OR ep.used_at > pushed.last_pushed))
       ORDER BY ep.id ASC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  if (tableName === 'site_settings') {
    const lastPush = await getLastSuccessfulSync(client, tableName, 'PUSH');
    const { rows } = await client.query(
      `SELECT * FROM site_settings WHERE id = 1 AND ($1::timestamptz IS NULL OR updated_at > $1) LIMIT 1`,
      [lastPush],
    );
    return rows;
  }

  if (tableName === 'exam_questions') {
    const lastPush = await getLastSuccessfulSync(client, tableName, 'PUSH');
    if (!lastPush) {
      const { rows } = await client.query(`SELECT * FROM exam_questions LIMIT $1`, [limit]);
      return rows;
    }
    return [];
  }

  return [];
}

async function markAsSynced(client, tableName, ids) {
  if (!hasSyncedFlag(tableName) || ids.length === 0) return;
  await client.query(
    `UPDATE ${tableName} SET synced = TRUE WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

// ── PUSH: Write records directly to Supabase DB ──
async function pushRecordsToOnline(remoteClient, tableName, records) {
  const compositePK = COMPOSITE_PK_TABLES[tableName];
  const hasUpdatedAt = HAS_UPDATED_AT.has(tableName);
  let upserted = 0;
  let skipped = 0;

  for (const record of records) {
    try {
      if (compositePK) {
        const hasAllKeys = compositePK.every(k => record[k]);
        if (!hasAllKeys) { skipped++; continue; }

        // Check if exists
        const { rows } = await remoteClient.query(
          `SELECT 1 FROM ${tableName} WHERE ${compositePK.map((k, i) => `${k} = $${i + 1}`).join(' AND ')}`,
          compositePK.map(k => record[k]),
        );
        if (rows.length === 0) {
          const entries = Object.entries(record).filter(([, v]) => v !== undefined);
          const cols = entries.map(([c]) => c);
          const values = entries.map(([c, v]) => toDbValue(tableName, c, v));
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          await remoteClient.query(
            `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${compositePK.join(', ')}) DO NOTHING`,
            values,
          );
          upserted++;
        } else {
          skipped++;
        }
        continue;
      }

      if (!record.id) { skipped++; continue; }

      // Conflict resolution: last-write-wins based on updated_at
      if (hasUpdatedAt) {
        const { rows: existing } = await remoteClient.query(
          `SELECT updated_at FROM ${tableName} WHERE id = $1`,
          [record.id],
        );
        if (existing[0]?.updated_at && record.updated_at) {
          const remoteTs = new Date(existing[0].updated_at).getTime();
          const localTs = new Date(record.updated_at).getTime();
          if (remoteTs > localTs) { skipped++; continue; }
        }
      }

      // Upsert
      const entries = Object.entries(record).filter(([, v]) => v !== undefined);
      const cols = entries.map(([c]) => c);
      const values = entries.map(([c, v]) => toDbValue(tableName, c, v));
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const updateSets = cols.filter(c => c !== 'id').map((c, i) => {
        const idx = cols.indexOf(c);
        return `${c} = $${idx + 1}`;
      }).join(', ');

      if (updateSets) {
        await remoteClient.query(
          `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${updateSets}`,
          values,
        );
      } else {
        await remoteClient.query(
          `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          values,
        );
      }
      upserted++;
    } catch (err) {
      console.error(`[SYNC PUSH] Error for ${tableName}/${record?.id || 'composite'}:`, err.message);
      skipped++;
    }
  }

  return { upserted, skipped };
}

// ── PULL: Read records from Supabase DB ──
async function pullRecordsFromOnline(remoteClient, tableName, since) {
  const tsCol = getTsColumn(tableName);
  const compositePK = COMPOSITE_PK_TABLES[tableName];

  let query, params;

  if (compositePK) {
    query = `SELECT * FROM ${tableName} ORDER BY ${compositePK[0]} ASC LIMIT $1`;
    params = [1000];
  } else if (since) {
    query = `SELECT * FROM ${tableName} WHERE ${tsCol} > $1 ORDER BY ${tsCol} ASC LIMIT $2`;
    params = [since, 1000];
  } else {
    query = `SELECT * FROM ${tableName} ORDER BY ${tsCol} ASC NULLS FIRST LIMIT $1`;
    params = [1000];
  }

  const { rows } = await remoteClient.query(query, params);
  return rows;
}

// ── Merge conflict resolution (pull into local) ──
async function mergeRecords(client, tableName, remoteRecords) {
  let merged = 0;
  let skipped = 0;
  const isComposite = tableName === 'exam_questions';

  for (const remote of remoteRecords) {
    try {
      if (isComposite) {
        if (!remote?.exam_id || !remote?.question_id) { skipped++; continue; }
        const { rows } = await client.query(
          `SELECT 1 FROM exam_questions WHERE exam_id = $1 AND question_id = $2`,
          [remote.exam_id, remote.question_id],
        );
        if (rows.length === 0) {
          const entries = Object.entries(remote).filter(([, v]) => v !== undefined);
          const cols = entries.map(([c]) => c);
          const values = entries.map(([c, v]) => toDbValue(tableName, c, v));
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO exam_questions (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (exam_id, question_id) DO NOTHING`,
            values,
          );
          merged++;
        } else {
          skipped++;
        }
        continue;
      }

      if (!remote?.id) { skipped++; continue; }

      const { rows: localRows } = await client.query(
        `SELECT * FROM ${tableName} WHERE id = $1`, [remote.id],
      );
      const local = localRows[0];
      const tsCol = getTsColumn(tableName);
      const remoteTs = toMs(remote[tsCol]);
      const localTs = toMs(local?.[tsCol]);

      // Last-write-wins conflict resolution
      if (local && remoteTs > 0 && localTs > remoteTs) { skipped++; continue; }

      if (!local) {
        const entries = Object.entries(remote).filter(([, v]) => v !== undefined);
        if (entries.length === 0) { skipped++; continue; }
        const cols = entries.map(([c]) => c);
        const values = entries.map(([c, v]) => toDbValue(tableName, c, v));
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          values,
        );
        merged++;
        continue;
      }

      const cols = Object.keys(remote).filter(c => c !== 'id' && remote[c] !== undefined);
      if (cols.length === 0) { skipped++; continue; }
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const values = [remote.id, ...cols.map(c => toDbValue(tableName, c, remote[c]))];
      await client.query(`UPDATE ${tableName} SET ${sets} WHERE id = $1`, values);
      merged++;
    } catch (err) {
      console.error(`[SYNC MERGE] Error for ${tableName}/${remote?.id || 'composite'}:`, err.message);
      skipped++;
    }
  }

  return { merged, skipped };
}

// ── Check active exam lock ──
async function isTableLockedForExam(client, tableName) {
  if (!LOCKED_DURING_EXAM.includes(tableName)) return false;
  try {
    const { rows } = await client.query(`SELECT COUNT(*) FROM exams WHERE status = 'active'`);
    return parseInt(rows[0].count, 10) > 0;
  } catch {
    return false;
  }
}

// ── Push Only ──
async function pushOnly() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;
  const results = { pushed: 0, failed: 0, tables: {} };

  try {
    const remote = getOnlinePool();
    if (!remote) return { status: 'not_configured', ...results };

    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) return { status: 'offline', ...results };

    const localClient = await pool.connect();
    const remoteClient = await remote.connect();

    try {
      for (const tableName of SYNC_TABLES) {
        const records = await getPushCandidates(localClient, tableName, SYNC_BATCH_SIZE);
        if (records.length === 0) continue;

        try {
          const { upserted, skipped } = await pushRecordsToOnline(remoteClient, tableName, records);
          const ids = records.map(r => r.id).filter(Boolean);
          await markAsSynced(localClient, tableName, ids.filter(isUuid));

          results.pushed += upserted;
          results.tables[tableName] = { pushed: upserted, skipped };
          await logSyncSuccess(localClient, tableName, 'PUSH', ids);
        } catch (err) {
          results.failed += records.length;
          results.tables[tableName] = { pushFailed: records.length, error: err.message };
          await logSyncFailure(localClient, tableName, 'PUSH', err.message);
        }
      }
    } finally {
      localClient.release();
      remoteClient.release();
    }

    return { status: results.failed > 0 ? 'partial' : 'completed', ...results };
  } catch (err) {
    return { status: 'error', error: err.message, ...results };
  } finally {
    isSyncing = false;
  }
}

// ── Pull Only ──
async function pullOnly() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;
  const results = { pulled: 0, tables: {} };

  try {
    const remote = getOnlinePool();
    if (!remote) return { status: 'not_configured', ...results };

    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) return { status: 'offline', ...results };

    const localClient = await pool.connect();
    const remoteClient = await remote.connect();

    try {
      for (const tableName of SYNC_TABLES) {
        const locked = await isTableLockedForExam(localClient, tableName);
        if (locked) {
          results.tables[tableName] = { pullSkipped: 'locked' };
          continue;
        }

        try {
          const since = await getLastSuccessfulSync(localClient, tableName, 'PULL');
          const remoteRecords = await pullRecordsFromOnline(remoteClient, tableName, since);

          if (!remoteRecords || remoteRecords.length === 0) continue;

          const { merged, skipped } = await mergeRecords(localClient, tableName, remoteRecords);
          results.pulled += merged;
          results.tables[tableName] = { pulled: merged, pullSkipped: skipped };
          await logSyncSuccess(localClient, tableName, 'PULL');
        } catch (err) {
          results.tables[tableName] = { pullError: err.message };
          await logSyncFailure(localClient, tableName, 'PULL', err.message);
        }
      }
    } finally {
      localClient.release();
      remoteClient.release();
    }

    return { status: 'completed', ...results };
  } catch (err) {
    return { status: 'error', error: err.message, ...results };
  } finally {
    isSyncing = false;
  }
}

// ── Main Sync (2-way) ──
async function syncNow() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;
  const results = { pushed: 0, pulled: 0, failed: 0, tables: {} };

  try {
    const remote = getOnlinePool();
    if (!remote) return { status: 'not_configured', ...results };

    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) return { status: 'offline', ...results };

    console.log('[SYNC] Starting 2-way sync via direct DB connection...');
    const localClient = await pool.connect();
    const remoteClient = await remote.connect();

    try {
      // PUSH: Local → Online
      for (const tableName of SYNC_TABLES) {
        const records = await getPushCandidates(localClient, tableName, SYNC_BATCH_SIZE);
        if (records.length === 0) continue;

        try {
          const { upserted, skipped } = await pushRecordsToOnline(remoteClient, tableName, records);
          const ids = records.map(r => r.id).filter(Boolean);
          await markAsSynced(localClient, tableName, ids.filter(isUuid));

          results.pushed += upserted;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pushed: upserted,
          };
          await logSyncSuccess(localClient, tableName, 'PUSH', ids);
        } catch (err) {
          results.failed += records.length;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pushFailed: records.length, error: err.message,
          };
          await logSyncFailure(localClient, tableName, 'PUSH', err.message);
        }
      }

      // PULL: Online → Local
      for (const tableName of SYNC_TABLES) {
        const locked = await isTableLockedForExam(localClient, tableName);
        if (locked) {
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pullSkipped: 'locked',
          };
          continue;
        }

        try {
          const since = await getLastSuccessfulSync(localClient, tableName, 'PULL');
          const remoteRecords = await pullRecordsFromOnline(remoteClient, tableName, since);

          if (!remoteRecords || remoteRecords.length === 0) continue;

          const { merged, skipped } = await mergeRecords(localClient, tableName, remoteRecords);
          results.pulled += merged;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pulled: merged, pullSkipped: skipped,
          };
          await logSyncSuccess(localClient, tableName, 'PULL');
        } catch (err) {
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pullError: err.message,
          };
          await logSyncFailure(localClient, tableName, 'PULL', err.message);
        }
      }
    } finally {
      localClient.release();
      remoteClient.release();
    }

    const totalPending = await getPendingCount();
    return { status: results.failed > 0 ? 'partial' : 'completed', ...results, totalPending };
  } catch (err) {
    return { status: 'error', error: err.message, ...results };
  } finally {
    isSyncing = false;
  }
}

async function getPendingCount() {
  try {
    let total = 0;
    for (const table of SYNC_TABLES) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE synced = FALSE`);
        total += parseInt(rows[0].count, 10);
      } catch { /* table may not have synced column */ }
    }
    return total;
  } catch {
    return -1;
  }
}

async function getSyncStatus() {
  const pending = {};
  let totalPending = 0;

  for (const table of SYNC_TABLES) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE synced = FALSE`);
      const count = parseInt(rows[0].count, 10);
      if (count > 0) {
        pending[table] = count;
        totalPending += count;
      }
    } catch { /* skip tables without synced column */ }
  }

  const { rows: lastSync } = await pool.query(
    `SELECT MAX(synced_at) AS last_synced FROM sync_log WHERE status = 'synced'`,
  );
  const { rows: lastPush } = await pool.query(
    `SELECT MAX(synced_at) AS last_pushed FROM sync_log WHERE operation = 'PUSH' AND status = 'synced'`,
  );
  const { rows: lastPullRow } = await pool.query(
    `SELECT MAX(synced_at) AS last_pulled FROM sync_log WHERE operation = 'PULL' AND status = 'synced'`,
  );
  const { rows: failed } = await pool.query(
    `SELECT COUNT(*) FROM sync_log WHERE status = 'failed' AND attempted_at > NOW() - INTERVAL '1 hour'`,
  );
  const { rows: activeExams } = await pool.query(
    `SELECT COUNT(*) FROM exams WHERE status = 'active'`,
  );

  return {
    pending,
    totalPending,
    failedCount: parseInt(failed[0]?.count || '0', 10),
    lastSynced: lastSync[0]?.last_synced || null,
    lastPushed: lastPush[0]?.last_pushed || null,
    lastPulled: lastPullRow[0]?.last_pulled || null,
    isOnline: await checkOnlineConnectivity(),
    isSyncing,
    activeExamLock: parseInt(activeExams[0]?.count || '0', 10) > 0,
    syncMode: ONLINE_DB_HOST ? 'direct_db' : 'not_configured',
  };
}

// ── Background Service ──
function startSyncService() {
  if (!ONLINE_DB_HOST) {
    console.log('[SYNC] No ONLINE_DB_HOST configured — sync disabled');
    console.log('[SYNC] Set ONLINE_DB_HOST, ONLINE_DB_USER, ONLINE_DB_PASSWORD to enable direct DB sync');
    return;
  }

  console.log(`[SYNC] Direct DB sync enabled (every ${SYNC_INTERVAL / 1000}s) → ${ONLINE_DB_HOST}:${ONLINE_DB_PORT}/${ONLINE_DB_NAME}`);

  setTimeout(syncNow, 5000);
  syncTimer = setInterval(syncNow, SYNC_INTERVAL);
}

function stopSyncService() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (onlinePool) {
    onlinePool.end().catch(() => {});
    onlinePool = null;
  }
  console.log('[SYNC] Background sync stopped');
}

module.exports = { syncNow, startSyncService, stopSyncService, getSyncStatus, pushOnly, pullOnly };
