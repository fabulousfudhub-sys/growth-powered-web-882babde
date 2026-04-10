import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, startAutoSave, stopAutoSave } from "@/lib/api";
import type { Question } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  AlertTriangle,
  CheckCircle,
  Send,
  GraduationCap,
  Lock,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ExamTimer from "@/components/exam/ExamTimer";
import QuestionRenderer from "@/components/exam/QuestionRenderer";
import QuestionNavigation from "@/components/exam/QuestionNavigation";
import { useExamKeyboard } from "@/components/exam/useExamKeyboard";

type Phase = "instructions" | "exam" | "submitted";

export default function StudentExamPortal() {
  const { user, activeExam, attemptId, startedAt, logout } = useAuth();
  const [phase, setPhase] = useState<Phase>("instructions");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [score, setScore] = useState<{ score: number; total: number } | null>(
    null,
  );
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showWarningDialog, setShowWarningDialog] = useState(false);
  const [unansweredCount, setUnansweredCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isResuming, setIsResuming] = useState(false);
  const submittingRef = useRef(false);
  const currentQSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const examAttemptId = attemptId || "";

  // Debounced save of current question index to server
  const saveCurrentQuestion = useCallback(
    (idx: number) => {
      if (currentQSaveTimer.current) clearTimeout(currentQSaveTimer.current);
      currentQSaveTimer.current = setTimeout(() => {
        if (examAttemptId)
          api.updateCurrentQuestion(examAttemptId, idx).catch(() => {});
      }, 500);
    },
    [examAttemptId],
  );

  useExamKeyboard({
    questions,
    currentQ,
    setCurrentQ: (updater) => {
      setCurrentQ((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        saveCurrentQuestion(next);
        return next;
      });
    },
    setAnswer: (qId, val) => {
      setAnswers((prev) => ({ ...prev, [qId]: val }));
      if (examAttemptId) api.saveAnswer(examAttemptId, qId, val);
    },
    answers,
    enabled: phase === "exam",
  });

  // Submit handler
  const handleSubmit = useCallback(async () => {
    if (!examAttemptId || submittingRef.current) return;
    submittingRef.current = true;
    stopAutoSave();
    try {
      const result = await api.submitExam(examAttemptId);
      setScore(result);
    } catch {}
    setPhase("submitted");
    // Stop status polling
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  }, [examAttemptId]);

  // Poll for force-submit / exam stop by admin (every 10s during exam phase)
  useEffect(() => {
    if (phase !== "exam" || !examAttemptId) return;
    statusPollRef.current = setInterval(async () => {
      try {
        const status = await api.checkAttemptStatus(examAttemptId);
        if (status.status === "submitted" || status.status === "graded") {
          // Admin force-submitted or exam was stopped
          setScore(
            status.score !== undefined
              ? { score: status.score, total: status.total_marks || 0 }
              : null,
          );
          setPhase("submitted");
          stopAutoSave();
          if (statusPollRef.current) clearInterval(statusPollRef.current);
        }
        if (status.exam_status === "completed") {
          // Exam was stopped by admin
          if (!submittingRef.current) {
            submittingRef.current = true;
            await handleSubmit();
          }
        }
      } catch {}
    }, 10000);
    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, [phase, examAttemptId, handleSubmit]);

  // Restore exam state from server on mount
  useEffect(() => {
    if (!activeExam || !examAttemptId) {
      setIsLoading(false);
      return;
    }

    const restoreState = async () => {
      try {
        const state = await api.getAttemptState(examAttemptId);

        if (state.status === "submitted" || state.status === "graded") {
          setPhase("submitted");
          setIsLoading(false);
          return;
        }

        if (state.status === "in_progress") {
          const durationSec = state.duration * 60;

          if (state.startedAt) {
            // Timer was already started
            const serverStart = new Date(state.startedAt).getTime();
            const elapsed = Math.floor((Date.now() - serverStart) / 1000);
            const remaining = Math.max(0, durationSec - elapsed);

            if (remaining <= 0) {
              submittingRef.current = true;
              await handleSubmit();
              setIsLoading(false);
              return;
            }

            // This is a resume
            setIsResuming(true);
            const qs = await api.getQuestionsByExam(activeExam.id);
            setQuestions(qs);
            setAnswers(state.answers || {});
            setCurrentQ(state.currentQuestion || 0);
            setTotalDuration(durationSec);
            setTimeLeft(remaining);
          } else {
            // Timer not yet started — fresh exam, show instructions
            // Pre-load questions for quick begin
            const hasAnswers = Object.keys(state.answers || {}).length > 0;
            if (hasAnswers) {
              setIsResuming(true);
              const qs = await api.getQuestionsByExam(activeExam.id);
              setQuestions(qs);
              setAnswers(state.answers || {});
              setCurrentQ(state.currentQuestion || 0);
              setTotalDuration(durationSec);
              setTimeLeft(durationSec); // Full time since not started
            }
          }
        }
      } catch {
        // No active attempt state
      }
      setIsLoading(false);
    };

    restoreState();
  }, [activeExam, examAttemptId]);

  // Timer countdown
  useEffect(() => {
    if (phase !== "exam" || !activeExam) return;

    const t = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (!submittingRef.current) {
            submittingRef.current = true;
            handleSubmit();
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, activeExam, handleSubmit]);

  // Anti-cheat + screenshot prevention
  useEffect(() => {
    if (phase !== "exam") return;
    const prevent = (e: Event) => e.preventDefault();
    const preventKeys = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        ["c", "v", "a", "x", "p", "s"].includes(e.key.toLowerCase())
      )
        e.preventDefault();
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I"))
        e.preventDefault();
      // Block PrintScreen / screenshot shortcuts
      if (e.key === "PrintScreen") {
        e.preventDefault();
        navigator.clipboard?.writeText?.("");
      }
      if (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key))
        e.preventDefault();
    };
    // Block visibility change (tab switching)
    const onVisibilityChange = () => {
      if (document.hidden) {
        // Could add warning counter here
      }
    };
    document.addEventListener("contextmenu", prevent);
    document.addEventListener("copy", prevent);
    document.addEventListener("paste", prevent);
    document.addEventListener("keydown", preventKeys);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.body.classList.add("screenshot-blocked");
    return () => {
      document.removeEventListener("contextmenu", prevent);
      document.removeEventListener("copy", prevent);
      document.removeEventListener("paste", prevent);
      document.removeEventListener("keydown", preventKeys);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.body.classList.remove("screenshot-blocked");
    };
  }, [phase]);

  const beginExam = async () => {
    if (!activeExam || !examAttemptId) return;

    if (isResuming && questions.length > 0) {
      // Resume — questions and answers already loaded, timer already calculated
      setPhase("exam");
      startAutoSave();
      return;
    }

    // Fresh start — call begin endpoint to set started_at on server
    try {
      const result = await api.beginExam(examAttemptId);
      const serverStart = new Date(result.startedAt).getTime();
      const dur = activeExam.duration * 60;
      const elapsed = Math.floor((Date.now() - serverStart) / 1000);
      const remaining = Math.max(0, dur - elapsed);

      const qs = await api.getQuestionsByExam(activeExam.id);
      setQuestions(qs);
      setTimeLeft(remaining);
      setTotalDuration(dur);
      setAnswers({});
      setCurrentQ(0);
      setPhase("exam");
      startAutoSave();
    } catch (err) {
      console.error("Failed to begin exam:", err);
    }
  };

  const goToFirstUnanswered = () => {
    const idx = questions.findIndex(
      (q) => !answers[q.id] || answers[q.id].trim() === "",
    );
    if (idx !== -1) {
      setCurrentQ(idx);
      saveCurrentQuestion(idx);
    }
  };

  const attemptSubmit = () => {
    const unanswered = questions.filter(
      (q) => !answers[q.id] || answers[q.id].trim() === "",
    ).length;
    if (unanswered > 0) {
      setUnansweredCount(unanswered);
      setShowWarningDialog(true);
    } else setShowSubmitDialog(true);
  };

  const setAnswer = (qId: string, val: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: val }));
    if (examAttemptId) api.saveAnswer(examAttemptId, qId, val);
  };

  const navigateQuestion = (idx: number) => {
    setCurrentQ(idx);
    saveCurrentQuestion(idx);
  };

  const marksPerQuestion = activeExam
    ? (activeExam.totalMarks / activeExam.questionsToAnswer).toFixed(1)
    : "0";
  const answeredCount = questions.filter(
    (q) => answers[q.id] && answers[q.id].trim() !== "",
  ).length;
  const isLastQuestion = currentQ === questions.length - 1;

  // Submit restrictions: 80% answered + 50% time elapsed
  const answeredPercent = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const timeElapsed = totalDuration - timeLeft;
  const timeElapsedPercent = totalDuration > 0 ? (timeElapsed / totalDuration) * 100 : 0;
  const canSubmit = answeredPercent >= 80 && timeElapsedPercent >= 50;
  const submitDisabledReason = !canSubmit
    ? answeredPercent < 80 && timeElapsedPercent < 50
      ? `Answer at least 80% of questions (${answeredCount}/${Math.ceil(questions.length * 0.8)}) and wait until 50% of exam time has elapsed`
      : answeredPercent < 80
        ? `Answer at least 80% of questions (${answeredCount}/${Math.ceil(questions.length * 0.8)} answered)`
        : `Wait until 50% of exam time has elapsed (${Math.round(timeElapsedPercent)}% elapsed)`
    : "";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading exam...</p>
      </div>
    );
  }

  if (!activeExam) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full text-center">
          <CardContent className="py-12 space-y-4">
            <AlertTriangle className="w-10 h-10 text-warning mx-auto" />
            <h2 className="text-xl font-bold text-foreground">
              No Active Exam
            </h2>
            <p className="text-muted-foreground">
              The exam PIN you used may be invalid or the exam is no longer
              active.
            </p>
            <Button onClick={logout} className="w-full">
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (phase === "instructions") {
    return (
      <div className="h-screen bg-background flex items-center justify-center p-4 overflow-hidden">
        <div className="w-full max-w-5xl flex gap-4 h-[min(90vh,640px)]">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 flex items-center justify-center">
                  <img
                    src="/logo.png"
                    alt="School Logo"
                    className="w-10 h-10 object-contain"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">ATAPOLY CBT</p>
                  <p className="text-sm font-medium text-foreground">
                    {user?.name} · {user?.regNumber}
                  </p>
                </div>
              </div>
              <CardTitle className="text-lg">{activeExam.title}</CardTitle>
              {isResuming && (
                <Badge className="bg-warning/10 text-warning w-fit mt-1">
                  Resuming — Your timer is still running
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3 overflow-auto">
              <div className="p-3 rounded-lg bg-muted space-y-1.5 text-sm">
                <p>
                  <strong>Course:</strong> {activeExam.course}
                </p>
                <p>
                  <strong>Department:</strong> {activeExam.department}
                </p>
                <p>
                  <strong>Level:</strong> {activeExam.level}
                </p>
                <p>
                  <strong>Duration:</strong> {activeExam.duration} minutes
                </p>
                <p>
                  <strong>Questions:</strong> {activeExam.questionsToAnswer} of{" "}
                  {activeExam.totalQuestions}
                </p>
                <p>
                  <strong>Total Marks:</strong> {activeExam.totalMarks} (
                  {marksPerQuestion} marks per question)
                </p>
                {isResuming && timeLeft > 0 && (
                  <p className="text-warning font-medium">
                    <strong>Time Remaining:</strong> {Math.floor(timeLeft / 60)}
                    m {timeLeft % 60}s
                  </p>
                )}
              </div>
              <div className="p-3 rounded-lg border flex-1">
                <h3 className="font-semibold mb-1.5 flex items-center gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-warning" />{" "}
                  Instructions
                </h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {activeExam.instructions ||
                    "No special instructions. Answer all questions within the time limit."}
                </p>
              </div>
            </CardContent>
          </Card>
          <div className="w-72 shrink-0 flex flex-col gap-3">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardContent className="pt-4 flex flex-col gap-3 flex-1 overflow-auto">
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20 text-sm">
                  <p className="font-medium text-destructive text-xs">
                    Important:
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-0.5 text-xs">
                    <li>
                      Timer starts when you click "
                      {isResuming ? "Continue Exam" : "Begin Exam"}"
                    </li>
                    <li>Timer continues even if you close the browser</li>
                    <li>Copy/paste and right-click are disabled</li>
                    <li>Your answers are auto-saved</li>
                    <li>Answer all questions before submitting</li>
                    <li>Exam auto-submits when time expires</li>
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-sm">
                  <p className="font-medium text-accent text-xs">
                    Keyboard Shortcuts:
                  </p>
                  <ul className="list-disc list-inside text-muted-foreground mt-1 space-y-0.5 text-xs">
                    <li>
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                        A-E
                      </kbd>{" "}
                      Select option
                    </li>
                    <li>
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                        ← →
                      </kbd>{" "}
                      Prev / Next
                    </li>
                    <li>
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                        P / N
                      </kbd>{" "}
                      Prev / Next
                    </li>
                    <li>
                      <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                        1-9, 0
                      </kbd>{" "}
                      Jump to question
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={logout}
                className="flex-1 h-10 text-sm"
              >
                <LogOut className="w-4 h-4 mr-1" /> Exit
              </Button>
              <Button onClick={beginExam} className="flex-1 h-10 text-sm">
                {isResuming ? "Continue Exam" : "Begin Exam"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "exam" && questions.length > 0) {
    const q = questions[currentQ];
    return (
      <div className="min-h-screen bg-background exam-mode">
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Logo"
              className="h-8 w-8 object-contain"
            />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {activeExam.title}
              </h2>
              <p className="text-xs text-muted-foreground">
                {activeExam.course} · {user?.regNumber} · {user?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              {answeredCount}/{questions.length} answered
            </span>
            <ExamTimer timeLeft={timeLeft} totalDuration={totalDuration} />
          </div>
        </div>
        <div className="w-full px-4 py-6 flex gap-6">
          <div className="flex-1 min-w-0">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">
                    Question {currentQ + 1} of {questions.length}
                  </Badge>
                  <Badge variant="secondary">{marksPerQuestion} marks</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <p className="text-foreground font-medium leading-relaxed">
                  {q.text}
                </p>
                <QuestionRenderer
                  question={q}
                  answer={answers[q.id] || ""}
                  onAnswer={(val) => setAnswer(q.id, val)}
                />
                <div className="flex items-center justify-between pt-4 border-t">
                  <Button
                    variant="outline"
                    disabled={currentQ === 0}
                    onClick={() => navigateQuestion(currentQ - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Button>
                  {isLastQuestion ? (
                    canSubmit ? (
                      <Button
                        onClick={attemptSubmit}
                        className="gap-1 bg-success hover:bg-success/90 text-success-foreground"
                      >
                        <Send className="w-4 h-4" /> Submit Exam
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              disabled
                              className="gap-1 opacity-50 cursor-not-allowed"
                            >
                              <Lock className="w-4 h-4" /> Submit Exam
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-center">
                          <p>{submitDisabledReason}</p>
                        </TooltipContent>
                      </Tooltip>
                    )
                  ) : (
                    <Button
                      onClick={() => navigateQuestion(currentQ + 1)}
                      className="gap-1"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="w-64 shrink-0 hidden lg:block">
            <QuestionNavigation
              questions={questions}
              answers={answers}
              currentQ={currentQ}
              onNavigate={navigateQuestion}
              answeredCount={answeredCount}
            />
          </div>
        </div>

        <AlertDialog
          open={showWarningDialog}
          onOpenChange={setShowWarningDialog}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" /> Unanswered
                Questions
              </AlertDialogTitle>
              <AlertDialogDescription>
                You still have{" "}
                <strong className="text-foreground">{unansweredCount}</strong>{" "}
                unanswered question{unansweredCount > 1 ? "s" : ""}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={goToFirstUnanswered}>
                Go Back & Answer
              </AlertDialogAction>
              <AlertDialogAction
                onClick={handleSubmit}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                Submit Anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit Exam?</AlertDialogTitle>
              <AlertDialogDescription>
                You have answered all {questions.length} questions. Are you sure
                you want to submit?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleSubmit}
                className="bg-success hover:bg-success/90 text-success-foreground"
              >
                Yes, Submit Exam
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (phase === "submitted") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full text-center">
          <CardContent className="py-12 space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              Exam Submitted!
            </h2>
            <p className="text-muted-foreground">
              Your answers have been recorded successfully.
            </p>
            {score && (
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-3xl font-bold text-foreground">
                  {score.score}/{score.total}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Score</p>
              </div>
            )}
            <Button onClick={logout} className="w-full mt-4">
              Exit Exam
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <p className="text-muted-foreground">Loading exam...</p>
    </div>
  );
}
