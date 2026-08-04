import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Circle,
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
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { checkTone } from "@/components/finance/grn/grn-format";
// Aliased rather than renamed at the ~40 call sites: same props, same forwarded refs, so this is
// a swap of appearance only.
import {
  GRN_TR,
  GrnButton as Button,
  GrnCard,
  GrnCardHeader,
  GrnCellSub,
  GrnFieldRow,
  GrnIconButton,
  GrnInput as Input,
  GrnSegmented,
  GrnSelect,
  GrnTable,
  GrnTd,
  GrnTextarea as Textarea,
  GrnTh,
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

/**
 * One readiness checklist row.
 *
 * An outstanding item gets a hollow ring, not a greyed-out tick — a faded checkmark reads as
 * "done, but disabled", which is the opposite of what it means here.
 */
function ReadyRow({ label, done, className }: { label: string; done: boolean; className?: string }) {
  return (
    <li className={cn("flex items-center gap-2 text-[12px]", className)}>
      {done ? (
        <CheckCircle2 className="h-[15px] w-[15px] shrink-0 text-grn-ok" strokeWidth={2.4} />
      ) : (
        <Circle className="h-[15px] w-[15px] shrink-0 text-grn-line" strokeWidth={2.4} />
      )}
      <span className={done ? "text-grn-ink" : "text-grn-ink-soft"}>{label}</span>
    </li>
  );
}

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
      <span className="font-grn-mono text-[14px] font-bold text-grn-brand">
        {created ? created.grnNumber : "Draft — not yet submitted"}
      </span>
      <span className="text-grn-ink-soft">
        Total:{" "}
        <b className="font-grn-mono text-[13.5px] text-grn-ink">
          {totals.gross ? money(totals.gross) : "—"}
        </b>
      </span>
      <StatusStamp tone={readiness >= 80 ? "ok" : readiness >= 50 ? "warn" : "neutral"}>
        {readiness}% ready
      </StatusStamp>
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
        <div className="rounded-[12px] border border-grn-line bg-grn-card px-4 py-2.5">
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
      <GrnSegmented
        label="GRN type"
        value={form.grnType}
        disabled={locked}
        onChange={(value) => setForm((current) => ({ ...current, grnType: value }))}
        options={[
          { value: "vendor" as GrnType, label: <><IndianRupee className="h-4 w-4" /> Vendor GRN</> },
          { value: "imprest" as GrnType, label: <><UploadCloud className="h-4 w-4" /> Imprest</> },
        ]}
      />

      {/* Side rail collapses at 900px, matching the rest of the page, rather than at 1280px
          where it left a 380px gap unused. items-start so the rail does not stretch to the
          form's height. */}
      <div className="mt-[16px] grid items-start gap-[16px] min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-[16px]">
          {showErrors && hasErrors && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[10px] border border-grn-crit-line bg-grn-crit-bg px-3.5 py-3 text-[12px] text-grn-crit"
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
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-grn-line bg-grn-paper px-4 py-[22px] text-center transition-colors hover:border-grn-brand">
                <UploadCloud className="h-[26px] w-[26px] text-grn-ink-soft" strokeWidth={1.6} />
                <span className="text-[13px] font-bold text-grn-ink">
                  Tap to attach invoice or receipt
                </span>
                <span className="text-[11px] text-grn-ink-soft">
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
                      className="flex items-center justify-between gap-2 rounded-[8px] border border-grn-line bg-grn-paper px-3 py-2 text-[12px]"
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
                          "flex items-center justify-between gap-2 rounded-[8px] border px-3 py-2 text-[12px]",
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
                <label className="flex items-center gap-2 text-[11.5px] text-grn-ink-soft">
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
              <div className="px-4 py-4 text-[12px] text-grn-warn">
                Select the branch and date first to load approved budgets.
              </div>
            ) : linesLoading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-[12px] text-grn-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading approved budgets…
              </div>
            ) : !budgetLines.length ? (
              <div className="px-4 py-4 text-[12px] text-grn-warn">
                No approved budget line is available for {period}. Branch Head, Finance Head and
                Accounts Head approval must be completed first.
              </div>
            ) : splitMode ? (
              <div className="px-4 py-4 text-[12px] text-grn-ink-soft">
                Budget lines are chosen per row in the split editor below.
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
                      <span className="text-[12px] font-normal text-grn-ink-soft">
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

          {/* Its own card, not a block nested inside the one above: it has its own toolbar and
              its own reconciliation footer, which a section body has nowhere to put. */}
          {splitMode && Boolean(form.branchId) && Boolean(period) && !linesLoading && budgetLines.length > 0 && (
            <SplitAllocationEditor
              budgetLines={budgetLines}
              rows={calculatedAllocations}
              totals={splitTotals}
              difference={splitDifference}
              invoiceGross={Number(form.amount || 0)}
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
          )}

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

            <div className="border-b border-grn-line-soft bg-grn-paper px-4 py-3">
              <dl className="ml-auto w-full space-y-1.5 text-[12px] md:max-w-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-grn-ink-soft">Taxable value</dt>
                  <dd className="font-grn-mono font-semibold text-grn-ink">{money(totals.base)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-grn-ink-soft">GST</dt>
                  <dd className="font-grn-mono font-semibold text-grn-ink">{money(totals.tax)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-grn-line pt-1.5">
                  <dt className="font-bold text-grn-ink">Total payable</dt>
                  <dd className="font-grn-mono text-[13px] font-bold text-grn-ink">
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
                  <div key={String(label)} className="rounded-[8px] border border-grn-line bg-grn-paper p-2.5">
                    <p className="text-[10px] uppercase tracking-[0.05em] text-grn-ink-soft">{label}</p>
                    <p className="mt-0.5 truncate text-[12px] font-semibold text-grn-ink">
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
              <ul>
                {checklist.map((item) => (
                  <ReadyRow
                    key={item.label}
                    label={item.label}
                    done={item.done}
                    className="border-b border-grn-line-soft px-4 py-2.5 last:border-b-0"
                  />
                ))}
              </ul>
            </FormSection>
          </div>
        </div>

        {/* Side rail — a card in its own grid column now, not a bordered panel bolted to the
            right edge of a full-height flex row. */}
        <aside className="hidden rounded-[12px] border border-grn-line bg-grn-card p-4 min-[900px]:block">
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
            Readiness — {readiness}%
          </h3>
          <div className="mb-3 mt-2 h-1.5 w-full overflow-hidden rounded-full bg-grn-line-soft">
            <div
              className="h-full rounded-full bg-grn-ok transition-[width]"
              style={{ width: `${Math.max(4, readiness)}%` }}
            />
          </div>
          <ul className="space-y-1">
            {checklist.map((item) => (
              <ReadyRow key={item.label} label={item.label} done={item.done} className="py-1" />
            ))}
          </ul>

          <h3 className="mt-[18px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
            Cost
          </h3>
          <dl className="mt-2.5 space-y-1 rounded-[10px] border border-grn-line bg-grn-paper p-3 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-grn-ink-soft">Taxable</dt>
              <dd className="font-grn-mono">{money(totals.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-grn-ink-soft">GST</dt>
              <dd className="font-grn-mono">{money(totals.tax)}</dd>
            </div>
            <div className="mt-1 flex justify-between border-t border-grn-line pt-[7px] text-[13px] font-bold">
              <dt>Total</dt>
              <dd className="font-grn-mono">{money(totals.gross)}</dd>
            </div>
            <div className="flex justify-between text-grn-warn">
              <dt>P&amp;L impact</dt>
              <dd className="font-grn-mono">{money(totals.pnl)}</dd>
            </div>
          </dl>

          <h3 className="mt-[18px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
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
                <li key={step.label} className="relative flex gap-2.5 pb-5 last:pb-0">
                  {index < 3 && (
                    <span
                      className={`absolute left-[11px] top-6 h-full w-[1.5px] ${stepState === "done" ? "bg-grn-ok-line" : "bg-grn-line"}`}
                    />
                  )}
                  <span
                    className={`z-10 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[10px] font-bold ${
                      stepState === "done"
                        ? "border-grn-ok bg-grn-ok text-white"
                        : stepState === "current"
                          ? "border-grn-brand bg-grn-brand text-white"
                          : "border-grn-line bg-grn-card text-grn-ink-soft"
                    }`}
                  >
                    {stepState === "done" ? "✓" : index + 1}
                  </span>
                  <div className="pt-px">
                    <p className={`text-[12px] font-semibold ${stepState === "upcoming" ? "text-grn-ink-soft" : "text-grn-ink"}`}>{step.label}</p>
                    {step.note && <p className="mt-px text-[10.5px] text-grn-ink-soft">{step.note}</p>}
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
  invoiceGross,
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
  /** The invoice amount the rows have to add up to — shown beside the split total so the
   *  reconciliation names both figures rather than only their difference. */
  invoiceGross: number;
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

  const reconciled = Math.abs(difference) <= 0.01;

  return (
    <GrnCard>
      <GrnCardHeader
        title="Split across budget lines"
        description="Each row consumes its own approved budget line. The rows must add up to the invoice."
        action={
          <div
            className="flex flex-wrap items-center gap-1.5"
            title={!autoSplitReadiness.ready ? autoSplitReadiness.reason : undefined}
          >
            <Label className="sr-only" htmlFor="grn-autosplit-method">Auto-split method</Label>
            <GrnSelect
              small
              id="grn-autosplit-method"
              value={autoSplitMethod}
              onChange={(event) => onAutoSplitMethodChange(event.target.value)}
            >
              {GRN_AUTO_SPLIT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>{method.label}</option>
              ))}
            </GrnSelect>
            <Button disabled={!autoSplitReadiness.ready} onClick={onAutoSplit}>
              <Split className="h-3.5 w-3.5" /> Auto-split
            </Button>
            <Button onClick={onAutoBalance}>Auto-balance last row</Button>
            <Button onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" /> Add row
            </Button>
          </div>
        }
      />
      {!autoSplitReadiness.ready && (
        <p className="border-b border-grn-line-soft px-4 py-2 text-[11px] text-grn-warn">
          {autoSplitReadiness.reason}
        </p>
      )}

      {/* Stacked cards on phones. */}
      <div className="space-y-3 p-4 md:hidden">
        {rows.map(({ allocation, line, calculation }, index) => (
          <div key={allocation.key} className="rounded-[10px] border border-grn-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-grn-mono text-[12px] font-bold text-grn-ink-soft">Row {index + 1}</span>
              {canRemove && (
                <GrnIconButton
                  className="h-11 w-11"
                  aria-label={`Remove row ${index + 1}`}
                  onClick={() => onRemove(allocation.key)}
                >
                  <Trash2 className="h-4 w-4" />
                </GrnIconButton>
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
                  <Label className="text-[11px] text-grn-ink-soft">Qty</Label>
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
                  <Label className="text-[11px] text-grn-ink-soft">Unit rate</Label>
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
              <div className="flex justify-between rounded-[8px] border border-grn-line bg-grn-paper px-3 py-2 text-[12px]">
                <span className="text-grn-ink-soft">Gross</span>
                <b className="font-grn-mono">{money(Number(calculation?.gross ?? 0))}</b>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table from md up. */}
      <div className="hidden md:block">
        <GrnTable minWidth={720}>
          <thead>
            <tr>
              <GrnTh sticky={false} className="w-8">#</GrnTh>
              <GrnTh sticky={false}>Budget line</GrnTh>
              <GrnTh sticky={false}>Cost centre</GrnTh>
              <GrnTh sticky={false} align="right" className="w-24">Qty</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">Unit rate</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">Gross</GrnTh>
              <GrnTh sticky={false} className="w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ allocation, line, calculation }, index) => (
              <tr key={allocation.key} className={GRN_TR}>
                <GrnTd className="font-grn-mono text-grn-ink-soft">{index + 1}</GrnTd>
                <GrnTd className="min-w-[260px]">
                  <SearchableSelect
                    aria-label={`Budget line for row ${index + 1}`}
                    className="h-[34px]"
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
                </GrnTd>
                {/* Its own column now. As a caption under the select it read as part of the
                    line's name, when it is the other half of what identifies the budget. */}
                <GrnTd className="max-w-[180px]">
                  {line ? (
                    <>
                      <p className="truncate">{line.cost_centre_name ?? "Branch"}</p>
                      <GrnCellSub>
                        avail {decimal(Number(line.available_quantity))} {line.unit}
                      </GrnCellSub>
                    </>
                  ) : (
                    <span className="text-grn-ink-soft">—</span>
                  )}
                </GrnTd>
                <GrnTd>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.0001"
                    step="0.0001"
                    className="text-right"
                    value={allocation.quantity}
                    onChange={(event) =>
                      onUpdate(allocation.key, { quantity: Number(event.target.value) })
                    }
                  />
                </GrnTd>
                <GrnTd>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.0001"
                    max={line ? Number(line.unit_rate) : undefined}
                    className="text-right"
                    value={allocation.unitRate}
                    onChange={(event) =>
                      onUpdate(allocation.key, { unitRate: Number(event.target.value) })
                    }
                  />
                </GrnTd>
                <GrnTd align="right" className="font-semibold">
                  {money(Number(calculation?.gross ?? 0))}
                </GrnTd>
                <GrnTd>
                  <GrnIconButton
                    disabled={!canRemove}
                    aria-label={`Remove row ${index + 1}`}
                    onClick={() => onRemove(allocation.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </GrnIconButton>
                </GrnTd>
              </tr>
            ))}
          </tbody>
        </GrnTable>
      </div>

      {/* Reconciliation, stated as the two figures that have to agree rather than as a signed
          difference — "Difference +₹250" left the reader to work out against what. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grn-line-soft px-4 py-2.5 text-[12px]">
        <span className="text-grn-ink-soft">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-grn-ink-soft">
            Split total <b className="font-grn-mono text-grn-ink">{money(totals.gross)}</b> · Invoice{" "}
            <b className="font-grn-mono text-grn-ink">{money(invoiceGross)}</b>
          </span>
          {reconciled ? (
            <StatusStamp tone="ok">Reconciled</StatusStamp>
          ) : (
            <StatusStamp tone="crit">
              Out by {difference >= 0 ? "+" : ""}{money(difference)}
            </StatusStamp>
          )}
        </span>
      </div>

      {error && (
        <p className="flex items-start gap-1 border-t border-grn-line-soft px-4 py-2.5 text-[11px] font-semibold text-grn-crit">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </GrnCard>
  );
}
