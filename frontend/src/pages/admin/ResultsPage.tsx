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
  Download, BarChart3, Search, TrendingUp, Users, CheckCircle, BookOpen,
  ChevronRight, Building2, GraduationCap,
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
  semester?: string;
}

interface StudentResult {
  studentName: string;
  regNumber: string;
  caScores: { caNumber: number; score: number; totalMarks: number }[];
  examScore?: { score: number; totalMarks: number };
  department?: string;
  level?: string;
}

// Course → Department → Level → Students
interface LevelGroup {
  level: string;
  students: Map<string, StudentResult>;
}
interface DeptGroup {
  department: string;
  levels: Map<string, LevelGroup>;
}
interface CourseGroup {
  courseCode: string;
  courseId: string;
  departments: Map<string, DeptGroup>;
  totalStudents: number;
}

export default function ResultsPage() {
  const { user } = useAuth();
  const [attempts, setAttempts] = useState<ExtendedAttempt[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch] = useState("");
  const [filterCourse, setFilterCourse] = useState("all");
  const [filterSemester, setFilterSemester] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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

  const roleFilteredAttempts = user?.role === "examiner" || user?.role === "instructor"
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
    const matchSemester = filterSemester === "all" || ext.semester === filterSemester;
    return matchSearch && matchCourse && matchSemester;
  });

  const avgScore = roleFilteredAttempts.length > 0
    ? Math.round(roleFilteredAttempts.reduce((sum, a) => sum + (a.score || 0), 0) / roleFilteredAttempts.length)
    : 0;

  // Build hierarchy: Course → Department → Level → Students
  const courseGroups = useMemo(() => {
    const groups = new Map<string, CourseGroup>();
    for (const a of filteredAttempts) {
      const ext = a as ExtendedAttempt;
      const courseCode = ext.courseCode || "Unknown";
      const courseId = ext.courseId || "";
      const dept = ext.department || "Unknown";
      const level = ext.level || "Unknown";

      if (!groups.has(courseCode)) {
        groups.set(courseCode, { courseCode, courseId, departments: new Map(), totalStudents: 0 });
      }
      const cg = groups.get(courseCode)!;
      if (!cg.departments.has(dept)) {
        cg.departments.set(dept, { department: dept, levels: new Map() });
      }
      const dg = cg.departments.get(dept)!;
      if (!dg.levels.has(level)) {
        dg.levels.set(level, { level, students: new Map() });
      }
      const lg = dg.levels.get(level)!;
      const studentKey = ext.studentId;
      if (!lg.students.has(studentKey)) {
        lg.students.set(studentKey, {
          studentName: ext.studentName || ext.studentId,
          regNumber: ext.regNumber || "—",
          caScores: [],
          department: dept,
          level,
        });
        cg.totalStudents++;
      }
      const student = lg.students.get(studentKey)!;
      if (ext.examType === "ca") {
        if (!student.caScores.find(c => c.caNumber === (ext.caNumber || 1))) {
          student.caScores.push({ caNumber: ext.caNumber || 1, score: ext.score || 0, totalMarks: ext.totalMarks || 0 });
        }
      } else {
        student.examScore = { score: ext.score || 0, totalMarks: ext.totalMarks || 0 };
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  }, [filteredAttempts]);

  const toggle = (key: string) => setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleExport = () => {
    try {
      const rows: string[] = ["Student Name,Reg. Number,Department,Level,Course,CA1,CA2,Exam Score,Total"];
      for (const cg of courseGroups) {
        for (const [, dg] of cg.departments) {
          for (const [, lg] of dg.levels) {
            for (const [, student] of lg.students) {
              const ca1 = student.caScores.find(c => c.caNumber === 1);
              const ca2 = student.caScores.find(c => c.caNumber === 2);
              const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
              const examTotal = student.examScore?.score || 0;
              rows.push(`"${student.studentName}","${student.regNumber}","${student.department || "—"}","${student.level || "—"}","${cg.courseCode}",${ca1?.score ?? "—"},${ca2?.score ?? "—"},${examTotal},${caTotal + examTotal}`);
            }
          }
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
          <p className="text-sm text-muted-foreground">Grouped by Course → Department → Level</p>
        </div>
        <Button variant="outline" className="gap-2" onClick={handleExport}>
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="stat-card"><Users className="w-5 h-5 text-accent mb-2" /><p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.length}</p><p className="text-xs text-muted-foreground mt-1">Submissions</p></div>
        <div className="stat-card"><TrendingUp className="w-5 h-5 text-primary mb-2" /><p className="text-2xl font-bold text-foreground">{avgScore}%</p><p className="text-xs text-muted-foreground mt-1">Average</p></div>
        <div className="stat-card"><CheckCircle className="w-5 h-5 text-success mb-2" /><p className="text-2xl font-bold text-foreground">{roleFilteredAttempts.filter((a) => a.status === "graded").length}</p><p className="text-xs text-muted-foreground mt-1">Graded</p></div>
        <div className="stat-card"><BarChart3 className="w-5 h-5 text-warning mb-2" /><p className="text-2xl font-bold text-foreground">{exams.length}</p><p className="text-xs text-muted-foreground mt-1">Exams</p></div>
      </div>

      {/* Filters */}
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
        <Select value={filterSemester} onValueChange={setFilterSemester}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Filter by semester" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Semesters</SelectItem>
            <SelectItem value="first">First Semester</SelectItem>
            <SelectItem value="second">Second Semester</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Nested Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10"></TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Reg. No.</TableHead>
              <TableHead>CA1</TableHead>
              <TableHead>CA2</TableHead>
              <TableHead>Exam</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Grade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courseGroups.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center py-12 text-muted-foreground">No results found</TableCell></TableRow>
            )}
            {courseGroups.map(cg => {
              const courseKey = `c-${cg.courseCode}`;
              const isCourseOpen = expanded.has(courseKey);
              return (
                <> 
                  {/* Course Row */}
                  <TableRow key={courseKey} className="bg-primary/5 hover:bg-primary/10 cursor-pointer border-t-2 border-border" onClick={() => toggle(courseKey)}>
                    <TableCell className="px-3">
                      <ChevronRight className={`w-4 h-4 text-primary transition-transform ${isCourseOpen ? "rotate-90" : ""}`} />
                    </TableCell>
                    <TableCell colSpan={7}>
                      <div className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-foreground">{cg.courseCode}</span>
                        <Badge variant="secondary" className="text-xs">{cg.totalStudents} student{cg.totalStudents !== 1 ? "s" : ""}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>

                  {isCourseOpen && Array.from(cg.departments.values()).sort((a, b) => a.department.localeCompare(b.department)).map(dg => {
                    const deptKey = `d-${cg.courseCode}-${dg.department}`;
                    const isDeptOpen = expanded.has(deptKey);
                    const deptStudentCount = Array.from(dg.levels.values()).reduce((s, l) => s + l.students.size, 0);
                    return (
                      <>
                        {/* Department Row */}
                        <TableRow key={deptKey} className="bg-muted/20 hover:bg-muted/30 cursor-pointer" onClick={() => toggle(deptKey)}>
                          <TableCell className="px-3 pl-8">
                            <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isDeptOpen ? "rotate-90" : ""}`} />
                          </TableCell>
                          <TableCell colSpan={7}>
                            <div className="flex items-center gap-2">
                              <Building2 className="w-3.5 h-3.5 text-accent" />
                              <span className="text-sm font-medium text-foreground">{dg.department}</span>
                              <span className="text-xs text-muted-foreground">({deptStudentCount})</span>
                            </div>
                          </TableCell>
                        </TableRow>

                        {isDeptOpen && Array.from(dg.levels.values()).sort((a, b) => a.level.localeCompare(b.level)).map(lg => {
                          const lvlKey = `l-${cg.courseCode}-${dg.department}-${lg.level}`;
                          const isLvlOpen = expanded.has(lvlKey);
                          const studentsArr = Array.from(lg.students.entries());
                          return (
                            <>
                              {/* Level Row */}
                              <TableRow key={lvlKey} className="bg-muted/10 hover:bg-muted/15 cursor-pointer" onClick={() => toggle(lvlKey)}>
                                <TableCell className="px-3 pl-12">
                                  <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${isLvlOpen ? "rotate-90" : ""}`} />
                                </TableCell>
                                <TableCell colSpan={7}>
                                  <div className="flex items-center gap-2">
                                    <GraduationCap className="w-3.5 h-3.5 text-primary/70" />
                                    <span className="text-sm text-foreground">{lg.level}</span>
                                    <span className="text-xs text-muted-foreground">({studentsArr.length})</span>
                                  </div>
                                </TableCell>
                              </TableRow>

                              {isLvlOpen && studentsArr.map(([studentId, student]) => {
                                const ca1 = student.caScores.find(c => c.caNumber === 1);
                                const ca2 = student.caScores.find(c => c.caNumber === 2);
                                const caTotal = student.caScores.reduce((sum, ca) => sum + ca.score, 0);
                                const examScore = student.examScore?.score || 0;
                                const combined = caTotal + examScore;
                                const grade = combined >= 70 ? "A" : combined >= 60 ? "B" : combined >= 50 ? "C" : combined >= 45 ? "D" : "F";
                                const gradeColor = grade === "A" ? "text-green-600 dark:text-green-400" : grade === "B" ? "text-blue-600 dark:text-blue-400" : grade === "C" ? "text-yellow-600 dark:text-yellow-400" : grade === "D" ? "text-orange-600 dark:text-orange-400" : "text-destructive";
                                return (
                                  <TableRow key={`${cg.courseCode}-${studentId}`} className="hover:bg-muted/10">
                                    <TableCell></TableCell>
                                    <TableCell className="font-medium pl-6">{student.studentName}</TableCell>
                                    <TableCell className="font-mono text-sm">{student.regNumber}</TableCell>
                                    <TableCell className="font-mono text-sm">{ca1 ? `${ca1.score}/${ca1.totalMarks}` : "—"}</TableCell>
                                    <TableCell className="font-mono text-sm">{ca2 ? `${ca2.score}/${ca2.totalMarks}` : "—"}</TableCell>
                                    <TableCell className="font-mono text-sm">{student.examScore ? `${student.examScore.score}/${student.examScore.totalMarks}` : "—"}</TableCell>
                                    <TableCell>
                                      <span className={`font-mono font-semibold ${combined >= 50 ? "text-success" : "text-destructive"}`}>{combined}</span>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="outline" className={`font-semibold ${gradeColor}`}>{grade}</Badge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </>
                          );
                        })}
                      </>
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
