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

export default function NativeUatTriageConsole() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [scan, setScan] = useState<ScanRow | null>(null);
  const [scanLoading, setScanLoading] = useState(false);

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
    setScanLoading(true);
    try {
      const res = await hrmsApi.get<{ data: ScanRow | null }>(`/api/uat/feedback/${item.id}/scan`);
      setScan(res.data ?? null);
    } catch {
      setScan(null);
    } finally {
      setScanLoading(false);
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
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
