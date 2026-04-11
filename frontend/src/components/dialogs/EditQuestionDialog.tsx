import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { Question, Course } from '@/lib/types';
import { ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;
}

export default function EditQuestionDialog({ open, onOpenChange, question }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [type, setType] = useState('mcq');
  const [text, setText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [courseId, setCourseId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) api.getCourses().then(setCourses).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (question) {
      setType(question.type);
      setText(question.text);
      setOptions(question.options?.length ? [...question.options, '', '', '', ''].slice(0, 4) : ['', '', '', '']);
      setCorrectAnswer(typeof question.correctAnswer === 'string' ? question.correctAnswer : (question.correctAnswer?.[0] || ''));
      setDifficulty(question.difficulty);
      setImageUrl(question.imageUrl || '');
      const course = courses.find(c => c.code === question.course);
      if (course) setCourseId(course.id);
    }
  }, [question, courses]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await api.uploadFile(file);
      setImageUrl(result.url);
      toast.success('Image uploaded');
    } catch { toast.error('Failed to upload image'); }
    finally { setUploading(false); }
  };

  const handleSave = async () => {
    if (!question || !text.trim()) return;
    setSaving(true);
    try {
      await api.updateQuestion(question.id, {
        type, text, options: type === 'mcq' ? options.filter(o => o.trim()) : undefined,
        correctAnswer: correctAnswer || undefined, difficulty, courseId,
        imageUrl: imageUrl || undefined,
      });
      toast.success('Question updated');
      onOpenChange(false);
    } catch (err: any) { toast.error(err.message || 'Failed to update question'); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Question</DialogTitle><DialogDescription>Modify the question details</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type <span className="text-destructive">*</span></Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mcq">MCQ</SelectItem>
                  <SelectItem value="true_false">True/False</SelectItem>
                  <SelectItem value="fill_blank">Fill Blank</SelectItem>
                  <SelectItem value="short_answer">Short Answer</SelectItem>
                  <SelectItem value="essay">Essay</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Difficulty <span className="text-destructive">*</span></Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Course <span className="text-destructive">*</span></Label>
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Question Text <span className="text-destructive">*</span></Label>
            <Textarea rows={3} value={text} onChange={e => setText(e.target.value)} required />
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <Label>Question Image (optional)</Label>
            {imageUrl ? (
              <div className="relative inline-block">
                <img src={imageUrl} alt="Question" className="max-h-40 rounded-lg border border-border object-contain" />
                <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6" onClick={() => setImageUrl('')}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <label className="flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                <ImagePlus className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Click to upload an image'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>

          {type === 'mcq' && (
            <div className="space-y-2">
              <Label>Options</Label>
              {options.map((opt, i) => (
                <Input key={i} placeholder={`Option ${String.fromCharCode(65 + i)}`} value={opt} onChange={e => { const n = [...options]; n[i] = e.target.value; setOptions(n); }} />
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label>Correct Answer</Label>
            {type === 'true_false' ? (
              <Select value={correctAnswer} onValueChange={setCorrectAnswer}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent><SelectItem value="True">True</SelectItem><SelectItem value="False">False</SelectItem></SelectContent>
              </Select>
            ) : <Input value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} placeholder="Enter correct answer" />}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()}>{saving ? 'Saving...' : 'Save Changes'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
