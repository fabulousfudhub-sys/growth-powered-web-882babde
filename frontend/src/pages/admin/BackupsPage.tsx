import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Archive, Download, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Backup {
  id: string;
  filename: string;
  size_bytes: number | null;
  table_count: number | null;
  row_count: number | null;
  status: string;
  error_message: string | null;
  triggered_by: string;
  created_at: string;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    try {
      const data = await api.getBackups();
      setBackups(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleTrigger = async () => {
    setRunning(true);
    try {
      const result = await api.triggerBackup();
      toast.success(`Backup created: ${result.filename}`);
      await load();
    } catch (err: any) {
      toast.error(err?.message || "Backup failed");
    } finally {
      setRunning(false);
    }
  };

  const handleDownload = (filename: string) => {
    window.open(api.getBackupDownloadUrl(filename), "_blank");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Archive className="w-6 h-6" /> Database Backups
          </h1>
          <p className="text-sm text-muted-foreground">
            Automatic nightly backups at 02:00 · last 7 retained on disk
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={handleTrigger} disabled={running}>
            {running ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <PlayCircle className="w-4 h-4 mr-2" />
            )}
            Run backup now
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent backups</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No backups yet. Click "Run backup now" to create one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Filename</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backups.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.filename}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(b.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">{formatBytes(b.size_bytes)}</TableCell>
                    <TableCell className="text-sm">{b.row_count ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant={b.status === "completed" ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {b.status}
                      </Badge>
                      {b.error_message && (
                        <p className="text-xs text-destructive mt-1 truncate max-w-[200px]">
                          {b.error_message}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {b.triggered_by}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {b.status === "completed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(b.filename)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
