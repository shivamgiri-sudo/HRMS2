import { useState, useCallback, useMemo, useEffect } from "react";
import {
  AlertTriangle,
  Building2,
  Calculator,
  CheckCircle2,
  Download,
  IndianRupee,
  Layers,
  Loader,
  Loader2,
  Package,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import {
  calcFromCtc,
  calcFromInHand,
  PT_BY_STATE,
  type PkgCalcOptions,
} from "@/lib/salaryCalculator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Types: NativeSalaryPackages ─────────────────────────────────────────────

interface GradeBand {
  id: number | string;
  name: string;
  code?: string;
}

interface SalarySlab {
  id: number | string;
  name: string;
  min_ctc?: number;
  max_ctc?: number;
}

interface SalaryPackage {
  id?: number | string;
  grade_id: number | string;
  slab_id: number | string;
  slab_name?: string;
  grade_name?: string;
  band?: string;
  basic_amt: number;
  conveyance_amt: number;
  conveyance_type?: "AMT" | "PCT" | "fixed" | "pct";
  medical_amt: number;
  medical_type?: "AMT" | "PCT" | "fixed" | "pct";
  other_allowance_amt: number;
  other_allowance_type?: "AMT" | "PCT" | "fixed" | "pct";
  bonus_amt: number;
  bonus_type?: "AMT" | "PCT" | "fixed" | "pct";
  portfolio_amt: number;
  special_allowance_amt: number;
  pli_amt: number;
  gross_monthly?: number;
  ctc_monthly?: number;
  effective_from?: string;
  derived_source?: "observed";
  employee_count?: number;
}

type ComponentType = "AMT" | "PCT";

interface PackageFormState {
  grade_id: string;
  slab_id: string;
  basic_amt: string;
  conveyance_amt: string;
  conveyance_type: ComponentType;
  medical_amt: string;
  medical_type: ComponentType;
  other_allowance_amt: string;
  other_allowance_type: ComponentType;
  bonus_amt: string;
  bonus_type: ComponentType;
  portfolio_amt: string;
  special_allowance_amt: string;
  pli_amt: string;
  effective_from: string;
}

interface PackagesResponse {
  success: boolean;
  data: SalaryPackage[];
}

interface SlabsResponse {
  success: boolean;
  data: SalarySlab[];
}

interface GradeBandsResponse {
  success: boolean;
  data: GradeBand[];
}

// ─── Types: NativeSalaryPackageAdmin ─────────────────────────────────────────

interface Band {
  id: string;
  band_code: string;
  band_name: string;
  slab_from: number;
  slab_to: number;
  active_status: number;
}

interface CostCentre {
  id: string;
  cost_centre_code: string;
  display_name: string;
  branch_name: string;
  category: string;
  client_name: string;
  process_name: string;
  active_status: number;
}

interface AdminPackage {
  id: string;
  branch_name: string;
  cost_centre_code: string;
  band_code: string;
  package_amount: number;
  basic: number;
  hra: number;
  lta: number;
  conveyance: number;
  gross: number;
  epf_employee: number;
  esic_employee: number;
  net_in_hand: number;
  epf_employer: number;
  esic_employer: number;
  admin_charges: number;
  ctc: number;
  bonus: number;
  pli: number;
  professional_tax: number;
  special_allowance: number;
  other_allowance: number;
  portfolio: number;
  medical: number;
  active_status: number;
}

// ─── CSV Import ───────────────────────────────────────────────────────────────

interface CsvRow {
  grade_id: string;
  slab_id: string;
  basic_amt: string;
  conveyance_amt: string;
  medical_amt: string;
  other_allowance_amt: string;
  bonus_amt: string;
  portfolio_amt: string;
  special_allowance_amt: string;
  pli_amt: string;
  effective_from: string;
}

interface CsvImportResult {
  row: number;
  status: "ok" | "error";
  message?: string;
}

// ─── Helpers: NativeSalaryPackages ───────────────────────────────────────────

function toNum(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function resolveAmt(base: number, amt: string, type: ComponentType): number {
  const v = toNum(amt);
  if (type === "PCT") return Math.round((base * v) / 100);
  return v;
}

function computeGross(f: PackageFormState): number {
  const basic = toNum(f.basic_amt);
  const conv = resolveAmt(basic, f.conveyance_amt, f.conveyance_type);
  const med = resolveAmt(basic, f.medical_amt, f.medical_type);
  const other = resolveAmt(basic, f.other_allowance_amt, f.other_allowance_type);
  const bonus = resolveAmt(basic, f.bonus_amt, f.bonus_type);
  const portfolio = toNum(f.portfolio_amt);
  const special = toNum(f.special_allowance_amt);
  const pli = toNum(f.pli_amt);
  return basic + conv + med + other + bonus + portfolio + special + pli;
}

function computeCTC(f: PackageFormState): number {
  const basic = toNum(f.basic_amt);
  const gross = computeGross(f);
  const pfEmployer = Math.min(basic, 15000) * 0.12;
  const esic = gross <= 21000 ? gross * 0.0325 : 0;
  return Math.round(gross + pfEmployer + esic);
}

function fmtINR(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

function defaultForm(gradeId: string, slabId?: string): PackageFormState {
  return {
    grade_id: gradeId,
    slab_id: slabId ?? "",
    basic_amt: "",
    conveyance_amt: "",
    conveyance_type: "AMT",
    medical_amt: "",
    medical_type: "AMT",
    other_allowance_amt: "",
    other_allowance_type: "AMT",
    bonus_amt: "",
    bonus_type: "AMT",
    portfolio_amt: "",
    special_allowance_amt: "",
    pli_amt: "",
    effective_from: new Date().toISOString().slice(0, 10),
  };
}

function pkgToForm(pkg: SalaryPackage): PackageFormState {
  return {
    grade_id: String(pkg.grade_id),
    slab_id: String(pkg.slab_id),
    basic_amt: String(pkg.basic_amt ?? ""),
    conveyance_amt: String(pkg.conveyance_amt ?? ""),
    conveyance_type:
      pkg.conveyance_type === "PCT" || pkg.conveyance_type === "pct"
        ? "PCT"
        : "AMT",
    medical_amt: String(pkg.medical_amt ?? ""),
    medical_type:
      pkg.medical_type === "PCT" || pkg.medical_type === "pct" ? "PCT" : "AMT",
    other_allowance_amt: String(pkg.other_allowance_amt ?? ""),
    other_allowance_type:
      pkg.other_allowance_type === "PCT" || pkg.other_allowance_type === "pct"
        ? "PCT"
        : "AMT",
    bonus_amt: String(pkg.bonus_amt ?? ""),
    bonus_type:
      pkg.bonus_type === "PCT" || pkg.bonus_type === "pct" ? "PCT" : "AMT",
    portfolio_amt: String(pkg.portfolio_amt ?? ""),
    special_allowance_amt: String(pkg.special_allowance_amt ?? ""),
    pli_amt: String(pkg.pli_amt ?? ""),
    effective_from: pkg.effective_from
      ? pkg.effective_from.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  };
}

function parseCSV(raw: string): CsvRow[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
      grade_id: cols[0] ?? "",
      slab_id: cols[1] ?? "",
      basic_amt: cols[2] ?? "0",
      conveyance_amt: cols[3] ?? "0",
      medical_amt: cols[4] ?? "0",
      other_allowance_amt: cols[5] ?? "0",
      bonus_amt: cols[6] ?? "0",
      portfolio_amt: cols[7] ?? "0",
      special_allowance_amt: cols[8] ?? "0",
      pli_amt: cols[9] ?? "0",
      effective_from: cols[10] ?? new Date().toISOString().slice(0, 10),
    };
  });
}

// ─── Helpers: NativeSalaryPackageAdmin ───────────────────────────────────────

const fmt = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const SEL =
  "flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400";

// ─── TypeToggle ───────────────────────────────────────────────────────────────

function TypeToggle({
  value,
  onChange,
}: {
  value: ComponentType;
  onChange: (v: ComponentType) => void;
}) {
  return (
    <div className="flex rounded border overflow-hidden text-xs">
      <button
        type="button"
        onClick={() => onChange("AMT")}
        className={`px-2 py-1 ${
          value === "AMT"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        ₹
      </button>
      <button
        type="button"
        onClick={() => onChange("PCT")}
        className={`px-2 py-1 ${
          value === "PCT"
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        %
      </button>
    </div>
  );
}

// ─── PackageDialog ────────────────────────────────────────────────────────────

interface PackageDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (form: PackageFormState, existingId?: number | string) => void;
  form: PackageFormState;
  setForm: React.Dispatch<React.SetStateAction<PackageFormState>>;
  slabs: SalarySlab[];
  saving: boolean;
  existingId?: number | string;
}

function PackageDialog({
  open,
  onClose,
  onSave,
  form,
  setForm,
  slabs,
  saving,
  existingId,
}: PackageDialogProps) {
  const gross = computeGross(form);
  const ctc = computeCTC(form);

  function field(key: keyof PackageFormState) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingId ? "Edit Salary Package" : "Add Salary Package"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label>Salary Slab</Label>
            <Select
              value={form.slab_id}
              onValueChange={(v) => setForm((f) => ({ ...f, slab_id: v }))}
              disabled={!!existingId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select slab" />
              </SelectTrigger>
              <SelectContent>
                {slabs.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>
                    {(s as any).label ?? s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Basic (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.basic_amt}
              onChange={field("basic_amt")}
              placeholder="0"
            />
          </div>

          <div>
            <Label>Effective From</Label>
            <Input
              type="date"
              value={form.effective_from}
              onChange={field("effective_from")}
            />
          </div>

          <div>
            <Label>Conveyance</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0}
                value={form.conveyance_amt}
                onChange={field("conveyance_amt")}
                placeholder="0"
              />
              <TypeToggle
                value={form.conveyance_type}
                onChange={(v) => setForm((f) => ({ ...f, conveyance_type: v }))}
              />
            </div>
          </div>

          <div>
            <Label>Medical</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0}
                value={form.medical_amt}
                onChange={field("medical_amt")}
                placeholder="0"
              />
              <TypeToggle
                value={form.medical_type}
                onChange={(v) => setForm((f) => ({ ...f, medical_type: v }))}
              />
            </div>
          </div>

          <div>
            <Label>Other Allowance</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0}
                value={form.other_allowance_amt}
                onChange={field("other_allowance_amt")}
                placeholder="0"
              />
              <TypeToggle
                value={form.other_allowance_type}
                onChange={(v) =>
                  setForm((f) => ({ ...f, other_allowance_type: v }))
                }
              />
            </div>
          </div>

          <div>
            <Label>Bonus</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min={0}
                value={form.bonus_amt}
                onChange={field("bonus_amt")}
                placeholder="0"
              />
              <TypeToggle
                value={form.bonus_type}
                onChange={(v) => setForm((f) => ({ ...f, bonus_type: v }))}
              />
            </div>
          </div>

          <div>
            <Label>Portfolio (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.portfolio_amt}
              onChange={field("portfolio_amt")}
              placeholder="0"
            />
          </div>

          <div>
            <Label>Special Allowance (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.special_allowance_amt}
              onChange={field("special_allowance_amt")}
              placeholder="0"
            />
          </div>

          <div>
            <Label>PLI (₹)</Label>
            <Input
              type="number"
              min={0}
              value={form.pli_amt}
              onChange={field("pli_amt")}
              placeholder="0"
            />
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-xs text-gray-500">Gross Monthly (computed)</p>
              <p className="text-lg font-semibold text-green-700">
                {fmtINR(gross)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">CTC Monthly (computed)</p>
              <p className="text-lg font-semibold text-blue-700">
                {fmtINR(ctc)}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => onSave(form, existingId)}
            disabled={saving || !form.slab_id || !form.basic_amt}
          >
            {saving ? <Loader className="h-4 w-4 animate-spin mr-2" /> : null}
            {existingId ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CsvImportDialog ──────────────────────────────────────────────────────────

function CsvImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [results, setResults] = useState<CsvImportResult[]>([]);
  const [importing, setImporting] = useState(false);

  async function handleImport() {
    const rows = parseCSV(csvText);
    if (rows.length === 0) return;
    setImporting(true);
    setResults([]);
    const newResults: CsvImportResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const payload = {
          grade_id: r.grade_id,
          slab_id: r.slab_id,
          basic_amt: parseFloat(r.basic_amt) || 0,
          conveyance_amt: parseFloat(r.conveyance_amt) || 0,
          medical_amt: parseFloat(r.medical_amt) || 0,
          other_allowance_amt: parseFloat(r.other_allowance_amt) || 0,
          bonus_amt: parseFloat(r.bonus_amt) || 0,
          portfolio_amt: parseFloat(r.portfolio_amt) || 0,
          special_allowance_amt: parseFloat(r.special_allowance_amt) || 0,
          pli_amt: parseFloat(r.pli_amt) || 0,
          effective_from: r.effective_from,
        };
        await hrmsApi.post("/api/payroll-masters/packages", payload);
        newResults.push({ row: i + 1, status: "ok" });
      } catch (err) {
        newResults.push({
          row: i + 1,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
      setResults([...newResults]);
    }
    setImporting(false);
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errCount = results.filter((r) => r.status === "error").length;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk CSV Import — Salary Packages</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-gray-500">
            Paste CSV rows (no header). Columns:{" "}
            <code className="text-xs bg-gray-100 px-1 rounded">
              grade_id, slab_id, basic_amt, conveyance_amt, medical_amt,
              other_allowance_amt, bonus_amt, portfolio_amt,
              special_allowance_amt, pli_amt, effective_from
            </code>
          </p>
          <textarea
            className="w-full h-40 border rounded p-2 text-sm font-mono"
            placeholder="1,2,15000,1600,1250,2000,500,0,1000,0,2025-04-01"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            disabled={importing}
          />
          {results.length > 0 && (
            <div className="border rounded p-2 max-h-48 overflow-y-auto space-y-1">
              <div className="flex gap-3 mb-2 text-sm">
                <span className="text-green-700 font-medium">
                  {okCount} succeeded
                </span>
                {errCount > 0 && (
                  <span className="text-red-600 font-medium">
                    {errCount} failed
                  </span>
                )}
              </div>
              {results.map((r) => (
                <div
                  key={r.row}
                  className={`text-xs flex gap-2 ${
                    r.status === "ok" ? "text-green-700" : "text-red-600"
                  }`}
                >
                  <span>Row {r.row}:</span>
                  <span>{r.status === "ok" ? "OK" : r.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={importing}>
            <X className="h-4 w-4 mr-1" />
            Close
          </Button>
          <Button
            onClick={handleImport}
            disabled={importing || !csvText.trim()}
          >
            {importing ? (
              <Loader className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── SlabRow ──────────────────────────────────────────────────────────────────

interface SlabRowProps {
  slab: SalarySlab;
  pkg: SalaryPackage | null;
  onEdit: (pkg: SalaryPackage) => void;
  onAdd: (slabId: string) => void;
}

function SlabRow({ slab, pkg, onEdit, onAdd }: SlabRowProps) {
  if (!pkg) {
    return (
      <TableRow className="opacity-60 hover:opacity-100">
        <TableCell className="font-medium">
          {(slab as any).label ?? slab.name}
          <Badge variant="outline" className="ml-2 text-xs">
            No Package
          </Badge>
        </TableCell>
        {Array.from({ length: 9 }).map((_, i) => (
          <TableCell key={i} className="text-right text-gray-300">
            —
          </TableCell>
        ))}
        <TableCell className="text-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAdd(String(slab.id))}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  const gross =
    pkg.gross_monthly ??
    pkg.basic_amt +
      pkg.conveyance_amt +
      pkg.medical_amt +
      pkg.other_allowance_amt +
      pkg.bonus_amt +
      pkg.portfolio_amt +
      pkg.special_allowance_amt +
      pkg.pli_amt;

  const ctc =
    pkg.ctc_monthly ??
    (() => {
      const pf = Math.min(pkg.basic_amt, 15000) * 0.12;
      const esic = gross <= 21000 ? gross * 0.0325 : 0;
      return Math.round(gross + pf + esic);
    })();

  return (
    <TableRow className="text-sm">
      <TableCell className="font-medium">
        {(slab as any).label ?? slab.name}
        {pkg.derived_source === "observed" && (
          <Badge variant="secondary" className="ml-2 text-xs">
            Observed · {pkg.employee_count ?? 0} employees
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">{fmtINR(pkg.basic_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.conveyance_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.medical_amt)}</TableCell>
      <TableCell className="text-right">
        {fmtINR(pkg.other_allowance_amt)}
      </TableCell>
      <TableCell className="text-right">{fmtINR(pkg.bonus_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.portfolio_amt)}</TableCell>
      <TableCell className="text-right">
        {fmtINR(pkg.special_allowance_amt)}
      </TableCell>
      <TableCell className="text-right">{fmtINR(pkg.pli_amt)}</TableCell>
      <TableCell className="text-right font-medium text-green-700">
        {fmtINR(gross)}
      </TableCell>
      <TableCell className="text-right font-medium text-blue-700">
        {fmtINR(ctc)}
      </TableCell>
      <TableCell className="text-center">
        {pkg.derived_source === "observed" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAdd(String(slab.id))}
          >
            <Plus className="h-3 w-3 mr-1" />
            Create Template
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit(pkg)}
            title="Edit package"
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── NativeSalaryPackageManager ───────────────────────────────────────────────

export default function NativeSalaryPackageManager() {
  // ── Role-based access ────────────────────────────────────────────────────────
  const { roleKeys } = useWorkforceAccess();
  const canAdmin = roleKeys.some((r) =>
    ["admin", "super_admin", "payroll", "payroll_head"].includes(r)
  );

  // ── URL-driven outer tab ─────────────────────────────────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get("tab") ?? "my-package";
  const activeTab = !canAdmin && rawTab === "admin" ? "my-package" : rawTab;

  const queryClient = useQueryClient();

  // ═══ State: NativeSalaryPackages ════════════════════════════════════════════
  const [selectedGradeId, setSelectedGradeId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<SalaryPackage | null>(null);
  const [preselectedSlabId, setPreselectedSlabId] = useState<
    string | undefined
  >(undefined);
  const [form, setForm] = useState<PackageFormState>(defaultForm(""));

  // ═══ State: NativeSalaryPackageAdmin ════════════════════════════════════════
  const [adminTab, setAdminTab] = useState<
    "bands" | "packages" | "cost-centres"
  >("bands");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Bands
  const [bands, setBands] = useState<Band[]>([]);
  const [editBand, setEditBand] = useState<Partial<Band> | null>(null);

  // Cost Centres
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [ccFilter, setCcFilter] = useState("");
  const [editCC, setEditCC] = useState<Partial<CostCentre> | null>(null);

  // Admin packages (renamed from `packages` to avoid collision with react-query derived)
  const [adminPackages, setAdminPackages] = useState<AdminPackage[]>([]);
  const [pkgBranch, setPkgBranch] = useState("");
  const [pkgBand, setPkgBand] = useState("");
  const [pkgCC, setPkgCC] = useState("");
  const [editPkg, setEditPkg] = useState<Partial<AdminPackage> | null>(null);

  // Calculator state
  const [calcMode, setCalcMode] = useState<"ctc" | "inhand">("ctc");
  const [ctcInput, setCtcInput] = useState("");
  const [inHandInput, setInHandInput] = useState("");
  const [includePf, setIncludePf] = useState(true);
  const [includeEsic, setIncludeEsic] = useState(true);
  const [basicPct, setBasicPct] = useState(40);
  const [hraPct, setHraPct] = useState(40);

  const branches = [...new Set(costCentres.map((c) => c.branch_name))].sort();

  const [branchStates, setBranchStates] = useState<Record<string, string>>({});

  useEffect(() => {
    hrmsApi
      .get<any>("/api/payroll-masters/branch-states")
      .then((r: any) => {
        const map: Record<string, string> = {};
        for (const row of r?.data ?? [])
          if (row.branch_name && row.state) map[row.branch_name] = row.state;
        setBranchStates(map);
      })
      .catch(() => {});
  }, []);

  // ═══ Queries: NativeSalaryPackages ══════════════════════════════════════════
  const {
    data: allPackages,
    isLoading: loadingBands,
    isError: bandsError,
    refetch: refetchBands,
  } = useQuery<PackagesResponse>({
    queryKey: ["salary-packages-all"],
    queryFn: () =>
      hrmsApi.get<PackagesResponse>("/api/payroll-masters/packages"),
    staleTime: 60_000,
  });

  const { data: slabsData, isLoading: loadingSlabs } =
    useQuery<SlabsResponse>({
      queryKey: ["salary-slabs"],
      queryFn: () =>
        hrmsApi.get<SlabsResponse>("/api/payroll-masters/slabs"),
      staleTime: 60_000,
    });

  const { data: orgBandsData } = useQuery<GradeBandsResponse>({
    queryKey: ["org-grade-bands"],
    queryFn: () =>
      hrmsApi.get<GradeBandsResponse>("/api/org/grade-bands"),
    staleTime: 60_000,
    retry: false,
  });

  const {
    data: pkgData,
    isLoading: loadingPkgs,
    isError: pkgError,
    refetch: refetchPkgs,
  } = useQuery<PackagesResponse>({
    queryKey: ["salary-packages", selectedGradeId],
    queryFn: () =>
      hrmsApi.get<PackagesResponse>(
        `/api/payroll-masters/packages?grade_id=${selectedGradeId}`
      ),
    enabled: !!selectedGradeId,
    staleTime: 30_000,
  });

  // ── Derived ──────────────────────────────────────────────────────────────────
  const gradeBands = useMemo<GradeBand[]>(() => {
    if (orgBandsData?.data && orgBandsData.data.length > 0)
      return orgBandsData.data;
    if (!allPackages?.data) return [];
    const seen = new Map<string, GradeBand>();
    for (const p of allPackages.data) {
      const gid = String(p.grade_id);
      if (!seen.has(gid)) {
        seen.set(gid, {
          id: p.grade_id,
          name: p.grade_name ?? p.band ?? gid,
        });
      }
    }
    return Array.from(seen.values());
  }, [allPackages, orgBandsData]);

  const slabs: SalarySlab[] = useMemo(
    () => slabsData?.data ?? [],
    [slabsData]
  );

  const packages: SalaryPackage[] = useMemo(
    () => pkgData?.data ?? [],
    [pkgData]
  );

  // ── Slab rows ─────────────────────────────────────────────────────────────────
  const slabRows = useMemo(() => {
    return slabs.map((slab) => {
      const pkg = packages.find(
        (p) => String(p.slab_id) === String(slab.id)
      );
      return { slab, pkg: pkg ?? null };
    });
  }, [slabs, packages]);

  const isLoading = loadingBands || loadingSlabs;

  // ── Package Health (My Package tab) ──────────────────────────────────────────
  const healthPkg = packages[0] ?? null;
  const healthBasic = healthPkg?.basic_amt ?? 0;
  const healthSpecial = healthPkg?.special_allowance_amt ?? 0;
  const healthConveyance = healthPkg?.conveyance_amt ?? 0;
  const healthOther = healthPkg?.other_allowance_amt ?? 0;
  const healthGross =
    healthPkg?.gross_monthly ??
    (healthPkg
      ? healthBasic +
        (healthPkg.conveyance_amt ?? 0) +
        (healthPkg.medical_amt ?? 0) +
        (healthPkg.other_allowance_amt ?? 0) +
        (healthPkg.bonus_amt ?? 0) +
        (healthPkg.portfolio_amt ?? 0) +
        (healthPkg.special_allowance_amt ?? 0) +
        (healthPkg.pli_amt ?? 0)
      : 0);
  const healthPf = Math.round(Math.min(healthBasic, 15000) * 0.12);
  const healthTakeHome = Math.max(0, healthGross - healthPf);

  // ── Quick stats (Admin tab) ───────────────────────────────────────────────────
  const totalPkgsCount = allPackages?.data?.length ?? 0;
  const pendingReviewCount =
    allPackages?.data?.filter((p) => !p.basic_amt || p.basic_amt === 0)
      .length ?? 0;
  const activeBandsCount = bands.filter((b) => b.active_status).length;

  // ═══ Callbacks: NativeSalaryPackageAdmin ════════════════════════════════════
  const loadBands = useCallback(async () => {
    const r = await hrmsApi.get<any>("/api/payroll-masters/bands");
    setBands(r?.data ?? []);
  }, []);

  const loadCostCentres = useCallback(async () => {
    const r = await hrmsApi.get<any>("/api/payroll-masters/cost-centres");
    setCostCentres(r?.data ?? []);
  }, []);

  const loadAdminPackages = useCallback(async () => {
    if (!pkgBranch) {
      setAdminPackages([]);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ branch: pkgBranch });
    if (pkgBand) params.set("band", pkgBand);
    if (pkgCC) params.set("costCentre", pkgCC);
    const r = await hrmsApi.get<any>(
      `/api/payroll-masters/packages?${params}`
    );
    setAdminPackages(r?.data ?? []);
    setLoading(false);
  }, [pkgBranch, pkgBand, pkgCC]);

  useEffect(() => {
    void loadBands();
    void loadCostCentres();
  }, [loadBands, loadCostCentres]);

  useEffect(() => {
    void loadAdminPackages();
  }, [loadAdminPackages]);

  // Auto-calculate whenever driver input or toggles change
  useEffect(() => {
    if (!editPkg) return;
    const selectedBranch = editPkg?.branch_name ?? pkgBranch;
    const opts: PkgCalcOptions = {
      includePf,
      includeEsic,
      basicPct,
      hraPct,
      state: selectedBranch ? branchStates[selectedBranch] : undefined,
    };
    if (calcMode === "ctc") {
      const v = parseFloat(ctcInput);
      if (!v || v <= 0) return;
      const c = calcFromCtc(v, opts);
      setEditPkg((p) => ({ ...p!, ...c, package_amount: c.ctc }));
    } else {
      const v = parseFloat(inHandInput);
      if (!v || v <= 0) return;
      const c = calcFromInHand(v, opts);
      setEditPkg((p) => ({ ...p!, ...c, package_amount: c.ctc }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctcInput, inHandInput, includePf, includeEsic, basicPct, hraPct, calcMode]);

  // ── Save Band ──────────────────────────────────────────────────────────────────
  const saveBand = async () => {
    if (
      !editBand?.band_code ||
      editBand.slab_from == null ||
      editBand.slab_to == null
    )
      return;
    setSaving(true);
    setMsg("");
    try {
      if (editBand.id) {
        await hrmsApi.put(
          `/api/payroll-masters/bands/${editBand.id}`,
          editBand
        );
      } else {
        await hrmsApi.post("/api/payroll-masters/bands", editBand);
      }
      setEditBand(null);
      await loadBands();
      setMsg("Band saved");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Save Cost Centre ───────────────────────────────────────────────────────────
  const saveCC = async () => {
    if (!editCC?.cost_centre_code || !editCC?.branch_name) return;
    setSaving(true);
    setMsg("");
    try {
      await hrmsApi.post("/api/payroll-masters/cost-centres", editCC);
      setEditCC(null);
      await loadCostCentres();
      setMsg("Cost centre saved");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Save Admin Package ─────────────────────────────────────────────────────────
  const savePkg = async () => {
    if (!editPkg?.branch_name || !editPkg?.band_code || !editPkg?.package_amount)
      return;
    setSaving(true);
    setMsg("");
    try {
      if (editPkg.id) {
        await hrmsApi.put(
          `/api/payroll-masters/packages/${editPkg.id}`,
          editPkg
        );
      } else {
        await hrmsApi.post("/api/payroll-masters/packages", editPkg);
      }
      setEditPkg(null);
      await loadAdminPackages();
      setMsg("Package saved");
    } catch (e: any) {
      setMsg(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  const deletePkg = async (id: string) => {
    if (!confirm("Deactivate this package?")) return;
    await hrmsApi.delete(`/api/payroll-masters/packages/${id}`);
    await loadAdminPackages();
    setMsg("Package deactivated");
  };

  // ═══ Mutation: NativeSalaryPackages ═════════════════════════════════════════
  const saveMutation = useMutation({
    mutationFn: async ({
      formData,
      existingId,
    }: {
      formData: PackageFormState;
      existingId?: number | string;
    }) => {
      const basic = toNum(formData.basic_amt);
      const payload = {
        grade_id: formData.grade_id,
        slab_id: formData.slab_id,
        basic_amt: basic,
        conveyance_amt: resolveAmt(
          basic,
          formData.conveyance_amt,
          formData.conveyance_type
        ),
        conveyance_type:
          formData.conveyance_type === "PCT" ? "pct" : "fixed",
        medical_amt: resolveAmt(
          basic,
          formData.medical_amt,
          formData.medical_type
        ),
        medical_type: formData.medical_type === "PCT" ? "pct" : "fixed",
        other_allowance_amt: resolveAmt(
          basic,
          formData.other_allowance_amt,
          formData.other_allowance_type
        ),
        other_allowance_type:
          formData.other_allowance_type === "PCT" ? "pct" : "fixed",
        bonus_amt: resolveAmt(
          basic,
          formData.bonus_amt,
          formData.bonus_type
        ),
        bonus_type: formData.bonus_type === "PCT" ? "pct" : "fixed",
        portfolio_amt: toNum(formData.portfolio_amt),
        special_allowance_amt: toNum(formData.special_allowance_amt),
        pli_amt: toNum(formData.pli_amt),
        effective_from: formData.effective_from,
      };
      if (existingId) {
        return hrmsApi.put(
          `/api/payroll-masters/packages/${existingId}`,
          payload
        );
      }
      return hrmsApi.post("/api/payroll-masters/packages", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-packages"] });
      queryClient.invalidateQueries({ queryKey: ["salary-packages-all"] });
      setDialogOpen(false);
    },
  });

  // ── Dialog helpers ─────────────────────────────────────────────────────────────
  const openEdit = useCallback((pkg: SalaryPackage) => {
    setEditingPkg(pkg);
    setForm(pkgToForm(pkg));
    setPreselectedSlabId(undefined);
    setDialogOpen(true);
  }, []);

  const openAdd = useCallback(
    (slabId?: string) => {
      setEditingPkg(null);
      setPreselectedSlabId(slabId);
      setForm(defaultForm(selectedGradeId, slabId));
      setDialogOpen(true);
    },
    [selectedGradeId]
  );

  const handleSave = useCallback(
    (formData: PackageFormState, existingId?: number | string) => {
      saveMutation.mutate({ formData, existingId });
    },
    [saveMutation]
  );

  // ═══ Render ═══════════════════════════════════════════════════════════════════
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* ── Gradient Header ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white px-6 py-5 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Salary Package Manager
              </h1>
              <p className="text-indigo-200 text-sm mt-0.5">
                View your package breakdown and manage org-wide salary
                structures
              </p>
            </div>
          </div>
        </div>

        {/* ── Outer Tabs ───────────────────────────────────────────────────────── */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setSearchParams({ tab: v })}
        >
          <TabsList
            className={`grid w-full ${
              canAdmin ? "max-w-xs grid-cols-2" : "max-w-[160px] grid-cols-1"
            }`}
          >
            <TabsTrigger value="my-package">My Package</TabsTrigger>
            {canAdmin && (
              <TabsTrigger value="admin">Admin</TabsTrigger>
            )}
          </TabsList>

          {/* ══════════════ MY PACKAGE TAB ══════════════════════════════════════ */}
          <TabsContent value="my-package">
            <div className="space-y-4 mt-4">
              {/* Package Health bar — shown when a grade is selected and packages loaded */}
              {healthPkg && (
                <Card className="border-blue-100 bg-blue-50/40">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm font-semibold text-blue-800">
                      Package Health
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="flex flex-wrap gap-2 mb-3">
                      <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 px-3 py-1 text-xs font-medium">
                        Basic: {fmtINR(healthBasic)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-indigo-100 text-indigo-800 px-3 py-1 text-xs font-medium">
                        Special Allow.: {fmtINR(healthSpecial)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-sky-100 text-sky-800 px-3 py-1 text-xs font-medium">
                        Conveyance: {fmtINR(healthConveyance)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-orange-100 text-orange-800 px-3 py-1 text-xs font-medium">
                        PF (Emp.): {fmtINR(healthPf)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-xs font-medium">
                        Other Allow.: {fmtINR(healthOther)}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-3 py-1 text-xs font-medium">
                        Gross: {fmtINR(healthGross)}
                      </span>
                    </div>
                    <p className="text-xs text-blue-700 font-medium">
                      Take-home estimate:{" "}
                      <span className="font-bold text-emerald-700">
                        {fmtINR(healthTakeHome)}/month
                      </span>{" "}
                      (after PF and TDS)
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Action bar */}
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void refetchBands();
                    if (selectedGradeId) void refetchPkgs();
                  }}
                >
                  <RefreshCcw className="h-4 w-4 mr-1" />
                  Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCsvDialogOpen(true)}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Bulk CSV Import
                </Button>
                {selectedGradeId && (
                  <Button size="sm" onClick={() => openAdd()}>
                    <Plus className="h-4 w-4 mr-1" />
                    Add Package
                  </Button>
                )}
              </div>

              {/* Grade Band Filter */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-700">
                    Filter
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-end gap-4">
                    <div className="w-64">
                      <Label className="text-xs mb-1 block">Grade Band</Label>
                      {isLoading ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader className="h-4 w-4 animate-spin" />
                          Loading bands…
                        </div>
                      ) : bandsError ? (
                        <div className="flex items-center gap-2 text-sm text-red-600">
                          <AlertTriangle className="h-4 w-4" />
                          Failed to load bands
                        </div>
                      ) : (
                        <Select
                          value={selectedGradeId}
                          onValueChange={setSelectedGradeId}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a band" />
                          </SelectTrigger>
                          <SelectContent>
                            {gradeBands.map((b) => (
                              <SelectItem
                                key={String(b.id)}
                                value={String(b.id)}
                              >
                                {b.name}
                                {b.code ? ` (${b.code})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                    {gradeBands.length === 0 && !isLoading && (
                      <p className="text-sm text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-4 w-4" />
                        No bands found. Create packages first or check org
                        masters.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Package Matrix */}
              {!selectedGradeId ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400">
                    Select a grade band above to view or manage salary packages.
                  </CardContent>
                </Card>
              ) : loadingPkgs ? (
                <Card>
                  <CardContent className="py-12 flex items-center justify-center gap-2 text-gray-500">
                    <Loader className="h-5 w-5 animate-spin" />
                    Loading packages…
                  </CardContent>
                </Card>
              ) : pkgError ? (
                <Card>
                  <CardContent className="py-12 flex items-center justify-center gap-2 text-red-600">
                    <AlertTriangle className="h-5 w-5" />
                    Failed to load packages. Check API availability.
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Package Matrix —{" "}
                      {gradeBands.find(
                        (b) => String(b.id) === selectedGradeId
                      )?.name ?? selectedGradeId}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {slabs.length === 0 ? (
                      <div className="py-10 text-center text-gray-400 text-sm">
                        No slabs found. Add slabs via Payroll Masters first.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="text-xs">
                              <TableHead>Slab</TableHead>
                              <TableHead className="text-right">
                                Basic
                              </TableHead>
                              <TableHead className="text-right">
                                Conv.
                              </TableHead>
                              <TableHead className="text-right">
                                Medical
                              </TableHead>
                              <TableHead className="text-right">
                                Other Allow.
                              </TableHead>
                              <TableHead className="text-right">
                                Bonus
                              </TableHead>
                              <TableHead className="text-right">
                                Portfolio
                              </TableHead>
                              <TableHead className="text-right">
                                Special
                              </TableHead>
                              <TableHead className="text-right">PLI</TableHead>
                              <TableHead className="text-right">
                                Gross
                              </TableHead>
                              <TableHead className="text-right">CTC</TableHead>
                              <TableHead className="text-center">
                                Actions
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {slabRows.map(({ slab, pkg }) => (
                              <SlabRow
                                key={String(slab.id)}
                                slab={slab}
                                pkg={pkg}
                                onEdit={openEdit}
                                onAdd={openAdd}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* ══════════════ ADMIN TAB ════════════════════════════════════════════ */}
          {canAdmin && (
            <TabsContent value="admin">
              <div className="space-y-6 mt-4">
                {/* Quick-stats strip */}
                <div className="grid grid-cols-3 gap-4">
                  <Card className="border-blue-100">
                    <CardContent className="pt-4 pb-3">
                      <p className="text-xs text-slate-500 mb-1">
                        Total Packages
                      </p>
                      <p className="text-2xl font-bold text-slate-900">
                        {totalPkgsCount}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-amber-100 bg-amber-50/30">
                    <CardContent className="pt-4 pb-3">
                      <p className="text-xs text-amber-600 mb-1">
                        Pending Review
                      </p>
                      <p className="text-2xl font-bold text-amber-700">
                        {pendingReviewCount}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-blue-100">
                    <CardContent className="pt-4 pb-3">
                      <p className="text-xs text-slate-500 mb-1">
                        Active Bands
                      </p>
                      <p className="text-2xl font-bold text-slate-900">
                        {activeBandsCount}
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {msg && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" /> {msg}
                    <button onClick={() => setMsg("")} className="ml-auto">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <Tabs
                  value={adminTab}
                  onValueChange={(v) =>
                    setAdminTab(v as "bands" | "packages" | "cost-centres")
                  }
                >
                  <TabsList className="grid w-full max-w-lg grid-cols-3">
                    <TabsTrigger value="bands" className="gap-1.5">
                      <Layers className="h-3.5 w-3.5" /> Bands
                    </TabsTrigger>
                    <TabsTrigger value="cost-centres" className="gap-1.5">
                      <Building2 className="h-3.5 w-3.5" /> Cost Centres
                    </TabsTrigger>
                    <TabsTrigger value="packages" className="gap-1.5">
                      <IndianRupee className="h-3.5 w-3.5" /> Packages
                    </TabsTrigger>
                  </TabsList>

                  {/* ═══ BANDS TAB ═══ */}
                  <TabsContent value="bands">
                    <Card>
                      <CardHeader className="flex-row items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            Salary Bands (A–N)
                          </CardTitle>
                          <CardDescription>
                            Monthly CTC ranges. Each band defines a salary
                            bracket.
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            setEditBand({
                              band_code: "",
                              band_name: "",
                              slab_from: 0,
                              slab_to: 0,
                            })
                          }
                          className="gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Band
                        </Button>
                      </CardHeader>
                      <CardContent>
                        {editBand && (
                          <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end">
                            <div>
                              <Label className="text-xs">Band Code *</Label>
                              <Input
                                className="h-9"
                                value={editBand.band_code ?? ""}
                                onChange={(e) =>
                                  setEditBand((p) => ({
                                    ...p!,
                                    band_code: e.target.value.toUpperCase(),
                                  }))
                                }
                                placeholder="O"
                                maxLength={3}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Name</Label>
                              <Input
                                className="h-9"
                                value={editBand.band_name ?? ""}
                                onChange={(e) =>
                                  setEditBand((p) => ({
                                    ...p!,
                                    band_name: e.target.value,
                                  }))
                                }
                                placeholder="Band O"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">From (₹/mo)</Label>
                              <Input
                                className="h-9"
                                type="number"
                                value={editBand.slab_from ?? ""}
                                onChange={(e) =>
                                  setEditBand((p) => ({
                                    ...p!,
                                    slab_from: Number(e.target.value),
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <Label className="text-xs">To (₹/mo)</Label>
                              <Input
                                className="h-9"
                                type="number"
                                value={editBand.slab_to ?? ""}
                                onChange={(e) =>
                                  setEditBand((p) => ({
                                    ...p!,
                                    slab_to: Number(e.target.value),
                                  }))
                                }
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={saveBand}
                                disabled={saving}
                                className="gap-1"
                              >
                                <Save className="h-3.5 w-3.5" />
                                {saving ? "..." : "Save"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditBand(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b">
                                {[
                                  "Band",
                                  "Name",
                                  "From (₹/mo)",
                                  "To (₹/mo)",
                                  "Status",
                                  "",
                                ].map((h) => (
                                  <th
                                    key={h}
                                    className="px-3 py-2 text-left text-xs font-semibold text-slate-600"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {bands.map((b) => (
                                <tr key={b.id} className="hover:bg-slate-50">
                                  <td className="px-3 py-2 font-bold">
                                    {b.band_code}
                                  </td>
                                  <td className="px-3 py-2">{b.band_name}</td>
                                  <td className="px-3 py-2 font-mono">
                                    {fmt(b.slab_from)}
                                  </td>
                                  <td className="px-3 py-2 font-mono">
                                    {fmt(b.slab_to)}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge
                                      variant={
                                        b.active_status ? "default" : "secondary"
                                      }
                                    >
                                      {b.active_status ? "Active" : "Inactive"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setEditBand(b)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ═══ COST CENTRES TAB ═══ */}
                  <TabsContent value="cost-centres">
                    <Card>
                      <CardHeader className="flex-row items-center justify-between">
                        <div>
                          <CardTitle className="text-lg">
                            Cost Centres
                          </CardTitle>
                          <CardDescription>
                            Branch-wise cost centres. Displayed as "Code
                            (Name)" in offer form — raw code is saved.
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          onClick={() =>
                            setEditCC({
                              cost_centre_code: "",
                              branch_name: "",
                              display_name: "",
                              category: "",
                            })
                          }
                          className="gap-1.5"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add Cost Centre
                        </Button>
                      </CardHeader>
                      <CardContent>
                        <div className="mb-4">
                          <Input
                            placeholder="Filter by branch or code..."
                            value={ccFilter}
                            onChange={(e) => setCcFilter(e.target.value)}
                            className="h-9 max-w-sm"
                          />
                        </div>
                        {editCC && (
                          <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end">
                            <div>
                              <Label className="text-xs">Code *</Label>
                              <Input
                                className="h-9"
                                value={editCC.cost_centre_code ?? ""}
                                onChange={(e) =>
                                  setEditCC((p) => ({
                                    ...p!,
                                    cost_centre_code: e.target.value,
                                  }))
                                }
                                placeholder="BSS/BO/NOIDA-2/999"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Branch *</Label>
                              <Input
                                className="h-9"
                                value={editCC.branch_name ?? ""}
                                onChange={(e) =>
                                  setEditCC((p) => ({
                                    ...p!,
                                    branch_name: e.target.value,
                                  }))
                                }
                                placeholder="NOIDA-2"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Display Name</Label>
                              <Input
                                className="h-9"
                                value={editCC.display_name ?? ""}
                                onChange={(e) =>
                                  setEditCC((p) => ({
                                    ...p!,
                                    display_name: e.target.value,
                                  }))
                                }
                                placeholder="Back Office / Client"
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={saveCC}
                                disabled={saving}
                                className="gap-1"
                              >
                                <Save className="h-3.5 w-3.5" />
                                {saving ? "..." : "Save"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditCC(null)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                              <tr className="bg-slate-50 border-b">
                                {[
                                  "Code",
                                  "Branch",
                                  "Display Name",
                                  "Category",
                                  "Status",
                                ].map((h) => (
                                  <th
                                    key={h}
                                    className="px-3 py-2 text-left text-xs font-semibold text-slate-600"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {costCentres
                                .filter(
                                  (c) =>
                                    !ccFilter ||
                                    c.cost_centre_code
                                      .toLowerCase()
                                      .includes(ccFilter.toLowerCase()) ||
                                    c.branch_name
                                      .toLowerCase()
                                      .includes(ccFilter.toLowerCase())
                                )
                                .map((c) => (
                                  <tr
                                    key={c.id}
                                    className="hover:bg-slate-50"
                                  >
                                    <td className="px-3 py-2 font-mono text-xs">
                                      {c.cost_centre_code}
                                    </td>
                                    <td className="px-3 py-2 font-medium">
                                      {c.branch_name}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">
                                      {c.display_name ||
                                        c.process_name ||
                                        "—"}
                                    </td>
                                    <td className="px-3 py-2 text-slate-500">
                                      {c.category || "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Badge
                                        variant={
                                          c.active_status
                                            ? "default"
                                            : "secondary"
                                        }
                                        className="text-xs"
                                      >
                                        {c.active_status
                                          ? "Active"
                                          : "Inactive"}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ═══ PACKAGES TAB ═══ */}
                  <TabsContent value="packages">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          Salary Packages
                        </CardTitle>
                        <CardDescription>
                          Pre-calculated component breakdowns per Branch + Cost
                          Centre + Band. All amounts monthly.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {/* Filters */}
                        <div className="grid gap-3 sm:grid-cols-4 mb-4">
                          <div>
                            <Label className="text-xs">Branch *</Label>
                            <select
                              className={`mt-1 ${SEL}`}
                              value={pkgBranch}
                              onChange={(e) => setPkgBranch(e.target.value)}
                            >
                              <option value="">Select Branch</option>
                              {branches.map((b) => (
                                <option key={b} value={b}>
                                  {b}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Band</Label>
                            <select
                              className={`mt-1 ${SEL}`}
                              value={pkgBand}
                              onChange={(e) => setPkgBand(e.target.value)}
                            >
                              <option value="">All Bands</option>
                              {bands.map((b) => (
                                <option key={b.band_code} value={b.band_code}>
                                  Band {b.band_code} ({fmt(b.slab_from)}–
                                  {fmt(b.slab_to)})
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">Cost Centre</Label>
                            <select
                              className={`mt-1 ${SEL}`}
                              value={pkgCC}
                              onChange={(e) => setPkgCC(e.target.value)}
                            >
                              <option value="">All</option>
                              {costCentres
                                .filter(
                                  (c) =>
                                    !pkgBranch ||
                                    c.branch_name === pkgBranch
                                )
                                .map((c) => (
                                  <option
                                    key={c.cost_centre_code}
                                    value={c.cost_centre_code}
                                  >
                                    {c.cost_centre_code}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div className="flex items-end">
                            <Button
                              size="sm"
                              onClick={() => {
                                setCtcInput("");
                                setInHandInput("");
                                setCalcMode("ctc");
                                setEditPkg({
                                  branch_name: pkgBranch || "",
                                  band_code: pkgBand || "",
                                  cost_centre_code: pkgCC || "",
                                  package_amount: 0,
                                  basic: 0,
                                  hra: 0,
                                  lta: 0,
                                  conveyance: 0,
                                  gross: 0,
                                  epf_employee: 0,
                                  esic_employee: 0,
                                  net_in_hand: 0,
                                  epf_employer: 0,
                                  esic_employer: 0,
                                  admin_charges: 0,
                                  ctc: 0,
                                  bonus: 0,
                                  pli: 0,
                                  professional_tax: 0,
                                  special_allowance: 0,
                                  other_allowance: 0,
                                  portfolio: 0,
                                  medical: 0,
                                });
                              }}
                              className="gap-1.5 w-full"
                            >
                              <Plus className="h-3.5 w-3.5" /> New Package
                            </Button>
                          </div>
                        </div>

                        {/* Add/Edit package form — auto-calculator */}
                        {editPkg && (
                          <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-5 mb-4 space-y-4">
                            <div className="flex items-center gap-2">
                              <Calculator className="h-4 w-4 text-blue-600" />
                              <p className="text-sm font-bold text-blue-700">
                                {editPkg.id ? "Edit" : "New"} Package —{" "}
                                {editPkg.branch_name || "Select branch"} / Band{" "}
                                {editPkg.band_code || "?"}
                              </p>
                            </div>

                            {/* Header fields */}
                            <div className="grid gap-3 sm:grid-cols-4">
                              <div>
                                <Label className="text-xs">Branch *</Label>
                                <select
                                  className={`mt-1 ${SEL} h-9`}
                                  value={editPkg.branch_name ?? ""}
                                  onChange={(e) =>
                                    setEditPkg((p) => ({
                                      ...p!,
                                      branch_name: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Select Branch</option>
                                  {branches.map((b) => (
                                    <option key={b} value={b}>
                                      {b}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <Label className="text-xs">Cost Centre</Label>
                                <select
                                  className={`mt-1 ${SEL} h-9`}
                                  value={editPkg.cost_centre_code ?? ""}
                                  onChange={(e) =>
                                    setEditPkg((p) => ({
                                      ...p!,
                                      cost_centre_code: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">All / None</option>
                                  {costCentres
                                    .filter(
                                      (c) =>
                                        !editPkg.branch_name ||
                                        c.branch_name === editPkg.branch_name
                                    )
                                    .map((c) => (
                                      <option
                                        key={c.cost_centre_code}
                                        value={c.cost_centre_code}
                                      >
                                        {c.cost_centre_code}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div>
                                <Label className="text-xs">Band *</Label>
                                <select
                                  className={`mt-1 ${SEL} h-9`}
                                  value={editPkg.band_code ?? ""}
                                  onChange={(e) =>
                                    setEditPkg((p) => ({
                                      ...p!,
                                      band_code: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Select Band</option>
                                  {bands.map((b) => (
                                    <option
                                      key={b.band_code}
                                      value={b.band_code}
                                    >
                                      Band {b.band_code} ({fmt(b.slab_from)}–
                                      {fmt(b.slab_to)})
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <Label className="text-xs">
                                  Package Amount (CTC/mo)
                                </Label>
                                <Input
                                  className="h-9 bg-slate-100 font-semibold text-blue-700"
                                  readOnly
                                  value={
                                    editPkg.ctc ? fmt(editPkg.ctc) : ""
                                  }
                                  placeholder="Auto-calculated"
                                />
                              </div>
                            </div>

                            {/* Calc mode + toggles */}
                            <div className="flex flex-wrap items-center gap-4 rounded-lg bg-white border border-blue-100 px-4 py-3">
                              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
                                <button
                                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                                    calcMode === "ctc"
                                      ? "bg-blue-600 text-white"
                                      : "text-slate-600 hover:bg-slate-100"
                                  }`}
                                  onClick={() => setCalcMode("ctc")}
                                >
                                  From CTC
                                </button>
                                <button
                                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                                    calcMode === "inhand"
                                      ? "bg-blue-600 text-white"
                                      : "text-slate-600 hover:bg-slate-100"
                                  }`}
                                  onClick={() => setCalcMode("inhand")}
                                >
                                  From In-Hand
                                </button>
                              </div>

                              <div className="flex items-center gap-2">
                                <Label className="text-xs whitespace-nowrap">
                                  {calcMode === "ctc"
                                    ? "Monthly CTC (₹)"
                                    : "Net In Hand (₹)"}
                                </Label>
                                <Input
                                  className="h-8 w-32 text-sm font-semibold"
                                  type="number"
                                  placeholder="e.g. 25000"
                                  value={
                                    calcMode === "ctc" ? ctcInput : inHandInput
                                  }
                                  onChange={(e) =>
                                    calcMode === "ctc"
                                      ? setCtcInput(e.target.value)
                                      : setInHandInput(e.target.value)
                                  }
                                />
                              </div>

                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-blue-600"
                                  checked={includePf}
                                  onChange={(e) =>
                                    setIncludePf(e.target.checked)
                                  }
                                />
                                <span className="text-xs font-medium">
                                  Include PF
                                </span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-blue-600"
                                  checked={includeEsic}
                                  onChange={(e) =>
                                    setIncludeEsic(e.target.checked)
                                  }
                                />
                                <span className="text-xs font-medium">
                                  Include ESIC
                                </span>
                              </label>

                              <div className="flex items-center gap-1.5">
                                <Label className="text-xs whitespace-nowrap">
                                  Basic %
                                </Label>
                                <Input
                                  className="h-8 w-16 text-xs"
                                  type="number"
                                  min={10}
                                  max={80}
                                  value={basicPct}
                                  onChange={(e) =>
                                    setBasicPct(Number(e.target.value))
                                  }
                                />
                              </div>

                              <div className="flex items-center gap-1.5">
                                <Label className="text-xs whitespace-nowrap">
                                  HRA %
                                </Label>
                                <Input
                                  className="h-8 w-16 text-xs"
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={hraPct}
                                  onChange={(e) =>
                                    setHraPct(Number(e.target.value))
                                  }
                                />
                              </div>
                            </div>

                            {/* Component grid */}
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                              {/* Earnings */}
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">
                                  Earnings (Monthly)
                                </p>
                                {(
                                  [
                                    ["basic", "Basic"],
                                    ["hra", "HRA"],
                                    ["lta", "LTA"],
                                    ["conveyance", "Conveyance"],
                                    ["special_allowance", "Special Allowance"],
                                    ["bonus", "Bonus"],
                                    ["portfolio", "Portfolio"],
                                    ["medical", "Medical Allowance"],
                                    ["other_allowance", "Other Allowance"],
                                    ["pli", "PLI"],
                                  ] as const
                                ).map(([field, label]) => {
                                  const isComputed = [
                                    "basic",
                                    "hra",
                                    "conveyance",
                                    "special_allowance",
                                    "bonus",
                                  ].includes(field);
                                  return (
                                    <div
                                      key={field}
                                      className="flex items-center gap-2"
                                    >
                                      <Label className="text-xs w-36 shrink-0">
                                        {label}
                                      </Label>
                                      <Input
                                        className={`h-8 text-xs flex-1 ${
                                          isComputed
                                            ? "bg-slate-50 text-slate-700"
                                            : "bg-white"
                                        }`}
                                        type="number"
                                        value={
                                          (editPkg as any)[field] ?? 0
                                        }
                                        onChange={(e) =>
                                          setEditPkg((p) => ({
                                            ...p!,
                                            [field]: Number(e.target.value),
                                          }))
                                        }
                                      />
                                    </div>
                                  );
                                })}
                                <div className="flex items-center gap-2 pt-1 border-t mt-1">
                                  <Label className="text-xs w-36 font-bold">
                                    Gross
                                  </Label>
                                  <Input
                                    className="h-8 text-xs flex-1 bg-slate-100 font-semibold text-blue-700"
                                    readOnly
                                    value={
                                      editPkg.gross
                                        ? fmt(editPkg.gross)
                                        : ""
                                    }
                                  />
                                </div>
                              </div>

                              {/* Deductions + employer */}
                              <div className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">
                                  Deductions &amp; Employer Costs
                                </p>
                                {(
                                  [
                                    [
                                      "epf_employee",
                                      "PF (Employee 12%)",
                                      true,
                                    ],
                                    [
                                      "esic_employee",
                                      "ESIC (Employee 0.75%)",
                                      true,
                                    ],
                                    [
                                      "professional_tax",
                                      (() => {
                                        const st =
                                          branchStates[
                                            editPkg?.branch_name ?? ""
                                          ];
                                        if (!st)
                                          return "Prof. Tax (state unknown)";
                                        const fn = PT_BY_STATE[st];
                                        if (!fn)
                                          return `Prof. Tax (${st} — not configured)`;
                                        return fn(0) === 0 && fn(50000) === 0
                                          ? `Prof. Tax — N/A (${st})`
                                          : `Prof. Tax — ${st}`;
                                      })(),
                                      true,
                                    ],
                                  ] as [string, string, boolean][]
                                ).map(([field, label, computed]) => (
                                  <div
                                    key={field}
                                    className="flex items-center gap-2"
                                  >
                                    <Label className="text-xs w-36 shrink-0">
                                      {label}
                                    </Label>
                                    <Input
                                      className={`h-8 text-xs flex-1 ${
                                        computed
                                          ? "bg-slate-50 text-red-600"
                                          : "bg-white"
                                      }`}
                                      type="number"
                                      value={(editPkg as any)[field] ?? 0}
                                      onChange={(e) =>
                                        setEditPkg((p) => ({
                                          ...p!,
                                          [field]: Number(e.target.value),
                                        }))
                                      }
                                    />
                                  </div>
                                ))}
                                <div className="flex items-center gap-2 pt-1 border-t mt-1">
                                  <Label className="text-xs w-36 font-bold text-emerald-700">
                                    Net In Hand
                                  </Label>
                                  <Input
                                    className="h-8 text-xs flex-1 bg-emerald-50 font-bold text-emerald-700"
                                    readOnly
                                    value={
                                      editPkg.net_in_hand
                                        ? fmt(editPkg.net_in_hand)
                                        : ""
                                    }
                                  />
                                </div>
                                <div className="pt-2 mt-2">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                                    Employer Contributions
                                  </p>
                                  {(
                                    [
                                      [
                                        "epf_employer",
                                        "EPF CO (Employer)",
                                        true,
                                      ],
                                      [
                                        "esic_employer",
                                        "ESIC CO (Employer)",
                                        true,
                                      ],
                                      ["admin_charges", "Admin Charges", true],
                                    ] as [string, string, boolean][]
                                  ).map(([field, label, computed]) => (
                                    <div
                                      key={field}
                                      className="flex items-center gap-2 mb-2"
                                    >
                                      <Label className="text-xs w-36 shrink-0">
                                        {label}
                                      </Label>
                                      <Input
                                        className={`h-8 text-xs flex-1 ${
                                          computed
                                            ? "bg-slate-50 text-orange-700"
                                            : "bg-white"
                                        }`}
                                        type="number"
                                        value={
                                          (editPkg as any)[field] ?? 0
                                        }
                                        onChange={(e) =>
                                          setEditPkg((p) => ({
                                            ...p!,
                                            [field]: Number(e.target.value),
                                          }))
                                        }
                                      />
                                    </div>
                                  ))}
                                  <div className="flex items-center gap-2 pt-1 border-t mt-1">
                                    <Label className="text-xs w-36 font-bold">
                                      CTC (Monthly)
                                    </Label>
                                    <Input
                                      className="h-8 text-xs flex-1 bg-blue-50 font-bold text-blue-700"
                                      readOnly
                                      value={
                                        editPkg.ctc
                                          ? fmt(editPkg.ctc)
                                          : ""
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-2 pt-2 border-t">
                              <Button
                                size="sm"
                                onClick={savePkg}
                                disabled={saving}
                                className="gap-1"
                              >
                                <Save className="h-3.5 w-3.5" />
                                {saving ? "Saving..." : "Save Package"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditPkg(null);
                                  setCtcInput("");
                                  setInHandInput("");
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {loading ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                          </div>
                        ) : !pkgBranch ? (
                          <p className="text-center text-slate-400 py-12">
                            Select a branch to view packages
                          </p>
                        ) : (
                          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-white z-10">
                                <tr className="bg-slate-50 border-b">
                                  {[
                                    "Band",
                                    "CC",
                                    "Pkg Amt",
                                    "Basic",
                                    "HRA",
                                    "LTA",
                                    "Conv",
                                    "Bonus",
                                    "Gross",
                                    "PF",
                                    "ESI",
                                    "Net",
                                    "CTC",
                                    "",
                                  ].map((h) => (
                                    <th
                                      key={h}
                                      className="px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap"
                                    >
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {adminPackages.map((p) => (
                                  <tr
                                    key={p.id}
                                    className="hover:bg-blue-50/30"
                                  >
                                    <td className="px-2 py-1.5 font-bold">
                                      {p.band_code}
                                    </td>
                                    <td
                                      className="px-2 py-1.5 font-mono text-[10px] max-w-[120px] truncate"
                                      title={p.cost_centre_code}
                                    >
                                      {p.cost_centre_code || "—"}
                                    </td>
                                    <td className="px-2 py-1.5 font-bold text-blue-700">
                                      {fmt(p.package_amount)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.basic)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.hra)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.lta)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.conveyance)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.bonus)}
                                    </td>
                                    <td className="px-2 py-1.5 font-semibold">
                                      {fmt(p.gross)}
                                    </td>
                                    <td className="px-2 py-1.5 text-red-600">
                                      {fmt(p.epf_employee)}
                                    </td>
                                    <td className="px-2 py-1.5 text-red-600">
                                      {fmt(p.esic_employee)}
                                    </td>
                                    <td className="px-2 py-1.5 font-bold text-emerald-700">
                                      {fmt(p.net_in_hand)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {fmt(p.ctc)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => {
                                            setCalcMode("ctc");
                                            setCtcInput(
                                              String(p.ctc || "")
                                            );
                                            setInHandInput("");
                                            setEditPkg(p);
                                          }}
                                          className="p-1 hover:bg-slate-200 rounded"
                                        >
                                          <Pencil className="h-3 w-3 text-slate-500" />
                                        </button>
                                        <button
                                          onClick={() => deletePkg(p.id)}
                                          className="p-1 hover:bg-red-100 rounded"
                                        >
                                          <Trash2 className="h-3 w-3 text-red-400" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {!adminPackages.length && (
                              <p className="text-center text-slate-400 py-8">
                                No packages for this filter
                              </p>
                            )}
                            <p className="text-xs text-slate-400 mt-3 px-2">
                              {adminPackages.length} package(s) found
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* PackageDialog (NativeSalaryPackages) */}
      <PackageDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSave}
        form={form}
        setForm={setForm}
        slabs={slabs}
        saving={saveMutation.isPending}
        existingId={editingPkg?.id}
      />

      {/* CSV Import dialog */}
      <CsvImportDialog
        open={csvDialogOpen}
        onClose={() => {
          setCsvDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["salary-packages"] });
          queryClient.invalidateQueries({
            queryKey: ["salary-packages-all"],
          });
        }}
      />
    </DashboardLayout>
  );
}
