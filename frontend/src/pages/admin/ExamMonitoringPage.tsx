import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, Monitor, Users, Clock, CheckCircle, RefreshCw, RotateCcw, Loader2, Send, AlertTriangle, ShieldAlert, Smartphone } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';

interface MonitoringStudent {
  attemptId: string; studentId: string; studentName: string; regNumber: string;
  status: string; startedAt: string; submittedAt: string | null; score: number | null;
  answeredCount: number; totalQuestions: number; progress: number; remainingSeconds: number;
  deviceFingerprint?: string | null;
  deviceLockedAt?: string | null;
}

interface MonitoringData {
  examId: string; examTitle: string; course: string; duration: number; totalQuestions: number;
  activeStudents: number; submittedStudents: number; totalEnrolled: number;
  students: MonitoringStudent[];
  deviceMismatches?: number;
}

export default function ExamMonitoringPage() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetStudent, setResetStudent] = useState<MonitoringStudent | null>(null);
  const [submitStudent, setSubmitStudent] = useState<MonitoringStudent | null>(null);
  const [resetting, setResetting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isLabAdmin = user?.role === 'lab_admin';

  const load = () => {
    if (!examId) return;
    api.getExamMonitoring(examId).then((d: any) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); const interval = setInterval(load, 10000); return () => clearInterval(interval); }, [examId]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleReset = async () => {
    if (!resetStudent || !examId) return;
    setResetting(true);
    try {
      await api.resetExamAttempt(examId, resetStudent.studentId);
      toast.success(`Exam reset for ${resetStudent.studentName}. They can retry.`);
      load();
    } catch (err: any) { toast.error(err.message || 'Failed to reset'); }
    finally { setResetting(false); setResetStudent(null); }
  };

  const handleForceSubmit = async () => {
    if (!submitStudent) return;
    setSubmitting(true);
    try {
      const result = await api.forceSubmitAttempt(submitStudent.attemptId);
      toast.success(`Exam submitted for ${submitStudent.studentName}. Score: ${result.score}/${result.total}`);
      load();
    } catch (err: any) { toast.error(err.message || 'Failed to submit'); }
    finally { setSubmitting(false); setSubmitStudent(null); }
  };

  const statusBadge = (status: string) => {
    if (status === 'in_progress') return <Badge className="bg-success/10 text-success">Active</Badge>;
    if (status === 'submitted') return <Badge className="bg-primary/10 text-primary">Submitted</Badge>;
    if (status === 'graded') return <Badge className="bg-accent/10 text-accent">Graded</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-12 text-muted-foreground">Exam not found</div>;

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/admin/exams')}><ArrowLeft className="w-5 h-5" /></Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Monitor className="w-6 h-6" /> Live Monitoring</h1>
          <p className="text-sm text-muted-foreground">{data.examTitle} · {data.course} · Auto-refreshes every 10s</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={load}><RefreshCw className="w-4 h-4" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center"><Users className="w-5 h-5 text-success" /></div>
              <div><p className="text-2xl font-bold text-foreground">{data.activeStudents}</p><p className="text-xs text-muted-foreground">Active Now</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><CheckCircle className="w-5 h-5 text-primary" /></div>
              <div><p className="text-2xl font-bold text-foreground">{data.submittedStudents}</p><p className="text-xs text-muted-foreground">Submitted</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center"><Users className="w-5 h-5 text-accent" /></div>
              <div><p className="text-2xl font-bold text-foreground">{data.totalEnrolled}</p><p className="text-xs text-muted-foreground">Total Enrolled</p></div>
            </div>
          </CardContent>
        </Card>
        <Card className={`border-border/40 ${(data.deviceMismatches || 0) > 0 ? 'border-destructive/50 bg-destructive/5' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${(data.deviceMismatches || 0) > 0 ? 'bg-destructive/10' : 'bg-warning/10'}`}>
                <ShieldAlert className={`w-5 h-5 ${(data.deviceMismatches || 0) > 0 ? 'text-destructive' : 'text-warning'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{data.deviceMismatches || 0}</p>
                <p className="text-xs text-muted-foreground">Device Mismatches</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/40">
        <CardHeader><CardTitle className="text-base">Student Progress</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead><TableHead>Matric No.</TableHead><TableHead>Status</TableHead>
                <TableHead>Progress</TableHead><TableHead>Remaining</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TooltipProvider>
                {data.students.map(s => (
                  <TableRow key={s.attemptId} className={(s.deviceMismatchCount || 0) > 0 ? 'bg-destructive/5' : ''}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        {s.studentName}
                        {(s.deviceMismatchCount || 0) > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <ShieldAlert className="w-4 h-4 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{s.deviceMismatchCount} blocked login attempt{s.deviceMismatchCount! > 1 ? 's' : ''} from a different device</p>
                              {s.lastDeviceMismatchAt && <p className="text-xs text-muted-foreground">Last: {new Date(s.lastDeviceMismatchAt).toLocaleString()}</p>}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{s.regNumber}</TableCell>
                    <TableCell>{statusBadge(s.status)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress value={s.progress} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-12">{s.answeredCount}/{s.totalQuestions}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.status === 'in_progress' ? (
                        <span className={`text-sm font-mono ${s.remainingSeconds < 300 ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                          {formatTime(s.remainingSeconds)}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {s.deviceFingerprint ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                              <Smartphone className="w-3 h-3" />
                              {s.deviceFingerprint.slice(0, 8)}…
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs font-mono">{s.deviceFingerprint}</p>
                            {s.deviceLockedAt && <p className="text-xs text-muted-foreground">Locked: {new Date(s.deviceLockedAt).toLocaleString()}</p>}
                          </TooltipContent>
                        </Tooltip>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{s.score !== null ? `${s.score}` : '—'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {s.status === 'in_progress' && (
                        <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={() => setSubmitStudent(s)} title="Force Submit">
                          <Send className="w-3.5 h-3.5" /> Submit
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="gap-1 text-warning" onClick={() => setResetStudent(s)} title="Reset/Allow Retry">
                        <RotateCcw className="w-3.5 h-3.5" /> Reset
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TooltipProvider>
              {data.students.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No students have started the exam yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Reset Dialog */}
      <AlertDialog open={!!resetStudent} onOpenChange={() => setResetStudent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-warning" /> Reset Exam Attempt</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>delete all answers</strong> and the attempt for <strong>{resetStudent?.studentName}</strong> ({resetStudent?.regNumber}).
              Their PIN will be reset so they can retake the exam. <strong>This cannot be undone.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetting} className="bg-warning text-warning-foreground hover:bg-warning/90">
              {resetting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Reset Attempt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force Submit Dialog */}
      <AlertDialog open={!!submitStudent} onOpenChange={() => setSubmitStudent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-destructive" /> Force Submit Exam</AlertDialogTitle>
            <AlertDialogDescription>
              This will <strong>immediately submit</strong> the exam for <strong>{submitStudent?.studentName}</strong> ({submitStudent?.regNumber}).
              Their current answers will be graded. <strong>The student cannot continue after this.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceSubmit} disabled={submitting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Force Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
