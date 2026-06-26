/**
 * Payroll HO Queues — 6-tab page for Payroll Head Office operations:
 * 1. PF/ESI Opt-Out approvals
 * 2. Manual TDS upload per payroll run
 * 3. Cheque name mismatch review
 * 4. Bank change request approvals
 * 5. Employee salary history
 * 6. Payroll run window status & closure
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingUp,
  Upload,
  Eye,
  XCircle,
  Building2,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  revoked: "bg-slate-100 text-slate-500 border-slate-200",
  matched: "bg-emerald-50 text-emerald-700 border-emerald-200",
  mismatch: "bg-amber-50 text-amber-700 border-amber-200",
  manual_validated: "bg-blue-50 text-blue-700 border-blue-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
        STATUS_CHIP[status] ?? "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {status?.replace(/_/g, " ")}
    </Badge>
  );
}

// ── Table primitives ──────────────────────────────────────────────────────────

function TH({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-white whitespace-nowrap first:rounded-tl-lg last:rounded-tr-lg">
      {children}
    </th>
  );
}

function TD({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-3 text-xs text-slate-700 border-b border-slate-100 ${
        className ?? ""
      }`}
    >
      {children}
    </td>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
      <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-slate-100">
        <Icon className="size-7 text-slate-300" />
      </div>
      <p className="text-sm font-medium text-slate-500">{message}</p>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ?? "text-slate-900"}`}>
        {value}
      </p>
    </div>
  );
}

// ── Approval Dialog ───────────────────────────────────────────────────────────

interface ApprovalDialogProps {
  title: string;
  open: boolean;
  onClose: () => void;
  onSubmit: (decision: "approved" | "rejected", note: string) => void;
  loading?: boolean;
  extraFields?: React.ReactNode;
}

function ApprovalDialog({
  title,
  open,
  onClose,
  onSubmit,
  loading,
  extraFields,
}: ApprovalDialogProps) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-slate-900">
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {extraFields}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Decision
            </Label>
            <Select
              value={decision}
              onValueChange={(v: "approved" | "rejected") => setDecision(v)}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    Approve
                  </span>
                </SelectItem>
                <SelectItem value="rejected">
                  <span className="flex items-center gap-2">
                    <XCircle className="size-3.5 text-rose-600" />
                    Reject
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Note{" "}
              <span className="font-normal text-slate-400">(optional)</span>
            </Label>
            <Textarea
              className="min-h-[70px] resize-none text-xs"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a reason or remark…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className={
              decision === "approved"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-rose-600 hover:bg-rose-700 text-white"
            }
            onClick={() => {
              onSubmit(decision, note);
              setNote("");
            }}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            {decision === "approved" ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1: PF / ESI Opt-Out Queue
// ─────────────────────────────────────────────────────────────────────────────

const OPT_OUT_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;

function OptOutQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [effectiveMonth, setEffectiveMonth] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["statutory-overrides", statusFilter],
    queryFn: () =>
      hrmsApi.get<any>(
        `/api/payroll/statutory-overrides/all?status=${statusFilter}`
      ),
  });
  const rows: any[] = data?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ id, decision, note, effectiveMonth: em }: any) =>
      hrmsApi.patch(`/api/payroll/statutory-overrides/${id}/approve`, {
        decision,
        note,
        effective_from_month: em,
      }),
    onSuccess: () => {
      toast({ title: "Decision saved" });
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["statutory-overrides"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ShieldAlert className="size-4 text-amber-500" />
            PF / ESI Opt-Out Requests
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Review and action employee statutory exemption requests
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ["statutory-overrides"] })
          }
        >
          <RefreshCw
            className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Pill filter bar */}
      <div className="flex flex-wrap gap-2">
        {OPT_OUT_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold capitalize transition-colors ${
              statusFilter === s
                ? "border-[#073f78] bg-[#073f78] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          message={`No ${statusFilter} opt-out requests`}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead className="bg-[#073f78]">
              <tr>
                {[
                  "Employee",
                  "Override Type",
                  "Status",
                  "Requested",
                  "Declaration",
                  "Action",
                ].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => (
                <tr
                  key={r.id}
                  className={idx % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100"}
                >
                  <TD className="font-medium text-slate-900">
                    {r.employee_name ?? r.employee_id}
                  </TD>
                  <TD>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] font-medium"
                    >
                      {r.override_type?.replace(/_/g, " ")}
                    </Badge>
                  </TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD>{fmtDate(r.requested_at)}</TD>
                  <TD className="max-w-[220px] truncate text-slate-500">
                    {r.declaration_text ?? "—"}
                  </TD>
                  <TD>
                    {r.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-lg px-3 text-[11px] font-medium"
                        onClick={() => {
                          setSelected(r);
                          setEffectiveMonth("");
                        }}
                      >
                        Review
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ApprovalDialog
          title={`${selected.override_type?.replace(/_/g, " ")} — ${
            selected.employee_name ?? selected.employee_id
          }`}
          open
          onClose={() => setSelected(null)}
          loading={approveMutation.isPending}
          onSubmit={(decision, note) =>
            approveMutation.mutate({
              id: selected.id,
              decision,
              note,
              effectiveMonth,
            })
          }
          extraFields={
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-slate-700">
                Effective From Month
              </Label>
              <Input
                className="h-9 text-xs"
                type="month"
                value={effectiveMonth}
                onChange={(e) => setEffectiveMonth(e.target.value)}
              />
            </div>
          }
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2: Manual TDS Upload
// ─────────────────────────────────────────────────────────────────────────────

function ManualTDSTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState("");
  const [editRows, setEditRows] = useState<Record<string, string>>({});

  const { data: runsData } = useQuery({
    queryKey: ["payroll-runs-list"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/runs?limit=24"),
  });
  const runs: any[] = runsData?.data ?? [];

  const { data: tdsData, isFetching } = useQuery({
    queryKey: ["manual-tds", selectedRunId],
    queryFn: () =>
      hrmsApi.get<any>(`/api/payroll/runs/${selectedRunId}/manual-tds`),
    enabled: !!selectedRunId,
  });
  const tdsRows: any[] = tdsData?.data ?? [];

  const { data: windowData } = useQuery({
    queryKey: ["window-status", selectedRunId],
    queryFn: () =>
      hrmsApi.get<any>(`/api/payroll/runs/${selectedRunId}/window-status`),
    enabled: !!selectedRunId,
  });
  // FIX: renamed from `window` (which shadows globalThis.window) to `runWindow`
  const runWindow = windowData?.data;

  const modeMutation = useMutation({
    mutationFn: (mode: string) =>
      hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/tds-mode`, {
        tds_mode: mode,
      }),
    onSuccess: () => {
      toast({ title: "TDS mode updated" });
      void qc.invalidateQueries({ queryKey: ["manual-tds"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (entries: any[]) =>
      hrmsApi.post(`/api/payroll/runs/${selectedRunId}/manual-tds`, {
        entries,
      }),
    onSuccess: () => {
      toast({ title: "TDS saved" });
      void qc.invalidateQueries({ queryKey: ["manual-tds"] });
      setEditRows({});
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function handleSaveAll() {
    const entries = Object.entries(editRows)
      .filter(([, v]) => v !== "")
      .map(([employee_id, tds_amount]) => ({
        employee_id,
        tds_amount: Number(tds_amount),
      }));
    if (!entries.length) {
      toast({ title: "No changes to save" });
      return;
    }
    saveMutation.mutate(entries);
  }

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").slice(1).filter(Boolean);
      const next: Record<string, string> = {};
      for (const line of lines) {
        const [empId, , , tdsAmt] = line.split(",");
        if (empId && tdsAmt) next[empId.trim()] = tdsAmt.trim();
      }
      setEditRows((prev) => ({ ...prev, ...next }));
      toast({ title: `${Object.keys(next).length} rows loaded from CSV` });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const editCount = Object.keys(editRows).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText className="size-4 text-blue-500" />
          Manual TDS Upload
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Select a payroll run to manage per-employee manual TDS amounts
        </p>
      </div>

      {/* Run selector */}
      <div className="flex items-center gap-3">
        <Label className="text-xs font-medium text-slate-700 whitespace-nowrap">
          Payroll Run
        </Label>
        <Select value={selectedRunId} onValueChange={setSelectedRunId}>
          <SelectTrigger className="h-9 w-56 text-xs">
            <SelectValue placeholder="Select a run…" />
          </SelectTrigger>
          <SelectContent>
            {runs.map((r: any) => (
              <SelectItem key={r.id} value={r.id}>
                {r.run_month} — {r.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Window status banner */}
      {selectedRunId && runWindow && (
        <div
          className={`flex flex-wrap items-center gap-4 rounded-xl border px-5 py-3 ${
            runWindow.is_window_open
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            {runWindow.is_window_open ? (
              <CheckCircle2 className="size-4 shrink-0" />
            ) : (
              <Lock className="size-4 shrink-0" />
            )}
            Window {runWindow.is_window_open ? "Open" : "Closed"}
          </div>
          {runWindow.window_close_date && (
            <span className="text-xs">
              Closes {fmtDate(runWindow.window_close_date)}
            </span>
          )}
          {runWindow.is_window_open && runWindow.days_remaining != null && (
            <span className="text-xs font-medium">
              {runWindow.days_remaining} day
              {runWindow.days_remaining !== 1 ? "s" : ""} remaining
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs opacity-70">TDS Mode:</span>
            <button
              onClick={() =>
                modeMutation.mutate(
                  runWindow.tds_mode === "manual" ? "auto" : "manual"
                )
              }
              disabled={modeMutation.isPending}
              className={`rounded-full border px-3 py-0.5 text-[11px] font-semibold capitalize transition-colors ${
                runWindow.is_window_open
                  ? "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100"
                  : "border-rose-300 bg-white text-rose-800 hover:bg-rose-100"
              }`}
            >
              {modeMutation.isPending ? (
                <Loader2 className="inline size-3 animate-spin" />
              ) : (
                runWindow.tds_mode ?? "manual"
              )}
            </button>
          </div>
        </div>
      )}

      {/* CSV upload + save bar */}
      {selectedRunId && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-[#073f78] hover:bg-blue-50 hover:text-[#073f78]">
            <Upload className="size-3.5" />
            Upload CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCSVUpload}
            />
          </label>
          <span className="text-xs text-slate-400">
            Format: employee_id, employee_name, run_month, tds_amount
          </span>
          {editCount > 0 && (
            <Button
              size="sm"
              className="ml-auto h-8 gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
              onClick={handleSaveAll}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Save {editCount} {editCount === 1 ? "Entry" : "Entries"}
            </Button>
          )}
        </div>
      )}

      {/* TDS table */}
      {selectedRunId &&
        (isFetching ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 className="mr-2 size-5 animate-spin" />
            Loading TDS entries…
          </div>
        ) : tdsRows.length === 0 ? (
          <EmptyState
            icon={FileText}
            message="No TDS entries for this run — upload a CSV to add entries"
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
            <table className="w-full">
              <thead className="bg-[#073f78]">
                <tr>
                  {[
                    "Employee",
                    "TDS Amount (₹)",
                    "Remarks",
                    "Uploaded By",
                    "Updated",
                  ].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tdsRows.map((r: any, idx: number) => (
                  <tr
                    key={r.employee_id}
                    className={
                      idx % 2 === 0
                        ? "bg-white hover:bg-slate-50"
                        : "bg-slate-50/60 hover:bg-slate-100"
                    }
                  >
                    <TD className="font-medium text-slate-900">
                      {r.employee_name ?? r.employee_id}
                    </TD>
                    <TD>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-8 w-32 text-right text-xs"
                        defaultValue={r.tds_amount}
                        onChange={(e) =>
                          setEditRows((prev) => ({
                            ...prev,
                            [r.employee_id]: e.target.value,
                          }))
                        }
                      />
                    </TD>
                    <TD className="text-slate-500">{r.remarks ?? "—"}</TD>
                    <TD>{r.uploaded_by_name ?? r.uploaded_by}</TD>
                    <TD>{fmtDate(r.updated_at)}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {!selectedRunId && (
        <EmptyState
          icon={FileText}
          message="Select a payroll run above to manage TDS entries"
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3: Cheque Name Mismatch Review
// ─────────────────────────────────────────────────────────────────────────────

function ChequeValidationTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"manual_validated" | "rejected">(
    "manual_validated"
  );

  const { data, isFetching } = useQuery({
    queryKey: ["cheque-validation-queue"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/cheque-validation/queue"),
  });
  const rows: any[] = data?.data ?? [];

  const decideMutation = useMutation({
    mutationFn: () =>
      hrmsApi.patch(`/api/payroll/cheque-validation/${selected.id}`, {
        decision,
        note,
      }),
    onSuccess: () => {
      toast({ title: "Decision saved" });
      setSelected(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["cheque-validation-queue"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Banknote className="size-4 text-purple-500" />
            Cheque Name Mismatch Review
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Validate or reject candidates where cheque name differs from account
            holder
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ["cheque-validation-queue"] })
          }
        >
          <RefreshCw
            className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          message="No pending cheque name mismatches — all clear"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead className="bg-[#073f78]">
              <tr>
                {[
                  "Candidate",
                  "Mobile",
                  "Name on Cheque",
                  "Account Holder",
                  "Bank / IFSC",
                  "Status",
                  "Cheque",
                  "Action",
                ].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => (
                <tr
                  key={r.id}
                  className={
                    idx % 2 === 0
                      ? "bg-white hover:bg-slate-50"
                      : "bg-slate-50/60 hover:bg-slate-100"
                  }
                >
                  <TD className="font-medium text-slate-900">
                    {r.candidate_full_name}
                  </TD>
                  <TD>{r.mobile ?? "—"}</TD>
                  <TD className="font-mono font-semibold text-amber-700">
                    {r.name_on_cheque ?? "—"}
                  </TD>
                  <TD className="font-mono">{r.account_holder_name ?? "—"}</TD>
                  <TD className="text-slate-500">
                    {r.bank_name ?? "—"} / {r.ifsc_code ?? "—"}
                  </TD>
                  <TD>
                    <StatusBadge status={r.match_status} />
                  </TD>
                  <TD>
                    {r.cheque_file_url ? (
                      <button
                        onClick={() =>
                          globalThis.window.open(r.cheque_file_url, "_blank")
                        }
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <Eye className="size-3" /> View
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TD>
                  <TD>
                    {r.match_status === "mismatch" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-lg px-3 text-[11px] font-medium"
                        onClick={() => {
                          setSelected(r);
                          setNote("");
                          setDecision("manual_validated");
                        }}
                      >
                        Review
                      </Button>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review dialog */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-slate-900">
              Cheque Name Review — {selected?.candidate_full_name}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-4 pt-1">
              {/* Side-by-side name comparison */}
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Name on Cheque
                  </p>
                  <p className="text-sm font-bold text-amber-700">
                    {selected.name_on_cheque}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Account Holder
                  </p>
                  <p className="text-sm font-bold text-slate-900">
                    {selected.account_holder_name}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Bank
                  </p>
                  <p className="text-xs text-slate-700">
                    {selected.bank_name ?? "—"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    IFSC
                  </p>
                  <p className="font-mono text-xs text-slate-700">
                    {selected.ifsc_code ?? "—"}
                  </p>
                </div>
              </div>

              {/* Cheque image preview */}
              {selected.cheque_file_url && (
                <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  {selected.cheque_file_url.includes(".pdf") ? (
                    <a
                      href={selected.cheque_file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs text-blue-600"
                    >
                      <FileText className="size-4" /> Open PDF Cheque
                    </a>
                  ) : (
                    <img
                      src={selected.cheque_file_url}
                      alt="Cheque"
                      className="max-h-full object-contain"
                    />
                  )}
                </div>
              )}

              {/* Decision */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-700">
                  Decision
                </Label>
                <Select
                  value={decision}
                  onValueChange={(v: "manual_validated" | "rejected") =>
                    setDecision(v)
                  }
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_validated">
                      Validate — names match on cheque
                    </SelectItem>
                    <SelectItem value="rejected">
                      Reject — names do not match
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-slate-700">
                  Note{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </Label>
                <Textarea
                  className="min-h-[60px] resize-none text-xs"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Validation note…"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={
                decision === "manual_validated"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-rose-600 hover:bg-rose-700 text-white"
              }
              onClick={() => decideMutation.mutate()}
              disabled={decideMutation.isPending}
            >
              {decideMutation.isPending && (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              )}
              {decision === "manual_validated" ? "Validate" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 4: Bank Change Requests
// ─────────────────────────────────────────────────────────────────────────────

function BankChangeTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ["bank-change-requests"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/bank-change-requests"),
  });
  const rows: any[] = data?.data ?? [];

  const decideMutation = useMutation({
    mutationFn: ({ id, decision, note }: any) =>
      hrmsApi.patch(`/api/payroll/bank-change-requests/${id}`, {
        decision,
        note,
      }),
    onSuccess: () => {
      toast({ title: "Bank change decision saved" });
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["bank-change-requests"] });
    },
    onError: (e: Error) =>
      toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Banknote className="size-4 text-blue-500" />
            Bank Account Change Requests
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Approve or reject employee bank account update requests
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ["bank-change-requests"] })
          }
        >
          <RefreshCw
            className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Banknote}
          message="No pending bank change requests"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead className="bg-[#073f78]">
              <tr>
                {[
                  "Employee",
                  "Old Account",
                  "New Bank",
                  "IFSC",
                  "Account Type",
                  "Penny Drop",
                  "Requested",
                  "Effective Run",
                  "Status",
                  "Action",
                ].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, idx: number) => {
                const newVals =
                  typeof r.new_values === "string"
                    ? JSON.parse(r.new_values)
                    : (r.new_values ?? {});
                const oldVals =
                  typeof r.old_values === "string"
                    ? JSON.parse(r.old_values)
                    : (r.old_values ?? {});
                return (
                  <tr
                    key={r.id}
                    className={
                      idx % 2 === 0
                        ? "bg-white hover:bg-slate-50"
                        : "bg-slate-50/60 hover:bg-slate-100"
                    }
                  >
                    <TD className="font-medium text-slate-900">
                      {r.employee_name ?? r.employee_id}
                    </TD>
                    <TD className="font-mono text-slate-500">
                      {oldVals.masked_account_number ?? "****"}
                    </TD>
                    <TD>{newVals.bank_name ?? "—"}</TD>
                    <TD className="font-mono">{newVals.ifsc_code ?? "—"}</TD>
                    <TD>{newVals.account_type ?? "—"}</TD>
                    <TD>
                      <Badge
                        variant="outline"
                        className="rounded-full text-[10px]"
                      >
                        {r.penny_drop_status ?? "skipped"}
                      </Badge>
                    </TD>
                    <TD>{fmtDate(r.requested_at)}</TD>
                    <TD className="font-mono">
                      {r.effective_run_month ?? "—"}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD>
                      {r.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-lg px-3 text-[11px] font-medium"
                          onClick={() => setSelected(r)}
                        >
                          Review
                        </Button>
                      )}
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <ApprovalDialog
          title={`Bank Change — ${
            selected.employee_name ?? selected.employee_id
          }`}
          open
          onClose={() => setSelected(null)}
          loading={decideMutation.isPending}
          onSubmit={(decision, note) =>
            decideMutation.mutate({ id: selected.id, decision, note })
          }
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: Salary History
// ─────────────────────────────────────────────────────────────────────────────

function SalaryHistoryTab() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["salary-history", search],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (search) qs.set("employee_id", search);
      return hrmsApi.get<any>(`/api/payroll/employee-salary-history?${qs}`);
    },
  });
  const rows: any[] = data?.data ?? [];

  function handleLookup() {
    setSearch(searchInput.trim());
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <TrendingUp className="size-4 text-emerald-500" />
          Salary Revision History
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          View effective-dated salary structure assignments for any employee
        </p>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            className="h-9 pl-8 text-xs"
            placeholder="Enter employee ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          />
        </div>
        <Button
          size="sm"
          className="h-9 bg-[#073f78] px-4 text-xs hover:bg-[#052d57]"
          onClick={handleLookup}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Search className="size-3.5" />
          )}
          <span className="ml-1.5">Look Up</span>
        </Button>
      </div>

      {/* Table / states */}
      {!search ? (
        <EmptyState
          icon={History}
          message="Enter an employee ID above and press Look Up"
        />
      ) : isFetching ? (
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="mr-2 size-5 animate-spin" />
          Fetching salary history…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={History}
          message="No salary history found for this employee"
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead className="bg-[#073f78]">
              <tr>
                {[
                  "Employee",
                  "Effective From",
                  "Effective To",
                  "Structure",
                  "CTC",
                  "Basic %",
                  "HRA %",
                  "Assigned By",
                  "Reason",
                  "Status",
                ].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const isActive = r.active_status === 1;
                return (
                  <tr
                    key={i}
                    className={
                      isActive
                        ? "border-l-2 border-l-emerald-500 bg-emerald-50/40 hover:bg-emerald-50"
                        : i % 2 === 0
                        ? "bg-white hover:bg-slate-50"
                        : "bg-slate-50/60 hover:bg-slate-100"
                    }
                  >
                    <TD className="font-medium text-slate-900">
                      {r.employee_name ?? r.employee_id}
                    </TD>
                    <TD className="font-mono">
                      {r.effective_from ? r.effective_from.slice(0, 10) : "—"}
                    </TD>
                    <TD className="font-mono text-slate-500">
                      {r.effective_to ? r.effective_to.slice(0, 10) : (
                        <span className="font-semibold text-emerald-600">Current</span>
                      )}
                    </TD>
                    <TD>{r.structure_name ?? "—"}</TD>
                    <TD className="text-right font-mono font-semibold text-slate-900">
                      ₹{fmt(r.annual_ctc ?? r.gross_monthly_ctc)}
                    </TD>
                    <TD className="text-right">{r.basic_pct ?? "—"}%</TD>
                    <TD className="text-right">{r.hra_pct ?? "—"}%</TD>
                    <TD>
                      {r.assigned_by_name ?? r.assigned_by ?? "—"}
                    </TD>
                    <TD className="max-w-[160px] truncate text-slate-500">
                      {r.assignment_reason ?? "—"}
                    </TD>
                    <TD>
                      <Badge
                        variant="outline"
                        className={`rounded-full text-[10px] font-semibold ${
                          isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-50 text-slate-400"
                        }`}
                      >
                        {isActive ? "Active" : "Historical"}
                      </Badge>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 6: Payroll Run Window Status
// ─────────────────────────────────────────────────────────────────────────────

function RunWindowTab() {
  const qc = useQueryClient();

  const { data: runsData, isFetching } = useQuery({
    queryKey: ["payroll-runs-window"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/runs?limit=24"),
  });
  const runs: any[] = runsData?.data ?? [];

  // Derive stat counts
  const totalRuns = runs.length;
  const openWindows = runs.filter((r) => {
    const cd = r.window_close_date ? new Date(r.window_close_date) : null;
    return !r.auto_closed_at && (!cd || cd > new Date());
  }).length;
  const closedWindows = totalRuns - openWindows;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthCount = runs.filter((r) =>
    r.run_month?.startsWith(thisMonth)
  ).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Clock className="size-4 text-slate-500" />
            Payroll Run Window Status
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Monitor open/closed windows and TDS mode for each payroll run
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() =>
            qc.invalidateQueries({ queryKey: ["payroll-runs-window"] })
          }
        >
          <RefreshCw
            className={`size-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Runs" value={totalRuns} />
        <StatCard
          label="Open Windows"
          value={openWindows}
          accent="text-emerald-600"
        />
        <StatCard
          label="Closed Windows"
          value={closedWindows}
          accent="text-rose-600"
        />
        <StatCard label="This Month" value={thisMonthCount} />
      </div>

      {/* Table */}
      {runs.length === 0 ? (
        <EmptyState icon={Clock} message="No payroll runs found" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
          <table className="w-full">
            <thead className="bg-[#073f78]">
              <tr>
                {[
                  "Run Month",
                  "Status",
                  "Window Closes",
                  "Auto Closed",
                  "Days Remaining",
                  "TDS Mode",
                  "Window",
                ].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r: any, idx: number) => {
                const closeDate = r.window_close_date
                  ? new Date(r.window_close_date)
                  : null;
                const today = new Date();
                const daysLeft = closeDate
                  ? Math.floor(
                      (closeDate.getTime() - today.getTime()) / 86400000
                    )
                  : null;
                const isOpen =
                  !r.auto_closed_at && (!closeDate || closeDate > today);

                return (
                  <tr
                    key={r.id}
                    className={
                      idx % 2 === 0
                        ? "bg-white hover:bg-slate-50"
                        : "bg-slate-50/60 hover:bg-slate-100"
                    }
                  >
                    <TD className="font-mono font-semibold text-slate-900">
                      {r.run_month}
                    </TD>
                    <TD>
                      <StatusBadge status={r.status} />
                    </TD>
                    <TD className="font-mono">
                      {closeDate
                        ? closeDate.toLocaleDateString("en-IN")
                        : "—"}
                    </TD>
                    <TD>
                      {r.auto_closed_at ? (
                        fmtDate(r.auto_closed_at)
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TD>
                    <TD>
                      {daysLeft != null ? (
                        <span
                          className={`font-semibold ${
                            daysLeft < 0
                              ? "text-rose-600"
                              : daysLeft <= 5
                              ? "text-amber-600"
                              : "text-emerald-700"
                          }`}
                        >
                          {daysLeft < 0
                            ? `${Math.abs(daysLeft)}d overdue`
                            : `${daysLeft}d`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD>
                      <Badge
                        variant="outline"
                        className="rounded-full text-[10px]"
                      >
                        {r.tds_mode ?? "manual"}
                      </Badge>
                    </TD>
                    <TD>
                      <Badge
                        variant="outline"
                        className={`rounded-full text-[10px] font-semibold ${
                          isOpen
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        {isOpen ? (
                          <CheckCircle2 className="mr-1 inline size-2.5" />
                        ) : (
                          <Lock className="mr-1 inline size-2.5" />
                        )}
                        {isOpen ? "Open" : "Closed"}
                      </Badge>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info panel */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4">
        <p className="text-xs font-semibold text-blue-800">
          Auto-closure rule
        </p>
        <p className="mt-1 text-xs text-blue-700 leading-relaxed">
          The payroll window for month M closes on the last day of M + 30 days.
          After closure, no corrections, component changes, or manual TDS
          updates are accepted. The daily cron auto-locks any run whose{" "}
          <code className="rounded bg-blue-100 px-1 font-mono">
            window_close_date
          </code>{" "}
          has passed.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────────────────────────

const TABS = [
  { value: "optout", label: "PF/ESI Opt-Out", icon: ShieldAlert },
  { value: "tds", label: "Manual TDS", icon: FileText },
  { value: "cheque", label: "Cheque Review", icon: BadgeCheck },
  { value: "bankchg", label: "Bank Changes", icon: Banknote },
  { value: "salhistory", label: "Salary History", icon: TrendingUp },
  { value: "window", label: "Run Windows", icon: Clock },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export default function NativePayrollHOQueues() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e8f2fc]">
            <Building2 className="size-5 text-[#073f78]" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Payroll HO — Operations Queue
            </h1>
            <p className="mt-0.5 text-xs text-slate-500">
              PF/ESI opt-outs · Manual TDS · Cheque validation · Bank changes ·
              Salary history · Window status
            </p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs defaultValue="optout">
          {/* Tab bar */}
          <TabsList className="mb-6 flex h-auto w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="flex flex-1 min-w-[110px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium text-slate-600 transition-colors data-[state=active]:bg-[#073f78] data-[state=active]:text-white data-[state=active]:shadow-sm"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Tab content panels */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <TabsContent value="optout" className="mt-0">
              <OptOutQueue />
            </TabsContent>
            <TabsContent value="tds" className="mt-0">
              <ManualTDSTab />
            </TabsContent>
            <TabsContent value="cheque" className="mt-0">
              <ChequeValidationTab />
            </TabsContent>
            <TabsContent value="bankchg" className="mt-0">
              <BankChangeTab />
            </TabsContent>
            <TabsContent value="salhistory" className="mt-0">
              <SalaryHistoryTab />
            </TabsContent>
            <TabsContent value="window" className="mt-0">
              <RunWindowTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
