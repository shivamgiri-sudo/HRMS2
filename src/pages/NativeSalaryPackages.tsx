import { useState, useCallback, useMemo } from "react";
import {
  AlertTriangle,
  Download,
  Loader,
  Pencil,
  Plus,
  RefreshCcw,
  Upload,
  X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

// ─── Types ────────────────────────────────────────────────────────────────────

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
  conveyance_type?: "AMT" | "PCT";
  medical_amt: number;
  medical_type?: "AMT" | "PCT";
  other_allowance_amt: number;
  other_allowance_type?: "AMT" | "PCT";
  bonus_amt: number;
  bonus_type?: "AMT" | "PCT";
  portfolio_amt: number;
  special_allowance_amt: number;
  pli_amt: number;
  gross_monthly?: number;
  ctc_monthly?: number;
  effective_from?: string;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function resolveAmt(
  base: number,
  amt: string,
  type: ComponentType
): number {
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

function defaultForm(
  gradeId: string,
  slabId?: string
): PackageFormState {
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
    conveyance_type: pkg.conveyance_type ?? "AMT",
    medical_amt: String(pkg.medical_amt ?? ""),
    medical_type: pkg.medical_type ?? "AMT",
    other_allowance_amt: String(pkg.other_allowance_amt ?? ""),
    other_allowance_type: pkg.other_allowance_type ?? "AMT",
    bonus_amt: String(pkg.bonus_amt ?? ""),
    bonus_type: pkg.bonus_type ?? "AMT",
    portfolio_amt: String(pkg.portfolio_amt ?? ""),
    special_allowance_amt: String(pkg.special_allowance_amt ?? ""),
    pli_amt: String(pkg.pli_amt ?? ""),
    effective_from: pkg.effective_from
      ? pkg.effective_from.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  };
}

// ─── CSV Import Parser ─────────────────────────────────────────────────────────

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

// ─── Component Type Toggle ────────────────────────────────────────────────────

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

// ─── Package Edit Dialog ───────────────────────────────────────────────────────

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
          {/* Slab */}
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
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Basic */}
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

          {/* Effective From */}
          <div>
            <Label>Effective From</Label>
            <Input
              type="date"
              value={form.effective_from}
              onChange={field("effective_from")}
            />
          </div>

          {/* Conveyance */}
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
                onChange={(v) =>
                  setForm((f) => ({ ...f, conveyance_type: v }))
                }
              />
            </div>
          </div>

          {/* Medical */}
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
                onChange={(v) =>
                  setForm((f) => ({ ...f, medical_type: v }))
                }
              />
            </div>
          </div>

          {/* Other Allowance */}
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

          {/* Bonus */}
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
                onChange={(v) =>
                  setForm((f) => ({ ...f, bonus_type: v }))
                }
              />
            </div>
          </div>

          {/* Portfolio */}
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

          {/* Special Allowance */}
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

          {/* PLI */}
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

          {/* Computed Preview */}
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
            {saving ? (
              <Loader className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            {existingId ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk CSV Import Dialog ────────────────────────────────────────────────────

interface CsvImportDialogProps {
  open: boolean;
  onClose: () => void;
}

interface CsvImportResult {
  row: number;
  status: "ok" | "error";
  message?: string;
}

function CsvImportDialog({ open, onClose }: CsvImportDialogProps) {
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeSalaryPackages() {
  const queryClient = useQueryClient();

  const [selectedGradeId, setSelectedGradeId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<SalaryPackage | null>(null);
  const [preselectedSlabId, setPreselectedSlabId] = useState<
    string | undefined
  >(undefined);
  const [form, setForm] = useState<PackageFormState>(defaultForm(""));

  // ── Fetch packages to derive unique bands ──────────────────────────────────
  const {
    data: allPackages,
    isLoading: loadingBands,
    isError: bandsError,
    refetch: refetchBands,
  } = useQuery<PackagesResponse>({
    queryKey: ["salary-packages-all"],
    queryFn: () => hrmsApi.get<PackagesResponse>("/api/payroll-masters/packages"),
    staleTime: 60_000,
  });

  // ── Fetch slabs ─────────────────────────────────────────────────────────────
  const { data: slabsData, isLoading: loadingSlabs } =
    useQuery<SlabsResponse>({
      queryKey: ["salary-slabs"],
      queryFn: () =>
        hrmsApi.get<SlabsResponse>("/api/payroll-masters/slabs"),
      staleTime: 60_000,
    });

  // ── Fetch org grade bands (if endpoint exists) ─────────────────────────────
  const { data: orgBandsData } = useQuery<GradeBandsResponse>({
    queryKey: ["org-grade-bands"],
    queryFn: () =>
      hrmsApi.get<GradeBandsResponse>("/api/org/grade-bands"),
    staleTime: 60_000,
    retry: false,
  });

  // ── Fetch packages for selected grade ──────────────────────────────────────
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

  // ── Derived: unique grade bands ────────────────────────────────────────────
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

  // ── Mutation: save package ─────────────────────────────────────────────────
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
        conveyance_type: formData.conveyance_type,
        medical_amt: resolveAmt(
          basic,
          formData.medical_amt,
          formData.medical_type
        ),
        medical_type: formData.medical_type,
        other_allowance_amt: resolveAmt(
          basic,
          formData.other_allowance_amt,
          formData.other_allowance_type
        ),
        other_allowance_type: formData.other_allowance_type,
        bonus_amt: resolveAmt(
          basic,
          formData.bonus_amt,
          formData.bonus_type
        ),
        bonus_type: formData.bonus_type,
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
      queryClient.invalidateQueries({
        queryKey: ["salary-packages"],
      });
      queryClient.invalidateQueries({
        queryKey: ["salary-packages-all"],
      });
      setDialogOpen(false);
    },
  });

  // ── Dialog open helpers ────────────────────────────────────────────────────
  const openEdit = useCallback(
    (pkg: SalaryPackage) => {
      setEditingPkg(pkg);
      setForm(pkgToForm(pkg));
      setPreselectedSlabId(undefined);
      setDialogOpen(true);
    },
    []
  );

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

  // ── Build slab rows (all slabs; show pkg if exists) ───────────────────────
  const slabRows = useMemo(() => {
    return slabs.map((slab) => {
      const pkg = packages.find((p) => String(p.slab_id) === String(slab.id));
      return { slab, pkg: pkg ?? null };
    });
  }, [slabs, packages]);

  // ── Loading / error states ─────────────────────────────────────────────────
  const isLoading = loadingBands || loadingSlabs;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Salary Packages
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Define salary component amounts per Band + Slab combination
            </p>
          </div>
          <div className="flex gap-2">
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
        </div>

        {/* Filter bar */}
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
                        <SelectItem key={String(b.id)} value={String(b.id)}>
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
                  No bands found. Create packages first or check org masters.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Package matrix */}
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
                {gradeBands.find((b) => String(b.id) === selectedGradeId)
                  ?.name ?? selectedGradeId}
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
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Conv.</TableHead>
                        <TableHead className="text-right">Medical</TableHead>
                        <TableHead className="text-right">Other Allow.</TableHead>
                        <TableHead className="text-right">Bonus</TableHead>
                        <TableHead className="text-right">Portfolio</TableHead>
                        <TableHead className="text-right">Special</TableHead>
                        <TableHead className="text-right">PLI</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">CTC</TableHead>
                        <TableHead className="text-center">Actions</TableHead>
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

      {/* Edit / Add dialog */}
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

// ─── Slab Row ─────────────────────────────────────────────────────────────────

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
          {slab.name}
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

  // Compute gross & ctc from stored amounts directly
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
      <TableCell className="font-medium">{slab.name}</TableCell>
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
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEdit(pkg)}
          title="Edit package"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
