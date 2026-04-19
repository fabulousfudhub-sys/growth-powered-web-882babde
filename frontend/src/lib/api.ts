import type {
  User,
  Exam,
  Question,
  ExamAttempt,
  Department,
  Course,
  School,
  AuditEntry,
} from "./types";

// ── Mode detection ──
// Online mode: no VITE_API_URL set, use backend gateway
// Local mode: VITE_API_URL set (or empty string for same-origin Express)
const VITE_API_URL = import.meta.env.VITE_API_URL;
const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ONLINE_API_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1/api-gateway`
  : "";
const LOCAL_API_BASE = VITE_API_URL ?? "";

// If VITE_API_URL is explicitly set (even empty string), use local mode
// If not set at all, use online mode via backend gateway
const isOnlineMode = VITE_API_URL === undefined && !!SUPABASE_URL;

const PRIMARY_API_BASE = isOnlineMode ? ONLINE_API_BASE : LOCAL_API_BASE;
const SECONDARY_API_BASE = isOnlineMode
  ? VITE_API_URL !== undefined
    ? LOCAL_API_BASE
    : ""
  : ONLINE_API_BASE;

export type ApiConnectivityRoute =
  | "cloud_gateway"
  | "local_backend"
  | "unknown";
export const API_ROUTE_CHANGED_EVENT = "cbt-api-route-changed";
export const LICENSE_REQUIRED_EVENT = "cbt-license-required";

function getApiBases(): string[] {
  const uniqueBases = Array.from(
    new Set([PRIMARY_API_BASE, SECONDARY_API_BASE].filter(Boolean)),
  );
  return uniqueBases.length > 0 ? uniqueBases : [""];
}

function isGatewayBase(base: string): boolean {
  return (
    !!SUPABASE_URL &&
    base.startsWith(SUPABASE_URL) &&
    base.includes("/functions/v1/api-gateway")
  );
}

function resolveRouteFromBase(base: string): ApiConnectivityRoute {
  if (!base || !base.trim()) return "local_backend";
  return isGatewayBase(base) ? "cloud_gateway" : "local_backend";
}

function getRouteLabel(route: ApiConnectivityRoute): string {
  if (route === "cloud_gateway") return "Cloud";
  if (route === "local_backend") return "Local";
  return "Unknown";
}

let activeRoute: ApiConnectivityRoute = resolveRouteFromBase(PRIMARY_API_BASE);

function setActiveRoute(route: ApiConnectivityRoute) {
  if (activeRoute === route) return;
  activeRoute = route;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(API_ROUTE_CHANGED_EVENT, {
        detail: {
          route,
          label: getRouteLabel(route),
          isFallback: route !== resolveRouteFromBase(PRIMARY_API_BASE),
        },
      }),
    );
  }
}

export function getApiRouteStatus(): {
  route: ApiConnectivityRoute;
  label: string;
  isFallback: boolean;
} {
  const primaryRoute = resolveRouteFromBase(PRIMARY_API_BASE);
  return {
    route: activeRoute,
    label: getRouteLabel(activeRoute),
    isFallback: activeRoute !== primaryRoute,
  };
}

function buildError(
  message: string,
  status?: number,
): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  if (status) error.status = status;
  return error;
}

function shouldFallback(error: Error & { status?: number }): boolean {
  if (error.status === undefined) return true; // network / connectivity / CORS
  return [404, 502, 503, 504].includes(error.status);
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) sessionStorage.setItem("cbt_token", token);
  else sessionStorage.removeItem("cbt_token");
}

export function getAuthToken(): string | null {
  if (!authToken) authToken = sessionStorage.getItem("cbt_token");
  return authToken;
}

async function requestWithBase<T>(
  base: string,
  path: string,
  options: RequestInit,
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  if (isGatewayBase(base) && SUPABASE_PUBLISHABLE_KEY) {
    headers.apikey = SUPABASE_PUBLISHABLE_KEY;
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });
  } catch {
    throw buildError("Unable to reach server");
  }

  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ error: res.statusText || "Request failed" }));
    // 402 = License required → notify the app so it can show the activation page.
    if (
      res.status === 402 &&
      typeof window !== "undefined" &&
      !path.startsWith("/api/license/public-")
    ) {
      window.dispatchEvent(new CustomEvent(LICENSE_REQUIRED_EVENT));
    }
    throw buildError(err.error || "Request failed", res.status);
  }

  setActiveRoute(resolveRouteFromBase(base));
  return res.json();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const bases = getApiBases();
  let lastError: Error & { status?: number } = buildError("Request failed");

  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    try {
      return await requestWithBase<T>(base, path, options);
    } catch (err) {
      const typedError = err as Error & { status?: number };
      lastError = typedError;

      const hasFallback = i < bases.length - 1;
      if (!hasFallback || !shouldFallback(typedError)) {
        throw typedError;
      }

      console.warn(
        `[API] Primary route failed (${typedError.message}). Retrying via fallback base.`,
      );
    }
  }

  throw lastError;
}

// ── Auto-save service ──
let autoSaveInterval: ReturnType<typeof setInterval> | null = null;
let pendingAnswers: Map<
  string,
  { attemptId: string; questionId: string; answer: string }
> = new Map();

function queueAnswer(attemptId: string, questionId: string, answer: string) {
  pendingAnswers.set(questionId, { attemptId, questionId, answer });
}

async function flushPendingAnswers() {
  if (pendingAnswers.size === 0) return;
  const batch = Array.from(pendingAnswers.values());
  const attemptId = batch[0].attemptId;
  pendingAnswers.clear();
  try {
    await request("/api/answers/save-batch", {
      method: "POST",
      body: JSON.stringify({
        attemptId,
        answers: batch.map((b) => ({
          questionId: b.questionId,
          answer: b.answer,
        })),
      }),
    });
  } catch (err) {
    batch.forEach((b) => pendingAnswers.set(b.questionId, b));
    console.error("[AUTO-SAVE] Failed, will retry:", err);
  }
}

export function startAutoSave() {
  if (autoSaveInterval) return;
  autoSaveInterval = setInterval(flushPendingAnswers, 5000);
}

export function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
  flushPendingAnswers();
}

// ── API ──
export const api = {
  // Auth
  async getMe(): Promise<{
    user: User;
    exam?: Exam;
    attemptId?: string;
    startedAt?: string | null;
  } | null> {
    try {
      return await request("/api/auth/me");
    } catch {
      return null;
    }
  },

  async loginStudent(
    matricNumber: string,
    examPin: string,
    deviceFingerprint?: string,
  ): Promise<{
    user: User;
    exam: Exam;
    attemptId: string;
    startedAt: string | null;
    resumed?: boolean;
  } | null> {
    try {
      const res = await request<{
        token: string;
        user: User;
        exam: Exam;
        attemptId: string;
        startedAt: string | null;
        resumed?: boolean;
      }>("/api/auth/student/login", {
        method: "POST",
        body: JSON.stringify({ matricNumber, examPin, deviceFingerprint }),
        headers: deviceFingerprint
          ? { "x-device-fingerprint": deviceFingerprint }
          : undefined,
      });
      setAuthToken(res.token);
      return {
        user: res.user,
        exam: res.exam,
        attemptId: res.attemptId,
        startedAt: res.startedAt,
        resumed: res.resumed,
      };
    } catch (err) {
      throw err;
    }
  },

  async loginStaff(email: string, password: string): Promise<User | null> {
    const res = await request<{ token: string; user: User }>(
      "/api/auth/staff/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    );
    setAuthToken(res.token);
    return res.user;
  },

  // Begin exam (sets started_at on server)
  async beginExam(attemptId: string): Promise<{ startedAt: string }> {
    return request(`/api/answers/attempt/${attemptId}/begin`, {
      method: "POST",
    });
  },

  // Check attempt status (polling)
  async checkAttemptStatus(
    attemptId: string,
  ): Promise<{
    status: string;
    score?: number;
    total_marks?: number;
    exam_status?: string;
    showResult?: boolean;
  }> {
    return request(`/api/auth/attempt-status/${attemptId}`);
  },

  // Users
  async getUsers(): Promise<User[]> {
    return request("/api/admin/users");
  },
  async getStudents(): Promise<User[]> {
    const users = await request<User[]>("/api/admin/users");
    return users.filter((u) => u.role === "student");
  },
  async getInstructors(department?: string): Promise<User[]> {
    const users = await request<User[]>("/api/admin/users");
    const instructors = users.filter((u) => u.role === "instructor");
    return department
      ? instructors.filter((u) => u.department === department)
      : instructors;
  },
  async createUser(data: {
    name: string;
    email: string;
    password: string;
    role: string;
    regNumber?: string;
    departmentId?: string;
    level?: string;
  }): Promise<{ id: string }> {
    return request("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateUser(
    id: string,
    data: {
      name: string;
      email: string;
      role: string;
      password?: string;
      regNumber?: string;
      departmentId?: string;
      level?: string;
    },
  ): Promise<void> {
    await request(`/api/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteUser(id: string): Promise<void> {
    await request(`/api/admin/users/${id}`, { method: "DELETE" });
  },

  // Schools
  async getSchools(): Promise<School[]> {
    return request("/api/admin/schools");
  },
  async createSchool(name: string): Promise<{ id: string }> {
    return request("/api/admin/schools", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  async updateSchool(id: string, name: string): Promise<void> {
    await request(`/api/admin/schools/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    });
  },
  async deleteSchool(id: string): Promise<void> {
    await request(`/api/admin/schools/${id}`, { method: "DELETE" });
  },

  // Departments
  async getDepartments(schoolId?: string): Promise<Department[]> {
    const params = schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : "";
    return request(`/api/admin/departments${params}`);
  },
  async createDepartment(data: {
    name: string;
    schoolId: string;
    programmes?: string[];
    levels?: string[];
  }): Promise<{ id: string }> {
    return request("/api/admin/departments", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateDepartment(
    id: string,
    data: {
      name: string;
      schoolId: string;
      programmes?: string[];
      levels?: string[];
      examinerId?: string;
    },
  ): Promise<void> {
    await request(`/api/admin/departments/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteDepartment(id: string): Promise<void> {
    await request(`/api/admin/departments/${id}`, { method: "DELETE" });
  },

  // Courses
  async getCourses(departmentId?: string): Promise<Course[]> {
    const params = departmentId
      ? `?departmentId=${encodeURIComponent(departmentId)}`
      : "";
    return request(`/api/admin/courses${params}`);
  },
  async createCourse(data: {
    code: string;
    title: string;
    departmentId: string;
    schoolId: string;
    programme?: string;
    level?: string;
    instructorId?: string;
    caWeight?: number;
    examWeight?: number;
    maxCas?: number;
  }): Promise<{ id: string }> {
    return request("/api/admin/courses", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateCourse(
    id: string,
    data: {
      code: string;
      title: string;
      departmentId: string;
      schoolId: string;
      programme?: string;
      level?: string;
      instructorId?: string;
      caWeight?: number;
      examWeight?: number;
      maxCas?: number;
    },
  ): Promise<void> {
    await request(`/api/admin/courses/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteCourse(id: string): Promise<void> {
    await request(`/api/admin/courses/${id}`, { method: "DELETE" });
  },
  async getAllocationSummary(params: {
    courseId: string;
    level?: string;
    semester?: string;
    excludeExamId?: string;
  }): Promise<{
    caWeight: number;
    examWeight: number;
    maxCas: number;
    existing: { ca1: number; ca2: number; exam: number };
    existingIds: { ca1: string | null; ca2: string | null; exam: string | null };
    total: number;
  }> {
    const qs = new URLSearchParams();
    qs.set("courseId", params.courseId);
    if (params.level) qs.set("level", params.level);
    if (params.semester) qs.set("semester", params.semester);
    if (params.excludeExamId) qs.set("excludeExamId", params.excludeExamId);
    return request(`/api/exams/allocation/summary?${qs.toString()}`);
  },
  // Exams
  async getExams(department?: string): Promise<Exam[]> {
    const params = department
      ? `?department=${encodeURIComponent(department)}`
      : "";
    return request(`/api/exams${params}`);
  },
  async getExamById(id: string): Promise<Exam | undefined> {
    try {
      return await request(`/api/exams/${id}`);
    } catch {
      return undefined;
    }
  },
  async createExam(data: {
    title: string;
    courseId: string;
    departmentId: string;
    schoolId: string;
    programme?: string;
    level?: string;
    duration: number;
    totalQuestions: number;
    questionsToAnswer: number;
    totalMarks: number;
    startDate?: string;
    endDate?: string;
    instructions?: string;
    carryoverStudentIds?: string[];
    pinMode?: string;
    examType?: string;
    caNumber?: number;
    semester?: string | null;
    showResult?: boolean;
  }): Promise<{ id: string; questionsAssigned: number }> {
    return request("/api/exams", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateExam(id: string, data: any): Promise<void> {
    await request(`/api/exams/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteExam(id: string): Promise<void> {
    await request(`/api/exams/${id}`, { method: "DELETE" });
  },
  async updateExamStatus(
    id: string,
    status: string,
  ): Promise<{ autoSubmitted?: boolean }> {
    return request(`/api/exams/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },
  async generatePins(
    examId: string,
    mode: "individual" | "shared" = "individual",
  ): Promise<{ pins: any[]; count: number; mode: string }> {
    return request(`/api/exams/${examId}/generate-pins`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  },
  async getExamPins(
    examId: string,
  ): Promise<
    { pin: string; studentName: string; matricNumber: string; used: boolean }[]
  > {
    return request(`/api/exams/${examId}/pins`);
  },
  async getExamMonitoring(examId: string) {
    return request(`/api/exams/${examId}/monitoring`);
  },
  async resetExamAttempt(examId: string, studentId: string): Promise<void> {
    await request(`/api/exams/${examId}/reset-attempt`, {
      method: "POST",
      body: JSON.stringify({ studentId }),
    });
  },
  async unlockExamDevice(examId: string, studentId: string): Promise<{ cleared: number }> {
    return request(`/api/exams/${examId}/unlock-device`, {
      method: "POST",
      body: JSON.stringify({ studentId }),
    });
  },
  async forceSubmitAttempt(
    attemptId: string,
  ): Promise<{ score: number; total: number }> {
    return request(`/api/admin/force-submit/${attemptId}`, { method: "POST" });
  },
  async assignExamQuestions(examId: string): Promise<{ assigned: number }> {
    return request(`/api/exams/${examId}/assign-questions`, { method: "POST" });
  },
  async addCarryoverStudents(
    examId: string,
    studentIds: string[],
  ): Promise<{ added: number }> {
    return request(`/api/exams/${examId}/carryover-students`, {
      method: "POST",
      body: JSON.stringify({ studentIds }),
    });
  },

  // Questions
  async getQuestionsByExam(examId: string): Promise<Question[]> {
    return request(`/api/questions/exam/${examId}`);
  },
  async getQuestionBank(
    courseId?: string,
    createdBy?: string,
  ): Promise<Question[]> {
    const params = new URLSearchParams();
    if (courseId) params.set("courseId", courseId);
    if (createdBy) params.set("createdBy", createdBy);
    return request(`/api/questions/bank?${params}`);
  },
  async createQuestion(data: {
    type: string;
    text: string;
    options?: string[];
    correctAnswer?: string | string[];
    difficulty: string;
    courseId: string;
    imageUrl?: string;
  }): Promise<{ id: string }> {
    return request("/api/questions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  async updateQuestion(
    id: string,
    data: {
      type: string;
      text: string;
      options?: string[];
      correctAnswer?: string | string[];
      difficulty: string;
      courseId: string;
      imageUrl?: string;
    },
  ): Promise<void> {
    await request(`/api/questions/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  },
  async deleteQuestion(id: string): Promise<void> {
    await request(`/api/questions/${id}`, { method: "DELETE" });
  },

  // Answers
  async saveAnswer(
    attemptId: string,
    questionId: string,
    answer: string,
  ): Promise<void> {
    queueAnswer(attemptId, questionId, answer);
  },
  async getSavedAnswers(attemptId: string): Promise<Record<string, string>> {
    return request(`/api/answers/attempt/${attemptId}`);
  },
  async submitExam(
    attemptId: string,
  ): Promise<{ score?: number; total?: number; showResult?: boolean; submitted?: boolean }> {
    await flushPendingAnswers();
    return request("/api/answers/submit", {
      method: "POST",
      body: JSON.stringify({ attemptId }),
    });
  },

  // Attempt state
  async getAttemptState(
    attemptId: string,
  ): Promise<{
    startedAt: string | null;
    status: string;
    currentQuestion: number;
    duration: number;
    answers: Record<string, string>;
  }> {
    return request(`/api/answers/attempt/${attemptId}/state`);
  },
  async updateCurrentQuestion(
    attemptId: string,
    currentQuestion: number,
  ): Promise<void> {
    await request(`/api/answers/attempt/${attemptId}/current-question`, {
      method: "PATCH",
      body: JSON.stringify({ currentQuestion }),
    });
  },

  // Results
  async getAttempts(examId?: string): Promise<ExamAttempt[]> {
    const params = examId ? `?examId=${examId}` : "";
    return request(`/api/admin/results${params}`);
  },

  // Essay grading
  async getEssayAnswers(
    attemptId: string,
  ): Promise<
    {
      questionId: string;
      questionText: string;
      answer: string;
      type: string;
      correctAnswer: any;
      essayScore?: number;
      essayFeedback?: string;
    }[]
  > {
    return request(`/api/admin/essay-answers/${attemptId}`);
  },
  async gradeEssay(data: {
    attemptId: string;
    questionId: string;
    score: number;
    feedback?: string;
  }): Promise<void> {
    await request("/api/admin/grade-essay", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Audit Log
  async getAuditLog(): Promise<AuditEntry[]> {
    return request("/api/admin/audit-log");
  },

  // Dashboard
  async getDashboardStats(department?: string) {
    const params = department
      ? `?department=${encodeURIComponent(department)}`
      : "";
    return request(`/api/admin/dashboard${params}`);
  },

  // Sync
  async getSyncStatus() {
    return request("/api/sync/status");
  },
  async triggerSync() {
    return request("/api/sync/trigger", { method: "POST" });
  },
  async triggerSyncPush() {
    return request("/api/sync/push", { method: "POST" });
  },
  async triggerSyncPull() {
    return request("/api/sync/pull", { method: "POST" });
  },

  // System lock & deactivation
  async getSystemStatus(): Promise<{ locked: boolean; deactivated: boolean }> {
    try {
      return await request("/api/settings/system-status");
    } catch {
      return { locked: false, deactivated: false };
    }
  },
  async setSystemLock(locked: boolean): Promise<void> {
    await request("/api/settings/system-lock", {
      method: "POST",
      body: JSON.stringify({ locked }),
    });
  },
  async setSystemActive(active: boolean): Promise<void> {
    await request("/api/settings/system-active", {
      method: "POST",
      body: JSON.stringify({ active }),
    });
  },

  // Network monitoring
  async getNetworkClients() {
    return request("/api/admin/network-clients");
  },

  // Search students
  async searchStudents(
    q: string,
  ): Promise<
    {
      id: string;
      name: string;
      regNumber: string;
      level: string;
      department: string;
    }[]
  > {
    return request(`/api/admin/search-students?q=${encodeURIComponent(q)}`);
  },

  // Import
  async importStudents(
    students: {
      name: string;
      regNumber: string;
      email?: string;
      department?: string;
      level?: string;
    }[],
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    return request("/api/import/students", {
      method: "POST",
      body: JSON.stringify({ students }),
    });
  },
  async importQuestions(
    questions: {
      type: string;
      text: string;
      option_a?: string;
      option_b?: string;
      option_c?: string;
      option_d?: string;
      correct_answer?: string;
      difficulty?: string;
      course: string;
    }[],
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    return request("/api/import/questions", {
      method: "POST",
      body: JSON.stringify({ questions }),
    });
  },

  // License
  async getLicenseStatus(): Promise<{ active: boolean; licenseKey: string | null; expiresAt: string | null; expired?: boolean }> {
    return request("/api/license/status");
  },
  async getPublicLicenseStatus(): Promise<{ active: boolean; expired: boolean; expiresAt: string | null; licenseKey: string | null }> {
    return request("/api/license/public-status");
  },
  async activateLicensePublic(licenseKey: string): Promise<void> {
    await request("/api/license/public-activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey }),
    });
  },
  async activateLicense(licenseKey: string): Promise<void> {
    await request("/api/license/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey }),
    });
  },
  async deactivateLicense(): Promise<void> {
    await request("/api/license/deactivate", { method: "POST" });
  },

  // Site Settings
  async getSiteSettings(): Promise<Record<string, any>> {
    try {
      return await request("/api/settings");
    } catch {
      return {};
    }
  },
  async saveSiteSettings(settings: Record<string, any>): Promise<void> {
    await request("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    });
  },

  // Database & Sync Config
  async getDbConfig(): Promise<any> {
    return request("/api/settings/db-config");
  },
  async saveSyncConfig(config: any): Promise<void> {
    await request("/api/settings/sync-config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
  },
  async testSyncConnection(config: any): Promise<any> {
    return request("/api/settings/test-sync-connection", {
      method: "POST",
      body: JSON.stringify(config),
    });
  },

  // System health
  async getSystemHealth(): Promise<any> {
    return request("/api/system-health");
  },

  // Backups
  async getBackups(): Promise<
    Array<{
      id: string;
      filename: string;
      size_bytes: number | null;
      table_count: number | null;
      row_count: number | null;
      status: string;
      error_message: string | null;
      triggered_by: string;
      created_at: string;
    }>
  > {
    return request("/api/backups");
  },
  async triggerBackup(): Promise<{ ok: boolean; filename: string; sizeBytes: number; rowCount: number }> {
    return request("/api/backups/trigger", { method: "POST" });
  },
  getBackupDownloadUrl(filename: string): string {
    const base = getApiBases()[0] || "";
    const token = getAuthToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    return `${base}/api/backups/download/${encodeURIComponent(filename)}${tokenParam}`;
  },

  // Question version history
  async getQuestionVersions(questionId: string): Promise<
    Array<{
      id: string;
      version: number;
      type: string;
      text: string;
      options: any;
      correct_answer: any;
      difficulty: string;
      marks: number | null;
      image_url: string | null;
      edited_by_name: string | null;
      created_at: string;
    }>
  > {
    return request(`/api/questions/${questionId}/versions`);
  },
  async restoreQuestionVersion(questionId: string, versionId: string): Promise<void> {
    await request(`/api/questions/${questionId}/versions/${versionId}/restore`, {
      method: "POST",
    });
  },

  async uploadFile(file: File): Promise<{ url: string }> {
    const token = getAuthToken();
    const bases = getApiBases();
    let lastError: Error = new Error("Upload failed");

    for (let i = 0; i < bases.length; i++) {
      const base = bases[i];
      const form = new FormData();
      form.append("file", file);

      const headers: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      if (isGatewayBase(base) && SUPABASE_PUBLISHABLE_KEY) {
        headers.apikey = SUPABASE_PUBLISHABLE_KEY;
      }

      try {
        const res = await fetch(`${base}/api/upload`, {
          method: "POST",
          headers,
          body: form,
        });

        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: res.statusText || "Upload failed" }));
          const httpError = buildError(
            err.error || "Upload failed",
            res.status,
          );

          const hasFallback = i < bases.length - 1;
          if (hasFallback && shouldFallback(httpError)) {
            lastError = httpError;
            continue;
          }

          throw httpError;
        }

        setActiveRoute(resolveRouteFromBase(base));
        return res.json();
      } catch (err) {
        lastError = err as Error;
        const hasFallback = i < bases.length - 1;
        if (!hasFallback) throw lastError;
      }
    }

    throw lastError;
  },

  logout() {
    setAuthToken(null);
    stopAutoSave();
  },
};
