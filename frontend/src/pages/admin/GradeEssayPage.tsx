import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import type { Exam, ExamAttempt } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle, Clock, FileText, MessageSquare, Save, BookOpen, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface EssayAnswer {
  questionId: string;
  questionText: string;
  answer: string;
  type: string;
  correctAnswer: any;
  essayScore?: number;
  essayFeedback?: string;
}

interface GradingEntry {
  attemptId: string;
  studentName: string;
  regNumber: string;
  examTitle: string;
  examId: string;
  maxMarks: number;
  status: "pending" | "graded";
  hasEssayQuestions: boolean;
}

export default function GradeEssayPage() {
  const [selectedExam, setSelectedExam] = useState("");
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [gradingDialog, setGradingDialog] = useState<GradingEntry | null>(null);
  const [essayAnswers, setEssayAnswers] = useState<EssayAnswer[]>([]);
  const [grades, setGrades] = useState<Record<string, { score: string; feedback: string }>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getExams().then(setExams).catch(() => toast.error("Could not load exams"));
    api.getAttempts().then(setAttempts).catch(() => toast.error("Could not load submissions"));
  }, []);

  const essayEntries: GradingEntry[] = attempts
    .filter((a) => a.status === "submitted" || a.status === "graded")
    .filter((a) => !selectedExam || selectedExam === "all" || a.examId === selectedExam)
    .map((a) => {
      const exam = exams.find((e) => e.id === a.examId);
      return {
        attemptId: a.id,
        studentName: (a as any).studentName || a.studentId,
        regNumber: (a as any).regNumber || "",
        examTitle: exam?.title || "Unknown",
        examId: a.examId,
        maxMarks: exam?.totalMarks || 20,
        status: a.status === "graded" ? "graded" : "pending",
        hasEssayQuestions: true,
      };
    });

  const groupedByExam = useMemo(() => {
    const map = new Map<string, { examTitle: string; entries: GradingEntry[] }>();
    for (const e of essayEntries) {
      if (!map.has(e.examId)) map.set(e.examId, { examTitle: e.examTitle, entries: [] });
      map.get(e.examId)!.entries.push(e);
    }
    return map;
  }, [essayEntries]);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  const openGrading = async (entry: GradingEntry) => {
    try {
      const answers = await api.getEssayAnswers(entry.attemptId);
      if (answers.length === 0) {
        toast.info("No essay/short answer questions found for this attempt");
        return;
      }
      setEssayAnswers(answers);
      const existingGrades: Record<string, { score: string; feedback: string }> = {};
      answers.forEach(a => {
        if (a.essayScore !== undefined && a.essayScore !== null) {
          existingGrades[a.questionId] = { score: String(a.essayScore), feedback: a.essayFeedback || '' };
        }
      });
      setGrades(existingGrades);
      setGradingDialog(entry);
    } catch {
      toast.error("Failed to load essay answers");
    }
  };

  const saveGrades = async () => {
    if (!gradingDialog) return;
    let saved = 0;
    for (const ea of essayAnswers) {
      const g = grades[ea.questionId];
      if (!g || g.score === '') continue;
      const marks = parseFloat(g.score);
      if (isNaN(marks) || marks < 0) {
        toast.error("Invalid marks entered. Please check scores.");
        return;
      }
      try {
        await api.gradeEssay({
          attemptId: gradingDialog.attemptId,
          questionId: ea.questionId,
          score: marks,
          feedback: g.feedback,
        });
        saved++;
      } catch {
        toast.error("Failed to save grade. Please try again.");
        return;
      }
    }
    toast.success(`${saved} essay question(s) graded`);
    setGradingDialog(null);
    setEssayAnswers([]);
    setGrades({});
    api.getAttempts().then(setAttempts).catch(() => {});
  };

  const pendingCount = essayEntries.filter((e) => e.status === "pending").length;
  const gradedCount = essayEntries.filter((e) => e.status === "graded").length;

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Essay Grading</h1>
        <p className="text-sm text-muted-foreground">Grade essay and short answer questions — grouped by exam</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="stat-card"><Clock className="w-5 h-5 text-warning mb-2" /><p className="text-2xl font-bold text-foreground">{pendingCount}</p><p className="text-xs text-muted-foreground mt-1">Pending Review</p></div>
        <div className="stat-card"><CheckCircle className="w-5 h-5 text-success mb-2" /><p className="text-2xl font-bold text-foreground">{gradedCount}</p><p className="text-xs text-muted-foreground mt-1">Graded</p></div>
        <div className="stat-card"><FileText className="w-5 h-5 text-accent mb-2" /><p className="text-2xl font-bold text-foreground">{essayEntries.length}</p><p className="text-xs text-muted-foreground mt-1">Total Submissions</p></div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={selectedExam} onValueChange={setSelectedExam}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Filter by exam" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exams</SelectItem>
            {exams.map((e) => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Nested data table grouped by exam */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-8"></TableHead>
              <TableHead>Student Name</TableHead>
              <TableHead>Reg. No.</TableHead>
              <TableHead>Obj. Score</TableHead>
              <TableHead>Essay Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupedByExam.size === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">No submissions found</TableCell></TableRow>
            )}
            {Array.from(groupedByExam.entries()).map(([examId, { examTitle, entries }]) => {
              const isExpanded = expandedGroups.has(examId);
              const pending = entries.filter(e => e.status === "pending").length;
              return (
                <>
                  <TableRow
                    key={`hdr-${examId}`}
                    className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-t-2 border-border"
                    onClick={() => toggleGroup(examId)}
                  >
                    <TableCell className="px-3">
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </TableCell>
                    <TableCell colSpan={6}>
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-foreground">{examTitle}</span>
                        <Badge variant="secondary" className="text-xs">{entries.length} submission{entries.length !== 1 ? "s" : ""}</Badge>
                        {pending > 0 && <Badge variant="outline" className="text-xs text-warning border-warning">{pending} pending</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && entries.map((entry, i) => {
                    const attempt = attempts.find(a => a.id === entry.attemptId);
                    return (
                      <TableRow key={`${examId}-${i}`} className="hover:bg-muted/10">
                        <TableCell></TableCell>
                        <TableCell className="font-medium">{entry.studentName}</TableCell>
                        <TableCell className="font-mono text-sm">{entry.regNumber || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {attempt?.score !== undefined ? `${attempt.score}/${attempt.totalMarks || 0}` : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {(attempt as any)?.essayScore > 0 ? (attempt as any).essayScore : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={entry.status === "graded" ? "default" : "secondary"}>
                            {entry.status === "graded" ? "Graded" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant={entry.status === "graded" ? "outline" : "default"} onClick={() => openGrading(entry)}>
                            <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                            {entry.status === "graded" ? "Review" : "Grade"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Grading dialog */}
      <Dialog open={!!gradingDialog} onOpenChange={(open) => { if (!open) { setGradingDialog(null); setEssayAnswers([]); setGrades({}); } }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-accent" /> Grade Essay Questions
            </DialogTitle>
          </DialogHeader>
          {gradingDialog && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-muted-foreground">Student:</span> <strong>{gradingDialog.studentName}</strong></div>
                <div><span className="text-muted-foreground">Matric:</span> <strong>{gradingDialog.regNumber}</strong></div>
                <div><span className="text-muted-foreground">Exam:</span> <strong>{gradingDialog.examTitle}</strong></div>
              </div>
              <p className="text-xs text-muted-foreground bg-muted p-2 rounded">
                Only essay and short answer questions are shown below.
              </p>
              <div className="space-y-4">
                {essayAnswers.map((ea, idx) => (
                  <div key={ea.questionId} className="p-4 rounded-lg border space-y-3">
                    <p className="text-sm font-medium text-foreground">Q{idx + 1}: {ea.questionText}</p>
                    <div className="bg-muted p-3 rounded text-sm text-muted-foreground whitespace-pre-wrap">
                      {ea.answer || <em className="text-muted-foreground/50">No answer provided</em>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Score</label>
                        <Input type="number" min={0}
                          value={grades[ea.questionId]?.score || ''}
                          onChange={(e) => setGrades(prev => ({ ...prev, [ea.questionId]: { ...prev[ea.questionId], score: e.target.value, feedback: prev[ea.questionId]?.feedback || '' } }))}
                          placeholder="Marks" />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-foreground mb-1 block">Feedback</label>
                        <Input
                          value={grades[ea.questionId]?.feedback || ''}
                          onChange={(e) => setGrades(prev => ({ ...prev, [ea.questionId]: { ...prev[ea.questionId], feedback: e.target.value, score: prev[ea.questionId]?.score || '' } }))}
                          placeholder="Optional feedback" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setGradingDialog(null); setEssayAnswers([]); setGrades({}); }}>Cancel</Button>
            <Button onClick={saveGrades} className="gap-1.5"><Save className="w-4 h-4" /> Save All Grades</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
