import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { User, Department } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Upload, Search, UserPlus, Eye, Pencil, Trash2, ChevronDown, Building2 } from "lucide-react";
import AddStudentDialog from "@/components/dialogs/AddStudentDialog";
import EditUserDialog from "@/components/dialogs/EditUserDialog";
import ImportCSVDialog from "@/components/dialogs/ImportCSVDialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

export default function StudentsPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterLevel, setFilterLevel] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editStudent, setEditStudent] = useState<User | null>(null);
  const [previewStudent, setPreviewStudent] = useState<User | null>(null);
  const [deleteStudent, setDeleteStudent] = useState<User | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const load = () => {
    api.getStudents().then((all) => {
      setStudents(
        user?.role === "examiner"
          ? all.filter((s) => s.department === user.department)
          : all,
      );
    });
    api.getDepartments().then(setDepartments).catch(() => {});
  };
  useEffect(load, [user]);

  const levels = [...new Set(students.map(s => s.level).filter(Boolean))].sort();

  const filtered = students.filter((s) => {
    const matchSearch =
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.regNumber?.toLowerCase().includes(search.toLowerCase()) ||
      s.department?.toLowerCase().includes(search.toLowerCase());
    const matchDept = filterDept === "all" || s.department === filterDept;
    const matchLevel = filterLevel === "all" || s.level === filterLevel;
    return matchSearch && matchDept && matchLevel;
  });

  // Group by department -> level
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, User[]>>();
    for (const s of filtered) {
      const dept = s.department || "Unknown";
      const level = s.level || "Unknown";
      if (!map.has(dept)) map.set(dept, new Map());
      const levelMap = map.get(dept)!;
      if (!levelMap.has(level)) levelMap.set(level, []);
      levelMap.get(level)!.push(s);
    }
    return map;
  }, [filtered]);

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleDelete = async () => {
    if (!deleteStudent) return;
    try {
      await api.deleteUser(deleteStudent.id);
      toast.success("Student deleted");
      setStudents((prev) => prev.filter((s) => s.id !== deleteStudent.id));
    } catch (err: any) {
      toast.error(err.message || "Failed to delete student");
    }
    setDeleteStudent(null);
  };

  const handleBulkDelete = async () => {
    let deleted = 0;
    for (const id of selected) {
      try { await api.deleteUser(id); deleted++; } catch {}
    }
    toast.success(`${deleted} student(s) deleted`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
    load();
  };

  return (
    <div className="space-y-6 animate-slide-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Students</h1>
          <p className="text-sm text-muted-foreground">
            {user?.role === "examiner" ? `Students in ${user.department}` : "Manage student records — grouped by department and level"}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              Delete {selected.size} Selected
            </Button>
          )}
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button className="gap-2" onClick={() => setAddOpen(true)}>
            <UserPlus className="w-4 h-4" /> Add Student
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search students..." className="pl-10" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterLevel} onValueChange={setFilterLevel}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Level" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Levels</SelectItem>
            {levels.map(l => <SelectItem key={l} value={l!}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} student(s) total</p>

      {/* Grouped by Department → Level */}
      <div className="space-y-4">
        {Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([dept, levelMap]) => {
          const deptKey = `dept-${dept}`;
          const isDeptOpen = openGroups.has(deptKey);
          const deptCount = Array.from(levelMap.values()).reduce((s, arr) => s + arr.length, 0);

          return (
            <Collapsible key={deptKey} open={isDeptOpen} onOpenChange={() => toggleGroup(deptKey)}>
              <Card className="border-border/40">
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Building2 className="w-5 h-5 text-primary" />
                        <div>
                          <CardTitle className="text-base">{dept}</CardTitle>
                          <p className="text-xs text-muted-foreground">{deptCount} student(s)</p>
                        </div>
                      </div>
                      <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${isDeptOpen ? "rotate-180" : ""}`} />
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-3 pt-0">
                    {Array.from(levelMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([level, studs]) => {
                      const levelKey = `${dept}-${level}`;
                      const isLevelOpen = openGroups.has(levelKey);

                      return (
                        <Collapsible key={levelKey} open={isLevelOpen} onOpenChange={() => toggleGroup(levelKey)}>
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                              <span className="text-sm font-medium">{level} <span className="text-muted-foreground font-normal">({studs.length})</span></span>
                              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isLevelOpen ? "rotate-180" : ""}`} />
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <ScrollArea className="max-h-[300px]">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-10">
                                      <Checkbox
                                        checked={studs.every(s => selected.has(s.id))}
                                        onCheckedChange={() => {
                                          const allSelected = studs.every(s => selected.has(s.id));
                                          setSelected(prev => {
                                            const next = new Set(prev);
                                            studs.forEach(s => allSelected ? next.delete(s.id) : next.add(s.id));
                                            return next;
                                          });
                                        }}
                                      />
                                    </TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Reg. Number</TableHead>
                                    <TableHead>Last Login</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {studs.map((s) => (
                                    <TableRow key={s.id}>
                                      <TableCell><Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggleSelect(s.id)} /></TableCell>
                                      <TableCell className="font-medium">{s.name}</TableCell>
                                      <TableCell className="font-mono text-sm">{s.regNumber}</TableCell>
                                      <TableCell className="text-muted-foreground text-sm">
                                        {s.lastLogin ? new Date(s.lastLogin).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "—"}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreviewStudent(s)}><Eye className="w-4 h-4" /></Button>
                                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditStudent(s)}><Pencil className="w-4 h-4" /></Button>
                                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteStudent(s)}><Trash2 className="w-4 h-4" /></Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </ScrollArea>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
        {grouped.size === 0 && (
          <div className="text-center py-12 text-muted-foreground">No students found</div>
        )}
      </div>

      {/* Preview Dialog */}
      <Dialog open={!!previewStudent} onOpenChange={() => setPreviewStudent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Student Details</DialogTitle>
            <DialogDescription>{previewStudent?.regNumber}</DialogDescription>
          </DialogHeader>
          {previewStudent && (
            <div className="space-y-3 text-sm">
              <div className="p-3 rounded-lg bg-muted"><strong>Name:</strong> {previewStudent.name}</div>
              <div className="p-3 rounded-lg bg-muted"><strong>Email:</strong> {previewStudent.email}</div>
              <div className="p-3 rounded-lg bg-muted"><strong>Department:</strong> {previewStudent.department}</div>
              <div className="p-3 rounded-lg bg-muted"><strong>Level:</strong> {previewStudent.level}</div>
              <div className="p-3 rounded-lg bg-muted"><strong>Last Login:</strong> {previewStudent.lastLogin ? new Date(previewStudent.lastLogin).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Never"}</div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setPreviewStudent(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialogs */}
      <AlertDialog open={!!deleteStudent} onOpenChange={() => setDeleteStudent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Student</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete "{deleteStudent?.name}"?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} Students</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove all selected students.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete All</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddStudentDialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) load(); }} />
      <EditUserDialog open={!!editStudent} onOpenChange={(o) => { if (!o) { setEditStudent(null); load(); } }} user={editStudent} isStudent />
      <ImportCSVDialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) load(); }} type="students" />
    </div>
  );
}
