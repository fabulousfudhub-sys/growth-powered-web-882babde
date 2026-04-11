import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import type { Course } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Save, Upload, ImagePlus, X } from 'lucide-react';
import { toast } from 'sonner';
import ImportCSVDialog from '@/components/dialogs/ImportCSVDialog';

export default function CreateQuestionPage() {
  const { user } = useAuth();
  const [type, setType] = useState('mcq');
  const [text, setText] = useState('');
  const [course, setCourse] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.getCourses().then(allCourses => {
      const myCourses = user?.role === 'instructor' ? allCourses.filter(c => c.instructorId === user.id) : allCourses;
      setCourses(myCourses);
    });
  }, [user]);

  const updateOption = (i: number, val: string) => setOptions(prev => { const n = [...prev]; n[i] = val; return n; });
  const addOption = () => setOptions(prev => [...prev, '']);
  const removeOption = (i: number) => setOptions(prev => prev.filter((_, idx) => idx !== i));

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
    if (!text || !course) { toast.error('Please fill in all required fields'); return; }
    try {
      await api.createQuestion({
        type, text,
        options: type === 'mcq' ? options.filter(o => o) : undefined,
        correctAnswer: correctAnswer || undefined,
        difficulty,
        courseId: course,
        imageUrl: imageUrl || undefined,
      });
      toast.success('Question saved!');
      setText(''); setOptions(['', '', '', '']); setCorrectAnswer(''); setImageUrl('');
    } catch { toast.error('Failed to save question'); }
  };

  return (
    <div className="space-y-6 animate-slide-in max-w-2xl">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-foreground">Create Question</h1><p className="text-sm text-muted-foreground">Add a new question to your bank</p></div>
        <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}><Upload className="w-4 h-4" /> Import CSV</Button>
      </div>
      <Card className="border-border/40">
        <CardHeader><CardTitle className="text-base">Question Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Type</Label><Select value={type} onValueChange={setType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mcq">Multiple Choice</SelectItem><SelectItem value="true_false">True/False</SelectItem><SelectItem value="fill_blank">Fill in the Blank</SelectItem><SelectItem value="short_answer">Short Answer</SelectItem><SelectItem value="essay">Essay</SelectItem></SelectContent></Select></div>
            <div className="space-y-2"><Label>Course</Label><Select value={course} onValueChange={setCourse}><SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger><SelectContent>{courses.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.title}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="space-y-2"><Label>Question Text</Label><Textarea rows={3} placeholder="Enter the question..." value={text} onChange={e => setText(e.target.value)} /></div>

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
                <span className="text-sm text-muted-foreground">{uploading ? 'Uploading...' : 'Upload flowchart, diagram, or drawing'}</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            )}
          </div>

          {type === 'mcq' && (
            <div className="space-y-3">
              <Label>Options</Label>
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground w-6">{String.fromCharCode(65 + i)}.</span>
                  <Input placeholder={`Option ${String.fromCharCode(65 + i)}`} value={opt} onChange={e => updateOption(i, e.target.value)} className="flex-1" />
                  {options.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeOption(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                </div>
              ))}
              {options.length < 6 && <Button variant="outline" size="sm" onClick={addOption} className="gap-1"><Plus className="w-3 h-3" /> Add Option</Button>}
              <div className="space-y-2"><Label>Correct Answer</Label><Select value={correctAnswer} onValueChange={setCorrectAnswer}><SelectTrigger><SelectValue placeholder="Select correct option" /></SelectTrigger><SelectContent>{options.filter(o => o).map((o, i) => <SelectItem key={i} value={o}>{String.fromCharCode(65 + i)}. {o}</SelectItem>)}</SelectContent></Select></div>
            </div>
          )}
          {type === 'true_false' && <div className="space-y-2"><Label>Correct Answer</Label><Select value={correctAnswer} onValueChange={setCorrectAnswer}><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger><SelectContent><SelectItem value="True">True</SelectItem><SelectItem value="False">False</SelectItem></SelectContent></Select></div>}
          {(type === 'fill_blank' || type === 'short_answer') && <div className="space-y-2"><Label>Expected Answer</Label><Input placeholder="Expected answer..." value={correctAnswer} onChange={e => setCorrectAnswer(e.target.value)} /></div>}
          <div className="space-y-2"><Label>Difficulty</Label><Select value={difficulty} onValueChange={setDifficulty}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="easy">Easy</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="hard">Hard</SelectItem></SelectContent></Select></div>
          <Button onClick={handleSave} className="gap-2 w-full"><Save className="w-4 h-4" /> Save Question</Button>
        </CardContent>
      </Card>
      <ImportCSVDialog open={importOpen} onOpenChange={setImportOpen} type="questions" />
    </div>
  );
}
