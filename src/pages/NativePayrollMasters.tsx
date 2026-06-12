import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Upload,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiList<T> {
  success: boolean;
  data: T[];
}

interface SalarySlab {
  id: number;
  slab_code: string;
  range_from: number;
  range_to: number;
  label: string;
  seq_order: number;
  status: string;
}

interface DesigMatrix {
  id: number;
  department_id: number;
  designation_id: number;
  grade_id: number;
  min_slab_id: number;
  department_name?: string;
  designation_name?: string;
  band_name?: string;
  slab_label?: string;
}

interface MinWage {
  id: number;
  state_code: string;
  state_name: string;
  category: string;
  daily_rate: number | string;
  monthly_rate: number | string;
  effective_from: string;
  deleted_at?: string | null;
}

interface Department {
  id: number;
  dept_code?: string;
  code?: string;
  dept_name?: string;
  name?: string;
  status?: string;
}

interface Designation {
  id: number;
  desig_code?: string;
  code?: string;
  desig_name?: string;
  name?: string;
  grade?: string;
  status?: string;
}

interface GradeBand {
  id: number;
  band_code?: string;
  code?: string;
  band_name?: string;
  name?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(val: number | string | undefined): string {
  if (val === undefined || val === null) return "—";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return String(val);
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDate(raw: string | undefined): string {
  if (!raw) return "—";
  try {
    return new Date(raw).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

function deptLabel(d: Department): string {
  return d.dept_name ?? d.name ?? String(d.id);
}
function deptCode(d: Department): string {
  return d.dept_code ?? d.code ?? "";
}
function desigLabel(d: Designation): string {
  return d.desig_name ?? d.name ?? String(d.id);
}
function desigCode(d: Designation): string {
  return d.desig_code ?? d.code ?? "";
}
function bandLabel(g: GradeBand): string {
  return g.band_name ?? g.name ?? String(g.id);
}

// ─── Tab 1: Salary Slabs ──────────────────────────────────────────────────────

const EMPTY_SLAB = {
  slab_code: "",
  range_from: "",
  range_to: "",
  label: "",
  seq_order: "",
};

function SalarySlabsTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SalarySlab | null>(null);
  const [form, setForm] = useState(EMPTY_SLAB);
  const [mutErr, setMutErr] = useState("");

  const { data: res, isLoading, isError } = useQuery<ApiList<SalarySlab>>({
    queryKey: ["payroll-masters", "slabs"],
    queryFn: () => hrmsApi.get("/api/payroll-masters/slabs"),
  });

  const slabs: SalarySlab[] = res?.data ?? [];

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_SLAB);
    setMutErr("");
    setOpen(true);
  }

  function openEdit(row: SalarySlab) {
    setEditing(row);
    setForm({
      slab_code: row.slab_code,
      range_from: String(row.range_from),
      range_to: String(row.range_to),
      label: row.label,
      seq_order: String(row.seq_order),
    });
    setMutErr("");
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? hrmsApi.put(`/api/payroll-masters/slabs/${editing.id}`, body)
        : hrmsApi.post("/api/payroll-masters/slabs", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-masters", "slabs"] });
      setOpen(false);
    },
    onError: (e: Error) => setMutErr(e.message),
  });

  function handleSave() {
    setMutErr("");
    saveMut.mutate({
      slab_code: form.slab_code,
      range_from: Number(form.range_from),
      range_to: Number(form.range_to),
      label: form.label,
      seq_order: Number(form.seq_order),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Salary Slabs</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add Slab
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertCircle className="h-4 w-4" /> Failed to load salary slabs.
          </div>
        )}
        {!isLoading && !isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Range From</TableHead>
                <TableHead>Range To</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slabs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No salary slabs found.
                  </TableCell>
                </TableRow>
              )}
              {slabs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.slab_code}</TableCell>
                  <TableCell>{fmtCurrency(s.range_from)}</TableCell>
                  <TableCell>{fmtCurrency(s.range_to)}</TableCell>
                  <TableCell>{s.label}</TableCell>
                  <TableCell>{s.seq_order}</TableCell>
                  <TableCell>
                    <Badge variant={s.status === "active" ? "default" : "secondary"}>
                      {s.status ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Slab" : "Add Salary Slab"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Slab Code</Label>
                <Input
                  value={form.slab_code}
                  onChange={(e) => setForm({ ...form, slab_code: e.target.value })}
                  placeholder="e.g. S1"
                />
              </div>
              <div className="space-y-1">
                <Label>Seq Order</Label>
                <Input
                  type="number"
                  value={form.seq_order}
                  onChange={(e) => setForm({ ...form, seq_order: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Range From (₹)</Label>
                <Input
                  type="number"
                  value={form.range_from}
                  onChange={(e) => setForm({ ...form, range_from: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Range To (₹)</Label>
                <Input
                  type="number"
                  value={form.range_to}
                  onChange={(e) => setForm({ ...form, range_to: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Label</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. Entry Level"
              />
            </div>
            {mutErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {mutErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Tab 2: Designation-Band Matrix ──────────────────────────────────────────

const EMPTY_MATRIX = {
  department_id: "",
  designation_id: "",
  grade_id: "",
  min_slab_id: "",
};

function DesigMatrixTab() {
  const qc = useQueryClient();
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DesigMatrix | null>(null);
  const [form, setForm] = useState(EMPTY_MATRIX);
  const [mutErr, setMutErr] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkErr, setBulkErr] = useState("");

  const { data: matrixRes, isLoading, isError } = useQuery<ApiList<DesigMatrix>>({
    queryKey: ["payroll-masters", "matrix", deptFilter],
    queryFn: () =>
      hrmsApi.get(
        `/api/payroll-masters/matrix${deptFilter !== "all" ? `?department_id=${deptFilter}` : ""}`
      ),
  });

  const { data: deptRes } = useQuery<ApiList<Department>>({
    queryKey: ["org", "departments"],
    queryFn: () => hrmsApi.get("/api/org/departments"),
  });

  const { data: desigRes } = useQuery<ApiList<Designation>>({
    queryKey: ["org", "designations"],
    queryFn: () => hrmsApi.get("/api/org/designations"),
  });

  const { data: bandRes } = useQuery<ApiList<GradeBand>>({
    queryKey: ["org", "grade-bands"],
    queryFn: () => hrmsApi.get("/api/org/grade-bands"),
  });

  const { data: slabRes } = useQuery<ApiList<SalarySlab>>({
    queryKey: ["payroll-masters", "slabs"],
    queryFn: () => hrmsApi.get("/api/payroll-masters/slabs"),
  });

  const rows: DesigMatrix[] = matrixRes?.data ?? [];
  const departments: Department[] = deptRes?.data ?? [];
  const designations: Designation[] = desigRes?.data ?? [];
  const bands: GradeBand[] = bandRes?.data ?? [];
  const slabs: SalarySlab[] = slabRes?.data ?? [];

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_MATRIX);
    setMutErr("");
    setOpen(true);
  }

  function openEdit(row: DesigMatrix) {
    setEditing(row);
    setForm({
      department_id: String(row.department_id),
      designation_id: String(row.designation_id),
      grade_id: String(row.grade_id),
      min_slab_id: String(row.min_slab_id),
    });
    setMutErr("");
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? hrmsApi.put(`/api/payroll-masters/matrix/${editing.id}`, body)
        : hrmsApi.post("/api/payroll-masters/matrix", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-masters", "matrix"] });
      setOpen(false);
    },
    onError: (e: Error) => setMutErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => hrmsApi.delete(`/api/payroll-masters/matrix/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-masters", "matrix"] }),
  });

  const bulkMut = useMutation({
    mutationFn: (rows: Record<string, number>[]) =>
      hrmsApi.post("/api/payroll-masters/matrix/bulk-upsert", { rows }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-masters", "matrix"] });
      setBulkOpen(false);
      setBulkCsv("");
    },
    onError: (e: Error) => setBulkErr(e.message),
  });

  function handleSave() {
    setMutErr("");
    saveMut.mutate({
      department_id: Number(form.department_id),
      designation_id: Number(form.designation_id),
      grade_id: Number(form.grade_id),
      min_slab_id: Number(form.min_slab_id),
    });
  }

  function handleBulkImport() {
    setBulkErr("");
    const lines = bulkCsv.trim().split("\n").filter(Boolean);
    const parsed: Record<string, number>[] = [];
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length < 4) {
        setBulkErr(`Invalid line: "${line}" — expected dept_id,desig_id,grade_id,min_slab_id`);
        return;
      }
      const [dept_id, desig_id, grade_id, min_slab_id] = parts.map(Number);
      if ([dept_id, desig_id, grade_id, min_slab_id].some(isNaN)) {
        setBulkErr(`Non-numeric value in line: "${line}"`);
        return;
      }
      parsed.push({ department_id: dept_id, designation_id: desig_id, grade_id, min_slab_id });
    }
    bulkMut.mutate(parsed);
  }

  const deptName = (id: number) =>
    departments.find((d) => d.id === id)?.dept_name ??
    departments.find((d) => d.id === id)?.name ??
    String(id);
  const desigName = (id: number) =>
    designations.find((d) => d.id === id)?.desig_name ??
    designations.find((d) => d.id === id)?.name ??
    String(id);
  const bandName = (id: number) =>
    bands.find((b) => b.id === id)?.band_name ??
    bands.find((b) => b.id === id)?.name ??
    String(id);
  const slabLbl = (id: number) =>
    slabs.find((s) => s.id === id)?.label ?? String(id);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Designation-Band Matrix</CardTitle>
        <div className="flex items-center gap-2">
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Filter by Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {deptLabel(d)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => { setBulkErr(""); setBulkCsv(""); setBulkOpen(true); }}>
            <Upload className="h-4 w-4 mr-1" /> Bulk Import
          </Button>
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertCircle className="h-4 w-4" /> Failed to load matrix.
          </div>
        )}
        {!isLoading && !isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Department</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Min Slab</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                    No matrix entries found.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.department_name ?? deptName(r.department_id)}</TableCell>
                  <TableCell>{r.designation_name ?? desigName(r.designation_id)}</TableCell>
                  <TableCell>{r.band_name ?? bandName(r.grade_id)}</TableCell>
                  <TableCell>{r.slab_label ?? slabLbl(r.min_slab_id)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMut.mutate(r.id)}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Matrix Entry" : "Add Matrix Entry"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Department</Label>
              <Select
                value={form.department_id}
                onValueChange={(v) => setForm({ ...form, department_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {deptLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Designation</Label>
              <Select
                value={form.designation_id}
                onValueChange={(v) => setForm({ ...form, designation_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select designation" />
                </SelectTrigger>
                <SelectContent>
                  {designations.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {desigLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Grade / Band</Label>
              <Select
                value={form.grade_id}
                onValueChange={(v) => setForm({ ...form, grade_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select band" />
                </SelectTrigger>
                <SelectContent>
                  {bands.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)}>
                      {bandLabel(b)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Minimum Slab</Label>
              <Select
                value={form.min_slab_id}
                onValueChange={(v) => setForm({ ...form, min_slab_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select slab" />
                </SelectTrigger>
                <SelectContent>
                  {slabs.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.label} ({s.slab_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mutErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {mutErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Import Matrix</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              Paste CSV rows — one per line in the format:
              <code className="ml-1 px-1 bg-muted rounded text-xs">
                dept_id,desig_id,grade_id,min_slab_id
              </code>
            </p>
            <textarea
              className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={"1,2,3,4\n1,3,3,5"}
              value={bulkCsv}
              onChange={(e) => setBulkCsv(e.target.value)}
            />
            {bulkErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {bulkErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={bulkMut.isPending}>
              {bulkMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Tab 3: Minimum Wages ─────────────────────────────────────────────────────

const WAGE_CATEGORIES = ["unskilled", "semi_skilled", "skilled", "highly_skilled"] as const;
type WageCategory = (typeof WAGE_CATEGORIES)[number];

const EMPTY_WAGE = {
  state_code: "",
  state_name: "",
  category: "" as WageCategory | "",
  daily_rate: "",
  monthly_rate: "",
  effective_from: "",
};

function MinWagesTab() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MinWage | null>(null);
  const [form, setForm] = useState(EMPTY_WAGE);
  const [mutErr, setMutErr] = useState("");

  const { data: res, isLoading, isError } = useQuery<ApiList<MinWage>>({
    queryKey: ["payroll-masters", "minimum-wages"],
    queryFn: () => hrmsApi.get("/api/payroll-masters/minimum-wages"),
  });

  const wages: MinWage[] = (res?.data ?? []).filter((w) => !w.deleted_at);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_WAGE);
    setMutErr("");
    setOpen(true);
  }

  function openEdit(row: MinWage) {
    setEditing(row);
    setForm({
      state_code: row.state_code,
      state_name: row.state_name,
      category: row.category as WageCategory,
      daily_rate: String(row.daily_rate),
      monthly_rate: String(row.monthly_rate),
      effective_from: row.effective_from ? row.effective_from.split("T")[0] : "",
    });
    setMutErr("");
    setOpen(true);
  }

  const saveMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editing
        ? hrmsApi.patch(`/api/payroll-masters/minimum-wages/${editing.id}`, body)
        : hrmsApi.post("/api/payroll-masters/minimum-wages", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-masters", "minimum-wages"] });
      setOpen(false);
    },
    onError: (e: Error) => setMutErr(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => hrmsApi.delete(`/api/payroll-masters/minimum-wages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-masters", "minimum-wages"] }),
  });

  function handleSave() {
    setMutErr("");
    saveMut.mutate({
      state_code: form.state_code,
      state_name: form.state_name,
      category: form.category,
      daily_rate: Number(form.daily_rate),
      monthly_rate: Number(form.monthly_rate),
      effective_from: form.effective_from,
    });
  }

  const catLabel = (c: string) =>
    c.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Minimum Wages</CardTitle>
        <Button size="sm" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-4">
            <AlertCircle className="h-4 w-4" /> Failed to load minimum wages.
          </div>
        )}
        {!isLoading && !isError && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State Code</TableHead>
                <TableHead>State Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Daily Rate</TableHead>
                <TableHead>Monthly Rate</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wages.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                    No minimum wage records found.
                  </TableCell>
                </TableRow>
              )}
              {wages.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs">{w.state_code}</TableCell>
                  <TableCell>{w.state_name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{catLabel(w.category)}</Badge>
                  </TableCell>
                  <TableCell>{fmtCurrency(w.daily_rate)}</TableCell>
                  <TableCell>{fmtCurrency(w.monthly_rate)}</TableCell>
                  <TableCell>{fmtDate(w.effective_from)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(w)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMut.mutate(w.id)}
                      disabled={deleteMut.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Minimum Wage" : "Add Minimum Wage"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>State Code</Label>
                <Input
                  value={form.state_code}
                  onChange={(e) => setForm({ ...form, state_code: e.target.value })}
                  placeholder="e.g. MH"
                />
              </div>
              <div className="space-y-1">
                <Label>State Name</Label>
                <Input
                  value={form.state_name}
                  onChange={(e) => setForm({ ...form, state_name: e.target.value })}
                  placeholder="e.g. Maharashtra"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v as WageCategory })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {WAGE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {catLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Daily Rate (₹)</Label>
                <Input
                  type="number"
                  value={form.daily_rate}
                  onChange={(e) => setForm({ ...form, daily_rate: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Monthly Rate (₹)</Label>
                <Input
                  type="number"
                  value={form.monthly_rate}
                  onChange={(e) => setForm({ ...form, monthly_rate: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Effective From</Label>
              <Input
                type="date"
                value={form.effective_from}
                onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
              />
            </div>
            {mutErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {mutErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMut.isPending}>
              {saveMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Tab 4: Org Masters ───────────────────────────────────────────────────────

const EMPTY_DEPT = { dept_code: "", dept_name: "" };
const EMPTY_DESIG = { desig_code: "", desig_name: "", grade: "" };

function OrgMastersTab() {
  const qc = useQueryClient();

  // -- Departments --
  const [deptOpen, setDeptOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptForm, setDeptForm] = useState(EMPTY_DEPT);
  const [deptErr, setDeptErr] = useState("");

  const { data: deptRes, isLoading: deptLoading, isError: deptError } =
    useQuery<ApiList<Department>>({
      queryKey: ["org", "departments"],
      queryFn: () => hrmsApi.get("/api/org/departments"),
    });

  const departments: Department[] = deptRes?.data ?? [];

  const saveDeptMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingDept
        ? hrmsApi.put(`/api/org/departments/${editingDept.id}`, body)
        : hrmsApi.post("/api/org/departments", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", "departments"] });
      setDeptOpen(false);
    },
    onError: (e: Error) => setDeptErr(e.message),
  });

  function openAddDept() {
    setEditingDept(null);
    setDeptForm(EMPTY_DEPT);
    setDeptErr("");
    setDeptOpen(true);
  }
  function openEditDept(d: Department) {
    setEditingDept(d);
    setDeptForm({
      dept_code: d.dept_code ?? d.code ?? "",
      dept_name: d.dept_name ?? d.name ?? "",
    });
    setDeptErr("");
    setDeptOpen(true);
  }
  function handleSaveDept() {
    setDeptErr("");
    saveDeptMut.mutate({ dept_code: deptForm.dept_code, dept_name: deptForm.dept_name });
  }

  // -- Designations --
  const [desigOpen, setDesigOpen] = useState(false);
  const [editingDesig, setEditingDesig] = useState<Designation | null>(null);
  const [desigForm, setDesigForm] = useState(EMPTY_DESIG);
  const [desigErr, setDesigErr] = useState("");

  const { data: desigRes, isLoading: desigLoading, isError: desigError } =
    useQuery<ApiList<Designation>>({
      queryKey: ["org", "designations"],
      queryFn: () => hrmsApi.get("/api/org/designations"),
    });

  const designations: Designation[] = desigRes?.data ?? [];

  const saveDesigMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      editingDesig
        ? hrmsApi.put(`/api/org/designations/${editingDesig.id}`, body)
        : hrmsApi.post("/api/org/designations", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org", "designations"] });
      setDesigOpen(false);
    },
    onError: (e: Error) => setDesigErr(e.message),
  });

  function openAddDesig() {
    setEditingDesig(null);
    setDesigForm(EMPTY_DESIG);
    setDesigErr("");
    setDesigOpen(true);
  }
  function openEditDesig(d: Designation) {
    setEditingDesig(d);
    setDesigForm({
      desig_code: d.desig_code ?? d.code ?? "",
      desig_name: d.desig_name ?? d.name ?? "",
      grade: d.grade ?? "",
    });
    setDesigErr("");
    setDesigOpen(true);
  }
  function handleSaveDesig() {
    setDesigErr("");
    saveDesigMut.mutate({
      desig_code: desigForm.desig_code,
      desig_name: desigForm.desig_name,
      grade: desigForm.grade,
    });
  }

  return (
    <div className="space-y-6">
      {/* Departments */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Departments</CardTitle>
          <Button size="sm" onClick={openAddDept}>
            <Plus className="h-4 w-4 mr-1" /> Add Department
          </Button>
        </CardHeader>
        <CardContent>
          {deptLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {deptError && (
            <div className="flex items-center gap-2 text-sm text-destructive py-4">
              <AlertCircle className="h-4 w-4" /> Failed to load departments.
            </div>
          )}
          {!deptLoading && !deptError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No departments found.
                    </TableCell>
                  </TableRow>
                )}
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{deptCode(d)}</TableCell>
                    <TableCell>{deptLabel(d)}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "active" ? "default" : "secondary"}>
                        {d.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditDept(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Designations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Designations</CardTitle>
          <Button size="sm" onClick={openAddDesig}>
            <Plus className="h-4 w-4 mr-1" /> Add Designation
          </Button>
        </CardHeader>
        <CardContent>
          {desigLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {desigError && (
            <div className="flex items-center gap-2 text-sm text-destructive py-4">
              <AlertCircle className="h-4 w-4" /> Failed to load designations.
            </div>
          )}
          {!desigLoading && !desigError && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {designations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      No designations found.
                    </TableCell>
                  </TableRow>
                )}
                {designations.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">{desigCode(d)}</TableCell>
                    <TableCell>{desigLabel(d)}</TableCell>
                    <TableCell>{d.grade ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={d.status === "active" ? "default" : "secondary"}>
                        {d.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditDesig(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Department Dialog */}
      <Dialog open={deptOpen} onOpenChange={setDeptOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingDept ? "Edit Department" : "Add Department"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Department Code</Label>
              <Input
                value={deptForm.dept_code}
                onChange={(e) => setDeptForm({ ...deptForm, dept_code: e.target.value })}
                placeholder="e.g. OPS"
              />
            </div>
            <div className="space-y-1">
              <Label>Department Name</Label>
              <Input
                value={deptForm.dept_name}
                onChange={(e) => setDeptForm({ ...deptForm, dept_name: e.target.value })}
                placeholder="e.g. Operations"
              />
            </div>
            {deptErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {deptErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDept} disabled={saveDeptMut.isPending}>
              {saveDeptMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingDept ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Designation Dialog */}
      <Dialog open={desigOpen} onOpenChange={setDesigOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingDesig ? "Edit Designation" : "Add Designation"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Designation Code</Label>
              <Input
                value={desigForm.desig_code}
                onChange={(e) => setDesigForm({ ...desigForm, desig_code: e.target.value })}
                placeholder="e.g. AGT"
              />
            </div>
            <div className="space-y-1">
              <Label>Designation Name</Label>
              <Input
                value={desigForm.desig_name}
                onChange={(e) => setDesigForm({ ...desigForm, desig_name: e.target.value })}
                placeholder="e.g. Agent"
              />
            </div>
            <div className="space-y-1">
              <Label>Grade</Label>
              <Input
                value={desigForm.grade}
                onChange={(e) => setDesigForm({ ...desigForm, grade: e.target.value })}
                placeholder="e.g. L1"
              />
            </div>
            {desigErr && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {desigErr}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDesigOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveDesig} disabled={saveDesigMut.isPending}>
              {saveDesigMut.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingDesig ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativePayrollMasters() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Payroll Masters</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage salary slabs, designation-band matrix, minimum wages, and organisation masters.
          </p>
        </div>

        <Tabs defaultValue="slabs">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="slabs">Salary Slabs</TabsTrigger>
            <TabsTrigger value="matrix">Desig-Band Matrix</TabsTrigger>
            <TabsTrigger value="min-wages">Minimum Wages</TabsTrigger>
            <TabsTrigger value="org">Org Masters</TabsTrigger>
          </TabsList>

          <TabsContent value="slabs" className="mt-4">
            <SalarySlabsTab />
          </TabsContent>

          <TabsContent value="matrix" className="mt-4">
            <DesigMatrixTab />
          </TabsContent>

          <TabsContent value="min-wages" className="mt-4">
            <MinWagesTab />
          </TabsContent>

          <TabsContent value="org" className="mt-4">
            <OrgMastersTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
