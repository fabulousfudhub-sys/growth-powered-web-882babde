import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { ExamAttempt, Exam, Course } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Download, BarChart3, Search, TrendingUp, Users, CheckCircle, BookOpen, ChevronRight,
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

interface StudentResult {
  studentName: string;
  regNumber: string;
  caScores: { caNumber: number; score: number; totalMarks: number }[];
  examScore?: { score: number; totalMarks: number };
  department?: string;
  level?: string;
}

interface CourseGroup {
  courseCode: string;
  courseId: string;
  students: Map<string, StudentResult>;
}

export default function ResultsPage() {
  const { user } = useAuth();
  const [attempts, setAttempts] = useState<ExtendedAttempt[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");
  const [filterCourse, setFilterCourse] = useState("all");
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getAttempts().then(setAttempts).catch(() => toast.error("Could not load results"));
    api.getCourses().then(setCourses).catch(() => {});
    if (user?.role === "examiner") {
      api.getExams(user.department).then(setExams).catch(() => {});
    } else if (user?.role === "instructor") {
      api.getCourses().then((cs) => {
        const myCourses = cs.filter((c) => c.instructorId === user.id).map((c) => c.code);
        api.getExams().then((allExams) => setExams(allExams.filter((e) => myCourses.includes(e.course)))).catch(() => {});
      }).catch(() => {});
    } else {
      api.getExams().then(setExams).catch(() => {});
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
        // Avoid duplicate CA entries
        const existing = student.caScores.find(c => c.caNumber === (ext.caNumber || 1));
        if (!existing) {
          student.caScores.push({
            caNumber: ext.caNumber || 1,
            score: ext.score || 0,
            totalMarks: ext.totalMarks || 0,
          });
        }
      } else {
        student.examScore = { score: ext.score || 0, totalMarks: ext.totalMarks || 0 };
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  }, [filteredAttempts]);

  const toggleCourse = (code: string) => {
    setExpandedCourses(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const handleExport = () => {
    try {
      const rows: string[] = ["Student Name,Reg. Number,Department,Level,Course,CA1,CA2,Exam Score,Total"];
      for (const group of courseGroups) {
        for (const [, student] of group.students) {
          const ca1 = student.caScores.find(c => c.caNumber === 1);
          const ca2 = student.caScores.find(c => c.caNumber === 2);
          const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
          const examTotal = student.examScore?.score || 0;
          rows.push(`"${student.studentName}","${student.regNumber}","${student.department || "—"}","${student.level || "—"}","${group.courseCode}",${ca1?.score ?? "—"},${ca2?.score ?? "—"},${examTotal},${caTotal + examTotal}`);
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
    } catch {
      toast.error("Failed to export results");
    }
  };

  const uniqueCourses = [...new Set(roleFilteredAttempts.map(a => (a as any).courseCode).filter(Boolean))].sort();

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Results</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "instructor" ? "Results for your courses" : "Exam results grouped by course"}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card"><Users className="w-5 h-5 text-accent mb-2" /><p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.length}</p><p className="text-xs text-muted-foreground mt-1">Total Submissions</p></div>
        <div className="stat-card"><TrendingUp className="w-5 h-5 text-primary mb-2" /><p className="text-2xl font-bold text-foreground">{avgScore}%</p><p className="text-xs text-muted-foreground mt-1">Average Score</p></div>
        <div className="stat-card"><CheckCircle className="w-5 h-5 text-success mb-2" /><p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.filter((a) => a.status === "graded").length}</p><p className="text-xs text-muted-foreground mt-1">Graded</p></div>
        <div className="stat-card"><BarChart3 className="w-5 h-5 text-warning mb-2" /><p className="text-2xl font-bold text-foreground">{exams.length}</p><p className="text-xs text-muted-foreground mt-1">Exams</p></div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search student, matric, or course..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterCourse} onValueChange={setFilterCourse}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter by course" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Courses</SelectItem>
            {uniqueCourses.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Nested data table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-8"></TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Reg. No.</TableHead>
              <TableHead>Dept / Level</TableHead>
              <TableHead>CA1</TableHead>
              <TableHead>CA2</TableHead>
              <TableHead>Exam</TableHead>
              <TableHead>Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courseGroups.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No results found</TableCell></TableRow>
            )}
            {courseGroups.map(group => {
              const isExpanded = expandedCourses.has(group.courseCode);
              const studentCount = group.students.size;
              const studentsArr = Array.from(group.students.entries());

              return (
                <>
                  {/* Course header row */}
                  <TableRow
                    key={`hdr-${group.courseCode}`}
                    className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-t-2 border-border"
                    onClick={() => toggleCourse(group.courseCode)}
                  >
                    <TableCell className="w-8 px-3">
                      <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    </TableCell>
                    <TableCell colSpan={7}>
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-foreground">{group.courseCode}</span>
                        <Badge variant="secondary" className="text-xs ml-2">{studentCount} student{studentCount !== 1 ? "s" : ""}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                  {/* Student rows */}
                  {isExpanded && studentsArr.map(([studentId, student]) => {
                    const ca1 = student.caScores.find(c => c.caNumber === 1);
                    const ca2 = student.caScores.find(c => c.caNumber === 2);
                    const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
                    const examScore = student.examScore?.score || 0;
                    const combined = caTotal + examScore;

                    return (
                      <TableRow key={`${group.courseCode}-${studentId}`} className="hover:bg-muted/20">
                        <TableCell></TableCell>
                        <TableCell className="font-medium">{student.studentName}</TableCell>
                        <TableCell className="font-mono text-sm">{student.regNumber}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{student.department || "—"} / {student.level || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{ca1 ? `${ca1.score}/${ca1.totalMarks}` : "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{ca2 ? `${ca2.score}/${ca2.totalMarks}` : "—"}</TableCell>
                        <TableCell className="font-mono text-sm">
                          {student.examScore ? `${student.examScore.score}/${student.examScore.totalMarks}` : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`font-mono font-semibold ${combined >= 50 ? "text-success" : "text-destructive"}`}>
                            {combined}
                          </span>
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
    </div>
  );
}
