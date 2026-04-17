import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  LogOut,
  Building2,
  ClipboardList,
  BarChart3,
  GraduationCap,
  FolderOpen,
  School,
  FileText,
  ScrollText,
  Settings,
  MessageSquare,
  Monitor,
  RefreshCw,
  Sparkles,
  Lock,
  Power,
  Key,
  Wifi,
  WifiOff,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

interface MenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const menuMap: Record<string, MenuSection[]> = {
  super_admin: [
    { label: "Overview", items: [{ title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard }] },
    { label: "Academic", items: [
      { title: "Schools", url: "/admin/schools", icon: School },
      { title: "Departments", url: "/admin/departments", icon: Building2 },
      { title: "Courses", url: "/admin/courses", icon: BookOpen },
    ]},
    { label: "Examination", items: [
      { title: "Exams", url: "/admin/exams", icon: ClipboardList },
      { title: "Question Banks", url: "/admin/questions", icon: FolderOpen },
      { title: "AI Generator", url: "/admin/questions/ai-generate", icon: Sparkles },
      { title: "Students", url: "/admin/students", icon: GraduationCap },
      { title: "Results", url: "/admin/results", icon: BarChart3 },
      { title: "Essay Grading", url: "/admin/grade-essays", icon: MessageSquare },
    ]},
    { label: "Administration", items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Sync Center", url: "/admin/sync", icon: RefreshCw },
      { title: "Network", url: "/admin/network", icon: Monitor },
      { title: "Reports", url: "/admin/reports", icon: FileText },
      { title: "Audit Log", url: "/admin/audit-log", icon: ScrollText },
      { title: "Settings", url: "/admin/settings", icon: Settings },
      { title: "License", url: "/admin/license", icon: Key },
    ]},
  ],
  admin: [
    { label: "Overview", items: [{ title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard }] },
    { label: "Academic", items: [
      { title: "Schools", url: "/admin/schools", icon: School },
      { title: "Departments", url: "/admin/departments", icon: Building2 },
      { title: "Courses", url: "/admin/courses", icon: BookOpen },
    ]},
    { label: "Examination", items: [
      { title: "Exams", url: "/admin/exams", icon: ClipboardList },
      { title: "Question Banks", url: "/admin/questions", icon: FolderOpen },
      { title: "AI Generator", url: "/admin/questions/ai-generate", icon: Sparkles },
      { title: "Students", url: "/admin/students", icon: GraduationCap },
      { title: "Results", url: "/admin/results", icon: BarChart3 },
      { title: "Essay Grading", url: "/admin/grade-essays", icon: MessageSquare },
    ]},
    { label: "Administration", items: [
      { title: "Users", url: "/admin/users", icon: Users },
      { title: "Sync Center", url: "/admin/sync", icon: RefreshCw },
      { title: "Network", url: "/admin/network", icon: Monitor },
      { title: "Settings", url: "/admin/settings", icon: Settings },
    ]},
  ],
  examiner: [
    { label: "Overview", items: [{ title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard }] },
    { label: "Department", items: [
      { title: "Department", url: "/admin/departments", icon: Building2 },
      { title: "Instructors", url: "/admin/users", icon: Users },
    ]},
    { label: "Examination", items: [
      { title: "Exams", url: "/admin/exams", icon: ClipboardList },
      { title: "Question Bank", url: "/admin/questions", icon: FolderOpen },
      { title: "AI Generator", url: "/admin/questions/ai-generate", icon: Sparkles },
      { title: "Students", url: "/admin/students", icon: GraduationCap },
      { title: "Results", url: "/admin/results", icon: BarChart3 },
      { title: "Essay Grading", url: "/admin/grade-essays", icon: MessageSquare },
    ]},
    { label: "Account", items: [{ title: "Settings", url: "/admin/settings", icon: Settings }] },
  ],
  instructor: [
    { label: "Overview", items: [{ title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard }] },
    { label: "Teaching", items: [
      { title: "My Courses", url: "/admin/courses", icon: BookOpen },
      { title: "Question Bank", url: "/admin/questions", icon: FolderOpen },
      { title: "AI Generator", url: "/admin/questions/ai-generate", icon: Sparkles },
      { title: "Student Results", url: "/admin/results", icon: BarChart3 },
      { title: "Essay Grading", url: "/admin/grade-essays", icon: MessageSquare },
    ]},
    { label: "Account", items: [{ title: "Settings", url: "/admin/settings", icon: Settings }] },
  ],
  lab_admin: [
    { label: "Overview", items: [{ title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard }] },
    { label: "Examination", items: [
      { title: "Exams", url: "/admin/exams", icon: ClipboardList },
      { title: "Results", url: "/admin/results", icon: BarChart3 },
      { title: "Reports", url: "/admin/reports", icon: FileText },
    ]},
    { label: "Monitoring", items: [
      { title: "Network", url: "/admin/network", icon: Monitor },
    ]},
  ],
};

interface AdminSidebarProps {
  siteName?: string;
  logoUrl?: string;
}

export function AdminSidebar({ siteName = "ATAPOLY", logoUrl = "/logo.png" }: AdminSidebarProps) {
  const { user, logout } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [syncStatus, setSyncStatus] = useState<{ isOnline: boolean; isSyncing: boolean; totalPending: number } | null>(null);

  useEffect(() => {
    if (!user || user.role === "student") return;
    const fetchStatus = () => {
      api.getSyncStatus()
        .then((s: any) => setSyncStatus({ isOnline: !!s.isOnline, isSyncing: !!s.isSyncing, totalPending: s.totalPending || 0 }))
        .catch(() => {});
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 30000);
    return () => clearInterval(t);
  }, [user]);

  if (!user || user.role === "student") return null;

  const sections = menuMap[user.role] || [];

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <div className="h-16 flex items-center px-4 gap-3 border-b border-sidebar-border shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
          <img src={logoUrl} alt={`${siteName} Logo`} className="w-5 h-5 object-contain" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-sm font-bold text-sidebar-foreground tracking-tight leading-tight">{siteName}</p>
            <p className="text-[10px] text-sidebar-foreground/50 uppercase tracking-widest">CBT System</p>
          </div>
        )}
      </div>

      <SidebarContent className="px-2 pt-2">
        {sections.map((section, idx) => (
          <SidebarGroup key={idx}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-semibold px-3 mb-1">
                {section.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end
                        className="rounded-lg px-3 py-2 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium shadow-sm"
                      >
                        <item.icon className="mr-2.5 h-4 w-4 shrink-0" />
                        {!collapsed && <span className="text-sm">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-3 border-t border-sidebar-border">
        {syncStatus && (
          <div className={`mb-2 flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] ${syncStatus.isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            {syncStatus.isOnline ? <Wifi className="h-3.5 w-3.5 shrink-0" /> : <WifiOff className="h-3.5 w-3.5 shrink-0" />}
            {!collapsed && (
              <span className="truncate">
                {syncStatus.isSyncing ? 'Syncing…' : syncStatus.isOnline ? 'Online' : 'Offline'}
                {syncStatus.totalPending > 0 && ` · ${syncStatus.totalPending} pending`}
              </span>
            )}
          </div>
        )}
        {!collapsed && (
          <div className="mb-2 px-2 py-2 rounded-lg bg-sidebar-accent/30">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user.name}</p>
            <p className="text-[11px] text-sidebar-foreground/50 truncate">{user.email}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={logout}
          className="w-full justify-start text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-destructive/10 hover:text-destructive rounded-lg"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="ml-2 text-sm">Sign Out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
