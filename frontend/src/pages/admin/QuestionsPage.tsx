import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { Question, Course } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  Upload,
  Search,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Eye,
  Pencil,
  Trash2,
  BookOpen,
  Download,
} from "lucide-react";
import AddQuestionDialog from "@/components/dialogs/AddQuestionDialog";
import EditQuestionDialog from "@/components/dialogs/EditQuestionDialog";
import ImportCSVDialog from "@/components/dialogs/ImportCSVDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import Pagination from "@/components/admin/Pagination";

const PAGE_SIZE = 15;

export default function QuestionsPage() {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [previewQ, setPreviewQ] = useState<Question | null>(null);
  const [editQ, setEditQ] = useState<Question | null>(null);
  const [deleteQ, setDeleteQ] = useState<Question | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = () => {
    api.getCourses().then((allCourses) => {
      if (user?.role === "instructor") {
        const myCourses = allCourses.filter((c) => c.instructorId === user.id);
        setCourses(myCourses);
        api.getQuestionBank().then(setQuestions);
      } else if (user?.role === "examiner") {
        const deptCourses = allCourses.filter(
          (c) => c.department === user.department,
        );
        setCourses(deptCourses);
        api
          .getQuestionBank()
          .then((qs) =>
            setQuestions(
              qs.filter((q) => deptCourses.some((c) => c.code === q.course)),
            ),
          );
      } else {
        setCourses(allCourses);
        api.getQuestionBank().then(setQuestions);
      }
    });
  };
  useEffect(load, [user]);

  const courseQuestionCounts = courses.map((c) => ({
    course: c,
    count: questions.filter((q) => q.course === c.code).length,
  }));
  const filteredCourses = courseQuestionCounts.filter(
    (cq) =>
      cq.course.code.toLowerCase().includes(search.toLowerCase()) ||
      cq.course.title.toLowerCase().includes(search.toLowerCase()),
  );
  const courseQuestions = selectedCourse
    ? questions
        .filter((q) => q.course === selectedCourse.code)
        .filter((q) => q.text.toLowerCase().includes(search.toLowerCase()))
    : [];

  const totalPages = selectedCourse
    ? Math.ceil(courseQuestions.length / PAGE_SIZE)
    : 1;
  const paginatedQuestions = selectedCourse
    ? courseQuestions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : [];

  const typeLabel: Record<string, string> = {
    mcq: "MCQ",
    true_false: "True/False",
    fill_blank: "Fill Blank",
    short_answer: "Short Answer",
    essay: "Essay",
    matching: "Matching",
  };
  const diffColor: Record<string, string> = {
    easy: "bg-success/10 text-success",
    medium: "bg-warning/10 text-warning",
    hard: "bg-destructive/10 text-destructive",
  };

  const title =
    user?.role === "instructor" ? "My Question Bank" : "Question Banks";
  const isExaminer = user?.role === "examiner";

  const handleDelete = async () => {
    if (deleteQ) {
      try {
        await api.deleteQuestion(deleteQ.id);
        toast.success("Question deleted");
        setQuestions((prev) => prev.filter((q) => q.id !== deleteQ.id));
      } catch {
        toast.error("Failed to delete question");
      }
      setDeleteQ(null);
    }
  };

  const handleBulkDelete = async () => {
    let deleted = 0;
    for (const id of selected) {
      try {
        await api.deleteQuestion(id);
        deleted++;
      } catch {}
    }
    toast.success(`${deleted} question(s) deleted`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
    load();
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const exportCourseQuestions = () => {
    if (!selectedCourse || courseQuestions.length === 0) {
      toast.error("No course questions to export");
      return;
    }

    const escapeCsv = (value: unknown) => {
      const text = String(value ?? "");
      return `"${text.replace(/"/g, '""')}"`;
    };

    const rows = [
      ["course", "type", "difficulty", "question", "options", "correct_answer"],
      ...courseQuestions.map((q) => [
        selectedCourse.code,
        q.type,
        q.difficulty,
        q.text,
        Array.isArray(q.options) ? q.options.join(" | ") : "",
        Array.isArray(q.correctAnswer)
          ? q.correctAnswer.join(" | ")
          : String(q.correctAnswer ?? ""),
      ]),
    ];

    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedCourse.code}_question_bank.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Course questions exported");
  };

  if (!selectedCourse) {
    return (
      <div className="space-y-6 animate-slide-in">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">
              Manage questions across courses
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="w-4 h-4" />
              Import CSV
            </Button>
            <Button className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" />
              Add Question
            </Button>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search courses..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCourses.map(({ course: c, count }) => (
            <Card
              key={c.id}
              className="hover:shadow-md transition-shadow cursor-pointer group border-border/40"
              onClick={() => {
                setSelectedCourse(c);
                setSearch("");
                setPage(1);
              }}
            >
              <CardContent className="py-5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <BookOpen className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                      {c.code}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.title}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary">{c.level}</Badge>
                      <Badge variant="outline">
                        {count} question{count !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <AddQuestionDialog
          open={addOpen}
          onOpenChange={(o) => {
            setAddOpen(o);
            if (!o) load();
          }}
        />
        <ImportCSVDialog
          open={importOpen}
          onOpenChange={(o) => {
            setImportOpen(o);
            if (!o) load();
          }}
          type="questions"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedCourse(null);
              setSearch("");
              setSelected(new Set());
              setPage(1);
            }}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {selectedCourse.code} — {selectedCourse.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              {courseQuestions.length} questions
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
            >
              Delete {selected.size} Selected
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={exportCourseQuestions}
          >
            <Download className="w-4 h-4" />
            Export Course
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </Button>
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" />
            Add Question
          </Button>
        </div>
      </div>
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search questions..."
          className="pl-10"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <ScrollArea className="h-[600px] w-full">
        <div className="grid gap-3">
          {paginatedQuestions.map((q) => (
            <Card
              key={q.id}
              className="hover:shadow-md transition-shadow border-border/40"
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <Checkbox
                      checked={selected.has(q.id)}
                      onCheckedChange={() => toggleSelect(q.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {q.text}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="outline">{typeLabel[q.type]}</Badge>
                        <Badge className={diffColor[q.difficulty]}>
                          {q.difficulty}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setPreviewQ(q)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditQ(q)}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => setDeleteQ(q)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    {isExaminer && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-success"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onPageChange={setPage}
        totalItems={courseQuestions.length}
        pageSize={PAGE_SIZE}
      />

      <Dialog open={!!previewQ} onOpenChange={() => setPreviewQ(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Question Preview</DialogTitle>
            <DialogDescription>
              {previewQ?.course} · {typeLabel[previewQ?.type || "mcq"]}
            </DialogDescription>
          </DialogHeader>
          {previewQ && (
            <div className="space-y-4">
              <p className="font-medium text-foreground">{previewQ.text}</p>
              {previewQ.options && (
                <div className="space-y-2">
                  {previewQ.options.map((opt, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded text-sm border ${opt === previewQ.correctAnswer ? "border-success bg-success/5 text-success" : "text-muted-foreground"}`}
                    >
                      {String.fromCharCode(65 + i)}. {opt}
                      {opt === previewQ.correctAnswer && " ✓"}
                    </div>
                  ))}
                </div>
              )}
              {previewQ.type === "true_false" && (
                <p className="text-sm">
                  Correct:{" "}
                  <strong className="text-success">
                    {previewQ.correctAnswer as string}
                  </strong>
                </p>
              )}
              <Badge className={diffColor[previewQ.difficulty]}>
                {previewQ.difficulty}
              </Badge>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewQ(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deleteQ} onOpenChange={() => setDeleteQ(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Question</AlertDialogTitle>
            <AlertDialogDescription>Are you sure?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} Questions
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove all selected questions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AddQuestionDialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) load();
        }}
      />
      <EditQuestionDialog
        open={!!editQ}
        onOpenChange={(o) => {
          if (!o) {
            setEditQ(null);
            load();
          }
        }}
        question={editQ}
      />
      <ImportCSVDialog
        open={importOpen}
        onOpenChange={(o) => {
          setImportOpen(o);
          if (!o) load();
        }}
        type="questions"
      />
    </div>
  );
}
