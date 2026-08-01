import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  IndianRupee,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScanLine,
  Send,
  ShieldCheck,
  Split,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { calculateBudgetLine } from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

type GrnType = "vendor" | "imprest";

const NO_COST_CENTRE = "__none__";
const GENERAL_SUB_HEAD = "General";

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
  billDate: string;
  remarks: string;

  // Budget coordinates the raiser actually thinks in. Together these resolve
  // one approved budget line; `budgetLineId` only disambiguates when a
  // cost centre / head / sub-head trio still matches more than one line.
  costCentreKey: string;
  head: string;
  subHead: string;
  budgetLineId: string;

  /**
   * Vendor mode: amount BEFORE GST. Imprest mode: the receipt total.
   * In split mode this is the declared invoice total including tax.
   */
  amount: number;

  // Vendor-only.
  vendorId: string;
  invoiceNumber: string;
  vendorGstin: string;
  placeOfSupply: string;
  purchaseReference: string;
  paymentTermsDays: number;
  dueDate: string;
};

type CreatedGrn = { id: string; grnNumber: string; submitted: boolean };

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
  billDate: "",
  remarks: "",
  costCentreKey: "",
  head: "",
  subHead: "",
  budgetLineId: "",
  amount: 0,
  vendorId: "",
  invoiceNumber: "",
  vendorGstin: "",
  placeOfSupply: "",
  purchaseReference: "",
  paymentTermsDays: 30,
  dueDate: "",
};

function newAllocation(): AllocationDraft {
  return { key: crypto.randomUUID(), budgetLineId: "", quantity: 1, unitRate: 0, remarks: "" };
}

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "—";
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function addDays(dateString: string, days: number) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function decimal(value: number, digits = 4) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });
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

function statusTone(status: string) {
  if (["passed", "completed", "matched"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (["warning", "manual_review", "near_match", "pending", "processing"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-rose-200 bg-rose-50 text-rose-700";
}

/** Runs `calculateBudgetLine` for a line at a given quantity. */
function computeLine(line: BudgetLine, quantity: number, unitRate?: number) {
  return calculateBudgetLine({
    head: line.head,
    subHead: line.sub_head,
    itemName: line.item_name,
    quantity: Number(quantity),
    unit: line.unit,
    unitRate: Number(unitRate ?? line.unit_rate),
    taxTreatment: line.tax_treatment,
    gstRate: Number(line.gst_rate),
    gstType: line.gst_type,
    recoverableTaxPct: Number(line.recoverable_tax_pct),
    justification: line.justification,
  });
}

// ─── Layout primitives ──────────────────────────────────────────────────────

/**
 * One form field. Label sits beside the control from `md` up and stacks above
 * it on narrower screens, so the page never scrolls sideways on a phone.
 */
function FieldRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 px-4 py-3 md:grid-cols-[210px_minmax(0,1fr)] md:items-start md:gap-4">
      <Label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-slate-700 md:pt-2.5"
      >
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </Label>
      <div className="min-w-0">
        {children}
        {error ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-rose-600">
            <AlertCircle className="mt-px h-3 w-3 shrink-0" />
            {error}
          </p>
        ) : (
          hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
        )}
      </div>
    </div>
  );
}

function FormSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

/** Read-only value rendered at input height so rows stay on one baseline. */
function StaticValue({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-11 items-center text-sm font-medium md:h-10",
        muted ? "text-slate-400" : "text-slate-900"
      )}
    >
      {children}
    </div>
  );
}

const inputClass = "h-11 md:h-10";

// ─── Component ──────────────────────────────────────────────────────────────

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [splitMode, setSplitMode] = useState(false);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([newAllocation()]);
  const [files, setFiles] = useState<File[]>([]);
  const [created, setCreated] = useState<CreatedGrn | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [extractedFields, setExtractedFields] = useState<Record<string, any> | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");

  const isVendor = form.grnType === "vendor";
  const period = form.billDate ? form.billDate.slice(0, 7) : "";

  const { data: branchResponse } = useQuery({
    queryKey: ["grn-budget-branches"],
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
  });

  // Vendor master holds ~1.8k active rows, so the list is searched server-side
  // rather than dumped into the picker.
  const { data: vendorResponse, isFetching: vendorsLoading } = useQuery({
    queryKey: ["grn-vendor-search", vendorSearch],
    enabled: isVendor,
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/erp/vendors?is_active=1&limit=50&q=${encodeURIComponent(vendorSearch.trim())}`
      ),
  });

  const branches = unwrapList(branchResponse).filter(
    (branch) => Number(branch.active_status ?? 1) === 1
  );
  const vendors = unwrapList(vendorResponse);

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
  const effectiveExtractedFields =
    extractedFields ?? parseJson(latestExtraction?.extracted_fields_json);
  const selectedVendor = vendors.find((vendor) => vendor.id === form.vendorId);

  // ── Cascade: cost centre → head → sub-head → (item, only when ambiguous) ──

  const costCentreOptions = useMemo<SearchableOption[]>(() => {
    const seen = new Map<string, string>();
    budgetLines.forEach((line) => {
      const key = line.cost_centre_id ?? NO_COST_CENTRE;
      if (!seen.has(key)) {
        seen.set(key, line.cost_centre_name ?? "Branch (no cost centre)");
      }
    });
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [budgetLines]);

  const linesInCostCentre = useMemo(
    () =>
      form.costCentreKey
        ? budgetLines.filter(
            (line) => (line.cost_centre_id ?? NO_COST_CENTRE) === form.costCentreKey
          )
        : [],
    [budgetLines, form.costCentreKey]
  );

  const headOptions = useMemo(
    () => [...new Set(linesInCostCentre.map((line) => line.head))].map((head) => ({
      value: head,
      label: head,
    })),
    [linesInCostCentre]
  );

  const linesInHead = useMemo(
    () => linesInCostCentre.filter((line) => line.head === form.head),
    [linesInCostCentre, form.head]
  );

  const subHeadOptions = useMemo(
    () =>
      [...new Set(linesInHead.map((line) => line.sub_head || GENERAL_SUB_HEAD))].map(
        (subHead) => ({ value: subHead, label: subHead })
      ),
    [linesInHead]
  );

  const matchingLines = useMemo(
    () =>
      form.subHead
        ? linesInHead.filter((line) => (line.sub_head || GENERAL_SUB_HEAD) === form.subHead)
        : [],
    [linesInHead, form.subHead]
  );

  // Only surface an item picker when the trio genuinely maps to several lines.
  const needsItemChoice = matchingLines.length > 1;

  const resolvedLine = useMemo(() => {
    if (matchingLines.length === 1) return matchingLines[0];
    return matchingLines.find((line) => line.id === form.budgetLineId) ?? null;
  }, [matchingLines, form.budgetLineId]);

  // Clear downstream selections whenever an upstream one changes, so a stale
  // head can never survive a cost-centre switch.
  useEffect(() => {
    setForm((current) => {
      if (!current.head) return current;
      const validHead = linesInCostCentre.some((line) => line.head === current.head);
      return validHead ? current : { ...current, head: "", subHead: "", budgetLineId: "" };
    });
  }, [linesInCostCentre]);

  useEffect(() => {
    setForm((current) => {
      if (!current.subHead) return current;
      const validSubHead = linesInHead.some(
        (line) => (line.sub_head || GENERAL_SUB_HEAD) === current.subHead
      );
      return validSubHead ? current : { ...current, subHead: "", budgetLineId: "" };
    });
  }, [linesInHead]);

  useEffect(() => {
    if (matchingLines.length === 1 && form.budgetLineId !== matchingLines[0].id) {
      setForm((current) => ({ ...current, budgetLineId: matchingLines[0].id }));
    }
  }, [matchingLines, form.budgetLineId]);

  // ── Amount → quantity (single-line mode) ────────────────────────────────
  //
  // The approved unit rate is never exceeded (the server rejects that), so the
  // typed amount is turned into a quantity instead.

  const singleLine = useMemo(() => {
    if (splitMode || !resolvedLine || !(form.amount > 0)) return null;
    const perUnit = computeLine(resolvedLine, 1);
    const basis = isVendor ? Number(perUnit.base) : Number(perUnit.gross);
    if (!(basis > 0)) return null;
    const quantity = Number((form.amount / basis).toFixed(4));
    const totals = computeLine(resolvedLine, quantity);
    return { quantity, totals, perUnit };
  }, [splitMode, resolvedLine, form.amount, isVendor]);

  const calculatedAllocations = useMemo(
    () =>
      allocations.map((allocation) => {
        const line = budgetLines.find((item) => item.id === allocation.budgetLineId);
        const calculation = line
          ? computeLine(line, allocation.quantity, allocation.unitRate)
          : null;
        return { allocation, line, calculation };
      }),
    [allocations, budgetLines]
  );

  const splitTotals = useMemo(
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

  const totals = splitMode
    ? splitTotals
    : {
        base: Number(singleLine?.totals.base ?? 0),
        tax: Number(singleLine?.totals.tax ?? 0),
        gross: Number(singleLine?.totals.gross ?? 0),
        pnl: Number(singleLine?.totals.pnlCost ?? 0),
      };

  const splitDifference =
    Math.round((splitTotals.gross - Number(form.amount || 0)) * 100) / 100;

  // ── Per-field validation ────────────────────────────────────────────────

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!form.branchId) next.branchId = "Select the branch this spend belongs to.";
    if (!form.billDate) {
      next.billDate = isVendor ? "Invoice date is required." : "Receipt date is required.";
    }
    // The cascade is only rendered in single-line mode; in split mode the
    // allocation rows carry the budget coordinates instead.
    if (!splitMode) {
      if (!form.costCentreKey) next.costCentreKey = "Select a cost centre.";
      if (!form.head) next.head = "Select an expense head.";
      if (!form.subHead) next.subHead = "Select a sub-head.";
      if (needsItemChoice && !form.budgetLineId) {
        next.budgetLineId = "More than one budget line matches — pick the item.";
      }
    }
    if (!form.remarks.trim()) next.remarks = "Add a short reason for this spend.";
    if (!(form.amount > 0)) next.amount = "Enter an amount greater than zero.";

    if (isVendor) {
      if (!form.vendorId) next.vendorId = "Select the vendor.";
      if (!form.invoiceNumber.trim()) next.invoiceNumber = "Invoice number is required.";
      if (form.dueDate && form.billDate) {
        const gap = daysBetween(form.billDate, form.dueDate);
        if (gap !== null && gap < 0) next.dueDate = "Due date cannot fall before the invoice date.";
      }
    }

    // Budget capacity — checked client-side so the raiser is not bounced by the
    // server after filling everything.
    if (!splitMode && resolvedLine && singleLine) {
      if (singleLine.quantity > Number(resolvedLine.available_quantity) + 0.0001) {
        next.amount = `Only ${decimal(Number(resolvedLine.available_quantity))} ${resolvedLine.unit} remain approved on this budget line.`;
      } else if (
        Number(singleLine.totals.gross) >
        Number(resolvedLine.available_gross_amount) + 0.01
      ) {
        next.amount = `Exceeds the approved budget balance of ${money(Number(resolvedLine.available_gross_amount))}.`;
      }
    }

    if (splitMode) {
      if (!allocations.every((item) => item.budgetLineId)) {
        next.split = "Select a budget line in every row.";
      } else if (Math.abs(splitDifference) > 0.01) {
        next.split = `Split must equal the invoice total exactly. Difference ${money(splitDifference)}.`;
      }
    }
    return next;
  }, [
    form,
    isVendor,
    needsItemChoice,
    splitMode,
    resolvedLine,
    singleLine,
    allocations,
    splitDifference,
  ]);

  const proofPresent = files.length > 0 || Boolean(workspace?.documents?.length);
  const serverBlocking = (workspace?.validations ?? []).filter(
    (item) => Number(item.is_blocking) === 1 && item.validation_status === "failed"
  );
  const hasErrors = Object.keys(errors).length > 0;
  const canSubmit = !hasErrors && proofPresent && serverBlocking.length === 0;

  const checklist = [
    { label: "Proof attached", done: proofPresent },
    { label: "Details complete", done: !hasErrors },
    { label: "Budget resolved", done: Boolean(splitMode ? allocations[0]?.budgetLineId : resolvedLine) },
    {
      label: "Server validations clear",
      done: Boolean(workspace?.validations?.length) && serverBlocking.length === 0,
    },
  ];
  const readiness =
    workspace?.grn?.validation_score != null
      ? Number(workspace.grn.validation_score)
      : Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100);

  const err = (key: string) => (showErrors ? errors[key] : undefined);

  // Quantity is stored to 4dp, so a rate that does not divide evenly can leave
  // the computed figure a paisa off what was typed. Say so rather than let the
  // total look wrong.
  const roundingNote = (() => {
    if (splitMode || !singleLine || !(form.amount > 0)) return undefined;
    const settled = isVendor
      ? Number(singleLine.totals.base)
      : Number(singleLine.totals.gross);
    const drift = Math.round((settled - form.amount) * 100) / 100;
    if (Math.abs(drift) < 0.01) return undefined;
    return `Rounded to ${money(settled)} to fit the approved unit rate.`;
  })();

  // payment_terms_days is still stored, but it is now derived from the date the
  // raiser actually picked rather than driving it.
  const dueDateGap = daysBetween(form.billDate, form.dueDate);
  const resolvedPaymentTerms =
    form.dueDate && dueDateGap !== null && dueDateGap >= 0 ? dueDateGap : form.paymentTermsDays;

  // ── Allocation helpers (split mode only) ────────────────────────────────

  function updateAllocation(key: string, patch: Partial<AllocationDraft>) {
    setAllocations((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item))
    );
  }

  function addAllocation() {
    setAllocations((current) => [...current, newAllocation()]);
  }

  function removeAllocation(key: string) {
    setAllocations((current) =>
      current.length === 1 ? current : current.filter((item) => item.key !== key)
    );
  }

  function autoBalanceLastRow() {
    const last = allocations[allocations.length - 1];
    const line = budgetLines.find((item) => item.id === last.budgetLineId);
    if (!line || Number(last.quantity) <= 0 || Number(form.amount) <= 0) {
      toast({
        title: "Select the final budget line first",
        description: "Enter the invoice total and a quantity before auto-balancing.",
        variant: "destructive",
      });
      return;
    }
    const otherGross = calculatedAllocations
      .filter((item) => item.allocation.key !== last.key)
      .reduce((sum, item) => sum + Number(item.calculation?.gross ?? 0), 0);
    const remainingGross = Math.round((Number(form.amount) - otherGross) * 100) / 100;
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

  function resetForm() {
    setForm(EMPTY_FORM);
    setAllocations([newAllocation()]);
    setFiles([]);
    setCreated(null);
    setExtractedFields(null);
    setSplitMode(false);
    setShowErrors(false);
  }

  function applyExtractedFields(fields: Record<string, any>) {
    setForm((current) => ({
      ...current,
      invoiceNumber: String(fields.invoiceNumber ?? current.invoiceNumber ?? ""),
      billDate: String(fields.invoiceDate ?? current.billDate ?? ""),
      purchaseReference: String(fields.purchaseReference ?? current.purchaseReference ?? ""),
      vendorGstin: String(fields.vendorGstin ?? current.vendorGstin ?? ""),
      placeOfSupply: String(fields.placeOfSupply ?? current.placeOfSupply ?? ""),
    }));
    setExtractedFields(fields);
  }

  const persistMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      setShowErrors(true);
      if (hasErrors) {
        throw new Error("Some details still need attention — see the highlighted fields.");
      }
      if (submit && !proofPresent) {
        throw new Error("At least one invoice or supporting proof is mandatory");
      }

      const rows: AllocationDraft[] = splitMode
        ? allocations
        : [
            {
              key: "single",
              budgetLineId: resolvedLine!.id,
              quantity: singleLine!.quantity,
              unitRate: Number(resolvedLine!.unit_rate),
              remarks: "",
            },
          ];

      const firstLine = splitMode
        ? budgetLines.find((line) => line.id === rows[0].budgetLineId)!
        : resolvedLine!;

      let current = created;
      if (!current) {
        const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
          "/api/finance/grns",
          {
            grnType: form.grnType,
            branchId: form.branchId,
            budgetLineId: firstLine.id,
            processId: firstLine.process_id ?? undefined,
            costCentreId: firstLine.cost_centre_id ?? undefined,
            vendorId: isVendor ? form.vendorId : undefined,
            quantity: Number(rows[0].quantity),
            unitRate: Number(rows[0].unitRate),
            billDate: form.billDate,
            paymentTermsDays: isVendor ? Number(resolvedPaymentTerms) : 0,
            remarks: form.remarks || undefined,
            financialYear: financialYearFromPeriod(firstLine.period_code),
          }
        );
        current = { ...result, submitted: false };
        setCreated(current);
      }

      await hrmsApi.put(`/api/finance/grns/${current.id}/allocations`, {
        invoiceNumber: isVendor ? form.invoiceNumber : undefined,
        purchaseReference: isVendor ? form.purchaseReference || undefined : undefined,
        vendorGstin: isVendor ? form.vendorGstin || undefined : undefined,
        placeOfSupply: isVendor ? form.placeOfSupply || undefined : undefined,
        // Only declared in split mode. In single-line mode the amount drives the
        // quantity, so the server's computed gross IS the invoice total and a
        // declared figure could only ever contradict it.
        declaredInvoiceTotal: splitMode ? Number(form.amount) : undefined,
        allocations: rows.map((item) => ({
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
            description:
              analysisError instanceof Error
                ? analysisError.message
                : "Document analysis was unavailable.",
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
        title: submit ? "GRN submitted to Branch Head" : "GRN draft saved",
        description: result.grnNumber,
      });
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
      void queryClient.invalidateQueries({ queryKey: ["smart-grn-workspace", result.id] });
    },
    onError: (error: Error) =>
      toast({ title: "GRN could not be saved", description: error.message, variant: "destructive" }),
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
        title:
          data?.status === "completed"
            ? "Invoice extraction completed"
            : "Manual document verification required",
        description:
          data?.confidence != null
            ? `Confidence ${data.confidence}%`
            : "Review the invoice alongside the form.",
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

  const primaryDocument =
    workspace?.documents?.find((item) => Number(item.is_primary) === 1) ?? workspace?.documents?.[0];

  const locked = Boolean(created);
  const submitted = Boolean(created?.submitted);

  const actionButtons = (
    <div className="flex gap-2">
      {created && (
        <Button type="button" size="sm" variant="ghost" onClick={resetForm} aria-label="Start a new GRN">
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        className="h-10 flex-1 md:h-9 md:flex-none"
        disabled={persistMutation.isPending || submitted}
        onClick={() => persistMutation.mutate(false)}
      >
        {persistMutation.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Save className="mr-1.5 h-4 w-4" />
        )}
        Save draft
      </Button>
      <Button
        size="sm"
        className="h-10 flex-1 md:h-9 md:flex-none"
        disabled={persistMutation.isPending || submitted || !canSubmit}
        onClick={() => persistMutation.mutate(true)}
      >
        {persistMutation.isPending ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Send className="mr-1.5 h-4 w-4" />
        )}
        Submit GRN
      </Button>
    </div>
  );

  const totalStrip = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {created && (
        <span className="font-mono text-sm font-bold text-[#073f78]">{created.grnNumber}</span>
      )}
      <span className="text-slate-500">
        Total: <b className="text-sm text-slate-900">{totals.gross ? money(totals.gross) : "—"}</b>
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-bold",
          readiness >= 80
            ? "bg-emerald-100 text-emerald-700"
            : readiness >= 50
              ? "bg-amber-100 text-amber-700"
              : "bg-slate-100 text-slate-600"
        )}
      >
        {readiness}% ready
      </span>
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-slate-50/60">
      {/* Header — sticky on every size; actions move to a bottom bar on phones. */}
      <div className="sticky top-0 z-20 shrink-0 border-b bg-white px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          {totalStrip}
          <div className="hidden md:block">{actionButtons}</div>
        </div>
      </div>

      {submitted && (
        <div className="flex shrink-0 items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <p className="font-medium text-emerald-800">
            Submitted to Branch Head with allocation-aware budget controls.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-3 pb-32 pt-4 md:px-4 md:pb-8">
          {/* ── Mode ── */}
          <Tabs
            value={form.grnType}
            onValueChange={(value) =>
              !locked && setForm((current) => ({ ...current, grnType: value as GrnType }))
            }
          >
            <TabsList className="grid h-auto w-full grid-cols-2 md:w-auto md:inline-grid">
              <TabsTrigger value="vendor" disabled={locked} className="h-10 gap-2 px-4">
                <IndianRupee className="h-4 w-4" /> Vendor GRN
              </TabsTrigger>
              <TabsTrigger value="imprest" disabled={locked} className="h-10 gap-2 px-4">
                <UploadCloud className="h-4 w-4" /> Imprest
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {showErrors && hasErrors && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {Object.keys(errors).length} field
                {Object.keys(errors).length > 1 ? "s need" : " needs"} attention. Each one is marked
                below.
              </p>
            </div>
          )}

          {/* ── Proof ── */}
          <FormSection
            title="Proof"
            description="Attach the invoice or receipt. At least one file is required to submit."
          >
            <div className="px-4 py-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center transition-colors hover:border-slate-400 hover:bg-slate-100">
                <UploadCloud className="h-6 w-6 text-slate-400" />
                <span className="text-sm font-medium text-slate-700">
                  Tap to attach invoice or receipt
                </span>
                <span className="text-[11px] text-slate-500">
                  PDF, JPG, PNG or WEBP · up to 10 files, 20 MB each
                </span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="sr-only"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
                />
              </label>

              {(files.length > 0 || (workspace?.documents?.length ?? 0) > 0) && (
                <ul className="mt-3 space-y-1.5">
                  {files.map((file) => (
                    <li
                      key={file.name}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-slate-700">{file.name}</span>
                      <Badge variant="outline" className="shrink-0">
                        Pending upload
                      </Badge>
                    </li>
                  ))}
                  {workspace?.documents?.map((document) => (
                    <li
                      key={document.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-slate-700">{document.original_name}</span>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0", statusTone(document.extraction_status))}
                      >
                        {Number(document.is_primary) === 1 ? "Primary" : "Support"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={autoAnalyze}
                    onChange={(event) => setAutoAnalyze(event.target.checked)}
                  />
                  Read the invoice automatically after upload
                </label>
                {primaryDocument && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={analyzeMutation.isPending}
                    onClick={() => analyzeMutation.mutate(primaryDocument.id)}
                  >
                    {analyzeMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ScanLine className="mr-2 h-4 w-4" />
                    )}
                    Analyze invoice
                  </Button>
                )}
              </div>
            </div>
          </FormSection>

          {/* ── Details ── */}
          <FormSection
            title={isVendor ? "Invoice details" : "Receipt details"}
            description={
              isVendor
                ? "Who the payment goes to and against what document."
                : "When the expense was incurred."
            }
          >
            <FieldRow label="Branch" htmlFor="grn-branch" required error={err("branchId")}>
              <SearchableSelect
                id="grn-branch"
                aria-label="Branch"
                disabled={locked}
                options={branches.map((branch) => ({
                  value: branch.id,
                  label: branch.branch_name ?? branch.name,
                  hint: branch.branch_code ?? undefined,
                }))}
                value={form.branchId}
                onChange={(value) => {
                  setForm((current) => ({
                    ...current,
                    branchId: value,
                    costCentreKey: "",
                    head: "",
                    subHead: "",
                    budgetLineId: "",
                  }));
                  setAllocations([newAllocation()]);
                }}
                placeholder="Select branch"
                searchPlaceholder="Type a branch name…"
              />
            </FieldRow>

            <FieldRow
              label={isVendor ? "Invoice date" : "Receipt date"}
              htmlFor="grn-bill-date"
              required
              error={err("billDate")}
              hint={period ? `Financial year ${financialYearFromPeriod(period)}` : undefined}
            >
              <Input
                id="grn-bill-date"
                type="date"
                className={inputClass}
                disabled={locked}
                value={form.billDate}
                onChange={(event) => {
                  const billDate = event.target.value;
                  setForm((current) => ({
                    ...current,
                    billDate,
                    costCentreKey: "",
                    head: "",
                    subHead: "",
                    budgetLineId: "",
                    dueDate:
                      current.dueDate || !billDate
                        ? current.dueDate
                        : addDays(billDate, current.paymentTermsDays),
                  }));
                  setAllocations([newAllocation()]);
                }}
              />
            </FieldRow>

            {isVendor && (
              <>
                <FieldRow label="Invoice number" htmlFor="grn-invoice-no" required error={err("invoiceNumber")}>
                  <Input
                    id="grn-invoice-no"
                    className={inputClass}
                    value={form.invoiceNumber}
                    placeholder="As printed on the invoice"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, invoiceNumber: event.target.value }))
                    }
                  />
                </FieldRow>

                <FieldRow label="Vendor" htmlFor="grn-vendor" required error={err("vendorId")}>
                  <SearchableSelect
                    id="grn-vendor"
                    aria-label="Vendor"
                    disabled={locked}
                    loading={vendorsLoading}
                    options={vendors.map((vendor) => ({
                      value: vendor.id,
                      label: (vendor.vendor_name ?? vendor.name ?? "").trim(),
                      hint: vendor.vendor_code ?? undefined,
                    }))}
                    value={form.vendorId}
                    onChange={(value) => {
                      const picked = vendors.find((vendor) => vendor.id === value);
                      setForm((current) => ({
                        ...current,
                        vendorId: value,
                        vendorGstin: current.vendorGstin || (picked?.gst_number ?? ""),
                      }));
                    }}
                    search={vendorSearch}
                    onSearchChange={setVendorSearch}
                    placeholder="Select vendor"
                    searchPlaceholder="Type a vendor name or code…"
                    emptyText={
                      vendorSearch.trim() ? "No vendor matches that." : "Start typing to search."
                    }
                  />
                </FieldRow>

                <FieldRow label="Vendor GSTIN" htmlFor="grn-gstin">
                  <Input
                    id="grn-gstin"
                    className={cn(inputClass, "font-mono uppercase")}
                    value={form.vendorGstin}
                    placeholder="GSTIN, or NA for a non-GST vendor"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        vendorGstin: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </FieldRow>

                <FieldRow label="Place of supply" htmlFor="grn-place">
                  <Input
                    id="grn-place"
                    className={inputClass}
                    value={form.placeOfSupply}
                    placeholder="State or place"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, placeOfSupply: event.target.value }))
                    }
                  />
                </FieldRow>

                <FieldRow
                  label="Contract reference"
                  htmlFor="grn-contract-ref"
                  hint="Contract or agreement reference. Leave blank if there is none."
                >
                  <Input
                    id="grn-contract-ref"
                    className={inputClass}
                    value={form.purchaseReference}
                    placeholder="Contract reference"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, purchaseReference: event.target.value }))
                    }
                  />
                </FieldRow>

                <FieldRow
                  label="Payment due date"
                  htmlFor="grn-due-date"
                  error={err("dueDate")}
                  hint={
                    form.billDate && form.dueDate && dueDateGap !== null && dueDateGap >= 0
                      ? `${dueDateGap} days from the invoice date`
                      : "Enter the date payment is actually due."
                  }
                >
                  <Input
                    id="grn-due-date"
                    type="date"
                    className={inputClass}
                    min={form.billDate || undefined}
                    value={form.dueDate}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, dueDate: event.target.value }))
                    }
                  />
                </FieldRow>
              </>
            )}
          </FormSection>

          {/* ── Budget coordinates ── */}
          <FormSection
            title="Where this spend belongs"
            description="Cost centre, head and sub-head together identify the approved budget."
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setSplitMode((value) => !value)}
              >
                <Split className="mr-1.5 h-3.5 w-3.5" />
                {splitMode ? "Use a single cost centre" : "Split across cost centres"}
              </Button>
            }
          >
            {!form.branchId || !period ? (
              <div className="px-4 py-4 text-xs text-amber-800">
                Select the branch and date first to load approved budgets.
              </div>
            ) : linesLoading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading approved budgets…
              </div>
            ) : !budgetLines.length ? (
              <div className="px-4 py-4 text-xs text-amber-800">
                No approved budget line is available for {period}. Branch Head, Finance Head and
                Accounts Head approval must be completed first.
              </div>
            ) : splitMode ? (
              <div className="px-4 py-3">
                <SplitAllocationEditor
                  budgetLines={budgetLines}
                  rows={calculatedAllocations}
                  totals={splitTotals}
                  difference={splitDifference}
                  error={err("split")}
                  onUpdate={updateAllocation}
                  onAdd={addAllocation}
                  onRemove={removeAllocation}
                  onAutoBalance={autoBalanceLastRow}
                  canRemove={allocations.length > 1}
                />
              </div>
            ) : (
              <>
                <FieldRow label="Cost centre" htmlFor="grn-cc" required error={err("costCentreKey")}>
                  <SearchableSelect
                    id="grn-cc"
                    aria-label="Cost centre"
                    options={costCentreOptions}
                    value={form.costCentreKey}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        costCentreKey: value,
                        head: "",
                        subHead: "",
                        budgetLineId: "",
                      }))
                    }
                    placeholder="Select cost centre"
                    searchPlaceholder="Type a cost centre…"
                  />
                </FieldRow>

                <FieldRow label="Head" htmlFor="grn-head" required error={err("head")}>
                  <SearchableSelect
                    id="grn-head"
                    aria-label="Expense head"
                    disabled={!form.costCentreKey}
                    options={headOptions}
                    value={form.head}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        head: value,
                        subHead: "",
                        budgetLineId: "",
                      }))
                    }
                    placeholder={form.costCentreKey ? "Select head" : "Select a cost centre first"}
                    searchPlaceholder="Type a head…"
                  />
                </FieldRow>

                <FieldRow label="Sub-head" htmlFor="grn-subhead" required error={err("subHead")}>
                  <SearchableSelect
                    id="grn-subhead"
                    aria-label="Expense sub-head"
                    disabled={!form.head}
                    options={subHeadOptions}
                    value={form.subHead}
                    onChange={(value) =>
                      setForm((current) => ({ ...current, subHead: value, budgetLineId: "" }))
                    }
                    placeholder={form.head ? "Select sub-head" : "Select a head first"}
                    searchPlaceholder="Type a sub-head…"
                  />
                </FieldRow>

                {/* Shown only when the trio above is genuinely ambiguous. */}
                {needsItemChoice && (
                  <FieldRow
                    label="Item"
                    htmlFor="grn-item"
                    required
                    error={err("budgetLineId")}
                    hint={`${matchingLines.length} budget lines share this head and sub-head.`}
                  >
                    <SearchableSelect
                      id="grn-item"
                      aria-label="Budget item"
                      options={matchingLines.map((line) => ({
                        value: line.id,
                        label: line.item_name,
                        hint: `${money(Number(line.available_gross_amount))} left`,
                        keywords: line.budget_number,
                      }))}
                      value={form.budgetLineId}
                      onChange={(value) =>
                        setForm((current) => ({ ...current, budgetLineId: value }))
                      }
                      placeholder="Select the item"
                      searchPlaceholder="Type an item name…"
                    />
                  </FieldRow>
                )}

                {resolvedLine && (
                  <FieldRow label="Approved budget">
                    <StaticValue>
                      <span className="text-xs font-normal text-slate-600">
                        {resolvedLine.budget_number} · {money(Number(resolvedLine.available_gross_amount))}{" "}
                        available · {decimal(Number(resolvedLine.available_quantity))}{" "}
                        {resolvedLine.unit} left
                      </span>
                    </StaticValue>
                  </FieldRow>
                )}
              </>
            )}
          </FormSection>

          {/* ── Amount ── */}
          <FormSection
            title="Amount"
            description={
              isVendor
                ? "Enter the value before GST. The tax and total are calculated for you."
                : "Enter the amount spent. The total is calculated for you."
            }
          >
            <FieldRow
              label={splitMode ? "Invoice total (incl. GST)" : isVendor ? "Amount without GST" : "Amount"}
              htmlFor="grn-amount"
              required
              error={err("amount")}
              hint={roundingNote}
            >
              <Input
                id="grn-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                className={cn(inputClass, "text-right font-semibold tabular-nums")}
                value={form.amount || ""}
                placeholder="0.00"
                onChange={(event) =>
                  setForm((current) => ({ ...current, amount: Number(event.target.value) }))
                }
              />
            </FieldRow>

            {!splitMode && isVendor && (
              <FieldRow
                label="GST rate"
                hint={
                  resolvedLine
                    ? `Set by the approved budget line (${resolvedLine.tax_treatment.split("_").join(" ")}).`
                    : undefined
                }
              >
                <StaticValue muted={!resolvedLine}>
                  {resolvedLine ? `${decimal(Number(resolvedLine.gst_rate), 2)}%` : "Select a sub-head first"}
                </StaticValue>
              </FieldRow>
            )}

            <div className="bg-slate-50 px-4 py-3">
              <dl className="ml-auto w-full space-y-1.5 text-sm md:max-w-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">Taxable value</dt>
                  <dd className="tabular-nums font-medium text-slate-700">{money(totals.base)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-500">GST</dt>
                  <dd className="tabular-nums font-medium text-slate-700">{money(totals.tax)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5">
                  <dt className="font-semibold text-slate-900">Total payable</dt>
                  <dd className="tabular-nums text-base font-bold text-slate-900">
                    {money(totals.gross)}
                  </dd>
                </div>
              </dl>
            </div>

            <FieldRow label="Remark" htmlFor="grn-remarks" required error={err("remarks")}>
              <Textarea
                id="grn-remarks"
                className="min-h-20"
                value={form.remarks}
                placeholder="What was bought or paid for, and why."
                onChange={(event) =>
                  setForm((current) => ({ ...current, remarks: event.target.value }))
                }
              />
            </FieldRow>
          </FormSection>

          {/* ── Extraction ── */}
          {effectiveExtractedFields && (
            <FormSection
              title="Read from the invoice"
              description="Check these against the document before applying."
              action={
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => applyExtractedFields(effectiveExtractedFields)}
                  >
                    Apply
                  </Button>
                  {created && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={confirmExtractionMutation.isPending}
                      onClick={() => confirmExtractionMutation.mutate()}
                    >
                      {confirmExtractionMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <BadgeCheck className="mr-2 h-4 w-4" />
                      )}
                      Confirm
                    </Button>
                  )}
                </div>
              }
            >
              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Vendor", effectiveExtractedFields.vendorName],
                  ["Invoice", effectiveExtractedFields.invoiceNumber],
                  ["Date", effectiveExtractedFields.invoiceDate],
                  [
                    "Gross",
                    effectiveExtractedFields.grossAmount != null
                      ? money(Number(effectiveExtractedFields.grossAmount))
                      : "—",
                  ],
                  ["GSTIN", effectiveExtractedFields.vendorGstin],
                  [
                    "Confidence",
                    effectiveExtractedFields.confidence != null
                      ? `${effectiveExtractedFields.confidence}%`
                      : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-slate-50 p-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-slate-900">
                      {String(value ?? "—")}
                    </p>
                  </div>
                ))}
              </div>
            </FormSection>
          )}

          {/* ── Validation ── */}
          {workspace && (
            <FormSection
              title="Checks"
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!created || revalidateMutation.isPending}
                  onClick={() => revalidateMutation.mutate()}
                >
                  {revalidateMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Re-run
                </Button>
              }
            >
              <ul className="divide-y divide-slate-100">
                {(workspace.validations ?? []).map((validation) => (
                  <li key={validation.id} className="flex items-start gap-2 px-4 py-2.5 text-xs">
                    <ShieldCheck
                      className={cn(
                        "mt-px h-3.5 w-3.5 shrink-0",
                        validation.validation_status === "passed"
                          ? "text-emerald-600"
                          : validation.validation_status === "warning"
                            ? "text-amber-600"
                            : "text-rose-600"
                      )}
                    />
                    <span className="text-slate-700">{validation.message}</span>
                    {Number(validation.is_blocking) === 1 &&
                      validation.validation_status === "failed" && (
                        <Badge variant="outline" className="ml-auto shrink-0 border-rose-200 text-rose-700">
                          Blocking
                        </Badge>
                      )}
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {/* Summary for screens without the sidebar. */}
          <div className="xl:hidden">
            <FormSection title="Readiness">
              <ul className="divide-y divide-slate-100">
                {checklist.map((item) => (
                  <li key={item.label} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                    <CheckCircle2
                      className={cn(
                        "h-4 w-4 shrink-0",
                        item.done ? "text-emerald-600" : "text-slate-300"
                      )}
                    />
                    <span className={item.done ? "text-slate-700" : "text-slate-400"}>
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
            </FormSection>
          </div>
        </div>

        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l bg-white p-4 xl:block">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Readiness</h3>
          <ul className="mt-3 space-y-2">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs">
                <CheckCircle2
                  className={cn("h-4 w-4 shrink-0", item.done ? "text-emerald-600" : "text-slate-300")}
                />
                <span className={item.done ? "text-slate-700" : "text-slate-400"}>{item.label}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Cost</h3>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Taxable</dt>
              <dd className="tabular-nums font-medium">{money(totals.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">GST</dt>
              <dd className="tabular-nums font-medium">{money(totals.tax)}</dd>
            </div>
            <div className="flex justify-between border-t pt-1.5">
              <dt className="font-semibold text-slate-700">Total</dt>
              <dd className="tabular-nums font-bold">{money(totals.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">P&amp;L impact</dt>
              <dd className="tabular-nums font-medium text-amber-700">{money(totals.pnl)}</dd>
            </div>
          </dl>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Approval path
          </h3>
          <ol className="mt-3 space-y-2 text-xs text-slate-600">
            {[
              "Branch Admin submits",
              "Branch Head reviews",
              "Finance Head reviews",
              isVendor ? "Accounts Head → payment" : "Imprest closure",
            ].map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-500">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </aside>
      </div>

      {/* Mobile action bar — thumb reach, Total always visible. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white px-3 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] md:hidden">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="text-slate-500">Total payable</span>
          <b className="text-base tabular-nums text-slate-900">{money(totals.gross)}</b>
        </div>
        {actionButtons}
      </div>
    </div>
  );
}

// ─── Split allocation editor ────────────────────────────────────────────────

/**
 * The advanced path: one invoice spread over several budget lines. Renders as a
 * table from `md` up and as stacked cards below it, so a 9-column grid never
 * forces the page to scroll sideways on a phone.
 */
function SplitAllocationEditor({
  budgetLines,
  rows,
  totals,
  difference,
  error,
  onUpdate,
  onAdd,
  onRemove,
  onAutoBalance,
  canRemove,
}: {
  budgetLines: BudgetLine[];
  rows: Array<{ allocation: AllocationDraft; line?: BudgetLine; calculation: any }>;
  totals: { base: number; tax: number; gross: number; pnl: number };
  difference: number;
  error?: string;
  onUpdate: (key: string, patch: Partial<AllocationDraft>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  onAutoBalance: () => void;
  canRemove: boolean;
}) {
  const lineOptions: SearchableOption[] = budgetLines.map((line) => ({
    value: line.id,
    label: `${line.head}/${line.sub_head || GENERAL_SUB_HEAD} · ${line.item_name}`,
    hint: money(Number(line.available_gross_amount)),
    keywords: `${line.budget_number} ${line.cost_centre_name ?? ""}`,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onAutoBalance}>
          Auto-balance last row
        </Button>
        <Button type="button" size="sm" onClick={onAdd}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add row
        </Button>
      </div>

      {/* Stacked cards on phones. */}
      <div className="space-y-3 md:hidden">
        {rows.map(({ allocation, line, calculation }, index) => (
          <div key={allocation.key} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">Row {index + 1}</span>
              {canRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0"
                  aria-label={`Remove row ${index + 1}`}
                  onClick={() => onRemove(allocation.key)}
                >
                  <Trash2 className="h-4 w-4 text-slate-400" />
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <SearchableSelect
                aria-label={`Budget line for row ${index + 1}`}
                options={lineOptions}
                value={allocation.budgetLineId}
                onChange={(value) => {
                  const picked = budgetLines.find((item) => item.id === value);
                  onUpdate(allocation.key, {
                    budgetLineId: value,
                    quantity: Math.min(1, Number(picked?.available_quantity ?? 1)),
                    unitRate: Number(picked?.unit_rate ?? 0),
                  });
                }}
                placeholder="Select budget line"
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-slate-500">Qty</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="0.0001"
                    className="h-11"
                    value={allocation.quantity}
                    onChange={(event) =>
                      onUpdate(allocation.key, { quantity: Number(event.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-slate-500">Unit rate</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.0001"
                    max={line ? Number(line.unit_rate) : undefined}
                    className="h-11 text-right"
                    value={allocation.unitRate}
                    onChange={(event) =>
                      onUpdate(allocation.key, { unitRate: Number(event.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-500">Gross</span>
                <b className="tabular-nums">{money(Number(calculation?.gross ?? 0))}</b>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table from md up. */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>Budget line</TableHead>
              <TableHead className="w-24 text-center">Qty</TableHead>
              <TableHead className="w-28 text-right">Unit rate</TableHead>
              <TableHead className="w-28 text-right">Gross</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ allocation, line, calculation }, index) => (
              <TableRow key={allocation.key}>
                <TableCell className="text-xs text-slate-400">{index + 1}</TableCell>
                <TableCell className="min-w-[260px]">
                  <SearchableSelect
                    aria-label={`Budget line for row ${index + 1}`}
                    className="h-9"
                    options={lineOptions}
                    value={allocation.budgetLineId}
                    onChange={(value) => {
                      const picked = budgetLines.find((item) => item.id === value);
                      onUpdate(allocation.key, {
                        budgetLineId: value,
                        quantity: Math.min(1, Number(picked?.available_quantity ?? 1)),
                        unitRate: Number(picked?.unit_rate ?? 0),
                      });
                    }}
                    placeholder="Select budget line"
                  />
                  {line && (
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">
                      {line.cost_centre_name ?? "Branch"} · avail{" "}
                      {decimal(Number(line.available_quantity))} {line.unit}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="0.0001"
                    className="h-9 text-center"
                    value={allocation.quantity}
                    onChange={(event) =>
                      onUpdate(allocation.key, { quantity: Number(event.target.value) })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.0001"
                    max={line ? Number(line.unit_rate) : undefined}
                    className="h-9 text-right"
                    value={allocation.unitRate}
                    onChange={(event) =>
                      onUpdate(allocation.key, { unitRate: Number(event.target.value) })
                    }
                  />
                </TableCell>
                <TableCell className="text-right text-xs font-semibold tabular-nums">
                  {money(Number(calculation?.gross ?? 0))}
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={!canRemove}
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => onRemove(allocation.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-slate-400" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs",
          Math.abs(difference) <= 0.01
            ? "border-emerald-200 bg-emerald-50"
            : "border-rose-200 bg-rose-50"
        )}
      >
        <span className="font-semibold text-slate-700">
          Allocated {money(totals.gross)}
        </span>
        <span
          className={cn(
            "font-bold tabular-nums",
            Math.abs(difference) <= 0.01 ? "text-emerald-700" : "text-rose-700"
          )}
        >
          Difference {difference >= 0 ? "+" : ""}
          {money(difference)}
        </span>
      </div>

      {error && (
        <p className="flex items-start gap-1 text-[11px] font-medium text-rose-600">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
