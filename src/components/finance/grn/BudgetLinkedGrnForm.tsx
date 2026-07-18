import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  FileCheck2,
  FilePlus2,
  FileSearch,
  FileText,
  IndianRupee,
  Landmark,
  Loader2,
  PackageCheck,
  Plus,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Save,
  ScanLine,
  Send,
  ShieldCheck,
  Sparkles,
  Split,
  Trash2,
  UploadCloud,
  WalletCards,
  WandSparkles,
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

type AllocationDraft = {
  key: string;
  budgetLineId: string;
  quantity: number;
  unitRate: number;
  remarks: string;
};

type GrnFormState = {
  grnType: GrnType;
  branchId: string;
  vendorId: string;
  invoiceNumber: string;
  billDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  purchaseReference: string;
  vendorGstin: string;
  placeOfSupply: string;
  invoiceTotal: number;
  otherCharges: number;
  roundOffAmount: number;
  paymentTermsDays: number;
  remarks: string;
};

type CreatedGrn = {
  id: string;
  grnNumber: string;
  submitted: boolean;
};

type WorkspaceDocument = {
  id: string;
  original_name: string;
  mime_type: string;
  extraction_status: string;
  is_primary: number;
};

type WorkspaceValidation = {
  id: string;
  validation_code: string;
  validation_status: "passed" | "warning" | "failed" | "overridden";
  is_blocking: number;
  message: string;
};

type WorkspacePayload = {
  grn: Record<string, any>;
  allocations: Array<Record<string, any>>;
  documents: WorkspaceDocument[];
  extractions: Array<Record<string, any>>;
  validations: WorkspaceValidation[];
  duplicates: Array<Record<string, any>>;
};

const EMPTY_FORM: GrnFormState = {
  grnType: "vendor",
  branchId: "",
  vendorId: "",
  invoiceNumber: "",
  billDate: "",
  servicePeriodStart: "",
  servicePeriodEnd: "",
  purchaseReference: "",
  vendorGstin: "",
  placeOfSupply: "",
  invoiceTotal: 0,
  otherCharges: 0,
  roundOffAmount: 0,
  paymentTermsDays: 30,
  remarks: "",
};

const STEPS: Array<{
  id: WorkspaceStep;
  label: string;
  helper: string;
  icon: typeof FileText;
}> = [
  { id: "proof", label: "Upload proof", helper: "Invoice and supporting documents", icon: UploadCloud },
  { id: "invoice", label: "Invoice details", helper: "Identity, tax and commercial fields", icon: ReceiptText },
  { id: "budget", label: "Cost allocation", helper: "Split across approved budget lines", icon: Split },
  { id: "validation", label: "Smart validation", helper: "Document, duplicate and budget checks", icon: ShieldCheck },
  { id: "review", label: "Review & submit", helper: "Final reconciliation and impact", icon: FileCheck2 },
];

function newAllocation(): AllocationDraft {
  return {
    key: crypto.randomUUID(),
    budgetLineId: "",
    quantity: 1,
    unitRate: 0,
    remarks: "",
  };
}

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "—";
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function addDays(dateString: string, days: number) {
  if (!dateString) return "—";
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function decimal(value: number, digits = 4) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
  });
}

function unwrapList(value: any): any[] {
  return value?.data ?? value ?? [];
}

function unwrapData<T>(value: any): T {
  return (value?.data ?? value) as T;
}

function parseJson(value: unknown) {
  if (!value) return null;
  if (typeof value === "object") return value as Record<string, any>;
  try {
    return JSON.parse(String(value)) as Record<string, any>;
  } catch {
    return null;
  }
}

function StepPill({
  active,
  completed,
  children,
}: {
  active: boolean;
  completed: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-[11px] font-bold transition-all ${
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

function MetricCard({
  label,
  value,
  helper,
  tone = "slate",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const styles = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/70",
    emerald: "border-emerald-200 bg-emerald-50/70",
    amber: "border-amber-200 bg-amber-50/70",
    rose: "border-rose-200 bg-rose-50/70",
  };
  return (
    <div className={`rounded-2xl border p-4 ${styles[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-lg font-bold text-slate-950">{value}</p>
      {helper && <p className="mt-1 text-[11px] text-slate-500">{helper}</p>}
    </div>
  );
}

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-xs font-semibold text-slate-700">
      {children} <span className="text-rose-500">*</span>
    </Label>
  );
}

function statusTone(status: string) {
  if (["passed", "completed", "matched"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["warning", "manual_review", "near_match", "pending", "processing"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([newAllocation()]);
  const [files, setFiles] = useState<File[]>([]);
  const [created, setCreated] = useState<CreatedGrn | null>(null);
  const [activeStep, setActiveStep] = useState<WorkspaceStep>("proof");
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [extractedFields, setExtractedFields] = useState<Record<string, any> | null>(null);

  const period = form.billDate ? form.billDate.slice(0, 7) : "";

  const { data: branchResponse } = useQuery({
    queryKey: ["grn-budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });
  const { data: vendorResponse } = useQuery({
    queryKey: ["grn-budget-vendors"],
    queryFn: () => hrmsApi.get<any>("/api/erp/vendors?limit=500"),
  });

  const branches = unwrapList(branchResponse).filter(
    (branch) => Number(branch.active_status ?? 1) === 1
  );
  const vendors = unwrapList(vendorResponse).filter(
    (vendor) => Number(vendor.is_active ?? vendor.active_status ?? 1) === 1
  );

  const { data: lineResponse, isLoading: linesLoading } = useQuery({
    queryKey: ["available-budget-lines", form.branchId, period],
    enabled: Boolean(form.branchId && period && !created?.submitted),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(
          form.branchId
        )}&period=${encodeURIComponent(period)}`
      ),
  });
  const budgetLines = unwrapList(lineResponse) as BudgetLine[];

  const workspaceQuery = useQuery({
    queryKey: ["smart-grn-workspace", created?.id],
    enabled: Boolean(created?.id),
    queryFn: () => hrmsApi.get<any>(`/api/finance/grns/${created!.id}/workspace`),
  });
  const workspace = workspaceQuery.data
    ? unwrapData<WorkspacePayload>(workspaceQuery.data)
    : null;

  const latestExtraction = workspace?.extractions?.[0];
  const serverExtractedFields = parseJson(latestExtraction?.extracted_fields_json);
  const effectiveExtractedFields = extractedFields ?? serverExtractedFields;
  const selectedVendor = vendors.find((vendor) => vendor.id === form.vendorId);

  const calculatedAllocations = useMemo(
    () =>
      allocations.map((allocation) => {
        const line = budgetLines.find((item) => item.id === allocation.budgetLineId);
        const calculation = line
          ? calculateBudgetLine({
              head: line.head,
              subHead: line.sub_head,
              itemName: line.item_name,
              quantity: Number(allocation.quantity),
              unit: line.unit,
              unitRate: Number(allocation.unitRate),
              taxTreatment: line.tax_treatment,
              gstRate: Number(line.gst_rate),
              gstType: line.gst_type,
              recoverableTaxPct: Number(line.recoverable_tax_pct),
              justification: line.justification,
            })
          : null;
        return { allocation, line, calculation };
      }),
    [allocations, budgetLines]
  );

  const totals = useMemo(
    () =>
      calculatedAllocations.reduce(
        (sum, item) => {
          sum.base += Number(item.calculation?.base ?? 0);
          sum.tax += Number(item.calculation?.tax ?? 0);
          sum.gross += Number(item.calculation?.gross ?? 0);
          sum.pnl += Number(item.calculation?.pnlCost ?? 0);
          return sum;
        },
        { base: 0, tax: 0, gross: 0, pnl: 0 }
      ),
    [calculatedAllocations]
  );

  const allocationDifference = Math.round((totals.gross - Number(form.invoiceTotal || 0)) * 100) / 100;
  const allocationReady =
    allocations.length > 0
    && allocations.every((item) => item.budgetLineId && Number(item.quantity) > 0 && Number(item.unitRate) >= 0)
    && Number(form.invoiceTotal) > 0
    && Math.abs(allocationDifference) <= 0.01;

  const localValidation = useMemo(() => {
    const proofPresent = files.length > 0 || Boolean(workspace?.documents?.length);
    const mandatoryInvoiceFields = Boolean(
      form.branchId
      && form.billDate
      && form.invoiceNumber.trim()
      && form.servicePeriodStart
      && form.servicePeriodEnd
      && form.purchaseReference.trim()
      && form.placeOfSupply.trim()
      && Number(form.invoiceTotal) > 0
      && (form.grnType === "imprest" || (form.vendorId && form.vendorGstin.trim()))
    );
    return {
      proofPresent,
      mandatoryInvoiceFields,
      allocationReady,
      vendorReady: form.grnType === "imprest" || Boolean(selectedVendor),
    };
  }, [allocationReady, files.length, form, selectedVendor, workspace?.documents?.length]);

  const localPassCount = Object.values(localValidation).filter(Boolean).length;
  const localReadiness = Math.round((localPassCount / Object.keys(localValidation).length) * 100);
  const serverBlocking = (workspace?.validations ?? []).filter(
    (item) => Number(item.is_blocking) === 1 && item.validation_status === "failed"
  );
  const readiness = workspace?.grn?.validation_score != null
    ? Number(workspace.grn.validation_score)
    : localReadiness;
  const canSubmit =
    localValidation.proofPresent
    && localValidation.mandatoryInvoiceFields
    && localValidation.allocationReady
    && localValidation.vendorReady
    && serverBlocking.length === 0;

  const stepCompleted: Record<WorkspaceStep, boolean> = {
    proof: localValidation.proofPresent,
    invoice: localValidation.mandatoryInvoiceFields,
    budget: localValidation.allocationReady,
    validation: workspace ? serverBlocking.length === 0 && Boolean(workspace.validations?.length) : false,
    review: Boolean(created?.submitted),
  };

  function updateAllocation(key: string, patch: Partial<AllocationDraft>) {
    setAllocations((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }

  function addAllocation(copyFrom?: AllocationDraft) {
    setAllocations((current) => [
      ...current,
      copyFrom
        ? { ...copyFrom, key: crypto.randomUUID(), quantity: 1 }
        : newAllocation(),
    ]);
  }

  function removeAllocation(key: string) {
    setAllocations((current) =>
      current.length === 1 ? current : current.filter((item) => item.key !== key)
    );
  }

  function autoBalanceLastRow() {
    const last = allocations[allocations.length - 1];
    const line = budgetLines.find((item) => item.id === last.budgetLineId);
    if (!line || Number(last.quantity) <= 0 || Number(form.invoiceTotal) <= 0) {
      toast({
        title: "Select the final budget line first",
        description: "Enter invoice total and quantity before auto-balancing.",
        variant: "destructive",
      });
      return;
    }
    const otherGross = calculatedAllocations
      .filter((item) => item.allocation.key !== last.key)
      .reduce((sum, item) => sum + Number(item.calculation?.gross ?? 0), 0);
    const remainingGross = Math.round((Number(form.invoiceTotal) - otherGross) * 100) / 100;
    if (remainingGross <= 0) {
      toast({
        title: "No positive balance remains",
        description: "Reduce earlier allocation rows before balancing the final row.",
        variant: "destructive",
      });
      return;
    }
    const taxFactor = ["exclusive", "reverse_charge"].includes(line.tax_treatment)
      ? 1 + Number(line.gst_rate) / 100
      : 1;
    const rate = remainingGross / (Number(last.quantity) * taxFactor);
    if (rate > Number(line.unit_rate) + 0.0001) {
      toast({
        title: "Balance exceeds the approved rate",
        description: `Required rate ${money(rate)} is higher than ${money(Number(line.unit_rate))}.`,
        variant: "destructive",
      });
      return;
    }
    updateAllocation(last.key, { unitRate: Math.max(0, Number(rate.toFixed(4))) });
  }

  function distributeEqually() {
    if (!allocations.every((item) => item.budgetLineId) || Number(form.invoiceTotal) <= 0) {
      toast({
        title: "Complete budget selections",
        description: "Select a budget line in every row and enter the invoice total.",
        variant: "destructive",
      });
      return;
    }
    const grossPerRow = Number(form.invoiceTotal) / allocations.length;
    setAllocations((current) =>
      current.map((allocation) => {
        const line = budgetLines.find((item) => item.id === allocation.budgetLineId)!;
        const taxFactor = ["exclusive", "reverse_charge"].includes(line.tax_treatment)
          ? 1 + Number(line.gst_rate) / 100
          : 1;
        const rate = grossPerRow / (Math.max(Number(allocation.quantity), 0.0001) * taxFactor);
        return {
          ...allocation,
          unitRate: Math.min(Number(line.unit_rate), Number(rate.toFixed(4))),
        };
      })
    );
    window.setTimeout(autoBalanceLastRow, 0);
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setAllocations([newAllocation()]);
    setFiles([]);
    setCreated(null);
    setActiveStep("proof");
    setExtractedFields(null);
  }

  function applyExtractedFields(fields: Record<string, any>) {
    setForm((current) => ({
      ...current,
      invoiceNumber: String(fields.invoiceNumber ?? current.invoiceNumber ?? ""),
      billDate: String(fields.invoiceDate ?? current.billDate ?? ""),
      servicePeriodStart: String(fields.servicePeriodStart ?? current.servicePeriodStart ?? ""),
      servicePeriodEnd: String(fields.servicePeriodEnd ?? current.servicePeriodEnd ?? ""),
      purchaseReference: String(fields.purchaseReference ?? current.purchaseReference ?? "NA"),
      vendorGstin: String(fields.vendorGstin ?? current.vendorGstin ?? ""),
      placeOfSupply: String(fields.placeOfSupply ?? current.placeOfSupply ?? ""),
      invoiceTotal: Number(fields.grossAmount ?? fields.invoiceTotal ?? current.invoiceTotal ?? 0),
      otherCharges: Number(fields.otherCharges ?? current.otherCharges ?? 0),
      roundOffAmount: Number(fields.roundOffAmount ?? current.roundOffAmount ?? 0),
      paymentTermsDays: Number(fields.paymentTermsDays ?? current.paymentTermsDays ?? 30),
    }));
    setExtractedFields(fields);
    setActiveStep("invoice");
  }

  const persistMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      if (!form.branchId) throw new Error("Branch is mandatory");
      if (!form.billDate) throw new Error("Invoice / receipt date is mandatory");
      if (!form.invoiceNumber.trim()) throw new Error("Invoice / receipt number is mandatory");
      if (!form.servicePeriodStart || !form.servicePeriodEnd) {
        throw new Error("Service period start and end are mandatory");
      }
      if (!form.purchaseReference.trim()) throw new Error("PO / contract reference is mandatory; use NA when not applicable");
      if (!form.placeOfSupply.trim()) throw new Error("Place of supply is mandatory");
      if (form.grnType === "vendor" && !form.vendorId) throw new Error("Active Vendor Master selection is mandatory");
      if (form.grnType === "vendor" && !form.vendorGstin.trim()) throw new Error("Vendor GSTIN is mandatory; use NA only for a valid non-GST vendor");
      if (!allocationReady) throw new Error(`Cost-centre split must match the invoice total exactly. Difference ${money(allocationDifference)}`);
      if (submit && !(files.length || workspace?.documents?.length)) {
        throw new Error("At least one invoice or supporting proof is mandatory");
      }

      const first = calculatedAllocations[0];
      if (!first?.line) throw new Error("Select an approved budget line");
      let current = created;
      if (!current) {
        const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
          "/api/finance/grns",
          {
            grnType: form.grnType,
            branchId: form.branchId,
            budgetLineId: first.line.id,
            processId: first.line.process_id ?? undefined,
            costCentreId: first.line.cost_centre_id ?? undefined,
            vendorId: form.grnType === "vendor" ? form.vendorId : undefined,
            quantity: Number(first.allocation.quantity),
            unitRate: Number(first.allocation.unitRate),
            billDate: form.billDate,
            paymentTermsDays: Number(form.paymentTermsDays),
            remarks: form.remarks || undefined,
            financialYear: financialYearFromPeriod(first.line.period_code),
          }
        );
        current = { ...result, submitted: false };
        setCreated(current);
      }

      await hrmsApi.put(`/api/finance/grns/${current.id}/allocations`, {
        invoiceNumber: form.invoiceNumber,
        servicePeriodStart: form.servicePeriodStart,
        servicePeriodEnd: form.servicePeriodEnd,
        purchaseReference: form.purchaseReference,
        vendorGstin: form.vendorGstin,
        placeOfSupply: form.placeOfSupply,
        otherCharges: Number(form.otherCharges),
        roundOffAmount: Number(form.roundOffAmount),
        declaredInvoiceTotal: Number(form.invoiceTotal),
        allocations: allocations.map((item) => ({
          budgetLineId: item.budgetLineId,
          quantity: Number(item.quantity),
          unitRate: Number(item.unitRate),
          remarks: item.remarks || undefined,
        })),
      });

      let uploadedDocuments: WorkspaceDocument[] = [];
      if (files.length) {
        const body = new FormData();
        files.forEach((file) => body.append("files", file));
        body.append("documentType", "invoice");
        body.append("primaryIndex", "0");
        const uploadResponse = await hrmsApi.postForm<any>(
          `/api/finance/grns/${current.id}/documents`,
          body
        );
        uploadedDocuments = unwrapList(uploadResponse) as WorkspaceDocument[];
        setFiles([]);
      }

      if (autoAnalyze && uploadedDocuments[0]?.id) {
        try {
          const analysisResponse = await hrmsApi.post<any>(
            `/api/finance/grns/${current.id}/documents/${uploadedDocuments[0].id}/analyze`,
            {}
          );
          const analysis = unwrapData<any>(analysisResponse);
          if (analysis?.fields) setExtractedFields(analysis.fields);
        } catch (analysisError) {
          toast({
            title: "Draft saved; automated extraction needs review",
            description: analysisError instanceof Error ? analysisError.message : "Document analysis was unavailable.",
          });
        }
      }

      await hrmsApi.post(`/api/finance/grns/${current.id}/revalidate`, {});
      if (submit && !current.submitted) {
        await hrmsApi.post(`/api/finance/grns/${current.id}/submit`, {
          remarks: form.remarks || undefined,
        });
        current = { ...current, submitted: true };
        setCreated(current);
      }
      return current;
    },
    onSuccess: (result, submit) => {
      toast({
        title: submit ? "Smart GRN submitted to Branch Head" : "Smart GRN draft saved",
        description: result.grnNumber,
      });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
      void queryClient.invalidateQueries({ queryKey: ["smart-grn-workspace", result.id] });
      setActiveStep(submit ? "review" : "validation");
    },
    onError: (error: Error) =>
      toast({
        title: "GRN could not be saved",
        description: error.message,
        variant: "destructive",
      }),
  });

  const analyzeMutation = useMutation({
    mutationFn: async (documentId: string) => {
      if (!created) throw new Error("Save the draft first");
      const response = await hrmsApi.post<any>(
        `/api/finance/grns/${created.id}/documents/${documentId}/analyze`,
        {}
      );
      return unwrapData<any>(response);
    },
    onSuccess: (data) => {
      if (data?.fields) setExtractedFields(data.fields);
      toast({
        title: data?.status === "completed" ? "Invoice extraction completed" : "Manual document verification required",
        description: data?.confidence != null ? `Confidence ${data.confidence}%` : "Review the invoice alongside the form.",
      });
      void workspaceQuery.refetch();
    },
    onError: (error: Error) =>
      toast({ title: "Document analysis failed", description: error.message, variant: "destructive" }),
  });

  const confirmExtractionMutation = useMutation({
    mutationFn: async () => {
      if (!created || !effectiveExtractedFields) throw new Error("No extracted fields are available");
      return hrmsApi.post(`/api/finance/grns/${created.id}/extraction/confirm`, {
        fields: effectiveExtractedFields,
      });
    },
    onSuccess: () => {
      toast({ title: "Extracted fields confirmed and audited" });
      void workspaceQuery.refetch();
    },
    onError: (error: Error) =>
      toast({ title: "Extraction confirmation failed", description: error.message, variant: "destructive" }),
  });

  const revalidateMutation = useMutation({
    mutationFn: async () => {
      if (!created) throw new Error("Save the draft before server validation");
      return hrmsApi.post(`/api/finance/grns/${created.id}/revalidate`, {});
    },
    onSuccess: () => {
      toast({ title: "Financial controls revalidated" });
      void workspaceQuery.refetch();
    },
    onError: (error: Error) =>
      toast({ title: "Validation failed", description: error.message, variant: "destructive" }),
  });

  const primaryDocument = workspace?.documents?.find((item) => Number(item.is_primary) === 1)
    ?? workspace?.documents?.[0];

  return (
    <div className="mx-auto max-w-[1680px] space-y-6">
      <section className="relative overflow-hidden rounded-[30px] border border-slate-800 bg-slate-950 text-white shadow-[0_30px_90px_rgba(15,23,42,0.24)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.30),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.20),_transparent_30%)]" />
        <div className="relative grid gap-6 p-6 lg:grid-cols-[1.45fr_1fr] lg:p-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-white/15 bg-white/10 text-white hover:bg-white/10">
                <Sparkles className="mr-1 h-3.5 w-3.5" /> Smart Finance Workspace
              </Badge>
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10">
                Budget controlled
              </Badge>
              <Badge className="border-blue-400/30 bg-blue-400/10 text-blue-200 hover:bg-blue-400/10">
                Multi-cost-centre ready
              </Badge>
            </div>
            <h2 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl">
              Intelligent GRN Control Room
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              Upload the invoice, verify extracted facts, allocate the exact amount across approved budget lines and submit only after every financial control is reconciled.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Readiness" value={`${readiness.toFixed(0)}%`} helper="Server score after draft save" tone="emerald" />
            <MetricCard label="Invoice total" value={money(form.invoiceTotal)} helper="Declared payable amount" tone="blue" />
            <MetricCard label="Allocation difference" value={money(allocationDifference)} helper="Must be exactly ₹0.00" tone={Math.abs(allocationDifference) <= 0.01 ? "emerald" : "rose"} />
            <MetricCard label="Documents" value={String((workspace?.documents?.length ?? 0) + files.length)} helper="Proof and supporting records" tone="amber" />
          </div>
        </div>
      </section>

      {created && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-emerald-950">{created.grnNumber}</p>
            <p className="text-xs text-emerald-700">
              {created.submitted
                ? "Submitted to the Branch Head with allocation-aware budget controls."
                : "Draft saved. Continue document review, allocation or validation on the same GRN."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={resetForm}>
            <RotateCcw className="mr-2 h-4 w-4" /> Start another
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_330px]">
        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80 pb-4">
              <CardTitle className="text-sm">Five-step workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                const active = activeStep === step.id;
                return (
                  <button
                    type="button"
                    key={step.id}
                    onClick={() => setActiveStep(step.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all ${
                      active
                        ? "border-blue-200 bg-blue-50 shadow-sm"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <StepPill active={active} completed={stepCompleted[step.id]}>
                      {index + 1}
                    </StepPill>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${active ? "text-blue-700" : "text-slate-400"}`} />
                        <p className={`text-xs font-semibold ${active ? "text-blue-950" : "text-slate-700"}`}>
                          {step.label}
                        </p>
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">{step.helper}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </button>
                );
              })}
            </CardContent>
          </Card>

          <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5">
            <div className="flex items-center gap-2 text-blue-900">
              <WandSparkles className="h-4 w-4" />
              <p className="text-xs font-bold">Productivity shortcuts</p>
            </div>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-blue-800/80">
              <li>• Duplicate an allocation row, then change only the cost centre.</li>
              <li>• Use Auto-balance to make the final split exactly match the invoice.</li>
              <li>• Save once, then analyze the uploaded invoice and apply extracted values.</li>
            </ul>
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {activeStep === "proof" && (
            <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-blue-50/80 to-white">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UploadCloud className="h-5 w-5 text-blue-700" /> Mandatory proof and document intelligence
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <label className="group flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-[26px] border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 group-hover:ring-blue-200">
                    <UploadCloud className="h-6 w-6 text-blue-700" />
                  </div>
                  <p className="mt-4 text-sm font-bold text-slate-900">Drop invoice and supporting documents here</p>
                  <p className="mt-2 max-w-lg text-xs leading-5 text-slate-500">
                    PDF, JPG, PNG or WEBP. Up to 10 files, 20 MB each. The first document is treated as the primary invoice.
                  </p>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    disabled={created?.submitted}
                    onChange={(event) => {
                      const selected = Array.from(event.target.files ?? []);
                      setFiles((current) => [...current, ...selected].slice(0, 10));
                      event.target.value = "";
                    }}
                  />
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  {files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                      <FileText className="h-5 w-5 text-blue-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-800">{file.name}</p>
                        <p className="text-[10px] text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB · Pending upload</p>
                      </div>
                      <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {(workspace?.documents ?? []).map((document) => (
                    <div key={document.id} className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                      <FileCheck2 className="h-5 w-5 text-emerald-600" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-emerald-950">{document.original_name}</p>
                        <p className="text-[10px] text-emerald-700">Uploaded · {document.extraction_status.replaceAll("_", " ")}</p>
                      </div>
                      <Badge className={`border text-[10px] ${statusTone(document.extraction_status)}`}>
                        {Number(document.is_primary) === 1 ? "Primary" : "Support"}
                      </Badge>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)} />
                    Analyze the primary invoice automatically after upload
                  </label>
                  {primaryDocument && (
                    <Button type="button" variant="outline" size="sm" disabled={analyzeMutation.isPending} onClick={() => analyzeMutation.mutate(primaryDocument.id)}>
                      {analyzeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
                      Analyze invoice
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {activeStep === "invoice" && (
            <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-indigo-50/80 to-white">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ReceiptText className="h-5 w-5 text-indigo-700" /> Invoice identity and tax facts
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5 p-6 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <RequiredLabel>GRN type</RequiredLabel>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.grnType} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, grnType: event.target.value as GrnType, vendorId: event.target.value === "vendor" ? current.vendorId : "", vendorGstin: event.target.value === "vendor" ? current.vendorGstin : "NA" }))}>
                    <option value="vendor">Vendor GRN</option>
                    <option value="imprest">Imprest / reimbursement GRN</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Branch</RequiredLabel>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.branchId} disabled={Boolean(created)} onChange={(event) => { setForm((current) => ({ ...current, branchId: event.target.value })); setAllocations([newAllocation()]); }}>
                    <option value="">Select assigned branch</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name ?? branch.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Invoice / receipt date</RequiredLabel>
                  <Input type="date" value={form.billDate} disabled={Boolean(created)} onChange={(event) => { setForm((current) => ({ ...current, billDate: event.target.value })); setAllocations([newAllocation()]); }} />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Invoice / receipt number</RequiredLabel>
                  <Input value={form.invoiceNumber} onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))} placeholder="Exact number printed on proof" />
                </div>
                {form.grnType === "vendor" && (
                  <div className="space-y-2 md:col-span-2">
                    <RequiredLabel>Vendor Master</RequiredLabel>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.vendorId} disabled={Boolean(created)} onChange={(event) => setForm((current) => ({ ...current, vendorId: event.target.value }))}>
                      <option value="">Select active vendor</option>
                      {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.vendor_code ? `${vendor.vendor_code} · ` : ""}{vendor.vendor_name ?? vendor.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <RequiredLabel>Vendor GSTIN</RequiredLabel>
                  <Input value={form.vendorGstin} onChange={(event) => setForm((current) => ({ ...current, vendorGstin: event.target.value.toUpperCase() }))} placeholder="GSTIN or NA" />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Place of supply</RequiredLabel>
                  <Input value={form.placeOfSupply} onChange={(event) => setForm((current) => ({ ...current, placeOfSupply: event.target.value }))} placeholder="State / place" />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>PO / contract reference</RequiredLabel>
                  <Input value={form.purchaseReference} onChange={(event) => setForm((current) => ({ ...current, purchaseReference: event.target.value }))} placeholder="Reference or NA" />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Service period start</RequiredLabel>
                  <Input type="date" value={form.servicePeriodStart} onChange={(event) => setForm((current) => ({ ...current, servicePeriodStart: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Service period end</RequiredLabel>
                  <Input type="date" value={form.servicePeriodEnd} onChange={(event) => setForm((current) => ({ ...current, servicePeriodEnd: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Invoice total including tax</RequiredLabel>
                  <Input type="number" min="0.01" step="0.01" value={form.invoiceTotal || ""} onChange={(event) => setForm((current) => ({ ...current, invoiceTotal: Number(event.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <RequiredLabel>Payment terms</RequiredLabel>
                  <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentTermsDays} onChange={(event) => setForm((current) => ({ ...current, paymentTermsDays: Number(event.target.value) }))}>
                    {[0, 7, 15, 30, 45, 60, 90].map((days) => <option key={days} value={days}>{days === 0 ? "Immediate" : `${days} days`}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Other charges</Label>
                  <Input type="number" step="0.01" value={form.otherCharges} onChange={(event) => setForm((current) => ({ ...current, otherCharges: Number(event.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label>Round-off amount</Label>
                  <Input type="number" step="0.01" value={form.roundOffAmount} onChange={(event) => setForm((current) => ({ ...current, roundOffAmount: Number(event.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label>Financial year</Label>
                  <Input value={financialYearFromPeriod(period)} readOnly />
                </div>
                <div className="space-y-2">
                  <Label>Calculated due date</Label>
                  <Input value={addDays(form.billDate, form.paymentTermsDays)} readOnly />
                </div>
                <div className="space-y-2 md:col-span-2 xl:col-span-3">
                  <RequiredLabel>Purpose, receipt details and exception remarks</RequiredLabel>
                  <Textarea className="min-h-24" value={form.remarks} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} placeholder="Explain the business purpose, receipt/service confirmation and any exception." />
                </div>

                {effectiveExtractedFields && (
                  <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 md:col-span-2 xl:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-xs font-bold text-violet-950"><FileSearch className="h-4 w-4" /> Extracted invoice facts</p>
                        <p className="mt-1 text-[11px] text-violet-700">Review before applying. Manual changes remain fully auditable.</p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => applyExtractedFields(effectiveExtractedFields)}>Apply extracted values</Button>
                        {created && <Button type="button" size="sm" disabled={confirmExtractionMutation.isPending} onClick={() => confirmExtractionMutation.mutate()}>{confirmExtractionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}Confirm & audit</Button>}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ["Vendor", effectiveExtractedFields.vendorName],
                        ["Invoice", effectiveExtractedFields.invoiceNumber],
                        ["Date", effectiveExtractedFields.invoiceDate],
                        ["Gross", effectiveExtractedFields.grossAmount != null ? money(Number(effectiveExtractedFields.grossAmount)) : "—"],
                        ["GSTIN", effectiveExtractedFields.vendorGstin],
                        ["Tax", effectiveExtractedFields.taxAmount != null ? money(Number(effectiveExtractedFields.taxAmount)) : "—"],
                        ["Confidence", effectiveExtractedFields.confidence != null ? `${effectiveExtractedFields.confidence}%` : "—"],
                        ["PO / Contract", effectiveExtractedFields.purchaseReference],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white/80 p-3"><p className="text-[10px] uppercase tracking-wide text-violet-500">{label}</p><p className="mt-1 truncate text-xs font-semibold text-violet-950">{String(value ?? "—")}</p></div>)}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {activeStep === "budget" && (
            <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/80 to-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base"><Split className="h-5 w-5 text-emerald-700" /> Multi-cost-centre allocation</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={distributeEqually}><Calculator className="mr-2 h-4 w-4" />Equal split</Button>
                    <Button type="button" variant="outline" size="sm" onClick={autoBalanceLastRow}><WandSparkles className="mr-2 h-4 w-4" />Auto-balance last</Button>
                    <Button type="button" size="sm" onClick={() => addAllocation()}><Plus className="mr-2 h-4 w-4" />Add allocation</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                {!form.branchId || !period ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Select Branch and Invoice Date first to load active approved budget lines.</div>
                ) : linesLoading ? (
                  <div className="flex items-center justify-center py-16 text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading active budgets…</div>
                ) : !budgetLines.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">No active approved budget line is available for {period}. Complete Branch Head, Finance Head and Accounts Head approval first.</div>
                ) : (
                  <div className="space-y-4">
                    {calculatedAllocations.map(({ allocation, line, calculation }, index) => (
                      <div key={allocation.key} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-sm font-bold text-emerald-700">{index + 1}</div>
                            <div><p className="text-xs font-bold text-slate-900">Allocation row {index + 1}</p><p className="text-[10px] text-slate-500">Every row is checked independently against approved quantity, rate and gross balance.</p></div>
                          </div>
                          <div className="flex gap-1">
                            <button type="button" title="Duplicate row" onClick={() => addAllocation(allocation)} className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-700"><Copy className="h-4 w-4" /></button>
                            <button type="button" title="Remove row" disabled={allocations.length === 1} onClick={() => removeAllocation(allocation.key)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-4 lg:grid-cols-12">
                          <div className="space-y-2 lg:col-span-6">
                            <RequiredLabel>Approved budget line</RequiredLabel>
                            <select className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={allocation.budgetLineId} onChange={(event) => { const selectedLine = budgetLines.find((item) => item.id === event.target.value); updateAllocation(allocation.key, { budgetLineId: event.target.value, quantity: Math.min(1, Number(selectedLine?.available_quantity ?? 1)), unitRate: Number(selectedLine?.unit_rate ?? 0) }); }}>
                              <option value="">Select approved budget line</option>
                              {budgetLines.map((item) => <option key={item.id} value={item.id}>{item.budget_number} · {item.head} / {item.sub_head || "General"} · {item.item_name} · {item.cost_centre_name ?? "Branch common"} · {money(Number(item.available_gross_amount))}</option>)}
                            </select>
                          </div>
                          <div className="space-y-2 lg:col-span-2">
                            <RequiredLabel>Quantity</RequiredLabel>
                            <Input type="number" min="0.0001" step="0.0001" max={line ? Number(line.available_quantity) : undefined} value={allocation.quantity} onChange={(event) => updateAllocation(allocation.key, { quantity: Number(event.target.value) })} />
                          </div>
                          <div className="space-y-2 lg:col-span-2">
                            <RequiredLabel>Unit rate</RequiredLabel>
                            <Input type="number" min="0" step="0.0001" max={line ? Number(line.unit_rate) : undefined} value={allocation.unitRate} onChange={(event) => updateAllocation(allocation.key, { unitRate: Number(event.target.value) })} />
                          </div>
                          <div className="space-y-2 lg:col-span-2">
                            <Label>Gross split</Label>
                            <Input value={money(Number(calculation?.gross ?? 0))} readOnly />
                          </div>
                          <div className="space-y-2 lg:col-span-12">
                            <Label>Allocation remarks</Label>
                            <Input value={allocation.remarks} onChange={(event) => updateAllocation(allocation.key, { remarks: event.target.value })} placeholder="Optional cost-centre-specific context" />
                          </div>
                        </div>
                        {line && (
                          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                            {[
                              ["Cost centre", line.cost_centre_name ?? "Branch common"],
                              ["Process", line.process_name ?? "Shared / all"],
                              ["Head", `${line.head} / ${line.sub_head ?? "General"}`],
                              ["Available qty", `${decimal(Number(line.available_quantity))} ${line.unit}`],
                              ["Available gross", money(Number(line.available_gross_amount))],
                              ["Tax", `${line.tax_treatment.replaceAll("_", " ")} · ${line.gst_rate}%`],
                            ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 truncate text-[11px] font-semibold text-slate-700">{value}</p></div>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className={`rounded-2xl border p-4 ${Math.abs(allocationDifference) <= 0.01 && Number(form.invoiceTotal) > 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    <MetricCard label="Base allocated" value={money(totals.base)} />
                    <MetricCard label="Tax allocated" value={money(totals.tax)} />
                    <MetricCard label="Gross allocated" value={money(totals.gross)} tone="blue" />
                    <MetricCard label="P&L cost" value={money(totals.pnl)} tone="amber" />
                    <MetricCard label="Difference" value={money(allocationDifference)} tone={Math.abs(allocationDifference) <= 0.01 ? "emerald" : "rose"} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeStep === "validation" && (
            <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-amber-50/80 to-white">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-5 w-5 text-amber-700" /> Smart validation centre</CardTitle>
                  <Button type="button" variant="outline" size="sm" disabled={!created || revalidateMutation.isPending} onClick={() => revalidateMutation.mutate()}>{revalidateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Run server validation</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-6">
                {!created ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">Save the draft to run database-backed duplicate, document, budget and reconciliation controls.</div>
                ) : workspaceQuery.isLoading ? (
                  <div className="flex items-center justify-center py-16 text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading validations…</div>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      {(workspace?.validations ?? []).map((validation) => (
                        <div key={validation.id} className={`flex items-start gap-3 rounded-2xl border p-4 ${statusTone(validation.validation_status)}`}>
                          {validation.validation_status === "passed" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />}
                          <div><p className="text-xs font-bold">{validation.validation_code.replaceAll("_", " ")}</p><p className="mt-1 text-[11px] leading-5 opacity-90">{validation.message}</p>{Number(validation.is_blocking) === 1 && validation.validation_status === "failed" && <Badge className="mt-2 border-rose-300 bg-white/50 text-rose-700">Blocking</Badge>}</div>
                        </div>
                      ))}
                    </div>
                    {(workspace?.duplicates?.length ?? 0) > 0 && (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
                        <p className="text-xs font-bold text-rose-950">Duplicate review</p>
                        <div className="mt-3 space-y-2">
                          {workspace!.duplicates.map((duplicate) => <div key={duplicate.id} className="flex items-center justify-between rounded-xl bg-white/80 p-3 text-xs"><span>{duplicate.match_type.replaceAll("_", " ")} · {duplicate.matched_grn_number ?? "Document match"}</span><Badge className="border-rose-200 bg-rose-50 text-rose-700">{Number(duplicate.confidence_score).toFixed(0)}%</Badge></div>)}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeStep === "review" && (
            <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-violet-50/80 to-white">
                <CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="h-5 w-5 text-violet-700" /> Final review and approval impact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <MetricCard label="Invoice" value={form.invoiceNumber || "—"} />
                  <MetricCard label="Vendor" value={form.grnType === "imprest" ? "Imprest holder" : selectedVendor?.vendor_name ?? selectedVendor?.name ?? "—"} />
                  <MetricCard label="Gross payable" value={money(totals.gross)} tone="blue" />
                  <MetricCard label="P&L impact" value={money(totals.pnl)} tone="amber" />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-bold text-slate-900">Approval sequence</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    {[
                      ["Branch Admin", "Submits validated GRN"],
                      ["Branch Head", "Reserves every split budget line"],
                      ["Finance Head", "Consumes each split and approves P&L attribution"],
                      [form.grnType === "vendor" ? "Accounts Head" : "Imprest Closure", form.grnType === "vendor" ? "Dispatches payment installments" : "Closes approved expense"],
                    ].map(([title, helper], index) => <div key={String(title)} className="relative rounded-2xl border border-slate-200 bg-white p-4"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{index + 1}</div><p className="mt-3 text-xs font-bold text-slate-900">{title}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{helper}</p></div>)}
                  </div>
                </div>
                {!canSubmit && !created?.submitted && (
                  <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Submission is blocked</p><p className="mt-1 text-xs">Complete mandatory invoice fields, attach proof, reconcile splits to ₹0.00 and clear all server blocking validations.</p></div></div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-[0_18px_55px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900">{created?.submitted ? "GRN submitted" : created ? "Draft in progress" : "Unsaved smart GRN"}</p>
              <p className="text-[10px] text-slate-500">Difference {money(allocationDifference)} · Readiness {readiness.toFixed(0)}%</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => persistMutation.mutate(false)} disabled={persistMutation.isPending || created?.submitted}>
                {persistMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save draft
              </Button>
              <Button type="button" className="bg-[#073f78] hover:bg-[#052d57]" onClick={() => { setActiveStep("review"); persistMutation.mutate(true); }} disabled={persistMutation.isPending || created?.submitted || !canSubmit}>
                {persistMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{created ? "Validate & submit" : "Save, validate & submit"}
              </Button>
            </div>
          </div>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-5 xl:self-start">
          <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-950 text-white">
              <CardTitle className="flex items-center gap-2 text-sm"><CircleDollarSign className="h-4 w-4 text-emerald-300" /> Live financial summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              <MetricCard label="Without tax" value={money(totals.base)} />
              <MetricCard label="Tax" value={money(totals.tax)} tone="blue" />
              <MetricCard label="With tax" value={money(totals.gross)} tone="emerald" />
              <MetricCard label="P&L cost" value={money(totals.pnl)} tone="amber" />
              <MetricCard label="Invoice difference" value={money(allocationDifference)} tone={Math.abs(allocationDifference) <= 0.01 && Number(form.invoiceTotal) > 0 ? "emerald" : "rose"} />
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Readiness</span><span className="font-bold text-slate-900">{readiness.toFixed(0)}%</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${readiness >= 100 ? "bg-emerald-500" : readiness >= 70 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${Math.min(100, Math.max(0, readiness))}%` }} /></div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><PackageCheck className="h-4 w-4 text-blue-700" /> Current context</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><Building2 className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-[10px] text-slate-400">Branch</p><p className="font-semibold text-slate-800">{branches.find((item) => item.id === form.branchId)?.branch_name ?? branches.find((item) => item.id === form.branchId)?.name ?? "Not selected"}</p></div></div>
              <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><Landmark className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-[10px] text-slate-400">Financial year</p><p className="font-semibold text-slate-800">{financialYearFromPeriod(period)}</p></div></div>
              <div className="flex items-start gap-3 rounded-xl bg-slate-50 p-3"><WalletCards className="mt-0.5 h-4 w-4 text-slate-400" /><div><p className="text-[10px] text-slate-400">Allocation rows</p><p className="font-semibold text-slate-800">{allocations.length} · {new Set(calculatedAllocations.map((item) => item.line?.cost_centre_id).filter(Boolean)).size} cost centre(s)</p></div></div>
              <Button asChild variant="outline" className="w-full"><Link to="/finance/branch-budget"><WalletCards className="mr-2 h-4 w-4" />Open branch budget</Link></Button>
            </CardContent>
          </Card>

          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-950"><BadgeCheck className="h-4 w-4" /> Control architecture</p>
            <p className="mt-2 text-[11px] leading-5 text-emerald-800">The frontend provides speed and clarity, but the server independently recalculates tax, exact percentages, available quantity, approved rate and every budget reservation.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
