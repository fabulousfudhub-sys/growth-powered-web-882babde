import { useEffect, useState, useMemo } from "react";
import { api } from "@/lib/api";
import type { School, Department, Course } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Download, FileText, BarChart3, TrendingUp, Loader2, BookOpen, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";

interface ReportRow {
  studentName: string;
  regNumber: string;
  examTitle: string;
  courseCode: string;
  score: number | undefined;
  totalMarks: number | undefined;
  status: string;
  submittedAt: string;
  examType: string;
  caNumber: number;
  department: string;
  level: string;
}

export default function ReportsPage() {
  const [school, setSchool] = useState("all");
  const [department, setDepartment] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [reportType, setReportType] = useState("");
  const [exportFormat, setExportFormat] = useState("csv");
  const [schools, setSchools] = useState<School[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [reportData, setReportData] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [expandedCourses, setExpandedCourses] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getSchools().then(setSchools).catch(() => {});
    api.getDepartments().then(setDepartments).catch(() => {});
    api.getDashboardStats().then(setStats).catch(() => {});
    api.getCourses().then(setCourses).catch(() => {});
  }, []);

  const filteredDepts = school === "all" ? departments : departments.filter((d) => d.school === school);

  const generateReport = async () => {
    if (!reportType) { toast.error("Please select a report type"); return; }
    setLoading(true);
    try {
      const attempts: any[] = await api.getAttempts();
      const rows: ReportRow[] = attempts.map((a) => ({
        studentName: a.studentName || "Unknown",
        regNumber: a.regNumber || "—",
        examTitle: a.examTitle || "—",
        courseCode: a.courseCode || "—",
        score: a.score,
        totalMarks: a.totalMarks,
        status: a.status,
        submittedAt: a.submittedAt || a.startedAt,
        examType: a.examType || "exam",
        caNumber: a.caNumber || 1,
        department: a.department || "—",
        level: a.level || "—",
      }));
      let filtered = rows;
      if (courseFilter !== "all") filtered = filtered.filter(r => r.courseCode === courseFilter);
      if (department !== "all") filtered = filtered.filter(r => r.department === department);
      setReportData(filtered);
      setGenerated(true);
      toast.success(`Report generated with ${filtered.length} records`);
    } catch {
      toast.error("Failed to generate report");
    }
    setLoading(false);
  };

  const groupedByCourse = useMemo(() => {
    const map = new Map<string, ReportRow[]>();
    for (const r of reportData) {
      if (!map.has(r.courseCode)) map.set(r.courseCode, []);
      map.get(r.courseCode)!.push(r);
    }
    return map;
  }, [reportData]);

  const toggleCourse = (code: string) => {
    setExpandedCourses(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  };

  const exportReport = () => {
    if (reportData.length === 0) { toast.error("Generate a report first"); return; }
    try {
      const headers = ["Student Name", "Reg. Number", "Exam", "Course", "Type", "Score", "Total Marks", "Percentage", "Status", "Submitted At"];
      if (exportFormat === "csv") {
        const csv = [
          headers.join(","),
          ...reportData.map((r) => [
            `"${r.studentName}"`, r.regNumber, `"${r.examTitle}"`, r.courseCode,
            r.examType === "ca" ? `CA${r.caNumber}` : "Exam",
            r.score ?? "—", r.totalMarks ?? "—",
            r.score && r.totalMarks ? `${((r.score / r.totalMarks) * 100).toFixed(1)}%` : "—",
            r.status, r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—",
          ].join(",")),
        ].join("\n");
        downloadFile(csv, `report_${reportType}.csv`, "text/csv");
      } else if (exportFormat === "json") {
        downloadFile(JSON.stringify(reportData, null, 2), `report_${reportType}.json`, "application/json");
      } else if (exportFormat === "pdf") {
        const html = `<!DOCTYPE html><html><head><title>Report</title><style>
          body{font-family:Arial;margin:20px}table{width:100%;border-collapse:collapse}
          th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px}
          th{background:#f5f5f5}h1{font-size:18px}h2{font-size:15px;margin-top:20px}
        </style></head><body>
          <h1>${reportType.replace("_", " ").toUpperCase()} Report</h1>
          <p>Generated: ${new Date().toLocaleString()}</p>
          ${Array.from(groupedByCourse.entries()).map(([code, rows]) => `
            <h2>${code}</h2>
            <table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${rows.map(r => `<tr>
              <td>${r.studentName}</td><td>${r.regNumber}</td><td>${r.examTitle}</td><td>${r.courseCode}</td>
              <td>${r.examType === "ca" ? `CA${r.caNumber}` : "Exam"}</td>
              <td>${r.score ?? "—"}</td><td>${r.totalMarks ?? "—"}</td>
              <td>${r.score && r.totalMarks ? ((r.score / r.totalMarks) * 100).toFixed(1) + "%" : "—"}</td>
              <td>${r.status}</td><td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}</td>
            </tr>`).join("")}</tbody></table>
          `).join("")}
        </body></html>`;
        const win = window.open("", "_blank");
        if (win) { win.document.write(html); win.document.close(); win.print(); }
      }
      toast.success(`Report exported as ${exportFormat.toUpperCase()}`);
    } catch {
      toast.error("Failed to export report");
    }
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">Generate reports grouped by course</p>
      </div>
      <Card className="border-border/40">
        <CardHeader><CardTitle className="text-base">Generate Report</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={courseFilter} onValueChange={setCourseFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Courses</SelectItem>
                  {courses.map(c => <SelectItem key={c.id} value={c.code}>{c.code} - {c.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>School</Label>
              <Select value={school} onValueChange={(v) => { setSchool(v); setDepartment("all"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schools</SelectItem>
                  {schools.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {filteredDepts.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger><SelectValue placeholder="Select report" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="exam_summary">Exam Summary</SelectItem>
                  <SelectItem value="student_performance">Student Performance</SelectItem>
                  <SelectItem value="question_analysis">Question Analysis</SelectItem>
                  <SelectItem value="department_overview">Department Overview</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <Button onClick={generateReport} className="gap-2" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Generate
            </Button>
            <div className="space-y-1">
              <Label className="text-xs">Export Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="gap-2" onClick={exportReport} disabled={!generated}>
              <Download className="w-4 h-4" /> Export
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="stat-card"><BarChart3 className="w-5 h-5 text-accent mb-2" /><p className="text-2xl font-bold text-foreground">{stats?.totalExams || 0}</p><p className="text-xs text-muted-foreground">Total Exams</p></div>
        <div className="stat-card"><TrendingUp className="w-5 h-5 text-success mb-2" /><p className="text-2xl font-bold text-foreground">{stats?.passRate || 0}%</p><p className="text-xs text-muted-foreground">Overall Pass Rate</p></div>
        <div className="stat-card"><FileText className="w-5 h-5 text-primary mb-2" /><p className="text-2xl font-bold text-foreground">{stats?.completedExams || 0}</p><p className="text-xs text-muted-foreground">Completed Exams</p></div>
      </div>

      {/* Nested data table grouped by course */}
      {generated && reportData.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead className="w-8"></TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Reg. No.</TableHead>
                <TableHead>Exam</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(groupedByCourse.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([courseCode, rows]) => {
                const isExpanded = expandedCourses.has(courseCode);
                return (
                  <>
                    <TableRow
                      key={`hdr-${courseCode}`}
                      className="bg-muted/30 hover:bg-muted/40 cursor-pointer border-t-2 border-border"
                      onClick={() => toggleCourse(courseCode)}
                    >
                      <TableCell className="px-3">
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      </TableCell>
                      <TableCell colSpan={7}>
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-foreground">{courseCode}</span>
                          <Badge variant="secondary" className="text-xs">{rows.length} record{rows.length !== 1 ? "s" : ""}</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && rows.map((r, i) => (
                      <TableRow key={`${courseCode}-${i}`} className="hover:bg-muted/10">
                        <TableCell></TableCell>
                        <TableCell className="text-sm">{r.studentName}</TableCell>
                        <TableCell className="font-mono text-sm">{r.regNumber}</TableCell>
                        <TableCell className="text-sm">{r.examTitle}</TableCell>
                        <TableCell>
                          <Badge variant={r.examType === "ca" ? "secondary" : "default"} className="text-xs">
                            {r.examType === "ca" ? `CA${r.caNumber}` : "Exam"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{r.score ?? "—"}/{r.totalMarks ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          {r.score && r.totalMarks ? ((r.score / r.totalMarks) * 100).toFixed(1) + "%" : "—"}
                        </TableCell>
                        <TableCell><Badge variant={r.status === "graded" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {generated && reportData.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">No records found for the selected filters</div>
      )}
    </div>
  );
}
