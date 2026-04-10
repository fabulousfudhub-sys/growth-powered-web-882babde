import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { Department } from '@/lib/types';
import { toast } from 'sonner';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; }

export default function AddCourseDialog({ open, onOpenChange }: Props) {
  const [form, setForm] = useState({ code: '', title: '', departmentId: '', level: '', instructor: '', caWeight: '30', examWeight: '70', maxCas: '1' });
  const [departments, setDepartments] = useState<Department[]>([]);
  const update = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }));

  useEffect(() => {
    if (open) api.getDepartments().then(setDepartments).catch(() => {});
  }, [open]);

  const handleAdd = async () => {
    if (!form.code.trim() || !form.title.trim() || !form.departmentId) {
      toast.error('Course code, title, and department are required'); return;
    }
    try {
      await api.createCourse({
        code: form.code, title: form.title,
        departmentId: form.departmentId, schoolId: '',
        level: form.level,
        caWeight: parseFloat(form.caWeight),
        examWeight: parseFloat(form.examWeight),
        maxCas: parseInt(form.maxCas),
      });
      toast.success(`Course "${form.code}" added!`);
      onOpenChange(false);
      setForm({ code: '', title: '', departmentId: '', level: '', instructor: '', caWeight: '30', examWeight: '70', maxCas: '1' });
    } catch { toast.error('Failed to add course'); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Course</DialogTitle><DialogDescription>Register a new course</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Course Code <span className="text-destructive">*</span></Label><Input placeholder="e.g. COM 213" value={form.code} onChange={e => update('code', e.target.value)} required /></div>
            <div className="space-y-2"><Label>Level</Label><Select value={form.level} onValueChange={v => update('level', v)}><SelectTrigger><SelectValue placeholder="Level" /></SelectTrigger><SelectContent>{['ND1', 'ND2', 'HND1', 'HND2'].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Course Title <span className="text-destructive">*</span></Label><Input placeholder="e.g. Data Structures & Algorithms" value={form.title} onChange={e => update('title', e.target.value)} required /></div>
          <div className="space-y-2">
            <Label>Department <span className="text-destructive">*</span></Label>
            <Select value={form.departmentId} onValueChange={v => update('departmentId', v)}>
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>CA Weight (%)</Label><Input type="number" value={form.caWeight} onChange={e => { update('caWeight', e.target.value); update('examWeight', String(100 - parseFloat(e.target.value || '0'))); }} /></div>
            <div className="space-y-2"><Label>Exam Weight (%)</Label><Input type="number" value={form.examWeight} onChange={e => { update('examWeight', e.target.value); update('caWeight', String(100 - parseFloat(e.target.value || '0'))); }} /></div>
            <div className="space-y-2"><Label>Max CAs</Label><Select value={form.maxCas} onValueChange={v => update('maxCas', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!form.code.trim() || !form.title.trim() || !form.departmentId}>Add Course</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
