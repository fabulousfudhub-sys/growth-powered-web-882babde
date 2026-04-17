import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Database,
  Cpu,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Archive,
  ClipboardList,
  GraduationCap,
  PenSquare,
} from "lucide-react";

interface HealthData {
  timestamp: string;
  uptime: number;
  node: string;
  memory: { used: number; total: number; systemFreeMb: number; systemTotalMb: number };
  cpu: { loadAvg: number[]; cores: number };
  db: { reachable: boolean; latencyMs: number | null; pool: any; error?: string };
  sync: any;
  license: { active: boolean; expiresAt: string | null; daysRemaining: number | null };
  backups: { last: any; count: number };
  pendingEssayGrading: number;
  activeExams: number;
  activeAttempts: number;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function SystemHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const d = await api.getSystemHealth();
      setData(d);
    } catch (err) {
      console.error("Failed to load health", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading system health…</div>;
  }
  if (!data) {
    return <div className="p-6 text-destructive">Failed to load system health</div>;
  }

  const memUsedPct = Math.round((data.memory.used / data.memory.total) * 100);
  const sysMemUsedMb = data.memory.systemTotalMb - data.memory.systemFreeMb;
  const sysMemPct = Math.round((sysMemUsedMb / data.memory.systemTotalMb) * 100);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Last refreshed {new Date(data.timestamp).toLocaleTimeString()} · uptime {formatUptime(data.uptime)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Database className="w-4 h-4" />}
          label="Database"
          value={data.db.reachable ? `${data.db.latencyMs} ms` : "Down"}
          tone={data.db.reachable ? "success" : "destructive"}
          sub={data.db.pool ? `Pool ${data.db.pool.idle}/${data.db.pool.total} idle` : data.db.error}
        />
        <StatCard
          icon={<Cpu className="w-4 h-4" />}
          label="CPU Load"
          value={data.cpu.loadAvg[0].toFixed(2)}
          tone={data.cpu.loadAvg[0] > data.cpu.cores ? "warning" : "default"}
          sub={`${data.cpu.cores} cores · 1m / 5m / 15m`}
        />
        <StatCard
          icon={<HardDrive className="w-4 h-4" />}
          label="Memory (heap)"
          value={`${memUsedPct}%`}
          tone={memUsedPct > 85 ? "warning" : "default"}
          sub={`${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`}
        />
        <StatCard
          icon={<HardDrive className="w-4 h-4" />}
          label="System RAM"
          value={`${sysMemPct}%`}
          tone={sysMemPct > 90 ? "warning" : "default"}
          sub={`${sysMemUsedMb} / ${data.memory.systemTotalMb} MB`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<ClipboardList className="w-4 h-4" />}
          label="Active Exams"
          value={String(data.activeExams)}
          tone="default"
        />
        <StatCard
          icon={<GraduationCap className="w-4 h-4" />}
          label="In-progress Attempts"
          value={String(data.activeAttempts)}
          tone="default"
        />
        <StatCard
          icon={<PenSquare className="w-4 h-4" />}
          label="Essays Pending Grade"
          value={String(data.pendingEssayGrading)}
          tone={data.pendingEssayGrading > 0 ? "warning" : "default"}
        />
        <StatCard
          icon={<Archive className="w-4 h-4" />}
          label="Backups Stored"
          value={String(data.backups.count)}
          sub={
            data.backups.last
              ? `Last ${new Date(data.backups.last.created_at).toLocaleString()}`
              : "No backups yet"
          }
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Sync Status
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {data.sync?.error ? (
              <p className="text-destructive">{data.sync.error}</p>
            ) : (
              <>
                <Row label="Online" value={data.sync?.isOnline ? "Yes" : "No"} />
                <Row label="Pending uploads" value={String(data.sync?.totalPending ?? 0)} />
                <Row
                  label="Last sync"
                  value={
                    data.sync?.lastSyncAt
                      ? new Date(data.sync.lastSyncAt).toLocaleString()
                      : "Never"
                  }
                />
                {data.sync?.lastError && (
                  <p className="text-xs text-destructive break-words">{data.sync.lastError}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> License & Runtime
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row
              label="License"
              value={
                <Badge variant={data.license.active ? "default" : "destructive"}>
                  {data.license.active ? "Active" : "Inactive"}
                </Badge>
              }
            />
            {data.license.expiresAt && (
              <Row
                label="Expires"
                value={`${new Date(data.license.expiresAt).toLocaleDateString()} (${data.license.daysRemaining}d)`}
              />
            )}
            <Row label="Node" value={data.node} />
            <Row label="Uptime" value={formatUptime(data.uptime)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "destructive"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
          {icon}
          {label}
        </div>
        <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
