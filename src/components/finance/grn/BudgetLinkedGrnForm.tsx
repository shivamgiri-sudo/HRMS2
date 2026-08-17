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
} from "@/components/finance/grn/grn-ui";
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
    queryFn: () => hrmsApi.get<any>("/api/org/branches?limit=200"),
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
    const budgetedHeads = new Set(budgetLines.map((line) => line.head));
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
  }, [budgetLines, allExpenseMasterHeads, expenseSelectable]);

  const vendorLinesInHead = useMemo(
    () => budgetLines.filter((line) => line.head === form.head),
    [budgetLines, form.head]
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
        lines: allLines,
      };
    });
  }, [vendorMatchingLines, activeCostCentres, form.head, form.subHead]);

  /** True when no budget exists for the selected HEAD/SUB-HEAD — expense is unbudgeted */
  const isUnbudgetedExpense = useMemo(() => {
    if (!isVendor || !form.head || !form.subHead) return false;
    // Check if ANY cost centre has a budget line for this HEAD/SUB-HEAD
    return vendorCostCentreGroups.length > 0 && vendorCostCentreGroups.every((g) => g.lines.length === 0);
  }, [isVendor, form.head, form.subHead, vendorCostCentreGroups]);

  // Clear a stale vendor Head/Sub-head the same way the single-line cascade already does above.
  useEffect(() => {
    setForm((current) => {
      if (!isVendor || !current.head) return current;
      const validHead = vendorHeadOptions.some((option) => option.value === current.head);
      return validHead ? current : { ...current, head: "", subHead: "" };
    });
  }, [vendorHeadOptions, isVendor]);

  useEffect(() => {
    setForm((current) => {
      if (!isVendor || !current.subHead) return current;
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
    if (!isVendor) return;
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
  }, [vendorCostCentreGroups, isVendor]);

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
        current.map((row) => ({
          ...row,
          percentage: row.costCentreKey === directCostCentreKey ? 100 : 0,
        }))
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
      // Imprest keeps the exact single-line / split-mode behaviour, untouched.
      if (!splitMode) {
        if (!form.costCentreKey) next.costCentreKey = "Select a cost centre.";
        if (!form.head) next.head = "Select an expense head.";
        if (!form.subHead) next.subHead = "Select a sub-head.";
        if (needsItemChoice && !form.budgetLineId) {
          next.budgetLineId = "More than one budget line matches — pick the item.";
        }
        // headOptions/subHeadOptions now include every expense master head/sub-head, not just
        // ones with an existing budget line (see headOptions above), so a raiser can select a
        // combination with no matching BudgetLine at all. Unlike the vendor cascade — which has
        // a genuinely separate "unbudgeted" submission path that sends the cost-centre id
        // directly and lets Finance Head link a budget line during approval — Imprest's create
        // payload hard-requires resolvedLine.id (see the submit handler below). Without this
        // guard that resolves to null and throws on save instead of failing with a message.
        if (form.head && form.subHead && !needsItemChoice && !resolvedLine) {
          next.budgetLineId =
            "No approved budget line for this Head/Sub-head in this cost centre and period. "
            + "Ask Branch/Finance Head to add one, or pick a different combination.";
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
    setCostCentreSplits([]);
    setInvoiceComponents([newInvoiceComponent()]);
    setFiles([]);
    setCreated(null);
    setExtractedFields(null);
    setSplitMode(false);
    setShowErrors(false);
    setPrefilledForEdit(true);
    onEditComplete?.();
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
      // GST-slab components — resolvedLine/singleLine belong to the OLD cost-centre cascade and
      // are never populated for a vendor GRN (vendor never sets form.costCentreKey), so this must
      // not be evaluated for isVendor. Imprest: exact existing single-line / split-mode behaviour.
      const rows: AllocationDraft[] = isVendor
        ? []
        : splitMode
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

      const firstLine = isVendor
        ? budgetLines.find((line) => line.id === costCentreSplits[0].budgetLineId)!
        : splitMode
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
            companyCode: form.companyCode || undefined,
            budgetLineId: firstLine.id,
            processId: firstLine.process_id ?? undefined,
            costCentreId: firstLine.cost_centre_id ?? undefined,
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
            financialYear: financialYearFromPeriod(firstLine.period_code),
          }
        );
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
          costCentreSplits: costCentreSplits
            .filter((row) => row.included && (row.budgetLineId || isUnbudgetedExpense)) // Include unbudgeted rows
            .map((row) => ({
              budgetLineId: row.budgetLineId || undefined, // undefined for unbudgeted
              costCentreId: row.costCentreKey, // Always send cost centre for unbudgeted allocation
              percentage: Number(row.percentage),
            })),
          isUnbudgeted: isUnbudgetedExpense || undefined, // Flag for stricter approval workflow
          lateInvoiceReason: form.lateInvoiceReason.trim() || undefined,
          gstEnabled: form.gstEnabled,
          vendorStateCode: form.vendorStateCode || undefined,
          billingStateCode: form.billingStateCode || undefined,
        });
      } else {
        await hrmsApi.put(`/api/finance/grns/${current.id}/allocations`, {
          // Only declared in split mode. In single-line mode the amount drives the
          // quantity, so the server's computed gross IS the invoice total and a
          // declared figure could only ever contradict it.
          declaredInvoiceTotal: splitMode ? Number(form.amount) : undefined,
          recognitionStartPeriod: monthSplit.startPeriod || undefined,
          recognitionEndPeriod: monthSplit.endPeriod || undefined,
          recognitionCustomPercentages:
            monthSplit.customPercentages && Object.keys(monthSplit.customPercentages).length > 0
              ? monthSplit.customPercentages
              : undefined,
          allocations: rows.map((item) => ({
            budgetLineId: item.budgetLineId,
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
      <GrnIconButton
        onClick={resetForm}
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
              <DenseSection title={isVendor ? "Invoice Details" : "Receipt Details"} />

              {/* Row 1: Amount / Branch / Company - always 3 columns */}
              <DenseFieldGroup cols={3}>
                <DenseField label={isVendor ? "Amount (incl. GST)" : "Amount"} required={isVendor} error={isVendor ? err("amount") : undefined}>
                  {isVendor ? (
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
                  ) : (
                    // Imprest's actual editable amount input lives in the Amount card further
                    // down this form (shares id="grn-amount" there). This used to be a static,
                    // unbound "See Amount section below" string — always blank-looking regardless
                    // of what the raiser had entered. Mirror it as a live read-only total instead,
                    // same value/format the sticky footer total strip already shows.
                    <div className="h-8 flex items-center text-[12px] font-semibold tabular-nums text-grn-ink">
                      {form.amount ? money(totals.gross) : <span className="font-normal text-grn-ink-soft">See Amount section below</span>}
                    </div>
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

              {/* Row 2: Date / Invoice # / Due Date - always 3 columns */}
              <DenseFieldGroup cols={3}>
                <DenseField
                  label={isVendor ? "Invoice date" : "Receipt date"}
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
                <DenseField label="Invoice #" required={isVendor} error={isVendor ? err("invoiceNumber") : undefined}>
                  {isVendor ? (
                    <Input
                      id="grn-invoice-no"
                      className={cn(inputClass, "h-8 w-full")}
                      value={form.invoiceNumber}
                      placeholder="As printed"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, invoiceNumber: event.target.value }))
                      }
                    />
                  ) : (
                    <div className="h-8 flex items-center text-[12px] text-grn-ink-soft">N/A for imprest</div>
                  )}
                </DenseField>
                <DenseField
                  label="Due date"
                  error={isVendor ? err("dueDate") : undefined}
                  hint={isVendor && dueDateGap !== null && dueDateGap >= 0 ? `${dueDateGap}d from invoice` : undefined}
                >
                  {isVendor ? (
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
                  ) : (
                    <div className="h-8 flex items-center text-[12px] text-grn-ink-soft">N/A for imprest</div>
                  )}
                </DenseField>
              </DenseFieldGroup>

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

              {/* Accounting period override (Finance Head / Accounts Head only).
                  Was isVendor-only — Imprest raisers/approvers got no period visibility or
                  override at all, so the backend silently derived the period from billDate
                  with nothing shown. period/effectivePeriod/canOverridePeriod are already
                  grnType-agnostic (derived from form.billDate/form.accountingPeriod), so this
                  is a pure gating fix, not new logic. */}
              {canOverridePeriod && period && (
                <DenseFieldGroup cols={2}>
                  <DenseField
                    label="Accounting period"
                    hint={form.accountingPeriod && form.accountingPeriod !== period
                      ? `Booking into ${form.accountingPeriod} (invoice month: ${period})`
                      : "Leave as-is for invoice date month"
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
                </DenseFieldGroup>
              )}

              {/* Period-end cut-off warning */}
              {canOverridePeriod && form.accountingPeriod && form.accountingPeriod !== period && (
                <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <span>Period-end cut-off: booking into <strong>{form.accountingPeriod}</strong> instead of {period}.</span>
                </div>
              )}

              {/* Accounting period read-only for non-elevated roles */}
              {!canOverridePeriod && effectivePeriod && (
                <div className="flex items-center gap-2 text-[12px] text-grn-ink">
                  <span className="text-grn-ink-soft">Period:</span>
                  <span className="font-bold">{effectivePeriod}</span>
                  <span className="text-grn-ink-soft">(FY {financialYearFromPeriod(effectivePeriod)})</span>
                </div>
              )}

              {/* Month split panel */}
              <MonthSplitPanel
                value={monthSplit}
                onChange={setMonthSplit}
                amount={Number(form.amount) || 0}
                accountingPeriod={period}
                disabled={locked}
                // Both mirror assertMayOverrideRecognition / RECOGNITION_OVERRIDE_ROLES, which
                // excludes branch_admin — not the wider period-override list.
                canCustomSplit={isFinanceLead}
                canCrossFy={isFinanceLead}
              />

              {/* Row 3: Vendor, GSTIN, GST toggle (vendor only) */}
              {isVendor && (
                <>
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Vendor" required error={err("vendorId")}>
                      <SearchableSelect
                        id="grn-vendor"
                        aria-label="Vendor"
                        disabled={locked}
                        loading={vendorsLoading}
                        options={vendors.map((vendor) => ({
                          value: vendor.id,
                          label: (vendor.vendor_name ?? vendor.name ?? "").trim(),
                          hint: undefined,
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

                  {/* Row 4: GST states - all fields always enabled */}
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

                  {/* Row 5: Place of supply, Contract ref, Remarks preview */}
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Place of supply">
                      <Input
                        id="grn-place"
                        className={cn(inputClass, "h-8 w-full")}
                        value={form.placeOfSupply}
                        placeholder="State or country"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, placeOfSupply: event.target.value }))
                        }
                      />
                    </DenseField>
                    <DenseField label="Contract reference">
                      <Input
                        id="grn-contract-ref"
                        className={cn(inputClass, "h-8 w-full")}
                        value={form.purchaseReference}
                        placeholder="Contract/agreement ref"
                        onChange={(event) =>
                          setForm((current) => ({ ...current, purchaseReference: event.target.value }))
                        }
                      />
                    </DenseField>
                    <DenseField label="Period">
                      <div className="h-8 flex items-center text-[12px] font-semibold text-grn-ink">
                        {effectivePeriod || "Select date first"}
                      </div>
                    </DenseField>
                  </DenseFieldGroup>

                  {/* IRN fields (Finance only) - 3 columns */}
                  {isFinanceLead && (
                    <DenseFieldGroup cols={3}>
                      <DenseField label="IRN (e-invoice)" hint="From GSTN portal">
                        <Input
                          id="grn-irn"
                          className={cn(inputClass, "h-8 w-full font-mono")}
                          value={form.irn}
                          placeholder="64-char IRN"
                          onChange={(event) =>
                            setForm((current) => ({ ...current, irn: event.target.value.trim() }))
                          }
                        />
                      </DenseField>
                      <DenseField label="IRN Ack. No.">
                        <Input
                          id="grn-irn-ack"
                          className={cn(inputClass, "h-8 w-full font-mono")}
                          value={form.irnAckNo}
                          placeholder="Ack number"
                          onChange={(event) =>
                            setForm((current) => ({ ...current, irnAckNo: event.target.value.trim() }))
                          }
                        />
                      </DenseField>
                      <DenseField label="IRN Date">
                        <div className="h-8 flex items-center text-[12px] text-grn-ink-soft">Auto from portal</div>
                      </DenseField>
                    </DenseFieldGroup>
                  )}
                </>
              )}

              {/* ── Proof section (inline within card) ── */}
              <DenseSection title="Attachments" />
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

              {/* ── Budget Allocation section ── */}
              <DenseSection
                title="Budget Allocation"
                action={
                  <div className="flex items-center gap-1.5">
                    <GrnBudgetImportButton branchId={form.branchId} period={effectivePeriod} disabled={locked} />
                    {!isVendor && (
                      <Button size="sm" onClick={() => setSplitMode((value) => !value)}>
                        <Split className="h-3 w-3" />
                        {splitMode ? "Single line" : "Split"}
                      </Button>
                    )}
                  </div>
                }
              />

              {!form.branchId || !effectivePeriod ? (
                <div className="py-2 text-[11px] text-grn-warn">
                  Select branch and date first to load budgets.
                </div>
              ) : linesLoading ? (
                <div className="flex items-center gap-2 py-3 text-[11px] text-grn-ink-soft">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading budgets…
                </div>
              ) : isVendor ? (
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
              ) : splitMode ? (
                <div className="py-2 text-[11px] text-grn-ink-soft">
                  Budget lines are chosen per row in the split editor below.
                </div>
              ) : (
                <>
                  <DenseFieldGroup cols={3}>
                    <DenseField label="Cost centre" required error={err("costCentreKey")}>
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
                    </DenseField>
                    <DenseField label="Head" required error={err("head")}>
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
                        placeholder={form.costCentreKey ? "Select head" : "Select CC first"}
                        searchPlaceholder="Type a head…"
                      />
                    </DenseField>
                    <DenseField label="Sub-head" required error={err("subHead")}>
                      <SearchableSelect
                        id="grn-subhead"
                        aria-label="Expense sub-head"
                        disabled={!form.head}
                        options={subHeadOptions}
                        value={form.subHead}
                        onChange={(value) =>
                          setForm((current) => ({ ...current, subHead: value, budgetLineId: "" }))
                        }
                        placeholder={form.head ? "Select sub-head" : "Select head first"}
                        searchPlaceholder="Type a sub-head…"
                      />
                    </DenseField>
                  </DenseFieldGroup>

                  {/* Item picker when trio is ambiguous */}
                  {needsItemChoice && (
                    <DenseFieldGroup cols={2}>
                      <DenseField label="Item" required error={err("budgetLineId")} hint={`${matchingLines.length} lines match`}>
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
                          placeholder="Select item"
                          searchPlaceholder="Type item name…"
                        />
                      </DenseField>
                    </DenseFieldGroup>
                  )}

                  {/* Resolved budget line summary - inline */}
                  {resolvedLine && (
                    <div className="flex items-center gap-2 text-[11px] text-grn-ink-soft">
                      <span className="font-mono">{resolvedLine.budget_number}</span>
                      <span>·</span>
                      <span className="font-semibold text-grn-ok">{money(Number(resolvedLine.available_gross_amount))} available</span>
                      <span>·</span>
                      <span>{decimal(Number(resolvedLine.available_quantity))} {resolvedLine.unit} left</span>
                    </div>
                  )}

                  {/* Selected head/sub-head has no matching budget line for this cost centre +
                      period — headOptions/subHeadOptions now include the full expense master, so
                      this combination was selectable but, unlike the vendor cascade, Imprest has
                      no "unbudgeted, link during approval" submission path yet. Surfaced here
                      (same spot as the resolved-line summary above) rather than only in the
                      top error banner, and blocks submit via the matching errors.budgetLineId. */}
                  {form.head && form.subHead && !needsItemChoice && !resolvedLine && (
                    <p className="text-[10px] text-amber-600">
                      No approved budget line for this Head/Sub-head in this cost centre and period —
                      ask Branch/Finance Head to add one, or pick a different combination.
                    </p>
                  )}
                </>
              )}
            </div>
          </GrnCard>

          {/* Vendor GRNs: cost-centre split, then invoice GST components, in that order — the
              unified flow. Each is its own card for the same reason SplitAllocationEditor already
              is: its own toolbar and its own reconciliation footer. */}
          {/* Unbudgeted expense warning */}
          {isVendor && isUnbudgetedExpense && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
              <div className="flex items-start gap-2">
                <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="font-medium">Unbudgeted Expense</p>
                  <p className="text-sm text-amber-700">
                    No budget exists for "{form.head} → {form.subHead}" in this period.
                    This GRN will be flagged as unbudgeted and require Finance Head approval.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isVendor && Boolean(form.branchId) && Boolean(effectivePeriod) && !linesLoading && vendorCostCentreGroups.length > 0 && (
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

          {/* ── Amount (imprest only — vendor's amount lives in Invoice details, its GST
                 breakdown and remarks live at the end of InvoiceComponentsEditor) ── */}
          {!isVendor && (
            <GrnCard>
              <div className="p-4 space-y-2">
                <DenseSection title="Amount" />
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
                      className={cn(inputClass, "h-8 text-right font-semibold tabular-nums")}
                      value={form.amount || ""}
                      placeholder="0.00"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, amount: Number(event.target.value) }))
                      }
                    />
                  </DenseField>
                  <div className="flex items-end gap-3 text-[11px]">
                    <span className="text-grn-ink-soft">Taxable: <b className="text-grn-ink">{money(totals.base)}</b></span>
                    <span className="text-grn-ink-soft">GST: <b className="text-grn-ink">{money(totals.tax)}</b></span>
                    <span className="font-bold text-grn-ink">Total: {money(totals.gross)}</span>
                  </div>
                </DenseFieldGroup>

                <DenseField label="Remark" required error={err("remarks")}>
                  <Textarea
                    id="grn-remarks"
                    className="min-h-16 text-[12px]"
                    value={form.remarks}
                    placeholder="What was bought or paid for, and why."
                    onChange={(event) =>
                      setForm((current) => ({ ...current, remarks: event.target.value }))
                    }
                  />
                </DenseField>
              </div>
            </GrnCard>
          )}

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
              { label: "Branch Head reviews", note: submitted && !liveStatus ? "Awaiting action" : undefined },
              { label: "Finance Head reviews" },
              { label: isVendor ? "Accounts Head → payment" : "Imprest closure" },
            ].map((step, index) => {
              // Map live GRN status to step states so the widget reflects real approval progress.
              const grnDone = liveStatus === "approved" || liveStatus === "paid" || liveStatus === "partially_paid" || liveStatus === "pending_accounts_payment";
              const branchDone = grnDone || liveStatus === "branch_head_approved" || liveStatus === "finance_head_approved";
              const financeDone = grnDone || liveStatus === "finance_head_approved";
              const stepState =
                index === 0 ? (submitted ? "done" : "current") :
                index === 1 ? (branchDone ? "done" : submitted ? "current" : "upcoming") :
                index === 2 ? (financeDone ? "done" : branchDone ? "current" : "upcoming") :
                grnDone ? "done" : financeDone ? "current" : "upcoming";
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
}: {
  groups: Array<{ costCentreKey: string; costCentreName: string; lines: BudgetLine[] }>;
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
                {groups.map((group) => (
                  <option key={group.costCentreKey} value={group.costCentreKey}>
                    {group.costCentreName}
                  </option>
                ))}
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
                    {line && (
                      <GrnCellSub>
                        {money(Number(line.available_gross_amount))} available
                      </GrnCellSub>
                    )}
                  </div>
                </div>
                {line && (
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
              <GrnTh sticky={false} className="w-28">Tax</GrnTh>
              <GrnTh sticky={false} align="right" className="w-28">Split %</GrnTh>
              <GrnTh sticky={false} align="right" className="w-32">Available</GrnTh>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const group = groups.find((item) => item.costCentreKey === row.costCentreKey);
              const line = group?.lines.find((item) => item.id === row.budgetLineId);
              const nonTaxable = line && ["exempt", "non_gst"].includes(line.tax_treatment);
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
                  <GrnTd className="font-semibold">{group?.costCentreName ?? "—"}</GrnTd>
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
                    {line ? money(Number(line.available_gross_amount)) : "—"}
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
              </div>
              <Input
                className="mt-2"
                value={component.remarks}
                placeholder="Optional note for this component"
                onChange={(event) => onUpdate(component.key, { remarks: event.target.value })}
              />
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
              <GrnTh sticky={false} align="right" className="w-32">Incl. GST</GrnTh>
              <GrnTh sticky={false}>Note</GrnTh>
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
                  <GrnTd align="right" className="font-semibold">{money(gross)}</GrnTd>
                  <GrnTd className="min-w-[160px]">
                    <Input
                      value={component.remarks}
                      placeholder="Optional"
                      onChange={(event) => onUpdate(component.key, { remarks: event.target.value })}
                    />
                  </GrnTd>
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

      <div className="px-4 py-3">
        <FieldRow label="Remark" htmlFor="grn-remarks" required error={remarksError}>
          <Textarea
            id="grn-remarks"
            className="min-h-20"
            value={remarks}
            placeholder="What was bought or paid for, and why."
            onChange={(event) => onRemarksChange(event.target.value)}
          />
        </FieldRow>
      </div>
    </GrnCard>
  );
}
