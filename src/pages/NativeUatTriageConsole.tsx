/**
 * UAT triage console.
 *
 * The reviewer-facing half of the governance platform. Its job is to make the risk verdict
 * explainable: not "blocked", but which dimension fired, on what signal, and what token
 * matched. A control whose decisions cannot be interrogated gets overridden.
 *
 * Failures are shown loudly and at the top — the dominant defect class in this codebase is
 * the one nobody notices, so anything stuck or overdue is a banner, not a column.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Clock, Loader, RefreshCcw, ShieldAlert, ShieldCheck, User,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

interface Aging {
  ageMins: number;
  overdue: boolean;
  minutesRemaining: number | null;
}

interface FeedbackItem {
  id: string;
  feedback_code: string;
  title: string;
  kind: string;
  severity: string;
  priority: string;
  status: string;
  risk_tier: string | null;
  capability_class: string | null;
  assigned_to: string | null;
  affected_user_count: number;
  created_at: string;
  aging?: Aging;
}

interface CapabilityHit {
  capabilityKey: string;
  capabilityName: string;
  class: string;
  signal: string;
  matchedToken: string;
  reason: string;
}

interface ProtectedHit {
  path: string;
  pattern: string;
  tier: string;
  category: string;
  reason: string;
}

interface ScanRow {
  risk_tier: string;
  capability_class: string;
  effective_risk: string;
  resolver_mode: string;
  reverse_dep_max: number;
  duration_ms: number;
  scanner_version: string;
  protected_hits_json: ProtectedHit[] | string;
  capability_hits_json: CapabilityHit[] | string;
  impacted_paths_json: unknown;
}

const RISK_STYLES: Record<string, string> = {
  deny: "bg-red-100 text-red-800 border-red-300",
  review: "bg-amber-100 text-amber-800 border-amber-300",
  standard: "bg-sky-100 text-sky-800 border-sky-300",
  trivial: "bg-slate-100 text-slate-700 border-slate-300",
};

const STATUS_COLUMNS = [
  { key: "scan_blocked", label: "Needs a person" },
  { key: "scan_done", label: "Triage" },
  { key: "triaged", label: "In progress" },
  { key: "ready_for_retest", label: "Awaiting retest" },
  { key: "production_released", label: "Released" },
];

function parseJson<T>(v: T | string | null | undefined, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** One row of uat_checklist_evaluation, as the API returns it. */
interface EvaluationRow {
  item_key: string;
  verdict: "pass" | "fail" | "warn" | "not_applicable" | "undetermined";
  source: "floor" | "capability" | "static" | "llm" | "human" | "db";
  evidence: string | null;
  confidence: number | null;
  rule_version: number | null;
  rule_snapshot_sha256: string | null;
}

interface LlmCallRow {
  stage: string;
  model_id: string;
  model_version: string | null;
  effort: string | null;
  attempt_no: number;
  schema_valid: number;
  stop_reason: string | null;
  refusal_category: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd_micros: number | null;
  latency_ms: number | null;
  error_message: string | null;
  prompt_template_version: string;
  created_at: string;
}

const VERDICT_STYLES: Record<EvaluationRow["verdict"], string> = {
  fail: "border-red-300 bg-red-50 text-red-800",
  warn: "border-amber-300 bg-amber-50 text-amber-800",
  // Deliberately NOT green. An item nobody could evaluate is outstanding work, and colouring
  // it like a pass is how a reviewer comes away believing the checklist cleared it.
  undetermined: "border-slate-300 bg-slate-100 text-slate-700",
  pass: "border-emerald-300 bg-emerald-50 text-emerald-800",
  not_applicable: "border-slate-200 bg-white text-slate-500",
};

/**
 * Floor and capability verdicts are rendered locked. The distinction is not decorative: a
 * reviewer needs to know which verdicts came from the reviewed JSON control plane and which
 * came from a DB rule or the model, because only the latter two are arguable.
 */
const AUTHORITATIVE: ReadonlySet<EvaluationRow["source"]> = new Set(["floor", "capability"]);

export default function NativeUatTriageConsole() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([]);
  const [llmCalls, setLlmCalls] = useState<LlmCallRow[]>([]);
  const [evaluating, setEvaluating] = useState(false);
  const [evalNotice, setEvalNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ data: FeedbackItem[] }>("/api/uat/feedback?limit=200");
      setItems(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load UAT feedback.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openItem = useCallback(async (item: FeedbackItem) => {
    setSelected(item);
    setScan(null);
    setEvaluations([]);
    setLlmCalls([]);
    setEvalNotice(null);
    setScanLoading(true);
    try {
      // Settled, not all: a missing checklist is normal for an item that has not been
      // evaluated yet, and failing the whole drawer over it would hide the scan too.
      const [scanRes, checklistRes, callsRes] = await Promise.allSettled([
        hrmsApi.get<{ data: ScanRow | null }>(`/api/uat/feedback/${item.id}/scan`),
        hrmsApi.get<{ data: { evaluations: EvaluationRow[] } }>(
          `/api/uat/feedback/${item.id}/checklist`
        ),
        hrmsApi.get<{ data: LlmCallRow[] }>(`/api/uat/feedback/${item.id}/llm-calls`),
      ]);
      setScan(scanRes.status === "fulfilled" ? (scanRes.value.data ?? null) : null);
      setEvaluations(
        checklistRes.status === "fulfilled" ? (checklistRes.value.data?.evaluations ?? []) : []
      );
      setLlmCalls(callsRes.status === "fulfilled" ? (callsRes.value.data ?? []) : []);
    } finally {
      setScanLoading(false);
    }
  }, []);

  const evaluate = useCallback(async (item: FeedbackItem) => {
    setEvaluating(true);
    setEvalNotice(null);
    try {
      const res = await hrmsApi.post<{ data: { queued: boolean; message: string } }>(
        `/api/uat/feedback/${item.id}/evaluate`,
        {}
      );
      setEvalNotice(res.data?.message ?? "Queued for evaluation.");
    } catch (e) {
      // Surfaced, not swallowed: the state machine refuses an item in the wrong status, and
      // that refusal is the answer the user needs rather than a silent no-op.
      setEvalNotice(e instanceof Error ? e.message : "Could not queue this item for evaluation.");
    } finally {
      setEvaluating(false);
    }
  }, []);

  const overdue = useMemo(() => items.filter((i) => i.aging?.overdue), [items]);
  const blocked = useMemo(() => items.filter((i) => i.status === "scan_blocked"), [items]);

  const byStatus = useMemo(() => {
    const map = new Map<string, FeedbackItem[]>();
    for (const col of STATUS_COLUMNS) map.set(col.key, []);
    const other: FeedbackItem[] = [];
    for (const i of items) {
      const bucket = map.get(i.status);
      if (bucket) bucket.push(i);
      else other.push(i);
    }
    return { map, other };
  }, [items]);

  const capabilityHits = parseJson<CapabilityHit[]>(scan?.capability_hits_json, []);
  const protectedHits = parseJson<ProtectedHit[]>(scan?.protected_hits_json, []);

  return (
    <DashboardLayout>
      <div className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">UAT triage</h1>
            <p className="mt-1 text-sm text-slate-600">
              {items.length} item{items.length === 1 ? "" : "s"} in scope
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Loud, not subtle. */}
        {(overdue.length > 0 || blocked.length > 0) && (
          <div className="mt-4 space-y-2">
            {overdue.length > 0 && (
              <div className="flex items-center gap-2 rounded border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-800">
                <Clock className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{overdue.length}</strong> item{overdue.length === 1 ? " is" : "s are"} past
                  the SLA deadline.
                </span>
              </div>
            )}
            {blocked.length > 0 && (
              <div className="flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>
                  <strong>{blocked.length}</strong> item{blocked.length === 1 ? "" : "s"} require an
                  engineer and will never be automated.
                </span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="mt-10 flex justify-center">
            <Loader className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-5">
            {STATUS_COLUMNS.map((col) => {
              const bucket = byStatus.map.get(col.key) ?? [];
              return (
                <div key={col.key} className="rounded-lg border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2">
                    <h2 className="text-sm font-semibold text-slate-800">{col.label}</h2>
                    <p className="text-xs text-slate-500">{bucket.length}</p>
                  </div>
                  <div className="space-y-2 p-2">
                    {bucket.map((i) => (
                      <button
                        key={i.id}
                        onClick={() => void openItem(i)}
                        className="w-full rounded border border-slate-200 bg-white p-3 text-left hover:border-slate-400"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-xs text-slate-500">{i.feedback_code}</span>
                          {i.risk_tier && (
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                                RISK_STYLES[i.risk_tier] ?? RISK_STYLES.trivial
                              }`}
                            >
                              {i.risk_tier}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm font-medium text-slate-800">
                          {i.title}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="uppercase">{i.priority}</span>
                          <span>·</span>
                          <span>{i.severity}</span>
                          {i.affected_user_count > 1 && (
                            <>
                              <span>·</span>
                              <span className="inline-flex items-center gap-0.5">
                                <User className="h-3 w-3" />
                                {i.affected_user_count}
                              </span>
                            </>
                          )}
                          {i.aging?.overdue && (
                            <>
                              <span>·</span>
                              <span className="font-medium text-red-600">overdue</span>
                            </>
                          )}
                        </div>
                      </button>
                    ))}
                    {bucket.length === 0 && (
                      <p className="px-2 py-4 text-center text-xs text-slate-400">Nothing here</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {byStatus.other.length > 0 && (
          <p className="mt-4 text-xs text-slate-500">
            {byStatus.other.length} item{byStatus.other.length === 1 ? "" : "s"} in other states
            (closed, rejected, in review).
          </p>
        )}

        {/* Detail drawer */}
        {selected && (
          <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={() => setSelected(null)}>
            <div
              className="h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-xs text-slate-500">{selected.feedback_code}</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">{selected.title}</h2>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">{selected.status}</span>
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">{selected.kind}</span>
                <span className="rounded bg-slate-100 px-2 py-1 text-slate-700">{selected.severity}</span>
                {selected.risk_tier && (
                  <span className={`rounded border px-2 py-1 ${RISK_STYLES[selected.risk_tier]}`}>
                    path: {selected.risk_tier}
                  </span>
                )}
                {selected.capability_class && (
                  <span className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700">
                    capability: {selected.capability_class}
                  </span>
                )}
              </div>

              <h3 className="mt-6 text-sm font-semibold text-slate-800">Why it was classified this way</h3>
              {scanLoading ? (
                <Loader className="mt-3 h-4 w-4 animate-spin text-slate-400" />
              ) : !scan ? (
                <p className="mt-2 text-sm text-slate-500">No scan record.</p>
              ) : (
                <div className="mt-3 space-y-4">
                  {protectedHits.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                        Protected paths ({protectedHits.length})
                      </p>
                      <ul className="mt-1 space-y-1.5">
                        {protectedHits.slice(0, 6).map((h, idx) => (
                          <li key={`${h.path}-${idx}`} className="rounded border border-red-200 bg-red-50 p-2 text-xs">
                            <p className="font-mono text-red-900">{h.path}</p>
                            <p className="mt-0.5 text-red-800">{h.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {capabilityHits.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Business capabilities ({capabilityHits.length})
                      </p>
                      <ul className="mt-1 space-y-1.5">
                        {capabilityHits.map((h, idx) => (
                          <li
                            key={`${h.capabilityKey}-${h.signal}-${idx}`}
                            className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-800">{h.capabilityName}</span>
                              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                {h.class}
                              </span>
                            </div>
                            <p className="mt-1 text-slate-600">
                              matched on <span className="font-medium">{h.signal}</span>{" "}
                              &ldquo;{h.matchedToken}&rdquo;
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                      <span>
                        scanner {scan.scanner_version} · resolver {scan.resolver_mode} · max fan-in{" "}
                        {scan.reverse_dep_max} · {scan.duration_ms}ms
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Checklist ───────────────────────────────────────────── */}
              <div className="mt-6 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Checklist</h3>
                <button
                  onClick={() => void evaluate(selected)}
                  disabled={evaluating}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {evaluating ? "Queueing…" : evaluations.length ? "Re-evaluate" : "Evaluate"}
                </button>
              </div>

              {evalNotice && (
                <p className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  {evalNotice}
                </p>
              )}

              {evaluations.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  Not evaluated yet. Evaluation is advisory — it explains and recommends, and a
                  human still decides.
                </p>
              ) : (
                <>
                  <ul className="mt-3 space-y-1.5">
                    {evaluations.map((e) => (
                      <li
                        key={e.item_key}
                        className={`rounded border p-2 text-xs ${VERDICT_STYLES[e.verdict]}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium">{e.item_key}</span>
                          <span className="flex items-center gap-1.5">
                            {AUTHORITATIVE.has(e.source) && (
                              <span
                                className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                                title="From the reviewed control-plane files. A database rule cannot loosen this."
                              >
                                locked
                              </span>
                            )}
                            <span className="text-[10px] uppercase tracking-wide opacity-70">
                              {e.source}
                            </span>
                            <span className="font-semibold">{e.verdict}</span>
                          </span>
                        </div>
                        {e.evidence && <p className="mt-1 opacity-90">{e.evidence}</p>}
                      </li>
                    ))}
                  </ul>
                  {/* Which rules produced this, so a six-month-old decision stays explainable. */}
                  <p className="mt-2 font-mono text-[10px] text-slate-400">
                    rules v
                    {[...new Set(evaluations.map((e) => e.rule_version).filter(Boolean))].join(", ") ||
                      "—"}{" "}
                    · snapshot {evaluations[0]?.rule_snapshot_sha256?.slice(0, 12) ?? "—"}
                  </p>
                </>
              )}

              {/* ── Model calls ─────────────────────────────────────────── */}
              {llmCalls.length > 0 && (
                <>
                  <h3 className="mt-6 text-sm font-semibold text-slate-800">Model calls</h3>
                  <ul className="mt-2 space-y-1.5">
                    {llmCalls.map((c, idx) => (
                      <li
                        key={`${c.created_at}-${idx}`}
                        className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-600"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-slate-800">{c.stage}</span>
                          <span>·</span>
                          {/* model_version is what the API actually served — with server-side
                              fallback on, that can differ from the model we asked for. */}
                          <span className="font-mono">{c.model_version || c.model_id}</span>
                          {c.effort && <span>· effort {c.effort}</span>}
                          <span>· attempt {c.attempt_no}</span>
                          {c.stop_reason && <span>· {c.stop_reason}</span>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 text-slate-500">
                          <span>
                            {c.input_tokens ?? 0} in / {c.output_tokens ?? 0} out
                          </span>
                          {c.cache_read_tokens ? <span>· {c.cache_read_tokens} cached</span> : null}
                          <span>
                            ·{" "}
                            {c.cost_usd_micros == null
                              ? "unpriced"
                              : `$${(c.cost_usd_micros / 1_000_000).toFixed(4)}`}
                          </span>
                          {c.latency_ms != null && <span>· {c.latency_ms}ms</span>}
                          <span>· {c.prompt_template_version}</span>
                        </div>
                        {(c.error_message || c.refusal_category) && (
                          <p className="mt-1 text-red-700">
                            {c.refusal_category ? `refused (${c.refusal_category})` : c.error_message}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
