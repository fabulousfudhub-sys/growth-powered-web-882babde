import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { ExamAttempt, Exam, Course } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Download, BarChart3, Search, TrendingUp, Users, CheckCircle, ChevronDown, BookOpen,
} from "lucide-react";
import Pagination from "@/components/admin/Pagination";
import { toast } from "sonner";

const PAGE_SIZE = 20;

interface ExtendedAttempt extends ExamAttempt {
  studentName?: string;
  regNumber?: string;
  examTitle?: string;
  courseCode?: string;
  courseId?: string;
  examType?: "exam" | "ca";
  caNumber?: number;
  essayScore?: number;
  department?: string;
  level?: string;
}

interface CourseGroup {
  courseCode: string;
  courseId: string;
  students: Map<string, {
    studentName: string;
    regNumber: string;
    caScores: { caNumber: number; score: number; totalMarks: number }[];
    examScore?: { score: number; totalMarks: number };
    department?: string;
    level?: string;
  }>;
}

export default function ResultsPage() {
  const { user } = useAuth();
  const [attempts, setAttempts] = useState<ExtendedAttempt[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");
  const [filterExam, setFilterExam] = useState("all");
  const [filterCourse, setFilterCourse] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewMode, setViewMode] = useState<"list" | "course">("list");
  const [page, setPage] = useState(1);
  const [openCourses, setOpenCourses] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getAttempts().then(setAttempts);
    api.getCourses().then(setCourses);
    if (user?.role === "examiner") {
      api.getExams(user.department).then(setExams);
    } else if (user?.role === "instructor") {
      api.getCourses().then((cs) => {
        const myCourses = cs.filter((c) => c.instructorId === user.id).map((c) => c.code);
        api.getExams().then((allExams) => setExams(allExams.filter((e) => myCourses.includes(e.course))));
      });
    } else {
      api.getExams().then(setExams);
    }
  }, [user]);

  const getExamTitle = (id: string) => exams.find((e) => e.id === id)?.title || "Unknown";

  const roleFilteredAttempts =
    user?.role === "examiner" || user?.role === "instructor"
      ? attempts.filter((a) => exams.some((e) => e.id === a.examId))
      : attempts;

  const filteredAttempts = roleFilteredAttempts.filter((a) => {
    const matchSearch = !search || (
      getExamTitle(a.examId).toLowerCase().includes(search.toLowerCase()) ||
      (a as any).studentName?.toLowerCase().includes(search.toLowerCase()) ||
      (a as any).regNumber?.toLowerCase().includes(search.toLowerCase())
    );
    const matchExam = filterExam === "all" || a.examId === filterExam;
    const matchCourse = filterCourse === "all" || (a as any).courseCode === filterCourse;
    const matchStatus = filterStatus === "all" || a.status === filterStatus;
    return matchSearch && matchExam && matchCourse && matchStatus;
  });

  const totalPages = Math.ceil(filteredAttempts.length / PAGE_SIZE);
  const paginatedAttempts = filteredAttempts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const avgScore =
    roleFilteredAttempts.length > 0
      ? Math.round(roleFilteredAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / roleFilteredAttempts.length)
      : 0;

  // Course-wise grouped view
  const courseGroups = useMemo(() => {
    const groups = new Map<string, CourseGroup>();
    for (const a of filteredAttempts) {
      const ext = a as ExtendedAttempt;
      const courseCode = ext.courseCode || "Unknown";
      const courseId = ext.courseId || "";
      if (!groups.has(courseCode)) {
        groups.set(courseCode, { courseCode, courseId, students: new Map() });
      }
      const group = groups.get(courseCode)!;
      const studentKey = ext.studentId;
      if (!group.students.has(studentKey)) {
        group.students.set(studentKey, {
          studentName: ext.studentName || ext.studentId,
          regNumber: ext.regNumber || "—",
          caScores: [],
          department: ext.department,
          level: ext.level,
        });
      }
      const student = group.students.get(studentKey)!;
      if (ext.examType === "ca") {
        student.caScores.push({
          caNumber: ext.caNumber || 1,
          score: ext.score || 0,
          totalMarks: ext.totalMarks || 0,
        });
      } else {
        student.examScore = { score: ext.score || 0, totalMarks: ext.totalMarks || 0 };
      }
    }
    return Array.from(groups.values());
  }, [filteredAttempts]);

  const toggleCourseOpen = (code: string) => {
    setOpenCourses(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const getCourseConfig = (courseCode: string) => {
    return courses.find(c => c.code === courseCode);
  };

  const handleExport = () => {
    const csv = [
      "Student Name,Reg. Number,Exam,Type,Score,Total Marks,Essay Score,Status,Submitted At",
      ...filteredAttempts.map(
        (a) => {
          const ext = a as ExtendedAttempt;
          return `"${ext.studentName || a.studentId}","${ext.regNumber || ""}","${getExamTitle(a.examId)}",${ext.examType || "exam"},${a.score || 0},${a.totalMarks || 0},${ext.essayScore || 0},${a.status},"${a.submittedAt ? new Date(a.submittedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : ""}"`;
        }
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "exam_results.csv";
    el.click();
    URL.revokeObjectURL(url);
    toast.success("Results exported");
  };

  // Get unique course codes for filter
  const uniqueCourses = [...new Set(roleFilteredAttempts.map(a => (a as any).courseCode).filter(Boolean))].sort();

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Results</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "instructor" ? "Results for your courses" : "View exam results and performance"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={viewMode === "list" ? "default" : "outline"} size="sm" onClick={() => setViewMode("list")}>
            List View
          </Button>
          <Button variant={viewMode === "course" ? "default" : "outline"} size="sm" onClick={() => setViewMode("course")}>
            <BookOpen className="w-4 h-4 mr-1" /> Course View
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card">
          <Users className="w-5 h-5 text-accent mb-2" />
          <p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Submissions</p>
        </div>
        <div className="stat-card">
          <TrendingUp className="w-5 h-5 text-primary mb-2" />
          <p className="text-2xl font-bold text-foreground">{avgScore}%</p>
          <p className="text-xs text-muted-foreground mt-1">Average Score</p>
        </div>
        <div className="stat-card">
          <CheckCircle className="w-5 h-5 text-success mb-2" />
          <p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.filter((a) => a.status === "graded").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Graded</p>
        </div>
        <div className="stat-card">
          <BarChart3 className="w-5 h-5 text-warning mb-2" />
          <p className="text-2xl font-bold text-foreground">{exams.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Exams</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by exam, student name or matric..." className="pl-10"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select value={filterCourse} onValueChange={(v) => { setFilterCourse(v); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter by course" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {uniqueCourses.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterExam} onValueChange={(v) => { setFilterExam(v); setPage(1); }}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Filter by exam" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Exams</SelectItem>
            {exams.map(e => <SelectItem key={e.id} value={e.id}>{e.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="graded">Graded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List View */}
      {viewMode === "list" && (
        <>
          <Card className="border-border/40 shadow-sm">
            <CardContent className="p-0">
              <ScrollArea className="max-h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Student Name</TableHead>
                      <TableHead>Reg. No.</TableHead>
                      <TableHead>Exam</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Essay Score</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAttempts.map((a) => {
                      const ext = a as ExtendedAttempt;
                      return (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{ext.studentName || a.studentId}</TableCell>
                          <TableCell className="font-mono text-sm">{ext.regNumber || "—"}</TableCell>
                          <TableCell>{getExamTitle(a.examId)}</TableCell>
                          <TableCell>
                            <Badge variant={ext.examType === "ca" ? "secondary" : "default"} className="text-xs">
                              {ext.examType === "ca" ? `CA${ext.caNumber || ""}` : "Exam"}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono font-semibold">
                            {a.score !== undefined ? (
                              <span className={a.score / (a.totalMarks || 1) >= 0.5 ? "text-success" : "text-destructive"}>
                                {a.score}/{a.totalMarks}
                              </span>
                            ) : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {ext.essayScore && ext.essayScore > 0 ? ext.essayScore : "0"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={a.status === "graded" ? "default" : "secondary"}>{a.status}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {a.submittedAt ? new Date(a.submittedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {paginatedAttempts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No results found</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} totalItems={filteredAttempts.length} pageSize={PAGE_SIZE} />
        </>
      )}

      {/* Course-wise View */}
      {viewMode === "course" && (
        <div className="space-y-4">
          {courseGroups.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">No results found</div>
          )}
          {courseGroups.map(group => {
            const courseConfig = getCourseConfig(group.courseCode);
            const caWeight = courseConfig?.caWeight ?? 30;
            const examWeight = courseConfig?.examWeight ?? 70;
            const isOpen = openCourses.has(group.courseCode);

            return (
              <Collapsible key={group.courseCode} open={isOpen} onOpenChange={() => toggleCourseOpen(group.courseCode)}>
                <Card className="border-border/40">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <BookOpen className="w-5 h-5 text-primary" />
                          <div>
                            <CardTitle className="text-base">{group.courseCode}</CardTitle>
                            <p className="text-xs text-muted-foreground">
                              {group.students.size} student(s) · CA: {caWeight}% · Exam: {examWeight}%
                            </p>
                          </div>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="p-0">
                      <ScrollArea className="max-h-[400px]">
                        <Table>
                          <TableHeader>
                            <TableRow className="hover:bg-transparent">
                              <TableHead>Student</TableHead>
                              <TableHead>Reg. No.</TableHead>
                              <TableHead>CA Score(s)</TableHead>
                              <TableHead>Exam Score</TableHead>
                              <TableHead>Combined</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {Array.from(group.students.entries()).map(([studentId, student]) => {
                              const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
                              const caTotalMarks = student.caScores.reduce((sum, ca) => sum + ca.totalMarks, 0);
                              const caPercent = caTotalMarks > 0 ? (caTotal / caTotalMarks) * 100 : 0;
                              const examPercent = student.examScore
                                ? (student.examScore.score / (student.examScore.totalMarks || 1)) * 100
                                : 0;
                              const combined = (caPercent * caWeight / 100) + (examPercent * examWeight / 100);

                              return (
                                <TableRow key={studentId}>
                                  <TableCell className="font-medium">{student.studentName}</TableCell>
                                  <TableCell className="font-mono text-sm">{student.regNumber}</TableCell>
                                  <TableCell>
                                    {student.caScores.length > 0 ? (
                                      <div className="space-y-0.5">
                                        {student.caScores
                                          .sort((a, b) => a.caNumber - b.caNumber)
                                          .map((ca, i) => (
                                            <span key={i} className="font-mono text-sm block">
                                              CA{ca.caNumber}: {ca.score}/{ca.totalMarks}
                                            </span>
                                          ))}
                                      </div>
                                    ) : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell className="font-mono text-sm">
                                    {student.examScore
                                      ? `${student.examScore.score}/${student.examScore.totalMarks}`
                                      : <span className="text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell>
                                    <span className={`font-mono font-semibold ${combined >= 50 ? "text-success" : "text-destructive"}`}>
                                      {combined.toFixed(1)}%
                                    </span>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
