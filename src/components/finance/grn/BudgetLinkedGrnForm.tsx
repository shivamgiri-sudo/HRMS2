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
    const invoiceTotal = Number(form.invoiceTotal);
    const grossPerRow = invoiceTotal / allocations.length;

    setAllocations((current) => {
      const updated = current.map((allocation) => {
        const line = budgetLines.find((item) => item.id === allocation.budgetLineId)!;
        const taxFactor = ["exclusive", "reverse_charge"].includes(line.tax_treatment)
          ? 1 + Number(line.gst_rate) / 100
          : 1;
        const rate = grossPerRow / (Math.max(Number(allocation.quantity), 0.0001) * taxFactor);
        return {
          ...allocation,
          unitRate: Math.min(Number(line.unit_rate), Number(rate.toFixed(4))),
        };
      });

      // Auto-balance last row to absorb rounding and rate caps
      if (updated.length > 0) {
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        const line = budgetLines.find((item) => item.id === last.budgetLineId);
        if (line && Number(last.quantity) > 0) {
          const otherGross = updated
            .slice(0, lastIdx)
            .reduce((sum, alloc) => {
              const ln = budgetLines.find((item) => item.id === alloc.budgetLineId);
              if (!ln) return sum;
              const tf = ["exclusive", "reverse_charge"].includes(ln.tax_treatment) ? 1 + Number(ln.gst_rate) / 100 : 1;
              return sum + Number(alloc.unitRate) * Number(alloc.quantity) * tf;
            }, 0);
          const remainingGross = Math.round((invoiceTotal - otherGross) * 100) / 100;
          if (remainingGross > 0) {
            const taxFactor = ["exclusive", "reverse_charge"].includes(line.tax_treatment)
              ? 1 + Number(line.gst_rate) / 100
              : 1;
            const balancedRate = remainingGross / (Number(last.quantity) * taxFactor);
            if (balancedRate <= Number(line.unit_rate) + 0.0001) {
              updated[lastIdx] = { ...last, unitRate: Math.max(0, Number(balancedRate.toFixed(4))) };
            }
          }
        }
      }
      return updated;
    });
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
    <div className="flex h-full flex-col">
      {/* ── Sticky action bar ── */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b bg-white px-4 py-2 text-xs shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          {created && (
            <span className="font-mono font-bold text-[#073f78] text-sm">{created.grnNumber}</span>
          )}
          <span className="text-slate-500">
            Invoice:{" "}
            <b className="text-slate-900">
              {form.invoiceTotal ? `₹${Number(form.invoiceTotal).toLocaleString("en-IN")}` : "—"}
            </b>
          </span>
          <span className="text-slate-500">
            Allocated:{" "}
            <b className="text-slate-900">
              {totals.gross ? `₹${Number(totals.gross).toLocaleString("en-IN")}` : "—"}
            </b>
          </span>
          <span className={`font-semibold ${Math.abs(allocationDifference) <= 0.01 ? "text-emerald-600" : "text-rose-600"}`}>
            Diff: {allocationDifference >= 0 ? "+" : ""}{Number(allocationDifference).toLocaleString("en-IN")}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${readiness >= 80 ? "bg-emerald-100 text-emerald-700" : readiness >= 50 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
            {readiness}% ready
          </span>
        </div>
        <div className="flex gap-2">
          {created && (
            <Button type="button" size="sm" variant="ghost" onClick={resetForm}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={persistMutation.isPending || Boolean(created?.submitted)}
            onClick={() => persistMutation.mutate(false)}
          >
            {persistMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
            Save draft
          </Button>
          <Button
            size="sm"
            disabled={persistMutation.isPending || Boolean(created?.submitted) || !canSubmit}
            onClick={() => { setActiveStep("review"); persistMutation.mutate(true); }}
          >
            {persistMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Submit GRN
          </Button>
        </div>
      </div>

      {created?.submitted && (
        <div className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs shrink-0">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-emerald-800 font-medium">Submitted to Branch Head with allocation-aware budget controls.</p>
        </div>
      )}

      {/* ── Main 2-column layout ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left — form sections (scrollable) */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4 space-y-5 min-w-0">
        {/* ── Proof section ── */}
        <section id="proof" className="pt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Proof / Document
          </h2>
          <Card className="overflow-hidden rounded-3xl border-slate-200 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-blue-50/80 to-white">
              <CardTitle className="flex items-center gap-2 text-base">
                <UploadCloud className="h-5 w-5 text-blue-700" /> Mandatory proof and document intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-6">
              <label className="group flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-[26px] border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
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
        </section>

        {/* ── Invoice section ── */}
        <section id="invoice" className="pt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Invoice details
          </h2>
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
        </section>

        {/* ── Budget allocation section ── */}
        <section id="allocations" className="pt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Budget allocation
          </h2>
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
                /* ── Compact tabular allocation ── */
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="w-7 px-2 py-2 text-center font-medium text-slate-500">#</th>
                        <th className="px-3 py-2 text-left font-medium text-slate-500">Budget line</th>
                        <th className="w-28 px-2 py-2 text-center font-medium text-slate-500">Cost centre</th>
                        <th className="w-24 px-2 py-2 text-center font-medium text-slate-500">Qty</th>
                        <th className="w-28 px-2 py-2 text-center font-medium text-slate-500">Unit rate</th>
                        <th className="w-28 px-2 py-2 text-right font-medium text-slate-500">Gross</th>
                        <th className="w-28 px-2 py-2 text-right font-medium text-slate-500">P&L cost</th>
                        <th className="px-2 py-2 text-left font-medium text-slate-500">Remarks</th>
                        <th className="w-16 px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {calculatedAllocations.map(({ allocation, line, calculation }, index) => (
                        <tr key={allocation.key} className="group hover:bg-slate-50/60">
                          <td className="px-2 py-1.5 text-center">
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">{index + 1}</span>
                          </td>
                          <td className="px-3 py-1.5 min-w-[280px]">
                            <select
                              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                              value={allocation.budgetLineId}
                              onChange={(event) => {
                                const selectedLine = budgetLines.find((item) => item.id === event.target.value);
                                updateAllocation(allocation.key, { budgetLineId: event.target.value, quantity: Math.min(1, Number(selectedLine?.available_quantity ?? 1)), unitRate: Number(selectedLine?.unit_rate ?? 0) });
                              }}
                            >
                              <option value="">Select budget line</option>
                              {budgetLines.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.budget_number} · {item.head}/{item.sub_head || "General"} · {item.item_name} · {money(Number(item.available_gross_amount))}
                                </option>
                              ))}
                            </select>
                            {line && (
                              <p className="mt-0.5 text-[10px] text-slate-400 truncate">
                                {line.cost_centre_name ?? "Branch"} · {line.process_name ?? "Shared"} · avail {decimal(Number(line.available_quantity))} {line.unit} · {line.tax_treatment.replaceAll("_", " ")} {line.gst_rate}%
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center text-[10px] text-slate-500">{line?.cost_centre_name ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number" min="0.0001" step="0.0001"
                              max={line ? Number(line.available_quantity) : undefined}
                              value={allocation.quantity}
                              onChange={(e) => updateAllocation(allocation.key, { quantity: Number(e.target.value) })}
                              className="h-8 w-24 text-center text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number" min="0" step="0.0001"
                              max={line ? Number(line.unit_rate) : undefined}
                              value={allocation.unitRate}
                              onChange={(e) => updateAllocation(allocation.key, { unitRate: Number(e.target.value) })}
                              className="h-8 w-28 text-right text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold">{money(Number(calculation?.gross ?? 0))}</td>
                          <td className="px-2 py-1.5 text-right text-amber-700">{money(Number(calculation?.pnlCost ?? 0))}</td>
                          <td className="px-2 py-1.5">
                            <Input
                              value={allocation.remarks}
                              onChange={(e) => updateAllocation(allocation.key, { remarks: e.target.value })}
                              placeholder="Optional context"
                              className="h-8 text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-0.5">
                              <button type="button" title="Duplicate" onClick={() => addAllocation(allocation)} className="rounded p-1 text-slate-400 hover:bg-blue-50 hover:text-blue-600"><Copy className="h-3.5 w-3.5" /></button>
                              <button type="button" title="Remove" disabled={allocations.length === 1} onClick={() => removeAllocation(allocation.key)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={`border-t-2 ${Math.abs(allocationDifference) <= 0.01 && Number(form.invoiceTotal) > 0 ? "border-emerald-300 bg-emerald-50/60" : "border-rose-300 bg-rose-50/60"}`}>
                        <td colSpan={5} className="px-3 py-2 text-xs font-bold text-slate-700">Totals</td>
                        <td className="px-2 py-2 text-right text-xs font-bold text-slate-900">{money(totals.gross)}</td>
                        <td className="px-2 py-2 text-right text-xs font-bold text-amber-700">{money(totals.pnl)}</td>
                        <td colSpan={2} className="px-2 py-2 text-right text-xs">
                          <span className={`font-bold ${Math.abs(allocationDifference) <= 0.01 ? "text-emerald-700" : "text-rose-700"}`}>
                            Diff: {allocationDifference >= 0 ? "+" : ""}{money(allocationDifference)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Validation section ── */}
        <section id="validation" className="pt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Validation
          </h2>
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
        </section>

        {/* ── Review section ── */}
        <section id="review" className="pt-8">
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
        </section>
        </div>

        {/* Right — sticky sidebar summary */}
        <div className="w-72 shrink-0 border-l bg-slate-50 overflow-y-auto px-4 py-4 space-y-4 hidden xl:flex xl:flex-col">
          {/* Step checklist */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-3">Completion checklist</p>
            <div className="space-y-2">
              {([
                ["proof", "Proof attached", localValidation.proofPresent],
                ["invoice", "Invoice fields", localValidation.mandatoryInvoiceFields],
                ["budget", "Allocation balanced", localValidation.allocationReady],
                ["validation", "Validations clear", workspace ? serverBlocking.length === 0 && Boolean(workspace.validations?.length) : false],
              ] as [string, string, boolean][]).map(([, label, ok]) => (
                <div key={label} className="flex items-center gap-2 text-xs">
                  <span className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                    {ok ? <Check className="h-3 w-3" /> : <span className="text-[9px]">○</span>}
                  </span>
                  <span className={ok ? "text-slate-700 font-medium" : "text-slate-400"}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Cost summary */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Cost summary</p>
            {[
              ["Base amount", money(totals.base)],
              ["Tax", money(totals.tax)],
              ["Gross allocated", money(totals.gross)],
              ["P&L cost", money(totals.pnl)],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{label}</span>
                <span className="font-semibold text-slate-900">{value}</span>
              </div>
            ))}
            <div className={`flex items-center justify-between text-xs font-bold border-t pt-2 ${Math.abs(allocationDifference) <= 0.01 ? "text-emerald-700" : "text-rose-700"}`}>
              <span>Difference</span>
              <span>{money(allocationDifference)}</span>
            </div>
          </div>

          {/* Invoice metadata */}
          {(form.invoiceNumber || form.billDate) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Invoice</p>
              {form.invoiceNumber && (
                <div className="text-xs"><span className="text-slate-400">Number </span><span className="font-semibold">{form.invoiceNumber}</span></div>
              )}
              {form.billDate && (
                <div className="text-xs"><span className="text-slate-400">Date </span><span className="font-semibold">{form.billDate}</span></div>
              )}
              {selectedVendor && (
                <div className="text-xs"><span className="text-slate-400">Vendor </span><span className="font-semibold">{selectedVendor.vendor_name ?? selectedVendor.name}</span></div>
              )}
              {form.paymentTermsDays != null && (
                <div className="text-xs"><span className="text-slate-400">Due </span><span className="font-semibold">{addDays(form.billDate, form.paymentTermsDays)}</span></div>
              )}
            </div>
          )}

          {/* Approval path */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-3">Approval path</p>
            <div className="space-y-2">
              {[
                "Branch Admin → submits",
                "Branch Head → reserves budget",
                "Finance Head → P&L attribution",
                form.grnType === "vendor" ? "Accounts Head → payment" : "Imprest closure",
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-600">
                  <span className="h-4 w-4 rounded-full bg-slate-800 text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Server validations summary */}
          {workspace?.validations?.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-2">Server controls</p>
              <div className="space-y-1.5">
                {workspace.validations.slice(0, 6).map((v) => (
                  <div key={v.id} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] border ${v.validation_status === "passed" || v.validation_status === "overridden" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : Number(v.is_blocking) ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                    {v.validation_status === "passed" ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <AlertCircle className="h-3 w-3 shrink-0" />}
                    <span className="truncate">{v.validation_code.replaceAll("_", " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
