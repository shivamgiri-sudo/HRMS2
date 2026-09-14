/**
 * Payment & Disbursal Center — /payroll/payment-disbursal
 *
 * Merged hub combining Bank Payment Readiness and Disbursal Management into
 * a single URL-param-driven surface.
 * Activate tabs via ?tab=bank (default) or ?tab=disbursal.
 *
 * MASKING IS NOT A UI CHOICE HERE
 *   Nothing on this screen can display a full account number, because the API never sends one.
 *   /exceptions returns account_masked (XXXX + last 4) and there is no unmasked field to reveal.
 *   The only full numbers in the system come from GET /payment-file, which is a CSV download
 *   gated on org-wide payroll scope. So a "show full number" toggle is not something this page
 *   declines to offer — it is something it cannot offer, which is the point.
 *
 * THE BANNER IS LOAD-BEARING
 *   When db_bill is unreachable the API reports verification_source.available = false and
 *   classifies every otherwise-clean record as BLOCKED. Without the banner that reads as "the
 *   whole workforce suddenly became unpayable" rather than "we lost the verification source",
 *   and someone would go looking at bank records instead of at the database link.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Users,
  Landmark,
  CircleDot,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { FilterMultiSelect } from "@/components/finance/pnl/FilterMultiSelect";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

// ── Bank Readiness types ───────────────────────────────────────────────────────

type ReadinessClass =
  | "READY"
  | "MISSING"
  | "INVALID"
  | "CONFLICT"
  | "PENDING_APPROVAL"
  | "BLOCKED";

const CLASSES: ReadinessClass[] = [
  "READY",
  "MISSING",
  "INVALID",
  "CONFLICT",
  "PENDING_APPROVAL",
  "BLOCKED",
];

/** What each class means in one line, shown as the column tooltip and on the summary tile. */
const CLASS_HELP: Record<ReadinessClass, string> = {
  READY: "Account matches the account that received the last confirmed salary credit.",
  MISSING:
    "No bank record in HRMS. Nothing has been inferred — the account is genuinely absent.",
  INVALID:
    "A record exists but cannot be sent to a bank: corrupt account number or malformed IFSC.",
  CONFLICT:
    "Two sources disagree about where this salary should go, or two employees share one account.",
  PENDING_APPROVAL: "A bank change request is in the approval queue.",
  BLOCKED:
    "The record looks fine but nothing independently confirms the account belongs to this employee.",
};

const CLASS_STYLE: Record<ReadinessClass, string> = {
  READY: "bg-emerald-100 text-emerald-800 border-emerald-200",
  MISSING: "bg-amber-100 text-amber-900 border-amber-200",
  INVALID: "bg-rose-100 text-rose-800 border-rose-200",
  CONFLICT: "bg-red-100 text-red-800 border-red-200",
  PENDING_APPROVAL: "bg-sky-100 text-sky-800 border-sky-200",
  BLOCKED: "bg-slate-200 text-slate-800 border-slate-300",
};

const WORKFLOW_STATUSES = [
  "open",
  "in_progress",
  "awaiting_employee",
  "resolved",
  "waived",
];

interface SummaryResponse {
  as_of: string;
  scope: { restricted: boolean; branch_count?: number };
  verification_source: {
    available: boolean;
    month: string | null;
    confirmed_credits: number;
    error: string | null;
  };
  totals: Record<ReadinessClass, number>;
  total_employees: number;
  payable_count: number;
  unresolved_count: number;
  gate_clear: boolean;
  recoverable_from_db_bill: number;
  beneficiary_unconfirmed: number;
  message: string;
}

interface ExceptionRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  status: ReadinessClass;
  reason: string;
  account_masked: string | null;
  ifsc_code: string | null;
  bank_name: string | null;
  beneficiary_name: string | null;
  beneficiary_source: string;
  beneficiary_unconfirmed: boolean;
  recoverable_from_db_bill: boolean;
  contactable: boolean;
  exception_owner: string | null;
  exception_owner_user_id: string | null;
  workflow_status: string;
  notes: string | null;
  last_employee_action: string | null;
  last_employee_action_at: string | null;
  approval_status: string;
}

interface AssignableOwner {
  id: string;
  name: string;
}

interface RemediationRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  reason: string;
  recoverable_from_db_bill: boolean;
  exception_owner: string | null;
  workflow_status: string;
  contacted: boolean;
}

// ── Shared types ───────────────────────────────────────────────────────────────

interface PayrollRun {
  id: string;
  run_month: string;
  status: string;
  run_label?: string;
}

// ── Disbursal types ────────────────────────────────────────────────────────────

interface DisbursalRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  cheque_no: string | null;
  payment_mode: string | null;
  payment_date: string | null;
  bank_ref: string | null;
  notes: string | null;
  uploaded_at: string | null;
}

const PAYMENT_MODES = ["NEFT", "IMPS", "Cheque", "Cash", "UPI", "RTGS"];

// ── Pipeline stage definitions for Disbursal tab ──────────────────────────────

const PIPELINE_STAGES = [
  { key: "file_generated", label: "Payment File Generated" },
  { key: "neft_uploaded", label: "NEFT Uploaded" },
  { key: "bank_processing", label: "Bank Processing" },
  { key: "confirmed", label: "Confirmed" },
] as const;

/** Maps a payroll run status to the highest completed pipeline stage index (0-based, -1 = none). */
function getPipelineIndex(status: string): number {
  const s = status?.toLowerCase() ?? "";
  if (s === "disbursed" || s === "confirmed") return 3;
  if (s === "processing" || s === "neft_uploaded") return 2;
  if (s === "approved" || s === "processed" || s === "finalized") return 1;
  if (s === "calculated" || s === "payment_file_ready") return 0;
  return -1;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

// ── Component ──────────────────────────────────────────────────────────────────

// Roles the disbursal write endpoints (disbursal.routes.ts requireRole) actually accept.
// Kept as one constant so the frontend gate can never silently drift from the backend
// again — the Bank Readiness tab's own roles stay broader, this only narrows the
// Disbursal tab's write controls (Upload, Manual Entry, Mark as Disbursed).
const DISBURSAL_WRITE_ROLES = ["payroll", "super_admin", "finance"];

export default function PaymentDisbursalCenter() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const canManageDisbursal = roleKeys.some((r) => DISBURSAL_WRITE_ROLES.includes(r));

  // URL-based outer tab (bank | disbursal)
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "bank";
  const handleTabChange = (tab: string) => {
    setSearchParams({ tab }, { replace: true });
  };

  // ── Bank Readiness local state ─────────────────────────────────────────────
  const [bankInnerTab, setBankInnerTab] = useState("exceptions");
  const [classFilter, setClassFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [bankRunId, setBankRunId] = useState("");
  const [editing, setEditing] = useState<ExceptionRow | null>(null);
  const [draftStatus, setDraftStatus] = useState("open");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftOwnerId, setDraftOwnerId] = useState<string>("");

  // Selection state for the exceptions grid — code/name/branch identify the row, employee_id is
  // the key. Cleared whenever the filter changes, because "select all matching filter" only ever
  // means the filter that produced the current row list; carrying a selection across a filter
  // change would silently select rows the user never saw.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);
  const [bulkDraftStatus, setBulkDraftStatus] = useState("in_progress");
  const [bulkDraftNotes, setBulkDraftNotes] = useState("");
  const [bulkDraftOwnerId, setBulkDraftOwnerId] = useState<string>("");

  // ── Disbursal local state ──────────────────────────────────────────────────
  const [disbInnerTab, setDisbInnerTab] = useState("status");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [bankExportFormat, setBankExportFormat] = useState<"generic" | "sbi">(
    "generic"
  );
  const [csvText, setCsvText] = useState("");

  // ── Salary Transfer state ──────────────────────────────────────────────────
  const [transferGenerating, setTransferGenerating] = useState(false);
  const [transferReexporting, setTransferReexporting] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [importPreview, setImportPreview] = useState<{
    file_name: string;
    file_sha256: string;
    summary: { total: number; will_confirm: number; unmatched: number; already_confirmed: number; invalid: number };
    data: Array<{ emp_code: string; emp_name: string; ecs_number: string; trf_date: string; outcome: string; detail: string; item_id: string | null }>;
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [manualRow, setManualRow] = useState({
    employee_code: "",
    cheque_no: "",
    payment_mode: "NEFT",
    payment_date: "",
    bank_ref: "",
    notes: "",
  });

  // ── Shared query: payroll runs (single deduped query for both tabs) ─────────
  const runsQ = useQuery<{ data: PayrollRun[] }>({
    queryKey: ["payroll-runs-list"],
    queryFn: () =>
      hrmsApi.get<{ data: PayrollRun[] }>("/api/payroll/runs?limit=50"),
  });
  const runs = runsQ.data?.data ?? [];

  // ── Bank Readiness queries ─────────────────────────────────────────────────
  const summaryQ = useQuery<SummaryResponse>({
    queryKey: ["bank-readiness-summary"],
    queryFn: () =>
      hrmsApi.get<SummaryResponse>("/api/payroll/bank-readiness/summary"),
  });

  const exceptionsQ = useQuery<{
    data: ExceptionRow[];
    as_of: string;
    count: number;
  }>({
    queryKey: ["bank-readiness-exceptions", classFilter, search],
    queryFn: () => {
      const p = new URLSearchParams();
      if (classFilter !== "ALL") p.set("class", classFilter);
      if (search.trim()) p.set("q", search.trim());
      return hrmsApi.get(
        `/api/payroll/bank-readiness/exceptions?${p.toString()}`
      );
    },
  });

  const remediationQ = useQuery<{
    data: RemediationRow[];
    count: number;
    message: string;
  }>({
    queryKey: ["bank-readiness-remediation"],
    queryFn: () =>
      hrmsApi.get("/api/payroll/bank-readiness/remediation-list"),
    enabled: bankInnerTab === "remediation",
  });

  const divergenceQ = useQuery<{ data: Record<string, number | string> }>({
    queryKey: ["bank-readiness-divergence", bankRunId],
    queryFn: () =>
      hrmsApi.get(
        `/api/payroll/bank-readiness/payment-source-divergence?run_id=${bankRunId}`
      ),
    enabled: !!bankRunId && bankInnerTab === "export",
  });

  // Owner picker for the Assign dialog — was accepted by the PATCH endpoint all along,
  // just never sent, so payroll_bank_exception.owner_user_id was 0 rows, always.
  const ownersQ = useQuery<{ data: AssignableOwner[] }>({
    queryKey: ["bank-readiness-assignable-owners"],
    queryFn: () =>
      hrmsApi.get<{ data: AssignableOwner[] }>(
        "/api/payroll/bank-readiness/assignable-owners"
      ),
    enabled: !!editing || bulkEditing,
  });
  const assignableOwners = ownersQ.data?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: (vars: {
      employeeId: string;
      workflow_status: string;
      notes: string;
      owner_user_id: string;
    }) =>
      hrmsApi.patch(
        `/api/payroll/bank-readiness/exceptions/${vars.employeeId}`,
        {
          workflow_status: vars.workflow_status,
          notes: vars.notes || null,
          owner_user_id: vars.owner_user_id || null,
        }
      ),
    onSuccess: () => {
      toast.success("Exception updated");
      void qc.invalidateQueries({ queryKey: ["bank-readiness-exceptions"] });
      void qc.invalidateQueries({ queryKey: ["bank-readiness-remediation"] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  // Clear selection whenever the filter changes — a selection is only ever meant to describe
  // rows the user is currently looking at.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [classFilter, search]);

  /**
   * Bulk assign / annotate. There is no bulk PATCH endpoint on the backend, so this issues one
   * PATCH per selected employee (the same endpoint the single-row Assign dialog already uses)
   * and reports how many succeeded vs failed rather than silently stopping on the first error —
   * a partial failure here must not read as "nothing happened" when most of it did.
   */
  const bulkSaveMutation = useMutation({
    mutationFn: async (vars: {
      employeeIds: string[];
      workflow_status: string;
      notes: string;
      owner_user_id: string;
    }) => {
      const results = await Promise.allSettled(
        vars.employeeIds.map((employeeId) =>
          hrmsApi.patch(`/api/payroll/bank-readiness/exceptions/${employeeId}`, {
            workflow_status: vars.workflow_status,
            notes: vars.notes || null,
            owner_user_id: vars.owner_user_id || null,
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { succeeded: results.length - failed, failed, total: results.length };
    },
    onSuccess: (r) => {
      if (r.failed === 0) {
        toast.success(`Updated ${r.succeeded} employee(s)`);
      } else {
        toast.warning(`Updated ${r.succeeded} of ${r.total} — ${r.failed} failed`);
      }
      void qc.invalidateQueries({ queryKey: ["bank-readiness-exceptions"] });
      void qc.invalidateQueries({ queryKey: ["bank-readiness-remediation"] });
      setBulkEditing(false);
      setSelectedIds(new Set());
    },
    onError: (e: any) => toast.error(e?.message ?? "Bulk update failed"),
  });

  // ── Salary Transfer queries ────────────────────────────────────────────────
  interface TransferItem {
    id: string;
    batch_id: string;
    employee_id: string;
    employee_code: string;
    amount: number;
    pay_mod: string;
    account_masked: string;
    status: "exported" | "rejected" | "corrected_ready" | "confirmed";
    rejection_reason: string | null;
    rejection_reason_label: string | null;
    rejection_note: string | null;
    ecs_number: string | null;
    transfer_date: string | null;
    payslip_unlocked_at: string | null;
    batch_number: string;
    attempt_kind: string;
  }

  const transferItemsQ = useQuery<{
    data: TransferItem[];
    rejection_reasons: Array<{ value: string; label: string }>;
  }>({
    queryKey: ["salary-transfer-items", bankRunId],
    queryFn: () =>
      hrmsApi.get(`/api/payroll/bank-readiness/salary-transfer/items?run_id=${bankRunId}`),
    enabled: !!bankRunId && bankInnerTab === "export",
  });
  const transferItems = transferItemsQ.data?.data ?? [];
  const rejectionReasons = transferItemsQ.data?.rejection_reasons ?? [];
  const correctedReadyItems = transferItems.filter((i) => i.status === "corrected_ready");

  async function downloadSalaryTransferFile(reexport: boolean, employeeIds?: string[]) {
    const setBusy = reexport ? setTransferReexporting : setTransferGenerating;
    setBusy(true);
    try {
      const base = reexport
        ? `/api/payroll/bank-readiness/salary-transfer/reexport?run_id=${bankRunId}`
        : `/api/payroll/bank-readiness/salary-transfer/export?run_id=${bankRunId}`;
      const path = employeeIds?.length ? `${base}&employee_ids=${employeeIds.join(",")}` : base;
      const blob = await hrmsApi.getBlob(path);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Salary_Transfer_${bankRunId}${reexport ? "_REEXPORT" : ""}.xls`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(reexport ? "Re-export file generated" : "Salary transfer file generated");
      setEligibleSelectedIds(new Set());
      void qc.invalidateQueries({ queryKey: ["salary-transfer-items", bankRunId] });
      void qc.invalidateQueries({ queryKey: ["salary-transfer-eligible", bankRunId] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to generate file");
    } finally {
      setBusy(false);
    }
  }

  // ── Salary Transfer: employee selection (Branch/Process/Cost Centre/Status filters) ─────────
  const [eligibleBranchIds, setEligibleBranchIds] = useState<string[]>([]);
  const [eligibleProcessIds, setEligibleProcessIds] = useState<string[]>([]);
  const [eligibleCostCentreIds, setEligibleCostCentreIds] = useState<string[]>([]);
  const [eligibleStatus, setEligibleStatus] = useState<"active" | "inactive" | "both">("active");
  const [eligibleSelectedIds, setEligibleSelectedIds] = useState<Set<string>>(new Set());

  const branchOptionsQ = useQuery<{ data: Array<{ id: string; branch_name: string }> }>({
    queryKey: ["st-branch-options"],
    queryFn: () => hrmsApi.get("/api/access/branches"),
    enabled: bankInnerTab === "export",
  });
  const processOptionsQ = useQuery<{ data: Array<{ id: string; process_name: string }> }>({
    queryKey: ["st-process-options"],
    queryFn: () => hrmsApi.get("/api/access/processes"),
    enabled: bankInnerTab === "export",
  });
  const costCentreOptionsQ = useQuery<{ data: Array<{ id: string; cost_centre_code: string; cost_centre_name?: string }> }>({
    queryKey: ["st-cost-centre-options"],
    queryFn: () => hrmsApi.get("/api/payroll-masters/cost-centres"),
    enabled: bankInnerTab === "export",
  });

  interface EligibleRow {
    employee_id: string;
    employee_code: string;
    employee_name: string;
    amount: number;
    account_masked: string;
    ifsc: string;
    bank_name: string | null;
    branch_id: string | null;
    branch_name: string | null;
    process_id: string | null;
    process_name: string | null;
    cost_centre_id: string | null;
    cost_centre_name: string | null;
    employee_status: "active" | "inactive";
  }

  const eligibleQ = useQuery<{ data: EligibleRow[]; count: number; total_amount: number }>({
    queryKey: ["salary-transfer-eligible", bankRunId, eligibleBranchIds, eligibleProcessIds, eligibleCostCentreIds, eligibleStatus],
    queryFn: () => {
      const p = new URLSearchParams({ run_id: bankRunId, status: eligibleStatus });
      // Single-value filters server-side; a multi-select UI narrows client-side when >1 picked
      // (keeps the server contract simple — one branch/process/cost-centre id per call — while
      // still letting the user tick several and see the union).
      return hrmsApi.get(`/api/payroll/bank-readiness/salary-transfer/eligible?${p.toString()}`);
    },
    enabled: !!bankRunId && bankInnerTab === "export",
  });
  const eligibleAllRows = eligibleQ.data?.data ?? [];
  const eligibleRows = eligibleAllRows.filter((r) => {
    if (eligibleBranchIds.length && !(r.branch_id && eligibleBranchIds.includes(r.branch_id))) return false;
    if (eligibleProcessIds.length && !(r.process_id && eligibleProcessIds.includes(r.process_id))) return false;
    if (eligibleCostCentreIds.length && !(r.cost_centre_id && eligibleCostCentreIds.includes(r.cost_centre_id))) return false;
    return true;
  });
  const eligibleAllOnViewSelected =
    eligibleRows.length > 0 && eligibleRows.every((r) => eligibleSelectedIds.has(r.employee_id));

  function toggleEligibleRow(id: string) {
    setEligibleSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleEligibleSelectAll() {
    setEligibleSelectedIds((prev) => {
      const next = new Set(prev);
      if (eligibleAllOnViewSelected) {
        for (const r of eligibleRows) next.delete(r.employee_id);
      } else {
        for (const r of eligibleRows) next.add(r.employee_id);
      }
      return next;
    });
  }

  // A filter change narrows which rows are on screen — carrying a selection across that change
  // would silently include employees the user can no longer see, same rule as the exceptions grid.
  useEffect(() => {
    setEligibleSelectedIds(new Set());
  }, [bankRunId, eligibleBranchIds, eligibleProcessIds, eligibleCostCentreIds, eligibleStatus]);

  const rejectItemsMutation = useMutation({
    mutationFn: (vars: { item_ids: string[]; reason: string; note: string | null }) =>
      hrmsApi.patch("/api/payroll/bank-readiness/salary-transfer/items/reject", vars),
    onSuccess: () => {
      toast.success("Item(s) marked rejected — correction task created");
      void qc.invalidateQueries({ queryKey: ["salary-transfer-items", bankRunId] });
      setRejectDialogOpen(false);
      setSelectedItemIds(new Set());
      setRejectReason("");
      setRejectNote("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Reject failed"),
  });

  const markCorrectedReadyMutation = useMutation({
    mutationFn: (itemId: string) =>
      hrmsApi.patch(`/api/payroll/bank-readiness/salary-transfer/items/${itemId}/mark-corrected-ready`),
    onSuccess: () => {
      toast.success("Marked ready for re-export");
      void qc.invalidateQueries({ queryKey: ["salary-transfer-items", bankRunId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  async function handleImportFileSelected(file: File) {
    setImporting(true);
    setImportPreview(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await hrmsApi.postForm<{
        success: boolean;
        file_name: string;
        file_sha256: string;
        summary: any;
        data: any[];
      }>("/api/payroll/bank-readiness/salary-transfer/import/preview", fd);
      setImportPreview(res as any);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not read file");
    } finally {
      setImporting(false);
    }
  }

  const commitImportMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post("/api/payroll/bank-readiness/salary-transfer/import/commit", {
        file_name: importPreview?.file_name,
        file_sha256: importPreview?.file_sha256,
        preview: importPreview?.data,
      }),
    onSuccess: (res: any) => {
      toast.success(res?.message ?? "Import committed");
      setImportPreview(null);
      void qc.invalidateQueries({ queryKey: ["salary-transfer-items", bankRunId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Commit failed"),
  });

  // ── Disbursal queries ──────────────────────────────────────────────────────
  const { data: disbData, isLoading: disbLoading } = useQuery<{
    data: DisbursalRow[];
  }>({
    queryKey: ["disbursal", selectedRunId],
    queryFn: () =>
      hrmsApi.get<{ data: DisbursalRow[] }>(
        `/api/payroll/runs/${selectedRunId}/disbursal`
      ),
    enabled: !!selectedRunId,
  });
  const disbRows = disbData?.data ?? [];
  const disbursedCount = disbRows.filter((r) => r.cheque_no).length;

  const uploadMutation = useMutation({
    mutationFn: (rows: object[]) =>
      hrmsApi.post(`/api/payroll/runs/${selectedRunId}/disbursal-upload`, {
        rows,
      }),
    onSuccess: (data: any) => {
      toast.success(data?.message ?? "Upload successful");
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
      setCsvText("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Upload failed"),
  });

  const [showBreakGlass, setShowBreakGlass] = useState(false);
  const [breakGlassReason, setBreakGlassReason] = useState("");

  // Maps the backend's own well-named error codes (payroll.service.ts::updateRunStatus)
  // to real explanations instead of a generic "Failed to mark disbursed" toast, which
  // previously gave no indication the run needed to be locked first, or that finance
  // sign-off / a break-glass reason was the actual missing step.
  const DISBURSE_ERROR_MESSAGES: Record<string, string> = {
    PAYROLL_CLOSE_NOT_AUTHORISED:
      "Disbursing a run is reserved for Finance or Payroll heads.",
    PAYROLL_SELF_APPROVAL:
      "You prepared this run, so it must be approved by someone else first.",
  };

  const markDisbursedMutation = useMutation({
    mutationFn: (vars?: { breakGlassReason?: string }) =>
      hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/status`, {
        status: "disbursed",
        ...(vars?.breakGlassReason
          ? { breakGlassReason: vars.breakGlassReason }
          : {}),
      }),
    onSuccess: () => {
      toast.success("Run marked as disbursed");
      qc.invalidateQueries({ queryKey: ["payroll-runs-list"] });
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
      setShowBreakGlass(false);
      setBreakGlassReason("");
    },
    onError: (e: any) => {
      if (e?.code === "PAYROLL_FINANCE_SIGNOFF_REQUIRED") {
        setShowBreakGlass(true);
        return;
      }
      toast.error(
        DISBURSE_ERROR_MESSAGES[e?.code as string] ??
          e?.message ??
          "Failed to mark disbursed"
      );
    },
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const summary = summaryQ.data;
  const exceptionRows = exceptionsQ.data?.data ?? [];
  const sourceDown = summary && !summary.verification_source.available;
  const asOf = useMemo(() => fmtDateTime(summary?.as_of), [summary?.as_of]);
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // ── Selection handlers ────────────────────────────────────────────────────
  const allVisibleSelected =
    exceptionRows.length > 0 && exceptionRows.every((r) => selectedIds.has(r.employee_id));

  function toggleRow(employeeId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const r of exceptionRows) next.delete(r.employee_id);
        return next;
      }
      const next = new Set(prev);
      for (const r of exceptionRows) next.add(r.employee_id);
      return next;
    });
  }

  function openBulkEditor() {
    setBulkDraftStatus("in_progress");
    setBulkDraftNotes("");
    setBulkDraftOwnerId("");
    setBulkEditing(true);
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  function openEditor(r: ExceptionRow) {
    setEditing(r);
    setDraftStatus(r.workflow_status || "open");
    setDraftNotes(r.notes ?? "");
    setDraftOwnerId(r.exception_owner_user_id ?? "");
  }

  function handleCsvUpload() {
    if (!csvText.trim()) {
      toast.error("Paste CSV content first");
      return;
    }
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      toast.error("CSV must have a header row + at least one data row");
      return;
    }
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (col: string) => headers.indexOf(col);
    if (idx("employee_code") === -1) {
      toast.error("CSV must have an employee_code column");
      return;
    }
    const rows = lines
      .slice(1)
      .map((line) => {
        const cells = line.split(",").map((c) => c.trim());
        return {
          employee_code: cells[idx("employee_code")] ?? "",
          cheque_no: cells[idx("cheque_no")] || undefined,
          payment_mode: cells[idx("payment_mode")] || undefined,
          payment_date: cells[idx("payment_date")] || undefined,
          bank_ref: cells[idx("bank_ref")] || undefined,
          notes: cells[idx("notes")] || undefined,
        };
      })
      .filter((r) => r.employee_code);
    if (!rows.length) {
      toast.error("No valid rows found");
      return;
    }
    uploadMutation.mutate(rows);
  }

  function handleManualUpload() {
    if (!manualRow.employee_code.trim()) {
      toast.error("Employee code required");
      return;
    }
    uploadMutation.mutate([{ ...manualRow }]);
    setManualRow({
      employee_code: "",
      cheque_no: "",
      payment_mode: "NEFT",
      payment_date: "",
      bank_ref: "",
      notes: "",
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* ── Gradient Header ─────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-gradient-to-br from-blue-700 via-sky-600 to-cyan-600 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <Landmark className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Payment &amp; Disbursal Center
                </h1>
                <p className="text-sky-200 text-sm mt-0.5">
                  Bank account readiness, payment file generation and disbursal
                  tracking
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {summary && activeTab === "bank" && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold backdrop-blur-sm ${
                    summary.gate_clear
                      ? "border-emerald-300/50 bg-emerald-500/20 text-emerald-100"
                      : "border-red-300/50 bg-red-500/20 text-red-100"
                  }`}
                >
                  {summary.gate_clear ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Payment Gate
                      Clear
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5" /> Gate Blocked —{" "}
                      {summary.unresolved_count} unresolved
                    </>
                  )}
                </span>
              )}
              {activeTab === "bank" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/30 bg-white/15 text-white hover:bg-white/25"
                  onClick={() => {
                    void qc.invalidateQueries({
                      queryKey: ["bank-readiness-summary"],
                    });
                    void qc.invalidateQueries({
                      queryKey: ["bank-readiness-exceptions"],
                    });
                    void qc.invalidateQueries({
                      queryKey: ["bank-readiness-remediation"],
                    });
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                </Button>
              )}
              {activeTab === "disbursal" && selectedRunId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/30 bg-white/15 text-white hover:bg-white/25 disabled:opacity-50"
                  disabled={
                    markDisbursedMutation.isPending ||
                    !canManageDisbursal ||
                    selectedRun?.status !== "locked"
                  }
                  title={
                    !canManageDisbursal
                      ? "Reserved for Payroll, Finance or Super Admin."
                      : selectedRun?.status !== "locked"
                        ? "This run must be locked first — see the Sign-Off page."
                        : undefined
                  }
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Mark this run as fully disbursed? This cannot be undone."
                      )
                    )
                      return;
                    markDisbursedMutation.mutate(undefined);
                  }}
                >
                  Mark Run as Disbursed
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ── Outer Tabs ──────────────────────────────────────────────────── */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="h-10">
            <TabsTrigger value="bank" className="px-6">
              Bank Readiness
            </TabsTrigger>
            <TabsTrigger value="disbursal" className="px-6">
              Disbursal
            </TabsTrigger>
          </TabsList>

          {/* ════════════════════════════════════════════════════════════════
              TAB 1 — BANK READINESS
              ════════════════════════════════════════════════════════════════ */}
          <TabsContent value="bank" className="space-y-5 mt-4">
            {/* ── Payment Gate Summary strip (NEW) ──────────────────────── */}
            {summary && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="text-2xl font-bold tabular-nums text-slate-800">
                    {summary.total_employees}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                    <Users className="h-3 w-3" /> Total Employees
                  </div>
                </div>
                <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
                  <div className="text-2xl font-bold tabular-nums text-emerald-700">
                    {summary.totals?.READY ?? 0}
                  </div>
                  <div className="text-xs text-emerald-700 mt-0.5">
                    READY (Payable)
                  </div>
                </div>
                <div className="rounded-lg border bg-red-50 border-red-200 p-3">
                  <div className="text-2xl font-bold tabular-nums text-red-700">
                    {summary.unresolved_count}
                  </div>
                  <div className="text-xs text-red-700 mt-0.5">Unresolved</div>
                </div>
                <div className="rounded-lg border p-3 flex items-center gap-2">
                  {summary.gate_clear ? (
                    <Badge className="text-sm bg-emerald-600 px-3 py-1">
                      CLEAR
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="text-sm px-3 py-1">
                      BLOCKED
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Payment Gate
                  </span>
                </div>
              </div>
            )}

            {/* ── Verification-source banner (THE BANNER IS LOAD-BEARING) ─ */}
            {sourceDown && (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-4 flex gap-3">
                <ShieldAlert className="h-5 w-5 text-rose-700 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-rose-900">
                    Payment history unavailable — no account can be verified
                  </p>
                  <p className="text-rose-800 mt-1">
                    db_bill could not be reached, so every otherwise-clean
                    record below is reported BLOCKED rather than READY.{" "}
                    <strong>
                      This is a system fault, not a fault on these employees'
                      records.
                    </strong>{" "}
                    Payment file generation is refused until it returns.
                  </p>
                  {summary?.verification_source.error && (
                    <p className="text-rose-700 mt-1 font-mono text-xs">
                      {summary.verification_source.error}
                    </p>
                  )}
                </div>
              </div>
            )}
            {summary && !sourceDown && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Accounts verified against{" "}
                  <strong>confirmed salary credits</strong> in db_bill for{" "}
                  <strong>{summary.verification_source.month}</strong> (
                  {summary.verification_source.confirmed_credits} confirmed
                  receipts). An account is READY only when the money actually
                  reached it.
                  {summary.scope.restricted && (
                    <>
                      {" "}
                      Showing your {summary.scope.branch_count} assigned
                      branch(es) only.
                    </>
                  )}
                </span>
              </div>
            )}

            {/* ── Class tiles ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {CLASSES.map((c) => (
                <button
                  key={c}
                  title={CLASS_HELP[c]}
                  onClick={() => {
                    setClassFilter(c);
                    setBankInnerTab("exceptions");
                  }}
                  className={`rounded-lg border p-3 text-left transition hover:shadow-sm ${CLASS_STYLE[c]} ${
                    classFilter === c ? "ring-2 ring-offset-1 ring-slate-400" : ""
                  }`}
                >
                  <div className="text-2xl font-bold tabular-nums">
                    {summaryQ.isLoading
                      ? "…"
                      : (summary?.totals?.[c] ?? 0)}
                  </div>
                  <div className="text-xs font-medium mt-0.5">
                    {c.replace("_", " ")}
                  </div>
                </button>
              ))}
            </div>

            {summary && (
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-4 w-4" /> {summary.total_employees}{" "}
                  active payable
                </span>
                <span>
                  Payment gate:{" "}
                  {summary.gate_clear ? (
                    <Badge className="bg-emerald-600">CLEAR</Badge>
                  ) : (
                    <Badge variant="destructive">
                      BLOCKED — {summary.unresolved_count} unresolved
                    </Badge>
                  )}
                </span>
                {summary.recoverable_from_db_bill > 0 && (
                  <span>
                    {summary.recoverable_from_db_bill} recoverable from db_bill
                    payment history
                  </span>
                )}
                {summary.beneficiary_unconfirmed > 0 && (
                  <span title="Beneficiary name falls back to the employee record because the bank record has none. Not blocking.">
                    {summary.beneficiary_unconfirmed} beneficiary names
                    unconfirmed
                  </span>
                )}
              </div>
            )}

            {/* ── Inner tabs for Bank Readiness ────────────────────────────── */}
            <Tabs value={bankInnerTab} onValueChange={setBankInnerTab}>
              <TabsList>
                <TabsTrigger value="exceptions">Exceptions</TabsTrigger>
                <TabsTrigger value="remediation">HR / Manager list</TabsTrigger>
                <TabsTrigger value="export">Payment file</TabsTrigger>
              </TabsList>

              {/* ── Exceptions ────────────────────────────────────────────── */}
              <TabsContent value="exceptions" className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <Select
                    value={classFilter}
                    onValueChange={setClassFilter}
                  >
                    <SelectTrigger className="w-56">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">
                        All exceptions (not READY)
                      </SelectItem>
                      {CLASSES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Search code or name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-64"
                  />
                  <span className="text-sm text-muted-foreground">
                    {exceptionsQ.isLoading
                      ? "loading…"
                      : `${exceptionsQ.data?.count ?? 0} row(s)`}
                  </span>
                </div>

                {/* ── Selection bar ─────────────────────────────────────────── */}
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                    <span className="text-sm font-medium text-sky-900">
                      {selectedIds.size} selected
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          for (const r of exceptionRows) next.add(r.employee_id);
                          return next;
                        })
                      }
                      disabled={allVisibleSelected}
                      title="Select every row currently matching the filter above, not just this page"
                    >
                      Select all {exceptionsQ.data?.count ?? exceptionRows.length} matching filter
                    </Button>
                    <Button size="sm" onClick={openBulkEditor}>
                      Bulk Assign
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                )}

                <div className="rounded-md border overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 w-8">
                          <Checkbox
                            checked={allVisibleSelected}
                            onCheckedChange={toggleSelectAllVisible}
                            aria-label="Select all rows on this view"
                          />
                        </th>
                        {[
                          "Code",
                          "Name",
                          "Branch",
                          "Status",
                          "Reason",
                          "Account",
                          "IFSC",
                          "Beneficiary",
                          "Owner",
                          "Workflow",
                          "Last employee action",
                          "Approval",
                          "",
                        ].map((hd) => (
                          <th
                            key={hd}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap"
                          >
                            {hd}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {exceptionsQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={14}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                            Loading…
                          </td>
                        </tr>
                      ) : exceptionRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={14}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            No exceptions in this view.
                          </td>
                        </tr>
                      ) : (
                        exceptionRows.map((r) => (
                          <tr
                            key={r.employee_id}
                            className={`border-t align-top ${selectedIds.has(r.employee_id) ? "bg-sky-50/60" : ""}`}
                          >
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={selectedIds.has(r.employee_id)}
                                onCheckedChange={() => toggleRow(r.employee_id)}
                                aria-label={`Select ${r.employee_code}`}
                              />
                            </td>
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                              {r.employee_code}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.employee_name}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {r.branch_name ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              <Badge
                                variant="outline"
                                className={CLASS_STYLE[r.status]}
                                title={CLASS_HELP[r.status]}
                              >
                                {r.status.replace("_", " ")}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 max-w-md">
                              {r.reason}
                              {r.recoverable_from_db_bill && (
                                <div className="text-xs text-emerald-700 mt-1">
                                  Account known from a confirmed salary credit —
                                  can be proposed for approval.
                                </div>
                              )}
                            </td>
                            {/* Masked, always. The API sends no other form of this value. */}
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                              {r.account_masked ?? "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                              {r.ifsc_code ?? "—"}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.beneficiary_name ?? "—"}
                              {r.beneficiary_unconfirmed && (
                                <span
                                  className="ml-1 text-amber-600"
                                  title="Taken from the employee record because the bank record has no account holder name. Nobody has confirmed it against what the bank holds."
                                >
                                  <HelpCircle className="h-3 w-3 inline" />
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.exception_owner ?? (
                                <span className="text-muted-foreground">
                                  unassigned
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.workflow_status}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.last_employee_action ? (
                                <>
                                  {r.last_employee_action}
                                  <div className="text-xs text-muted-foreground">
                                    {fmtDateTime(r.last_employee_action_at)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">
                                  none
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {r.approval_status}
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditor(r)}
                              >
                                Assign
                              </Button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* ── HR / manager remediation ───────────────────────────────── */}
              <TabsContent value="remediation" className="space-y-3">
                <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm mt-3">
                  <p className="font-semibold text-amber-900 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> These employees cannot
                    be reached by the system
                  </p>
                  <p className="text-amber-900 mt-1">
                    They have no bank record and no email address of any kind,
                    so the self-service request (employee submits &rarr; payroll
                    approves &rarr; account activated &rarr; readiness refreshes)
                    has nowhere to start. They need an HR or reporting-manager
                    handover in person.{" "}
                    <strong>
                      Nobody on this list has been contacted — this system has
                      no way to contact them.
                    </strong>
                  </p>
                </div>
                <div className="rounded-md border overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {[
                          "Code",
                          "Name",
                          "Branch",
                          "Reason",
                          "Recoverable",
                          "Owner",
                          "Workflow",
                          "Contacted",
                        ].map((hd) => (
                          <th
                            key={hd}
                            className="px-3 py-2 text-left font-medium whitespace-nowrap"
                          >
                            {hd}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {remediationQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : (remediationQ.data?.data ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            Nobody is uncontactable — every employee missing a
                            bank record has an email address.
                          </td>
                        </tr>
                      ) : (
                        (remediationQ.data?.data ?? []).map((r) => (
                          <tr key={r.employee_id} className="border-t">
                            <td className="px-3 py-2 font-mono text-xs">
                              {r.employee_code}
                            </td>
                            <td className="px-3 py-2">{r.employee_name}</td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {r.branch_name ?? "—"}
                            </td>
                            <td className="px-3 py-2 max-w-md">{r.reason}</td>
                            <td className="px-3 py-2">
                              {r.recoverable_from_db_bill ? "yes" : "no"}
                            </td>
                            <td className="px-3 py-2">
                              {r.exception_owner ?? (
                                <span className="text-muted-foreground">
                                  unassigned
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">{r.workflow_status}</td>
                            {/* Hard-coded false: this page never claims an employee was contacted. */}
                            <td className="px-3 py-2 text-muted-foreground">
                              no
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* ── Payment file ───────────────────────────────────────────── */}
              <TabsContent value="export" className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap mt-3">
                  <label className="text-sm font-medium">Payroll run:</label>
                  <Select value={bankRunId} onValueChange={setBankRunId}>
                    <SelectTrigger className="w-80">
                      <SelectValue placeholder="Select a payroll run…" />
                    </SelectTrigger>
                    <SelectContent>
                      {runs.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.run_label ?? r.run_month} — {r.status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    asChild
                    disabled={!bankRunId || !summary?.gate_clear || !!sourceDown}
                    variant={summary?.gate_clear ? "default" : "secondary"}
                  >
                    <a
                      href={`/api/payroll/bank-readiness/payment-file?run_id=${bankRunId}`}
                    >
                      <Download className="h-4 w-4 mr-2" /> Download payment
                      file
                    </a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Debit account, Pay Mod (I for ICICI beneficiaries, N otherwise) and every
                  column are computed server-side from the reference Salary Transfer File format.
                  Only READY employees not already exported for this run are included; a real
                  export batch is recorded so a repeat click never double-pays anyone.
                </p>

                {/* ── Employee selection for Salary Transfer File ────────────── */}
                {bankRunId && (
                  <div className="rounded-md border p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <FilterMultiSelect
                        label="Branch"
                        allLabel="All branches"
                        options={(branchOptionsQ.data?.data ?? []).map((b) => ({ value: b.id, label: b.branch_name }))}
                        selected={eligibleBranchIds}
                        onChange={setEligibleBranchIds}
                      />
                      <FilterMultiSelect
                        label="Process"
                        allLabel="All processes"
                        options={(processOptionsQ.data?.data ?? []).map((p) => ({ value: p.id, label: p.process_name }))}
                        selected={eligibleProcessIds}
                        onChange={setEligibleProcessIds}
                      />
                      <FilterMultiSelect
                        label="Cost Centre"
                        allLabel="All cost centres"
                        options={(costCentreOptionsQ.data?.data ?? []).map((c) => ({
                          value: c.id,
                          label: c.cost_centre_name ? `${c.cost_centre_code} — ${c.cost_centre_name}` : c.cost_centre_code,
                        }))}
                        selected={eligibleCostCentreIds}
                        onChange={setEligibleCostCentreIds}
                      />
                      <div className="flex items-center gap-1.5">
                        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Status
                        </span>
                        <Select value={eligibleStatus} onValueChange={(v) => setEligibleStatus(v as typeof eligibleStatus)}>
                          <SelectTrigger className="w-32 h-8 text-[13px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="both">Both</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <span className="text-sm text-muted-foreground ml-auto">
                        {eligibleQ.isLoading ? "loading…" : `${eligibleRows.length} eligible`}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <Button
                        disabled={eligibleSelectedIds.size === 0 || transferGenerating}
                        onClick={() => downloadSalaryTransferFile(false, [...eligibleSelectedIds])}
                        title="Generates the bank-upload .xls in the exact Salary Transfer File format (21 columns, genuine BIFF8) for the selected employees only"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        {transferGenerating
                          ? "Generating…"
                          : `Generate Salary Transfer File (${eligibleSelectedIds.size} selected)`}
                      </Button>
                      {eligibleSelectedIds.size > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => setEligibleSelectedIds(new Set())}>
                          Clear selection
                        </Button>
                      )}
                    </div>

                    <div className="rounded-md border overflow-auto max-h-96">
                      <table className="w-full text-sm">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="px-2 py-2 w-8">
                              <Checkbox
                                checked={eligibleAllOnViewSelected}
                                onCheckedChange={toggleEligibleSelectAll}
                                aria-label="Select all eligible employees on this view"
                              />
                            </th>
                            {["Code", "Name", "Branch", "Process", "Cost Centre", "Status", "Amount", "Account", "IFSC"].map((h) => (
                              <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {eligibleQ.isLoading ? (
                            <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                          ) : eligibleRows.length === 0 ? (
                            <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No eligible employees for this run/filter combination.</td></tr>
                          ) : (
                            eligibleRows.map((r) => (
                              <tr key={r.employee_id} className={`border-t ${eligibleSelectedIds.has(r.employee_id) ? "bg-sky-50/60" : ""}`}>
                                <td className="px-2 py-2">
                                  <Checkbox
                                    checked={eligibleSelectedIds.has(r.employee_id)}
                                    onCheckedChange={() => toggleEligibleRow(r.employee_id)}
                                    aria-label={`Select ${r.employee_code}`}
                                  />
                                </td>
                                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.employee_code}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{r.employee_name}</td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.branch_name ?? "—"}</td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.process_name ?? "—"}</td>
                                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{r.cost_centre_name ?? "—"}</td>
                                <td className="px-3 py-2">
                                  <Badge variant="outline" className={r.employee_status === "active" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-200 text-slate-800 border-slate-300"}>
                                    {r.employee_status}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 tabular-nums whitespace-nowrap">₹{Number(r.amount).toLocaleString("en-IN")}</td>
                                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.account_masked}</td>
                                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{r.ifsc}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {summary && !summary.gate_clear && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
                    <p className="font-semibold text-amber-900">
                      {summary.unresolved_count} employee(s) are not
                      payment-ready.
                    </p>
                    <p className="text-amber-900 mt-1">
                      The file can still be generated, and it will contain{" "}
                      <strong>only</strong> the {summary.payable_count} READY
                      employees. Every excluded employee is listed by code and
                      reason in a trailing comment block inside the file itself,
                      so a short file always says why it is short.
                    </p>
                  </div>
                )}

                {/* Reported, not fixed — see getPaymentSourceDivergence in the service. */}
                {bankRunId && divergenceQ.data?.data && (
                  <div className="rounded-md border p-4 text-sm space-y-2">
                    <p className="font-semibold">
                      Known issue: the three payment files disagree on the
                      account source
                    </p>
                    <p className="text-muted-foreground">
                      {String(divergenceQ.data.data.note ?? "")}
                    </p>
                    <div className="flex flex-wrap gap-4 mt-2">
                      <span>
                        <strong>
                          {String(divergenceQ.data.data.both_and_differ)}
                        </strong>{" "}
                        hold different accounts in the two sources
                      </span>
                      <span>
                        <strong>
                          {String(divergenceQ.data.data.employees_column_only)}
                        </strong>{" "}
                        only in the legacy employees column
                      </span>
                      <span>
                        <strong>
                          {String(divergenceQ.data.data.bank_detail_only)}
                        </strong>{" "}
                        only in the bank record
                      </span>
                      <span>
                        <strong>
                          {String(divergenceQ.data.data.neither)}
                        </strong>{" "}
                        in neither
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This page's file uses the bank record only. It does not
                      change what any existing export does — reported for a
                      decision, not silently altered.
                    </p>
                  </div>
                )}

                {/* ── Salary Transfer items queue ────────────────────────── */}
                {bankRunId && (
                  <div className="rounded-md border p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h3 className="text-sm font-semibold">
                        Salary Transfer items ({transferItemsQ.isLoading ? "…" : transferItems.length})
                      </h3>
                      <div className="flex items-center gap-2">
                        {selectedItemIds.size > 0 && (
                          <Button size="sm" variant="destructive" onClick={() => setRejectDialogOpen(true)}>
                            Mark {selectedItemIds.size} rejected
                          </Button>
                        )}
                        {correctedReadyItems.length > 0 && (
                          <Button
                            size="sm"
                            disabled={transferReexporting}
                            onClick={() => downloadSalaryTransferFile(true)}
                            title="Generates a new file containing only corrected, re-verified employees"
                          >
                            {transferReexporting ? "Generating…" : `Re-export ${correctedReadyItems.length} corrected`}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border overflow-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-2 py-2 w-8"></th>
                            {["Code", "Amount", "Pay Mod", "Account", "Batch", "Status", "Rejection reason", "ECS / TRF date"].map((h) => (
                              <th key={h} className="px-3 py-2 text-left font-medium whitespace-nowrap">{h}</th>
                            ))}
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {transferItemsQ.isLoading ? (
                            <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Loading…</td></tr>
                          ) : transferItems.length === 0 ? (
                            <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No transfer batches generated for this run yet.</td></tr>
                          ) : (
                            transferItems.map((it) => (
                              <tr key={it.id} className="border-t">
                                <td className="px-2 py-2">
                                  {it.status === "exported" && (
                                    <Checkbox
                                      checked={selectedItemIds.has(it.id)}
                                      onCheckedChange={() =>
                                        setSelectedItemIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                                          return next;
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-2 font-mono text-xs">{it.employee_code}</td>
                                <td className="px-3 py-2 tabular-nums">₹{Number(it.amount).toLocaleString("en-IN")}</td>
                                <td className="px-3 py-2">{it.pay_mod}</td>
                                <td className="px-3 py-2 font-mono text-xs">{it.account_masked}</td>
                                <td className="px-3 py-2 text-xs">{it.batch_number}{it.attempt_kind === "reexport" ? " (re-export)" : ""}</td>
                                <td className="px-3 py-2">
                                  <Badge variant="outline" className={
                                    it.status === "confirmed" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                    : it.status === "rejected" ? "bg-rose-100 text-rose-800 border-rose-200"
                                    : it.status === "corrected_ready" ? "bg-sky-100 text-sky-800 border-sky-200"
                                    : "bg-amber-100 text-amber-900 border-amber-200"
                                  }>
                                    {it.status.replace("_", " ")}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 text-xs max-w-xs">
                                  {it.rejection_reason_label ?? "—"}
                                  {it.rejection_note && <div className="text-muted-foreground">{it.rejection_note}</div>}
                                </td>
                                <td className="px-3 py-2 text-xs">
                                  {it.ecs_number ? `${it.ecs_number} / ${it.transfer_date ?? "—"}` : "—"}
                                  {it.payslip_unlocked_at && (
                                    <div className="text-emerald-700">payslip unlocked</div>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {it.status === "rejected" && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      disabled={markCorrectedReadyMutation.isPending}
                                      onClick={() => markCorrectedReadyMutation.mutate(it.id)}
                                      title="Only after the bank-change request has been approved and penny-drop verified"
                                    >
                                      Mark corrected
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Transfer Number Update File import ─────────────────── */}
                {bankRunId && (
                  <div className="rounded-md border p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold">Import Transfer Number Update File</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        CSV columns: EmpCode, EmpName, ECSNumber, TRF Date, Branch. Recording a
                        transfer number here confirms the transfer and unlocks that employee's
                        payslip for this month — nothing else does.
                      </p>
                    </div>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={importing}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleImportFileSelected(f);
                        e.target.value = "";
                      }}
                      className="text-sm"
                    />
                    {importing && <p className="text-sm text-muted-foreground">Reading file…</p>}
                    {importPreview && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3 text-sm">
                          <Badge variant="outline">{importPreview.summary.total} rows</Badge>
                          <Badge className="bg-emerald-600">{importPreview.summary.will_confirm} will confirm</Badge>
                          {importPreview.summary.unmatched > 0 && <Badge variant="destructive">{importPreview.summary.unmatched} unmatched</Badge>}
                          {importPreview.summary.already_confirmed > 0 && <Badge variant="secondary">{importPreview.summary.already_confirmed} already confirmed</Badge>}
                          {importPreview.summary.invalid > 0 && <Badge variant="destructive">{importPreview.summary.invalid} invalid</Badge>}
                        </div>
                        <div className="rounded-md border overflow-auto max-h-64">
                          <table className="w-full text-xs">
                            <thead className="bg-muted sticky top-0">
                              <tr>
                                {["Code", "Name", "ECS", "Date", "Outcome", "Detail"].map((h) => (
                                  <th key={h} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {importPreview.data.map((r, i) => (
                                <tr key={i} className="border-t">
                                  <td className="px-2 py-1 font-mono">{r.emp_code}</td>
                                  <td className="px-2 py-1">{r.emp_name}</td>
                                  <td className="px-2 py-1">{r.ecs_number}</td>
                                  <td className="px-2 py-1">{r.trf_date}</td>
                                  <td className={`px-2 py-1 font-medium ${r.outcome === "will_confirm" ? "text-emerald-700" : "text-amber-700"}`}>
                                    {r.outcome.replace("_", " ")}
                                  </td>
                                  <td className="px-2 py-1 text-muted-foreground">{r.detail}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" onClick={() => setImportPreview(null)}>Cancel</Button>
                          <Button
                            disabled={commitImportMutation.isPending || importPreview.summary.will_confirm === 0}
                            onClick={() => commitImportMutation.mutate()}
                          >
                            {commitImportMutation.isPending ? "Committing…" : `Confirm ${importPreview.summary.will_confirm} transfer(s)`}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          {/* ════════════════════════════════════════════════════════════════
              TAB 2 — DISBURSAL
              ════════════════════════════════════════════════════════════════ */}
          <TabsContent value="disbursal" className="space-y-5 mt-4">
            {/* ── Disbursal Pipeline status row (NEW) ─────────────────────── */}
            {selectedRun && (
              <div className="rounded-xl border bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-500 mb-2">
                  Disbursal Pipeline
                </p>
                <div className="flex items-center gap-0 flex-wrap">
                  {PIPELINE_STAGES.map((stage, i) => {
                    const activeIndex = getPipelineIndex(selectedRun.status);
                    const isComplete = i <= activeIndex;
                    const isCurrent = i === activeIndex;
                    return (
                      <div key={stage.key} className="flex items-center">
                        <div
                          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                            isComplete
                              ? isCurrent
                                ? "bg-sky-600 text-white border-sky-600"
                                : "bg-emerald-100 text-emerald-800 border-emerald-300"
                              : "bg-white text-slate-400 border-slate-200"
                          }`}
                        >
                          <CircleDot
                            className={`h-3 w-3 ${
                              isComplete ? "opacity-100" : "opacity-40"
                            }`}
                          />
                          {stage.label}
                        </div>
                        {i < PIPELINE_STAGES.length - 1 && (
                          <div
                            className={`w-6 h-px mx-1 ${
                              i < activeIndex
                                ? "bg-emerald-400"
                                : "bg-slate-200"
                            }`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Run Selector ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium">Payroll Run:</label>
              <Select
                value={selectedRunId}
                onValueChange={setSelectedRunId}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select a payroll run…" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.run_label ?? r.run_month} — {r.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRun && (
                <Badge
                  variant={
                    selectedRun.status === "disbursed" ? "default" : "secondary"
                  }
                >
                  {selectedRun.status}
                </Badge>
              )}
            </div>
            {selectedRun &&
              canManageDisbursal &&
              selectedRun.status !== "locked" &&
              selectedRun.status !== "disbursed" && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  This run is <strong>{selectedRun.status}</strong>, not locked
                  — "Mark Run as Disbursed" stays disabled until it's locked.
                  Lock it from the Sign-Off page first.
                </p>
              )}

            {selectedRunId ? (
              <Tabs value={disbInnerTab} onValueChange={setDisbInnerTab}>
                <TabsList>
                  <TabsTrigger value="status">
                    Status (
                    {disbLoading
                      ? "…"
                      : `${disbursedCount}/${disbRows.length}`}
                    )
                  </TabsTrigger>
                  <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                </TabsList>

                {/* Status Tab */}
                <TabsContent value="status">
                  <div className="rounded-md border overflow-auto mt-3">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          {[
                            "Code",
                            "Name",
                            "Cheque No",
                            "Mode",
                            "Date",
                            "Bank Ref",
                            "Notes",
                            "Uploaded",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left font-medium whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {disbLoading ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-3 py-8 text-center text-muted-foreground"
                            >
                              Loading…
                            </td>
                          </tr>
                        ) : disbRows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={8}
                              className="px-3 py-8 text-center text-muted-foreground"
                            >
                              No disbursal records yet for this run
                            </td>
                          </tr>
                        ) : (
                          disbRows.map((row) => (
                            <tr key={row.employee_code} className="border-t">
                              <td className="px-3 py-2 font-mono text-xs">
                                {row.employee_code}
                              </td>
                              <td className="px-3 py-2">
                                {row.first_name} {row.last_name}
                              </td>
                              <td className="px-3 py-2">
                                {row.cheque_no ?? (
                                  <span className="text-muted-foreground">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2">
                                {row.payment_mode ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {row.payment_date ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {row.bank_ref ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {row.notes ?? "—"}
                              </td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {row.uploaded_at
                                  ? new Date(
                                      row.uploaded_at
                                    ).toLocaleString()
                                  : "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {/* Bank batch file export */}
                  {selectedRunId && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-800">
                            Export Bank Batch File
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Downloads NEFT/IMPS/RTGS employees only. Cash and
                            Cheque are excluded.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex rounded-md border overflow-hidden text-xs">
                            <button
                              onClick={() => setBankExportFormat("generic")}
                              className={`px-3 py-1.5 transition-colors ${
                                bankExportFormat === "generic"
                                  ? "bg-indigo-600 text-white"
                                  : "bg-white text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              Generic CSV
                            </button>
                            <button
                              onClick={() => setBankExportFormat("sbi")}
                              className={`px-3 py-1.5 transition-colors ${
                                bankExportFormat === "sbi"
                                  ? "bg-indigo-600 text-white"
                                  : "bg-white text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              SBI NEFT
                            </button>
                          </div>
                          {/*
                            The bank file is generated by the canonical exporter, which is the only
                            path that enforces Finance sign-off, reconciles the payment population
                            against bank readiness, and records a content hash for the file actually
                            handed over. The download that used to sit here called a second exporter
                            that enforced none of those, so it is withdrawn rather than left offering
                            a money file through the weaker path.
                          */}
                          <span className="text-[11px] text-slate-500">
                            Bank file is generated from Bank Readiness tab,
                            where Finance sign-off and payment reconciliation
                            are enforced.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* CSV Upload Tab */}
                <TabsContent value="csv-upload" className="space-y-4 mt-3">
                  {!canManageDisbursal && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      Uploading disbursal records is reserved for Payroll,
                      Finance or Super Admin.
                    </p>
                  )}
                  <div className="rounded-md border p-4 bg-muted/30 text-sm space-y-1">
                    <p className="font-medium">
                      Expected CSV columns (first row = header):
                    </p>
                    <p className="font-mono text-xs">
                      employee_code, cheque_no, payment_mode, payment_date,
                      bank_ref, notes
                    </p>
                    <p className="text-muted-foreground text-xs">
                      payment_date format: YYYY-MM-DD. payment_mode: NEFT /
                      IMPS / Cheque / Cash / UPI / RTGS
                    </p>
                  </div>
                  <textarea
                    className="w-full h-40 rounded-md border p-3 text-xs font-mono bg-background resize-y"
                    placeholder={
                      "employee_code,cheque_no,payment_mode,payment_date,bank_ref,notes\nMAS001,CHQ12345,NEFT,2026-07-13,,\nMAS002,,Cash,2026-07-13,,"
                    }
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                  />
                  <Button
                    onClick={handleCsvUpload}
                    disabled={uploadMutation.isPending || !canManageDisbursal}
                  >
                    {uploadMutation.isPending ? "Uploading…" : "Upload CSV"}
                  </Button>
                  {(uploadMutation.data as any)?.unmatched?.length > 0 && (
                    <p className="text-sm text-destructive">
                      Unmatched codes:{" "}
                      {(uploadMutation.data as any).unmatched.join(", ")}
                    </p>
                  )}
                </TabsContent>

                {/* Manual Entry Tab */}
                <TabsContent value="manual" className="space-y-4 mt-3">
                  {!canManageDisbursal && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                      Recording disbursal entries is reserved for Payroll,
                      Finance or Super Admin.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4 max-w-xl">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Employee Code *
                      </label>
                      <Input
                        value={manualRow.employee_code}
                        onChange={(e) =>
                          setManualRow((p) => ({
                            ...p,
                            employee_code: e.target.value,
                          }))
                        }
                        placeholder="MAS001"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Cheque / Reference No
                      </label>
                      <Input
                        value={manualRow.cheque_no}
                        onChange={(e) =>
                          setManualRow((p) => ({
                            ...p,
                            cheque_no: e.target.value,
                          }))
                        }
                        placeholder="CHQ12345"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Payment Mode
                      </label>
                      <Select
                        value={manualRow.payment_mode}
                        onValueChange={(v) =>
                          setManualRow((p) => ({ ...p, payment_mode: v }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">
                        Payment Date
                      </label>
                      <Input
                        type="date"
                        value={manualRow.payment_date}
                        onChange={(e) =>
                          setManualRow((p) => ({
                            ...p,
                            payment_date: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Bank Ref</label>
                      <Input
                        value={manualRow.bank_ref}
                        onChange={(e) =>
                          setManualRow((p) => ({
                            ...p,
                            bank_ref: e.target.value,
                          }))
                        }
                        placeholder="UTR / transaction ID"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">Notes</label>
                      <Input
                        value={manualRow.notes}
                        onChange={(e) =>
                          setManualRow((p) => ({
                            ...p,
                            notes: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleManualUpload}
                    disabled={uploadMutation.isPending || !canManageDisbursal}
                  >
                    {uploadMutation.isPending ? "Saving…" : "Save Entry"}
                  </Button>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center text-muted-foreground py-16">
                Select a payroll run above to manage disbursal records
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Assign / annotate dialog ─────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.employee_code} — {editing?.employee_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{editing?.reason}</p>
            <div>
              <label className="text-sm font-medium">Owner</label>
              <Select value={draftOwnerId} onValueChange={setDraftOwnerId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {ownersQ.isLoading && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Loading…
                    </div>
                  )}
                  {assignableOwners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Workflow status</label>
              <Select value={draftStatus} onValueChange={setDraftStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Note</label>
              <Textarea
                className="mt-1"
                rows={4}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="What is being done about this, and by whom."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() =>
                editing &&
                saveMutation.mutate({
                  employeeId: editing.employee_id,
                  workflow_status: draftStatus,
                  notes: draftNotes,
                  owner_user_id: draftOwnerId,
                })
              }
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Salary Transfer rejection dialog ─────────────────────────────────── */}
      <Dialog open={rejectDialogOpen} onOpenChange={(o) => !o && setRejectDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedItemIds.size} item(s) rejected</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Creates a correction task and notifies the mapped Branch Payroll HR and the
              employee. The employee's existing secure bank-update and penny-drop flow is used —
              nothing here edits an account directly.
            </p>
            <div>
              <label className="text-sm font-medium">Rejection reason</label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  {rejectionReasons.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">
                Note {rejectReason === "other" && <span className="text-destructive">*</span>}
              </label>
              <Textarea
                className="mt-1"
                rows={3}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Bank reference/reason detail. Never paste a full account number here."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialogOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={
                rejectItemsMutation.isPending ||
                !rejectReason ||
                (rejectReason === "other" && !rejectNote.trim())
              }
              onClick={() =>
                rejectItemsMutation.mutate({
                  item_ids: [...selectedItemIds],
                  reason: rejectReason,
                  note: rejectNote || null,
                })
              }
            >
              {rejectItemsMutation.isPending ? "Saving…" : "Mark rejected"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk assign / annotate dialog ────────────────────────────────────── */}
      <Dialog open={bulkEditing} onOpenChange={(o) => !o && setBulkEditing(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk assign — {selectedIds.size} employee(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sets the same owner, workflow status and note on every selected exception. A note
              left blank here does not clear an existing note.
            </p>
            <div>
              <label className="text-sm font-medium">Owner</label>
              <Select value={bulkDraftOwnerId} onValueChange={setBulkDraftOwnerId}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  {ownersQ.isLoading && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      Loading…
                    </div>
                  )}
                  {assignableOwners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Workflow status</label>
              <Select value={bulkDraftStatus} onValueChange={setBulkDraftStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Note</label>
              <Textarea
                className="mt-1"
                rows={4}
                value={bulkDraftNotes}
                onChange={(e) => setBulkDraftNotes(e.target.value)}
                placeholder="What is being done about these, and by whom."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkEditing(false)}>
              Cancel
            </Button>
            <Button
              disabled={bulkSaveMutation.isPending || selectedIds.size === 0}
              onClick={() =>
                bulkSaveMutation.mutate({
                  employeeIds: [...selectedIds],
                  workflow_status: bulkDraftStatus,
                  notes: bulkDraftNotes,
                  owner_user_id: bulkDraftOwnerId,
                })
              }
            >
              {bulkSaveMutation.isPending
                ? "Saving…"
                : `Apply to ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Finance sign-off / break-glass dialog ────────────────────────────── */}
      <Dialog
        open={showBreakGlass}
        onOpenChange={(o) => {
          if (!o) {
            setShowBreakGlass(false);
            setBreakGlassReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finance sign-off required</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This run has not been finance-approved yet. You can obtain
              sign-off on the Sign-Off page, or — for a genuine emergency
              only — supply a break-glass reason below. Break-glass must be
              invoked by someone who neither prepared nor approved this run.
            </p>
            <a
              href="/payroll/sign-off"
              className="text-sm font-medium text-sky-700 underline underline-offset-2"
            >
              Go to Sign-Off →
            </a>
            <div>
              <label className="text-sm font-medium">
                Break-glass reason
              </label>
              <Textarea
                className="mt-1"
                rows={3}
                value={breakGlassReason}
                onChange={(e) => setBreakGlassReason(e.target.value)}
                placeholder="Why this run must be disbursed without sign-off, right now."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setShowBreakGlass(false);
                setBreakGlassReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                !breakGlassReason.trim() || markDisbursedMutation.isPending
              }
              onClick={() =>
                markDisbursedMutation.mutate({ breakGlassReason })
              }
            >
              {markDisbursedMutation.isPending
                ? "Disbursing…"
                : "Disburse with break-glass"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
