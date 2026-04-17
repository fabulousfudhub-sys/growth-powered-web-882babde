import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import type { Department, Course, ExamPin } from "@/lib/types";
import {
  KeyRound,
  Copy,
  Download,
  AlertTriangle,
  Search,
  X,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreateExamDialog({ open, onOpenChange }: Props) {
  const [step, setStep] = useState(1);
  const [generatedPins, setGeneratedPins] = useState<ExamPin[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [pinMode, setPinMode] = useState<"individual" | "shared">("individual");
  const [questionsAssigned, setQuestionsAssigned] = useState(0);
  const [enableCarryover, setEnableCarryover] = useState(false);
  const [carryoverSearch, setCarryoverSearch] = useState("");
  const [carryoverResults, setCarryoverResults] = useState<any[]>([]);
  const [carryoverStudents, setCarryoverStudents] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [courseQuestionCount, setCourseQuestionCount] = useState<number | null>(
    null,
  );
  const [form, setForm] = useState({
    title: "",
    courseId: "",
    departmentId: "",
    level: "",
    duration: "45",
    totalQuestions: "20",
    questionsToAnswer: "20",
    totalMarks: "40",
    startDate: "",
    startTime: "",
    endDate: "",
    endTime: "",
    instructions: "",
    examType: "exam" as "exam" | "ca",
    caNumber: "1",
    semester: "first" as "first" | "second",
    showResult: true,
  });

  useEffect(() => {
    if (open) {
      api
        .getDepartments()
        .then(setDepartments)
        .catch(() => {});
      api
        .getCourses()
        .then(setCourses)
        .catch(() => {});
    }
  }, [open]);

  // Fetch question count when course changes
  useEffect(() => {
    if (form.courseId) {
      api
        .getQuestionBank(form.courseId)
        .then((qs) => setCourseQuestionCount(qs.length))
        .catch(() => setCourseQuestionCount(null));
    } else {
      setCourseQuestionCount(null);
    }
  }, [form.courseId]);

  const update = (key: string, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: val as never }));

  const filteredCourses = form.departmentId
    ? courses.filter(
        (c) =>
          c.department ===
          departments.find((d) => d.id === form.departmentId)?.name,
      )
    : courses;

  const selectedDept = departments.find((d) => d.id === form.departmentId);
  const selectedCourse = courses.find((c) => c.id === form.courseId);

  const marksPerQuestion =
    form.questionsToAnswer && form.totalMarks
      ? (
          parseFloat(form.totalMarks) / parseFloat(form.questionsToAnswer)
        ).toFixed(2)
      : "0";

  // Step layout:
  // Step 1: Course & Level
  // Step 2: Duration, Questions, Marks & Carryover toggle
  // Step 3 (if carryover): Search & add carryover students
  // Step 3/4: PIN mode & Instructions
  // Step 4/5: Review
  const STEP_COURSE = 1;
  const STEP_CONFIG = 2;
  const STEP_CARRYOVER = enableCarryover ? 3 : -1;
  const STEP_PIN = enableCarryover ? 4 : 3;
  const STEP_REVIEW = enableCarryover ? 5 : 4;
  const totalSteps = enableCarryover ? 5 : 4;
  const STEP_RESULTS = totalSteps + 1;

  const canProceedStep1 =
    form.title && form.courseId && form.departmentId && form.level;

  // Validation: questionsToAnswer < totalQuestions (in bank) <= courseQuestionCount
  const totalQNum = parseInt(form.totalQuestions) || 0;
  const toAnswerNum = parseInt(form.questionsToAnswer) || 0;
  const bankValid =
    courseQuestionCount === null || totalQNum <= courseQuestionCount;
  const answerValid = toAnswerNum > 0 && toAnswerNum <= totalQNum;
  const canProceedStep2 =
    form.duration &&
    form.totalQuestions &&
    form.questionsToAnswer &&
    form.totalMarks &&
    bankValid &&
    answerValid;

  const searchCarryover = async (q: string) => {
    setCarryoverSearch(q);
    if (q.length < 2) {
      setCarryoverResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await api.searchStudents(q);
      setCarryoverResults(
        results.filter((r) => !carryoverStudents.some((cs) => cs.id === r.id)),
      );
    } catch {
      setCarryoverResults([]);
    }
    setSearching(false);
  };

  const addCarryover = (student: any) => {
    setCarryoverStudents((prev) => [...prev, student]);
    setCarryoverResults((prev) => prev.filter((r) => r.id !== student.id));
    setCarryoverSearch("");
  };

  const removeCarryover = (id: string) => {
    setCarryoverStudents((prev) => prev.filter((s) => s.id !== id));
  };

  const handleCreate = async () => {
    try {
      const result = await api.createExam({
        title: form.title,
        courseId: form.courseId,
        departmentId: form.departmentId,
        schoolId: "",
        level: form.level,
        pinMode,
        duration: parseInt(form.duration),
        totalQuestions: parseInt(form.totalQuestions),
        questionsToAnswer: parseInt(form.questionsToAnswer),
        totalMarks: parseFloat(form.totalMarks),
        startDate:
          form.startDate && form.startTime
            ? `${form.startDate}T${form.startTime}:00`
            : undefined,
        endDate:
          form.endDate && form.endTime
            ? `${form.endDate}T${form.endTime}:00`
            : undefined,
        instructions: form.instructions,
        carryoverStudentIds: carryoverStudents.map((s) => s.id),
        examType: form.examType,
        caNumber: form.examType === "ca" ? parseInt(form.caNumber) : undefined,
        semester: form.semester,
        showResult: form.showResult,
      });
      setQuestionsAssigned(result.questionsAssigned || 0);

      try {
        const pinResult = await api.generatePins(result.id, pinMode);
        setGeneratedPins(
          pinResult.pins.map((p) => ({
            pin: p.pin,
            studentId: "",
            studentName: p.studentName,
            matricNumber: p.matricNumber,
            used: false,
          })),
        );
      } catch {
        setGeneratedPins([]);
      }
      setStep(STEP_RESULTS);
    } catch (err: any) {
      toast.error(err.message || "Failed to create exam");
    }
  };

  const handleDone = () => {
    toast.success("Exam created successfully!");
    onOpenChange(false);
    setStep(1);
    setGeneratedPins([]);
    setQuestionsAssigned(0);
    setPinMode("individual");
    setEnableCarryover(false);
    setCarryoverStudents([]);
    setCourseQuestionCount(null);
    setForm({
      title: "",
      courseId: "",
      departmentId: "",
      level: "",
      duration: "45",
      totalQuestions: "20",
      questionsToAnswer: "20",
      totalMarks: "40",
      startDate: "",
      startTime: "",
      endDate: "",
      endTime: "",
      instructions: "",
      examType: "exam",
      caNumber: "1",
      semester: "first",
      showResult: true,
    });
  };

  const copyPin = (pin: string) => {
    navigator.clipboard.writeText(pin);
    toast.success("PIN copied!");
  };

  const downloadPins = () => {
    const csv = [
      "Student Name,Reg. Number,Exam PIN",
      ...generatedPins.map(
        (p) => `${p.studentName},${p.matricNumber},${p.pin}`,
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${form.title || "exam"}_pins.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const nextStep = () => {
    if (step === STEP_CONFIG && !enableCarryover) setStep(STEP_PIN);
    else setStep(step + 1);
  };

  const prevStep = () => {
    if (step === STEP_PIN && !enableCarryover) setStep(STEP_CONFIG);
    else setStep(step - 1);
  };

  const isResultsStep = step === STEP_RESULTS;
  const currentDisplayStep = step <= totalSteps ? step : totalSteps;

  const stepDescriptions: Record<number, string> = {
    [STEP_COURSE]: "Select course and level",
    [STEP_CONFIG]: "Set duration, questions, marks & carryover",
    [STEP_CARRYOVER]: "Search and add carryover students",
    [STEP_PIN]: "PIN generation mode & instructions",
    [STEP_REVIEW]: "Review and confirm",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          isResultsStep
            ? "w-[95vw] sm:max-w-2xl max-h-[85vh] overflow-y-auto"
            : "w-[95vw] sm:max-w-lg max-h-[85vh] overflow-y-auto"
        }
      >
        <DialogHeader>
          <DialogTitle>
            {!isResultsStep
              ? `Create Exam — Step ${currentDisplayStep} of ${totalSteps}`
              : "Exam Created!"}
          </DialogTitle>
          <DialogDescription>
            {!isResultsStep
              ? stepDescriptions[step] || ""
              : "PINs generated for students"}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Course & Level */}
        {step === STEP_COURSE && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Exam Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="e.g. COM 101 - Introduction to Computing"
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Type <span className="text-destructive">*</span></Label>
                <Select value={form.examType} onValueChange={(v) => {
                  update("examType", v);
                  if (v === "ca" && parseFloat(form.totalMarks) > 30) {
                    update("totalMarks", "30");
                  }
                }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exam">Exam</SelectItem>
                    <SelectItem value="ca">CA / Test</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.examType === "ca" && (
              <div className="space-y-2">
                <Label>CA Number</Label>
                <Select value={form.caNumber} onValueChange={(v) => update("caNumber", v)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">First CA</SelectItem>
                    <SelectItem value="2">Second CA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>
                Department <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.departmentId}
                onValueChange={(v) => {
                  update("departmentId", v);
                  update("courseId", "");
                  update("level", "");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Course <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.courseId}
                  onValueChange={(v) => update("courseId", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select course" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCourses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} - {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  Student Level <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.level}
                  onValueChange={(v) => update("level", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      selectedDept?.levels || ["ND1", "ND2", "HND1", "HND2"]
                    ).map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.courseId && courseQuestionCount !== null && (
              <div className="p-3 rounded-lg bg-muted text-sm">
                <p className="text-muted-foreground">
                  Course question bank:{" "}
                  <strong className="text-foreground">
                    {courseQuestionCount}
                  </strong>{" "}
                  questions available
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Duration, Questions, Marks & Carryover toggle */}
        {step === STEP_CONFIG && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Duration (min) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={form.duration}
                  onChange={(e) => update("duration", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Total Marks <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={form.totalMarks}
                  max={form.examType === "ca" ? 30 : undefined}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (form.examType === "ca" && parseFloat(val) > 30) {
                      update("totalMarks", "30");
                    } else {
                      update("totalMarks", val);
                    }
                  }}
                  required
                />
                {form.examType === "ca" && (
                  <p className="text-xs text-muted-foreground">CA/Test marks cannot exceed 30</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Questions in Bank <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={form.totalQuestions}
                  onChange={(e) => update("totalQuestions", e.target.value)}
                  required
                />
                {courseQuestionCount !== null &&
                  totalQNum > courseQuestionCount && (
                    <p className="text-xs text-destructive">
                      Only {courseQuestionCount} questions available for this
                      course
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label>
                  Questions to Answer{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  value={form.questionsToAnswer}
                  onChange={(e) => update("questionsToAnswer", e.target.value)}
                  required
                />
                {toAnswerNum > 0 && toAnswerNum > totalQNum && (
                  <p className="text-xs text-destructive">
                    Must be ≤ questions in bank ({totalQNum})
                  </p>
                )}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-muted text-sm">
              <p className="text-muted-foreground">
                Each question will carry{" "}
                <strong className="text-foreground">
                  {marksPerQuestion} marks
                </strong>
              </p>
              {totalQNum > toAnswerNum && answerValid && (
                <p className="text-muted-foreground mt-1">
                  Each student gets a random set of{" "}
                  <strong className="text-foreground">
                    {form.questionsToAnswer}
                  </strong>{" "}
                  from{" "}
                  <strong className="text-foreground">
                    {form.totalQuestions}
                  </strong>{" "}
                  questions
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => update("startDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => update("startTime", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => update("endDate", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>End Time</Label>
                <Input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => update("endTime", e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div>
                <Label className="text-sm font-semibold">
                  Add Carryover Students
                </Label>
                <p className="text-xs text-muted-foreground">
                  Include students from other levels in this exam
                </p>
              </div>
              <Switch
                checked={enableCarryover}
                onCheckedChange={setEnableCarryover}
              />
            </div>
          </div>
        )}

        {/* Step 3 (conditional): Carryover Students */}
        {step === STEP_CARRYOVER && enableCarryover && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground">
              Search for students by name or Reg. Number to add them as
              carryover students for this exam. This searches all registered
              students.
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by Reg. Number or name..."
                className="pl-10"
                value={carryoverSearch}
                onChange={(e) => searchCarryover(e.target.value)}
                autoFocus
              />
            </div>
            {searching && (
              <p className="text-xs text-muted-foreground">Searching...</p>
            )}
            {carryoverResults.length > 0 && (
              <div className="border rounded-lg max-h-48 overflow-auto">
                {carryoverResults.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer text-sm border-b last:border-b-0"
                    onClick={() => addCarryover(s)}
                  >
                    <div>
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground ml-2">·</span>
                      <span className="font-mono ml-2">{s.regNumber}</span>
                      <span className="text-muted-foreground ml-2">
                        · {s.department} · {s.level}
                      </span>
                    </div>
                    <UserPlus className="w-4 h-4 text-primary shrink-0" />
                  </div>
                ))}
              </div>
            )}
            {carryoverSearch.length >= 2 &&
              carryoverResults.length === 0 &&
              !searching && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No students found matching "{carryoverSearch}"
                </p>
              )}

            {carryoverStudents.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {carryoverStudents.length} carryover student(s) added:
                </p>
                <ScrollArea className="max-h-48">
                  {carryoverStudents.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm mb-1"
                    >
                      <span>
                        {s.name} ·{" "}
                        <span className="font-mono">{s.regNumber}</span> ·{" "}
                        {s.level}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive"
                        onClick={() => removeCarryover(s.id)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}
            {carryoverStudents.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No carryover students added yet. Search above to find and add
                students.
              </div>
            )}
          </div>
        )}

        {/* Step: PIN Mode & Instructions */}
        {step === STEP_PIN && (
          <div className="space-y-4">
            <div className="space-y-3 p-4 rounded-lg border">
              <Label className="text-sm font-semibold">
                PIN Generation Mode
              </Label>
              <RadioGroup
                value={pinMode}
                onValueChange={(v) => setPinMode(v as "individual" | "shared")}
                className="space-y-2"
              >
                <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <RadioGroupItem
                    value="individual"
                    id="pin-individual"
                    className="mt-0.5"
                  />
                  <div>
                    <Label
                      htmlFor="pin-individual"
                      className="cursor-pointer font-medium"
                    >
                      Individual PINs
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Each student gets a unique 8-digit PIN
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <RadioGroupItem
                    value="shared"
                    id="pin-shared"
                    className="mt-0.5"
                  />
                  <div>
                    <Label
                      htmlFor="pin-shared"
                      className="cursor-pointer font-medium"
                    >
                      Single Shared PIN
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      One PIN for all eligible students — no per-student
                      enrollment needed
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label>Exam Instructions</Label>
              <Textarea
                rows={4}
                placeholder="Instructions shown to students before they begin..."
                value={form.instructions}
                onChange={(e) => update("instructions", e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Review Step */}
        {step === STEP_REVIEW && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-muted space-y-2 text-sm">
              <p className="font-semibold text-foreground mb-2">Exam Summary</p>
              <p>
                <strong>Title:</strong> {form.title || "—"}
              </p>
              <p>
                <strong>Course:</strong> {selectedCourse?.code || "—"} ·{" "}
                {selectedDept?.name || "—"} · {form.level || "—"}
              </p>
              <p>
                <strong>Duration:</strong> {form.duration} min ·{" "}
                {form.questionsToAnswer}/{form.totalQuestions} questions
              </p>
              <p>
                <strong>Total Marks:</strong> {form.totalMarks} (
                {marksPerQuestion} per question)
              </p>
              <p>
                <strong>Window:</strong> {form.startDate || "—"}{" "}
                {form.startTime || ""} — {form.endDate || "—"}{" "}
                {form.endTime || ""}
              </p>
              <p>
                <strong>PIN Mode:</strong>{" "}
                {pinMode === "shared" ? "Single Shared PIN" : "Individual PINs"}
              </p>
              {carryoverStudents.length > 0 && (
                <p>
                  <strong>Carryover:</strong> {carryoverStudents.length}{" "}
                  student(s)
                </p>
              )}
              {form.instructions && (
                <p>
                  <strong>Instructions:</strong> {form.instructions}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Results Step */}
        {isResultsStep && (
          <div className="space-y-4">
            {questionsAssigned === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 text-sm">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <p className="text-warning">
                  No questions were assigned. Add questions to the course bank
                  first, then use "Reassign Questions" from the exam menu.
                </p>
              </div>
            )}
            {questionsAssigned > 0 && (
              <div className="p-3 rounded-lg bg-success/10 border border-success/20 text-sm text-success">
                ✓ {questionsAssigned} questions auto-assigned from the question
                bank
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-accent" />
                <p className="text-sm font-medium text-foreground">
                  {generatedPins.length}{" "}
                  {pinMode === "shared" ? "shared" : "unique"} PIN
                  {generatedPins.length !== 1 ? "s" : ""} generated
                </p>
              </div>
              {generatedPins.length > 0 && pinMode !== "shared" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={downloadPins}
                >
                  <Download className="w-4 h-4" /> Download CSV
                </Button>
              )}
            </div>
            {pinMode === "shared" && generatedPins.length > 0 && (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                <span className="text-sm text-muted-foreground">
                  Shared PIN:
                </span>
                <Badge
                  variant="outline"
                  className="font-mono text-lg px-4 py-1"
                >
                  {generatedPins[0].pin}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyPin(generatedPins[0].pin)}
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            )}
            {pinMode !== "shared" && generatedPins.length > 0 && (
              <ScrollArea className="max-h-64">
                <div className="w-full overflow-x-auto">
                  <Table className="min-w-[560px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Reg. No.</TableHead>
                        <TableHead>Exam PIN</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {generatedPins.map((p, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-sm">
                            {p.studentName}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {p.matricNumber}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {p.pin}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => copyPin(p.pin)}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between gap-2">
          {step > 1 && !isResultsStep && (
            <Button variant="outline" onClick={prevStep}>
              Back
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            {step === STEP_COURSE && (
              <Button
                disabled={!canProceedStep1}
                onClick={() => setStep(STEP_CONFIG)}
              >
                Next
              </Button>
            )}
            {step === STEP_CONFIG && (
              <Button disabled={!canProceedStep2} onClick={nextStep}>
                Next
              </Button>
            )}
            {step === STEP_CARRYOVER && (
              <Button onClick={() => setStep(STEP_PIN)}>Next</Button>
            )}
            {step === STEP_PIN && (
              <Button onClick={() => setStep(STEP_REVIEW)}>Next</Button>
            )}
            {step === STEP_REVIEW && (
              <Button onClick={handleCreate}>Create Exam</Button>
            )}
            {isResultsStep && <Button onClick={handleDone}>Done</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
