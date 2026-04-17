// Idempotent runtime migrations — applied on every server boot.
// Safe to re-run; uses IF NOT EXISTS / IF EXISTS guards.
const { pool } = require('./pool');

const MIGRATIONS = [
  // Exam: semester + show_result toggle
  `ALTER TABLE exams ADD COLUMN IF NOT EXISTS semester VARCHAR(20)`,
  `ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_result BOOLEAN DEFAULT TRUE`,
  // Exam: ca_number / exam_type safety
  `ALTER TABLE exams ADD COLUMN IF NOT EXISTS ca_number INTEGER DEFAULT 1`,
  // Course weights
  `ALTER TABLE courses ADD COLUMN IF NOT EXISTS ca_weight NUMERIC(5,2) DEFAULT 30`,
  `ALTER TABLE courses ADD COLUMN IF NOT EXISTS exam_weight NUMERIC(5,2) DEFAULT 70`,
  `ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_cas INTEGER DEFAULT 1`,
  // exam_questions sync flag (composite PK table — no id/updated_at)
  `ALTER TABLE exam_questions ADD COLUMN IF NOT EXISTS synced BOOLEAN DEFAULT FALSE`,
  // Per-question marks (for accurate scoring instead of even division)
  `ALTER TABLE questions ADD COLUMN IF NOT EXISTS marks NUMERIC(6,2) DEFAULT 1`,
  // Mark answers that need manual grading (essay/short_answer)
  `ALTER TABLE answers ADD COLUMN IF NOT EXISTS requires_grading BOOLEAN DEFAULT FALSE`,
  // ── NEW FEATURE: Question version history ──
  `CREATE TABLE IF NOT EXISTS question_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL,
    text TEXT NOT NULL,
    options JSONB,
    correct_answer JSONB,
    difficulty VARCHAR(20),
    marks NUMERIC(6,2),
    image_url TEXT,
    edited_by UUID REFERENCES users(id),
    edited_by_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_question_versions_qid ON question_versions(question_id, version DESC)`,
  // ── NEW FEATURE: Browser fingerprint device lock ──
  `ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(128)`,
  `ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS device_locked_at TIMESTAMPTZ`,
  // ── NEW FEATURE: Auto-backup metadata ──
  `CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    size_bytes BIGINT,
    table_count INTEGER,
    row_count INTEGER,
    status VARCHAR(20) DEFAULT 'completed',
    error_message TEXT,
    triggered_by VARCHAR(50) DEFAULT 'auto',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // ── NEW FEATURE: Sync tombstones (delete propagation) ──
  `CREATE TABLE IF NOT EXISTS sync_tombstones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(100) NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NOW(),
    synced BOOLEAN DEFAULT FALSE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tombstones_pending ON sync_tombstones(synced) WHERE synced = FALSE`,
  // Exam scheduler distributed lock
  `CREATE TABLE IF NOT EXISTS scheduler_locks (
    name VARCHAR(50) PRIMARY KEY,
    locked_until TIMESTAMPTZ NOT NULL,
    locked_by VARCHAR(100)
  )`,
];

async function runMigrations() {
  for (const sql of MIGRATIONS) {
    try {
      await pool.query(sql);
    } catch (err) {
      // Don't crash startup on migration warnings
      console.warn('[MIGRATE] skipped:', err.message);
    }
  }
  console.log('[MIGRATE] runtime migrations applied');
}

module.exports = { runMigrations };
