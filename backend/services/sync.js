const { pool } = require('../db/pool');

const ONLINE_SERVER_URL = process.env.ONLINE_SERVER_URL || 'https://ihgcgmyjvnexaqcluoay.supabase.co/functions/v1/swift-handler';
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL || '18000000'); // 5hrs
const CONNECTIVITY_POLL_INTERVAL = 30000; // poll every 30s for connectivity changes
const SYNC_BATCH_SIZE = 200;
const CONNECTIVITY_TIMEOUT = 5000;

let isSyncing = false;
let syncTimer = null;
let connectivityTimer = null;
let lastKnownOnline = false;

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
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return JSON.stringify(value);
  }
  return value;
}

function hasSyncedFlag(tableName) {
  return TABLES_WITH_SYNC_FLAG.has(tableName);
}

// ── Connectivity Check ──
async function checkOnlineConnectivity() {
  if (!ONLINE_SERVER_URL) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTIVITY_TIMEOUT);
    const res = await fetch(`${ONLINE_SERVER_URL}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

async function getLastSuccessfulSync(client, tableName, operation) {
  const { rows } = await client.query(
    `SELECT MAX(synced_at) AS ts
     FROM sync_log
     WHERE table_name = $1 AND operation = $2 AND status = 'synced'`,
    [tableName, operation],
  );
  return rows[0]?.ts || null;
}

// ── Push candidate selectors ──
async function getPushCandidates(client, tableName, limit) {
  // exam_questions: composite PK, no updated_at — order by exam_id
  if (tableName === 'exam_questions') {
    try {
      const { rows } = await client.query(
        `SELECT * FROM exam_questions
         WHERE synced IS NOT TRUE
         ORDER BY exam_id ASC
         LIMIT $1`,
        [limit],
      );
      return rows;
    } catch (err) {
      console.error('[SYNC] exam_questions push selector error:', err.message);
      return [];
    }
  }

  if (hasSyncedFlag(tableName)) {
    const tsCol = getTsColumn(tableName);
    try {
      const { rows } = await client.query(
        `SELECT * FROM ${tableName}
         WHERE synced = FALSE
         ORDER BY ${tsCol} ASC NULLS FIRST
         LIMIT $1`,
        [limit],
      );
      return rows;
    } catch {
      return [];
    }
  }

  if (tableName === 'exam_pins') {
    const { rows } = await client.query(
      `SELECT ep.*
       FROM exam_pins ep
       LEFT JOIN (
         SELECT record_id, MAX(synced_at) AS last_pushed
         FROM sync_log
         WHERE table_name = 'exam_pins' AND operation = 'PUSH' AND status = 'synced'
         GROUP BY record_id
       ) pushed ON pushed.record_id = ep.id
       WHERE pushed.record_id IS NULL
          OR (ep.used_at IS NOT NULL AND (pushed.last_pushed IS NULL OR ep.used_at > pushed.last_pushed))
       ORDER BY ep.id ASC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }

  if (tableName === 'site_settings') {
    const lastPush = await getLastSuccessfulSync(client, tableName, 'PUSH');
    const { rows } = await client.query(
      `SELECT *
       FROM site_settings
       WHERE id = 1 AND ($1::timestamptz IS NULL OR updated_at > $1)
       LIMIT 1`,
      [lastPush],
    );
    return rows;
  }

  return [];
}

async function markAsSynced(client, tableName, ids) {
  // exam_questions uses composite PK — handled by markExamQuestionsSynced
  if (tableName === 'exam_questions') return;
  if (!hasSyncedFlag(tableName) || ids.length === 0) return;
  await client.query(
    `UPDATE ${tableName} SET synced = TRUE WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

async function markExamQuestionsSynced(client, records) {
  if (!records || records.length === 0) return;
  for (const r of records) {
    if (!r?.exam_id || !r?.question_id) continue;
    try {
      await client.query(
        `UPDATE exam_questions SET synced = TRUE WHERE exam_id = $1 AND question_id = $2`,
        [r.exam_id, r.question_id],
      );
    } catch (err) {
      console.warn('[SYNC] markExamQuestionsSynced failed:', err.message);
    }
  }
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

async function pushToOnlineServer(tableName, records) {
  const response = await fetch(`${ONLINE_SERVER_URL}/api/sync/receive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: tableName, records }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Online server rejected sync for ${tableName}: ${response.status} - ${err}`);
  }

  return response.json();
}

// ── Pull from online server ──
async function pullFromOnlineServer(tableName, lastSyncedAt) {
  const params = new URLSearchParams({ table: tableName });
  if (lastSyncedAt) params.set('since', lastSyncedAt);

  const response = await fetch(`${ONLINE_SERVER_URL}/api/sync/pull?${params}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Pull failed for ${tableName}: ${response.status} - ${err}`);
  }

  return response.json();
}

// ── Check if records are locked (active exam) ──
async function isTableLockedForExam(client, tableName) {
  if (!LOCKED_DURING_EXAM.includes(tableName)) return false;
  try {
    const { rows } = await client.query(`SELECT COUNT(*) FROM exams WHERE status = 'active'`);
    return parseInt(rows[0].count, 10) > 0;
  } catch {
    return false;
  }
}

function toMs(value) {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

// ── Merge conflict resolution ──
async function mergeRecords(client, tableName, remoteRecords) {
  let merged = 0;
  let skipped = 0;

  // exam_questions has composite PK (exam_id, question_id), no 'id' column
  const isComposite = tableName === 'exam_questions';

  for (const remote of remoteRecords) {
    try {
      if (isComposite) {
        if (!remote?.exam_id || !remote?.question_id) { skipped++; continue; }

        const { rows: localRows } = await client.query(
          `SELECT * FROM exam_questions WHERE exam_id = $1 AND question_id = $2`,
          [remote.exam_id, remote.question_id],
        );

        if (!localRows[0]) {
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
        `SELECT * FROM ${tableName} WHERE id = $1`,
        [remote.id],
      );

      const local = localRows[0];
      const tsCol = getTsColumn(tableName);
      const remoteTs = toMs(remote[tsCol]);
      const localTs = toMs(local?.[tsCol]);

      if (local && remoteTs > 0 && localTs > remoteTs) { skipped++; continue; }

      if (!local) {
        const entries = Object.entries(remote).filter(([, value]) => value !== undefined);
        if (entries.length === 0) { skipped++; continue; }

        const cols = entries.map(([col]) => col);
        const values = entries.map(([col, value]) => toDbValue(tableName, col, value));
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

        await client.query(
          `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          values,
        );
        merged++;
        continue;
      }

      const cols = Object.keys(remote).filter((col) => col !== 'id' && remote[col] !== undefined);
      if (cols.length === 0) { skipped++; continue; }

      const sets = cols.map((col, i) => `${col} = $${i + 2}`).join(', ');
      const values = [remote.id, ...cols.map((col) => toDbValue(tableName, col, remote[col]))];

      await client.query(
        `UPDATE ${tableName} SET ${sets} WHERE id = $1`,
        values,
      );
      merged++;
    } catch (err) {
      console.error(`[SYNC] Merge error for ${tableName}/${remote?.id || remote?.exam_id}:`, err.message);
      skipped++;
    }
  }

  return { merged, skipped };
}

// ── Push Only ──
async function pushOnly() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;
  const results = { pushed: 0, failed: 0, tables: {} };

  try {
    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) return { status: 'offline', ...results };

    const client = await pool.connect();
    try {
      for (const tableName of SYNC_TABLES) {
        const records = await getPushCandidates(client, tableName, SYNC_BATCH_SIZE);
        if (records.length === 0) continue;

        try {
          console.log(`[SYNC] pushing ${tableName}`, records.length);
          await pushToOnlineServer(tableName, records);
          const ids = records.map((r) => r.id).filter(Boolean);
          await markAsSynced(client, tableName, ids.filter(isUuid));
          if (tableName === 'exam_questions') await markExamQuestionsSynced(client, records);

          results.pushed += records.length;
          results.tables[tableName] = { pushed: records.length };

          await logSyncSuccess(client, tableName, 'PUSH', ids);
        } catch (err) {
          results.failed += records.length;
          results.tables[tableName] = {
            pushFailed: records.length,
            error: err.message,
          };
          await logSyncFailure(client, tableName, 'PUSH', err.message);
        }
      }
    } finally {
      client.release();
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
    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) return { status: 'offline', ...results };

    const client = await pool.connect();
    try {
      for (const tableName of SYNC_TABLES) {
        const locked = await isTableLockedForExam(client, tableName);
        if (locked) {
          results.tables[tableName] = { pullSkipped: 'locked' };
          continue;
        }

        try {
          const since = await getLastSuccessfulSync(client, tableName, 'PULL');
          const remoteData = await pullFromOnlineServer(tableName, since);

          if (!remoteData.records || remoteData.records.length === 0) {
            continue;
          }

          const { merged, skipped } = await mergeRecords(client, tableName, remoteData.records);
          results.pulled += merged;
          results.tables[tableName] = { pulled: merged, pullSkipped: skipped };

          await logSyncSuccess(client, tableName, 'PULL');
        } catch (err) {
          results.tables[tableName] = { pullError: err.message };
          await logSyncFailure(client, tableName, 'PULL', err.message);
        }
      }
    } finally {
      client.release();
    }

    return { status: 'completed', ...results };
  } catch (err) {
    return { status: 'error', error: err.message, ...results };
  } finally {
    isSyncing = false;
  }
}

// ── Main Sync Logic (2-way) ──
async function syncNow() {
  if (isSyncing) return { status: 'already_running' };
  isSyncing = true;

  const results = { pushed: 0, pulled: 0, failed: 0, tables: {} };

  try {
    const isOnline = await checkOnlineConnectivity();
    if (!isOnline) {
      return { status: 'offline', ...results };
    }

    console.log('[SYNC] Internet detected, starting 2-way sync...');
    const client = await pool.connect();

    try {
      // ── PUSH: Local → Online ──
      for (const tableName of SYNC_TABLES) {
        const records = await getPushCandidates(client, tableName, SYNC_BATCH_SIZE);
        if (records.length === 0) continue;

        try {
          console.log(`[SYNC] pushing ${tableName}`, records.length);
          await pushToOnlineServer(tableName, records);
          const ids = records.map((r) => r.id).filter(Boolean);
          await markAsSynced(client, tableName, ids.filter(isUuid));
          if (tableName === 'exam_questions') await markExamQuestionsSynced(client, records);

          results.pushed += records.length;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pushed: records.length,
          };

          await logSyncSuccess(client, tableName, 'PUSH', ids);
        } catch (err) {
          results.failed += records.length;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pushFailed: records.length,
            error: err.message,
          };
          await logSyncFailure(client, tableName, 'PUSH', err.message);
        }
      }

      // ── PULL: Online → Local ──
      for (const tableName of SYNC_TABLES) {
        const locked = await isTableLockedForExam(client, tableName);
        if (locked) {
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pullSkipped: 'locked',
          };
          continue;
        }

        try {
          const since = await getLastSuccessfulSync(client, tableName, 'PULL');
          const remoteData = await pullFromOnlineServer(tableName, since);

          if (!remoteData.records || remoteData.records.length === 0) continue;

          const { merged, skipped } = await mergeRecords(client, tableName, remoteData.records);
          results.pulled += merged;
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pulled: merged,
            pullSkipped: skipped,
          };

          await logSyncSuccess(client, tableName, 'PULL');
        } catch (err) {
          results.tables[tableName] = {
            ...(results.tables[tableName] || {}),
            pullError: err.message,
          };
          await logSyncFailure(client, tableName, 'PULL', err.message);
        }
      }
    } finally {
      client.release();
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
      } catch {
        // table may not have synced column
      }
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
    } catch {
      // skip tables without synced column
    }
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
  };
}

// ── Background Service ──
function startSyncService() {
  if (!ONLINE_SERVER_URL) {
    console.log('[SYNC] No ONLINE_SERVER_URL configured — sync disabled');
    console.log('[SYNC] Set ONLINE_SERVER_URL env var to enable auto-sync');
    return;
  }

  console.log(`[SYNC] 2-way background sync enabled (every ${SYNC_INTERVAL / 1000}s) → ${ONLINE_SERVER_URL}`);
  console.log(`[SYNC] Connectivity polling every ${CONNECTIVITY_POLL_INTERVAL / 1000}s for auto-sync on reconnect`);

  setTimeout(syncNow, 5000);
  syncTimer = setInterval(syncNow, SYNC_INTERVAL);

  // Connectivity watcher: triggers a sync the moment we go offline -> online
  connectivityTimer = setInterval(async () => {
    try {
      const isOnline = await checkOnlineConnectivity();
      if (isOnline && !lastKnownOnline) {
        console.log('[SYNC] 🌐 Internet detected — triggering auto-sync');
        lastKnownOnline = true;
        if (!isSyncing) {
          syncNow().catch((e) => console.warn('[SYNC] auto-sync error:', e.message));
        }
      } else if (!isOnline && lastKnownOnline) {
        console.log('[SYNC] 📴 Internet lost');
        lastKnownOnline = false;
      }
    } catch {
      // never crash the watcher
    }
  }, CONNECTIVITY_POLL_INTERVAL);
}

function stopSyncService() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (connectivityTimer) {
    clearInterval(connectivityTimer);
    connectivityTimer = null;
  }
  console.log('[SYNC] Background sync stopped');
}

module.exports = {
  syncNow,
  startSyncService,
  stopSyncService,
  getSyncStatus,
  pushOnly,
  pullOnly,
  checkOnlineConnectivity,
};