import type { Question } from '@/lib/types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AspectRatio } from '@/components/ui/aspect-ratio';

interface QuestionRendererProps {
  question: Question;
  answer: string;
  onAnswer: (value: string) => void;
}

const optionLetters = ['A', 'B', 'C', 'D', 'E'];

function QuestionImage({ url }: { url: string }) {
  return (
    <div className="mb-4">
      <img
        src={url}
        alt="Question illustration"
        className="max-h-64 w-auto rounded-lg border border-border object-contain mx-auto"
      />
    </div>
  );
}

export default function QuestionRenderer({ question: q, answer, onAnswer }: QuestionRendererProps) {
  const image = q.imageUrl ? <QuestionImage url={q.imageUrl} /> : null;

  if (q.type === 'mcq' && q.options) {
    return (
      <div>
        {image}
        <RadioGroup value={answer} onValueChange={onAnswer} className="space-y-3">
          {q.options.map((opt, i) => (
            <div
              key={i}
              className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${answer === opt ? 'border-accent bg-accent/5' : 'hover:bg-muted/50'}`}
            >
              <RadioGroupItem value={opt} id={`${q.id}-${i}`} />
              <Label htmlFor={`${q.id}-${i}`} className="flex-1 cursor-pointer text-sm">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-muted text-muted-foreground text-xs font-bold mr-2">
                  {optionLetters[i]}
                </span>
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (q.type === 'true_false') {
    return (
      <div>
        {image}
        <RadioGroup value={answer} onValueChange={onAnswer} className="space-y-3">
          {['True', 'False'].map((opt, i) => (
            <div
              key={opt}
              className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${answer === opt ? 'border-accent bg-accent/5' : 'hover:bg-muted/50'}`}
            >
              <RadioGroupItem value={opt} id={`${q.id}-${opt}`} />
              <Label htmlFor={`${q.id}-${opt}`} className="flex-1 cursor-pointer text-sm">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-muted text-muted-foreground text-xs font-bold mr-2">
                  {optionLetters[i]}
                </span>
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (q.type === 'fill_blank') {
    return (
      <div>
        {image}
        <Input
          placeholder="Type your answer..."
          value={answer}
          onChange={(e) => onAnswer(e.target.value)}
        />
      </div>
    );
  }

  if (q.type === 'short_answer' || q.type === 'essay') {
    return (
      <div>
        {image}
        <Textarea
          placeholder="Type your answer..."
          rows={q.type === 'essay' ? 8 : 3}
          value={answer}
          onChange={(e) => onAnswer(e.target.value)}
        />
      </div>
    );
  }

  return null;
}
