import { useState, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  getSiteSettings,
  getCachedSiteSettings,
  type SiteSettings,
} from "@/pages/admin/SettingsPage";
import {
  API_ROUTE_CHANGED_EVENT,
  getApiRouteStatus,
  api,
  type ApiConnectivityRoute,
} from "@/lib/api";

const roleLabels: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  examiner: "Examiner",
  instructor: "Instructor",
};

const roleBadgeClass: Record<string, string> = {
  super_admin: "bg-destructive/10 text-destructive border-destructive/20",
  admin: "bg-primary/10 text-primary border-primary/20",
  examiner: "bg-accent/10 text-accent border-accent/20",
  instructor: "bg-warning/10 text-warning border-warning/20",
};

const routeBadgeClass: Record<ApiConnectivityRoute, string> = {
  cloud_gateway: "bg-primary/10 text-primary border-primary/20",
  local_backend: "bg-accent/10 text-accent border-accent/20",
  unknown: "bg-muted text-muted-foreground border-border",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [site, setSite] = useState<SiteSettings>(getCachedSiteSettings());
  const [apiRoute, setApiRoute] = useState(getApiRouteStatus());
  const [licenseExpiresAt, setLicenseExpiresAt] = useState<string | null>(null);

  // Poll license status every 10 minutes (super_admin only sees the banner)
  useEffect(() => {
    if (user?.role !== "super_admin") return;
    let mounted = true;
    const refresh = () =>
      api
        .getPublicLicenseStatus()
        .then((s) => mounted && setLicenseExpiresAt(s.expiresAt))
        .catch(() => {});
    refresh();
    const t = setInterval(refresh, 10 * 60 * 1000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, [user?.role]);

  const licenseDaysLeft = (() => {
    if (!licenseExpiresAt) return null;
    const ms = new Date(licenseExpiresAt).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  })();
  const showLicenseBanner =
    user?.role === "super_admin" &&
    licenseDaysLeft !== null &&
    licenseDaysLeft <= 7;

  useEffect(() => {
    getSiteSettings().then(setSite);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setSite(detail);
    };
    window.addEventListener("cbt-settings-changed", handler);
    return () => window.removeEventListener("cbt-settings-changed", handler);
  }, []);

  useEffect(() => {
    setApiRoute(getApiRouteStatus());
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setApiRoute(detail);
      } else {
        setApiRoute(getApiRouteStatus());
      }
    };
    window.addEventListener(API_ROUTE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(API_ROUTE_CHANGED_EVENT, handler);
  }, []);

  // Sync document title and favicon with settings
  useEffect(() => {
    if (site.siteName) document.title = site.siteName;
    if (site.faviconUrl) {
      const link = document.querySelector(
        "link[rel~='icon']",
      ) as HTMLLinkElement;
      if (link) link.href = site.faviconUrl;
    }
  }, [site]);

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar siteName={site.acronym} logoUrl={site.logoUrl} />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="h-16 flex items-center border-b border-border/50 bg-card/60 backdrop-blur-xl px-6 gap-4 shrink-0 sticky top-0 z-10">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="ml-auto flex items-center gap-3">
              <Badge
                variant="outline"
                className={`text-[10px] font-semibold hidden md:flex ${routeBadgeClass[apiRoute.route]}`}
              >
                {apiRoute.label}
              </Badge>

              <Badge
                variant="outline"
                className={`text-[10px] font-semibold hidden sm:flex ${roleBadgeClass[user?.role || ""]}`}
              >
                {roleLabels[user?.role || ""] || user?.role}
              </Badge>

              <div className="flex items-center gap-3 pl-3 border-l border-border/50">
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium text-foreground leading-tight">
                    {user?.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-sm">
                  {initials}
                </div>
              </div>
            </div>
          </header>
          {showLicenseBanner && (
            <div
              className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium border-b ${
                licenseDaysLeft! <= 3
                  ? "bg-destructive/10 text-destructive border-destructive/30"
                  : "bg-warning/10 text-warning-foreground border-warning/30"
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                {licenseDaysLeft! <= 0
                  ? "Your license has expired. The system will lock soon — renew immediately."
                  : `License expires in ${licenseDaysLeft} day${licenseDaysLeft === 1 ? "" : "s"} — please renew to avoid lockout.`}
              </span>
            </div>
          )}
          <main className="flex-1 overflow-auto p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
