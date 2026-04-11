import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { Course } from '@/lib/types';
import { Plus, Trash2, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; }

export default function AddQuestionDialog({ open, onOpenChange }: Props) {
  const [type, setType] = useState('mcq');
  const [text, setText] = useState('');
  const [courseId, setCourseId] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open) api.getCourses().then(setCourses).catch(() => {});
  }, [open]);

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

  const handleAdd = async () => {
    if (!text.trim()) { toast.error('Question text is required'); return; }
    if (!courseId) { toast.error('Course is required'); return; }
    if (type === 'mcq' && !correctAnswer) { toast.error('Select the correct answer'); return; }
    if (type === 'true_false' && !correctAnswer) { toast.error('Select True or False'); return; }
    try {
      await api.createQuestion({
        type, text,
        options: type === 'mcq' ? options.filter(o => o) : undefined,
        correctAnswer: correctAnswer || undefined,
        difficulty, courseId,
        imageUrl: imageUrl || undefined,
      });
      toast.success('Question added to the bank!');
      onOpenChange(false);
      setText(''); setOptions(['', '', '', '']); setCorrectAnswer(''); setImageUrl('');
    } catch { toast.error('Failed to add question'); }
  };

  const updateOption = (index: number, val: string) => setOptions(prev => { const n = [...prev]; n[index] = val; return n; });
  const addOption = () => setOptions(prev => [...prev, '']);
  const removeOption = (index: number) => setOptions(prev => prev.filter((_, i) => i !== index));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Question</DialogTitle><DialogDescription>Add a new question to the question bank</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Question Type <span className="text-destructive">*</span></Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mcq">Multiple Choice</SelectItem><SelectItem value="true_false">True/False</SelectItem><SelectItem value="fill_blank">Fill in the Blank</SelectItem><SelectItem value="short_answer">Short Answer</SelectItem><SelectItem value="essay">Essay</SelectItem><SelectItem value="matching">Matching</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Course <span className="text-destructive">*</span></Label><Select value={courseId} onValueChange={setCourseId}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Question Text <span className="text-destructive">*</span></Label><Textarea rows={3} placeholder="Enter the question..." value={text} onChange={e => setText(e.target.value)} required /></div>

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
              <div>
                <label className="flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-lg p-4 hover:bg-muted/50 transition-colors">
                  <ImagePlus className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Click to upload an image (flowchart, diagram, etc.)'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
                </label>
              </div>
            )}
          </div>

          {type === 'mcq' && (
            <div className="space-y-3">
              <Label>Options <span className="text-destructive">*</span></Label>
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-6">{String.fromCharCode(65 + i)}.</span>
                  <Input placeholder={`Option ${String.fromCharCode(65 + i)}`} value={opt} onChange={e => updateOption(i, e.target.value)} className="flex-1" required />
                  {options.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeOption(i)} className="shrink-0"><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                </div>
              ))}
              {options.length < 6 && <Button variant="outline" size="sm" onClick={addOption} className="gap-1"><Plus className="w-3 h-3" /> Add Option</Button>}
              <div className="space-y-2"><Label>Correct Answer <span className="text-destructive">*</span></Label><Select value={correctAnswer} onValueChange={setCorrectAnswer}><SelectTrigger><SelectValue placeholder="Select correct option" /></SelectTrigger><SelectContent>{options.filter(o => o).map((o, i) => <SelectItem key={i} value={o}>{String.fromCharCode(65 + i)}. {o}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}
          {type === 'true_false' && <div className="space-y-2"><Label>Correct Answer <span className="text-destructive">*</span></Label><Select value={correctAnswer} onValueChange={setCorrectAnswer}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="True">True</SelectItem><SelectItem value="False">False</SelectItem></SelectContent></Select></div>}
          {(type === 'fill_blank' || type === 'short_answer') && <div className="space-y-2"><Label>Expected Answer <span className="text-destructive">*</span></Label><Input placeholder="Expected answer..." value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} required /></div>}
          <div className="space-y-2"><Label>Difficulty <span className="text-destructive">*</span></Label><Select value={difficulty} onValueChange={setDifficulty}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="easy">Easy</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="hard">Hard</SelectItem></SelectContent></Select></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={!text.trim() || !courseId}>Add Question</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
