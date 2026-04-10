import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { School, Department, ExamAttempt, Course } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  FileText,
  BarChart3,
  TrendingUp,
  Loader2,
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

  useEffect(() => {
    api.getSchools().then(setSchools).catch(() => {});
    api.getDepartments().then(setDepartments).catch(() => {});
    api.getDashboardStats().then(setStats).catch(() => {});
    api.getCourses().then(setCourses).catch(() => {});
  }, []);

  const filteredDepts =
    school === "all"
      ? departments
      : departments.filter((d) => d.school === school);

  const generateReport = async () => {
    if (!reportType) {
      toast.error("Please select a report type");
      return;
    }
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
      // Apply course filter
      const filtered = courseFilter === "all" ? rows : rows.filter(r => r.courseCode === courseFilter);
      setReportData(filtered);
      setGenerated(true);
      toast.success(
        `${reportType.replace("_", " ")} report generated with ${rows.length} records`,
      );
    } catch {
      toast.error("Failed to generate report");
    }
    setLoading(false);
  };

  const exportReport = () => {
    if (reportData.length === 0) {
      toast.error("Generate a report first");
      return;
    }

    const headers = [
      "Student Name",
      "Reg. Number",
      "Exam",
      "Course",
      "Score",
      "Total Marks",
      "Percentage",
      "Status",
      "Submitted At",
    ];

    if (exportFormat === "csv") {
      const csv = [
        headers.join(","),
        ...reportData.map((r) =>
          [
            `"${r.studentName}"`,
            r.regNumber,
            `"${r.examTitle}"`,
            r.courseCode,
            r.score ?? "—",
            r.totalMarks ?? "—",
            r.score && r.totalMarks
              ? `${((r.score / r.totalMarks) * 100).toFixed(1)}%`
              : "—",
            r.status,
            r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—",
          ].join(","),
        ),
      ].join("\n");
      downloadFile(csv, `report_${reportType}.csv`, "text/csv");
    } else if (exportFormat === "json") {
      const json = JSON.stringify(
        reportData.map((r) => ({
          ...r,
          percentage:
            r.score && r.totalMarks
              ? ((r.score / r.totalMarks) * 100).toFixed(1)
              : null,
        })),
        null,
        2,
      );
      downloadFile(json, `report_${reportType}.json`, "application/json");
    } else if (exportFormat === "pdf") {
      // Generate a printable HTML and trigger print
      const html = `<!DOCTYPE html><html><head><title>Report</title><style>
        body{font-family:Arial;margin:20px}table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:12px}
        th{background:#f5f5f5}h1{font-size:18px}
      </style></head><body>
        <h1>${reportType.replace("_", " ").toUpperCase()} Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${reportData
          .map(
            (r) => `<tr>
          <td>${r.studentName}</td><td>${r.regNumber}</td><td>${r.examTitle}</td><td>${r.courseCode}</td>
          <td>${r.score ?? "—"}</td><td>${r.totalMarks ?? "—"}</td>
          <td>${r.score && r.totalMarks ? ((r.score / r.totalMarks) * 100).toFixed(1) + "%" : "—"}</td>
          <td>${r.status}</td><td>${r.submittedAt ? new Date(r.submittedAt).toLocaleString() : "—"}</td>
        </tr>`,
          )
          .join("")}</tbody></table></body></html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    }
    toast.success(`Report exported as ${exportFormat.toUpperCase()}`);
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Generate reports across schools, departments, and exams
        </p>
      </div>
      <Card className="border-border/40">
        <CardHeader>
          <CardTitle className="text-base">Generate Report</CardTitle>
        </CardHeader>
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
              <Select
                value={school}
                onValueChange={(v) => {
                  setSchool(v);
                  setDepartment("all");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Schools</SelectItem>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {filteredDepts.map((d) => (
                    <SelectItem key={d.id} value={d.name}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select report" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exam_summary">Exam Summary</SelectItem>
                  <SelectItem value="student_performance">
                    Student Performance
                  </SelectItem>
                  <SelectItem value="question_analysis">
                    Question Analysis
                  </SelectItem>
                  <SelectItem value="department_overview">
                    Department Overview
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 items-end">
            <Button
              onClick={generateReport}
              className="gap-2"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}{" "}
              Generate
            </Button>
            <div className="space-y-1">
              <Label className="text-xs">Export Format</Label>
              <Select value={exportFormat} onValueChange={setExportFormat}>
                <SelectTrigger className="w-28 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={exportReport}
              disabled={!generated}
            >
              <Download className="w-4 h-4" /> Export
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="stat-card">
          <BarChart3 className="w-5 h-5 text-accent mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {stats?.totalExams || 0}
          </p>
          <p className="text-xs text-muted-foreground">Total Exams</p>
        </div>
        <div className="stat-card">
          <TrendingUp className="w-5 h-5 text-success mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {stats?.passRate || 0}%
          </p>
          <p className="text-xs text-muted-foreground">Overall Pass Rate</p>
        </div>
        <div className="stat-card">
          <FileText className="w-5 h-5 text-primary mb-2" />
          <p className="text-2xl font-bold text-foreground">
            {stats?.completedExams || 0}
          </p>
          <p className="text-xs text-muted-foreground">Completed Exams</p>
        </div>
      </div>

      {generated && reportData.length > 0 && (
        <Card className="border-border/40">
          <CardHeader>
            <CardTitle className="text-base">
              Report Results ({reportData.length} records)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-96">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Reg. No.</TableHead>
                    <TableHead>Exam</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>%</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm">{r.studentName}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.regNumber}
                      </TableCell>
                      <TableCell className="text-sm">{r.examTitle}</TableCell>
                      <TableCell className="text-sm">{r.courseCode}</TableCell>
                      <TableCell className="text-sm">
                        {r.score ?? "—"}/{r.totalMarks ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.score && r.totalMarks
                          ? ((r.score / r.totalMarks) * 100).toFixed(1) + "%"
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "graded" ? "default" : "secondary"
                          }
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
