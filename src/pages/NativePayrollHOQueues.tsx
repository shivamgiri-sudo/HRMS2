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
  ChevronDown,
  Clock,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  Upload,
  Users,
  X,
  XCircle,
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
  Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_CHIP: Record<string, string> = {
  pending:  "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  revoked:  "bg-slate-50 text-slate-500 border-slate-200",
  matched:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  mismatch: "bg-amber-50 text-amber-700 border-amber-200",
  manual_validated: "bg-blue-50 text-blue-700 border-blue-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`rounded-full text-[10px] font-semibold capitalize ${STATUS_CHIP[status] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>
      {status?.replace(/_/g, " ")}
    </Badge>
  );
}

function TH({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">{children}</th>;
}
function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 text-xs text-slate-700 border-b border-slate-100 ${className ?? ""}`}>{children}</td>;
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
function ApprovalDialog({ title, open, onClose, onSubmit, loading, extraFields }: ApprovalDialogProps) {
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {extraFields}
          <div>
            <Label className="text-xs">Decision</Label>
            <Select value={decision} onValueChange={(v: any) => setDecision(v)}>
              <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approve</SelectItem>
                <SelectItem value="rejected">Reject</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Note (optional)</Label>
            <Textarea className="mt-1 text-xs min-h-[60px]" value={note} onChange={e => setNote(e.target.value)} placeholder="Reason for decision…" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className={decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
            onClick={() => { onSubmit(decision, note); setNote(""); }}
            disabled={loading}
          >
            {loading && <Loader2 className="size-3.5 mr-1 animate-spin" />}
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
function OptOutQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState("pending");

  const { data, isFetching } = useQuery({
    queryKey: ["statutory-overrides", statusFilter],
    queryFn: () => hrmsApi.get<any>(`/api/payroll/statutory-overrides/all?status=${statusFilter}`),
  });
  const rows: any[] = data?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ id, decision, note, effectiveMonth }: any) =>
      hrmsApi.patch(`/api/payroll/statutory-overrides/${id}/approve`, {
        decision, note, effective_from_month: effectiveMonth,
      }),
    onSuccess: () => {
      toast({ title: "Decision saved" });
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["statutory-overrides"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const [effectiveMonth, setEffectiveMonth] = useState("");

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <ShieldAlert className="size-4 text-amber-500" /> PF / ESI Opt-Out Requests
        </h2>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["pending","approved","rejected","revoked"].map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["statutory-overrides"] })}>
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">No records for selected status</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{["Employee","Override Type","Status","Requested","Declaration","Action"].map(h => <TH key={h}>{h}</TH>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <TD className="font-medium">{r.employee_name ?? r.employee_id}</TD>
                  <TD><Badge variant="outline" className="text-[10px]">{r.override_type?.replace(/_/g," ")}</Badge></TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD>{fmtDate(r.requested_at)}</TD>
                  <TD className="max-w-[200px] truncate text-slate-500">{r.declaration_text ?? "—"}</TD>
                  <TD>
                    {r.status === "pending" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { setSelected(r); setEffectiveMonth(""); }}>
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
          title={`${selected.override_type?.replace(/_/g," ")} — ${selected.employee_name ?? selected.employee_id}`}
          open
          onClose={() => setSelected(null)}
          loading={approveMutation.isPending}
          onSubmit={(decision, note) =>
            approveMutation.mutate({ id: selected.id, decision, note, effectiveMonth })
          }
          extraFields={
            <div>
              <Label className="text-xs">Effective From Month (YYYY-MM)</Label>
              <Input className="h-8 text-xs mt-1" type="month" value={effectiveMonth} onChange={e => setEffectiveMonth(e.target.value)} />
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
    queryFn: () => hrmsApi.get<any>(`/api/payroll/runs/${selectedRunId}/manual-tds`),
    enabled: !!selectedRunId,
  });
  const tdsRows: any[] = tdsData?.data ?? [];

  const { data: windowData } = useQuery({
    queryKey: ["window-status", selectedRunId],
    queryFn: () => hrmsApi.get<any>(`/api/payroll/runs/${selectedRunId}/window-status`),
    enabled: !!selectedRunId,
  });
  const window = windowData?.data;

  const modeMutation = useMutation({
    mutationFn: (mode: string) =>
      hrmsApi.patch(`/api/payroll/runs/${selectedRunId}/tds-mode`, { tds_mode: mode }),
    onSuccess: () => { toast({ title: "TDS mode updated" }); void qc.invalidateQueries({ queryKey: ["manual-tds"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: (entries: any[]) =>
      hrmsApi.post(`/api/payroll/runs/${selectedRunId}/manual-tds`, { entries }),
    onSuccess: () => { toast({ title: "TDS saved" }); void qc.invalidateQueries({ queryKey: ["manual-tds"] }); setEditRows({}); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function handleSaveAll() {
    const entries = Object.entries(editRows)
      .filter(([, v]) => v !== "")
      .map(([employee_id, tds_amount]) => ({ employee_id, tds_amount: Number(tds_amount) }));
    if (!entries.length) { toast({ title: "No changes to save" }); return; }
    saveMutation.mutate(entries);
  }

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").slice(1).filter(Boolean);
      const next: Record<string, string> = {};
      for (const line of lines) {
        const [empId, , , tdsAmt] = line.split(",");
        if (empId && tdsAmt) next[empId.trim()] = tdsAmt.trim();
      }
      setEditRows(prev => ({ ...prev, ...next }));
      toast({ title: `${Object.keys(next).length} rows loaded from CSV` });
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <FileText className="size-4 text-blue-500" /> Manual TDS Upload
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={selectedRunId} onValueChange={setSelectedRunId}>
            <SelectTrigger className="h-7 text-xs w-44"><SelectValue placeholder="Select payroll run" /></SelectTrigger>
            <SelectContent>
              {runs.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>{r.run_month} — {r.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedRunId && window && (
        <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 text-sm ${window.is_window_open ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
          {window.is_window_open ? <CheckCircle2 className="size-4 shrink-0" /> : <Lock className="size-4 shrink-0" />}
          <span>
            <strong>Window {window.is_window_open ? "Open" : "Closed"}</strong>
            {window.window_close_date && ` · Closes ${fmtDate(window.window_close_date)}`}
            {window.is_window_open && window.days_remaining != null && ` · ${window.days_remaining} days remaining`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs opacity-70">TDS Mode:</span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px]"
              onClick={() => modeMutation.mutate(window.tds_mode === "manual" ? "auto" : "manual")}
              disabled={modeMutation.isPending}
            >
              {window.tds_mode ?? "manual"}
            </Button>
          </div>
        </div>
      )}

      {selectedRunId && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1 cursor-pointer bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors">
            <Upload className="size-3.5" /> Upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
          </label>
          <span className="text-xs text-slate-400">CSV format: employee_id,employee_name,run_month,tds_amount</span>
          {Object.keys(editRows).length > 0 && (
            <Button
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 ml-auto"
              onClick={handleSaveAll}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
              Save {Object.keys(editRows).length} Entries
            </Button>
          )}
        </div>
      )}

      {selectedRunId && (
        isFetching ? (
          <div className="py-8 text-center text-slate-400"><Loader2 className="size-5 animate-spin inline-block mr-2" />Loading…</div>
        ) : tdsRows.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">No TDS entries for this run. Upload a CSV to add entries.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50"><tr>{["Employee","TDS Amount","Remarks","Uploaded By","Updated"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
              <tbody>
                {tdsRows.map((r: any) => (
                  <tr key={r.employee_id} className="hover:bg-slate-50">
                    <TD className="font-medium">{r.employee_name ?? r.employee_id}</TD>
                    <TD>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-7 text-xs w-28 text-right border-slate-200"
                        defaultValue={r.tds_amount}
                        onChange={e => setEditRows(prev => ({ ...prev, [r.employee_id]: e.target.value }))}
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
        )
      )}
      {!selectedRunId && (
        <div className="py-16 text-center text-slate-400 text-sm">Select a payroll run to manage TDS entries</div>
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
  const [decision, setDecision] = useState<"manual_validated" | "rejected">("manual_validated");

  const { data, isFetching } = useQuery({
    queryKey: ["cheque-validation-queue"],
    queryFn: () => hrmsApi.get<any>("/api/payroll/cheque-validation/queue"),
  });
  const rows: any[] = data?.data ?? [];

  const decideMutation = useMutation({
    mutationFn: () =>
      hrmsApi.patch(`/api/payroll/cheque-validation/${selected.id}`, { decision, note }),
    onSuccess: () => {
      toast({ title: "Decision saved" });
      setSelected(null); setNote("");
      void qc.invalidateQueries({ queryKey: ["cheque-validation-queue"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Banknote className="size-4 text-purple-500" /> Cheque Name Mismatch Review
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["cheque-validation-queue"] })}>
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          <BadgeCheck className="size-8 mx-auto mb-2 text-emerald-300" />
          No pending cheque name mismatches
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{["Candidate","Mobile","Name on Cheque","Account Holder Name","Bank / IFSC","Status","Cheque","Action"].map(h => <TH key={h}>{h}</TH>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <TD className="font-medium">{r.candidate_full_name}</TD>
                  <TD>{r.mobile ?? "—"}</TD>
                  <TD className="font-mono text-amber-700 font-semibold">{r.name_on_cheque ?? "—"}</TD>
                  <TD className="font-mono">{r.account_holder_name ?? "—"}</TD>
                  <TD className="text-slate-500">{r.bank_name ?? "—"} / {r.ifsc_code ?? "—"}</TD>
                  <TD><StatusBadge status={r.match_status} /></TD>
                  <TD>
                    {r.cheque_file_url ? (
                      <button onClick={() => window.open(r.cheque_file_url, "_blank")} className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1">
                        <Eye className="size-3" /> View
                      </button>
                    ) : <span className="text-slate-400">—</span>}
                  </TD>
                  <TD>
                    {r.match_status === "mismatch" && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { setSelected(r); setNote(""); setDecision("manual_validated"); }}>
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

      <Dialog open={!!selected} onOpenChange={v => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Cheque Name Review — {selected?.candidate_full_name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 border border-slate-200">
                <div><p className="text-xs text-slate-500">Name on Cheque</p><p className="font-semibold text-amber-700">{selected.name_on_cheque}</p></div>
                <div><p className="text-xs text-slate-500">Account Holder</p><p className="font-semibold">{selected.account_holder_name}</p></div>
                <div><p className="text-xs text-slate-500">Bank</p><p>{selected.bank_name ?? "—"}</p></div>
                <div><p className="text-xs text-slate-500">IFSC</p><p className="font-mono">{selected.ifsc_code ?? "—"}</p></div>
              </div>
              {selected.cheque_file_url && (
                <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center h-40">
                  {selected.cheque_file_url.includes(".pdf") ? (
                    <a href={selected.cheque_file_url} target="_blank" rel="noreferrer" className="text-blue-600 text-xs flex items-center gap-1">
                      <FileText className="size-4" /> Open PDF
                    </a>
                  ) : (
                    <img src={selected.cheque_file_url} alt="Cheque" className="max-h-full object-contain" />
                  )}
                </div>
              )}
              <div>
                <Label className="text-xs">Decision</Label>
                <Select value={decision} onValueChange={(v: any) => setDecision(v)}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_validated">Validate — Names match on cheque</SelectItem>
                    <SelectItem value="rejected">Reject — Names don't match</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Note (optional)</Label>
                <Textarea className="mt-1 text-xs min-h-[50px]" value={note} onChange={e => setNote(e.target.value)} placeholder="Validation note…" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              size="sm"
              className={decision === "manual_validated" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}
              onClick={() => decideMutation.mutate()}
              disabled={decideMutation.isPending}
            >
              {decideMutation.isPending && <Loader2 className="size-3.5 mr-1 animate-spin" />}
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
      hrmsApi.patch(`/api/payroll/bank-change-requests/${id}`, { decision, note }),
    onSuccess: () => {
      toast({ title: "Bank change decision saved" });
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["bank-change-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Banknote className="size-4 text-blue-500" /> Bank Account Change Requests
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["bank-change-requests"] })}>
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">No pending bank change requests</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{["Employee","Old Account","New Bank","New IFSC","Account Type","Penny Drop","Requested","Effective Run","Status","Action"].map(h => <TH key={h}>{h}</TH>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any) => {
                const newVals = typeof r.new_values === "string" ? JSON.parse(r.new_values) : (r.new_values ?? {});
                const oldVals = typeof r.old_values === "string" ? JSON.parse(r.old_values) : (r.old_values ?? {});
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <TD className="font-medium">{r.employee_name ?? r.employee_id}</TD>
                    <TD className="font-mono text-slate-500">{oldVals.masked_account_number ?? "****"}</TD>
                    <TD>{newVals.bank_name ?? "—"}</TD>
                    <TD className="font-mono">{newVals.ifsc_code ?? "—"}</TD>
                    <TD>{newVals.account_type ?? "—"}</TD>
                    <TD>
                      <Badge variant="outline" className="text-[10px]">
                        {r.penny_drop_status ?? "skipped"}
                      </Badge>
                    </TD>
                    <TD>{fmtDate(r.requested_at)}</TD>
                    <TD className="font-mono">{r.effective_run_month ?? "—"}</TD>
                    <TD><StatusBadge status={r.status} /></TD>
                    <TD>
                      {r.status === "pending" && (
                        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setSelected(r)}>
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
          title={`Bank Change — ${selected.employee_name ?? selected.employee_id}`}
          open
          onClose={() => setSelected(null)}
          loading={decideMutation.isPending}
          onSubmit={(decision, note) => decideMutation.mutate({ id: selected.id, decision, note })}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5: Salary History
// ─────────────────────────────────────────────────────────────────────────────
function SalaryHistoryTab() {
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["salary-history", search, branchFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (search) qs.set("employee_id", search);
      if (branchFilter) qs.set("branch_id", branchFilter);
      return hrmsApi.get<any>(`/api/payroll/employee-salary-history?${qs}`);
    },
  });
  const rows: any[] = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <TrendingUp className="size-4 text-emerald-500" /> Salary Revision History
        </h2>
        <div className="flex gap-2">
          <Input
            className="h-7 text-xs w-40"
            placeholder="Employee ID / search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isFetching ? (
        <div className="py-8 text-center text-slate-400"><Loader2 className="size-5 animate-spin inline-block mr-2" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          {search ? "No salary history for this employee" : "Enter an employee ID to view salary history"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>{["Employee","Effective From","Effective To","Structure","CTC","Basic%","HRA%","Assigned By","Reason","Status"].map(h => <TH key={h}>{h}</TH>)}</tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <TD className="font-medium">{r.employee_name ?? r.employee_id}</TD>
                  <TD className="font-mono">{r.effective_from ? r.effective_from.slice(0,10) : "—"}</TD>
                  <TD className="font-mono text-slate-500">{r.effective_to ? r.effective_to.slice(0,10) : "Current"}</TD>
                  <TD>{r.structure_name ?? "—"}</TD>
                  <TD className="text-right font-mono font-semibold">₹{fmt(r.annual_ctc ?? r.gross_monthly_ctc)}</TD>
                  <TD className="text-right">{r.basic_pct ?? "—"}%</TD>
                  <TD className="text-right">{r.hra_pct ?? "—"}%</TD>
                  <TD>{r.assigned_by_name ?? r.assigned_by ?? "—"}</TD>
                  <TD className="text-slate-500 max-w-[160px] truncate">{r.assignment_reason ?? "—"}</TD>
                  <TD>
                    <Badge variant="outline" className={`text-[10px] ${r.active_status === 1 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-400"}`}>
                      {r.active_status === 1 ? "Active" : "Historical"}
                    </Badge>
                  </TD>
                </tr>
              ))}
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <Clock className="size-4 text-slate-500" /> Payroll Run Window Status
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: ["payroll-runs-window"] })}>
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>{["Run Month","Status","Window Closes","Auto Closed","Days Remaining","TDS Mode","Window"].map(h => <TH key={h}>{h}</TH>)}</tr>
          </thead>
          <tbody>
            {runs.map((r: any) => {
              const closeDate  = r.window_close_date ? new Date(r.window_close_date) : null;
              const today      = new Date();
              const daysLeft   = closeDate ? Math.floor((closeDate.getTime() - today.getTime()) / 86400000) : null;
              const isOpen     = !r.auto_closed_at && (!closeDate || closeDate > today);
              const isClosed   = !isOpen;
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <TD className="font-mono font-semibold">{r.run_month}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                  <TD className="font-mono">{closeDate ? closeDate.toLocaleDateString("en-IN") : "—"}</TD>
                  <TD>{r.auto_closed_at ? fmtDate(r.auto_closed_at) : <span className="text-slate-400">—</span>}</TD>
                  <TD>
                    {daysLeft != null ? (
                      <span className={daysLeft < 0 ? "text-rose-600 font-semibold" : daysLeft <= 5 ? "text-amber-600 font-semibold" : "text-emerald-700"}>
                        {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d`}
                      </span>
                    ) : "—"}
                  </TD>
                  <TD>
                    <Badge variant="outline" className="text-[10px]">{r.tds_mode ?? "manual"}</Badge>
                  </TD>
                  <TD>
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-semibold ${isOpen ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}`}
                    >
                      {isClosed ? <Lock className="size-2.5 mr-1 inline" /> : <CheckCircle2 className="size-2.5 mr-1 inline" />}
                      {isOpen ? "Open" : "Closed"}
                    </Badge>
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
        <strong>Auto-closure rule:</strong> Payroll window for month M closes on the last day of M + 30 days.
        After closure, no corrections, component changes, or manual TDS updates are accepted.
        The daily cron auto-locks any run whose window_close_date has passed.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export default function NativePayrollHOQueues() {
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page header */}
      <div className="bg-white border-b border-slate-200 shadow-sm px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f2fc] text-[#073f78]">
            <Users className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Payroll HO — Operations Queue</h1>
            <p className="text-xs text-slate-500">PF/ESI opt-outs · Manual TDS · Cheque validation · Bank changes · Salary history · Window status</p>
          </div>
        </div>
      </div>

      <div className="p-6">
        <Tabs defaultValue="optout">
          <TabsList className="grid grid-cols-3 md:grid-cols-6 h-auto mb-6 bg-white border border-slate-200 rounded-xl p-1 gap-1">
            <TabsTrigger value="optout"    className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">PF/ESI Opt-Out</TabsTrigger>
            <TabsTrigger value="tds"       className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">Manual TDS</TabsTrigger>
            <TabsTrigger value="cheque"    className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">Cheque Review</TabsTrigger>
            <TabsTrigger value="bankchg"   className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">Bank Changes</TabsTrigger>
            <TabsTrigger value="salhistory" className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">Salary History</TabsTrigger>
            <TabsTrigger value="window"    className="text-[11px] rounded-lg py-2 data-[state=active]:bg-[#073f78] data-[state=active]:text-white">Run Windows</TabsTrigger>
          </TabsList>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <TabsContent value="optout"><OptOutQueue /></TabsContent>
            <TabsContent value="tds"><ManualTDSTab /></TabsContent>
            <TabsContent value="cheque"><ChequeValidationTab /></TabsContent>
            <TabsContent value="bankchg"><BankChangeTab /></TabsContent>
            <TabsContent value="salhistory"><SalaryHistoryTab /></TabsContent>
            <TabsContent value="window"><RunWindowTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
