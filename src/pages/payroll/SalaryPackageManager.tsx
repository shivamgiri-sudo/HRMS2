/**
 * Salary Package Manager — /payroll/salary-packages
 *
 * Merged hub combining the employee/HR salary package matrix view and the
 * admin management interface (bands, cost centres, package calculator).
 *
 * ?tab=packages (default) — Grade + Slab package matrix (was NativeSalaryPackages)
 * ?tab=admin — Bands, Cost Centres, Packages management (was NativeSalaryPackageAdmin)
 *
 * The admin tab is only visible to admin/super_admin/payroll roles.
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  Loader,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Upload,
  X,
  IndianRupee,
  Building2,
  Layers,
  Save,
  CheckCircle2,
  Calculator,
  Trash2,
  Settings,
  Package,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { calcFromCtc, calcFromInHand, PT_BY_STATE, type PkgCalcOptions } from "@/lib/salaryCalculator";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface GradeBand {
  id: number | string;
  name: string;
  code?: string;
  band_code?: string;
  band_name?: string;
  slab_from?: number;
  slab_to?: number;
  active_status?: number;
}

interface SalarySlab {
  id: number | string;
  name: string;
  label?: string;
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

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
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
    conveyance_type: pkg.conveyance_type === "PCT" || pkg.conveyance_type === "pct" ? "PCT" : "AMT",
    medical_amt: String(pkg.medical_amt ?? ""),
    medical_type: pkg.medical_type === "PCT" || pkg.medical_type === "pct" ? "PCT" : "AMT",
    other_allowance_amt: String(pkg.other_allowance_amt ?? ""),
    other_allowance_type: pkg.other_allowance_type === "PCT" || pkg.other_allowance_type === "pct" ? "PCT" : "AMT",
    bonus_amt: String(pkg.bonus_amt ?? ""),
    bonus_type: pkg.bonus_type === "PCT" || pkg.bonus_type === "pct" ? "PCT" : "AMT",
    portfolio_amt: String(pkg.portfolio_amt ?? ""),
    special_allowance_amt: String(pkg.special_allowance_amt ?? ""),
    pli_amt: String(pkg.pli_amt ?? ""),
    effective_from: pkg.effective_from ? pkg.effective_from.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

const SEL = "flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400";

// ═══════════════════════════════════════════════════════════════════════════════
// PACKAGE MATRIX TAB (was NativeSalaryPackages)
// ═══════════════════════════════════════════════════════════════════════════════

function TypeToggle({ value, onChange }: { value: ComponentType; onChange: (v: ComponentType) => void }) {
  return (
    <div className="flex rounded border overflow-hidden text-xs">
      <button type="button" onClick={() => onChange("AMT")}
        className={`px-2 py-1 ${value === "AMT" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>₹</button>
      <button type="button" onClick={() => onChange("PCT")}
        className={`px-2 py-1 ${value === "PCT" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>%</button>
    </div>
  );
}

function PackageDialog({
  open, onClose, onSave, form, setForm, slabs, saving, existingId,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (form: PackageFormState, existingId?: number | string) => void;
  form: PackageFormState;
  setForm: React.Dispatch<React.SetStateAction<PackageFormState>>;
  slabs: SalarySlab[];
  saving: boolean;
  existingId?: number | string;
}) {
  const gross = computeGross(form);
  const ctc = computeCTC(form);

  const field = (key: keyof PackageFormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existingId ? "Edit Salary Package" : "Add Salary Package"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label>Salary Slab</Label>
            <Select value={form.slab_id} onValueChange={(v) => setForm((f) => ({ ...f, slab_id: v }))} disabled={!!existingId}>
              <SelectTrigger><SelectValue placeholder="Select slab" /></SelectTrigger>
              <SelectContent>
                {slabs.map((s) => (
                  <SelectItem key={String(s.id)} value={String(s.id)}>{s.label ?? s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Basic (₹)</Label>
            <Input type="number" min={0} value={form.basic_amt} onChange={field("basic_amt")} placeholder="0" />
          </div>
          <div>
            <Label>Effective From</Label>
            <Input type="date" value={form.effective_from} onChange={field("effective_from")} />
          </div>

          {[
            { key: "conveyance", label: "Conveyance", typeKey: "conveyance_type" },
            { key: "medical", label: "Medical", typeKey: "medical_type" },
            { key: "other_allowance", label: "Other Allowance", typeKey: "other_allowance_type" },
            { key: "bonus", label: "Bonus", typeKey: "bonus_type" },
          ].map(({ key, label, typeKey }) => (
            <div key={key}>
              <Label>{label}</Label>
              <div className="flex gap-2 items-center">
                <Input type="number" min={0} value={form[`${key}_amt` as keyof PackageFormState] as string}
                  onChange={field(`${key}_amt` as keyof PackageFormState)} placeholder="0" />
                <TypeToggle value={form[typeKey as keyof PackageFormState] as ComponentType}
                  onChange={(v) => setForm((f) => ({ ...f, [typeKey]: v }))} />
              </div>
            </div>
          ))}

          <div><Label>Portfolio (₹)</Label><Input type="number" min={0} value={form.portfolio_amt} onChange={field("portfolio_amt")} placeholder="0" /></div>
          <div><Label>Special Allowance (₹)</Label><Input type="number" min={0} value={form.special_allowance_amt} onChange={field("special_allowance_amt")} placeholder="0" /></div>
          <div><Label>PLI (₹)</Label><Input type="number" min={0} value={form.pli_amt} onChange={field("pli_amt")} placeholder="0" /></div>

          <div className="col-span-2 grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="text-xs text-gray-500">Gross Monthly (computed)</p>
              <p className="text-lg font-semibold text-green-700">{fmtINR(gross)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">CTC Monthly (computed)</p>
              <p className="text-lg font-semibold text-blue-700">{fmtINR(ctc)}</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => onSave(form, existingId)} disabled={saving || !form.slab_id || !form.basic_amt}>
            {saving && <Loader className="h-4 w-4 animate-spin mr-2" />}
            {existingId ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlabRow({ slab, pkg, onEdit, onAdd }: {
  slab: SalarySlab;
  pkg: SalaryPackage | null;
  onEdit: (pkg: SalaryPackage) => void;
  onAdd: (slabId: string) => void;
}) {
  if (!pkg) {
    return (
      <TableRow className="opacity-60 hover:opacity-100">
        <TableCell className="font-medium">{slab.label ?? slab.name}<Badge variant="outline" className="ml-2 text-xs">No Package</Badge></TableCell>
        {Array.from({ length: 9 }).map((_, i) => <TableCell key={i} className="text-right text-gray-300">—</TableCell>)}
        <TableCell className="text-center">
          <Button size="sm" variant="outline" onClick={() => onAdd(String(slab.id))}><Plus className="h-3 w-3 mr-1" />Add</Button>
        </TableCell>
      </TableRow>
    );
  }

  const gross = pkg.gross_monthly ?? pkg.basic_amt + pkg.conveyance_amt + pkg.medical_amt + pkg.other_allowance_amt + pkg.bonus_amt + pkg.portfolio_amt + pkg.special_allowance_amt + pkg.pli_amt;
  const ctc = pkg.ctc_monthly ?? (() => {
    const pf = Math.min(pkg.basic_amt, 15000) * 0.12;
    const esic = gross <= 21000 ? gross * 0.0325 : 0;
    return Math.round(gross + pf + esic);
  })();

  return (
    <TableRow className="text-sm">
      <TableCell className="font-medium">
        {slab.label ?? slab.name}
        {pkg.derived_source === "observed" && <Badge variant="secondary" className="ml-2 text-xs">Observed · {pkg.employee_count ?? 0}</Badge>}
      </TableCell>
      <TableCell className="text-right">{fmtINR(pkg.basic_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.conveyance_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.medical_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.other_allowance_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.bonus_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.portfolio_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.special_allowance_amt)}</TableCell>
      <TableCell className="text-right">{fmtINR(pkg.pli_amt)}</TableCell>
      <TableCell className="text-right font-medium text-green-700">{fmtINR(gross)}</TableCell>
      <TableCell className="text-right font-medium text-blue-700">{fmtINR(ctc)}</TableCell>
      <TableCell className="text-center">
        {pkg.derived_source === "observed" ? (
          <Button size="sm" variant="outline" onClick={() => onAdd(String(slab.id))}><Plus className="h-3 w-3 mr-1" />Create</Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => onEdit(pkg)} title="Edit"><Pencil className="h-4 w-4" /></Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function PackageMatrixTab() {
  const queryClient = useQueryClient();
  const [selectedGradeId, setSelectedGradeId] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPkg, setEditingPkg] = useState<SalaryPackage | null>(null);
  const [form, setForm] = useState<PackageFormState>(defaultForm(""));

  const { data: allPackages, isLoading: loadingBands, isError: bandsError, refetch: refetchBands } = useQuery({
    queryKey: ["salary-packages-all"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: SalaryPackage[] }>("/api/payroll-masters/packages"),
    staleTime: 60_000,
  });

  const { data: slabsData, isLoading: loadingSlabs } = useQuery({
    queryKey: ["salary-slabs"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: SalarySlab[] }>("/api/payroll-masters/slabs"),
    staleTime: 60_000,
  });

  const { data: orgBandsData } = useQuery({
    queryKey: ["org-grade-bands"],
    queryFn: () => hrmsApi.get<{ success: boolean; data: GradeBand[] }>("/api/org/grade-bands"),
    staleTime: 60_000,
    retry: false,
  });

  const { data: pkgData, isLoading: loadingPkgs, isError: pkgError, refetch: refetchPkgs } = useQuery({
    queryKey: ["salary-packages", selectedGradeId],
    queryFn: () => hrmsApi.get<{ success: boolean; data: SalaryPackage[] }>(`/api/payroll-masters/packages?grade_id=${selectedGradeId}`),
    enabled: !!selectedGradeId,
    staleTime: 30_000,
  });

  const gradeBands = useMemo<GradeBand[]>(() => {
    if (orgBandsData?.data && orgBandsData.data.length > 0) return orgBandsData.data;
    if (!allPackages?.data) return [];
    const seen = new Map<string, GradeBand>();
    for (const p of allPackages.data) {
      const gid = String(p.grade_id);
      if (!seen.has(gid)) seen.set(gid, { id: p.grade_id, name: p.grade_name ?? p.band ?? gid });
    }
    return Array.from(seen.values());
  }, [allPackages, orgBandsData]);

  const slabs: SalarySlab[] = useMemo(() => slabsData?.data ?? [], [slabsData]);
  const packages: SalaryPackage[] = useMemo(() => pkgData?.data ?? [], [pkgData]);

  const saveMutation = useMutation({
    mutationFn: async ({ formData, existingId }: { formData: PackageFormState; existingId?: number | string }) => {
      const basic = toNum(formData.basic_amt);
      const payload = {
        grade_id: formData.grade_id,
        slab_id: formData.slab_id,
        basic_amt: basic,
        conveyance_amt: resolveAmt(basic, formData.conveyance_amt, formData.conveyance_type),
        conveyance_type: formData.conveyance_type === "PCT" ? "pct" : "fixed",
        medical_amt: resolveAmt(basic, formData.medical_amt, formData.medical_type),
        medical_type: formData.medical_type === "PCT" ? "pct" : "fixed",
        other_allowance_amt: resolveAmt(basic, formData.other_allowance_amt, formData.other_allowance_type),
        other_allowance_type: formData.other_allowance_type === "PCT" ? "pct" : "fixed",
        bonus_amt: resolveAmt(basic, formData.bonus_amt, formData.bonus_type),
        bonus_type: formData.bonus_type === "PCT" ? "pct" : "fixed",
        portfolio_amt: toNum(formData.portfolio_amt),
        special_allowance_amt: toNum(formData.special_allowance_amt),
        pli_amt: toNum(formData.pli_amt),
        effective_from: formData.effective_from,
      };
      if (existingId) return hrmsApi.put(`/api/payroll-masters/packages/${existingId}`, payload);
      return hrmsApi.post("/api/payroll-masters/packages", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salary-packages"] });
      queryClient.invalidateQueries({ queryKey: ["salary-packages-all"] });
      setDialogOpen(false);
    },
  });

  const openEdit = useCallback((pkg: SalaryPackage) => {
    setEditingPkg(pkg);
    setForm(pkgToForm(pkg));
    setDialogOpen(true);
  }, []);

  const openAdd = useCallback((slabId?: string) => {
    setEditingPkg(null);
    setForm(defaultForm(selectedGradeId, slabId));
    setDialogOpen(true);
  }, [selectedGradeId]);

  const handleSave = useCallback((formData: PackageFormState, existingId?: number | string) => {
    saveMutation.mutate({ formData, existingId });
  }, [saveMutation]);

  const slabRows = useMemo(() => slabs.map((slab) => {
    const pkg = packages.find((p) => String(p.slab_id) === String(slab.id));
    return { slab, pkg: pkg ?? null };
  }), [slabs, packages]);

  const isLoading = loadingBands || loadingSlabs;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Salary Package Matrix</h2>
          <p className="text-sm text-gray-500 mt-1">Define salary component amounts per Band + Slab combination</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { void refetchBands(); if (selectedGradeId) void refetchPkgs(); }}>
            <RefreshCcw className="h-4 w-4 mr-1" />Refresh
          </Button>
          {selectedGradeId && <Button size="sm" onClick={() => openAdd()}><Plus className="h-4 w-4 mr-1" />Add Package</Button>}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-gray-700">Filter by Grade Band</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="w-64">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-500"><Loader className="h-4 w-4 animate-spin" />Loading…</div>
              ) : bandsError ? (
                <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle className="h-4 w-4" />Failed to load bands</div>
              ) : (
                <Select value={selectedGradeId} onValueChange={setSelectedGradeId}>
                  <SelectTrigger className="bg-white"><SelectValue placeholder="Select a band" /></SelectTrigger>
                  <SelectContent className="bg-white border border-slate-200 shadow-md">
                    {gradeBands.map((b) => (
                      <SelectItem key={String(b.id)} value={String(b.id)}>{b.name}{b.code ? ` (${b.code})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedGradeId ? (
        <Card><CardContent className="py-12 text-center text-gray-400">Select a grade band above to view or manage packages.</CardContent></Card>
      ) : loadingPkgs ? (
        <Card><CardContent className="py-12 flex items-center justify-center gap-2 text-gray-500"><Loader className="h-5 w-5 animate-spin" />Loading…</CardContent></Card>
      ) : pkgError ? (
        <Card><CardContent className="py-12 flex items-center justify-center gap-2 text-red-600"><AlertTriangle className="h-5 w-5" />Failed to load</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Package Matrix — {gradeBands.find((b) => String(b.id) === selectedGradeId)?.name ?? selectedGradeId}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {slabs.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No slabs found. Add slabs via Payroll Masters first.</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead>Slab</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">Conv.</TableHead>
                      <TableHead className="text-right">Medical</TableHead>
                      <TableHead className="text-right">Other</TableHead>
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
                      <SlabRow key={String(slab.id)} slab={slab} pkg={pkg} onEdit={openEdit} onAdd={openAdd} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <PackageDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={handleSave}
        form={form} setForm={setForm} slabs={slabs} saving={saveMutation.isPending} existingId={editingPkg?.id} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TAB (was NativeSalaryPackageAdmin)
// ═══════════════════════════════════════════════════════════════════════════════

function AdminTab() {
  const [adminTab, setAdminTab] = useState<"bands" | "packages">("bands");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [bands, setBands] = useState<GradeBand[]>([]);
  const [editBand, setEditBand] = useState<Partial<GradeBand> | null>(null);

  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);

  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [pkgBranch, setPkgBranch] = useState("");
  const [pkgBand, setPkgBand] = useState("");
  const [pkgCC, setPkgCC] = useState("");
  const [editPkg, setEditPkg] = useState<Partial<AdminPackage> | null>(null);

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
    hrmsApi.get<any>("/api/payroll-masters/branch-states").then((r: any) => {
      const map: Record<string, string> = {};
      for (const row of r?.data ?? []) if (row.branch_name && row.state) map[row.branch_name] = row.state;
      setBranchStates(map);
    }).catch(() => {});
  }, []);

  const loadBands = useCallback(async () => {
    const r = await hrmsApi.get<any>("/api/payroll-masters/bands");
    setBands(r?.data ?? []);
  }, []);

  const loadCostCentres = useCallback(async () => {
    const r = await hrmsApi.get<any>("/api/payroll-masters/cost-centres");
    setCostCentres(r?.data ?? []);
  }, []);

  const loadPackages = useCallback(async () => {
    if (!pkgBranch) { setPackages([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ branch: pkgBranch });
    if (pkgBand) params.set("band", pkgBand);
    if (pkgCC) params.set("costCentre", pkgCC);
    const r = await hrmsApi.get<any>(`/api/payroll-masters/packages?${params}`);
    setPackages(r?.data ?? []);
    setLoading(false);
  }, [pkgBranch, pkgBand, pkgCC]);

  useEffect(() => { void loadBands(); void loadCostCentres(); }, [loadBands, loadCostCentres]);
  useEffect(() => { void loadPackages(); }, [loadPackages]);

  useEffect(() => {
    if (!editPkg) return;
    const selectedBranch = editPkg?.branch_name ?? pkgBranch;
    const opts: PkgCalcOptions = { includePf, includeEsic, basicPct, hraPct, state: selectedBranch ? branchStates[selectedBranch] : undefined };
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
  }, [ctcInput, inHandInput, includePf, includeEsic, basicPct, hraPct, calcMode, editPkg?.branch_name, pkgBranch, branchStates]);

  const saveBand = async () => {
    if (!editBand?.band_code || editBand.slab_from == null || editBand.slab_to == null) return;
    setSaving(true); setMsg("");
    try {
      if (editBand.id) await hrmsApi.put(`/api/payroll-masters/bands/${editBand.id}`, editBand);
      else await hrmsApi.post("/api/payroll-masters/bands", editBand);
      setEditBand(null);
      await loadBands();
      setMsg("Band saved");
    } catch (e: any) { setMsg(e?.message || "Failed"); }
    finally { setSaving(false); }
  };

  const savePkg = async () => {
    if (!editPkg?.branch_name || !editPkg?.band_code || !editPkg?.package_amount) return;
    setSaving(true); setMsg("");
    try {
      if (editPkg.id) await hrmsApi.put(`/api/payroll-masters/packages/${editPkg.id}`, editPkg);
      else await hrmsApi.post("/api/payroll-masters/packages", editPkg);
      setEditPkg(null);
      await loadPackages();
      setMsg("Package saved");
    } catch (e: any) { setMsg(e?.message || "Failed"); }
    finally { setSaving(false); }
  };

  const deletePkg = async (id: string) => {
    if (!confirm("Deactivate this package?")) return;
    await hrmsApi.delete(`/api/payroll-masters/packages/${id}`);
    await loadPackages();
    setMsg("Package deactivated");
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> {msg}
          <button onClick={() => setMsg("")} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <Tabs value={adminTab} onValueChange={(v) => setAdminTab(v as any)}>
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="bands" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Bands</TabsTrigger>
          <TabsTrigger value="packages" className="gap-1.5"><IndianRupee className="h-3.5 w-3.5" /> Packages</TabsTrigger>
        </TabsList>

        <TabsContent value="bands">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle className="text-lg">Salary Bands</CardTitle><CardDescription>Monthly CTC ranges.</CardDescription></div>
              <Button size="sm" onClick={() => setEditBand({ band_code: "", band_name: "", slab_from: 0, slab_to: 0 })} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
            </CardHeader>
            <CardContent>
              {editBand && (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end">
                  <div><Label className="text-xs">Code *</Label><Input className="h-9" value={editBand.band_code ?? ""} onChange={(e) => setEditBand((p) => ({ ...p!, band_code: e.target.value.toUpperCase() }))} maxLength={3} /></div>
                  <div><Label className="text-xs">Name</Label><Input className="h-9" value={editBand.band_name ?? ""} onChange={(e) => setEditBand((p) => ({ ...p!, band_name: e.target.value }))} /></div>
                  <div><Label className="text-xs">From (₹)</Label><Input className="h-9" type="number" value={editBand.slab_from ?? ""} onChange={(e) => setEditBand((p) => ({ ...p!, slab_from: Number(e.target.value) }))} /></div>
                  <div><Label className="text-xs">To (₹)</Label><Input className="h-9" type="number" value={editBand.slab_to ?? ""} onChange={(e) => setEditBand((p) => ({ ...p!, slab_to: Number(e.target.value) }))} /></div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveBand} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "…" : "Save"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditBand(null)}><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b">{["Band", "Name", "From", "To", "Status", ""].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{h}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {bands.map((b) => (
                      <tr key={String(b.id)} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold">{b.band_code}</td>
                        <td className="px-3 py-2">{b.band_name}</td>
                        <td className="px-3 py-2 font-mono">{fmtINR(b.slab_from ?? 0)}</td>
                        <td className="px-3 py-2 font-mono">{fmtINR(b.slab_to ?? 0)}</td>
                        <td className="px-3 py-2"><Badge variant={b.active_status ? "default" : "secondary"}>{b.active_status ? "Active" : "Inactive"}</Badge></td>
                        <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => setEditBand(b)}><Pencil className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>


        <TabsContent value="packages">
          <Card>
            <CardHeader><CardTitle className="text-lg">Salary Packages (Branch View)</CardTitle><CardDescription>Pre-calculated breakdowns per Branch + Band.</CardDescription></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-4 mb-4">
                <div>
                  <Label className="text-xs">Branch *</Label>
                  <select className={`mt-1 ${SEL}`} value={pkgBranch} onChange={(e) => setPkgBranch(e.target.value)}>
                    <option value="">Select Branch</option>
                    {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Band</Label>
                  <select className={`mt-1 ${SEL}`} value={pkgBand} onChange={(e) => setPkgBand(e.target.value)}>
                    <option value="">All</option>
                    {bands.map((b) => <option key={b.band_code} value={b.band_code}>Band {b.band_code}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Cost Centre</Label>
                  <select className={`mt-1 ${SEL}`} value={pkgCC} onChange={(e) => setPkgCC(e.target.value)}>
                    <option value="">All</option>
                    {costCentres.filter((c) => !pkgBranch || c.branch_name === pkgBranch).map((c) => (
                      <option key={c.cost_centre_code} value={c.cost_centre_code}>{c.cost_centre_code}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <Button size="sm" onClick={() => { setCtcInput(""); setInHandInput(""); setCalcMode("ctc"); setEditPkg({ branch_name: pkgBranch, band_code: pkgBand, cost_centre_code: pkgCC, package_amount: 0 } as any); }} className="gap-1.5 w-full">
                    <Plus className="h-3.5 w-3.5" /> New Package
                  </Button>
                </div>
              </div>

              {editPkg && (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-5 mb-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-blue-600" />
                    <p className="text-sm font-bold text-blue-700">{editPkg.id ? "Edit" : "New"} Package</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <Label className="text-xs">Branch *</Label>
                      <select className={`mt-1 ${SEL} h-9`} value={editPkg.branch_name ?? ""} onChange={(e) => setEditPkg((p) => ({ ...p!, branch_name: e.target.value }))}>
                        <option value="">Select</option>
                        {branches.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Band *</Label>
                      <select className={`mt-1 ${SEL} h-9`} value={editPkg.band_code ?? ""} onChange={(e) => setEditPkg((p) => ({ ...p!, band_code: e.target.value }))}>
                        <option value="">Select</option>
                        {bands.map((b) => <option key={b.band_code} value={b.band_code}>Band {b.band_code}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">Cost Centre</Label>
                      <select className={`mt-1 ${SEL} h-9`} value={editPkg.cost_centre_code ?? ""} onChange={(e) => setEditPkg((p) => ({ ...p!, cost_centre_code: e.target.value }))}>
                        <option value="">All</option>
                        {costCentres.filter((c) => !editPkg.branch_name || c.branch_name === editPkg.branch_name).map((c) => (
                          <option key={c.cost_centre_code} value={c.cost_centre_code}>{c.cost_centre_code}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label className="text-xs">CTC (computed)</Label>
                      <Input className="h-9 bg-slate-100 font-semibold text-blue-700" readOnly value={editPkg.ctc ? fmtINR(editPkg.ctc) : ""} />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 rounded-lg bg-white border border-blue-100 px-4 py-3">
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
                      <button className={`px-3 py-1.5 rounded-md text-xs font-semibold ${calcMode === "ctc" ? "bg-blue-600 text-white" : "text-slate-600"}`} onClick={() => setCalcMode("ctc")}>From CTC</button>
                      <button className={`px-3 py-1.5 rounded-md text-xs font-semibold ${calcMode === "inhand" ? "bg-blue-600 text-white" : "text-slate-600"}`} onClick={() => setCalcMode("inhand")}>From In-Hand</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs whitespace-nowrap">{calcMode === "ctc" ? "CTC (₹)" : "In Hand (₹)"}</Label>
                      <Input className="h-8 w-32 text-sm font-semibold" type="number" value={calcMode === "ctc" ? ctcInput : inHandInput}
                        onChange={(e) => calcMode === "ctc" ? setCtcInput(e.target.value) : setInHandInput(e.target.value)} />
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includePf} onChange={(e) => setIncludePf(e.target.checked)} />
                      <span className="text-xs font-medium">PF</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includeEsic} onChange={(e) => setIncludeEsic(e.target.checked)} />
                      <span className="text-xs font-medium">ESIC</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">Basic %</Label>
                      <Input className="h-8 w-16 text-xs" type="number" min={10} max={80} value={basicPct} onChange={(e) => setBasicPct(Number(e.target.value))} />
                    </div>
                  </div>

                  <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">Earnings</p>
                      {[["basic", "Basic"], ["hra", "HRA"], ["conveyance", "Conveyance"], ["special_allowance", "Special"], ["bonus", "Bonus"]].map(([f, l]) => (
                        <div key={f} className="flex items-center gap-2">
                          <Label className="text-xs w-28">{l}</Label>
                          <Input className="h-8 text-xs flex-1 bg-slate-50" type="number" value={(editPkg as any)[f] ?? 0}
                            onChange={(e) => setEditPkg((p) => ({ ...p!, [f]: Number(e.target.value) }))} />
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1 border-t">
                        <Label className="text-xs w-28 font-bold">Gross</Label>
                        <Input className="h-8 text-xs flex-1 bg-slate-100 font-semibold text-blue-700" readOnly value={editPkg.gross ? fmtINR(editPkg.gross) : ""} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">Deductions</p>
                      {[["epf_employee", "PF (Emp)"], ["esic_employee", "ESIC (Emp)"], ["professional_tax", "Prof. Tax"]].map(([f, l]) => (
                        <div key={f} className="flex items-center gap-2">
                          <Label className="text-xs w-28">{l}</Label>
                          <Input className="h-8 text-xs flex-1 bg-slate-50 text-red-600" type="number" value={(editPkg as any)[f] ?? 0}
                            onChange={(e) => setEditPkg((p) => ({ ...p!, [f]: Number(e.target.value) }))} />
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1 border-t">
                        <Label className="text-xs w-28 font-bold text-emerald-700">Net In Hand</Label>
                        <Input className="h-8 text-xs flex-1 bg-emerald-50 font-bold text-emerald-700" readOnly value={editPkg.net_in_hand ? fmtINR(editPkg.net_in_hand) : ""} />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t">
                    <Button size="sm" onClick={savePkg} disabled={saving}><Save className="h-3.5 w-3.5 mr-1" />{saving ? "…" : "Save"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditPkg(null); setCtcInput(""); setInHandInput(""); }}>Cancel</Button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : !pkgBranch ? (
                <p className="text-center text-slate-400 py-12">Select a branch</p>
              ) : (
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="bg-slate-50 border-b">{["Band", "CC", "Basic", "HRA", "Gross", "PF", "ESI", "Net", "CTC", ""].map((h) => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {packages.map((p) => (
                        <tr key={p.id} className="hover:bg-blue-50/30">
                          <td className="px-2 py-1.5 font-bold">{p.band_code}</td>
                          <td className="px-2 py-1.5 font-mono text-[10px] max-w-[100px] truncate">{p.cost_centre_code || "—"}</td>
                          <td className="px-2 py-1.5">{fmtINR(p.basic)}</td>
                          <td className="px-2 py-1.5">{fmtINR(p.hra)}</td>
                          <td className="px-2 py-1.5 font-semibold">{fmtINR(p.gross)}</td>
                          <td className="px-2 py-1.5 text-red-600">{fmtINR(p.epf_employee)}</td>
                          <td className="px-2 py-1.5 text-red-600">{fmtINR(p.esic_employee)}</td>
                          <td className="px-2 py-1.5 font-bold text-emerald-700">{fmtINR(p.net_in_hand)}</td>
                          <td className="px-2 py-1.5">{fmtINR(p.ctc)}</td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-1">
                              <button onClick={() => { setCalcMode("ctc"); setCtcInput(String(p.ctc || "")); setEditPkg(p); }} className="p-1 hover:bg-slate-200 rounded"><Pencil className="h-3 w-3 text-slate-500" /></button>
                              <button onClick={() => deletePkg(p.id)} className="p-1 hover:bg-red-100 rounded"><Trash2 className="h-3 w-3 text-red-400" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!packages.length && <p className="text-center text-slate-400 py-8">No packages</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SalaryPackageManager() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") || "packages";
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();

  const isAdmin = roleKeys.includes("admin") || roleKeys.includes("super_admin") || roleKeys.includes("payroll") || roleKeys.includes("payroll_head");

  const handleTabChange = (newTab: string) => {
    setSearchParams({ tab: newTab }, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-5 sm:p-6 shadow-lg">
          <div className="pointer-events-none absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 20% 50%, rgba(255,255,255,0.3) 0%, transparent 50%)" }} />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <IndianRupee className="h-5 w-5 text-indigo-200" />
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-indigo-200">Payroll Configuration</span>
              </div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">Salary Package Manager</h1>
              <p className="mt-1 text-sm text-indigo-100/80">Define and manage salary component structures</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
          <TabsList className={`grid w-full max-w-md ${isAdmin ? "grid-cols-2" : "grid-cols-1"}`}>
            <TabsTrigger value="packages" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              Package Matrix
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="admin" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Administration
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="packages" className="mt-4">
            {roleLoading ? (
              <Card><CardContent className="py-12 text-center text-gray-400"><Loader className="h-5 w-5 animate-spin mx-auto" /></CardContent></Card>
            ) : (
              <PackageMatrixTab />
            )}
          </TabsContent>

          {isAdmin && (
            <TabsContent value="admin" className="mt-4">
              <AdminTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
