import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import StudentLoginPage from "@/components/StudentLoginPage";
import StaffLoginPage from "@/components/StaffLoginPage";
import AdminLayout from "@/components/admin/AdminLayout";
import DashboardPage from "@/pages/admin/DashboardPage";
import ExamsPage from "@/pages/admin/ExamsPage";
import StudentsPage from "@/pages/admin/StudentsPage";
import QuestionsPage from "@/pages/admin/QuestionsPage";
import CreateQuestionPage from "@/pages/admin/CreateQuestionPage";
import AIQuestionGeneratorPage from "@/pages/admin/AIQuestionGeneratorPage";
import ResultsPage from "@/pages/admin/ResultsPage";
import UsersPage from "@/pages/admin/UsersPage";
import DepartmentsPage from "@/pages/admin/DepartmentsPage";
import SchoolsPage from "@/pages/admin/SchoolsPage";
import CoursesPage from "@/pages/admin/CoursesPage";
import ReportsPage from "@/pages/admin/ReportsPage";
import SettingsPage from "@/pages/admin/SettingsPage";
import AuditLogPage from "@/pages/admin/AuditLogPage";
import GradeEssayPage from "@/pages/admin/GradeEssayPage";
import ExamMonitoringPage from "@/pages/admin/ExamMonitoringPage";
import NetworkMonitoringPage from "@/pages/admin/NetworkMonitoringPage";
import SyncPage from "@/pages/admin/SyncPage";
import LicensePage from "@/pages/admin/LicensePage";
import SystemHealthPage from "@/pages/admin/SystemHealthPage";
import BackupsPage from "@/pages/admin/BackupsPage";
import StudentExamPortal from "@/pages/StudentExamPortal";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import LicenseActivationPage from "@/components/LicenseActivationPage";

const queryClient = new QueryClient();

interface PublicLicenseStatus {
  active: boolean;
  expired: boolean;
  expiresAt: string | null;
  licenseKey: string | null;
}

/**
 * Top-level license gate. Polls the backend's public license endpoint and
 * blocks the entire app behind a license activation screen when the system
 * is unlicensed or expired — even offline.
 */
function LicenseGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PublicLicenseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const check = useCallback(async () => {
    try {
      const s = await api.getPublicLicenseStatus();
      setStatus(s);
    } catch {
      // Backend unreachable — assume locked so users see the activation page
      // (they'll get the "Cannot reach server" warning inside).
      setStatus({ active: false, expired: false, expiresAt: null, licenseKey: null });
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    check();
    // Periodically re-validate license (every 5 min). If it expires while the
    // app is open, the user is bumped back to the activation screen.
    const t = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [check]);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status?.active) {
    return <LicenseActivationPage status={status} onActivated={check} />;
  }

  return <>{children}</>;
}

function SystemGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [deactivated, setDeactivated] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.getSystemStatus().then(s => {
      setDeactivated(s.deactivated);
      setChecked(true);
    }).catch(() => setChecked(true));
  }, []);

  if (!checked) return null;

  // If system is deactivated, only super_admin can access
  if (deactivated && user?.role !== 'super_admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3 max-w-md px-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <Loader2 className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-xl font-bold text-foreground">System Deactivated</h1>
          <p className="text-sm text-muted-foreground">This system has been temporarily deactivated by the administrator. Please contact your Super Admin for assistance.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Restoring session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/admin" element={<StaffLoginPage />} />
        <Route path="/" element={<StudentLoginPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  if (user.role === 'student') {
    return (
      <SystemGuard>
        <Routes>
          <Route path="*" element={<StudentExamPortal />} />
        </Routes>
      </SystemGuard>
    );
  }

  // Lab admin gets limited routes
  if (user.role === 'lab_admin') {
    return (
      <SystemGuard>
        <AdminLayout>
          <Routes>
            <Route path="/admin/dashboard" element={<DashboardPage />} />
            <Route path="/admin/exams" element={<ExamsPage />} />
            <Route path="/admin/exams/:examId/monitor" element={<ExamMonitoringPage />} />
            <Route path="/admin/results" element={<ResultsPage />} />
            <Route path="/admin/reports" element={<ReportsPage />} />
            <Route path="/admin/network" element={<NetworkMonitoringPage />} />
            <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
          </Routes>
        </AdminLayout>
      </SystemGuard>
    );
  }

  return (
    <SystemGuard>
      <AdminLayout>
        <Routes>
          <Route path="/admin/dashboard" element={<DashboardPage />} />
          <Route path="/admin/exams" element={<ExamsPage />} />
          <Route path="/admin/exams/:examId/monitor" element={<ExamMonitoringPage />} />
          <Route path="/admin/students" element={<StudentsPage />} />
          <Route path="/admin/questions" element={<QuestionsPage />} />
          <Route path="/admin/questions/create" element={<CreateQuestionPage />} />
          <Route path="/admin/questions/ai-generate" element={<AIQuestionGeneratorPage />} />
          <Route path="/admin/results" element={<ResultsPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/departments" element={<DepartmentsPage />} />
          <Route path="/admin/schools" element={<SchoolsPage />} />
          <Route path="/admin/courses" element={<CoursesPage />} />
          <Route path="/admin/reports" element={<ReportsPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
          <Route path="/admin/audit-log" element={<AuditLogPage />} />
          <Route path="/admin/grade-essays" element={<GradeEssayPage />} />
          <Route path="/admin/network" element={<NetworkMonitoringPage />} />
          <Route path="/admin/sync" element={<SyncPage />} />
          <Route path="/admin/license" element={<LicensePage />} />
          <Route path="/admin/system-health" element={<SystemHealthPage />} />
          <Route path="/admin/backups" element={<BackupsPage />} />
          <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/dashboard" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AdminLayout>
    </SystemGuard>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <LicenseGate>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </LicenseGate>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
