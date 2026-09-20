/**
 * Payroll HR's queue for fraud alerts raised during candidate onboarding.
 *
 * Reworked to be read at a glance: every candidate is one card that says, in words,
 * what looks wrong; blocking cases come first and oldest first; picking one opens the
 * review beside the list (photos, side-by-side facts, one clear decision).
 *
 * What has not changed: the endpoints, the statuses an alert can end in, and the fact
 * that an unresolved critical or high alert stops approval and employee creation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { FraudComparisonPanel } from "@/components/ats/FraudComparisonPanel";
import { hrmsApi } from "@/lib/hrmsApi";
import { alertShort, alertTitle, isBlocking, isUnresolved, waitingText } from "@/lib/fraudReview";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Search, ShieldAlert, X } from "lucide-react";

interface FraudAlert {
  id: string;
  candidate_id: string;
  candidate_name?: string | null;
  matched_candidate_name?: string | null;
  applied_for_branch?: string | null;
  alert_type: string;
  severity: string;
  status: string;
  created_at?: string | null;
}

interface StatRow {
  alert_type: string;
  status: string;
  count: number;
}

type Tab = "todo" | "done";
type Kind = "all" | "block" | "wait";

const PAGE_SIZE = 100; // matches the backend's LIMIT 100

interface CandidateGroup {
  candidateId: string;
  name: string;
  branch: string | null;
  alerts: FraudAlert[];
  blocking: boolean;
  oldest: string;
  headline: string;
  extra: number;
}

function groupByCandidate(alerts: FraudAlert[]): CandidateGroup[] {
  const map = new Map<string, FraudAlert[]>();
  for (const a of alerts) {
    const list = map.get(a.candidate_id) ?? [];
    list.push(a);
    map.set(a.candidate_id, list);
  }
  const groups = [...map.entries()].map(([candidateId, list]): CandidateGroup => {
    const primary = list.find(isBlocking) ?? list[0];
    const dates = list.map((a) => String(a.created_at ?? "")).filter(Boolean).sort();
    return {
      candidateId,
      name: primary.candidate_name ?? candidateId,
      branch: primary.applied_for_branch ?? null,
      alerts: list,
      blocking: list.some(isBlocking),
      oldest: dates[0] ?? "",
      headline: alertTitle(primary.alert_type, primary.matched_candidate_name),
      extra: list.length - 1,
    };
  });
  // Blocking first, then the longest-waiting first.
  return groups.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.oldest.localeCompare(b.oldest));
}

export default function NativeFraudAlertReview() {
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("todo");
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState<StatRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (which: Tab, off: number) => {
    setLoading(true);
    setError("");
    try {
      const get = (status: string) =>
        hrmsApi.get<{ alerts: FraudAlert[] }>(`/api/ats/fraud-alerts?status=${encodeURIComponent(status)}&offset=${off}`);
      if (which === "todo") {
        const [open, review] = await Promise.all([get("open"), get("under_review")]);
        setAlerts([...(open?.alerts ?? []), ...(review?.alerts ?? [])]);
      } else {
        const all = await get("all");
        setAlerts((all?.alerts ?? []).filter((a) => !isUnresolved(a)));
      }
    } catch {
      setError("Could not load the alert queue. Please refresh, or contact IT if it persists.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ stats: StatRow[] }>("/api/ats/fraud-alerts/stats");
      setStats(res?.stats ?? []);
    } catch {
      setStats(null); // The summary is optional; the queue still works without it.
    }
  }, []);

  useEffect(() => { void load(tab, offset); }, [load, tab, offset]);
  useEffect(() => { void loadStats(); }, [loadStats]);

  const refresh = () => { void load(tab, offset); void loadStats(); };

  const term = search.trim().toLowerCase();
  const groups = useMemo(() => {
    return groupByCandidate(alerts).filter((g) => {
      if (tab === "todo" && kind === "block" && !g.blocking) return false;
      if (tab === "todo" && kind === "wait" && g.blocking) return false;
      if (!term) return true;
      return `${g.name} ${g.branch ?? ""} ${g.headline}`.toLowerCase().includes(term);
    });
  }, [alerts, tab, kind, term]);

  // Keep something selected so the review is never an empty pane.
  useEffect(() => {
    if (!groups.length) { setSelectedId(null); return; }
    if (!selectedId || !groups.some((g) => g.candidateId === selectedId)) setSelectedId(groups[0].candidateId);
  }, [groups, selectedId]);

  const selected = groups.find((g) => g.candidateId === selectedId) ?? null;
  const blockingCount = groupByCandidate(alerts).filter((g) => g.blocking).length;
  const doneCount = (stats ?? [])
    .filter((s) => !["open", "under_review"].includes(s.status))
    .reduce((n, s) => n + Number(s.count ?? 0), 0);

  const pick = (id: string) => {
    setSelectedId(id);
    // On a phone the review sits under the list; bring it into view.
    if (window.matchMedia?.("(max-width: 1023px)").matches) {
      setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
      active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
    }`;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Payroll HR · Security</p>
            <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-bold text-slate-900">
              <ShieldAlert className="h-6 w-6 text-red-600" aria-hidden="true" /> Fraud Alert Review
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Each card says what looks wrong. Open one to see the people side by side and record a decision.
              A serious alert stops approval and hiring until you decide.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center sm:max-w-md">
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-2xl font-bold text-red-700">{tab === "todo" ? blockingCount : "-"}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">Blocking a hire</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-2xl font-bold text-amber-800">{tab === "todo" ? groupByCandidate(alerts).length : "-"}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Waiting for you</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-2xl font-bold text-emerald-700">{stats ? doneCount : "-"}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Decided</p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{error}</span>
            <Button size="sm" variant="outline" onClick={refresh} className="h-7 gap-1 border-red-300 text-xs text-red-700 hover:bg-red-100">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          {/* ── Queue ─────────────────────────────────────────────────────── */}
          <aside className="rounded-2xl border border-slate-200 bg-white" aria-label="Alert queue">
            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-3">
              <button type="button" className={chip(tab === "todo")} onClick={() => { setTab("todo"); setOffset(0); }}>To decide</button>
              <button type="button" className={chip(tab === "done")} onClick={() => { setTab("done"); setOffset(0); }}>Decided</button>
              {tab === "todo" && (
                <>
                  <span className="mx-1 h-6 w-px bg-slate-200" aria-hidden="true" />
                  <button type="button" className={chip(kind === "all")} onClick={() => setKind("all")}>All</button>
                  <button type="button" className={chip(kind === "block")} onClick={() => setKind("block")}>Blocking a hire</button>
                  <button type="button" className={chip(kind === "wait")} onClick={() => setKind("wait")}>Can wait</button>
                </>
              )}
            </div>
            <div className="relative border-b border-slate-100 p-3">
              <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search candidate or branch"
                aria-label="Search candidate or branch"
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-8 text-sm focus:border-blue-500 focus:outline-none"
              />
              {search && (
                <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-5 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-slate-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 p-6 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading alerts…</div>
            ) : !groups.length ? (
              <div className="flex items-center gap-3 p-6">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold text-slate-800">{alerts.length ? "No matches" : tab === "todo" ? "Nothing waiting" : "Nothing decided yet"}</p>
                  <p className="text-xs text-slate-500">
                    {alerts.length ? "No alert matches your search or filter." : tab === "todo" ? "No fraud alert is waiting for a decision." : "Decided alerts show here."}
                  </p>
                </div>
              </div>
            ) : (
              <ul className="max-h-[70vh] overflow-y-auto">
                {groups.map((g) => {
                  const wait = waitingText(g.oldest);
                  return (
                    <li key={g.candidateId} className="border-b border-slate-100 last:border-0">
                      <button
                        type="button"
                        onClick={() => pick(g.candidateId)}
                        aria-current={g.candidateId === selectedId}
                        className={`block w-full cursor-pointer p-3.5 text-left transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${g.candidateId === selectedId ? "bg-blue-50" : ""}`}
                      >
                        <span className="block text-sm font-semibold text-slate-900">
                          {g.name}
                          {g.branch && <span className="font-normal text-slate-500"> · {g.branch}</span>}
                        </span>
                        <span className="mt-0.5 block text-sm text-slate-800">{g.headline}</span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {tab === "todo" && (
                            g.blocking
                              ? <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Blocks hiring</span>
                              : <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">Does not block</span>
                          )}
                          {tab === "done" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700">{alertShort(g.alerts[0].alert_type)}</span>}
                          {g.extra > 0 && <span>+{g.extra} more</span>}
                          {tab === "todo" && wait && <span>Waiting {wait}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {!loading && alerts.length >= PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-slate-100 p-3">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} className="text-xs">Previous</Button>
                <span className="text-xs text-slate-500">Alerts {offset + 1} to {offset + alerts.length}</span>
                <Button size="sm" variant="outline" onClick={() => setOffset((o) => o + PAGE_SIZE)} className="text-xs">Next</Button>
              </div>
            )}
          </aside>

          {/* ── Review ────────────────────────────────────────────────────── */}
          <main ref={reviewRef} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-live="polite">
            {selected ? (
              <FraudComparisonPanel
                key={selected.candidateId}
                candidateId={selected.candidateId}
                candidateName={selected.name}
                showActions
                showAcknowledgement={false}
                onAlertResolved={refresh}
              />
            ) : (
              <p className="p-6 text-center text-sm text-slate-500">Pick an alert on the left to review it.</p>
            )}
          </main>
        </div>
      </div>
    </DashboardLayout>
  );
}
