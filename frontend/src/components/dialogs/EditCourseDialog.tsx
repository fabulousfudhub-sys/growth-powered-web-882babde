import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { Department, Course, User } from '@/lib/types';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course | null;
}

export default function EditCourseDialog({ open, onOpenChange, course }: Props) {
  const [form, setForm] = useState({ code: '', title: '', departmentId: '', level: '', instructorId: '', caWeight: '30', examWeight: '70', maxCas: '1' });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [instructors, setInstructors] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const update = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  useEffect(() => {
    if (open && course) {
      api.getDepartments().then(d => {
        setDepartments(d);
        const match = d.find(dept => dept.name === course.department);
        setForm({
          code: course.code, title: course.title,
          departmentId: match?.id || '', level: course.level || '',
          instructorId: course.instructorId || '',
          caWeight: String(course.caWeight ?? 30),
          examWeight: String(course.examWeight ?? 70),
          maxCas: String(course.maxCas ?? 1),
        });
      });
      api.getInstructors().then(setInstructors);
    }
  }, [open, course]);

  const handleSave = async () => {
    if (!course || !form.code.trim() || !form.title.trim() || !form.departmentId) {
      toast.error('Fill in all required fields'); return;
    }
    setSaving(true);
    try {
      await api.updateCourse(course.id, {
        code: form.code, title: form.title,
        departmentId: form.departmentId, schoolId: '',
        level: form.level, instructorId: form.instructorId || undefined,
        caWeight: parseFloat(form.caWeight),
        examWeight: parseFloat(form.examWeight),
        maxCas: parseInt(form.maxCas),
      });
      toast.success('Course updated');
      onOpenChange(false);
    } catch (err: any) { toast.error(err.message || 'Failed to update'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Course</DialogTitle><DialogDescription>Update course details</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Course Code <span className="text-destructive">*</span></Label><Input value={form.code} onChange={e => update('code', e.target.value)} /></div>
            <div className="space-y-2"><Label>Level</Label><Select value={form.level} onValueChange={v => update('level', v)}><SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger><SelectContent>{['ND1', 'ND2', 'HND1', 'HND2'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Course Title <span className="text-destructive">*</span></Label><Input value={form.title} onChange={e => update('title', e.target.value)} /></div>
          <div className="space-y-2">
            <Label>Department <span className="text-destructive">*</span></Label>
            <Select value={form.departmentId} onValueChange={v => update('departmentId', v)}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Instructor</Label>
            <Select value={form.instructorId} onValueChange={v => update('instructorId', v)}>
              <SelectTrigger><SelectValue placeholder="Select instructor" /></SelectTrigger>
              <SelectContent>{instructors.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>CA Weight (%)</Label><Input type="number" value={form.caWeight} onChange={e => { update('caWeight', e.target.value); update('examWeight', String(100 - parseFloat(e.target.value || '0'))); }} /></div>
            <div className="space-y-2"><Label>Exam Weight (%)</Label><Input type="number" value={form.examWeight} onChange={e => { update('examWeight', e.target.value); update('caWeight', String(100 - parseFloat(e.target.value || '0'))); }} /></div>
            <div className="space-y-2">
              <Label>Max CAs</Label>
              <Select value={form.maxCas} onValueChange={v => update('maxCas', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
