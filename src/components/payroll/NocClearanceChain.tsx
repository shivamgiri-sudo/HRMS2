/**
 * NOC Certificate — the clearance chain workspace.
 *
 * Two panes: the tracking list on the left (every open exit with its per-role progress), the
 * selected case on the right (the eight signatories, the asset table, and whatever actions the
 * current user is actually allowed to take).
 *
 * The signatory table reproduces the certificate's printed 1-8 order (display_no), not the
 * approval order (tier). Those are genuinely different — the form numbers HR third while the
 * hierarchy clears HR fourth — and the backend keeps them as separate columns for that reason.
 * Anyone comparing this screen to the paper form should find the same rows in the same places.
 *
 * Every action button is driven by the backend's own `blocked` verdict rather than by rules
 * duplicated here. A second copy of the tier gate in the browser would drift from the server's,
 * and the failure mode is the worst kind: a button that looks available and 409s.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, Clock, FileCheck, Loader2, Lock, Printer, RefreshCw, Search,
  ShieldAlert, XCircle,
} from "lucide-react";

import { hrmsApi } from "../../lib/hrmsApi";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "../ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";

// ─── Types ───────────────────────────────────────────────────────────────────

type SignatoryStatus = "pending" | "accepted" | "acknowledged" | "declined";
type AssetStatus = "returned" | "not_returned" | "na";
type CaseStatus = "invited" | "employee_submitted" | "in_progress" | "declined" | "completed" | "cancelled";

interface CaseListRow {
  id: string;
  employee_code: string | null;
  employee_name: string | null;
  branch_name: string | null;
  status: CaseStatus;
  last_working_day: string | null;
  signatory_total: number;
  signatory_accepted: number;
  signatory_declined: number;
  signatory_pending: number;
  signatory_sla_breached: number;
  pending_stages: string | null;
}

interface Signatory {
  id: string;
  display_no: number;
  tier: number;
  stage_key: string;
  stage_label: string;
  role_key: string;
  status: SignatoryStatus;
  acted_by_name: string | null;
  acted_at: string | null;
  remarks: string | null;
  sla_due_at: string | null;
  requires_asset_clearance: number;
  blocked: { code: string; message: string } | null;
}

interface AssetRow {
  id: string;
  item_no: number;
  item_code: string;
  item_label: string;
  is_mandatory_for_finance: number;
  shown_on_form: number;
  quantity: number | null;
  status: AssetStatus;
  remarks: string | null;
  waived_at: string | null;
  waiver_reason: string | null;
}

interface CaseEvent {
  stage_key: string | null;
  action: string;
  actor_name: string | null;
  actor_role: string | null;
  reason: string | null;
  created_at: string;
}

interface SummaryRoleRow {
  display_no: number;
  stage_key: string;
  stage_label: string;
  pending: number;
  accepted: number;
  declined: number;
  sla_breached: number;
}

interface CaseDetail {
  nocCase: {
    id: string;
    employee_id: string;
    employee_code: string | null;
    employee_name: string | null;
    location: string | null;
    portfolio: string | null;
    designation: string | null;
    resignation_date: string | null;
    last_working_day: string | null;
    reason_for_leaving: string | null;
    status: CaseStatus;
    declined_stage_key: string | null;
    decline_reason: string | null;
    fnf_option: string | null;
    fnf_option_suggested: string | null;
    override_at: string | null;
    override_reason: string | null;
    employee_submitted_at: string | null;
    completed_at: string | null;
  };
  signatories: Signatory[];
  assets: AssetRow[];
  events: CaseEvent[];
  assetGate: { satisfied: boolean; outstanding: string[] };
  progress: { total: number; responded: number; accepted: number; declined: number; pending: number };
}

const FNF_LABELS: Record<string, string> = {
  current_payroll: "Current Payroll",
  "45_days": "45 Days of Leaving Date",
  both: "Both Current Payroll & 45 Days",
};

function fmt(v: string | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

/**
 * Escapes before interpolation into the printable certificate.
 *
 * The certificate is assembled as an HTML string and written into a new window, so React's
 * automatic escaping does not apply. Almost every field on it is free text somebody typed —
 * remarks, decline reasons, waiver reasons, reason for leaving — and one of those containing a
 * tag would otherwise be interpreted rather than printed.
 */
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The completed clearance document — each signatory's role, name, decision and timestamp.
 *
 * Rendered into a new window rather than printed from this page. A print stylesheet competing with
 * the app's layout, the sidebar and an open dialog is the fragile approach; a standalone document
 * prints identically from every browser and needs no `@media print` overrides anywhere else.
 *
 * This IS the signature record. There is no separate PDF-generation step because there is nothing
 * to generate from — the names, decisions and timestamps in noc_signatory are the signatures, and
 * a PDF would be a rendering of this same data with an extra failure mode.
 */
function openCertificate(d: CaseDetail): void {
  const c = d.nocCase;
  const sigRows = d.signatories
    .slice()
    .sort((a, b) => a.display_no - b.display_no)
    .map((s) => {
      const label = s.status === "pending" ? "Pending"
        : s.status === "accepted" ? "Accepted"
        : s.status === "acknowledged" ? "Acknowledged" : "Declined";
      return `<tr>
        <td class="n">${s.display_no}</td>
        <td>${esc(s.stage_label)}</td>
        <td>${esc(s.acted_by_name ?? "—")}</td>
        <td class="st ${s.status}">${label}</td>
        <td>${s.acted_at ? esc(new Date(s.acted_at).toLocaleString()) : "—"}</td>
        <td class="rm">${esc(s.remarks ?? "")}</td>
      </tr>`;
    }).join("");

  const assetRows = d.assets
    .filter((a) => Number(a.shown_on_form) === 1 || Number(a.is_mandatory_for_finance) === 1)
    .map((a) => {
      const st = a.waived_at ? "Waived" : a.status === "returned" ? "Returned"
        : a.status === "not_returned" ? "Not Returned" : "N/A";
      return `<tr>
        <td class="n">${a.item_no}</td>
        <td>${esc(a.item_label)}</td>
        <td class="n">${a.quantity ?? "—"}</td>
        <td>${st}</td>
        <td class="rm">${esc(a.waiver_reason ?? a.remarks ?? "")}</td>
      </tr>`;
    }).join("");

  const overrideNote = c.override_at
    ? `<div class="warn"><strong>Payroll Head override recorded.</strong> Salary/F&amp;F release was
        unblocked without a completed clearance. Reason: ${esc(c.override_reason)}</div>`
    : "";
  const declineNote = c.status === "declined"
    ? `<div class="warn"><strong>Declined at ${esc(c.declined_stage_key)}.</strong>
        ${esc(c.decline_reason)}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>NOC Certificate — ${esc(c.employee_code)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:28px;font-size:12px}
  h1{font-size:17px;margin:0;text-align:center}
  .sub{text-align:center;font-size:12px;margin:3px 0 2px}
  .note{text-align:center;font-size:10px;font-style:italic;color:#555;margin-bottom:18px}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;background:#eef2f7;
     padding:5px 8px;margin:18px 0 8px;border-left:3px solid #1e3a63}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px}
  .f{display:flex;gap:6px}
  .f .k{color:#555;min-width:118px}
  .f .v{font-weight:bold}
  table{width:100%;border-collapse:collapse;margin-top:4px}
  th,td{border:1px solid #b9c2cf;padding:5px 7px;text-align:left;vertical-align:top}
  th{background:#f4f6f9;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
  td.n{text-align:center;width:34px}
  td.st{font-weight:bold}
  td.st.accepted,td.st.acknowledged{color:#046c4e}
  td.st.declined{color:#b42318}
  td.st.pending{color:#8a6d00}
  td.rm{color:#444;font-size:11px}
  .warn{border:1px solid #d59b00;background:#fff8e6;padding:8px 10px;margin-top:12px;font-size:11px}
  .decl{border:1px solid #ccc;background:#fafafa;padding:9px 11px;margin-top:16px;font-size:11px;line-height:1.6}
  .foot{margin-top:20px;font-size:10px;color:#666;border-top:1px solid #ddd;padding-top:8px}
  @media print{body{padding:12px}@page{margin:12mm}}
</style></head><body onload="window.print()">
  <h1>Mas Callnet India Pvt. Ltd.</h1>
  <div class="sub"><strong>NOC CERTIFICATE — EXIT CLEARANCE</strong></div>
  <div class="note">Employee &amp; signatory details captured digitally within HRMS.
    Signatory name, decision and timestamp below constitute the digital signature record.</div>

  <h2>Employee Details</h2>
  <div class="grid">
    <div class="f"><span class="k">Employee Name</span><span class="v">${esc(c.employee_name)}</span></div>
    <div class="f"><span class="k">Employee Code</span><span class="v">${esc(c.employee_code)}</span></div>
    <div class="f"><span class="k">Location</span><span class="v">${esc(c.location)}</span></div>
    <div class="f"><span class="k">Portfolio</span><span class="v">${esc(c.portfolio)}</span></div>
    <div class="f"><span class="k">Designation</span><span class="v">${esc(c.designation)}</span></div>
    <div class="f"><span class="k">Resignation Date</span><span class="v">${esc(c.resignation_date)}</span></div>
    <div class="f"><span class="k">Last Working Day</span><span class="v">${esc(c.last_working_day)}</span></div>
    <div class="f"><span class="k">Salary / FNF</span><span class="v">${esc(FNF_LABELS[c.fnf_option ?? ""] ?? c.fnf_option ?? "Not set")}</span></div>
  </div>

  <h2>Signatory Clearance</h2>
  <table>
    <thead><tr><th>#</th><th>Role</th><th>Name</th><th>Status</th><th>Date</th><th>Remarks</th></tr></thead>
    <tbody>${sigRows}</tbody>
  </table>

  <h2>Company Property</h2>
  <table>
    <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Status</th><th>Remarks / Waiver</th></tr></thead>
    <tbody>${assetRows}</tbody>
  </table>

  ${c.reason_for_leaving ? `<h2>Reason for Leaving</h2><div class="decl">${esc(c.reason_for_leaving)}</div>` : ""}

  <div class="decl">The employee declared that all company property — Desktop (TFT), Keyboard, CPU,
    Mouse and ID Card — would be returned before any further FNF/NOC procedure, and agreed to the
    Company Full and Final / NOC procedure as per the 45-day policy.</div>

  ${declineNote}${overrideNote}

  <div class="foot">
    Clearance status: <strong>${esc(c.status.replace(/_/g, " ").toUpperCase())}</strong>
    ${c.completed_at ? ` &middot; Completed ${esc(new Date(c.completed_at).toLocaleString())}` : ""}
    &middot; Generated ${esc(new Date().toLocaleString())}
    <br>&copy; Mas Callnet India Pvt. Ltd. — system-generated record, no wet signature required.
  </div>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) {
    toast.error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    return;
  }
  w.document.write(html);
  w.document.close();
}

function caseStatusClass(s: string): string {
  switch (s) {
    case "completed": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "declined": return "bg-red-100 text-red-800 border-red-200";
    case "in_progress": return "bg-blue-100 text-blue-800 border-blue-200";
    case "employee_submitted": return "bg-amber-100 text-amber-800 border-amber-200";
    case "invited": return "bg-slate-100 text-slate-700 border-slate-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function sigStatusBadge(s: SignatoryStatus) {
  if (s === "accepted") return { cls: "bg-emerald-100 text-emerald-800 border-emerald-200", label: "Accepted" };
  if (s === "acknowledged") return { cls: "bg-teal-100 text-teal-800 border-teal-200", label: "Acknowledged" };
  if (s === "declined") return { cls: "bg-red-100 text-red-800 border-red-200", label: "Declined" };
  return { cls: "bg-slate-100 text-slate-600 border-slate-200", label: "Pending" };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NocClearanceChain({ canOverride }: { canOverride: boolean }) {
  const [rows, setRows] = useState<CaseListRow[]>([]);
  const [summary, setSummary] = useState<SummaryRoleRow[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [slaOnly, setSlaOnly] = useState(false);
  /** Set by clicking a column on the board — narrows the list to that role's pending queue. */
  const [stageFilter, setStageFilter] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Action dialogs
  const [decision, setDecision] = useState<{ stageKey: string; label: string; kind: "accepted" | "acknowledged" | "declined" } | null>(null);
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [waive, setWaive] = useState<{ itemCode: string; label: string } | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [lwd, setLwd] = useState("");

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      // "open" is not a backend status — it means "not finished", which the API expresses by the
      // absence of a status filter plus client-side exclusion would be wrong (it paginates).
      // Sent as-is only for the real statuses; 'open' just omits the filter.
      if (statusFilter && statusFilter !== "open" && statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      if (slaOnly) params.set("slaBreachedOnly", "true");
      if (stageFilter) {
        // Paired with stageStatus=pending: the board's number is a pending count, so clicking it
        // must land on the same population it named.
        params.set("stageKey", stageFilter);
        params.set("stageStatus", "pending");
      }
      const res = await hrmsApi.get<{ data: CaseListRow[] }>(`/api/payroll/noc-cases?${params.toString()}`);
      let data = res.data ?? [];
      if (statusFilter === "open") {
        data = data.filter((r) => r.status !== "completed" && r.status !== "cancelled");
      }
      setRows(data);
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not load NOC clearances");
    } finally {
      setListLoading(false);
    }
  }, [statusFilter, search, slaOnly, stageFilter]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await hrmsApi.get<{ data: CaseDetail }>(`/api/payroll/noc-cases/${id}`);
      setDetail(res.data ?? null);
      setLwd(res.data?.nocCase?.last_working_day ?? "");
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not load this NOC");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /**
   * The per-role board. Aggregated server-side across every open exit in the caller's scope, not
   * counted from `rows` — that is one page of at most 500, so counting it client-side would report
   * a number that silently means "in this page" while looking like "in the business".
   */
  const loadSummary = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ data: { byRole: SummaryRoleRow[] } }>("/api/payroll/noc-cases/summary");
      setSummary(res.data?.byRole ?? []);
    } catch {
      // The board is a headline, not the workspace. If it fails the list below still works, and
      // an error toast here would fire on every page load for a user whose scope is empty.
      setSummary([]);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); }, [selectedId, loadDetail]);

  const refreshBoth = useCallback(async () => {
    await loadList();
    await loadSummary();
    if (selectedId) await loadDetail(selectedId);
  }, [loadList, loadSummary, loadDetail, selectedId]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const submitDecision = async () => {
    if (!selectedId || !decision) return;
    if (decision.kind === "declined" && !decisionRemarks.trim()) {
      toast.warning("A reason is required to decline.");
      return;
    }
    setBusy("decision");
    try {
      const res = await hrmsApi.post<{ message?: string }>(
        `/api/payroll/noc-cases/${selectedId}/signatories/${decision.stageKey}`,
        { decision: decision.kind, remarks: decisionRemarks.trim() || null },
      );
      toast.success(res.message ?? "Clearance recorded");
      setDecision(null);
      setDecisionRemarks("");
      await refreshBoth();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not record the decision");
    } finally { setBusy(null); }
  };

  const setAsset = async (itemCode: string, status: AssetStatus) => {
    if (!selectedId) return;
    setBusy(`asset:${itemCode}`);
    try {
      await hrmsApi.patch(`/api/payroll/noc-cases/${selectedId}/assets/${itemCode}`, { status });
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not update the asset");
    } finally { setBusy(null); }
  };

  const submitWaive = async () => {
    if (!selectedId || !waive) return;
    if (!waiveReason.trim()) { toast.warning("A waiver reason is required."); return; }
    setBusy("waive");
    try {
      await hrmsApi.post(`/api/payroll/noc-cases/${selectedId}/assets/${waive.itemCode}/waive`, { reason: waiveReason.trim() });
      toast.success("Waiver recorded");
      setWaive(null);
      setWaiveReason("");
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not record the waiver");
    } finally { setBusy(null); }
  };

  const saveLwd = async () => {
    if (!selectedId || !lwd) return;
    setBusy("lwd");
    try {
      await hrmsApi.patch(`/api/payroll/noc-cases/${selectedId}/last-working-day`, { lastWorkingDay: lwd });
      toast.success("Last Working Day recorded");
      await refreshBoth();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not save the Last Working Day");
    } finally { setBusy(null); }
  };

  const sendInvite = async () => {
    if (!selectedId) return;
    setBusy("invite");
    try {
      const res = await hrmsApi.post<{ data: { url: string }; message?: string }>(
        `/api/payroll/noc-cases/${selectedId}/invite`, {},
      );
      toast.success(res.message ?? "Form link sent");
      // Shown, not just sent. SMS and WhatsApp have never delivered from this system, so copying
      // the link by hand is the only reliable non-email channel.
      if (res.data?.url) {
        await navigator.clipboard.writeText(res.data.url).catch(() => undefined);
        toast.info("Link copied to your clipboard — you can paste it into WhatsApp if needed.");
      }
      await refreshBoth();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not send the form link");
    } finally { setBusy(null); }
  };

  const setFnf = async (option: string) => {
    if (!selectedId) return;
    setBusy("fnf");
    try {
      await hrmsApi.patch(`/api/payroll/noc-cases/${selectedId}/fnf-option`, { option });
      toast.success("Settlement route recorded");
      await loadDetail(selectedId);
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not set the settlement route");
    } finally { setBusy(null); }
  };

  const submitOverride = async () => {
    if (!detail || !overrideReason.trim()) {
      toast.warning("An override reason is required.");
      return;
    }
    setBusy("override");
    try {
      await hrmsApi.post(
        `/api/payroll/noc-cases/employee/${detail.nocCase.employee_id}/override`,
        { reason: overrideReason.trim() },
      );
      toast.success("Override recorded — salary release is unblocked for this employee");
      setOverrideOpen(false);
      setOverrideReason("");
      await refreshBoth();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not record the override");
    } finally { setBusy(null); }
  };

  const reopen = async () => {
    if (!selectedId) return;
    const reason = window.prompt("How was the decline resolved? This is recorded against the reopening.");
    if (!reason?.trim()) return;
    setBusy("reopen");
    try {
      await hrmsApi.post(`/api/payroll/noc-cases/${selectedId}/reopen`, { reason: reason.trim() });
      toast.success("NOC reopened");
      await refreshBoth();
    } catch (err) {
      toast.error((err as Error)?.message ?? "Could not reopen this NOC");
    } finally { setBusy(null); }
  };

  const c = detail?.nocCase;
  const overdue = useMemo(
    () => (detail?.signatories ?? []).filter(
      (s) => s.status === "pending" && s.sla_due_at && new Date(s.sla_due_at).getTime() < Date.now(),
    ).length,
    [detail],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mt-4 space-y-4">
      {/* ── Per-role board ── */}
      {/*
        Pending / Accepted / Declined per signatory role, across every open exit in scope. This is
        the SLA view: clicking a column filters the list to that role's queue, which is how a
        chase actually starts — "who is holding up eleven clearances" is a more useful question
        than "what is the status of this one leaver".
      */}
      {summary.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <h4 className="mb-3 text-sm font-bold text-slate-900">
              Clearance board
              <span className="ml-2 text-xs font-normal text-slate-500">
                open exits, by signatory role
              </span>
            </h4>
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {summary.map((r) => {
                const active = statusFilter !== "completed" && stageFilter === r.stage_key;
                return (
                  <button
                    key={r.stage_key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStageFilter(active ? "" : r.stage_key)}
                    className={`rounded-lg border px-2.5 py-2 text-left transition ${
                      active ? "border-blue-400 bg-blue-50 ring-1 ring-blue-200" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 truncate"
                      title={r.stage_label}>
                      {r.display_no}. {r.stage_label}
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-lg font-bold tabular-nums text-slate-900">{r.pending}</span>
                      <span className="text-[10px] text-slate-500">pending</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] font-medium">
                      <span className="text-emerald-700">{r.accepted} ok</span>
                      {Number(r.declined) > 0 && <span className="text-red-700">{r.declined} dec</span>}
                      {Number(r.sla_breached) > 0 && (
                        <span className="text-amber-700" title="Past SLA">
                          <Clock className="inline h-2.5 w-2.5" /> {r.sla_breached}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {stageFilter && (
              <p className="mt-2 text-xs text-slate-500">
                Filtered to pending <strong>{summary.find((s) => s.stage_key === stageFilter)?.stage_label}</strong> clearances.{" "}
                <button type="button" className="underline" onClick={() => setStageFilter("")}>Clear</button>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
      {/* ── Tracking list ── */}
      <Card className="h-fit">
        <CardContent className="pt-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Name or employee code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => void loadList()} aria-label="Refresh list">
              <RefreshCw className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="invited">Awaiting employee</SelectItem>
                <SelectItem value="employee_submitted">Form submitted</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={slaOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setSlaOnly((v) => !v)}
              className={slaOnly ? "bg-amber-600 hover:bg-amber-700" : ""}
            >
              <Clock className="h-3.5 w-3.5 mr-1" /> Overdue
            </Button>
          </div>

          <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
            {listLoading && (
              <div className="py-10 text-center text-sm text-slate-400">
                <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              </div>
            )}
            {!listLoading && rows.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">
                {slaOnly
                  ? "No clearance is past its SLA. Clear the Overdue filter to see the rest."
                  : search.trim()
                    ? `Nothing matches “${search.trim()}”.`
                    : "No NOC clearances in this view."}
              </div>
            )}
            {!listLoading && rows.map((r) => {
              const active = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 transition ${
                    active ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-slate-900 truncate">
                        {r.employee_name ?? "—"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.employee_code} {r.branch_name ? `· ${r.branch_name}` : ""}
                      </div>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-[10px] ${caseStatusClass(r.status)}`}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {/* Progress out of the real signatory count, not a hardcoded 8 — the template
                        is configurable and a stage could be deactivated. */}
                    <div className="h-1.5 flex-1 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${r.signatory_total ? (r.signatory_accepted / r.signatory_total) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                      {r.signatory_accepted}/{r.signatory_total}
                    </span>
                    {Number(r.signatory_sla_breached) > 0 && (
                      <span className="text-[11px] font-semibold text-amber-700" title="Signatories past SLA">
                        <Clock className="inline h-3 w-3" /> {r.signatory_sla_breached}
                      </span>
                    )}
                    {Number(r.signatory_declined) > 0 && (
                      <XCircle className="h-3.5 w-3.5 text-red-600" aria-label="Declined" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Case detail ── */}
      <div className="space-y-4">
        {!selectedId && (
          <Card><CardContent className="py-16 text-center text-sm text-slate-500">
            <FileCheck className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            Select a leaver on the left to see their clearance chain.
          </CardContent></Card>
        )}

        {selectedId && detailLoading && !detail && (
          <Card><CardContent className="py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
          </CardContent></Card>
        )}

        {c && detail && (
          <>
            {/* Header + identity */}
            <Card>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{c.employee_name}</h3>
                    <p className="text-xs text-slate-500">
                      {c.employee_code} · {c.location ?? "—"} · {c.designation ?? "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={caseStatusClass(c.status)}>
                      {c.status.replace(/_/g, " ")}
                    </Badge>
                    {c.override_at && (
                      <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">
                        <ShieldAlert className="h-3 w-3 mr-1" /> Overridden
                      </Badge>
                    )}
                    {/*
                      Available on any case, not only completed ones. A part-signed certificate is
                      exactly what someone needs to print and walk to a signatory who is holding it
                      up — restricting it to completed would remove the one use that needs paper.
                    */}
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => openCertificate(detail)}>
                      <Printer className="h-3.5 w-3.5 mr-1" /> Print record
                    </Button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-4 text-xs">
                  <Field label="Portfolio" value={c.portfolio} />
                  <Field label="Resignation date" value={c.resignation_date} />
                  <Field label="Form submitted" value={c.employee_submitted_at ? fmt(c.employee_submitted_at) : "Not yet"} />
                  <Field label="Signatories cleared" value={`${detail.progress.accepted} of ${detail.progress.total}`} />
                </div>

                {c.reason_for_leaving && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Reason for leaving</div>
                    <p className="mt-0.5 text-sm text-slate-700">{c.reason_for_leaving}</p>
                  </div>
                )}

                {c.status === "declined" && (
                  <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-red-900">
                        Declined at {c.declined_stage_key?.replace(/_/g, " ")} — locked pending HR resolution
                      </p>
                      <p className="text-xs text-red-800 mt-0.5">{c.decline_reason}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void reopen()} disabled={busy === "reopen"}>
                      Reopen
                    </Button>
                  </div>
                )}

                {c.override_at && (
                  <div className="mt-3 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2">
                    <p className="text-xs font-semibold text-purple-900">
                      Payroll Head override — salary release is unblocked without a completed clearance
                    </p>
                    <p className="text-xs text-purple-800 mt-0.5">{c.override_reason}</p>
                  </div>
                )}

                {/* HR: Last Working Day, and the invite */}
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
                  <div>
                    <label htmlFor="noc-lwd" className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Last Working Day (HR)
                    </label>
                    <Input
                      id="noc-lwd"
                      type="date"
                      className="mt-1 w-44"
                      value={lwd}
                      min={c.resignation_date ?? undefined}
                      onChange={(e) => setLwd(e.target.value)}
                    />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => void saveLwd()} disabled={!lwd || busy === "lwd"}>
                    Save LWD
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void sendInvite()} disabled={busy === "invite"}>
                    {c.employee_submitted_at ? "Resend form link" : "Send form link"}
                  </Button>

                  <div className="ml-auto">
                    <label htmlFor="noc-fnf" className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Settlement route {c.fnf_option_suggested && !c.fnf_option && (
                        <span className="font-normal normal-case text-slate-400">
                          (suggested: {FNF_LABELS[c.fnf_option_suggested] ?? c.fnf_option_suggested})
                        </span>
                      )}
                    </label>
                    <Select value={c.fnf_option ?? ""} onValueChange={(v) => void setFnf(v)}>
                      <SelectTrigger id="noc-fnf" className="mt-1 w-56">
                        <SelectValue placeholder="Not set — Finance decides" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FNF_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Signatory clearance */}
            <Card>
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900">
                    Signatory Clearance
                    <span className="ml-2 font-normal text-xs text-slate-500">
                      digitally captured — role, name, status, date
                    </span>
                  </h4>
                  {overdue > 0 && (
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                      <Clock className="h-3 w-3 mr-1" /> {overdue} overdue
                    </Badge>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      The eight NOC signatories in the order printed on the certificate, with each decision and timestamp
                    </caption>
                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 w-10">#</th>
                        <th scope="col" className="px-3 py-2">Role</th>
                        <th scope="col" className="px-3 py-2">Name</th>
                        <th scope="col" className="px-3 py-2 w-32">Status</th>
                        <th scope="col" className="px-3 py-2 w-40">Date</th>
                        <th scope="col" className="px-3 py-2 text-right w-56">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.signatories.map((s) => {
                        const badge = sigStatusBadge(s.status);
                        return (
                          <tr key={s.id} className={s.status === "declined" ? "bg-red-50/50" : undefined}>
                            <td className="px-3 py-2 text-slate-500">{s.display_no}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-900">{s.stage_label}</div>
                              <div className="text-[11px] text-slate-400">{s.role_key}</div>
                            </td>
                            <td className="px-3 py-2 text-slate-700">{s.acted_by_name ?? "—"}</td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                              {s.acted_at ? fmt(s.acted_at) : s.sla_due_at ? `Due ${fmt(s.sla_due_at)}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {s.status !== "pending" ? (
                                s.remarks
                                  ? <span className="text-xs text-slate-500 italic">{s.remarks}</span>
                                  : <CheckCircle2 className="inline h-4 w-4 text-emerald-500" />
                              ) : s.blocked ? (
                                // The server's reason, verbatim. A generic "not your turn" would
                                // hide the actionable cases — outstanding assets, missing LWD.
                                <span className="text-xs text-slate-400" title={s.blocked.message}>
                                  {s.blocked.code === "ASSETS_OUTSTANDING"
                                    ? "Blocked — property outstanding"
                                    : s.blocked.code === "LWD_NOT_SET"
                                      ? "Blocked — set the LWD"
                                      : s.blocked.code === "EMPLOYEE_FORM_PENDING"
                                        ? "Waiting on the employee"
                                        : "Waiting on earlier stages"}
                                </span>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button size="sm" className="h-7 bg-emerald-600 hover:bg-emerald-700 text-xs"
                                    onClick={() => { setDecision({ stageKey: s.stage_key, label: s.stage_label, kind: "accepted" }); setDecisionRemarks(""); }}>
                                    Accept
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs"
                                    onClick={() => { setDecision({ stageKey: s.stage_key, label: s.stage_label, kind: "acknowledged" }); setDecisionRemarks(""); }}>
                                    Ack
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                                    onClick={() => { setDecision({ stageKey: s.stage_key, label: s.stage_label, kind: "declined" }); setDecisionRemarks(""); }}>
                                    Decline
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Assets */}
            <Card>
              <CardContent className="pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-900">Company Property</h4>
                  {detail.assetGate.satisfied ? (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Finance not blocked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Finance blocked — {detail.assetGate.outstanding.length} item(s)
                    </Badge>
                  )}
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Company property, return status, and any waiver</caption>
                    <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 w-10">#</th>
                        <th scope="col" className="px-3 py-2">Item</th>
                        <th scope="col" className="px-3 py-2 w-16">Qty</th>
                        <th scope="col" className="px-3 py-2 w-64">Status</th>
                        <th scope="col" className="px-3 py-2 text-right w-28">Waiver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.assets.map((a) => (
                        <tr key={a.id}>
                          <td className="px-3 py-2 text-slate-500">{a.item_no}</td>
                          <td className="px-3 py-2">
                            <span className="font-medium text-slate-900">{a.item_label}</span>
                            {Number(a.is_mandatory_for_finance) === 1 && (
                              <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700" title="Blocks Finance sign-off until returned or waived">
                                required
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-600">{a.quantity ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {(["returned", "not_returned", "na"] as AssetStatus[]).map((st) => (
                                <Button
                                  key={st}
                                  size="sm"
                                  variant={a.status === st ? "default" : "outline"}
                                  className={`h-6 px-2 text-[11px] ${a.status === st && st === "returned" ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                                  disabled={busy === `asset:${a.item_code}`}
                                  onClick={() => void setAsset(a.item_code, st)}
                                >
                                  {st === "returned" ? "Returned" : st === "not_returned" ? "Not returned" : "N/A"}
                                </Button>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {a.waived_at ? (
                              <span className="text-[11px] text-purple-700 font-medium" title={a.waiver_reason ?? ""}>
                                Waived
                              </span>
                            ) : Number(a.is_mandatory_for_finance) === 1 && a.status !== "returned" ? (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]"
                                onClick={() => { setWaive({ itemCode: a.item_code, label: a.item_label }); setWaiveReason(""); }}>
                                Waive
                              </Button>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Override + timeline */}
            <div className="grid gap-4 lg:grid-cols-2">
              {canOverride && c.status !== "completed" && !c.override_at && (
                <Card className="border-purple-200">
                  <CardContent className="pt-5">
                    <h4 className="text-sm font-bold text-slate-900">Payroll Head override</h4>
                    <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                      Releases this employee's salary without a completed clearance. Recorded against
                      your name with the reason, and the case still shows as not signed — an override
                      is never presented as a clearance.
                    </p>
                    <Button size="sm" variant="outline" className="mt-3 border-purple-300 text-purple-700 hover:bg-purple-50"
                      onClick={() => setOverrideOpen(true)}>
                      <ShieldAlert className="h-3.5 w-3.5 mr-1" /> Override release
                    </Button>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardContent className="pt-5">
                  <h4 className="text-sm font-bold text-slate-900 mb-2">Timeline</h4>
                  <ol className="space-y-2 max-h-64 overflow-y-auto">
                    {detail.events.length === 0 && (
                      <li className="text-xs text-slate-400">No activity recorded yet.</li>
                    )}
                    {detail.events.map((ev, i) => (
                      <li key={`${ev.created_at}-${i}`} className="text-xs border-l-2 border-slate-200 pl-3">
                        <div className="font-medium text-slate-800">
                          {ev.action.replace(/_/g, " ")}
                          {ev.stage_key ? ` · ${ev.stage_key.replace(/_/g, " ")}` : ""}
                        </div>
                        <div className="text-slate-500">
                          {ev.actor_name ?? ev.actor_role ?? "system"} · {fmt(ev.created_at)}
                        </div>
                        {ev.reason && <div className="text-slate-600 italic mt-0.5">{ev.reason}</div>}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>

      </div>

      {/* ── Decision dialog ── */}
      <Dialog open={decision !== null} onOpenChange={(o) => { if (!o) setDecision(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decision?.kind === "declined" ? "Decline" : decision?.kind === "acknowledged" ? "Acknowledge" : "Accept"}
              {" — "}{decision?.label}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              {decision?.kind === "declined"
                ? "Declining locks this NOC and routes it to HR. The employee's salary and settlement stay withheld until it is resolved. A reason is required."
                : "Your name and the time will be recorded against this clearance as your digital signature."}
            </p>
            <Textarea
              rows={3}
              placeholder={decision?.kind === "declined" ? "Why can this not be cleared? (required)" : "Remarks (optional)"}
              value={decisionRemarks}
              onChange={(e) => setDecisionRemarks(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={busy === "decision"}>Cancel</Button>
            <Button
              className={decision?.kind === "declined" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}
              onClick={() => void submitDecision()}
              disabled={busy === "decision" || (decision?.kind === "declined" && !decisionRemarks.trim())}
            >
              {busy === "decision" ? "Recording…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Waiver dialog ── */}
      <Dialog open={waive !== null} onOpenChange={(o) => { if (!o) setWaive(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Waive — {waive?.label}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              A waiver lets Finance sign off on property the company has not got back. It is recorded
              against your name, so the reason needs to stand on its own later.
            </p>
            <Textarea rows={3} placeholder="Why is this item being waived? (required)"
              value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaive(null)} disabled={busy === "waive"}>Cancel</Button>
            <Button onClick={() => void submitWaive()} disabled={busy === "waive" || !waiveReason.trim()}>
              {busy === "waive" ? "Saving…" : "Record waiver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Override dialog ── */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Override NOC release</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              This releases <strong>{c?.employee_name}</strong>'s salary without a completed
              clearance. The reason below is the only record of why, so write it for whoever reads
              it in an audit rather than for yourself today.
            </p>
            <Textarea rows={3} placeholder="Why can this release not wait for the clearance? (required)"
              value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} disabled={busy === "override"}>Cancel</Button>
            <Button className="bg-purple-600 hover:bg-purple-700"
              onClick={() => void submitOverride()} disabled={busy === "override" || !overrideReason.trim()}>
              {busy === "override" ? "Recording…" : "Record override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-medium text-slate-900">{value?.toString().trim() || "—"}</div>
    </div>
  );
}
