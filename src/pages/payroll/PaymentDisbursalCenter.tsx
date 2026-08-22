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
import { useMemo, useState } from "react";
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
import { hrmsApi } from "@/lib/hrmsApi";

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
  workflow_status: string;
  notes: string | null;
  last_employee_action: string | null;
  last_employee_action_at: string | null;
  approval_status: string;
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

export default function PaymentDisbursalCenter() {
  const qc = useQueryClient();

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

  // ── Disbursal local state ──────────────────────────────────────────────────
  const [disbInnerTab, setDisbInnerTab] = useState("status");
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [bankExportFormat, setBankExportFormat] = useState<"generic" | "sbi">(
    "generic"
  );
  const [csvText, setCsvText] = useState("");
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

  const saveMutation = useMutation({
    mutationFn: (vars: {
      employeeId: string;
      workflow_status: string;
      notes: string;
    }) =>
      hrmsApi.patch(
        `/api/payroll/bank-readiness/exceptions/${vars.employeeId}`,
        {
          workflow_status: vars.workflow_status,
          notes: vars.notes || null,
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

  const markDisbursedMutation = useMutation({
    mutationFn: () =>
      hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/status`, {
        status: "disbursed",
      }),
    onSuccess: () => {
      toast.success("Run marked as disbursed");
      qc.invalidateQueries({ queryKey: ["payroll-runs-list"] });
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Failed to mark disbursed"),
  });

  // ── Derived values ─────────────────────────────────────────────────────────
  const summary = summaryQ.data;
  const exceptionRows = exceptionsQ.data?.data ?? [];
  const sourceDown = summary && !summary.verification_source.available;
  const asOf = useMemo(() => fmtDateTime(summary?.as_of), [summary?.as_of]);
  const selectedRun = runs.find((r) => r.id === selectedRunId);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function openEditor(r: ExceptionRow) {
    setEditing(r);
    setDraftStatus(r.workflow_status || "open");
    setDraftNotes(r.notes ?? "");
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
                  className="border-white/30 bg-white/15 text-white hover:bg-white/25"
                  disabled={markDisbursedMutation.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Mark this run as fully disbursed? This cannot be undone."
                      )
                    )
                      return;
                    markDisbursedMutation.mutate();
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

                <div className="rounded-md border overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
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
                            colSpan={13}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                            Loading…
                          </td>
                        </tr>
                      ) : exceptionRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={13}
                            className="px-3 py-10 text-center text-muted-foreground"
                          >
                            No exceptions in this view.
                          </td>
                        </tr>
                      ) : (
                        exceptionRows.map((r) => (
                          <tr
                            key={r.employee_id}
                            className="border-t align-top"
                          >
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
                    disabled={uploadMutation.isPending}
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
                    disabled={uploadMutation.isPending}
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
                })
              }
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
