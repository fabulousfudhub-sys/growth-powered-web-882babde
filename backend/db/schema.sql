-- ATAPOLY CBT Database Schema
-- Run: psql -U cbt_admin -d atapoly_cbt -f backend/db/schema.sql

-- ── Enums ──
CREATE TYPE user_role AS ENUM ('super_admin', 'admin', 'examiner', 'instructor', 'lab_admin', 'student');
CREATE TYPE exam_status AS ENUM ('draft', 'scheduled', 'active', 'completed');
CREATE TYPE attempt_status AS ENUM ('in_progress', 'submitted', 'graded');
CREATE TYPE question_type AS ENUM ('mcq', 'true_false', 'fill_blank', 'short_answer', 'essay', 'matching');
CREATE TYPE difficulty_level AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE sync_status AS ENUM ('pending', 'synced', 'failed');

-- ── Schools ──
CREATE TABLE schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Departments ──
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  programmes TEXT[] DEFAULT '{}',
  levels TEXT[] DEFAULT '{}',
  examiner_id UUID,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, school_id)
);

-- ── Users ──
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  role user_role NOT NULL DEFAULT 'student',
  reg_number VARCHAR(50) UNIQUE,
  department_id UUID REFERENCES departments(id),
  level VARCHAR(10),
  last_login TIMESTAMPTZ,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK for department examiner
ALTER TABLE departments ADD CONSTRAINT fk_examiner FOREIGN KEY (examiner_id) REFERENCES users(id);

-- ── Courses ──
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL,
  title VARCHAR(255) NOT NULL,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id),
  programme VARCHAR(100),
  level VARCHAR(10),
  instructor_id UUID REFERENCES users(id),
  ca_weight NUMERIC(5,2) DEFAULT 30, -- percentage for CA (e.g. 30%)
  exam_weight NUMERIC(5,2) DEFAULT 70, -- percentage for Exam (e.g. 70%)
  max_cas INTEGER DEFAULT 1, -- how many CAs allowed
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(code, department_id)
);

-- ── Questions ──
CREATE TABLE questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type question_type NOT NULL,
  text TEXT NOT NULL,
  options JSONB,
  correct_answer JSONB,
  difficulty difficulty_level NOT NULL DEFAULT 'medium',
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id),
  image_url TEXT,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Exams ──
CREATE TYPE exam_type AS ENUM ('exam', 'ca');

CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  course_id UUID NOT NULL REFERENCES courses(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  school_id UUID NOT NULL REFERENCES schools(id),
  programme VARCHAR(100),
  level VARCHAR(10),
  duration INTEGER NOT NULL, -- minutes
  total_questions INTEGER NOT NULL,
  questions_to_answer INTEGER NOT NULL,
  total_marks NUMERIC(6,2) NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status exam_status NOT NULL DEFAULT 'draft',
  instructions TEXT,
  pin_mode VARCHAR(20) NOT NULL DEFAULT 'individual',
  shared_pin VARCHAR(8),
  exam_type exam_type NOT NULL DEFAULT 'exam',
  ca_number INTEGER DEFAULT 1, -- CA1, CA2, etc.
  created_by UUID REFERENCES users(id),
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Exam Pins ──
CREATE TABLE exam_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id),
  pin VARCHAR(8) NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  UNIQUE(exam_id, student_id),
  UNIQUE(exam_id, pin)
);

-- ── Exam Questions ──
CREATE TABLE exam_questions (
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  sort_order INTEGER,
  PRIMARY KEY (exam_id, question_id)
);

-- ── Exam Attempts ──
CREATE TABLE exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id),
  student_id UUID NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ, -- NULL until student clicks Begin Exam
  submitted_at TIMESTAMPTZ,
  score NUMERIC(6,2),
  total_marks NUMERIC(6,2),
  status attempt_status NOT NULL DEFAULT 'in_progress',
  current_question INTEGER DEFAULT 0,
  synced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(exam_id, student_id)
);

-- ── Site Settings ──
CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Answers ──
CREATE TABLE answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id),
  answer TEXT,
  essay_score NUMERIC(6,2),
  essay_feedback TEXT,
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  synced BOOLEAN DEFAULT FALSE,
  UNIQUE(attempt_id, question_id)
);

-- ── Sync Log ──
CREATE TABLE sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(50) NOT NULL,
  record_id UUID NOT NULL,
  operation VARCHAR(10) NOT NULL,
  status sync_status DEFAULT 'pending',
  error_message TEXT,
  attempted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Audit Log ──
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  user_name VARCHAR(255),
  role VARCHAR(50),
  action VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,
  details TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE exam_questions ADD COLUMN synced BOOLEAN DEFAULT FALSE;
ALTER TABLE exam_pins ADD COLUMN synced BOOLEAN DEFAULT FALSE;
ALTER TABLE site_settings ADD COLUMN synced BOOLEAN DEFAULT FALSE;

ALTER TABLE exams ADD COLUMN IF NOT EXISTS exam_type VARCHAR(10) DEFAULT 'exam';
ALTER TABLE exams ADD COLUMN IF NOT EXISTS ca_number INTEGER DEFAULT 1;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS ca_weight NUMERIC(5,2) DEFAULT 30;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS exam_weight NUMERIC(5,2) DEFAULT 70;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS max_cas INTEGER DEFAULT 1;

ALTER TABLE questions ADD COLUMN image_url TEXT;


-- ── Indexes ──
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_reg_number ON users(reg_number);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_questions_course ON questions(course_id);
CREATE INDEX idx_exams_status ON exams(status);
CREATE INDEX idx_exams_department ON exams(department_id);
CREATE INDEX idx_exam_pins_lookup ON exam_pins(pin, exam_id);
CREATE INDEX idx_exam_attempts_exam ON exam_attempts(exam_id);
CREATE INDEX idx_exam_attempts_student ON exam_attempts(student_id);
CREATE INDEX idx_answers_attempt ON answers(attempt_id);
CREATE INDEX idx_sync_log_pending ON sync_log(status) WHERE status = 'pending';
CREATE INDEX idx_answers_synced ON answers(synced) WHERE synced = FALSE;
CREATE INDEX idx_exam_attempts_synced ON exam_attempts(synced) WHERE synced = FALSE;
CREATE INDEX idx_exams_start_date ON exams(start_date) WHERE status IN ('draft', 'scheduled');
CREATE INDEX idx_exams_end_date ON exams(end_date) WHERE status = 'active';

-- ── Trigger: auto-update updated_at ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_schools_updated BEFORE UPDATE ON schools FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_courses_updated BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_questions_updated BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_exams_updated BEFORE UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Trigger: log sync-pending records ──
CREATE OR REPLACE FUNCTION log_sync_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO sync_log (table_name, record_id, operation)
  VALUES (TG_TABLE_NAME, COALESCE(NEW.id, OLD.id), TG_OP);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_answers AFTER INSERT OR UPDATE ON answers FOR EACH ROW EXECUTE FUNCTION log_sync_change();
CREATE TRIGGER trg_sync_attempts AFTER INSERT OR UPDATE ON exam_attempts FOR EACH ROW EXECUTE FUNCTION log_sync_change();
CREATE TRIGGER trg_sync_exams AFTER INSERT OR UPDATE ON exams FOR EACH ROW EXECUTE FUNCTION log_sync_change();
