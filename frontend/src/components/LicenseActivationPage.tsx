import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShieldX, ShieldCheck, Loader2, Key, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface PublicStatus {
  active: boolean;
  expired: boolean;
  expiresAt: string | null;
  licenseKey: string | null;
}

interface Props {
  status: PublicStatus | null;
  onActivated: () => void;
}

/**
 * Full-screen license activation page. Shown when no valid license is cached
 * on the backend — the rest of the app is unreachable until a key is accepted.
 */
export default function LicenseActivationPage({ status, onActivated }: Props) {
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [serverReachable, setServerReachable] = useState(true);

  // Re-check connectivity every 30s so the "offline" banner clears automatically
  useEffect(() => {
    let mounted = true;
    const ping = () => api.getPublicLicenseStatus().then(() => mounted && setServerReachable(true)).catch(() => mounted && setServerReachable(false));
    const t = setInterval(ping, 30_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setActivating(true);
    try {
      await api.activateLicensePublic(licenseKey.trim());
      toast.success("License activated. Loading system…");
      setLicenseKey("");
      onActivated();
    } catch (err: any) {
      toast.error(err?.message || "Activation failed. Check the key and try again.");
    } finally {
      setActivating(false);
    }
  };

  const isExpired = !!status?.expired;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <ShieldX className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">System Locked</h1>
          <p className="text-sm text-muted-foreground">
            {isExpired
              ? "Your license has expired. Enter a new license key to continue."
              : "A valid license key is required to access this system."}
          </p>
        </div>

        <Card className="border-2 border-destructive/30">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Activate License</CardTitle>
                <CardDescription className="text-xs">
                  Enter the key provided by your administrator
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleActivate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="license">License Key</Label>
                <Input
                  id="license"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="font-mono"
                  autoFocus
                  required
                />
              </div>

              {status?.licenseKey && (
                <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Last key on file</span>
                  <span className="font-mono">{status.licenseKey}</span>
                </div>
              )}
              {status?.expiresAt && (
                <div className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/50">
                  <span className="text-muted-foreground">Expired on</span>
                  <span className={isExpired ? "text-destructive font-medium" : ""}>
                    {new Date(status.expiresAt).toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" })}
                  </span>
                </div>
              )}

              <Button type="submit" disabled={activating || !licenseKey.trim()} className="w-full">
                {activating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Activate System
              </Button>

              {!serverReachable && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-warning/10 border border-warning/30 text-xs">
                  <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                  <p className="text-foreground">
                    Cannot reach the licence server. Activation requires a connection to the local backend.
                  </p>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Need a license key? Contact your system administrator or your software vendor.
        </p>
      </div>
    </div>
  );
}
