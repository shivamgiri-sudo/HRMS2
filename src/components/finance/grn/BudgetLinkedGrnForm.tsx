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
  XCircle,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
// SearchableSelect deliberately stays: vendor picking is server-side searched (search /
// onSearchChange drive a query against a ~1.8k-row master), and it also supplies the hint /
// keywords matching, the mobile bottom-sheet rendering and the loading and empty states. A plain
// <select> has no search callback, so swapping it would mean dumping the whole vendor list into
// the DOM. It is restyled through the className it already forwards instead.
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import { StatusStamp } from "@/components/finance/grn/StatusStamp";
import { GrnBudgetImportButton } from "@/components/finance/grn/GrnBudgetImportButton";
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
  DenseFieldGroup,
  DenseField,
  DenseSection,
  DenseSummaryStrip,
  DenseFileUpload,
} from "@/components/finance/grn/legacy-grn-ui";
import {
  BRANCH_SHARING_METHODS,
  calculateBudgetLine,
  useBranchBudgetAllocations,
} from "@/hooks/useBranchBudget";
import { useToast } from "@/hooks/use-toast";
import { useHasRole } from "@/hooks/useUserRole";
import { GST_RATES } from "@/lib/gst";
import { hrmsApi } from "@/lib/hrmsApi";
import { splitRupees, weightFor } from "@/lib/sharingWeights";
import { cn } from "@/lib/utils";
import { GST_STATE_CODES, deriveGstType, extractStateCodeFromGstin } from "@/lib/indian-states";
import { Switch } from "@/components/ui/switch";
import { FieldRow, FormSection, StaticValue } from "./sections/form-primitives";
import {
  MonthSplitPanel,
  windowCrossesFinancialYear,
  type MonthSplitValue,
} from "./sections/MonthSplitPanel";

/** Methods offered for GRN's auto-split, restricted to what's computable from a single batched
 *  driver fetch. "meter_wise" has no client formula (server-only). "grade_weighted_headcount"'s
 *  real weight is a server-side blended-CTC calculation — the client stand-in branch-budget
 *  planning uses for preview is a crude plannedHeadcount proxy, wrong enough to silently misinform
 *  an actual invoice split. "manual" is the row-by-row editor itself, not an auto-split target. */
const GRN_AUTO_SPLIT_METHODS = [
  // "Direct to cost centre" - user picks one cost centre to receive 100%
  { value: "direct", label: "Direct to cost centre" },
  ...BRANCH_SHARING_METHODS.filter(
    (method) => !["manual", "meter_wise", "grade_weighted_headcount"].includes(method.value)
  ),
];

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
  /** This cost centre's planned share of a BRANCH-LEVEL line, and what it has already committed
   *  against it. Advisory only — the GRN engine gates on the line, never on the cost centre — so
   *  these exist to make an over-share GRN visible before it is raised. Null/absent for a line
   *  already direct to one cost centre, where available_gross_amount is already the answer. */
  cost_centre_allocated_amount?: number | string | null;
  cost_centre_committed_amount?: number | string | null;
};

type AllocationDraft = {
  key: string;
  budgetLineId: string;
  quantity: number;
  unitRate: number;
  remarks: string;
};

// ── Unified vendor-GRN flow: one Head/Sub-head classification split by percentage across cost
// centres, plus the invoice broken into repeatable {amount without tax, GST slab} components —
// the same real invoice routinely carries 2+ GST rates. Vendor-only; imprest keeps AllocationDraft
// / splitMode / SplitAllocationEditor above, completely untouched.

type CostCentreSplitDraft = {
  key: string;
  costCentreKey: string;
  budgetLineId: string;
  percentage: number;
  /** Whether this cost centre is included in the split. Defaults to true.
   *  User can uncheck to exclude specific cost centres from the split calculation. */
  included: boolean;
};

type InvoiceComponentDraft = {
  key: string;
  amountWithoutTax: number;
  gstRate: number;
  remarks: string;
  /** HSN (goods) or SAC (services) code from the physical invoice — optional. */
  hsnSacCode: string;
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
  /** YYYY-MM override: empty means derive from billDate. Only finance_head/accounts_head/super_admin
   *  may set a value different from the bill date month — period-end cut-off bookings. */
  accountingPeriod: string;
  irn: string;
  irnAckNo: string;
  /** Mandatory when bill date is >30 days old and user is not finance_head/accounts_head/super_admin */
  lateInvoiceReason: string;
  /** Legal entity this GRN is raised under (MAS / IDC / Pikquick). */
  companyCode: string;
  /** GST Enable toggle — explicit Yes/No. null means "auto" from budget line. */
  gstEnabled: boolean | null;
  /** 2-digit GST state code of the vendor (e.g., "09" for UP). */
  vendorStateCode: string;
  /** 2-digit GST state code of the billing branch (e.g., "07" for Delhi). */
  billingStateCode: string;
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
  invoiceComponents: Array<Record<string, any>>;
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
  accountingPeriod: "",
  irn: "",
  irnAckNo: "",
  lateInvoiceReason: "",
  companyCode: "",
  gstEnabled: null,
  vendorStateCode: "",
  billingStateCode: "",
};

function newAllocation(): AllocationDraft {
  return { key: crypto.randomUUID(), budgetLineId: "", quantity: 1, unitRate: 0, remarks: "" };
}

function newInvoiceComponent(): InvoiceComponentDraft {
  return { key: crypto.randomUUID(), amountWithoutTax: 0, gstRate: 18, remarks: "", hsnSacCode: "" };
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function financialYearFromPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return "—";
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

/**
 * Day count out of vendor_master.payment_terms, which is free text ("Net 30", "30 days", "45").
 *
 * Returns null when no sensible number is present, so the caller leaves whatever the raiser
 * already has rather than inventing a date. Bounded to the same 0..365 range grn.service.ts
 * validates server-side, so a nonsense term can never seed a value the API would then reject.
 */
function parsePaymentTermDays(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  const days = Number(match[0]);
  if (!Number.isInteger(days) || days < 0 || days > 365) return null;
  return days;
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

export function BudgetLinkedGrnForm({
  editGrnId,
  onEditComplete,
}: {
  editGrnId?: string | null;
  onEditComplete?: () => void;
} = {}) {
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
  // G15: Vendor GRN cost-centre split method (same concept as imprest's autoSplitMethod)
  const [costCentreSplitMethod, setCostCentreSplitMethod] = useState<string>("equal_split");
  const [allocations, setAllocations] = useState<AllocationDraft[]>([newAllocation()]);
  const [costCentreSplits, setCostCentreSplits] = useState<CostCentreSplitDraft[]>([]);
  const [invoiceComponents, setInvoiceComponents] = useState<InvoiceComponentDraft[]>([newInvoiceComponent()]);
  const [files, setFiles] = useState<File[]>([]);
  const [created, setCreated] = useState<CreatedGrn | null>(
    editGrnId ? { id: editGrnId, grnNumber: "…", submitted: false } : null
  );
  const [prefilledForEdit, setPrefilledForEdit] = useState(!editGrnId);
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [extractedFields, setExtractedFields] = useState<Record<string, any> | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  // Item 10: fresh-create submit success no longer auto-resets silently — it opens this
  // confirmation modal instead, which resets (or offers "create another") on explicit click.
  // Edit-and-resubmit (editGrnId set) is unaffected: that path still calls resetForm directly.
  const [submittedGrn, setSubmittedGrn] = useState<{ grnNumber: string } | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  // Multi-month recognition (Req 5). Both blank keeps the GRN single-month, which is what it
  // has always been and what every historical row already is.
  const [monthSplit, setMonthSplit] = useState<MonthSplitValue>({ startPeriod: "", endPeriod: "" });

  const isVendor = form.grnType === "vendor";
  const period = form.billDate ? form.billDate.slice(0, 7) : "";
  // Finance Head / Accounts Head / Super Admin / Branch Admin may override the accounting month —
  // e.g. to book a late March invoice into February's period after month-end close. The override
  // only changes which budget lines are queried and which period is consumed; the invoice date stays as typed.
  /**
   * TWO FLAGS, because the server enforces two different things and this file used to conflate
   * them into one.
   *
   * 139ee3b7 ("feat(grn): allow branch_admin to override accounting period") added
   * branch_admin to the single canOverridePeriod flag. But that one flag was gating THREE
   * separate server authorizations, and the server only widened for one of them:
   *
   *   accounting-period override -> grn-smart.routes.ts canOverridePeriod  (branch_admin: YES)
   *   round-off tolerance 500/1  -> grn-smart.service.ts isElevatedRole    (branch_admin: NO)
   *   late-invoice reason needed -> grn-smart.routes.ts isRestrictedRole   (branch_admin: NO,
   *                                 it is named there as a RESTRICTED role)
   *
   * So a branch_admin was shown a form that promised a Rs 500 round-off allowance and no
   * late-invoice justification, then had the submission rejected server-side — a UI writing
   * cheques the API does not honour. Splitting the flag is what makes that commit's intent
   * (period override for branch_admin) true without silently granting two money controls
   * nobody asked for.
   *
   * Keep these in step with their named server counterparts, not with each other.
   */
  const canOverridePeriod = useHasRole("finance_head", "accounts_head", "super_admin", "branch_admin");
  const isFinanceLead = useHasRole("finance_head", "accounts_head", "super_admin");
  const effectivePeriod = form.accountingPeriod || period;

  const { data: branchResponse } = useQuery({
    queryKey: ["grn-budget-branches"],
    // include_duplicates=1 for the same reason the Branch Budget workspace needs it:
    // branch_master holds real, DISTINCT branches sharing a name in different case ("Head Office"
    // Mumbai vs "HEAD OFFICE" Noida — see sql/1115_reactivate_operational_branches.sql, which
    // warns against merging them). The default listing dedupes same-named rows to one arbitrary
    // survivor, so this picker silently resolved "Head Office" to whichever sorted first and a
    // GRN could be raised against the wrong branch entirely.
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200&include_duplicates=1"),
  });

  const { data: companiesResponse } = useQuery({
    queryKey: ["finance-companies"],
    queryFn: () => hrmsApi.get<any>("/api/finance/companies"),
    staleTime: 60 * 60 * 1000,
  });
  const companies: Array<{ company_code: string; company_name: string }> = useMemo(
    () => unwrapList(companiesResponse) as any[],
    [companiesResponse]
  );

  // Vendor master holds ~1.8k active rows, so the list is searched server-side
  // rather than dumped into the picker.
  const { data: vendorResponse, isFetching: vendorsLoading } = useQuery({
    queryKey: ["grn-vendor-search", vendorSearch, form.branchId],
    enabled: isVendor,
    queryFn: () =>
      hrmsApi.get<any>(
        // branchId applies the Vendor Master's branch applicability. Without it a vendor
        // restricted to another branch still appears here — which is the one place the
        // restriction is supposed to bite, since this is where a vendor gets chosen.
        // Vendors with no applicability rows are unaffected, so the list is unchanged for
        // all 1,821 of them today.
        `/api/erp/vendors?is_active=1&limit=50&q=${encodeURIComponent(vendorSearch.trim())}`
          + (form.branchId ? `&branchId=${encodeURIComponent(form.branchId)}` : "")
      ),
  });

  // Requirement 2's server-side authority for "which heads may this vendor be booked against":
  // {mapped to this vendor} ∩ {approved budget with headroom for this branch+period}. Built and
  // live for months (vendor-expense-mapping.service.ts, the Vendor Master mapping tab) but never
  // called from this form — vendorHeadOptions below picked from the full master regardless of
  // which vendor was selected. Only fetched once branch/period/vendor are all known, same
  // preconditions the endpoint itself requires.
  const { data: expenseSelectableResponse } = useQuery({
    queryKey: ["expense-selectable", form.vendorId, form.branchId, effectivePeriod],
    enabled: Boolean(isVendor && form.vendorId && form.branchId && effectivePeriod),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/expense-selectable?vendorId=${encodeURIComponent(form.vendorId)}`
          + `&branchId=${encodeURIComponent(form.branchId)}`
          + `&periodCode=${encodeURIComponent(effectivePeriod)}`
      ),
    staleTime: 60 * 1000,
  });
  // { enforced, vendorHasMappings, selectable: [{head_name, sub_head_name, available_amount}],
  //   reason, mappedButUnbudgeted: [{head_name, sub_head_name}] } — see
  // vendor-expense-mapping.service.ts's SelectableResult for the authoritative shape.
  const expenseSelectable = expenseSelectableResponse?.data as {
    enforced: boolean;
    vendorHasMappings: boolean;
    selectable: Array<{ head_name: string; sub_head_name: string; available_amount: number }>;
    reason?: string;
    mappedButUnbudgeted: Array<{ head_name: string; sub_head_name: string }>;
  } | undefined;

  const branches = unwrapList(branchResponse).filter(
    (branch) => Number(branch.active_status ?? 1) === 1
  );
  /* Appends city/code only to names that actually collide, so every other branch label is
   * unchanged. Mirrors branchLabel() in BranchBudgetManagementWorkspace.tsx. */
  const grnBranchNameCounts = new Map<string, number>();
  for (const b of branches) {
    const key = String((b as any).branch_name ?? (b as any).name ?? "").trim().toLocaleLowerCase();
    grnBranchNameCounts.set(key, (grnBranchNameCounts.get(key) ?? 0) + 1);
  }
  const branchLabel = (branch: any): string => {
    const name = branch.branch_name ?? branch.name ?? "";
    const key = String(name).trim().toLocaleLowerCase();
    if ((grnBranchNameCounts.get(key) ?? 0) <= 1) return name;
    const disambiguator = branch.city ?? branch.branch_code;
    return disambiguator ? `${name} (${disambiguator})` : name;
  };

  const vendors = unwrapList(vendorResponse);

  const { data: lineResponse, isLoading: linesLoading } = useQuery({
    queryKey: ["available-budget-lines", form.branchId, effectivePeriod],
    enabled: Boolean(form.branchId && effectivePeriod && !created?.submitted),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/pnl/budget-lines/available?branchId=${encodeURIComponent(
          form.branchId
        )}&period=${encodeURIComponent(effectivePeriod)}`
      ),
  });
  const budgetLines = unwrapList(lineResponse) as BudgetLine[];

  // Authoritative headroom check (Group C: budget-headroom-gate.service.ts, already enforced
  // server-side at save time). This is advisory-only UI reading the same coverage decision the
  // backend gate makes, so the raiser sees the real blocking reason before they even attempt to
  // save, instead of the old client-only isUnbudgetedExpense heuristic's now-stale wording.
  const { data: headroomResponse, isLoading: headroomLoading } = useQuery({
    queryKey: ["budget-headroom", form.branchId, effectivePeriod, form.head, form.subHead],
    enabled: Boolean(isVendor && form.branchId && effectivePeriod && form.head && form.subHead),
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/finance/pnl/budget-headroom?branchId=${encodeURIComponent(form.branchId)}`
        + `&period=${encodeURIComponent(effectivePeriod)}`
        + `&head=${encodeURIComponent(form.head)}`
        + `&subHead=${encodeURIComponent(form.subHead)}`
      ),
  });
  const headroom = unwrapData<{ headerActive: boolean; hasAnyLine: boolean; aggregateAvailable: number } | undefined>(
    headroomResponse
  );

  // Expense master: all active heads/subheads regardless of budget linkage.
  // Used to show "No budget" indicator for heads not covered by the current period's budget.
  const { data: expenseMasterResponse } = useQuery({
    queryKey: ["expense-masters-all"],
    queryFn: () => hrmsApi.get<any>("/api/finance/expense-masters"),
    staleTime: 10 * 60 * 1000,
  });
  const allExpenseMasterHeads: string[] = useMemo(() => {
    // API returns { success, data: [{headName, subHeads}, ...] }
    const list = unwrapList(expenseMasterResponse) as Array<{ headName?: string }>;
    return list.map((h) => String(h.headName ?? "")).filter(Boolean);
  }, [expenseMasterResponse]);

  // Maps head_code (lowercase) → head_name so budget lines stored with head_code can be
  // matched against form.head which always holds the head_name from the dropdown.
  const headCodeToName = useMemo(() => {
    const list = unwrapList(expenseMasterResponse) as Array<{ headCode?: string; headName?: string }>;
    const map = new Map<string, string>();
    for (const h of list) {
      const code = String(h.headCode ?? "").trim().toLowerCase();
      const name = String(h.headName ?? "").trim();
      if (code && name) map.set(code, name);
    }
    return map;
  }, [expenseMasterResponse]);

  // Sub-heads from expense master for the selected head (for unbudgeted heads). Moved up from
  // beside the vendor cascade so both the vendor and imprest Head/Sub-head options (below) can
  // read it — declaration order matters here since both are useMemo factories evaluated during
  // render, not hoisted function declarations.
  const allExpenseMasterSubHeads: string[] = useMemo(() => {
    const list = unwrapList(expenseMasterResponse) as Array<{ headName?: string; subHeads?: Array<{ subHeadName?: string }> }>;
    const headEntry = list.find((h) => h.headName === form.head);
    return (headEntry?.subHeads ?? []).map((sh) => String(sh.subHeadName ?? "")).filter(Boolean);
  }, [expenseMasterResponse, form.head]);

  // Same monthly-driver data Branch Budget planning already fetches for this branch+period —
  // reused here so a split GRN's auto-split weighs cost centres the same way a budget line would.
  // Also fetch costCentresQuery to get ALL active cost centres for the branch (not just from budget lines).
  const { monthlyDriversQuery, costCentresQuery } = useBranchBudgetAllocations(form.branchId || null, period || null);
  const driversByCostCentre = useMemo(
    () => Object.fromEntries((monthlyDriversQuery.data ?? []).map((driver) => [driver.costCentreId, driver])),
    [monthlyDriversQuery.data]
  );
  /** All active cost centres for this branch — used for vendor GRN cost-centre split when the
   *  budget line is branch-common (no specific cost centre). This mirrors Branch Budget's behavior. */
  const activeCostCentres = useMemo(() => costCentresQuery.data ?? [], [costCentresQuery.data]);

  const workspaceQuery = useQuery({
    queryKey: ["smart-grn-workspace", created?.id ?? editGrnId],
    enabled: Boolean(created?.id ?? editGrnId),
    queryFn: () => {
      const id = created?.id ?? editGrnId!;
      return hrmsApi.get<any>(`/api/finance/grns/${id}/workspace`);
    },
  });
  const workspace = workspaceQuery.data
    ? unwrapData<WorkspacePayload>(workspaceQuery.data)
    : null;

  // Poll for real GRN status after submission so the approval path widget reflects live state.
  const submittedGrnId = created?.submitted ? created.id : null;
  const submittedStatusQuery = useQuery({
    queryKey: ["grn-submitted-status", submittedGrnId],
    enabled: Boolean(submittedGrnId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/finance/grns/${submittedGrnId}/workspace`);
      return (res?.grn ?? res?.data?.grn ?? res?.data ?? res) as { status: string } | null;
    },
  });
  const liveStatus = submittedStatusQuery.data?.status ?? null;

  // Reset to fresh edit mode whenever editGrnId changes (makes pre-fill
  // correct regardless of whether the parent unmounts this component or not).
  /**
   * Seed Billing State (the MAS side of the GST determination) from the selected branch.
   *
   * branch_master.gst_state_code was backfilled for 40 of 45 branches by
   * sql/1243_backfill_branch_gst_state_code.sql, yet this field was a plain dropdown the raiser
   * had to set by hand on every GRN — the one value on the form that is never a judgement call,
   * since it is fixed by where the branch physically is. Only ever fills a BLANK field, so a
   * deliberate override and a loaded existing GRN are both left alone.
   */
  useEffect(() => {
    if (form.billingStateCode) return;
    if (!form.branchId) return;
    const branch = branches.find((b: any) => b.id === form.branchId);
    const code = String((branch as any)?.gst_state_code ?? "").trim();
    if (!code) return;
    setForm((current) => (current.billingStateCode ? current : { ...current, billingStateCode: code }));
  }, [form.branchId, form.billingStateCode, branches]);

  useEffect(() => {
    if (!editGrnId) return;
    setCreated({ id: editGrnId, grnNumber: "…", submitted: false });
    setPrefilledForEdit(false);
    setForm(EMPTY_FORM);
  }, [editGrnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill form state when editing a rejected GRN. Runs once when workspace loads.
  useEffect(() => {
    if (prefilledForEdit || !workspace?.grn) return;
    const g = workspace.grn;
    setForm({
      ...EMPTY_FORM,
      grnType: (String(g.grn_type ?? "vendor")) as GrnType,
      branchId: String(g.branch_id ?? ""),
      billDate: String(g.bill_date ?? "").slice(0, 10),
      accountingPeriod: String(g.accounting_period ?? ""),
      vendorId: String(g.vendor_id ?? ""),
      invoiceNumber: String(g.invoice_number ?? ""),
      vendorGstin: String(g.vendor_gstin ?? ""),
      placeOfSupply: String(g.place_of_supply ?? ""),
      purchaseReference: String(g.purchase_reference ?? ""),
      irn: String(g.irn ?? ""),
      irnAckNo: String(g.irn_ack_no ?? ""),
      amount: Number(g.amount_with_tax ?? g.amount ?? 0),
      head: String(g.head ?? ""),
      subHead: String(g.sub_head ?? ""),
      paymentTermsDays: Number(g.payment_terms_days ?? 30),
      remarks: String(g.remarks ?? ""),
      lateInvoiceReason: String(g.late_invoice_reason ?? ""),
      companyCode: String(g.company_code ?? ""),
      gstEnabled: g.gst_enabled != null ? Boolean(g.gst_enabled) : null,
      vendorStateCode: String(g.vendor_state_code ?? ""),
      billingStateCode: String(g.billing_state_code ?? ""),
    });
    setCreated({ id: String(g.id), grnNumber: String(g.grn_number ?? editGrnId ?? "") || "…", submitted: false });
    if (workspace.invoiceComponents?.length) {
      setInvoiceComponents(
        workspace.invoiceComponents.map((ic) => ({
          key: crypto.randomUUID(),
          amountWithoutTax: Number(ic.amount_without_tax),
          gstRate: Number(ic.gst_rate),
          remarks: String(ic.remarks ?? ""),
          hsnSacCode: String(ic.hsn_sac_code ?? ""),
        }))
      );
    }
    if (workspace.allocations?.length) {
      const ccMap = new Map<string, { budgetLineId: string; pct: number }>();
      for (const alloc of workspace.allocations) {
        const ccKey = String(alloc.cost_centre_id ?? "__none__");
        const existing = ccMap.get(ccKey) ?? { budgetLineId: String(alloc.budget_line_id), pct: 0 };
        existing.pct = Math.round((existing.pct + Number(alloc.allocation_percentage)) * 1_000_000) / 1_000_000;
        ccMap.set(ccKey, existing);
      }
      setCostCentreSplits(
        // included must be set here, not left to the re-seed effect. These rows are rebuilt from
        // allocations already PERSISTED against the GRN, so by definition each was included when
        // the GRN was saved. Omitting the field left it undefined, and the submit filter
        // (`row.included && ...`) treats undefined as excluded — so whenever the re-seed effect
        // did not happen to run after this prefill, editing a saved GRN dropped every
        // cost-centre allocation on save. The re-seed effect's own default is
        // `existing?.included ?? hasBudgetLine`, which preserves whatever is set here.
        [...ccMap.entries()].map(([ccKey, data]) => ({
          key: crypto.randomUUID(),
          costCentreKey: ccKey,
          budgetLineId: data.budgetLineId,
          percentage: Math.round(data.pct * 1000) / 1000,
          included: true,
        }))
      );
    }
    setPrefilledForEdit(true);
  }, [workspace, prefilledForEdit, editGrnId]);

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
    // Merge in every active cost centre for the branch, not only ones that already have a
    // budget line — mirrors vendorCostCentreGroups' use of the same activeCostCentres list.
    // Without this, a cost centre with no budget line raised yet couldn't be selected at all,
    // which cascaded into Head/Sub-head being unreachable for it too.
    activeCostCentres.forEach((cc) => {
      if (!seen.has(cc.id)) {
        seen.set(cc.id, cc.costCentreName || cc.costCentreCode || "Cost centre");
      }
    });
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [budgetLines, activeCostCentres]);

  const linesInCostCentre = useMemo(
    () =>
      form.costCentreKey
        ? budgetLines.filter(
            (line) => (line.cost_centre_id ?? NO_COST_CENTRE) === form.costCentreKey
          )
        : [],
    [budgetLines, form.costCentreKey]
  );

  // Mirrors vendorHeadOptions/vendorSubHeadOptions below: merge budgeted heads with the full
  // finance_expense_head_master list instead of showing only heads that already have an
  // active, unconsumed budget line for this cost centre + period. Without the merge, any head
  // with no budget line yet, one still pending approval, or one fully consumed silently
  // disappeared from this dropdown with no fallback — "all heads and subheads are not
  // reflecting". Unbudgeted heads are flagged (hasBudget: false) rather than hidden, same as
  // the vendor cascade already does.
  const headOptions = useMemo(() => {
    const budgetedHeads = new Set(linesInCostCentre.map((line) => line.head));
    const allHeads = [
      ...budgetedHeads,
      ...allExpenseMasterHeads.filter((h) => !budgetedHeads.has(h)),
    ];
    return allHeads.map((head) => ({
      value: head,
      label: head,
      hasBudget: budgetedHeads.has(head),
    }));
  }, [linesInCostCentre, allExpenseMasterHeads]);

  const linesInHead = useMemo(
    () => linesInCostCentre.filter((line) => line.head === form.head),
    [linesInCostCentre, form.head]
  );

  // Same merge as headOptions, using allExpenseMasterSubHeads (declared above, shared with the
  // vendor cascade further down — grnType-agnostic, just keyed off form.head).
  const subHeadOptions = useMemo(() => {
    const budgetSubHeads = [...new Set(linesInHead.map((line) => line.sub_head || GENERAL_SUB_HEAD))];
    const budgetSubHeadSet = new Set(budgetSubHeads);
    const allSubHeads = [
      ...budgetSubHeads,
      ...allExpenseMasterSubHeads.filter((sh) => !budgetSubHeadSet.has(sh)),
    ];
    return allSubHeads.length
      ? allSubHeads.map((subHead) => ({ value: subHead, label: subHead, hasBudget: budgetSubHeadSet.has(subHead) }))
      : allExpenseMasterSubHeads.map((sh) => ({ value: sh, label: sh, hasBudget: false }));
  }, [linesInHead, allExpenseMasterSubHeads]);

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
  //
  // Imprest only (guarded below): a vendor GRN never sets form.costCentreKey, so
  // linesInCostCentre/linesInHead/matchingLines are permanently [] for it — without this guard,
  // any budgetLines refetch (e.g. after a save invalidates ["available-budget-lines"]) would
  // recompute those to a new empty-array reference and this effect would blank out the vendor's
  // own Head/Sub-head (which reuses form.head/form.subHead) even though they were validly set via
  // the vendor cascade below.
  useEffect(() => {
    if (isVendor) return;
    setForm((current) => {
      if (!current.head) return current;
      const validHead = linesInCostCentre.some((line) => line.head === current.head);
      return validHead ? current : { ...current, head: "", subHead: "", budgetLineId: "" };
    });
  }, [linesInCostCentre, isVendor]);

  useEffect(() => {
    if (isVendor) return;
    setForm((current) => {
      if (!current.subHead) return current;
      const validSubHead = linesInHead.some(
        (line) => (line.sub_head || GENERAL_SUB_HEAD) === current.subHead
      );
      return validSubHead ? current : { ...current, subHead: "", budgetLineId: "" };
    });
  }, [linesInHead, isVendor]);

  useEffect(() => {
    if (isVendor) return;
    if (matchingLines.length === 1 && form.budgetLineId !== matchingLines[0].id) {
      setForm((current) => ({ ...current, budgetLineId: matchingLines[0].id }));
    }
  }, [matchingLines, form.budgetLineId, isVendor]);

  // ── Vendor cascade: Head → Sub-head only, across every cost centre in this branch/period ──
  //
  // One classification per GRN; the cost-centre split editor below decides how much of that one
  // spend belongs to which cost centre, not a separate classification per cost centre.

  const vendorHeadOptions = useMemo(() => {
    // Normalize each budget line's head to its canonical head_name. Finance may store head_code
    // (e.g. "ADM001") or head_name (e.g. "Administration Expenses") depending on when the budget
    // was created. The dropdown and form.head always use head_names, so a raw head_code match
    // would make the wrong head appear unbudgeted and lose the cost-centre allocation cascade.
    const budgetedHeads = new Set(
      budgetLines.map((line) => headCodeToName.get(String(line.head ?? "").toLowerCase()) ?? line.head)
    );
    // Merge: budgeted heads first (they already have lines), then unbudgeted master heads
    const allHeads = [
      ...budgetedHeads,
      ...allExpenseMasterHeads.filter((h) => !budgetedHeads.has(h)),
    ];
    const fullList = allHeads.map((head) => ({
      value: head,
      label: head,
      hasBudget: budgetedHeads.has(head),
    }));

    // Requirement 2: once a vendor with active expense mappings is selected, narrow this list
    // to what that vendor is actually mapped to (server-side, already intersected with approved
    // budget by /api/finance/expense-selectable) instead of the full master. A vendor with no
    // mappings configured yet stays unrestricted — see selectableClassifications()'s own
    // "UNRESTRICTED, not nothing selectable" comment; narrowing that case would block every GRN
    // for the ~875 vendors Finance hasn't mapped yet.
    if (expenseSelectable?.vendorHasMappings) {
      if (expenseSelectable.selectable.length > 0) {
        const mappedHeads = new Set(expenseSelectable.selectable.map((row) => row.head_name));
        const filtered = fullList.filter((option) => mappedHeads.has(option.value));
        if (filtered.length) return filtered;
      }
      // Mapped, but none of the mapped heads currently have approved budget headroom for this
      // branch/period — fall back to the mapping itself (flagged unbudgeted) instead of an
      // empty dropdown; expense-selectable only returns this list when selectable is empty.
      if (expenseSelectable.mappedButUnbudgeted.length > 0) {
        const unbudgetedHeads = [...new Set(expenseSelectable.mappedButUnbudgeted.map((row) => row.head_name))];
        return unbudgetedHeads.map((head) => ({ value: head, label: head, hasBudget: false }));
      }
    }
    return fullList;
  }, [budgetLines, allExpenseMasterHeads, expenseSelectable, headCodeToName]);

  const vendorLinesInHead = useMemo(
    () => budgetLines.filter(
      (line) => (headCodeToName.get(String(line.head ?? "").toLowerCase()) ?? line.head) === form.head
    ),
    [budgetLines, form.head, headCodeToName]
  );

  const vendorSubHeadOptions = useMemo(() => {
    const budgetSubHeads = [...new Set(vendorLinesInHead.map((line) => line.sub_head || GENERAL_SUB_HEAD))];
    const budgetSubHeadSet = new Set(budgetSubHeads);
    // For unbudgeted heads: show master sub-heads; for budgeted: merge budget sub-heads with master
    const allSubHeads = [
      ...budgetSubHeads,
      ...allExpenseMasterSubHeads.filter((sh) => !budgetSubHeadSet.has(sh)),
    ];
    const fullList = allSubHeads.length
      ? allSubHeads.map((subHead) => ({ value: subHead, label: subHead }))
      : allExpenseMasterSubHeads.map((sh) => ({ value: sh, label: sh }));

    // Same vendor-mapping narrowing as vendorHeadOptions, scoped to the currently selected head.
    if (expenseSelectable?.vendorHasMappings && form.head) {
      const mappedForHead = expenseSelectable.selectable.filter((row) => row.head_name === form.head);
      if (mappedForHead.length > 0) {
        const mappedSubHeads = new Set(mappedForHead.map((row) => row.sub_head_name));
        const filtered = fullList.filter((option) => mappedSubHeads.has(option.value));
        if (filtered.length) return filtered;
      }
      const unbudgetedForHead = expenseSelectable.mappedButUnbudgeted.filter((row) => row.head_name === form.head);
      if (unbudgetedForHead.length > 0) {
        return unbudgetedForHead.map((row) => ({ value: row.sub_head_name, label: row.sub_head_name }));
      }
    }
    return fullList;
  }, [vendorLinesInHead, allExpenseMasterSubHeads, expenseSelectable, form.head]);

  const vendorMatchingLines = useMemo(
    () =>
      form.subHead
        ? vendorLinesInHead.filter((line) => (line.sub_head || GENERAL_SUB_HEAD) === form.subHead)
        : [],
    [vendorLinesInHead, form.subHead]
  );

  /** All active cost centres for the branch, with their matching budget lines (if any).
   *  This follows Branch Budget's pattern: when there are matching budget lines (even branch-common
   *  ones without cost_centre_id), the user can split the expense across ANY active cost centre.
   *  The budget line info is used to show available amounts where applicable.
   *
   *  UNBUDGETED EXPENSES: Even when no budget lines exist for the selected HEAD/SUB-HEAD,
   *  we still show all active cost centres to allow unbudgeted GRN creation. These will be
   *  flagged as is_unbudgeted=1 and routed through stricter approval. */
  const vendorCostCentreGroups = useMemo(() => {
    // Allow cost centre selection even without budget lines (for unbudgeted expenses)
    if (!activeCostCentres.length) return [];
    // Need HEAD and SUB-HEAD selected before showing cost centres
    if (!form.head || !form.subHead) return [];

    // Map of cost centre ID → matching budget lines
    const linesByCC = new Map<string, BudgetLine[]>();
    vendorMatchingLines.forEach((line) => {
      if (!line.cost_centre_id) return; // Branch-common lines apply to ALL cost centres
      linesByCC.set(line.cost_centre_id, [...(linesByCC.get(line.cost_centre_id) ?? []), line]);
    });

    // For branch-common expenses, ALL matching lines apply to every cost centre
    const branchCommonLines = vendorMatchingLines.filter((line) => !line.cost_centre_id);

    // Build groups from ALL active cost centres (not just ones with budget lines)
    return activeCostCentres.map((cc) => {
      const ccLines = linesByCC.get(cc.id) ?? [];
      // Branch-common lines are available to all cost centres
      const allLines = [...ccLines, ...branchCommonLines];
      return {
        costCentreKey: cc.id,
        costCentreName: cc.costCentreName || cc.costCentreCode || "Unknown",
        // Shown alongside the cost centre so the raiser can tell near-identical cost centres
        // apart while picking — the same "which process does this serve" hint already used
        // in offer creation. Only ever a display hint: costCentreKey is still all that's saved.
        // Resolved server-side from the process of the employees actually posted to the cost
        // centre (not cost_centre_master.process_id, which is NULL on every row) — covers ~90%
        // of active cost centres; the rest render with no process shown, not a guess.
        processName: cc.processName ?? null,
        lines: allLines,
      };
    });
  }, [vendorMatchingLines, activeCostCentres, form.head, form.subHead]);

  /** True when no budget exists for the selected HEAD/SUB-HEAD — expense is unbudgeted.
   *  Was isVendor-only; Imprest now drives the same cost-centre-split UI (vendorCostCentreGroups
   *  was already grnType-agnostic — it never referenced isVendor internally), so this check
   *  applies identically to both once Imprest reuses that flow instead of its own cascade. */
  const isUnbudgetedExpense = useMemo(() => {
    if (!form.head || !form.subHead) return false;
    // Check if ANY cost centre has a budget line for this HEAD/SUB-HEAD
    return vendorCostCentreGroups.length > 0 && vendorCostCentreGroups.every((g) => g.lines.length === 0);
  }, [form.head, form.subHead, vendorCostCentreGroups]);

  /** Imprest equivalent of isUnbudgetedExpense above: the raiser picked a Head/Sub-head/cost
   *  centre combination that genuinely has no approved budget line — headOptions/subHeadOptions
   *  offer the full expense master, not just budgeted combinations, so this is reachable. */
  const isImprestUnbudgeted =
    !isVendor
    && Boolean(form.head)
    && Boolean(form.subHead)
    && Boolean(form.costCentreKey)
    && matchingLines.length === 0;

  /** Unifies the two "no approved budget line, and that is allowed" cases this form supports:
   *  an unbudgeted vendor GRN (e2c8db0d) and an unbudgeted single-line Imprest GRN. Split-mode
   *  Imprest stays out of scope — its picker only ever offers existing budget lines, so there is
   *  nothing meaningful to pick when none exist for this combination. */
  const isUnbudgetedFlow = isUnbudgetedExpense || (!isVendor && !splitMode && isImprestUnbudgeted);

  // Clear a stale vendor Head/Sub-head the same way the single-line cascade already does above.
  // Guard: skip when options are empty — budget lines and expense master are still loading and
  // running the clear now would wipe a prefilled edit value before data arrives.
  useEffect(() => {
    setForm((current) => {
      if (!isVendor || !current.head || !vendorHeadOptions.length) return current;
      const validHead = vendorHeadOptions.some((option) => option.value === current.head);
      return validHead ? current : { ...current, head: "", subHead: "" };
    });
  }, [vendorHeadOptions, isVendor]);

  useEffect(() => {
    setForm((current) => {
      if (!isVendor || !current.subHead || !vendorSubHeadOptions.length) return current;
      const validSubHead = vendorSubHeadOptions.some((option) => option.value === current.subHead);
      return validSubHead ? current : { ...current, subHead: "" };
    });
  }, [vendorSubHeadOptions, isVendor]);

  // Re-seed the cost-centre split rows whenever the matching-line set changes (Head/Sub-head
  // picked, or the underlying budget lines changed). Preserves an already-set percentage/item
  // choice for a cost centre that reappears (e.g. toggling Sub-head back and forth) rather than
  // wiping the whole split every time.
  // When budget lines are branch-common (no specific cost centre), all active cost centres are shown
  // and the user can split to any of them.
  useEffect(() => {
    setCostCentreSplits((current) => {
      if (!vendorCostCentreGroups.length) return current.length ? [] : current;
      // Only count cost centres WITH budget lines for the equal split
      const groupsWithBudgetLines = vendorCostCentreGroups.filter((g) => g.lines.length > 0);
      const equalPct = groupsWithBudgetLines.length > 0
        ? Math.round((100 / groupsWithBudgetLines.length) * 1_000_000) / 1_000_000
        : 0;
      return vendorCostCentreGroups.map((group) => {
        const existing = current.find((row) => row.costCentreKey === group.costCentreKey);
        // For branch-common expenses, lines may not have a specific budget line ID per CC
        const firstLineId = group.lines[0]?.id ?? "";
        const hasBudgetLine = group.lines.length > 0;
        const stillValid = existing && (group.lines.length === 0 || group.lines.some((line) => line.id === existing.budgetLineId));
        return {
          key: existing?.key ?? crypto.randomUUID(),
          costCentreKey: group.costCentreKey,
          budgetLineId: stillValid ? existing!.budgetLineId : firstLineId,
          percentage: existing?.percentage ?? (hasBudgetLine ? equalPct : 0),
          // Auto-exclude cost centres without budget lines; preserve user choice for existing rows
          included: existing?.included ?? hasBudgetLine,
        };
      });
    });
  }, [vendorCostCentreGroups]);

  const costCentreSplitTotal = useMemo(
    () => Math.round(costCentreSplits.reduce((sum, row) => sum + Number(row.percentage || 0), 0) * 1_000_000) / 1_000_000,
    [costCentreSplits]
  );

  /** Client-side mirror of the server's reconciliation math in saveComponentAllocations() —
   *  keep the two in sync. Preview only; the server stays authoritative. */
  const componentsPreview = useMemo(() => {
    const rawTotalBase = roundMoney(
      invoiceComponents.reduce((sum, item) => sum + Number(item.amountWithoutTax || 0), 0)
    );
    const rawTotalTax = roundMoney(
      invoiceComponents.reduce(
        (sum, item) => sum + roundMoney(Number(item.amountWithoutTax || 0) * Number(item.gstRate || 0) / 100),
        0
      )
    );
    const rawTotalGross = roundMoney(rawTotalBase + rawTotalTax);
    const diff = roundMoney(Number(form.amount || 0) - rawTotalGross);
    return { rawTotalBase, rawTotalTax, rawTotalGross, diff };
  }, [invoiceComponents, form.amount]);

  function updateCostCentreSplit(key: string, patch: Partial<CostCentreSplitDraft>) {
    setCostCentreSplits((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /** Resets every INCLUDED row to an equal percentage share — the common case, and a one-click
   *  recovery from manual edits that drifted away from 100%. Excluded rows get 0%. */
  function splitCostCentresEvenly() {
    if (!costCentreSplits.length) return;
    const includedCount = costCentreSplits.filter((row) => row.included).length;
    if (includedCount === 0) return;
    const equalPct = Math.round((100 / includedCount) * 1_000_000) / 1_000_000;
    setCostCentreSplits((current) =>
      current.map((row) => ({ ...row, percentage: row.included ? equalPct : 0 }))
    );
  }

  // G15: Direct cost centre selection — which CC gets 100% of the spend
  const [directCostCentreKey, setDirectCostCentreKey] = useState<string>("");

  /** G15: Why "Auto-split by" is disabled for vendor cost-centre split right now, if it is. */
  const costCentreSplitReadiness = useMemo((): { ready: boolean; reason: string } => {
    if (!costCentreSplits.length) return { ready: false, reason: "No cost centres available." };
    const includedRows = costCentreSplits.filter((row) => row.included);
    // "Direct to cost centre" needs at least 1 CC and a selection
    if (costCentreSplitMethod === "direct") {
      if (!directCostCentreKey) return { ready: false, reason: "Select which cost centre receives this spend." };
      return { ready: true, reason: "" };
    }
    // Other split methods need at least 2 INCLUDED cost centres
    if (includedRows.length < 2) return { ready: false, reason: "Need at least 2 included cost centres to split." };
    if (costCentreSplitMethod === "equal_split") return { ready: true, reason: "" };
    // Check if all INCLUDED cost centres have driver data for the chosen method
    const missingDrivers = includedRows.some((row) => {
      const ccKey = row.costCentreKey === NO_COST_CENTRE ? null : row.costCentreKey;
      const driver = driversByCostCentre[ccKey ?? ""];
      return !driver || weightFor(costCentreSplitMethod, driver) <= 0;
    });
    if (missingDrivers) {
      const methodLabel = GRN_AUTO_SPLIT_METHODS.find((m) => m.value === costCentreSplitMethod)?.label ?? costCentreSplitMethod;
      return {
        ready: false,
        reason: `${methodLabel} data not available for one or more included cost centres. Set monthly drivers in Branch Budget → Plan Builder.`,
      };
    }
    return { ready: true, reason: "" };
  }, [costCentreSplits, costCentreSplitMethod, driversByCostCentre, directCostCentreKey]);

  /** G15: Redistributes the cost-centre split percentages by the chosen sharing method's weight. */
  function applyCostCentreSplitMethod() {
    if (!costCentreSplitReadiness.ready) {
      toast({ title: "Can't auto-split yet", description: costCentreSplitReadiness.reason, variant: "destructive" });
      return;
    }
    if (costCentreSplitMethod === "direct") {
      // "Direct to cost centre" — give 100% to the selected cost centre, 0% to others
      if (!directCostCentreKey) {
        toast({ title: "Select a cost centre", description: "Pick which cost centre should receive 100% of this spend.", variant: "destructive" });
        return;
      }
      setCostCentreSplits((current) =>
        current.map((row) => {
          const isChosen = row.costCentreKey === directCostCentreKey;
          return { ...row, percentage: isChosen ? 100 : 0, included: isChosen };
        })
      );
      return;
    }
    if (costCentreSplitMethod === "equal_split") {
      splitCostCentresEvenly();
      return;
    }
    // Driver-based split: only include rows where included=true, set excluded rows to 0%
    const weights = costCentreSplits.map((row) => {
      if (!row.included) return 0; // Excluded cost centres get 0 weight
      const ccKey = row.costCentreKey === NO_COST_CENTRE ? null : row.costCentreKey;
      const driver = driversByCostCentre[ccKey ?? ""];
      return weightFor(costCentreSplitMethod, driver ?? {});
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) {
      toast({ title: "No driver data", description: `${costCentreSplitMethod} data not available for the included cost centres.`, variant: "destructive" });
      return;
    }
    setCostCentreSplits((current) =>
      current.map((row, i) => ({
        ...row,
        percentage: row.included ? Math.round((weights[i] / totalWeight) * 100 * 1_000_000) / 1_000_000 : 0,
      }))
    );
  }

  function updateInvoiceComponent(key: string, patch: Partial<InvoiceComponentDraft>) {
    setInvoiceComponents((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function addInvoiceComponent() {
    setInvoiceComponents((current) => [...current, newInvoiceComponent()]);
  }

  function removeInvoiceComponent(key: string) {
    setInvoiceComponents((current) => (current.length === 1 ? current : current.filter((item) => item.key !== key)));
  }

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

  /** Real money totals across the cost-centre split rows — each included row's share of
   *  form.amount run through computeLine() against its OWN resolved budget line (the same helper
   *  splitTotals/singleLine already use, just applied per split row instead of per single line or
   *  per old-style allocation). Both Vendor and Imprest now drive costCentreSplits instead of the
   *  single-cost-centre cascade (resolvedLine/singleLine), so this is what actually reflects what
   *  the raiser entered — resolvedLine/singleLine stay permanently null under this flow, which is
   *  exactly why the Cost sidebar was stuck at ₹0.00 before this. */
  const costCentreSplitMoneyTotals = useMemo(() => {
    const amount = Number(form.amount || 0);
    return costCentreSplits
      .filter((row) => row.included)
      .reduce(
        (sum, row) => {
          const group = vendorCostCentreGroups.find((g) => g.costCentreKey === row.costCentreKey);
          const line = group?.lines.find((item) => item.id === row.budgetLineId);
          const shareGross = amount * (Number(row.percentage) / 100);
          const perUnit = line ? computeLine(line, 1) : null;
          const basis = perUnit ? (isVendor ? Number(perUnit.base) : Number(perUnit.gross)) : 0;
          if (!line || !(shareGross > 0) || !(basis > 0)) {
            // Unbudgeted, or no line resolved yet: nothing to decompose into tax, but the share
            // still counts toward the total the raiser is committing.
            sum.gross += shareGross;
            sum.base += shareGross;
            sum.pnl += shareGross;
            return sum;
          }
          const calc = computeLine(line, shareGross / basis);
          sum.base += Number(calc.base);
          sum.tax += Number(calc.tax);
          sum.gross += Number(calc.gross);
          sum.pnl += Number(calc.pnlCost);
          return sum;
        },
        { base: 0, tax: 0, gross: 0, pnl: 0 }
      );
  }, [costCentreSplits, vendorCostCentreGroups, form.amount, isVendor]);

  const totals = splitMode
    ? splitTotals
    : isVendor
      // Vendor: Taxable/GST/Total mirror componentsPreview — the actual invoiceComponents rows
      // that get submitted and are reconciled against form.amount elsewhere — so the summary
      // matches what saves. P&L has no equivalent in componentsPreview (no recoverable-tax
      // awareness there), so it borrows the resolved-budget-line-based figure instead.
      ? {
          base: componentsPreview.rawTotalBase,
          tax: componentsPreview.rawTotalTax,
          gross: componentsPreview.rawTotalGross,
          pnl: costCentreSplitMoneyTotals.pnl,
        }
      : costCentreSplitMoneyTotals;

  const splitDifference =
    Math.round((splitTotals.gross - Number(form.amount || 0)) * 100) / 100;

  // ── Per-field validation ────────────────────────────────────────────────

  const errors = useMemo(() => {
    const next: Record<string, string> = {};
    if (!form.branchId) next.branchId = "Select the branch this spend belongs to.";
    if (!form.billDate) {
      next.billDate = isVendor ? "Invoice date is required." : "Receipt date is required.";
    }
    // Late invoice: require reason when >30 days old and raiser is not finance/accounts level
    if (isVendor && !isFinanceLead && form.billDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const billD = new Date(form.billDate); billD.setHours(0, 0, 0, 0);
      const daysOld = Math.floor((today.getTime() - billD.getTime()) / 86400000);
      if (daysOld > 30 && !form.lateInvoiceReason.trim()) {
        next.lateInvoiceReason = "Provide a reason for this late invoice.";
      }
    }
    if (!form.remarks.trim()) next.remarks = "Add a short reason for this spend.";
    if (!(form.amount > 0)) {
      next.amount = isVendor
        ? "Enter the total invoice amount, including GST."
        : "Enter an amount greater than zero.";
    }

    if (isVendor) {
      if (!form.vendorId) next.vendorId = "Select the vendor.";
      if (!form.invoiceNumber.trim()) next.invoiceNumber = "Invoice number is required.";
      if (form.dueDate && form.billDate) {
        const gap = daysBetween(form.billDate, form.dueDate);
        if (gap !== null && gap < 0) next.dueDate = "Due date cannot fall before the invoice date.";
      }

      // Unified flow: Head/Sub-head → cost-centre split → invoice components. No cost-centre
      // picker, no splitMode toggle — this is the only path for a vendor GRN.
      if (!form.head) next.head = "Select an expense head.";
      if (!form.subHead) next.subHead = "Select a sub-head.";
      if (form.head && form.subHead) {
        if (!costCentreSplits.length) {
          next.costCentreSplit = "No approved budget line matches this Head/Sub-head yet.";
        } else if (Math.abs(costCentreSplitTotal - 100) > 0.5) {
          next.costCentreSplit = `Cost-centre split percentages must total 100% (currently ${decimal(costCentreSplitTotal, 2)}%).`;
        }
        if (!invoiceComponents.some((item) => Number(item.amountWithoutTax) > 0)) {
          next.components = "Add at least one invoice component.";
        } else {
          // G8: Finance Head / Accounts Head can accept up to ₹500 round-off; others are limited to ₹1
          const roundoffLimit = isFinanceLead ? 500 : 1;
          if (Math.abs(componentsPreview.diff) > roundoffLimit) {
            next.components = `Invoice components total ${money(componentsPreview.rawTotalGross)} — the declared invoice total is ${money(Number(form.amount || 0))}. Difference ${money(componentsPreview.diff)} exceeds the ₹${roundoffLimit} round-off limit.`;
          }
        }

        // Client-side budget cap per cost-centre split — catches over-budget vendor GRNs before the API call.
        if (!next.costCentreSplit && !next.components && costCentreSplits.length > 0 && componentsPreview.rawTotalGross > 0) {
          const overBudgetMessages: string[] = [];
          for (const split of costCentreSplits) {
            const group = vendorCostCentreGroups.find((g) => g.costCentreKey === split.costCentreKey);
            const line = group?.lines.find((l) => l.id === split.budgetLineId);
            if (line) {
              const splitGross = componentsPreview.rawTotalGross * (split.percentage / 100);
              const available = Number(line.available_gross_amount);
              if (splitGross > available + 0.01) {
                overBudgetMessages.push(
                  `"${group!.costCentreName}": ${money(splitGross)} requested but only ${money(available)} available.`
                );
              }
            }
          }
          if (overBudgetMessages.length > 0) {
            next.costCentreSplit = `Budget exceeded: ${overBudgetMessages.join(" ")} Reduce the amounts or ask Finance to revise the budget.`;
          }
        }
      }
    } else {
      // Imprest: Head/Sub-head → cost-centre split, same shape as the vendor flow above (cost-
      // centre-split support was added to Imprest). The old single-cost-centre cascade
      // (form.costCentreKey / resolvedLine / singleLine / needsItemChoice) is retained for the
      // legacy splitMode allocations UI below, which the "Split" toggle used to open — that
      // toggle no longer exists in the UI, so splitMode is permanently false, but the code stays.
      if (!splitMode) {
        if (!form.head) next.head = "Select an expense head.";
        if (!form.subHead) next.subHead = "Select a sub-head.";
        if (form.head && form.subHead) {
          if (!costCentreSplits.length) {
            next.costCentreSplit = "No approved budget line matches this Head/Sub-head yet.";
          } else if (Math.abs(costCentreSplitTotal - 100) > 0.5) {
            next.costCentreSplit = `Cost-centre split percentages must total 100% (currently ${decimal(costCentreSplitTotal, 2)}%).`;
          }
          // Client-side budget cap per cost-centre split — mirrors the vendor check above.
          if (!next.costCentreSplit && costCentreSplits.length > 0 && Number(form.amount) > 0) {
            const overBudgetMessages: string[] = [];
            for (const split of costCentreSplits) {
              if (!split.included) continue;
              const group = vendorCostCentreGroups.find((g) => g.costCentreKey === split.costCentreKey);
              const line = group?.lines.find((l) => l.id === split.budgetLineId);
              if (line) {
                const splitGross = Number(form.amount) * (split.percentage / 100);
                const available = Number(line.available_gross_amount);
                if (splitGross > available + 0.01) {
                  overBudgetMessages.push(
                    `"${group!.costCentreName}": ${money(splitGross)} requested but only ${money(available)} available.`
                  );
                }
              }
            }
            if (overBudgetMessages.length > 0) {
              next.costCentreSplit = `Budget exceeded: ${overBudgetMessages.join(" ")} Reduce the amounts or ask Finance to revise the budget.`;
            }
          }
        }
      }

      if (splitMode) {
        if (!allocations.every((item) => item.budgetLineId)) {
          next.split = "Select a budget line in every row.";
        } else if (Math.abs(splitDifference) > 0.01) {
          next.split = `Split must equal the invoice total exactly. Difference ${money(splitDifference)}.`;
        }
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
    costCentreSplits,
    costCentreSplitTotal,
    invoiceComponents,
    componentsPreview,
    vendorCostCentreGroups,
  ]);

  const proofPresent = files.length > 0 || Boolean(workspace?.documents?.length);
  const serverBlocking = (workspace?.validations ?? []).filter(
    (item) => Number(item.is_blocking) === 1 && item.validation_status === "failed"
  );
  const hasErrors = Object.keys(errors).length > 0;

  /**
   * Recognising cost outside the GRN's own financial year is refused by the server for
   * anyone but Finance Head / Accounts Head / Super Admin. Blocking here too means the
   * refusal is visible while the window is being chosen, not after a full form is
   * submitted; the server remains the authority either way.
   */
  // isFinanceLead, not canOverridePeriod: the server gates a cross-FY recognition window on
  // RECOGNITION_OVERRIDE_ROLES (grn-smart.service.ts), which is finance_head / accounts_head /
  // super_admin and does NOT include branch_admin. Overriding the accounting period and moving
  // cost into another financial year are different permissions that happened to share a flag.
  const crossFyBlocked =
    !isFinanceLead &&
    windowCrossesFinancialYear(period, monthSplit.startPeriod, monthSplit.endPeriod);

  const canSubmit =
    !hasErrors && proofPresent && serverBlocking.length === 0 && !crossFyBlocked;

  const checklist = [
    { label: "Proof attached", done: proofPresent },
    { label: "Details complete", done: !hasErrors },
    /*
     * Read the vendor cascade's own splits for a vendor GRN.
     *
     * This step tested `resolvedLine` — which belongs to the imprest cost-centre cascade and is
     * never populated for a vendor GRN — so it read "not done" on every vendor GRN ever raised,
     * budgeted or not, and dragged the readiness bar down with it. Display only: canSubmit above
     * has never consulted this checklist.
     *
     * An unbudgeted GRN is legitimately complete without a budget line, so it gets its own label
     * rather than a tick that would misstate what happens next — Finance Head links the budget
     * during approval, and nothing is resolved until they do. Applies to both the vendor and the
     * Imprest unbudgeted flow — isUnbudgetedFlow covers either.
     */
    isUnbudgetedFlow
      ? { label: "Budget linked by Finance Head at approval", done: true }
      : {
          label: "Budget resolved",
          // Vendor and Imprest (non-splitMode) both drive costCentreSplits now; only the dead
          // legacy splitMode allocations UI still reads off `allocations`.
          done: !splitMode
            ? costCentreSplits.some((row) => row.included)
              && costCentreSplits.every((row) => !row.included || Boolean(row.budgetLineId))
            : Boolean(allocations[0]?.budgetLineId),
        },
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

  /**
   * `navigateAway` defaults true, matching the manual "Start a new GRN" button's prior behaviour
   * (always ran onEditComplete). persistMutation's onSuccess passes it explicitly: false after a
   * fresh-create submit (stay on Create with a blank form), true after an edit-and-resubmit
   * (return to Queue, same as onEditComplete already does for that flow).
   */
  function resetForm({ navigateAway = true }: { navigateAway?: boolean } = {}) {
    setForm(EMPTY_FORM);
    setAllocations([newAllocation()]);
    setCostCentreSplits([]);
    setInvoiceComponents([newInvoiceComponent()]);
    setFiles([]);
    setCreated(null);
    setExtractedFields(null);
    setSplitMode(false);
    setShowErrors(false);
    setPrefilledForEdit(true);
    if (navigateAway) onEditComplete?.();
  }

  // Item 10: "GRN Raised" confirmation modal actions. Both stay on the Create GRN page
  // (navigateAway: false) — the modal's own dismissal is the user's explicit "I'm done looking
  // at the confirmation" click, so this is not the silent auto-reset the old behaviour was.
  function handleCreateAnotherGrn(chosenType: GrnType) {
    // Order matters: resetForm sets form to EMPTY_FORM (grnType: "vendor"), so the chosen type
    // must be applied after the reset or it would be immediately overwritten.
    resetForm({ navigateAway: false });
    setForm((current) => ({ ...current, grnType: chosenType }));
    setSubmittedGrn(null);
  }

  function handleCloseSubmittedGrnDialog() {
    resetForm({ navigateAway: false });
    setSubmittedGrn(null);
  }

  function applyExtractedFields(fields: Record<string, any>) {
    setForm((current) => ({
      ...current,
      invoiceNumber: String(fields.invoiceNumber ?? current.invoiceNumber ?? ""),
      billDate: String(fields.invoiceDate ?? current.billDate ?? ""),
      purchaseReference: String(fields.purchaseReference ?? current.purchaseReference ?? ""),
      vendorGstin: String(fields.vendorGstin ?? current.vendorGstin ?? ""),
      placeOfSupply: String(fields.placeOfSupply ?? current.placeOfSupply ?? ""),
      irn: String(fields.irn ?? current.irn ?? ""),
      irnAckNo: String(fields.irnAckNo ?? current.irnAckNo ?? ""),
      // Was missing entirely: the whole point of this panel is "check these against the document
      // before applying", but the one figure DOCUMENT_AMOUNT_MATCH actually checks (grossAmount)
      // never made it into the form, so clicking Apply could never clear that blocker.
      amount:
        fields.grossAmount != null && Number(fields.grossAmount) > 0
          ? Number(fields.grossAmount)
          : current.amount,
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

      // Vendor: unified flow, one Head/Sub-head split by percentage across cost centres, plus
      // GST-slab components. Imprest (non-splitMode): same costCentreSplits-driven flow now,
      // just posted through the older /allocations endpoint (quantity × unitRate, no percentage
      // field server-side) since saveComponentAllocations() is hard-gated to grn_type='vendor'.
      // resolvedLine/singleLine belong to the OLD single-cost-centre cascade and are never
      // populated under this flow for either GRN type — the legacy splitMode allocations UI is
      // the only remaining reader of them, and it is no longer reachable from the UI.
      if (!isVendor && !splitMode) {
        // An included row with no budgetLineId is not an error — the backend now resolves it
        // as an unbudgeted allocation against that row's own cost centre (mixed budgeted +
        // unbudgeted cost centres on one GRN are supported), same as the vendor flow below.
        if (!costCentreSplits.some((row) => row.included)) {
          throw new Error("Include at least one cost centre before saving.");
        }
      }
      const rows: Array<AllocationDraft & { costCentreKey?: string }> = isVendor
        ? []
        : splitMode
          ? allocations
          : costCentreSplits
              .filter((row) => row.included)
              .map((row) => {
                const group = vendorCostCentreGroups.find((g) => g.costCentreKey === row.costCentreKey);
                const line = group?.lines.find((item) => item.id === row.budgetLineId);
                const shareGross = Number(form.amount) * (Number(row.percentage) / 100);
                // Unbudgeted: no budget line to read a rate off, so the raw share IS the row —
                // unit_rate 1, the same convention the vendor unbudgeted synthetic line uses.
                const perUnitGross = line ? Number(computeLine(line, 1).gross) : 0;
                const quantity = line && perUnitGross > 0
                  ? Number((shareGross / perUnitGross).toFixed(4))
                  : Number(shareGross.toFixed(2));
                return {
                  key: row.key,
                  budgetLineId: row.budgetLineId || "",
                  costCentreKey: row.costCentreKey,
                  quantity,
                  unitRate: line ? Number(line.unit_rate) : 1,
                  remarks: "",
                };
              });
      // The two indexed reads below assume a row exists. Neither is guaranteed: a vendor/imprest
      // GRN with every cost centre unticked leaves costCentreSplits[0] undefined, and split mode
      // with no rows leaves rows[0] undefined. Both then threw a TypeError from inside a
      // .find() predicate, which surfaced as the same anonymous "GRN could not be saved".
      if (!isUnbudgetedExpense && !splitMode && !costCentreSplits.length) {
        throw new Error("Include at least one cost centre before saving.");
      }
      if (!isVendor && splitMode && !rows.length) {
        throw new Error("Add at least one allocation row before saving.");
      }

      /*
       * UNBUDGETED vendor GRN: there is deliberately no budget line to find.
       *
       * The vendor cascade offers every Head/Sub-head in the expense master, not only the ones a
       * budget covers, so a raiser can legitimately pick a combination with no line behind it —
       * that is what isUnbudgetedExpense detects and what the amber notice under Sub-head tells
       * them. costCentreSplits then carries an empty budgetLineId on every row.
       *
       * This lookup used to run regardless and end in `.find(...)!`, so it resolved to undefined
       * and the next line threw "Cannot read properties of undefined (reading 'id')" — a raw
       * TypeError surfaced to the user as "GRN could not be saved", with nothing sent to the
       * server and no hint that the missing budget was the cause.
       */
      // The cost centre an unbudgeted header is attributed to: the first split the raiser
      // actually included, matching the first row saveInvoiceComponents() will write.
      const unbudgetedCostCentreId = costCentreSplits.find((row) => row.included)?.costCentreKey;
      // The header's own "representative" budget line — used only for a few summary columns
      // (process_id, financial year…), never to gate the save. A GRN can now mix budgeted and
      // unbudgeted cost centres, so this picks the first INCLUDED row that actually has a
      // budget line, not literally row [0] — an unbudgeted row happening to sit first must not
      // make an otherwise-budgeted GRN look like it has no line at all.
      const firstLine = splitMode
        ? budgetLines.find((line) => line?.id === rows[0]?.budgetLineId)
        : isUnbudgetedExpense
          ? undefined
          : budgetLines.find((line) => line?.id === costCentreSplits.find((row) => row.included && row.budgetLineId)?.budgetLineId);
      /*
       * Every path that is not the unbudgeted one still REQUIRES a line, and the non-null
       * assertions above were hiding that. A stale budgetLines cache — a line deleted, a period
       * rolled, a budget unapproved between load and save — lands here, and a named error is the
       * difference between the raiser fixing their selection and filing a bug about a TypeError.
       */
      if (!firstLine && !isUnbudgetedFlow) {
        throw new Error(
          "The selected budget line is no longer available. Reload the page and pick the Head/Sub-head again."
        );
      }
      attemptedLineIdRef.current = firstLine?.id ?? null;

      let current = created;
      if (!current) {
        const result = await hrmsApi.post<{ id: string; grnNumber: string }>(
          "/api/finance/grns",
          {
            grnType: form.grnType,
            branchId: form.branchId,
            companyCode: form.companyCode || undefined,
            budgetLineId: firstLine?.id,
            processId: firstLine?.process_id ?? undefined,
            // Unbudgeted: no line to read a cost centre off, so the first INCLUDED split's own
            // cost centre travels instead — Vendor and Imprest both drive costCentreSplits now.
            // The server validates it is active and belongs to the branch either way, exactly as
            // getLineForGrn() would have validated a real line. Gated on isUnbudgetedFlow, not
            // just "firstLine.cost_centre_id is empty" — a budgeted branch-level line can
            // legitimately carry a null cost_centre_id too (see the cost-centre share caution
            // below), and that existing case must keep sending undefined exactly as it always has.
            costCentreId: firstLine?.cost_centre_id
              ?? (isUnbudgetedFlow ? unbudgetedCostCentreId : undefined),
            // Tells the server to take the unbudgeted create path, and carries the Head/Sub-head
            // that a budget line would otherwise have supplied — saveInvoiceComponents() /
            // saveAllocations() read both back off the header to build synthetic lines.
            isUnbudgeted: isUnbudgetedFlow ? true : undefined,
            head: isUnbudgetedFlow ? form.head : undefined,
            subHead: isUnbudgetedFlow ? form.subHead : undefined,
            vendorId: isVendor ? form.vendorId : undefined,
            // Vendor: a trivial placeholder — the follow-up invoice-components call below fully
            // overwrites every meaningful header column with the real N-cost-centre x M-component
            // breakdown, exactly like PUT .../allocations already fully overwrites this today.
            quantity: isVendor ? 0.0001 : Number(rows[0].quantity),
            unitRate: isVendor ? 0 : Number(rows[0].unitRate),
            billDate: form.billDate,
            // Send only when the user has explicitly picked a different accounting month.
            // Omitting it lets the backend derive it from billDate as always.
            accountingPeriod: form.accountingPeriod || undefined,
            paymentTermsDays: isVendor ? Number(resolvedPaymentTerms) : 0,
            remarks: form.remarks || undefined,
            // Unbudgeted has no line period_code; the server derives the year from the accounting
            // month itself, which is the same value in every budgeted case anyway.
            financialYear: firstLine ? financialYearFromPeriod(firstLine.period_code) : undefined,
          }
        );
        /*
         * Every call after this one is addressed as /api/finance/grns/${current.id}/... . If the
         * create response ever came back without an id, those became literal ".../undefined/..."
         * requests, and a missing /api/* route answers 401 — so a shape change here would have
         * surfaced as an authentication error on a perfectly authenticated session. Refuse with
         * the truth instead.
         */
        if (!result?.id) {
          throw new Error("The GRN was not created — the server returned no GRN id. Nothing was saved.");
        }
        current = { ...result, submitted: false };
        setCreated(current);
      }

      if (isVendor) {
        await hrmsApi.put(`/api/finance/grns/${current.id}/invoice-components`, {
          invoiceNumber: form.invoiceNumber,
          purchaseReference: form.purchaseReference || undefined,
          accountingPeriod: canOverridePeriod && form.accountingPeriod ? form.accountingPeriod : undefined,
          vendorGstin: form.vendorGstin || undefined,
          placeOfSupply: form.placeOfSupply || undefined,
          irn: form.irn.trim() || undefined,
          irnAckNo: form.irnAckNo.trim() || undefined,
          declaredInvoiceTotal: Number(form.amount),
          recognitionStartPeriod: monthSplit.startPeriod || undefined,
          recognitionEndPeriod: monthSplit.endPeriod || undefined,
          recognitionCustomPercentages:
            monthSplit.customPercentages && Object.keys(monthSplit.customPercentages).length > 0
              ? monthSplit.customPercentages
              : undefined,
          components: invoiceComponents
            .filter((item) => Number(item.amountWithoutTax) > 0)
            .map((item) => ({
              amountWithoutTax: Number(item.amountWithoutTax),
              gstRate: Number(item.gstRate),
              remarks: item.remarks || undefined,
              hsnSacCode: item.hsnSacCode?.trim() || undefined,
            })),
          // Every included row travels now, budgeted or not — the server resolves each one
          // independently (budgetLineId if present, else costCentreId as an unbudgeted
          // allocation against that row's own cost centre), so a GRN can mix budgeted and
          // unbudgeted cost centres under one Head/Sub-head instead of being all-or-nothing.
          costCentreSplits: costCentreSplits
            .filter((row) => row.included)
            .map((row) => ({
              budgetLineId: row.budgetLineId || undefined, // undefined for an unbudgeted row
              costCentreId: row.costCentreKey, // always sent — the server needs it either way
              percentage: Number(row.percentage),
            })),
          // Legacy flag, kept for an older client; the server now derives this per row instead.
          isUnbudgeted: isUnbudgetedExpense || undefined,
          lateInvoiceReason: form.lateInvoiceReason.trim() || undefined,
          gstEnabled: form.gstEnabled,
          vendorStateCode: form.vendorStateCode || undefined,
          billingStateCode: form.billingStateCode || undefined,
        });
      } else {
        await hrmsApi.put(`/api/finance/grns/${current.id}/allocations`, {
          // Declared whenever there is more than one row to reconcile against — split mode's
          // manual allocations, and now the cost-centre-split flow's per-CC rows too. A true
          // single-line GRN (one row, one cost centre) still omits it: the amount drives the
          // quantity there, so the server's computed gross IS the invoice total already.
          declaredInvoiceTotal: splitMode || rows.length > 1 ? Number(form.amount) : undefined,
          recognitionStartPeriod: monthSplit.startPeriod || undefined,
          recognitionEndPeriod: monthSplit.endPeriod || undefined,
          recognitionCustomPercentages:
            monthSplit.customPercentages && Object.keys(monthSplit.customPercentages).length > 0
              ? monthSplit.customPercentages
              : undefined,
          allocations: rows.map((item) => ({
            budgetLineId: item.budgetLineId || undefined,
            // Unbudgeted row: no budget line id, so the cost centre the raiser picked travels
            // instead — saveAllocations() reads it back to build a synthetic line. Cost-centre-
            // split rows carry their own costCentreKey; the legacy splitMode allocations UI never
            // set one (it never had its own cost-centre picker either) so falls back to undefined.
            costCentreId: !item.budgetLineId ? item.costCentreKey : undefined,
            quantity: Number(item.quantity),
            unitRate: Number(item.unitRate),
            remarks: item.remarks || undefined,
          })),
        });
      }

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
      // Item 10: a fresh-create submit (no editGrnId) shows its confirmation via the
      // "GRN Raised" modal instead of this toast, since the modal already states the GRN
      // number clearly and a toast-plus-modal on the same success reads as double confirmation.
      // The draft-save and edit-resubmit paths are unaffected and keep the toast.
      const skipToastForModal = submit && !editGrnId;
      if (!skipToastForModal) {
        toast({
          title: submit ? "GRN submitted to Branch Head" : "GRN draft saved",
          description: result.grnNumber,
        });
      }
      void queryClient.invalidateQueries({ queryKey: ["grn-list"] });
      void queryClient.invalidateQueries({ queryKey: ["available-budget-lines"] });
      void queryClient.invalidateQueries({ queryKey: ["smart-grn-workspace", result.id] });
      // Was showing the just-submitted GRN until the user manually clicked "Start a new GRN" —
      // an edit-and-resubmit (editGrnId set, reached via History/Queue's Edit button) still resets
      // immediately and hands back to onEditComplete's Queue redirect, same as it always intended.
      // A fresh create (no editGrnId) no longer resets automatically here — it opens the "GRN
      // Raised" confirmation modal instead, and the reset happens from that modal's own actions
      // ("Create another" / "Close") so the user sees the confirmation before the form clears.
      if (submit && editGrnId) {
        resetForm({ navigateAway: true });
      } else if (submit && !editGrnId) {
        setSubmittedGrn({ grnNumber: result.grnNumber });
      }
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
      // extraction/confirm alone never writes amount/amount_with_tax (it only persists invoice
      // metadata — see grn-smart.service.ts confirmExtraction). Save the current form first, same
      // path the Save button uses, so a manually-corrected Amount (or one just pulled in by Apply)
      // is actually persisted and DOCUMENT_AMOUNT_MATCH revalidates against the real total instead
      // of silently comparing against whatever was last saved.
      await persistMutation.mutateAsync(false);
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
      <GrnIconButton
        onClick={() => resetForm()}
        aria-label={created ? "Start a new GRN" : "Clear form"}
        title={created ? "Start a new GRN" : "Clear form"}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </GrnIconButton>
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
      {/* Legacy layout: Save/Reset live at the bottom of the panel, not pinned while scrolling —
       *  actionButtons is rendered there instead (see the end of the main GrnCard below). Status
       *  (draft/GRN #, running total, readiness%) stays visible up top since that's still useful
       *  context while filling the form; it's just no longer sticky. */}
      <div className="mb-4 rounded-[4px] border border-[#c7d2e0] bg-white px-4 py-2.5">
        {totalStrip}
      </div>

      {editGrnId && workspace?.grn?.rejection_reason && !workspace.grn.submitted_at && (
        <div className="mb-4 flex items-start gap-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3.5 py-3 text-[12px]">
          <AlertCircle className="mt-px h-4 w-4 shrink-0 text-rose-500" />
          <div>
            <p className="font-semibold text-rose-700">Rejection reason:</p>
            <p className="mt-0.5 text-rose-600">{String(workspace.grn.rejection_reason)}</p>
          </div>
        </div>
      )}

      {submitted && (
        <div className="mb-4 flex items-center gap-3 rounded-[10px] border border-grn-ok-line bg-grn-ok-bg px-3.5 py-3 text-[12px]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-grn-ok" />
          <p className="font-semibold text-grn-ok">
            Submitted to Branch Head with allocation-aware budget controls.
          </p>
        </div>
      )}

      {/* ── Mode + status strip ── same row: the mode toggle never used the row's full width, so
          Readiness and Approval path — previously buried at the very bottom of the page in a
          "side rail" that (this container has no grid/flex columns) actually just stacked below
          everything else — move up here instead, laid out horizontally. Same `checklist` array,
          same step-state computation as before; only where/how they render changed. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
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

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Readiness — compact horizontal checklist instead of a stacked list + progress bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
              Readiness {readiness}%
            </span>
            <div className="flex flex-wrap items-center gap-1">
              {checklist.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                    item.done ? "bg-grn-ok-bg text-grn-ok" : "bg-grn-line-soft text-grn-ink-soft"
                  )}
                >
                  {item.done ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          <div className="hidden h-4 w-px bg-grn-line sm:block" />

          {/* Approval path — same 4-step state logic as before, laid out left-to-right */}
          <div className="flex flex-wrap items-center gap-1">
            {[
              { label: "Branch Admin submits", note: submitted ? undefined : "This form" },
              { label: "Branch Head reviews", note: submitted && !liveStatus ? "Awaiting action" : undefined },
              { label: "Finance Head reviews" },
              { label: isVendor ? "Accounts Head → payment" : "Imprest closure" },
            ].map((step, index, steps) => {
              const grnDone = liveStatus === "approved" || liveStatus === "paid" || liveStatus === "partially_paid" || liveStatus === "pending_accounts_payment";
              const branchDone = grnDone || liveStatus === "branch_head_approved" || liveStatus === "finance_head_approved";
              const financeDone = grnDone || liveStatus === "finance_head_approved";
              const stepState =
                index === 0 ? (submitted ? "done" : "current") :
                index === 1 ? (branchDone ? "done" : submitted ? "current" : "upcoming") :
                index === 2 ? (financeDone ? "done" : branchDone ? "current" : "upcoming") :
                grnDone ? "done" : financeDone ? "current" : "upcoming";
              return (
                <div key={step.label} className="flex items-center gap-1" title={step.note}>
                  <span
                    className={`flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-[1.5px] text-[9.5px] font-bold ${
                      stepState === "done"
                        ? "border-grn-ok bg-grn-ok text-white"
                        : stepState === "current"
                          ? "border-grn-brand bg-grn-brand text-white"
                          : "border-grn-line bg-grn-card text-grn-ink-soft"
                    }`}
                  >
                    {stepState === "done" ? "✓" : index + 1}
                  </span>
                  <span className={`text-[10.5px] font-semibold whitespace-nowrap ${stepState === "upcoming" ? "text-grn-ink-soft" : "text-grn-ink"}`}>
                    {step.label}
                  </span>
                  {index < steps.length - 1 && <span className="mx-1.5 h-px w-3 bg-grn-line" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Compact layout: reduced spacing, full-width form (side rail moved to sticky footer) */}
      <div className="mt-3">
        <div className="min-w-0 space-y-3">
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

          {/* ── Details — Dense grid layout ── */}
          <GrnCard>
            <div className="p-4 space-y-1">
              <DenseSection
                title={isVendor ? "Vendor GRN Entry" : "Imprest GRN Entry"}
                variant="panel"
              />

              {/* Imprest gets its own explicit sequence per the raiser's request: Company/Branch/
                  Receipt date, then Amount/Remarks, then Accounting period + Recognise-across-
                  months, then Head/Sub-head — genuinely different shape from Vendor's, not worth
                  fighting shared JSX over. Every field/handler below is identical to Vendor's or
                  Imprest's own pre-existing versions, just relocated. */}
              {!isVendor && (
                <>
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Company">
                      {companies.length > 1 ? (
                        <SearchableSelect
                          id="grn-company"
                          aria-label="Legal entity"
                          disabled={locked}
                          className="h-8"
                          options={companies.map((c) => ({ value: c.company_code, label: c.company_name }))}
                          value={form.companyCode}
                          onChange={(value) => setForm((current) => ({ ...current, companyCode: value }))}
                          placeholder="Select company"
                          searchPlaceholder="Type company name…"
                        />
                      ) : (
                        <div className="h-8 flex items-center text-[12px] text-grn-ink">{companies[0]?.company_name || "MAS"}</div>
                      )}
                    </DenseField>
                    <DenseField label="Branch" required error={err("branchId")}>
                      <SearchableSelect
                        id="grn-branch"
                        aria-label="Branch"
                        disabled={locked}
                        className="h-8"
                        options={branches.map((branch) => ({
                          value: branch.id,
                          label: branchLabel(branch),
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
                          setInvoiceComponents([newInvoiceComponent()]);
                        }}
                        placeholder="Select branch"
                        searchPlaceholder="Type a branch name…"
                      />
                    </DenseField>
                    <DenseField
                      label="Receipt date"
                      required
                      error={err("billDate")}
                      hint={effectivePeriod ? `FY ${financialYearFromPeriod(effectivePeriod)}` : undefined}
                    >
                      <Input
                        id="grn-bill-date"
                        type="date"
                        className={cn(inputClass, "h-8 w-full")}
                        disabled={locked}
                        value={form.billDate}
                        onChange={(event) => {
                          const billDate = event.target.value;
                          setForm((current) => ({
                            ...current,
                            billDate,
                            accountingPeriod: "",
                            costCentreKey: "",
                            head: "",
                            subHead: "",
                            budgetLineId: "",
                            lateInvoiceReason: "",
                          }));
                          setAllocations([newAllocation()]);
                          setInvoiceComponents([newInvoiceComponent()]);
                        }}
                      />
                    </DenseField>
                  </DenseFieldGroup>

                  {/* Accounting period + Recognise-across-months sit right after the date field,
                      not after Amount, and side by side in one row rather than stacked. */}
                  <DenseFieldGroup cols={2}>
                    <div>
                      {canOverridePeriod && period ? (
                        <DenseField
                          label="Accounting period"
                          hint={
                            (form.accountingPeriod && form.accountingPeriod !== period
                              ? `Booking into ${form.accountingPeriod} (invoice month: ${period})`
                              : "Leave as-is for invoice date month")
                            + (effectivePeriod ? ` · FY ${financialYearFromPeriod(effectivePeriod)}` : "")
                          }
                        >
                          <MonthYearPicker
                            className="w-full"
                            disabled={locked && !canOverridePeriod}
                            value={effectivePeriod}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                accountingPeriod: value === period ? "" : value,
                              }))
                            }
                            selectClassName="h-8 rounded-[8px] border border-grn-line bg-white px-2 text-[12px] text-grn-ink focus:outline-none focus:ring-2 focus:ring-grn-brand/15"
                          />
                        </DenseField>
                      ) : (
                        !canOverridePeriod && effectivePeriod && (
                          <div className="flex h-8 items-center gap-2 text-[12px] text-grn-ink">
                            <span className="text-grn-ink-soft">Period:</span>
                            <span className="font-bold">{effectivePeriod}</span>
                            <span className="text-grn-ink-soft">(FY {financialYearFromPeriod(effectivePeriod)})</span>
                          </div>
                        )
                      )}
                    </div>
                    <MonthSplitPanel
                      value={monthSplit}
                      onChange={setMonthSplit}
                      amount={Number(form.amount) || 0}
                      accountingPeriod={period}
                      disabled={locked}
                      canCustomSplit={isFinanceLead}
                      canCrossFy={isFinanceLead}
                    />
                  </DenseFieldGroup>
                  {canOverridePeriod && form.accountingPeriod && form.accountingPeriod !== period && (
                    <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span>Period-end cut-off: booking into <strong>{form.accountingPeriod}</strong> instead of {period}.</span>
                    </div>
                  )}

                  <DenseFieldGroup cols={2}>
                    <DenseField
                      label={splitMode ? "Invoice total (incl. GST)" : "Amount"}
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
                        className={cn(inputClass, "h-8 w-full text-right font-semibold tabular-nums")}
                        value={form.amount || ""}
                        placeholder="0.00"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, amount: Number(event.target.value) }))
                        }
                      />
                    </DenseField>
                    <DenseField label="Remark" required error={err("remarks")}>
                      <Input
                        id="grn-remarks"
                        className={cn(inputClass, "h-8 w-full")}
                        value={form.remarks}
                        placeholder="What was bought or paid for, and why."
                        onChange={(event) =>
                          setForm((current) => ({ ...current, remarks: event.target.value }))
                        }
                      />
                    </DenseField>
                  </DenseFieldGroup>
                  <div className="flex items-center gap-3 text-[11px] text-grn-ink-soft">
                    <span>Taxable: <b className="text-grn-ink">{money(totals.base)}</b></span>
                    <span>GST: <b className="text-grn-ink">{money(totals.tax)}</b></span>
                    <span className="font-bold text-grn-ink">Total: {money(totals.gross)}</span>
                  </div>

                  <DenseSection
                    title="Budget Allocation"
                    action={<GrnBudgetImportButton branchId={form.branchId} period={effectivePeriod} disabled={locked} />}
                  />
                  {!form.branchId || !effectivePeriod ? (
                    <div className="py-2 text-[11px] text-grn-warn">
                      Select branch and date first to load budgets.
                    </div>
                  ) : linesLoading ? (
                    <div className="flex items-center gap-2 py-3 text-[11px] text-grn-ink-soft">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading budgets…
                    </div>
                  ) : (
                    <>
                      <DenseFieldGroup cols={2}>
                        <DenseField label="Head" required error={err("head")}>
                          <SearchableSelect
                            id="grn-head"
                            aria-label="Expense head"
                            options={vendorHeadOptions}
                            value={form.head}
                            onChange={(value) => setForm((current) => ({ ...current, head: value, subHead: "" }))}
                            placeholder="Select head"
                            searchPlaceholder="Type a head…"
                          />
                        </DenseField>
                        <DenseField label="Sub-head" required error={err("subHead")}>
                          <SearchableSelect
                            id="grn-subhead"
                            aria-label="Expense sub-head"
                            disabled={!form.head}
                            options={vendorSubHeadOptions}
                            value={form.subHead}
                            onChange={(value) => setForm((current) => ({ ...current, subHead: value }))}
                            placeholder={form.head ? "Select sub-head" : "Select head first"}
                            searchPlaceholder="Type a sub-head…"
                          />
                        </DenseField>
                      </DenseFieldGroup>
                      {form.head && !vendorHeadOptions.find((o) => o.value === form.head)?.hasBudget && (
                        <p className="text-[10px] text-amber-600">
                          No approved budget for this head — Finance Head must link during approval.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Branch / Company — Vendor only. Moved to the front of the Vendor sequence per
                  the raiser's requested reorder: branch/company picked first, before vendor
                  details, invoice details or Budget Allocation. Same fields, same handlers,
                  same state resets as before — pure relocation. */}
              {isVendor && (
              <DenseFieldGroup cols={2}>
                <DenseField label="Branch" required error={err("branchId")}>
                  <SearchableSelect
                    id="grn-branch"
                    aria-label="Branch"
                    disabled={locked}
                    className="h-8"
                    options={branches.map((branch) => ({
                      value: branch.id,
                      label: branchLabel(branch),
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
                      setInvoiceComponents([newInvoiceComponent()]);
                    }}
                    placeholder="Select branch"
                    searchPlaceholder="Type a branch name…"
                  />
                </DenseField>
                <DenseField label="Company">
                  {companies.length > 1 ? (
                    <SearchableSelect
                      id="grn-company"
                      aria-label="Legal entity"
                      disabled={locked}
                      className="h-8"
                      options={companies.map((c) => ({ value: c.company_code, label: c.company_name }))}
                      value={form.companyCode}
                      onChange={(value) => setForm((current) => ({ ...current, companyCode: value }))}
                      placeholder="Select company"
                      searchPlaceholder="Type company name…"
                    />
                  ) : (
                    <div className="h-8 flex items-center text-[12px] text-grn-ink">{companies[0]?.company_name || "MAS"}</div>
                  )}
                </DenseField>
              </DenseFieldGroup>
              )}

              {/* Row: Vendor, GSTIN, GST toggle (vendor only). Place of supply, Contract
                  reference and the IRN (e-invoice/Ack no./date) fields that used to sit here
                  were removed per the legacy-flow resequencing — they weren't part of the old
                  HRMS Vendor GRN form and had no logic hanging off them beyond the four
                  now-unused form fields (placeOfSupply, purchaseReference, irn, irnAckNo),
                  which stay wired through the submit payload untouched. */}
              {isVendor && (
                <>
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Vendor" required error={err("vendorId")}>
                      <SearchableSelect
                        id="grn-vendor"
                        aria-label="Vendor"
                        disabled={locked}
                        loading={vendorsLoading}
                        options={Array.from(
                          new Map(
                            vendors.map((vendor) => [
                              (vendor.vendor_name ?? vendor.name ?? "").trim().toUpperCase(),
                              vendor,
                            ])
                          ).values()
                        ).map((vendor) => ({
                          value: vendor.id,
                          label: (vendor.vendor_name ?? vendor.name ?? "").trim(),
                          hint: undefined,
                        }))}
                        value={form.vendorId}
                        onChange={(value) => {
                          const picked = vendors.find((vendor) => vendor.id === value);
                          setForm((current) => {
                            const gstin = current.vendorGstin || (picked?.gst_number ?? "");
                            // vendor_master already stores gst_state_code (derived from the GSTIN
                            // on write by erp.service.ts) and payment_terms, and NOTHING in the
                            // GRN path read either of them — Vendor State was hand-picked and the
                            // due date hand-typed on every GRN. Both are seeded here and both stay
                            // editable: a prefill, not a lock, so a one-off term still works.
                            const vendorState =
                              current.vendorStateCode
                              || (picked?.gst_state_code ?? "")
                              || extractStateCodeFromGstin(gstin)
                              || "";
                            const termDays = parsePaymentTermDays(picked?.payment_terms);
                            const seededDue =
                              current.dueDate
                              || (termDays !== null && current.billDate ? addDays(current.billDate, termDays) : current.dueDate);
                            return {
                              ...current,
                              vendorId: value,
                              vendorGstin: gstin,
                              vendorStateCode: vendorState,
                              paymentTermsDays: termDays ?? current.paymentTermsDays,
                              dueDate: seededDue,
                            };
                          });
                        }}
                        search={vendorSearch}
                        onSearchChange={setVendorSearch}
                        placeholder="Select vendor"
                        searchPlaceholder="Type a vendor name or code…"
                        emptyText={vendorSearch.trim() ? "No vendor matches." : "Start typing to search."}
                      />
                    </DenseField>
                    <DenseField label="Vendor GSTIN">
                      <Input
                        id="grn-gstin"
                        className={cn(inputClass, "h-8 font-mono uppercase")}
                        value={form.vendorGstin}
                        placeholder="GSTIN or NA"
                        onChange={(event) => {
                          const gstin = event.target.value.toUpperCase();
                          const stateCode = extractStateCodeFromGstin(gstin);
                          setForm((current) => ({
                            ...current,
                            vendorGstin: gstin,
                            vendorStateCode: stateCode || current.vendorStateCode,
                          }));
                        }}
                      />
                    </DenseField>
                    <DenseField label="GST Applicable">
                      <div className="flex items-center gap-2 h-8">
                        <Switch
                          id="grn-gst-enabled"
                          checked={form.gstEnabled ?? true}
                          onCheckedChange={(checked) =>
                            setForm((current) => ({ ...current, gstEnabled: checked }))
                          }
                        />
                        <span className="text-[12px] text-grn-ink">{form.gstEnabled === false ? "No (International)" : "Yes"}</span>
                      </div>
                    </DenseField>
                  </DenseFieldGroup>

                  {/* Vendor / Billing state, tax type */}
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Vendor State">
                      <GrnSelect
                        className="h-8 w-full text-[12px]"
                        value={form.vendorStateCode}
                        onChange={(e) => setForm((cur) => ({ ...cur, vendorStateCode: e.target.value }))}
                      >
                        <option value="">Select state</option>
                        {GST_STATE_CODES.map((sc) => (
                          <option key={sc.value} value={sc.value}>{sc.label}</option>
                        ))}
                      </GrnSelect>
                    </DenseField>
                    <DenseField label="Billing State (MAS)">
                      <GrnSelect
                        className="h-8 w-full text-[12px]"
                        value={form.billingStateCode}
                        onChange={(e) => setForm((cur) => ({ ...cur, billingStateCode: e.target.value }))}
                      >
                        <option value="">Select state</option>
                        {GST_STATE_CODES.map((sc) => (
                          <option key={sc.value} value={sc.value}>{sc.label}</option>
                        ))}
                      </GrnSelect>
                    </DenseField>
                    <DenseField label="Tax Type">
                      <div className="flex items-center h-8">
                        {form.gstEnabled === false ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600">
                            No GST
                          </span>
                        ) : form.vendorStateCode && form.billingStateCode ? (
                          <span className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold",
                            form.vendorStateCode === form.billingStateCode
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-700"
                          )}>
                            {form.vendorStateCode === form.billingStateCode ? "Intra (CGST/SGST)" : "Inter (IGST)"}
                          </span>
                        ) : (
                          <span className="text-[11px] text-grn-ink-soft">Select states</span>
                        )}
                      </div>
                    </DenseField>
                  </DenseFieldGroup>
                </>
              )}

              {/* Row: Date / Invoice # / Due Date — Vendor only; Imprest's Receipt date lives in
                  its own Company/Branch/Receipt-date row earlier in the sequence. Moved ahead of
                  Budget Allocation per the raiser's requested reorder: Head/Sub-head selection now
                  depends on the invoice date being entered first (see the !form.billDate branch
                  below). */}
              {isVendor && (
              <DenseFieldGroup cols={3}>
                <DenseField
                  label="Invoice date"
                  required
                  error={err("billDate")}
                  hint={effectivePeriod ? `FY ${financialYearFromPeriod(effectivePeriod)}` : undefined}
                >
                  <Input
                    id="grn-bill-date"
                    type="date"
                    className={cn(inputClass, "h-8 w-full")}
                    disabled={locked}
                    value={form.billDate}
                    onChange={(event) => {
                      const billDate = event.target.value;
                      setForm((current) => ({
                        ...current,
                        billDate,
                        accountingPeriod: "",
                        costCentreKey: "",
                        head: "",
                        subHead: "",
                        budgetLineId: "",
                        lateInvoiceReason: "",
                        dueDate:
                          current.dueDate || !billDate
                            ? current.dueDate
                            : addDays(billDate, current.paymentTermsDays),
                      }));
                      setAllocations([newAllocation()]);
                      setInvoiceComponents([newInvoiceComponent()]);
                    }}
                  />
                </DenseField>
                {isVendor && (
                  <DenseField label="Invoice #" required error={err("invoiceNumber")}>
                    <Input
                      id="grn-invoice-no"
                      className={cn(inputClass, "h-8 w-full")}
                      value={form.invoiceNumber}
                      placeholder="As printed"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, invoiceNumber: event.target.value }))
                      }
                    />
                  </DenseField>
                )}
                {isVendor && (
                  <DenseField
                    label="Due date"
                    error={err("dueDate")}
                    hint={dueDateGap !== null && dueDateGap >= 0 ? `${dueDateGap}d from invoice` : undefined}
                  >
                    <Input
                      id="grn-due-date"
                      type="date"
                      className={cn(inputClass, "h-8 w-full")}
                      min={form.billDate || undefined}
                      value={form.dueDate}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, dueDate: event.target.value }))
                      }
                    />
                  </DenseField>
                )}
              </DenseFieldGroup>
              )}

              {/* ── Budget Allocation section (Vendor only now — Imprest has its own copy of
                  this, using the same vendorHeadOptions/vendorSubHeadOptions, positioned earlier
                  per the raiser's requested Imprest sequence). Head/Sub-head first, then the
                  cost-centre split editor below decides which cost centre(s) carry how much.
                  Imprest's old cost-centre-first cascade (headOptions/subHeadOptions/matchingLines/
                  costCentreOptions, and the "Split" toggle into SplitAllocationEditor) stays
                  defined above, untouched and simply unused by this JSX — nothing deleted, just
                  no longer the path a raiser is put through.
                  Moved to sit right after Invoice date/Invoice #/Due date per the raiser's
                  requested reorder, and now gated on form.billDate being set first — an invoice
                  date is what determines the accounting period the Head/Sub-head budget lines are
                  fetched against, so picking Head/Sub-head before it is set is a dead end. */}
              {isVendor && (
                <>
                  <DenseSection
                    title="Budget Allocation"
                    action={<GrnBudgetImportButton branchId={form.branchId} period={effectivePeriod} disabled={locked} />}
                  />

                  {!form.billDate ? (
                    <>
                      <DenseFieldGroup cols={2}>
                        <DenseField label="Head">
                          <div className="h-8 flex items-center rounded-[8px] border border-grn-line bg-slate-50 px-2 text-[12px] text-grn-ink-soft">
                            Select
                          </div>
                        </DenseField>
                        <DenseField label="Sub-head">
                          <div className="h-8 flex items-center rounded-[8px] border border-grn-line bg-slate-50 px-2 text-[12px] text-grn-ink-soft">
                            Select
                          </div>
                        </DenseField>
                      </DenseFieldGroup>
                      <p className="py-1 text-[11px] text-grn-ink-soft">
                        Enter Invoice Date to select Head/Sub-head.
                      </p>
                    </>
                  ) : !form.branchId || !effectivePeriod ? (
                    <div className="py-2 text-[11px] text-grn-warn">
                      Select branch and date first to load budgets.
                    </div>
                  ) : linesLoading ? (
                    <div className="flex items-center gap-2 py-3 text-[11px] text-grn-ink-soft">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading budgets…
                    </div>
                  ) : (
                    <>
                      <DenseFieldGroup cols={2}>
                        <DenseField label="Head" required error={err("head")}>
                          <SearchableSelect
                            id="grn-head"
                            aria-label="Expense head"
                            options={vendorHeadOptions}
                            value={form.head}
                            onChange={(value) => setForm((current) => ({ ...current, head: value, subHead: "" }))}
                            placeholder="Select head"
                            searchPlaceholder="Type a head…"
                          />
                        </DenseField>
                        <DenseField label="Sub-head" required error={err("subHead")}>
                          <SearchableSelect
                            id="grn-subhead"
                            aria-label="Expense sub-head"
                            disabled={!form.head}
                            options={vendorSubHeadOptions}
                            value={form.subHead}
                            onChange={(value) => setForm((current) => ({ ...current, subHead: value }))}
                            placeholder={form.head ? "Select sub-head" : "Select head first"}
                            searchPlaceholder="Type a sub-head…"
                          />
                        </DenseField>
                      </DenseFieldGroup>
                      {form.head && !vendorHeadOptions.find((o) => o.value === form.head)?.hasBudget && (
                        <p className="text-[10px] text-amber-600">
                          No approved budget for this head — Finance Head must link during approval.
                        </p>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Late invoice warning (non-finance raisers, >30 days old) */}
              {isVendor && !isFinanceLead && form.billDate && (() => {
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const billD = new Date(form.billDate); billD.setHours(0, 0, 0, 0);
                const daysOld = Math.floor((today.getTime() - billD.getTime()) / 86400000);
                if (daysOld <= 30) return null;
                return (
                  <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="flex items-start gap-2 text-[11px] text-amber-800">
                      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span>Invoice is <strong>{daysOld} days old</strong>. Reason required.</span>
                    </div>
                    <textarea
                      className="mt-1.5 w-full rounded-[6px] border border-amber-300 bg-white px-2 py-1.5 text-xs text-grn-ink placeholder:text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      placeholder="e.g. Invoice received late from vendor"
                      rows={2}
                      value={form.lateInvoiceReason}
                      onChange={(e) => setForm((cur) => ({ ...cur, lateInvoiceReason: e.target.value }))}
                    />
                    {!form.lateInvoiceReason.trim() && (
                      <p className="mt-1 text-[10px] text-amber-700">Required before saving</p>
                    )}
                  </div>
                );
              })()}

              {/* Accounting period + Recognise-across-months — right after the Invoice date, not
                  after Amount, and side by side in one row rather than stacked, to use the row's
                  width instead of leaving half of it blank. */}
              {isVendor && (
                <DenseFieldGroup cols={2}>
                  <div>
                    {canOverridePeriod && period ? (
                      <DenseField
                        label="Accounting period"
                        hint={
                          (form.accountingPeriod && form.accountingPeriod !== period
                            ? `Booking into ${form.accountingPeriod} (invoice month: ${period})`
                            : "Leave as-is for invoice date month")
                          + (effectivePeriod ? ` · FY ${financialYearFromPeriod(effectivePeriod)}` : "")
                        }
                      >
                        <MonthYearPicker
                          className="w-full"
                          disabled={locked && !canOverridePeriod}
                          value={effectivePeriod}
                          onChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              accountingPeriod: value === period ? "" : value,
                            }))
                          }
                          selectClassName="h-8 rounded-[8px] border border-grn-line bg-white px-2 text-[12px] text-grn-ink focus:outline-none focus:ring-2 focus:ring-grn-brand/15"
                        />
                      </DenseField>
                    ) : (
                      !canOverridePeriod && effectivePeriod && (
                        <div className="flex h-8 items-center gap-2 text-[12px] text-grn-ink">
                          <span className="text-grn-ink-soft">Period:</span>
                          <span className="font-bold">{effectivePeriod}</span>
                          <span className="text-grn-ink-soft">(FY {financialYearFromPeriod(effectivePeriod)})</span>
                        </div>
                      )
                    )}
                  </div>
                  <MonthSplitPanel
                    value={monthSplit}
                    onChange={setMonthSplit}
                    amount={Number(form.amount) || 0}
                    accountingPeriod={period}
                    disabled={locked}
                    canCustomSplit={isFinanceLead}
                    canCrossFy={isFinanceLead}
                  />
                </DenseFieldGroup>
              )}
              {isVendor && canOverridePeriod && form.accountingPeriod && form.accountingPeriod !== period && (
                <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>Period-end cut-off: booking into <strong>{form.accountingPeriod}</strong> instead of {period}.</span>
                </div>
              )}

              {/* Amount — Vendor only. Imprest's Amount+Remark now lives in its own row earlier
                  in the sequence (merged there per the raiser's requested Imprest layout), so
                  there is no imprest branch here any more — rendering both would duplicate it. */}
              {isVendor && (
                <DenseFieldGroup cols={2}>
                  <DenseField label="Amount (incl. GST)" required error={err("amount")}>
                    <Input
                      id="grn-amount"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      className={cn(inputClass, "h-8 w-full text-right font-semibold tabular-nums")}
                      value={form.amount || ""}
                      placeholder="0.00"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, amount: Number(event.target.value) }))
                      }
                    />
                  </DenseField>
                  {/* Same form.remarks state InvoiceComponentsEditor's GST-slab split reads/
                      writes below — surfaced here too so vendor Amount gets a Description field
                      right beside it, matching the legacy "Total Bill Amount | Description" row
                      instead of only appearing at the very end of the split editor. */}
                  <DenseField label="Description" required error={err("remarks")}>
                    <Input
                      id="grn-description"
                      className={cn(inputClass, "h-8 w-full")}
                      value={form.remarks}
                      placeholder="What was bought or paid for, and why."
                      onChange={(event) =>
                        setForm((current) => ({ ...current, remarks: event.target.value }))
                      }
                    />
                  </DenseField>
                </DenseFieldGroup>
              )}

            </div>
          </GrnCard>

          {/* Vendor GRNs: cost-centre split, then invoice GST components, in that order — the
              unified flow. Each is its own card for the same reason SplitAllocationEditor already
              is: its own toolbar and its own reconciliation footer. */}
          {/* Authoritative budget-headroom warning — reads the same Group C gate
              (budget-headroom-gate.service.ts) enforced server-side at save time, via
              GET /pnl/budget-headroom. Advisory only: the server remains authoritative regardless
              of what renders here. Replaces the old client-only "Unbudgeted Expense" banner, whose
              "will be flagged as unbudgeted and require Finance Head approval" wording is no
              longer true — NO_BUDGET_FOR_HEAD and HEADROOM_EXCEEDED are hard blocks now, not a
              later approval step. */}
          {isVendor && Boolean(form.branchId && effectivePeriod && form.head && form.subHead) && (
            headroomLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] text-grn-ink-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking budget headroom…
              </div>
            ) : !headroom ? null : !headroom.headerActive ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium">No Approved Budget for this Branch</p>
                    <p className="text-sm text-amber-700">
                      No approved budget exists for this branch for {effectivePeriod}. A GRN cannot be raised until one is approved.
                    </p>
                  </div>
                </div>
              </div>
            ) : !headroom.hasAnyLine ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium">No Budget for this Head/Sub-head</p>
                    <p className="text-sm text-amber-700">
                      {form.head}/{form.subHead} has no budget anywhere in this branch. Raise a Budget Addition Request before submitting this GRN.
                    </p>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center rounded-[6px] border border-amber-300 bg-white px-2.5 py-1 text-[12px] font-medium text-amber-800 hover:bg-amber-100"
                      onClick={() =>
                        navigate(
                          `/finance/branch-budget?tab=topups`
                          + `&newLineHead=${encodeURIComponent(form.head)}`
                          + `&newLineSubHead=${encodeURIComponent(form.subHead)}`
                          + `&branchId=${encodeURIComponent(form.branchId)}`
                          + `&period=${encodeURIComponent(effectivePeriod)}`
                        )
                      }
                    >
                      Raise a Budget Addition Request
                    </button>
                  </div>
                </div>
              </div>
            ) : headroom.aggregateAvailable <= 0 || (Number(form.amount) > 0 && headroom.aggregateAvailable < Number(form.amount)) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium">Budget Exhausted</p>
                    <p className="text-sm text-amber-700">
                      Branch-wide budget for {form.head}/{form.subHead} is exhausted.
                      {headroom.aggregateAvailable > 0 && ` Available: ${money(headroom.aggregateAvailable)}`}
                    </p>
                  </div>
                </div>
              </div>
            ) : headroom.aggregateAvailable > 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-800">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
                  <div>
                    <p className="font-medium">Budget Available: {money(headroom.aggregateAvailable)}</p>
                    <p className="text-sm text-emerald-700">
                      {form.head}/{form.subHead} has approved budget for this branch.
                    </p>
                  </div>
                </div>
              </div>
            ) : null
          )}

          {Boolean(form.branchId) && Boolean(effectivePeriod) && !linesLoading && vendorCostCentreGroups.length > 0 && (
            <CostCentreSplitEditor
              groups={vendorCostCentreGroups}
              rows={costCentreSplits}
              total={costCentreSplitTotal}
              error={err("costCentreSplit")}
              onUpdate={updateCostCentreSplit}
              onSplitEvenly={splitCostCentresEvenly}
              splitMethod={costCentreSplitMethod}
              onSplitMethodChange={setCostCentreSplitMethod}
              onApplySplit={applyCostCentreSplitMethod}
              splitReadiness={costCentreSplitReadiness}
              directCostCentreKey={directCostCentreKey}
              onDirectCostCentreChange={setDirectCostCentreKey}
              isUnbudgeted={isUnbudgetedExpense}
              hideGstColumn={!isVendor}
            />
          )}

          {/* Show InvoiceComponentsEditor when cost centre splits exist — the split section now
              uses ALL active cost centres (Branch Budget pattern), so it always appears when there
              are matching budget lines. */}
          {isVendor && Boolean(form.branchId) && Boolean(effectivePeriod) && costCentreSplits.length > 0 && (
            <InvoiceComponentsEditor
              components={invoiceComponents}
              preview={componentsPreview}
              declaredTotal={Number(form.amount || 0)}
              error={err("components")}
              remarks={form.remarks}
              remarksError={err("remarks")}
              isFinanceLead={isFinanceLead}
              onUpdate={updateInvoiceComponent}
              onAdd={addInvoiceComponent}
              onRemove={removeInvoiceComponent}
              canRemove={invoiceComponents.length > 1}
              onRemarksChange={(value) => setForm((current) => ({ ...current, remarks: value }))}
            />
          )}

          {/* Its own card, not a block nested inside the one above: it has its own toolbar and
              its own reconciliation footer, which a section body has nowhere to put. */}
          {!isVendor && splitMode && Boolean(form.branchId) && Boolean(effectivePeriod) && !linesLoading && budgetLines.length > 0 && (
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

          {/* ── Attachments (GRN File) — relocated here, after the split/Details Entry
                 section, to mirror where the legacy HRMS form places the file upload. ── */}
          <GrnCard>
            <div className="p-4 space-y-1">
              <DenseSection title="Attachments" variant="panel" />
              {/* `relative` is load-bearing, not decoration. Tailwind's `sr-only` makes the file
                  input below `position: absolute`, and with no positioned ancestor its containing
                  block was the INITIAL one -- the viewport -- not #main-content-area. So the input
                  escaped that scroll container's clipping and stretched the DOCUMENT to reach it,
                  giving /finance/grn a second, window-level scrollbar beside the app's own.
                  Measured on production: documentElement.scrollHeight 1023 vs clientHeight 788, a
                  235px phantom scroll that exactly matched this input's distance below the fold;
                  containing it returns the document to 788 = 788, one scrollbar. */}
              <label className="relative flex cursor-pointer items-center gap-3 rounded-[8px] border border-dashed border-grn-line bg-grn-paper px-3 py-2.5 text-center transition-colors hover:border-grn-brand hover:bg-grn-card">
                <UploadCloud className="h-5 w-5 text-grn-ink-soft" strokeWidth={1.6} />
                <div className="flex-1 text-left">
                  <span className="text-[12px] font-semibold text-grn-ink">
                    Tap to attach invoice/receipt
                  </span>
                  <span className="ml-2 text-[11px] text-grn-ink-soft">
                    PDF, JPG, PNG, WEBP · max 10 files
                  </span>
                </div>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  className="sr-only"
                  onChange={(event) => {
                    const incoming = Array.from(event.target.files ?? []);
                    setFiles((prev) => {
                      const existingNames = new Set(prev.map((f) => f.name));
                      return [...prev, ...incoming.filter((f) => !existingNames.has(f.name))];
                    });
                    // reset input so the same file can be re-added after removal
                    event.target.value = "";
                  }}
                />
              </label>

              {/* Attached files list - compact */}
              {(files.length > 0 || (workspace?.documents?.length ?? 0) > 0) && (
                <ul className="mt-2 space-y-1">
                  {files.map((file) => (
                    <li
                      key={file.name}
                      className="flex items-center justify-between gap-2 rounded-[6px] border border-grn-line bg-grn-paper px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="truncate text-grn-ink">{file.name}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <StatusStamp tone="neutral">Pending</StatusStamp>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          className="text-grn-ink-soft hover:text-grn-crit"
                          onClick={() => setFiles((prev) => prev.filter((f) => f.name !== file.name))}
                        >
                          <XCircle className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                  {workspace?.documents?.map((document) => {
                    const tone = checkTone(String(document.extraction_status ?? "pending"));
                    return (
                      <li
                        key={document.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-[6px] border px-2.5 py-1.5 text-[11px]",
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

              {/* Auto-analyze toggle - compact inline */}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-grn-ink-soft">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    checked={autoAnalyze}
                    onChange={(event) => setAutoAnalyze(event.target.checked)}
                  />
                  Auto-read invoice after upload
                </label>
                {primaryDocument && (
                  <Button
                    size="sm"
                    disabled={analyzeMutation.isPending}
                    onClick={() => analyzeMutation.mutate(primaryDocument.id)}
                  >
                    {analyzeMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ScanLine className="h-3 w-3" />
                    )}
                    Analyze
                  </Button>
                )}
              </div>
            </div>
          </GrnCard>

          {/* Save / Reset — the true end of the fill-out flow (title → fields → split →
              Attachments), not mid-page. Having it right after Branch/Company meant finishing
              Attachments or the split table required scrolling back up to submit. */}
          <div className="flex justify-end gap-2">{actionButtons}</div>

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

        </div>

        {/* Side rail now carries only Cost — Readiness and Approval path moved to the top strip
            next to the mode toggle. */}
        <aside className="hidden rounded-[12px] border border-grn-line bg-grn-card p-4 min-[900px]:block">
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-grn-ink-soft">
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
        </aside>
      </div>

      {/* Item 10: fresh-create submit confirmation — replaces the old silent auto-reset with an
          explicit "GRN Raised" acknowledgement. Edit-and-resubmit (editGrnId set) never opens this;
          that path still resets straight back to the Queue via onEditComplete. */}
      <Dialog
        open={Boolean(submittedGrn)}
        onOpenChange={(open) => {
          if (!open) handleCloseSubmittedGrnDialog();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>GRN Raised</DialogTitle></DialogHeader>
          <p className="text-[13px] text-grn-ink-soft">
            GRN {submittedGrn?.grnNumber} has been submitted for Branch Head review.
          </p>
          <div className="mt-1 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-grn-ink-soft">
              Create another
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => handleCreateAnotherGrn("vendor" as GrnType)}
              >
                <IndianRupee className="h-3.5 w-3.5" />
                Create Vendor GRN
              </Button>
              <Button
                className="flex-1"
                onClick={() => handleCreateAnotherGrn("imprest" as GrnType)}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Create Imprest GRN
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleCloseSubmittedGrnDialog}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/** One Head/Sub-head, split by percentage across every cost centre that has an approved budget
 *  line for it. A cost centre with more than one matching line gets its own item picker, the
 *  same "only when genuinely ambiguous" rule the single-line cascade already uses.
 *  G15: Now supports driver-based auto-split methods (headcount, revenue, seat count, etc.) like
 *  Branch Budget planning — same infrastructure, same sharing weights. */
function CostCentreSplitEditor({
  groups,
  rows,
  total,
  error,
  onUpdate,
  onSplitEvenly,
  splitMethod,
  onSplitMethodChange,
  onApplySplit,
  splitReadiness,
  directCostCentreKey,
  onDirectCostCentreChange,
  isUnbudgeted,
  hideGstColumn,
}: {
  groups: Array<{ costCentreKey: string; costCentreName: string; processName?: string | null; lines: BudgetLine[] }>;
  rows: CostCentreSplitDraft[];
  total: number;
  error?: string;
  onUpdate: (key: string, patch: Partial<CostCentreSplitDraft>) => void;
  onSplitEvenly: () => void;
  splitMethod: string;
  onSplitMethodChange: (method: string) => void;
  onApplySplit: () => void;
  splitReadiness: { ready: boolean; reason: string };
  directCostCentreKey: string;
  onDirectCostCentreChange: (key: string) => void;
  /** True when no budget exists for the selected HEAD/SUB-HEAD */
  isUnbudgeted?: boolean;
  /** Hide GST/Tax column — imprest vouchers don't need tax breakdown */
  hideGstColumn?: boolean;
}) {
  const reconciled = Math.abs(total - 100) <= 0.5;
  const isDirectMethod = splitMethod === "direct";

  return (
    <GrnCard>
      <GrnCardHeader
        title="Cost-centre split"
        description={
          isDirectMethod
            ? "Select which cost centre receives 100% of this spend."
            : "Select a split method to distribute the spend across cost centres."
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <GrnSelect
              value={splitMethod}
              onChange={(event) => onSplitMethodChange(event.target.value)}
              className="h-9 w-[180px] text-[12px]"
              title={!splitReadiness.ready ? splitReadiness.reason : undefined}
            >
              {GRN_AUTO_SPLIT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </GrnSelect>
            {isDirectMethod && (
              <GrnSelect
                value={directCostCentreKey}
                onChange={(event) => onDirectCostCentreChange(event.target.value)}
                className="h-9 min-w-[200px] text-[12px]"
              >
                <option value="">Select cost centre</option>
                {groups.map((group) => {
                  // Direct sends 100% of the spend to whichever cost centre is picked here, so a
                  // raiser choosing "by name" alone has no way to tell a budgeted CC from one with
                  // no approved line for this Head/Sub-head — they'd only find out from the "Select
                  // a budget line" error after Apply. Label it up front instead.
                  const available = group.lines.reduce((sum, l) => sum + Number(l.available_gross_amount || 0), 0);
                  const suffix = group.lines.length > 0 ? ` — ${money(available)} available` : " — no budget line";
                  const processHint = group.processName ? ` (${group.processName})` : "";
                  return (
                    <option key={group.costCentreKey} value={group.costCentreKey}>
                      {group.costCentreName}{processHint}{suffix}
                    </option>
                  );
                })}
              </GrnSelect>
            )}
            <Button
              onClick={onApplySplit}
              disabled={!splitReadiness.ready}
              title={!splitReadiness.ready ? splitReadiness.reason : undefined}
            >
              <Split className="h-3.5 w-3.5" /> Apply
            </Button>
          </div>
        }
      />

      {/* Stacked cards on phones. */}
      <div className="space-y-3 p-4 md:hidden">
        {rows.map((row, index) => {
          const group = groups.find((item) => item.costCentreKey === row.costCentreKey);
          const line = group?.lines.find((item) => item.id === row.budgetLineId);
          const nonTaxable = line && ["exempt", "non_gst"].includes(line.tax_treatment);
          const hasOwnBudget = Boolean(line && line.cost_centre_id === row.costCentreKey);
          const ownBudgetAvailable = hasOwnBudget && Number(line?.available_gross_amount || 0) > 0;
          const sharedLine = group?.lines.find((l) => !l.cost_centre_id);
          const sharedPoolAmount = sharedLine ? Number(sharedLine.available_gross_amount) : 0;
          return (
            <div key={row.key} className={cn("rounded-[10px] border border-grn-line p-3", !row.included && "opacity-50")}>
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={row.included}
                    onCheckedChange={(checked) => onUpdate(row.key, { included: Boolean(checked) })}
                    aria-label={`Include ${group?.costCentreName ?? "cost centre"} in split`}
                  />
                  <div>
                    <span className="font-grn-mono text-[12px] font-bold text-grn-ink-soft">
                      {group?.costCentreName ?? "Cost centre"}
                    </span>
                    {group?.processName && <GrnCellSub>{group.processName}</GrnCellSub>}
                    {line && (
                      <GrnCellSub className={!ownBudgetAvailable ? "text-blue-600" : undefined}>
                        {ownBudgetAvailable
                          ? `${money(Number(line.available_gross_amount))} available`
                          : `Shared pool (${money(sharedPoolAmount)})`}
                      </GrnCellSub>
                    )}
                  </div>
                </div>
                {!hideGstColumn && line && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      nonTaxable ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    )}
                  >
                    {nonTaxable ? (line.tax_treatment === "exempt" ? "Exempt" : "Non-GST") : `GST ${line.gst_rate}%`}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {group && group.lines.length > 1 && (
                  <SearchableSelect
                    aria-label={`Budget item for ${group.costCentreName}`}
                    options={group.lines.map((item) => ({
                      value: item.id,
                      label: item.item_name,
                      hint: `${money(Number(item.available_gross_amount))} left`,
                    }))}
                    value={row.budgetLineId}
                    onChange={(value) => onUpdate(row.key, { budgetLineId: value })}
                    placeholder="Select the item"
                  />
                )}
                <div>
                  <Label className="text-[11px] text-grn-ink-soft">Split %</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="h-11 text-right"
                    value={row.percentage}
                    onChange={(event) => onUpdate(row.key, { percentage: Number(event.target.value) })}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table from md up. */}
      <div className="hidden md:block">
        <GrnTable minWidth={650}>
          <thead>
            <tr>
              <GrnTh sticky={false} className="w-10">Include</GrnTh>
              <GrnTh sticky={false} className="w-8">#</GrnTh>
              <GrnTh sticky={false}>Cost centre</GrnTh>
              <GrnTh sticky={false}>Item</GrnTh>
              {!hideGstColumn && <GrnTh sticky={false} className="w-28">Tax</GrnTh>}
              <GrnTh sticky={false} align="right" className="w-28">Split %</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">Available</GrnTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const group = groups.find((item) => item.costCentreKey === row.costCentreKey);
              const line = group?.lines.find((item) => item.id === row.budgetLineId);
              const nonTaxable = line && ["exempt", "non_gst"].includes(line.tax_treatment);
              // A branch-common line (cost_centre_id NULL) is offered to every cost centre, so
              // several rows can resolve to the SAME line and would otherwise all show its full
              // balance — reading as if each cost centre independently had that much available,
              // when they're drawing from one shared pool. Only a line actually scoped to THIS
              // cost centre counts as its own available budget; a shared fallback shows ₹0 here
              // (informational only — doesn't block the split, isUnbudgeted already covers that).
              const hasOwnBudget = Boolean(line && line.cost_centre_id === row.costCentreKey);
              const ownBudgetAvailable = hasOwnBudget && Number(line?.available_gross_amount || 0) > 0;
              // Find a branch-common line (cost_centre_id = NULL) for shared pool display
              const sharedLine = group?.lines.find((l) => !l.cost_centre_id);
              const sharedPoolAmount = sharedLine ? Number(sharedLine.available_gross_amount) : 0;
              return (
                <tr key={row.key} className={cn(GRN_TR, !row.included && "opacity-50")}>
                  <GrnTd>
                    <Checkbox
                      checked={row.included}
                      onCheckedChange={(checked) => onUpdate(row.key, { included: Boolean(checked) })}
                      aria-label={`Include ${group?.costCentreName ?? "cost centre"} in split`}
                    />
                  </GrnTd>
                  <GrnTd className="font-grn-mono text-grn-ink-soft">{index + 1}</GrnTd>
                  <GrnTd className="font-semibold">
                    {group?.costCentreName ?? "—"}
                    {group?.processName && <GrnCellSub>{group.processName}</GrnCellSub>}
                  </GrnTd>
                  <GrnTd className="min-w-[200px]">
                    {group && group.lines.length > 1 ? (
                      <SearchableSelect
                        aria-label={`Budget item for ${group.costCentreName}`}
                        className="h-[34px]"
                        options={group.lines.map((item) => ({
                          value: item.id,
                          label: item.item_name,
                          hint: `${money(Number(item.available_gross_amount))} left`,
                        }))}
                        value={row.budgetLineId}
                        onChange={(value) => onUpdate(row.key, { budgetLineId: value })}
                        placeholder="Select item"
                      />
                    ) : (
                      <span className="text-grn-ink-soft">{line?.item_name ?? "—"}</span>
                    )}
                  </GrnTd>
                  {!hideGstColumn && (
                    <GrnTd>
                      {line ? (
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            nonTaxable
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          )}
                          title={line.tax_treatment.replace("_", " ")}
                        >
                          {nonTaxable ? (line.tax_treatment === "exempt" ? "Exempt" : "Non-GST") : `GST ${line.gst_rate}%`}
                        </span>
                      ) : "—"}
                    </GrnTd>
                  )}
                  <GrnTd>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      className="text-right"
                      value={row.percentage}
                      onChange={(event) => onUpdate(row.key, { percentage: Number(event.target.value) })}
                    />
                  </GrnTd>
                  <GrnTd align="right" className="font-grn-mono">
                    {!line ? (
                      "—"
                    ) : ownBudgetAvailable ? (
                      money(Number(line.available_gross_amount))
                    ) : (
                      <span className="text-blue-600" title={`Drawing from branch-level shared pool: ${money(sharedPoolAmount)} available`}>
                        Shared pool
                      </span>
                    )}
                  </GrnTd>
                </tr>
              );
            })}
          </tbody>
        </GrnTable>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grn-line-soft px-4 py-2.5 text-[12px]">
        <span className="text-grn-ink-soft">
          {rows.length} cost {rows.length === 1 ? "centre" : "centres"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-grn-ink-soft">
            Total <b className="font-grn-mono text-grn-ink">{decimal(total, 2)}%</b>
          </span>
          {reconciled ? (
            <StatusStamp tone="ok">Reconciled</StatusStamp>
          ) : (
            <StatusStamp tone="crit">
              {total > 100 ? "Over" : "Under"} by {decimal(Math.abs(100 - total), 2)}%
            </StatusStamp>
          )}
        </span>
      </div>

      {/* G15: Show why auto-split isn't ready, if it isn't */}
      {!splitReadiness.ready && splitMethod !== "equal_split" && (
        <p className="flex items-start gap-1 border-t border-grn-line-soft px-4 py-2.5 text-[11px] text-amber-700">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          {splitReadiness.reason}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1 border-t border-grn-line-soft px-4 py-2.5 text-[11px] font-semibold text-grn-crit">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </GrnCard>
  );
}

/** The invoice broken into repeatable {amount without tax, GST slab} components — the same
 *  physical invoice routinely carries 2+ GST rates. Placed last, per the raiser's own workflow:
 *  total first, classification and split next, tax breakdown last once the invoice is in hand. */
function InvoiceComponentsEditor({
  components,
  preview,
  declaredTotal,
  error,
  remarks,
  remarksError,
  isFinanceLead,
  onUpdate,
  onAdd,
  onRemove,
  canRemove,
  onRemarksChange,
}: {
  components: InvoiceComponentDraft[];
  preview: { rawTotalBase: number; rawTotalTax: number; rawTotalGross: number; diff: number };
  declaredTotal: number;
  error?: string;
  remarks: string;
  remarksError?: string;
  isFinanceLead: boolean;
  onUpdate: (key: string, patch: Partial<InvoiceComponentDraft>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
  canRemove: boolean;
  onRemarksChange: (value: string) => void;
}) {
  // G8: Finance Head / Accounts Head can accept up to ₹500 round-off; others limited to ₹1.
  // Mirrors isElevatedRole in grn-smart.service.ts, whose own comment reads "Branch-level roles
  // are still limited to ₹1" — so this must NOT be the wider canOverridePeriod list.
  const roundoffLimit = isFinanceLead ? 500 : 1;
  const withinAutoRoundoff = Math.abs(preview.diff) <= roundoffLimit;
  const reconciled = Math.abs(preview.diff) <= 0.01;

  return (
    <GrnCard>
      <GrnCardHeader
        title="Invoice components"
        description="Break the invoice into its GST slabs — add another row if the same invoice carries more than one rate."
        action={
          <Button onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" /> Add component
          </Button>
        }
      />

      {/* Stacked cards on phones. */}
      <div className="space-y-3 p-4 md:hidden">
        {components.map((component, index) => {
          const tax = roundMoney(Number(component.amountWithoutTax || 0) * Number(component.gstRate || 0) / 100);
          const gross = roundMoney(Number(component.amountWithoutTax || 0) + tax);
          return (
            <div key={component.key} className="rounded-[10px] border border-grn-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-grn-mono text-[12px] font-bold text-grn-ink-soft">Component {index + 1}</span>
                {canRemove && (
                  <GrnIconButton
                    className="h-11 w-11"
                    aria-label={`Remove component ${index + 1}`}
                    onClick={() => onRemove(component.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </GrnIconButton>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[11px] text-grn-ink-soft">Amount without tax</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    className="h-11 text-right"
                    value={component.amountWithoutTax || ""}
                    placeholder="0.00"
                    onChange={(event) => onUpdate(component.key, { amountWithoutTax: Number(event.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-grn-ink-soft">GST slab</Label>
                  <GrnSelect
                    className="h-11"
                    value={component.gstRate}
                    onChange={(event) => onUpdate(component.key, { gstRate: Number(event.target.value) })}
                  >
                    {GST_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </GrnSelect>
                </div>
                <div>
                  <Label className="text-[11px] text-grn-ink-soft">GST Amount</Label>
                  <div className="flex h-11 items-center justify-end rounded-[8px] border border-grn-line bg-grn-paper px-3 font-grn-mono text-[13px]">
                    {money(tax)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between rounded-[8px] border border-grn-line bg-grn-paper px-3 py-2 text-[12px]">
                <span className="text-grn-ink-soft">Incl. GST</span>
                <b className="font-grn-mono">{money(gross)}</b>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table from md up. */}
      <div className="hidden md:block">
        <GrnTable minWidth={720}>
          <thead>
            <tr>
              <GrnTh sticky={false} className="w-8">#</GrnTh>
              <GrnTh sticky={false} align="right" className="w-36">Amount without tax</GrnTh>
              <GrnTh sticky={false} align="right" className="w-24">GST slab</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">GST Amount</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">Incl. GST</GrnTh>
              <GrnTh sticky={false} className="w-12" />
            </tr>
          </thead>
          <tbody>
            {components.map((component, index) => {
              const tax = roundMoney(Number(component.amountWithoutTax || 0) * Number(component.gstRate || 0) / 100);
              const gross = roundMoney(Number(component.amountWithoutTax || 0) + tax);
              return (
                <tr key={component.key} className={GRN_TR}>
                  <GrnTd className="font-grn-mono text-grn-ink-soft">{index + 1}</GrnTd>
                  <GrnTd>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      className="text-right"
                      value={component.amountWithoutTax || ""}
                      placeholder="0.00"
                      onChange={(event) => onUpdate(component.key, { amountWithoutTax: Number(event.target.value) })}
                    />
                  </GrnTd>
                  <GrnTd>
                    <GrnSelect
                      value={component.gstRate}
                      onChange={(event) => onUpdate(component.key, { gstRate: Number(event.target.value) })}
                    >
                      {GST_RATES.map((rate) => (
                        <option key={rate} value={rate}>{rate}%</option>
                      ))}
                    </GrnSelect>
                  </GrnTd>
                  <GrnTd align="right">{money(tax)}</GrnTd>
                  <GrnTd align="right" className="font-semibold">{money(gross)}</GrnTd>
                  <GrnTd>
                    <GrnIconButton
                      disabled={!canRemove}
                      aria-label={`Remove component ${index + 1}`}
                      onClick={() => onRemove(component.key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </GrnIconButton>
                  </GrnTd>
                </tr>
              );
            })}
          </tbody>
        </GrnTable>
      </div>

      {/* Reconciliation, stated as the two figures that have to agree — same convention as
          SplitAllocationEditor's footer. A ≤₹1 gap is disclosed as an auto-round-off, not an
          error; only a genuine mismatch (>₹1) is treated as one. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-grn-line-soft px-4 py-2.5 text-[12px]">
        <span className="text-grn-ink-soft">
          {components.length} component{components.length === 1 ? "" : "s"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-grn-ink-soft">
            Components <b className="font-grn-mono text-grn-ink">{money(preview.rawTotalGross)}</b> · Invoice{" "}
            <b className="font-grn-mono text-grn-ink">{money(declaredTotal)}</b>
          </span>
          {reconciled ? (
            <StatusStamp tone="ok">Reconciled</StatusStamp>
          ) : withinAutoRoundoff ? (
            <StatusStamp tone="warn">
              Auto round-off {preview.diff >= 0 ? "+" : ""}{money(preview.diff)}
            </StatusStamp>
          ) : (
            <StatusStamp tone="crit">
              Out by {preview.diff >= 0 ? "+" : ""}{money(preview.diff)}
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

      <div className="border-t border-grn-line-soft bg-grn-paper px-4 py-3">
        <dl className="ml-auto w-full space-y-1.5 text-[12px] md:max-w-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-grn-ink-soft">Taxable value</dt>
            <dd className="font-grn-mono font-semibold text-grn-ink">{money(preview.rawTotalBase)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-grn-ink-soft">GST</dt>
            <dd className="font-grn-mono font-semibold text-grn-ink">{money(preview.rawTotalTax)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-grn-line pt-1.5">
            <dt className="font-bold text-grn-ink">Total payable</dt>
            <dd className="font-grn-mono text-[13px] font-bold text-grn-ink">{money(declaredTotal)}</dd>
          </div>
        </dl>
      </div>

    </GrnCard>
  );
}
