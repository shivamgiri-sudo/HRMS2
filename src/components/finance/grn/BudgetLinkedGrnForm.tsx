import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  FileCheck2,
  FilePlus2,
  FileText,
  IndianRupee,
  Landmark,
  Loader2,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WalletCards,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { calculateBudgetLine } from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

type GrnType = "vendor" | "imprest";
type WorkspaceStep = "proof" | "invoice" | "budget" | "validation" | "review";

type BudgetLine = {
  id: string;
  budget_id: string;
  budget_number: string;
  period_code: string;
  process_id: string | null;
  process_name: string | null;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  head: string;
  sub_head: string | null;
  item_name: string;
  unit: string;
  unit_rate: number;
  tax_treatment: "inclusive" | "exclusive" | "exempt" | "reverse_charge" | "non_gst";
  gst_rate: number;
  gst_type: "cgst_sgst" | "igst" | "none";
  recoverable_tax_pct: number;
  justification: string;
  available_quantity: number;
  available_gross_amount: number;
};

type GrnFormState = {
  grnType: GrnType;
  branchId: string;
  budgetLineId: string;
  vendorId: string;
  invoiceNumber: string;
  quantity: number;
  unitRate: number;
  billDate: string;
  servicePeriod: string;
  purchaseReference: string;
  paymentTermsDays: number;
  remarks: string;
};

type CreatedGrn = {
  id: string;
  grnNumber: string;
  attachmentUploaded: boolean;
  submitted: boolean;
};

type ValidationItem = {
  label: string;
  status: "pass" | "warn" | "block";
  detail: string;
};

const EMPTY_FORM: GrnFormState = {
  grnType: "vendor",
  branchId: "",
  budgetLineId: "",
  vendorId: "",
  invoiceNumber: "",
  quantity: 1,
  unitRate: 0,
  billDate: "",
  servicePeriod: "",
  purchaseReference: "",
  paymentTermsDays: 30,
  remarks: "",
};

const STEPS: Array<{ id: WorkspaceStep; label: string; helper: string; icon: typeof FileText }> = [
  { id: "proof", label: "Upload proof", helper: "Invoice or supporting document", icon: UploadCloud },
  { id: "invoice", label: "Invoice details", helper: "Party, date and references", icon: ReceiptText },
  { id: "budget", label: "Budget mapping", helper: "Approved line and attribution", icon: WalletCards },
  { id: "validation", label: "Smart validation", helper: "Budget, tax and document checks", icon: ShieldCheck },
  { id: "review", label: "Review & submit", helper: "Final financial impact", icon: FileCheck2 },
];

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "—";
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function decimal(value: number) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

function StepPill({ active, completed, children }: { active: boolean; completed: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-[11px] font-bold transition-all ${
        active
          ? "border-blue-200 bg-blue-600 text-white shadow-sm shadow-blue-200"
          : completed
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-white text-slate-400"
      }`}
    >
      {completed ? <Check className="h-3.5 w-3.5" /> : children}
    </span>
  );
}

function MetricCard({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "blue" | "emerald" | "amber" }) {
  const styles = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
  };
  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [created, setCreated] = useState<CreatedGrn | null>(null);
  const [activeStep, setActiveStep] = useState<WorkspaceStep>("proof");

  const period = form.billDate ? form.billDate.slice(0, 7) : "";

  const { data: branchResponse } = useQuery({
    queryKey: ["grn-budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const { data: vendorResponse } = useQuery({
    queryKey: ["grn-budget-vendors"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });

  const branches = unwrapList(branchResponse);
  const vendors = unwrapList(vendorResponse).filter(
    (vendor) => Number(vendor.is_active ?? vendor.active_status ?? 1) === 1
  );

  const { data: lineResponse, isLoading: linesLoading } = useQuery({
    queryKey: ["available-budget-lines", form.branchId, period],
    enabled: Boolean(form.branchId && period && !created),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(
          form.branchId
        )}&period=${encodeURIComponent(period)}`
      ),
  });

  const budgetLines = unwrapList(lineResponse) as BudgetLine[];
  const selected = budgetLines.find((line) => line.id === form.budgetLineId);
  const selectedVendor = vendors.find((vendor) => vendor.id === form.vendorId);
  const availableQuantity = Number(selected?.available_quantity ?? 0);
  const availableGross = Number(selected?.available_gross_amount ?? 0);

  const calculation = useMemo(
    () =>
      selected
        ? calculateBudgetLine({
            head: selected.head,
            itemName: selected.item_name,
            quantity: Number(form.quantity),
            unit: selected.unit,
            unitRate: Number(form.unitRate),
            taxTreatment: selected.tax_treatment,
            gstRate: Number(selected.gst_rate),
            gstType: selected.gst_type,
            recoverableTaxPct: Number(selected.recoverable_tax_pct),
            justification: selected.justification,
          })
        : null,
    [form.quantity, form.unitRate, selected]
  );

  const validations = useMemo<ValidationItem[]>(() => {
    const items: ValidationItem[] = [
      {
        label: "Supporting proof",
        status: file || created?.attachmentUploaded ? "pass" : "block",
        detail: file || created?.attachmentUploaded ? "Document attached" : "Upload is mandatory before submit",
      },
      {
        label: "Invoice identity",
        status: form.invoiceNumber.trim() ? "pass" : "warn",
        detail: form.invoiceNumber.trim() ? form.invoiceNumber : "Invoice number should be captured in remarks until backend field is added",
      },
      {
        label: "Approved budget",
        status: selected ? "pass" : "block",
        detail: selected ? `${selected.budget_number} · ${selected.head}` : "Select an active approved budget line",
      },
      {
        label: "Quantity control",
        status: !selected
          ? "warn"
          : Number(form.quantity) > 0 && Number(form.quantity) <= availableQuantity + 0.0001
            ? "pass"
            : "block",
        detail: selected ? `${decimal(form.quantity)} of ${decimal(availableQuantity)} ${selected.unit}` : "Awaiting budget selection",
      },
      {
        label: "Rate control",
        status: !selected
          ? "warn"
          : Number(form.unitRate) >= 0 && Number(form.unitRate) <= Number(selected.unit_rate) + 0.0001
            ? "pass"
            : "block",
        detail: selected ? `Approved maximum ${money(Number(selected.unit_rate))}` : "Awaiting budget selection",
      },
      {
        label: "Amount control",
        status: !calculation
          ? "warn"
          : calculation.gross <= availableGross + 0.01
            ? "pass"
            : "block",
        detail: calculation ? `${money(calculation.gross)} against ${money(availableGross)} available` : "Awaiting calculation",
      },
      {
        label: "Vendor control",
        status: form.grnType === "imprest" || selectedVendor ? "pass" : "block",
        detail: form.grnType === "imprest" ? "Not required for imprest" : selectedVendor ? selectedVendor.vendor_name ?? selectedVendor.name : "Select an active vendor",
      },
    ];
    return items;
  }, [availableGross, availableQuantity, calculation, created?.attachmentUploaded, file, form.grnType, form.invoiceNumber, form.quantity, form.unitRate, selected, selectedVendor]);

  const blockingCount = validations.filter((item) => item.status === "block").length;
  const passCount = validations.filter((item) => item.status === "pass").length;
  const readiness = Math.round((passCount / validations.length) * 100);
  const canSubmit = blockingCount === 0;

  function resetForm() {
    setForm(EMPTY_FORM);
    setFile(null);
    setCreated(null);
    setActiveStep("proof");
  }

  const saveMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!form.branchId) throw new Error("Select branch");
      if (!form.billDate) throw new Error("Bill / receipt date is required");
      if (!selected && !created) throw new Error("Select an approved budget line");
      if (submit && !canSubmit) throw new Error("Resolve all blocking validations before submission");
      if (form.grnType === "vendor" && !form.vendorId) {
        throw new Error("Select an active vendor from Vendor Master");
      }
      if (!created) {
        if (!selected) throw new Error("Select an approved budget line");
        if (Number(form.quantity) <= 0) throw new Error("Quantity must be greater than zero");
        if (Number(form.quantity) > availableQuantity + 0.0001) {
          throw new Error(`Quantity exceeds available budget quantity ${decimal(availableQuantity)}`);
        }
        if (Number(form.unitRate) > Number(selected.unit_rate) + 0.0001) {
          throw new Error("Unit rate exceeds the approved budget rate");
        }
        if ((calculation?.gross ?? 0) > availableGross + 0.01) {
          throw new Error("GRN total exceeds the available approved budget");
        }
      }

      let current = created;
      if (!current) {
        if (!selected) throw new Error("Select an approved budget line");
        const structuredRemarks = [
          form.invoiceNumber ? `Invoice No: ${form.invoiceNumber}` : null,
          form.servicePeriod ? `Service Period: ${form.servicePeriod}` : null,
          form.purchaseReference ? `PO/Contract Ref: ${form.purchaseReference}` : null,
          form.remarks || null,
        ]
          .filter(Boolean)
          .join(" | ");

        const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
          "/api/finance/grns",
          {
            grnType: form.grnType,
            branchId: form.branchId,
            budgetLineId: selected.id,
            processId: selected.process_id ?? undefined,
            costCentreId: selected.cost_centre_id ?? undefined,
            vendorId: form.grnType === "vendor" ? form.vendorId : undefined,
            quantity: Number(form.quantity),
            unitRate: Number(form.unitRate),
            billDate: form.billDate,
            paymentTermsDays: Number(form.paymentTermsDays),
            remarks: structuredRemarks || undefined,
            financialYear: financialYearFromPeriod(selected.period_code),
          }
        );
        current = { ...result, attachmentUploaded: false, submitted: false };
        setCreated(current);
      }

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        await hrmsApi.postForm(`/api/finance/grns/${current.id}/attachment`, formData);
        current = { ...current, attachmentUploaded: true };
        setCreated(current);
        setFile(null);
      }

      if (submit && !current.submitted) {
        await hrmsApi.post(`/api/finance/grns/${current.id}/submit`, {});
        current = { ...current, submitted: true };
        setCreated(current);
      }
      return current;
    },
    onSuccess: (result, submit) => {
      toast({
        title: submit ? "GRN submitted to Branch Head" : "GRN draft saved",
        description: result.grnNumber,
      });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
    },
    onError: (error: Error) =>
      toast({ title: "GRN could not be saved", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      {created && (
        <div className="flex flex-wrap items-center gap-4 rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-emerald-950">{created.grnNumber}</p>
            <p className="text-xs text-emerald-700">
              {created.submitted ? "Submitted to Branch Head for approval." : "Draft saved securely. Add proof and submit when ready."}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={resetForm}>
            <RotateCcw className="mr-2 h-4 w-4" /> Start another
          </Button>
        </div>
      )}

      <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-slate-950 text-white shadow-[0_30px_90px_rgba(15,23,42,0.24)]">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.45fr_1fr] lg:p-8">
          <div>
            <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Smart finance workspace
            </Badge>
            <h2 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
              Raise a budget-controlled GRN with live financial validation
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Upload proof, verify invoice details, select an active approved budget line and review tax, quantity, rate and availability before submission.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild className="bg-white text-slate-950 hover:bg-slate-100">
                <Link to="/finance/branch-budget">
                  <WalletCards className="mr-2 h-4 w-4" /> Open branch budget
                </Link>
              </Button>
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                <BadgeCheck className="h-4 w-4 text-emerald-400" /> Server-side controls remain authoritative
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="GRN readiness" value={`${readiness}%`} tone={canSubmit ? "emerald" : "amber"} />
            <MetricCard label="Blocking checks" value={String(blockingCount)} tone={blockingCount ? "amber" : "emerald"} />
            <MetricCard label="Available budget" value={money(availableGross)} tone="blue" />
            <MetricCard label="Current GRN" value={money(calculation?.gross ?? 0)} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="space-y-3 xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80 pb-4">
              <CardTitle className="text-sm">GRN workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {STEPS.map((step, index) => {
                const activeIndex = STEPS.findIndex((item) => item.id === activeStep);
                const completed = index < activeIndex;
                const Icon = step.icon;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveStep(step.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
                      activeStep === step.id
                        ? "border-blue-200 bg-blue-50 shadow-sm"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <StepPill active={activeStep === step.id} completed={completed}>{index + 1}</StepPill>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                        <Icon className="h-3.5 w-3.5 text-slate-500" /> {step.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{step.helper}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-blue-100 bg-blue-50/70 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-blue-950">
                <Sparkles className="h-4 w-4 text-blue-600" /> Smart guidance
              </div>
              <p className="mt-2 text-xs leading-5 text-blue-800">
                Values inherited from an approved budget are read-only wherever possible. The backend rechecks all amounts before saving.
              </p>
            </CardContent>
          </Card>
        </aside>

        <main className="space-y-5">
          <Card className="overflow-hidden rounded-[28px] border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FilePlus2 className="h-5 w-5 text-blue-700" /> Create budget-linked GRN
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-500">All mandatory financial fields are grouped by task for faster entry.</p>
                </div>
                <Badge variant="outline" className="rounded-full px-3 py-1">FY {financialYearFromPeriod(period)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-7 p-5 sm:p-6">
              <section className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white"><UploadCloud className="h-4 w-4" /></span>
                  <div><h3 className="text-sm font-bold text-slate-950">1. Proof and document</h3><p className="text-xs text-slate-500">Mandatory PDF or supported image</p></div>
                </div>
                <label className={`group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed p-6 text-center transition-all ${file || created?.attachmentUploaded ? "border-emerald-300 bg-emerald-50" : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/60"}`}>
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${file || created?.attachmentUploaded ? "bg-emerald-600 text-white" : "bg-white text-blue-700 shadow-sm"}`}>
                    {file || created?.attachmentUploaded ? <FileCheck2 className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-900">{created?.attachmentUploaded ? "Proof uploaded" : file?.name ?? "Drop invoice here or click to browse"}</p>
                  <p className="mt-1 text-xs text-slate-500">PDF, JPG, JPEG, PNG or WEBP · maximum 20 MB</p>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" disabled={created?.submitted} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                </label>
              </section>

              <section className="space-y-4 border-t border-slate-100 pt-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><ReceiptText className="h-4 w-4" /></span>
                  <div><h3 className="text-sm font-bold text-slate-950">2. Invoice and party details</h3><p className="text-xs text-slate-500">Capture references required by Finance and Accounts</p></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2"><Label>GRN type *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.grnType} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, grnType: event.target.value as GrnType, vendorId: event.target.value === "vendor" ? current.vendorId : "" }))}><option value="vendor">Vendor GRN</option><option value="imprest">Imprest GRN</option></select></div>
                  <div className="space-y-2"><Label>Branch *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.branchId} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value, budgetLineId: "" }))}><option value="">Select branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}</select></div>
                  <div className="space-y-2"><Label>Invoice / receipt date *</Label><Input type="date" value={form.billDate} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, billDate: event.target.value, budgetLineId: "" }))} /></div>
                  <div className="space-y-2"><Label>Invoice number *</Label><Input value={form.invoiceNumber} disabled={Boolean(created)} placeholder="e.g. INV-2026-0041" onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))} /></div>
                  {form.grnType === "vendor" && <div className="space-y-2 md:col-span-2"><Label>Vendor *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.vendorId} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, vendorId: event.target.value }))}><option value="">Select active vendor from Vendor Master</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}{vendor.vendor_name ?? vendor.name}</option>)}</select></div>}
                  <div className="space-y-2"><Label>Service period</Label><Input value={form.servicePeriod} disabled={Boolean(created)} placeholder="e.g. July 2026" onChange={(event) => setForm((current) => ({ ...current, servicePeriod: event.target.value }))} /></div>
                  <div className="space-y-2"><Label>PO / contract reference</Label><Input value={form.purchaseReference} disabled={Boolean(created)} placeholder="PO number or Not Applicable" onChange={(event) => setForm((current) => ({ ...current, purchaseReference: event.target.value }))} /></div>
                </div>
              </section>

              <section className="space-y-4 border-t border-slate-100 pt-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><WalletCards className="h-4 w-4" /></span>
                  <div><h3 className="text-sm font-bold text-slate-950">3. Approved budget mapping</h3><p className="text-xs text-slate-500">Inherited attribution, rate and tax controls</p></div>
                </div>
                <div className="space-y-2"><div className="flex items-center justify-between"><Label>Approved budget line *</Label><Button asChild variant="link" size="sm" className="h-auto p-0"><Link to="/finance/branch-budget">Open branch budget <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button></div><select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.budgetLineId} disabled={Boolean(created)} onChange={(event) => { const line = budgetLines.find((item) => item.id === event.target.value); const quantity = Math.min(1, Number(line?.available_quantity ?? 1)); setForm((current) => ({ ...current, budgetLineId: event.target.value, quantity, unitRate: Number(line?.unit_rate ?? 0), vendorId: line?.preferred_vendor_id ?? current.vendorId })); }}><option value="">{linesLoading ? "Loading approved lines…" : "Select approved budget line"}</option>{budgetLines.map((line) => <option key={line.id} value={line.id}>{line.budget_number} · {line.head} / {line.sub_head || "General"} · {line.item_name} · Qty {decimal(Number(line.available_quantity))} · {money(Number(line.available_gross_amount))}</option>)}</select></div>

                {form.branchId && period && !linesLoading && !budgetLines.length && !created && <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertCircle className="mt-0.5 h-4 w-4" /><div><p className="font-semibold">No active budget line is available</p><p className="mt-1 text-xs">Complete Branch Head, Finance Head and Accounts Head approval for {period}.</p></div></div>}

                {selected && !created && <div className="grid gap-4 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1"><p className="text-[11px] text-slate-500">Budget item</p><p className="text-sm font-semibold text-slate-900">{selected.head} / {selected.sub_head || "General"}</p><p className="text-xs text-slate-500">{selected.item_name}</p></div>
                  <div className="space-y-1"><p className="text-[11px] text-slate-500">Attribution</p><p className="text-sm font-semibold text-slate-900">{selected.cost_centre_name ?? "Branch/common"}</p><p className="text-xs text-slate-500">{selected.process_name ?? "Shared/all processes"}</p></div>
                  <div className="space-y-2"><Label>Quantity *</Label><Input type="number" min="0.0001" max={availableQuantity} step="0.0001" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Number(event.target.value) }))} /><p className="text-[11px] text-slate-500">Available {decimal(availableQuantity)} {selected.unit}</p></div>
                  <div className="space-y-2"><Label>Unit rate *</Label><Input type="number" min="0" max={Number(selected.unit_rate)} step="0.01" value={form.unitRate} onChange={(event) => setForm((current) => ({ ...current, unitRate: Number(event.target.value) }))} /><p className="text-[11px] text-slate-500">Approved maximum {money(Number(selected.unit_rate))}</p></div>
                </div>}
              </section>

              <section className="space-y-4 border-t border-slate-100 pt-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2"><Label>Payment terms *</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentTermsDays} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, paymentTermsDays: Number(event.target.value) }))}>{[0, 7, 15, 30, 45, 60, 90].map((days) => <option key={days} value={days}>{days === 0 ? "Immediate" : `${days} days`}</option>)}</select></div>
                  <div className="space-y-2"><Label>Due date</Label><Input readOnly value={form.billDate ? new Date(new Date(`${form.billDate}T00:00:00`).getTime() + form.paymentTermsDays * 86400000).toISOString().slice(0, 10) : ""} /></div>
                  <div className="space-y-2 md:col-span-2"><Label>Purpose, remarks and exception note</Label><Textarea className="min-h-24" value={form.remarks} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} placeholder="Business purpose, receipt details and any exception requiring approver attention" /></div>
                </div>
              </section>
            </CardContent>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 p-4 backdrop-blur-xl">
              <p className="text-xs text-slate-500">{canSubmit ? "All blocking validations are cleared." : `${blockingCount} blocking validation${blockingCount === 1 ? "" : "s"} must be resolved.`}</p>
              <div className="flex flex-wrap gap-3">
                {!created && <Button variant="outline" onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}><Save className="mr-2 h-4 w-4" /> Save draft</Button>}
                {!created?.submitted && <Button className="bg-blue-700 hover:bg-blue-800" onClick={() => saveMutation.mutate(true)} disabled={saveMutation.isPending || !canSubmit}>{saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{created ? "Upload & submit" : "Save & submit"}</Button>}
              </div>
            </div>
          </Card>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80"><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Validation centre</CardTitle></CardHeader>
            <CardContent className="space-y-2 p-4">
              {validations.map((item) => <div key={item.label} className={`rounded-2xl border p-3 ${item.status === "pass" ? "border-emerald-200 bg-emerald-50" : item.status === "warn" ? "border-amber-200 bg-amber-50" : "border-rose-200 bg-rose-50"}`}><div className="flex items-start gap-2.5">{item.status === "pass" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertCircle className={`mt-0.5 h-4 w-4 ${item.status === "warn" ? "text-amber-600" : "text-rose-600"}`} />}<div><p className="text-xs font-semibold text-slate-900">{item.label}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-600">{item.detail}</p></div></div></div>)}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[24px] border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80"><CardTitle className="flex items-center gap-2 text-sm"><CircleDollarSign className="h-4 w-4 text-blue-700" /> Financial summary</CardTitle></CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Without tax" value={money(calculation?.base ?? 0)} />
                <MetricCard label="Tax" value={money(calculation?.tax ?? 0)} tone="amber" />
                <MetricCard label="With tax" value={money(calculation?.gross ?? 0)} tone="blue" />
                <MetricCard label="P&L cost" value={money(calculation?.pnlCost ?? 0)} tone="emerald" />
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Available after this GRN</span><span className="font-bold text-slate-950">{money(Math.max(0, availableGross - (calculation?.gross ?? 0)))}</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${availableGross > 0 ? Math.min(100, ((calculation?.gross ?? 0) / availableGross) * 100) : 0}%` }} /></div>
              </div>
              {selected && <div className="space-y-3 rounded-2xl bg-slate-950 p-4 text-white"><div className="flex items-center gap-2 text-xs font-semibold"><PackageCheck className="h-4 w-4 text-emerald-400" /> Approved budget control</div><div className="grid grid-cols-2 gap-3 text-xs"><div><p className="text-slate-400">Budget</p><p className="mt-1 font-semibold">{selected.budget_number}</p></div><div><p className="text-slate-400">Tax</p><p className="mt-1 font-semibold">{selected.gst_rate}% · {selected.gst_type.replaceAll("_", " + ")}</p></div><div><p className="text-slate-400">Cost centre</p><p className="mt-1 font-semibold">{selected.cost_centre_name ?? "Branch/common"}</p></div><div><p className="text-slate-400">Process</p><p className="mt-1 font-semibold">{selected.process_name ?? "Shared"}</p></div></div></div>}
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-violet-200 bg-violet-50 shadow-sm"><CardContent className="p-5"><div className="flex items-center gap-2 text-sm font-bold text-violet-950"><Landmark className="h-4 w-4 text-violet-700" /> Approval path</div><div className="mt-4 space-y-3 text-xs">{["Branch Admin submits", "Branch Head reserves budget", "Finance Head consumes budget", form.grnType === "vendor" ? "Accounts Head dispatches payment" : "Imprest GRN closes"].map((label, index) => <div key={label} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white font-bold text-violet-700 shadow-sm">{index + 1}</span><span className="text-violet-900">{label}</span></div>)}</div></CardContent></Card>
        </aside>
      </div>
    </div>
  );
}
