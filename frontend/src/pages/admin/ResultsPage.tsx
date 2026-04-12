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
import { toast } from "sonner";

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
  const [filterCourse, setFilterCourse] = useState("all");
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

  const roleFilteredAttempts =
    user?.role === "examiner" || user?.role === "instructor"
      ? attempts.filter((a) => exams.some((e) => e.id === a.examId))
      : attempts;

  const filteredAttempts = roleFilteredAttempts.filter((a) => {
    const ext = a as ExtendedAttempt;
    const matchSearch = !search || (
      ext.studentName?.toLowerCase().includes(search.toLowerCase()) ||
      ext.regNumber?.toLowerCase().includes(search.toLowerCase()) ||
      ext.courseCode?.toLowerCase().includes(search.toLowerCase())
    );
    const matchCourse = filterCourse === "all" || ext.courseCode === filterCourse;
    return matchSearch && matchCourse;
  });

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

  const handleExport = () => {
    const rows: string[] = ["Student Name,Reg. Number,Course,CA Score,Exam Score,Total"];
    for (const group of courseGroups) {
      for (const [, student] of group.students) {
        const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
        const examTotal = student.examScore?.score || 0;
        const combined = caTotal + examTotal;
        rows.push(`"${student.studentName}","${student.regNumber}","${group.courseCode}",${caTotal},${examTotal},${combined}`);
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url;
    el.download = "exam_results.csv";
    el.click();
    URL.revokeObjectURL(url);
    toast.success("Results exported");
  };

  const uniqueCourses = [...new Set(roleFilteredAttempts.map(a => (a as any).courseCode).filter(Boolean))].sort();

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Results</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "instructor" ? "Results for your courses" : "View exam results grouped by course"}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
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
          <Input placeholder="Search by student name, matric, or course..." className="pl-10"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterCourse} onValueChange={setFilterCourse}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter by course" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {uniqueCourses.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Course-wise grouped results */}
      <div className="space-y-4">
        {courseGroups.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">No results found</div>
        )}
        {courseGroups.map(group => {
          const isOpen = openCourses.has(group.courseCode);
          const hasCa = Array.from(group.students.values()).some(s => s.caScores.length > 0);

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
                            {group.students.size} student(s)
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
                            {hasCa && <TableHead>CA Score</TableHead>}
                            <TableHead>Exam Score</TableHead>
                            <TableHead>Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {Array.from(group.students.entries()).map(([studentId, student]) => {
                            const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
                            const examScore = student.examScore?.score || 0;
                            const combined = caTotal + examScore;

                            return (
                              <TableRow key={studentId}>
                                <TableCell className="font-medium">{student.studentName}</TableCell>
                                <TableCell className="font-mono text-sm">{student.regNumber}</TableCell>
                                {hasCa && (
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
                                )}
                                <TableCell className="font-mono text-sm">
                                  {student.examScore
                                    ? `${student.examScore.score}/${student.examScore.totalMarks}`
                                    : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell>
                                  <span className={`font-mono font-semibold ${combined >= 50 ? "text-success" : "text-destructive"}`}>
                                    {combined}
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
    </div>
  );
}
