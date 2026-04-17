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
