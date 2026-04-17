import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { History, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Version {
  id: string;
  version: number;
  type: string;
  text: string;
  options: any;
  correct_answer: any;
  difficulty: string;
  marks: number | null;
  image_url: string | null;
  edited_by_name: string | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string | null;
  onRestored?: () => void;
}

export default function QuestionVersionHistoryDialog({
  open,
  onOpenChange,
  questionId,
  onRestored,
}: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !questionId) return;
    setLoading(true);
    api
      .getQuestionVersions(questionId)
      .then(setVersions)
      .catch(() => toast.error("Failed to load history"))
      .finally(() => setLoading(false));
  }, [open, questionId]);

  const handleRestore = async (versionId: string, version: number) => {
    if (!questionId) return;
    if (!confirm(`Restore question to version ${version}? Current version will be saved as a new snapshot.`))
      return;
    setRestoring(versionId);
    try {
      await api.restoreQuestionVersion(questionId, versionId);
      toast.success(`Restored to version ${version}`);
      onRestored?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || "Restore failed");
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" /> Version History
          </DialogTitle>
          <DialogDescription>
            All previous edits are saved automatically. Restore to roll back.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-4">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading versions…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No previous versions yet. Edits to this question will be tracked here.
            </p>
          ) : (
            <div className="space-y-3">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="border border-border rounded-lg p-4 space-y-2 bg-card"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">v{v.version}</Badge>
                      <Badge variant="secondary" className="text-xs">{v.type}</Badge>
                      <Badge variant="secondary" className="text-xs">{v.difficulty}</Badge>
                      {v.marks != null && (
                        <Badge variant="secondary" className="text-xs">{v.marks} marks</Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRestore(v.id, v.version)}
                      disabled={restoring === v.id}
                    >
                      {restoring === v.id ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      Restore
                    </Button>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{v.text}</p>
                  {Array.isArray(v.options) && v.options.length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-4 list-disc">
                      {v.options.map((opt: string, i: number) => (
                        <li key={i}>{opt}</li>
                      ))}
                    </ul>
                  )}
                  {v.correct_answer != null && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">Answer: </span>
                      <span className="font-mono">
                        {Array.isArray(v.correct_answer)
                          ? v.correct_answer.join(", ")
                          : String(v.correct_answer)}
                      </span>
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
                    Edited {new Date(v.created_at).toLocaleString()}
                    {v.edited_by_name ? ` by ${v.edited_by_name}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
