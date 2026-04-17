import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { User, UserRole, Exam } from "@/lib/types";
import { api, getAuthToken } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  activeExam: Exam | null;
  attemptId: string | null;
  startedAt: string | null;
  isLoading: boolean;
  error: string | null;
  loginStaff: (email: string, password: string) => Promise<boolean>;
  loginStudent: (matricNumber: string, examPin: string) => Promise<boolean>;
  logout: () => void;
  hasRole: (role: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      api
        .getMe()
        .then((result) => {
          if (result) {
            setUser(result.user);
            if (result.exam) setActiveExam(result.exam);
            if (result.attemptId) setAttemptId(result.attemptId);
            // startedAt can be null (not yet begun)
            setStartedAt(result.startedAt ?? null);
          }
        })
        .catch(() => {
          api.logout();
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const loginStaff = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.loginStaff(email, password);
      if (result) {
        setUser(result);
        return true;
      }
      setError("Invalid credentials. Please try again.");
      return false;
    } catch (err: any) {
      setError(err?.message || "Login failed. Please try again.");
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginStudent = useCallback(
    async (matricNumber: string, examPin: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { getDeviceFingerprint } = await import("@/lib/fingerprint");
        const fp = await getDeviceFingerprint().catch(() => undefined);
        const result = await api.loginStudent(matricNumber, examPin, fp);
        if (result) {
          setUser(result.user);
          setActiveExam(result.exam);
          setAttemptId(result.attemptId);
          setStartedAt(result.startedAt); // Could be null
          return true;
        }
        setError("Invalid Registration Number or exam PIN.");
        return false;
      } catch (err: any) {
        setError(err?.message || "Login failed. Please try again.");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    setUser(null);
    setActiveExam(null);
    setAttemptId(null);
    setStartedAt(null);
    setError(null);
    api.logout();
  }, []);

  const hasRole = useCallback(
    (role: UserRole | UserRole[]) => {
      if (!user) return false;
      return Array.isArray(role)
        ? role.includes(user.role)
        : user.role === role;
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        activeExam,
        attemptId,
        startedAt,
        isLoading,
        error,
        loginStaff,
        loginStudent,
        logout,
        hasRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
