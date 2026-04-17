// ── Types ──────────────────────────────────────────
export type UserRole =
  | "super_admin"
  | "admin"
  | "examiner"
  | "instructor"
  | "lab_admin"
  | "student";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  regNumber?: string;
  department?: string;
  level?: string;
  lastLogin?: string;
}

export interface School {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
  school: string;
  programmes: string[];
  levels: string[];
  examinerId?: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  department: string;
  school: string;
  programme: string;
  level: string;
  instructor: string;
  instructorId?: string;
  caWeight?: number;
  examWeight?: number;
  maxCas?: number;
}

export interface Question {
  id: string;
  type: "mcq" | "true_false" | "fill_blank" | "short_answer" | "essay" | "matching";
  text: string;
  options?: string[];
  correctAnswer?: string | string[];
  difficulty: "easy" | "medium" | "hard";
  course: string;
  createdBy?: string;
  imageUrl?: string;
}

export interface ExamPin {
  pin: string;
  studentId: string;
  studentName: string;
  matricNumber: string;
  used: boolean;
}

export interface Exam {
  id: string;
  title: string;
  course: string;
  department: string;
  school: string;
  programme: string;
  level: string;
  duration: number;
  totalQuestions: number;
  questionsToAnswer: number;
  totalMarks: number;
  startDate: string;
  endDate: string;
  status: "draft" | "scheduled" | "active" | "completed";
  instructions: string;
  createdBy: string;
  enrolledStudents: number;
  pins?: ExamPin[];
  examType?: "exam" | "ca";
  caNumber?: number;
  semester?: string | null;
  showResult?: boolean;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  studentId: string;
  answers: Record<string, string>;
  flaggedQuestions: string[];
  startedAt: string;
  submittedAt?: string;
  score?: number;
  totalMarks?: number;
  status: "in_progress" | "submitted" | "graded";
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: string;
  category: 'auth' | 'exam' | 'user' | 'question' | 'system' | 'result';
  details: string;
  ip: string;
}
