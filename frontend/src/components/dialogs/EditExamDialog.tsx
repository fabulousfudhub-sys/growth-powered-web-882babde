import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import type { Department, Course, Exam } from '@/lib/types';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exam: Exam | null;
}

export default function EditExamDialog({ open, onOpenChange, exam }: Props) {
  const [form, setForm] = useState({
    title: '', courseId: '', departmentId: '', level: '', status: 'draft',
    duration: '45', totalQuestions: '20', questionsToAnswer: '20', totalMarks: '40',
    startDate: '', startTime: '', endDate: '', endTime: '', instructions: '',
    semester: 'first' as 'first' | 'second', showResult: true,
    examType: 'exam' as 'exam' | 'ca', caNumber: '1',
  });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [saving, setSaving] = useState(false);
  const update = (key: string, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val as never }));

  useEffect(() => {
    if (open && exam) {
      Promise.all([api.getDepartments(), api.getCourses()]).then(([d, c]) => {
        setDepartments(d);
        setCourses(c);
        const deptMatch = d.find(dept => dept.name === exam.department);
        const courseMatch = c.find(co => co.code === exam.course);
        const startDate = exam.startDate ? new Date(exam.startDate) : null;
        const endDate = exam.endDate ? new Date(exam.endDate) : null;
        setForm({
          title: exam.title, courseId: courseMatch?.id || '', departmentId: deptMatch?.id || '',
          level: exam.level || '', status: exam.status,
          duration: String(exam.duration), totalQuestions: String(exam.totalQuestions),
          questionsToAnswer: String(exam.questionsToAnswer), totalMarks: String(exam.totalMarks),
          startDate: startDate ? startDate.toISOString().split('T')[0] : '',
          startTime: startDate ? startDate.toISOString().split('T')[1]?.substring(0, 5) : '',
          endDate: endDate ? endDate.toISOString().split('T')[0] : '',
          endTime: endDate ? endDate.toISOString().split('T')[1]?.substring(0, 5) : '',
          instructions: exam.instructions || '',
          semester: (exam.semester === 'second' ? 'second' : 'first'),
          showResult: exam.showResult !== false,
          examType: exam.examType || 'exam',
          caNumber: String(exam.caNumber || 1),
        });
      });
    }
  }, [open, exam]);

  const filteredCourses = form.departmentId
    ? courses.filter(c => c.department === departments.find(d => d.id === form.departmentId)?.name)
    : courses;

  const handleSave = async () => {
    if (!exam || !form.title.trim() || !form.courseId || !form.departmentId) {
      toast.error('Fill in all required fields'); return;
    }
    setSaving(true);
    try {
      await api.updateExam(exam.id, {
        title: form.title, courseId: form.courseId, departmentId: form.departmentId, schoolId: '',
        level: form.level, duration: parseInt(form.duration), totalQuestions: parseInt(form.totalQuestions),
        questionsToAnswer: parseInt(form.questionsToAnswer), totalMarks: parseFloat(form.totalMarks),
        startDate: form.startDate && form.startTime ? `${form.startDate}T${form.startTime}:00` : undefined,
        endDate: form.endDate && form.endTime ? `${form.endDate}T${form.endTime}:00` : undefined,
        instructions: form.instructions, status: form.status,
        semester: form.semester, showResult: form.showResult,
        examType: form.examType, caNumber: parseInt(form.caNumber || '1'),
      });
      toast.success('Exam updated');
      onOpenChange(false);
    } catch (err: any) { toast.error(err.message || 'Could not update exam. Please verify the inputs.'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Exam</DialogTitle><DialogDescription>Update exam configuration</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Exam Title <span className="text-destructive">*</span></Label><Input value={form.title} onChange={e => update('title', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Department <span className="text-destructive">*</span></Label>
              <Select value={form.departmentId} onValueChange={v => { update('departmentId', v); update('courseId', ''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Course <span className="text-destructive">*</span></Label>
              <Select value={form.courseId} onValueChange={v => update('courseId', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{filteredCourses.map(c => <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={form.level} onValueChange={v => update('level', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['ND1', 'ND2', 'HND1', 'HND2'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => update('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Duration (min) <span className="text-destructive">*</span></Label><Input type="number" value={form.duration} onChange={e => update('duration', e.target.value)} /></div>
            <div className="space-y-2"><Label>Total Marks <span className="text-destructive">*</span></Label><Input type="number" value={form.totalMarks} onChange={e => update('totalMarks', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Total Questions</Label><Input type="number" value={form.totalQuestions} onChange={e => update('totalQuestions', e.target.value)} /></div>
            <div className="space-y-2"><Label>Questions to Answer</Label><Input type="number" value={form.questionsToAnswer} onChange={e => update('questionsToAnswer', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Start Date</Label><Input type="date" value={form.startDate} onChange={e => update('startDate', e.target.value)} /></div>
            <div className="space-y-2"><Label>Start Time</Label><Input type="time" value={form.startTime} onChange={e => update('startTime', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>End Date</Label><Input type="date" value={form.endDate} onChange={e => update('endDate', e.target.value)} /></div>
            <div className="space-y-2"><Label>End Time</Label><Input type="time" value={form.endTime} onChange={e => update('endTime', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Semester</Label>
              <Select value={form.semester} onValueChange={v => update('semester', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">First Semester</SelectItem>
                  <SelectItem value="second">Second Semester</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm">Display Result</Label>
                <p className="text-xs text-muted-foreground">Show students their score</p>
              </div>
              <Switch checked={form.showResult} onCheckedChange={v => update('showResult', v)} />
            </div>
          </div>
          <div className="space-y-2"><Label>Instructions</Label><Textarea rows={3} value={form.instructions} onChange={e => update('instructions', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
