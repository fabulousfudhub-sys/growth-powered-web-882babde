import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import type { Exam } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Plus, Search, Clock, Users, FileText, Eye, Pencil, Trash2, Download,
  Monitor, RefreshCw, KeyRound, Copy, Play, Square,
} from "lucide-react";
import CreateExamDialog from "@/components/dialogs/CreateExamDialog";
import EditExamDialog from "@/components/dialogs/EditExamDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface ExamExtended extends Exam {
  pinMode?: "individual" | "shared";
  sharedPin?: string;
}

export default function ExamsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<ExamExtended[]>([]);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editExam, setEditExam] = useState<Exam | null>(null);
  const [previewExam, setPreviewExam] = useState<ExamExtended | null>(null);
  const [deleteExam, setDeleteExam] = useState<Exam | null>(null);
  const [stopExam, setStopExam] = useState<ExamExtended | null>(null);

  const isLabAdmin = user?.role === 'lab_admin';
  const canCreateExam = !isLabAdmin && user?.role !== "instructor";
  const canDeleteExam = !isLabAdmin;
  const canEditExam = !isLabAdmin;

  const load = () => {
    if (user?.role === "examiner") {
      api.getExams(user.department).then(setExams);
    } else {
      api.getExams().then(setExams);
    }
  };
  useEffect(load, [user]);

  const filtered = exams.filter(
    (e) =>
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.course.toLowerCase().includes(search.toLowerCase()),
  );

  const statusColor: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    scheduled: "bg-primary/10 text-primary",
    active: "bg-success/10 text-success",
    completed: "bg-secondary text-secondary-foreground",
  };

  const handleDelete = async () => {
    if (!deleteExam) return;
    try {
      await api.deleteExam(deleteExam.id);
      toast.success("Exam deleted");
      setExams((prev) => prev.filter((e) => e.id !== deleteExam.id));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete exam");
    }
    setDeleteExam(null);
  };

  const handleStatusToggle = async (exam: ExamExtended) => {
    if (exam.status === 'active') {
      // Show confirmation dialog for stopping
      setStopExam(exam);
      return;
    }
    // Starting exam — no confirmation needed
    try {
      await api.updateExamStatus(exam.id, 'active');
      toast.success("Exam started");
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to start exam');
    }
  };

  const handleStopExam = async () => {
    if (!stopExam) return;
    try {
      const result = await api.updateExamStatus(stopExam.id, 'completed');
      toast.success("Exam stopped. All active attempts have been auto-submitted and students logged out.");
      load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to stop exam');
    }
    setStopExam(null);
  };

  const handleDownloadPins = async (exam: Exam) => {
    try {
      const pins = await api.getExamPins(exam.id);
      if (pins.length === 0) {
        toast.error("No PINs generated for this exam");
        return;
      }
      const csv = [
        "Student Name,Reg. Number,Exam PIN,Used",
        ...pins.map((p) => `${p.studentName},${p.matricNumber},${p.pin},${p.used}`),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exam.title}_pins.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download PINs");
    }
  };

  const handleReassignQuestions = async (exam: Exam) => {
    try {
      const result = await api.assignExamQuestions(exam.id);
      toast.success(`${result.assigned} questions assigned to exam`);
    } catch (err: any) {
      toast.error(err.message || "Failed to assign questions");
    }
  };

  const marksPerQ = (exam: Exam) => (exam.totalMarks / exam.questionsToAnswer).toFixed(1);

  const copyPin = (pin: string) => {
    navigator.clipboard.writeText(pin);
    toast.success("PIN copied!");
  };

  const formatDateTime = (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isLabAdmin ? "Exam Operations" : user?.role === "examiner" ? "Exam Creation" : "Exam Management"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isLabAdmin ? "Start, stop, and monitor exams" : user?.role === "examiner" ? `Manage exams for ${user.department}` : "Manage and schedule exams"}
          </p>
        </div>
        {canCreateExam && (
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Create Exam
          </Button>
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search exams..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-4">
        {filtered.map((exam) => (
          <Card key={exam.id} className="hover:shadow-md transition-shadow border-border/40">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{exam.title}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">{exam.course} · {exam.department} · {exam.level}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge className={statusColor[exam.status]}>{exam.status}</Badge>
                  {(exam as any).examType === "ca" && <Badge variant="outline" className="text-xs bg-warning/10 text-warning">CA{(exam as any).caNumber || ""}</Badge>}
                  {exam.pinMode === "shared" && <Badge variant="outline" className="text-xs">Shared PIN</Badge>}

                  {(exam.status === 'active' || exam.status === 'scheduled' || exam.status === 'draft') && (
                    <Button variant="ghost" size="icon" className={`h-8 w-8 ${exam.status === 'active' ? 'text-destructive' : 'text-success'}`}
                      onClick={() => handleStatusToggle(exam)}
                      title={exam.status === 'active' ? 'Stop Exam' : 'Start Exam'}>
                      {exam.status === 'active' ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                  )}

                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewExam(exam)} title="Preview">
                    <Eye className="w-4 h-4" />
                  </Button>
                  {canEditExam && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditExam(exam)} title="Edit">
                      <Pencil className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDownloadPins(exam)} title="Download PINs">
                    <Download className="w-4 h-4" />
                  </Button>
                  {!isLabAdmin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleReassignQuestions(exam)} title="Reassign Questions">
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                  {(exam.status === "active" || exam.status === "scheduled") && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary"
                      onClick={() => navigate(`/admin/exams/${exam.id}/monitor`)} title="Monitor">
                      <Monitor className="w-4 h-4" />
                    </Button>
                  )}
                  {canDeleteExam && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteExam(exam)} title="Delete">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" />{exam.duration} min</span>
                <span className="flex items-center gap-1"><FileText className="w-4 h-4" />{exam.questionsToAnswer}/{exam.totalQuestions} questions</span>
                <span className="flex items-center gap-1"><Users className="w-4 h-4" />{exam.enrolledStudents} students</span>
                <span>Total: {exam.totalMarks} marks ({marksPerQ(exam)}/q)</span>
                {exam.pinMode === 'shared' && exam.sharedPin && (
                  <span className="flex items-center gap-1 text-accent font-medium">
                    <KeyRound className="w-4 h-4" /> PIN: {exam.sharedPin}
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyPin(exam.sharedPin!)}><Copy className="w-3 h-3" /></Button>
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground">
                  Start: {formatDateTime(exam.startDate)} · End: {formatDateTime(exam.endDate)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground">No exams found</div>}
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewExam} onOpenChange={() => setPreviewExam(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewExam?.title}</DialogTitle>
            <DialogDescription>{previewExam?.course} · {previewExam?.department} · {previewExam?.level}</DialogDescription>
          </DialogHeader>
          {previewExam && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-muted"><strong>Duration:</strong> {previewExam.duration} min</div>
                <div className="p-3 rounded-lg bg-muted"><strong>Total Marks:</strong> {previewExam.totalMarks}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>Questions:</strong> {previewExam.questionsToAnswer}/{previewExam.totalQuestions}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>Marks/Question:</strong> {marksPerQ(previewExam)}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>Students:</strong> {previewExam.enrolledStudents}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>PIN Mode:</strong> {previewExam.pinMode === "shared" ? "Shared" : "Individual"}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>Start:</strong> {formatDateTime(previewExam.startDate)}</div>
                <div className="p-3 rounded-lg bg-muted"><strong>End:</strong> {formatDateTime(previewExam.endDate)}</div>
              </div>
              {previewExam.pinMode === "shared" && previewExam.sharedPin && (
                <div className="flex items-center gap-3 p-4 rounded-lg border border-accent/20 bg-accent/5">
                  <KeyRound className="w-5 h-5 text-accent" />
                  <span className="text-sm font-medium">Shared Exam PIN:</span>
                  <Badge variant="outline" className="font-mono text-lg px-4 py-1">{previewExam.sharedPin}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => copyPin(previewExam.sharedPin!)}><Copy className="w-4 h-4" /></Button>
                </div>
              )}
              <div className="p-3 rounded-lg border text-sm">
                <strong>Instructions:</strong>
                <p className="mt-1 text-muted-foreground">{previewExam.instructions}</p>
              </div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPreviewExam(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={!!deleteExam} onOpenChange={() => setDeleteExam(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Exam</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteExam?.title}"? All associated PINs, attempts, and answers will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stop Exam Confirmation Dialog */}
      <AlertDialog open={!!stopExam} onOpenChange={() => setStopExam(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Square className="w-5 h-5" /> Stop Exam
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop <strong>"{stopExam?.title}"</strong>?
              <br /><br />
              This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li><strong>Auto-submit</strong> all active student exams immediately</li>
                <li><strong>Log out</strong> all students from this exam</li>
                <li>Mark the exam as <strong>completed</strong></li>
              </ul>
              <br />
              <strong className="text-destructive">This action cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStopExam} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Stop Exam & Submit All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canCreateExam && (
        <CreateExamDialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) load(); }} />
      )}
      {canEditExam && (
        <EditExamDialog open={!!editExam} onOpenChange={(o) => { if (!o) { setEditExam(null); load(); } }} exam={editExam} />
      )}
    </div>
  );
}
