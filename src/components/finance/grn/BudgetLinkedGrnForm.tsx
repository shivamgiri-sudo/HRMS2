import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
import { Label } from "@/components/ui/label";
// SearchableSelect deliberately stays: vendor picking is server-side searched (search /
// onSearchChange drive a query against a ~1.8k-row master), and it also supplies the hint /
// keywords matching, the mobile bottom-sheet rendering and the loading and empty states. A plain
// <select> has no search callback, so swapping it would mean dumping the whole vendor list into
// the DOM. It is restyled through the className it already forwards instead.
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
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { checkTone } from "@/components/finance/grn/grn-format";
// Aliased rather than renamed at the ~40 call sites: same props, same forwarded refs, so this is
// a swap of appearance only.
import {
  GrnButton as Button,
  GrnCard,
  GrnCardHeader,
  GrnFieldRow,
  GrnIconButton,
  GrnInput as Input,
  GrnSegmented,
  GrnTextarea as Textarea,
} from "@/components/finance/grn/grn-ui";
import {
  BRANCH_SHARING_METHODS,
  calculateBudgetLine,
  useBranchBudgetAllocations,
} from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { splitRupees, weightFor } from "@/lib/sharingWeights";
import { cn } from "@/lib/utils";

/** Methods offered for GRN's auto-split, restricted to what's computable from a single batched
 *  driver fetch. "meter_wise" has no client formula (server-only). "grade_weighted_headcount"'s
 *  real weight is a server-side blended-CTC calculation — the client stand-in branch-budget
 *  planning uses for preview is a crude plannedHeadcount proxy, wrong enough to silently misinform
 *  an actual invoice split. "manual" is the row-by-row editor itself, not an auto-split target. */
const GRN_AUTO_SPLIT_METHODS = BRANCH_SHARING_METHODS.filter(
  (method) => !["manual", "meter_wise", "grade_weighted_headcount"].includes(method.value)
);

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
//
// These three stay as local names purely so the ~200 call sites below do not all have to change
// at once; each is now a thin wrapper over the shared GRN kit, so the form inherits the page's
// spacing, type scale and palette rather than restating its own.

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
    <GrnFieldRow
      label={label}
      htmlFor={htmlFor}
      required={required}
      hint={hint}
      error={error}
      // Tints whatever control this row contains rather than threading an `invalid` prop through
      // every call site. The descendant selector also out-specifies the control's own border, so
      // it wins without !important.
      className={
        error
          ? "[&_input]:border-grn-crit [&_input]:bg-grn-crit-bg [&_textarea]:border-grn-crit [&_textarea]:bg-grn-crit-bg"
          : undefined
      }
    >
      {children}
    </GrnFieldRow>
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
    <GrnCard>
      <GrnCardHeader title={title} description={description} action={action} />
      <div>{children}</div>
    </GrnCard>
  );
}

/** Read-only value rendered at input height so rows stay on one baseline. */
function StaticValue({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-[34px] items-center text-[12.5px] font-semibold",
        muted ? "text-grn-ink-soft" : "text-grn-ink"
      )}
    >
      {children}
    </div>
  );
}

/** GrnInput already carries its own height; this exists only so the call sites that append to it
 *  (`cn(inputClass, "text-right …")`) keep working. */
const inputClass = "";

// ─── Component ──────────────────────────────────────────────────────────────

export function BudgetLinkedGrnForm() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The budget line a save attempt targeted, captured just before the risky API calls so
  // onError can still read it — an "exceeds available budget" failure needs to know which
  // line to pre-fill on the "Request a budget increase" action.
  const attemptedLineIdRef = useRef<string | null>(null);
  const [form, setForm] = useState<GrnFormState>(EMPTY_FORM);
  const [splitMode, setSplitMode] = useState(false);
  const [autoSplitMethod, setAutoSplitMethod] = useState<string>("equal_split");
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

  // Same monthly-driver data Branch Budget planning already fetches for this branch+period —
  // reused here so a split GRN's auto-split weighs cost centres the same way a budget line would.
  const { monthlyDriversQuery } = useBranchBudgetAllocations(form.branchId || null, period || null);
  const driversByCostCentre = useMemo(
    () => Object.fromEntries((monthlyDriversQuery.data ?? []).map((driver) => [driver.costCentreId, driver])),
    [monthlyDriversQuery.data]
  );

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

  /** Why "Auto-split by" is disabled right now, if it is — computed proactively so the reason is
   *  visible before the click, not discovered from a toast after it. */
  const autoSplitReadiness = useMemo((): { ready: boolean; reason: string } => {
    if (allocations.length < 2) return { ready: false, reason: "Add at least 2 rows first." };
    if (!(Number(form.amount) > 0)) return { ready: false, reason: "Enter the invoice total first." };
    if (autoSplitMethod === "equal_split") return { ready: true, reason: "" };
    const resolvedLines = allocations.map((a) => budgetLines.find((line) => line.id === a.budgetLineId));
    if (resolvedLines.some((line) => !line)) {
      return { ready: false, reason: "Pick a budget line for every row first." };
    }
    if (resolvedLines.some((line) => !line!.cost_centre_id)) {
      return { ready: false, reason: "One or more rows' budget lines have no cost centre to weigh by — use Equal split instead." };
    }
    if (resolvedLines.some((line) => !driversByCostCentre[line!.cost_centre_id!])) {
      return {
        ready: false,
        reason: "Set monthly drivers for every cost centre in this split first, in Branch Budget → Plan Builder.",
      };
    }
    return { ready: true, reason: "" };
  }, [allocations, form.amount, autoSplitMethod, budgetLines, driversByCostCentre]);

  /** Redistributes the declared invoice total across the current allocation rows by the chosen
   *  sharing method's weight, mirroring Branch Budget planning's split — but across rows that may
   *  span different budget lines (heads/sub-heads), not one line's cost-centre breakdown, so the
   *  weight lookup key is each row's own resolved cost centre rather than a shared line's. */
  function applyAutoSplit() {
    if (!autoSplitReadiness.ready) {
      toast({ title: "Can't auto-split yet", description: autoSplitReadiness.reason, variant: "destructive" });
      return;
    }
    const resolved = allocations.map((allocation) => ({
      allocation,
      line: budgetLines.find((item) => item.id === allocation.budgetLineId)!,
    }));
    const weights = resolved.map(({ line }) =>
      autoSplitMethod === "equal_split" ? 1 : weightFor(autoSplitMethod, driversByCostCentre[line.cost_centre_id!])
    );
    const targets = splitRupees(Number(form.amount), weights);
    resolved.forEach(({ allocation, line }, index) => {
      const perUnit = computeLine(line, 1, line.unit_rate);
      const grossPerUnit = Number(perUnit.gross);
      const quantity = grossPerUnit > 0 ? Number((targets[index] / grossPerUnit).toFixed(4)) : 0;
      // unitRate is left at the line's own approved rate — only quantity changes, so the
      // max={line.unit_rate} constraint on the rate input can never be violated by auto-split.
      updateAllocation(allocation.key, { quantity: Math.max(0, quantity), unitRate: Number(line.unit_rate) });
    });
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
      attemptedLineIdRef.current = firstLine.id;

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
    onError: (error: Error) => {
      const overBudget = /exceeds (the )?available budget/i.test(error.message);
      const lineId = attemptedLineIdRef.current;
      toast({
        title: "GRN could not be saved",
        description: error.message,
        variant: "destructive",
        action: overBudget && lineId
          ? {
              label: "Request a budget increase",
              onClick: () =>
                navigate(
                  `/finance/branch-budget?tab=topups&topupLine=${lineId}`
                  + `&branchId=${form.branchId}&period=${form.billDate ? form.billDate.slice(0, 7) : ""}`
                ),
            }
          : undefined,
      });
    },
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
        <GrnIconButton onClick={resetForm} aria-label="Start a new GRN" title="Start a new GRN">
          <RotateCcw className="h-3.5 w-3.5" />
        </GrnIconButton>
      )}
      <Button
        className="flex-1 md:flex-none"
        disabled={persistMutation.isPending || submitted}
        onClick={() => persistMutation.mutate(false)}
      >
        {persistMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        Save draft
      </Button>
      <Button
        variant="primary"
        className="flex-1 md:flex-none"
        disabled={persistMutation.isPending || submitted || !canSubmit}
        onClick={() => persistMutation.mutate(true)}
      >
        {persistMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
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
    <div>
      {/* Sticky on every size, and now the only action bar — the fixed bottom bar this used to
       *  share the job with collided with the layout's own fixed bottom nav (both z-30, the nav
       *  later in the DOM), so on a phone it was already losing.
       *  top offset, not top-0: the page scrolls in #main-content-area, whose first 64px are the
       *  layout's sticky TopBar at z-30. At top-0 this parks underneath it. */}
      <div className="sticky top-[var(--topbar-height)] z-20 mb-4">
        <div className="rounded-xl border border-grn-line bg-grn-card px-4 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {totalStrip}
            {actionButtons}
          </div>
        </div>
      </div>

      {submitted && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-grn-ok-line bg-grn-ok-bg px-3.5 py-3 text-[12px]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-grn-ok" />
          <p className="font-semibold text-grn-ok">
            Submitted to Branch Head with allocation-aware budget controls.
          </p>
        </div>
      )}

      {/* ── Mode ── spans both columns; it decides what the whole form asks for, so it does not
          belong inside the left one. */}
      <Tabs
        value={form.grnType}
        onValueChange={(value) =>
          !locked && setForm((current) => ({ ...current, grnType: value as GrnType }))
        }
      >
        <TabsList className="grid h-auto w-full grid-cols-2 md:w-auto md:inline-grid">
          <TabsTrigger value="vendor" disabled={locked} className="h-9 gap-2 px-4 text-sm">
            <IndianRupee className="h-4 w-4" /> Vendor GRN
          </TabsTrigger>
          <TabsTrigger value="imprest" disabled={locked} className="h-9 gap-2 px-4 text-sm">
            <UploadCloud className="h-4 w-4" /> Imprest
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Side rail collapses at 900px, matching the rest of the page, rather than at 1280px
          where it left a 380px gap unused. items-start so the rail does not stretch to the
          form's height. */}
      <div className="mt-4 grid items-start gap-4 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
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
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center transition-colors hover:border-[#073f78]/40 hover:bg-slate-100">
                <UploadCloud className="h-5 w-5 text-slate-400" />
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
                      className="flex items-center justify-between gap-2 rounded-lg border border-grn-line bg-grn-paper px-3 py-2 text-[12px]"
                    >
                      <span className="truncate text-grn-ink">{file.name}</span>
                      <StatusStamp tone="neutral">Pending upload</StatusStamp>
                    </li>
                  ))}
                  {workspace?.documents?.map((document) => {
                    const tone = checkTone(String(document.extraction_status ?? "pending"));
                    return (
                      <li
                        key={document.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12px]",
                          tone === "ok"
                            ? "border-grn-ok-line bg-grn-ok-bg"
                            : tone === "warn"
                              ? "border-grn-warn-line bg-grn-warn-bg"
                              : "border-grn-crit-line bg-grn-crit-bg"
                        )}
                      >
                        <span className="truncate font-semibold text-grn-ink">{document.original_name}</span>
                        <StatusStamp tone={tone}>
                          {Number(document.is_primary) === 1 ? "Primary" : "Support"}
                        </StatusStamp>
                      </li>
                    );
                  })}
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
                    disabled={analyzeMutation.isPending}
                    onClick={() => analyzeMutation.mutate(primaryDocument.id)}
                  >
                    {analyzeMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ScanLine className="h-3.5 w-3.5" />
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
              <Button onClick={() => setSplitMode((value) => !value)}>
                <Split className="h-3 w-3" />
                {splitMode ? "Use a single budget line" : "Split this invoice across budget lines"}
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
                  autoSplitMethod={autoSplitMethod}
                  onAutoSplitMethodChange={setAutoSplitMethod}
                  onAutoSplit={applyAutoSplit}
                  autoSplitReadiness={autoSplitReadiness}
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
                  <Button onClick={() => applyExtractedFields(effectiveExtractedFields)}>
                    Apply
                  </Button>
                  {created && (
                    <Button
                      variant="primary"
                      disabled={confirmExtractionMutation.isPending}
                      onClick={() => confirmExtractionMutation.mutate()}
                    >
                      {confirmExtractionMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <BadgeCheck className="h-3.5 w-3.5" />
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
                  disabled={!created || revalidateMutation.isPending}
                  onClick={() => revalidateMutation.mutate()}
                >
                  {revalidateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Re-run
                </Button>
              }
            >
              <ul>
                {(workspace.validations ?? []).map((validation) => (
                  <li
                    key={validation.id}
                    className="flex items-start gap-2 border-b border-grn-line-soft px-4 py-2.5 text-[12px] last:border-b-0"
                  >
                    <ShieldCheck
                      className={cn(
                        "mt-px h-3.5 w-3.5 shrink-0",
                        validation.validation_status === "passed"
                          ? "text-grn-ok"
                          : validation.validation_status === "warning"
                            ? "text-grn-warn"
                            : "text-grn-crit"
                      )}
                    />
                    <span className="text-grn-ink">{validation.message}</span>
                    {Number(validation.is_blocking) === 1 &&
                      validation.validation_status === "failed" && (
                        <StatusStamp tone="crit" className="ml-auto shrink-0">
                          Blocking
                        </StatusStamp>
                      )}
                  </li>
                ))}
              </ul>
            </FormSection>
          )}

          {/* Summary for screens without the side rail. Must track the rail's own breakpoint or
              both render at once. */}
          <div className="min-[900px]:hidden">
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

        {/* Side rail — a card in its own grid column now, not a bordered panel bolted to the
            right edge of a full-height flex row. */}
        <aside className="hidden rounded-xl border border-grn-line bg-grn-card p-4 min-[900px]:block">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Readiness</h3>
            <span
              className={cn(
                "text-xs font-bold tabular-nums",
                readiness >= 80 ? "text-emerald-600" : readiness >= 50 ? "text-amber-600" : "text-slate-400"
              )}
            >
              {readiness}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                readiness >= 80 ? "bg-emerald-500" : readiness >= 50 ? "bg-amber-500" : "bg-slate-300"
              )}
              style={{ width: `${Math.max(4, readiness)}%` }}
            />
          </div>
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
          <dl className="mt-3 space-y-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Taxable</dt>
              <dd className="tabular-nums font-medium">{money(totals.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">GST</dt>
              <dd className="tabular-nums font-medium">{money(totals.tax)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5">
              <dt className="font-semibold text-slate-700">Total</dt>
              <dd className="tabular-nums text-sm font-bold text-slate-900">{money(totals.gross)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">P&amp;L impact</dt>
              <dd className="tabular-nums font-medium text-amber-700">{money(totals.pnl)}</dd>
            </div>
          </dl>

          <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Approval path
          </h3>
          <ol className="mt-3">
            {[
              { label: "Branch Admin submits", note: submitted ? undefined : "This form" },
              { label: "Branch Head reviews", note: submitted ? "Awaiting action" : undefined },
              { label: "Finance Head reviews" },
              { label: isVendor ? "Accounts Head → payment" : "Imprest closure" },
            ].map((step, index) => {
              // Only step 1 (this form) has a real status to report — the rest genuinely aren't
              // known here, since this screen never fetches the GRN's post-submission state.
              const stepState = index === 0 ? (submitted ? "done" : "current") : index === 1 && submitted ? "current" : "upcoming";
              return (
                <li key={step.label} className="relative flex gap-2.5 pb-4 last:pb-0">
                  {index < 3 && (
                    <span
                      className={`absolute left-[9px] top-[19px] h-full w-px ${stepState === "done" ? "bg-emerald-200" : "bg-slate-200"}`}
                    />
                  )}
                  <span
                    className={`z-10 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                      stepState === "done"
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : stepState === "current"
                          ? "border-[#073f78] bg-[#073f78] text-white"
                          : "border-slate-300 bg-white text-slate-400"
                    }`}
                  >
                    {stepState === "done" ? "✓" : index + 1}
                  </span>
                  <div className="pt-px">
                    <p className={`text-xs font-medium ${stepState === "upcoming" ? "text-slate-400" : "text-slate-800"}`}>{step.label}</p>
                    {step.note && <p className="mt-0.5 text-[10.5px] text-slate-500">{step.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
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
  autoSplitMethod,
  onAutoSplitMethodChange,
  onAutoSplit,
  autoSplitReadiness,
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
  autoSplitMethod: string;
  onAutoSplitMethodChange: (method: string) => void;
  onAutoSplit: () => void;
  autoSplitReadiness: { ready: boolean; reason: string };
}) {
  const lineOptions: SearchableOption[] = budgetLines.map((line) => ({
    value: line.id,
    label: `${line.head}/${line.sub_head || GENERAL_SUB_HEAD} · ${line.item_name}`,
    hint: money(Number(line.available_gross_amount)),
    keywords: `${line.budget_number} ${line.cost_centre_name ?? ""}`,
  }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onAutoBalance}>
          Auto-balance last row
        </Button>
        <Button onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" /> Add row
        </Button>
        <div className="ml-auto flex items-center gap-1.5" title={!autoSplitReadiness.ready ? autoSplitReadiness.reason : undefined}>
          <Label className="text-[11px] text-slate-500">Split by</Label>
          <select
            aria-label="Auto-split method"
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700"
            value={autoSplitMethod}
            onChange={(event) => onAutoSplitMethodChange(event.target.value)}
          >
            {GRN_AUTO_SPLIT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>{method.label}</option>
            ))}
          </select>
          <Button disabled={!autoSplitReadiness.ready} onClick={onAutoSplit}>
            <Split className="h-3.5 w-3.5" /> Auto-split
          </Button>
        </div>
      </div>
      {!autoSplitReadiness.ready && (
        <p className="text-[11px] text-amber-700">{autoSplitReadiness.reason}</p>
      )}

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
