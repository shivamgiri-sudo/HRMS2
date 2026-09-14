import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Bot, CheckCircle2, ChevronDown, ChevronRight, Clock,
  Code2, Cpu, FileCode2, Loader, RefreshCcw, ShieldAlert, Wand2,
  XCircle, BarChart2, Zap, MessageSquare,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type TriageStatus = "pending" | "diagnosed" | "rejected" | "error" | "unavailable";

interface ComplaintSummary {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  reporter_name: string;
  reporter_code: string | null;
  triage_status: TriageStatus;
  triage_category: string | null;
  triage_confidence: string | null;
  triage_actionable: boolean | null;
  triage_root_cause: string | null;
  triage_next_step: string | null;
  triaged_at: string | null;
  draft_count: number;
  latest_draft_status: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  from_status: string;
  to_status: string;
  remarks: string | null;
  performed_by: string;
  performed_at: string;
}

interface FixDraftRow {
  id: string;
  status: string;
  target_files: string[];
  diff_text: string;
  model: string | null;
  safety_flags: Array<{ file: string; reason: string }> | null;
  rejected_reason: string | null;
  test_output: string | null;
  created_at: string;
}

interface UsageRow {
  id: string;
  provider_key: string;
  model_name: string | null;
  request_source: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  success: boolean;
  safety_blocked: boolean;
  created_at: string;
}

interface ComplaintDetail {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  reporter_name: string;
  reporter_code: string | null;
  audit_log: AuditRow[];
  fix_drafts: FixDraftRow[];
  usage_log: UsageRow[];
}

interface Stats {
  total: number;
  pending_triage: number;
  diagnosed: number;
  with_drafts: number;
  resolved: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIAGE_STYLES: Record<TriageStatus, { label: string; bg: string; text: string; dot: string }> = {
  pending:     { label: "Awaiting Triage", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  diagnosed:   { label: "Diagnosed",       bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  rejected:    { label: "Safety Rejected", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  error:       { label: "Triage Failed",   bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  unavailable: { label: "AI Unavailable",  bg: "bg-slate-100", text: "text-slate-500", dot: "bg-slate-300" },
};

const CATEGORY_STYLES: Record<string, string> = {
  genuine_bug:         "bg-red-100 text-red-700",
  feature_request:     "bg-blue-100 text-blue-700",
  not_actionable:      "bg-slate-100 text-slate-600",
  needs_human_judgment: "bg-amber-100 text-amber-700",
};

const DRAFT_STATUS_STYLES: Record<string, string> = {
  drafted:   "bg-emerald-100 text-emerald-700",
  rejected:  "bg-red-100 text-red-700",
  deploying: "bg-amber-100 text-amber-700",
  deployed:  "bg-blue-100 text-blue-700",
  failed:    "bg-red-100 text-red-700",
};

const AUDIT_ACTION_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  mira_ai_triage:       { label: "AI Triage",       icon: Bot,         color: "text-blue-600" },
  mira_fix_draft_attempt: { label: "Fix Draft",    icon: Wand2,       color: "text-purple-600" },
  complete:             { label: "Completed",       icon: CheckCircle2, color: "text-emerald-600" },
  escalate:             { label: "Escalated",       icon: AlertTriangle, color: "text-amber-600" },
  reassign:             { label: "Reassigned",      icon: RefreshCcw,  color: "text-slate-600" },
};

function humanActorLabel(performed_by: string): string {
  if (performed_by === "system-mira-triage") return "Mira AI (Triage)";
  if (performed_by === "system-mira-fix-draft") return "Mira AI (Fix Draft)";
  return performed_by;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, gradient, icon: Icon }: { label: string; value: number; gradient: string; icon: React.ElementType }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 text-white shadow-lg`}>
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
      <Icon className="mb-2 h-5 w-5 opacity-80" />
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-semibold opacity-80">{label}</p>
    </div>
  );
}

// ── Fix Draft Viewer ──────────────────────────────────────────────────────────

function FixDraftViewer({ draft }: { draft: FixDraftRow }) {
  const [open, setOpen] = useState(false);
  const s = DRAFT_STATUS_STYLES[draft.status] ?? "bg-slate-100 text-slate-600";

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileCode2 className="h-4 w-4 text-slate-400 shrink-0" />
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${s}`}>{draft.status}</span>
          {draft.model && <span className="text-xs text-slate-400">via {draft.model}</span>}
          <span className="text-xs text-slate-400">{formatIST(draft.created_at)}</span>
          {draft.target_files.length > 0 && (
            <span className="text-xs text-slate-500 truncate">{draft.target_files.join(", ")}</span>
          )}
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 space-y-3">
          {draft.status === "rejected" && draft.rejected_reason && (
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Safety Guard Rejection</p>
                <p className="mt-0.5 text-xs">{draft.rejected_reason}</p>
                {draft.safety_flags && draft.safety_flags.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {draft.safety_flags.map((f, i) => (
                      <li key={i} className="text-xs">
                        <code className="bg-red-100 px-1 rounded">{f.file}</code>: {f.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {draft.diff_text && (
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Proposed Diff</p>
              <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-100 font-mono">
                {draft.diff_text}
              </pre>
              <p className="mt-1.5 text-[10px] text-slate-400">
                Review-only — no deploy path exists. This diff is not applied automatically and requires explicit human approval.
              </p>
            </div>
          )}

          {draft.test_output && (
            <div>
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Test Output</p>
              <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] text-slate-100 font-mono">
                {draft.test_output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Audit Timeline ────────────────────────────────────────────────────────────

function AuditTimeline({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-slate-400">No audit events yet.</p>;

  return (
    <ol className="relative ml-3 border-l border-slate-200 space-y-4">
      {rows.map((row) => {
        const meta = AUDIT_ACTION_LABELS[row.action] ?? { label: row.action, icon: Bot, color: "text-slate-500" };
        const Icon = meta.icon;
        return (
          <li key={row.id} className="ml-5">
            <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full border-2 border-white bg-slate-300" />
            <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                  <span className="text-xs font-bold text-slate-700">{meta.label}</span>
                </div>
                <span className="text-[10px] text-slate-400">{formatIST(row.performed_at)}</span>
              </div>
              <p className="text-[10px] text-slate-400 mb-1">by {humanActorLabel(row.performed_by)}</p>
              {row.remarks && (
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{row.remarks}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Complaint Detail Panel ────────────────────────────────────────────────────

function ComplaintDetailPanel({
  complaint,
  onRetriage,
  onGenerateDraft,
}: {
  complaint: ComplaintSummary;
  onRetriage: (id: string) => Promise<void>;
  onGenerateDraft: (id: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [retriaging, setRetriaging] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ComplaintDetail }>(`/api/ai/complaints/${complaint.id}`);
      setDetail(res.data ?? null);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [complaint.id]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  const handleRetriage = async () => {
    setRetriaging(true);
    setActionMsg(null);
    try {
      await onRetriage(complaint.id);
      setActionMsg("Triage re-run complete.");
      void loadDetail();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Retriage failed");
    } finally {
      setRetriaging(false);
    }
  };

  const handleDraft = async () => {
    setDrafting(true);
    setActionMsg(null);
    try {
      await onGenerateDraft(complaint.id);
      setActionMsg("Fix draft generation triggered.");
      setTimeout(() => void loadDetail(), 2000);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Draft generation failed");
    } finally {
      setDrafting(false);
    }
  };

  const ts = TRIAGE_STYLES[complaint.triage_status];
  const totalTokens = detail?.usage_log.reduce((s, u) => s + u.input_tokens + u.output_tokens, 0) ?? 0;
  const totalLatency = detail?.usage_log.reduce((s, u) => s + u.latency_ms, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Complaint header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-400 mb-1">Complaint Text</p>
            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">{complaint.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${ts.bg} ${ts.text}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${ts.dot}`} />
            {ts.label}
          </span>
          {complaint.triage_category && (
            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${CATEGORY_STYLES[complaint.triage_category] ?? "bg-slate-100 text-slate-600"}`}>
              {complaint.triage_category.replace(/_/g, " ")}
            </span>
          )}
          {complaint.triage_confidence && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-600 capitalize">
              {complaint.triage_confidence} confidence
            </span>
          )}
          {complaint.triage_actionable === true && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">Actionable</span>
          )}
          {complaint.triage_actionable === false && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">Not Actionable</span>
          )}
        </div>
      </div>

      {/* AI Diagnosis */}
      {(complaint.triage_root_cause || complaint.triage_next_step) && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-blue-600" />
            <p className="text-xs font-black uppercase tracking-widest text-blue-600">AI Diagnosis</p>
          </div>
          {complaint.triage_root_cause && (
            <div>
              <p className="text-[10px] font-bold uppercase text-blue-400 mb-1">Root Cause Hypothesis</p>
              <p className="text-sm text-blue-900 leading-relaxed">{complaint.triage_root_cause}</p>
            </div>
          )}
          {complaint.triage_next_step && (
            <div>
              <p className="text-[10px] font-bold uppercase text-blue-400 mb-1">Suggested Next Step</p>
              <p className="text-sm text-blue-900 leading-relaxed">{complaint.triage_next_step}</p>
            </div>
          )}
          {complaint.triaged_at && (
            <p className="text-[10px] text-blue-400">Diagnosed {formatIST(complaint.triaged_at)}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {(complaint.triage_status === "error" || complaint.triage_status === "unavailable" || complaint.triage_status === "pending") && (
          <button
            onClick={handleRetriage}
            disabled={retriaging}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {retriaging ? <Loader className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {retriaging ? "Running Triage…" : "Run Triage Now"}
          </button>
        )}
        {complaint.triage_status === "diagnosed" && complaint.triage_actionable && complaint.triage_category === "genuine_bug" && (
          <button
            onClick={handleDraft}
            disabled={drafting}
            className="inline-flex items-center gap-2 rounded-xl bg-purple-700 px-4 py-2 text-sm font-bold text-white hover:bg-purple-600 disabled:opacity-50 transition-colors"
          >
            {drafting ? <Loader className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {drafting ? "Generating Draft…" : "Generate Fix Draft"}
          </button>
        )}
      </div>

      {actionMsg && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">{actionMsg}</div>
      )}

      {/* Token / Latency Usage */}
      {detail && detail.usage_log.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">AI Resource Usage</p>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Total Tokens</p>
              <p className="text-lg font-black text-slate-900">{totalTokens.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] text-slate-400 font-bold uppercase">Total Latency</p>
              <p className="text-lg font-black text-slate-900">{(totalLatency / 1000).toFixed(1)}s</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] text-slate-400 font-bold uppercase">API Calls</p>
              <p className="text-lg font-black text-slate-900">{detail.usage_log.length}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {detail.usage_log.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs bg-slate-50">
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="font-semibold text-slate-700 truncate">{u.request_source.replace(/_/g, " ")}</span>
                  <span className="text-slate-400">{u.provider_key}{u.model_name ? ` / ${u.model_name}` : ""}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-slate-500">
                  <span>{(u.input_tokens + u.output_tokens).toLocaleString()} tok</span>
                  <span>{u.latency_ms}ms</span>
                  {u.safety_blocked && <span className="text-amber-600 font-bold">blocked</span>}
                  {!u.success && !u.safety_blocked && <span className="text-red-600 font-bold">failed</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix Drafts */}
      {detail && detail.fix_drafts.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Fix Drafts ({detail.fix_drafts.length})
          </p>
          <div className="space-y-2">
            {detail.fix_drafts.map((d) => <FixDraftViewer key={d.id} draft={d} />)}
          </div>
          <p className="mt-3 text-[10px] text-slate-400">
            AI-authored diffs shown for human review only. No path exists to auto-apply any diff.
          </p>
        </div>
      )}

      {/* Full Audit Trail */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : detail ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Full Audit Trail ({detail.audit_log.length} events)
          </p>
          <AuditTimeline rows={detail.audit_log} />
        </div>
      ) : null}
    </div>
  );
}

// ── Complaint Row ─────────────────────────────────────────────────────────────

function ComplaintRow({
  complaint,
  selected,
  onClick,
}: {
  complaint: ComplaintSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const ts = TRIAGE_STYLES[complaint.triage_status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition-all ${
        selected ? "border-blue-300 bg-blue-50 shadow-md" : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-bold text-slate-900 leading-snug line-clamp-2 text-sm flex-1">{complaint.title}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${ts.bg} ${ts.text}`}>
          {ts.label}
        </span>
      </div>
      <p className="text-xs text-slate-500 line-clamp-2 mb-2">{complaint.description}</p>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
        <span>{complaint.reporter_name}{complaint.reporter_code ? ` (${complaint.reporter_code})` : ""}</span>
        <span>·</span>
        <span>{formatIST(complaint.created_at)}</span>
        {complaint.triage_category && (
          <>
            <span>·</span>
            <span className={`rounded-full px-1.5 py-0.5 capitalize ${CATEGORY_STYLES[complaint.triage_category] ?? "bg-slate-100 text-slate-600"}`}>
              {complaint.triage_category.replace(/_/g, " ")}
            </span>
          </>
        )}
        {complaint.draft_count > 0 && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <Code2 className="h-3 w-3" />
              {complaint.draft_count} draft{complaint.draft_count > 1 ? "s" : ""}
              {complaint.latest_draft_status && (
                <span className={`rounded-full px-1.5 py-0.5 ${DRAFT_STATUS_STYLES[complaint.latest_draft_status] ?? "bg-slate-100 text-slate-600"}`}>
                  {complaint.latest_draft_status}
                </span>
              )}
            </span>
          </>
        )}
      </div>
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type FilterKey = "all" | TriageStatus;

export default function MiraComplaintsPage() {
  const [complaints, setComplaints] = useState<ComplaintSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ComplaintSummary | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageMsg, setTriageMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listRes, statsRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: ComplaintSummary[] }>("/api/ai/complaints"),
        hrmsApi.get<{ success: boolean; data: Stats }>("/api/ai/complaints/stats"),
      ]);
      setComplaints(listRes.data ?? []);
      setStats(statsRes.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load complaints");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runTriageAll = useCallback(async () => {
    setTriageRunning(true);
    setTriageMsg(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { processed: number; outcomes: Record<string, number> } }>(
        "/api/ai/triage/run",
      );
      const { processed, outcomes } = res.data ?? res as unknown as { processed: number; outcomes: Record<string, number> };
      if (processed === 0) {
        setTriageMsg("All complaints are already triaged.");
      } else {
        const parts = Object.entries(outcomes).map(([k, v]) => `${v} ${k}`).join(", ");
        setTriageMsg(`Triaged ${processed}: ${parts}`);
      }
      void load();
    } catch (e) {
      setTriageMsg(e instanceof Error ? e.message : "Triage run failed");
    } finally {
      setTriageRunning(false);
    }
  }, [load]);

  const handleRetriage = async (id: string) => {
    await hrmsApi.post(`/api/ai/complaints/${id}/retriage`, {});
    void load();
  };

  const handleGenerateDraft = async (id: string) => {
    await hrmsApi.post(`/api/inbox/mira-fix-draft/${id}/generate`, {});
  };

  const filtered = filter === "all" ? complaints : complaints.filter((c) => c.triage_status === filter);

  const FILTERS: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: "All" },
    { key: "pending", label: "Awaiting Triage" },
    { key: "diagnosed", label: "Diagnosed" },
    { key: "rejected", label: "Safety Rejected" },
    { key: "error", label: "Triage Failed" },
    { key: "unavailable", label: "AI Unavailable" },
  ];

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        {/* Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 p-8 text-white shadow-2xl">
          <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Bot className="h-3 w-3" /> Mira AI Pipeline
              </div>
              <h1 className="text-4xl font-black tracking-tight">Complaint Intelligence</h1>
              <p className="mt-1 text-indigo-200 text-sm">All Mira complaints — triage diagnosis, AI fix drafts, full audit trail</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <button
                  onClick={() => void runTriageAll()}
                  disabled={triageRunning}
                  className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600/80 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-indigo-600 transition-all disabled:opacity-50"
                >
                  {triageRunning ? <Loader className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {triageRunning ? "Triaging…" : "Triage All Pending"}
                </button>
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              {triageMsg && <p className="text-xs text-indigo-200 text-right max-w-xs">{triageMsg}</p>}
            </div>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
            <StatCard label="Total Complaints" value={stats.total} gradient="from-slate-700 to-slate-800" icon={MessageSquare} />
            <StatCard label="Awaiting Triage" value={stats.pending_triage} gradient="from-amber-500 to-orange-600" icon={Clock} />
            <StatCard label="Diagnosed" value={stats.diagnosed} gradient="from-blue-600 to-indigo-700" icon={Bot} />
            <StatCard label="With Fix Drafts" value={stats.with_drafts} gradient="from-purple-600 to-violet-700" icon={Code2} />
            <StatCard label="Resolved" value={stats.resolved} gradient="from-emerald-500 to-teal-600" icon={CheckCircle2} />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = f.key === "all" ? complaints.length : complaints.filter((c) => c.triage_status === f.key).length;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ${
                  filter === f.key ? "bg-slate-950 text-white shadow" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {f.label} <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Two-column layout: list + detail */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
          {/* Left: complaint list */}
          <div className="space-y-3 min-h-0">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-slate-400">
                <BarChart2 className="mb-3 h-8 w-8 opacity-30" />
                <p className="font-semibold text-sm">No complaints</p>
              </div>
            ) : (
              filtered.map((c) => (
                <ComplaintRow
                  key={c.id}
                  complaint={c}
                  selected={selected?.id === c.id}
                  onClick={() => setSelected(c)}
                />
              ))
            )}
          </div>

          {/* Right: detail */}
          <div>
            {selected ? (
              <ComplaintDetailPanel
                key={selected.id}
                complaint={selected}
                onRetriage={handleRetriage}
                onGenerateDraft={handleGenerateDraft}
              />
            ) : (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-24 text-slate-400">
                <XCircle className="mb-3 h-8 w-8 opacity-20" />
                <p className="font-semibold text-sm">Select a complaint to view details</p>
                <p className="mt-1 text-xs">Triage diagnosis, AI fix drafts, and full audit trail appear here</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}
