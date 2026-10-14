import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Award, Loader, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";

type CqScore = {
  total_calls: number;
  fatal_calls: number;
  cq_score_current: number;
  cq_score_7day_avg: number;
  cq_score_30day_avg: number;
  rank: { position: number; total_agents: number };
  peer_avg: number;
  target: number;
  gap_pct: number;
  status: "On Track" | "Below Target" | "Risk";
  weekly: Array<{ day: string; avg: number; calls: number }>;
};

type ParameterScore = {
  key: string;
  label: string;
  group: string;
  is_fatal_component: boolean;
  score: number | null;
  peer_avg: number | null;
  graded_calls: number;
  failed_calls: number;
  tip: string | null;
  recent_failures: Array<{ call_id: string; date: string; cq_pct: number; feedback: string | null }>;
};
type ComponentScore = { category: string; score: number | null; peer_avg: number | null };
type WeaknessResponse = { audited_calls: number; parameters: ParameterScore[]; weakness_areas: ComponentScore[] };
// The inbound QA scorecard's 5 score components, in the audit site's order and colours.
const GROUP_ORDER = ["Opening Skill", "Soft Skill", "Hold Procedure", "Resolution", "Closing"];
const GROUP_COLOR: Record<string, string> = {
  "Opening Skill": "#0EA5E9", "Soft Skill": "#8B5CF6", "Hold Procedure": "#F59E0B", Resolution: "#14B8A6", Closing: "#EC4899",
};

async function getData<T>(path: string): Promise<T> {
  const res = await hrmsApi.get<{ success: boolean; data: T }>(path);
  return res.data;
}

const STATUS_TONE: Record<string, string> = {
  "On Track": "bg-emerald-50 text-emerald-700",
  "Below Target": "bg-amber-50 text-amber-700",
  Risk: "bg-rose-50 text-rose-700",
};

const fmt = (n: number | null | undefined) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? "—" : `${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;

type AuditedAgent = { masid: string; name: string | null; audits: number; last_audit: string };

/**
 * `agentCode` + `embedded` let a parent (the My KPIs dashboard drawer) show this panel for an
 * agent it has already chosen; the agent picker and the "view all calls" link are then hidden.
 */
export function MyQualityPanel({ agentCode, embedded = false }: { agentCode?: string; embedded?: boolean } = {}) {
  const [pickedAgent, setSelectedAgent] = useState("");
  const selectedAgent = agentCode ?? pickedAgent;

  // Only org-wide quality roles get a 200 here; a 403 simply means "no picker".
  const agents = useQuery({
    queryKey: ["my-quality", "audited-agents"],
    queryFn: () => getData<AuditedAgent[]>("/api/agent/audited-agents"),
    retry: false,
    staleTime: 5 * 60_000,
    enabled: !embedded,
  });
  const canViewOthers = agents.isSuccess;
  const agentOptions: SearchableOption[] = (agents.data ?? []).map((a) => ({
    value: a.masid,
    label: `${a.name ?? "Unmapped"} (${a.masid})`,
    hint: `${a.audits} audits / 30 days`,
    keywords: `${a.name ?? ""} ${a.masid}`,
  }));
  const viewingName = agents.data?.find((a) => a.masid === selectedAgent)?.name ?? selectedAgent;
  const agentQs = selectedAgent ? `agentCode=${encodeURIComponent(selectedAgent)}` : "";

  const score = useQuery({
    queryKey: ["my-quality", "cq-score", selectedAgent],
    queryFn: () => getData<CqScore>(`/api/agent/cq-score?daysBack=7${agentQs ? `&${agentQs}` : ""}`),
    retry: false,
    staleTime: 60_000,
  });
  const weakness = useQuery({
    queryKey: ["my-quality", "weakness", selectedAgent],
    queryFn: () => getData<WeaknessResponse>(`/api/agent/weakness-detail${agentQs ? `?${agentQs}` : ""}`),
    retry: false,
    staleTime: 60_000,
    enabled: score.isSuccess,
  });

  const notAnAgent = score.isError && (score.error as { status?: number } | null)?.status === 403;
  const s = score.data;
  // total_calls === 0 means nothing was audited — distinct from a genuine 0% score.
  const noAudits = !!s && (s.total_calls ?? 0) === 0;
  const params = weakness.data?.parameters ?? [];
  const weakest = [...params].filter((p) => p.score !== null && p.failed_calls > 0).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const latestFeedback = weakest?.recent_failures.find((f) => f.feedback)?.feedback ?? null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-emerald-600" size={20} />
          <h2 className="font-semibold text-gray-900">
            {selectedAgent ? `Quality Performance — ${viewingName}` : "My Quality Performance"}
          </h2>
          <span className="text-xs text-gray-400">Call audit · last 7 days</span>
        </div>
        <div className="flex items-center gap-3">
          {canViewOthers && !embedded && (
            <div className="w-72">
              <SearchableSelect
                options={[{ value: "", label: "My own data" }, ...agentOptions]}
                value={selectedAgent}
                onChange={setSelectedAgent}
                placeholder="View an agent"
                searchPlaceholder="Search name or MASID"
                emptyText="No audited agent matches"
              />
            </div>
          )}
          {!embedded && !selectedAgent && !notAnAgent && (
            <Link to="/my-quality-score" className="text-xs font-semibold text-indigo-600 hover:underline">
              View all audited calls
            </Link>
          )}
        </div>
      </div>

      {score.isLoading && (
        <div className="flex justify-center py-10"><Loader className="animate-spin text-indigo-500" size={24} /></div>
      )}

      {score.isError && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">
          {notAnAgent
            ? canViewOthers
              ? "Your account is not linked to a call-centre MASID. Pick an agent above to view their quality performance."
              : "No call-centre quality data is linked to your account."
            : "Quality data is unavailable right now. Please try again later."}
        </p>
      )}

      {s && noAudits && (
        <p className="px-4 py-8 text-center text-sm text-gray-400">
          {selectedAgent ? "This agent has no audited calls in the last 7 days." : "No calls of yours have been audited in the last 7 days."}
        </p>
      )}

      {s && !noAudits && (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile
              label="Overall CQ Score"
              value={fmt(s.cq_score_current)}
              helper={`${s.total_calls} audited call${s.total_calls === 1 ? "" : "s"}${s.fatal_calls ? ` · ${s.fatal_calls} fatal` : ""} · target ${s.target}%`}
            >
              <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[s.status] ?? "bg-gray-100 text-gray-600"}`}>{s.status}</span>
            </Tile>
            <Tile label="7-Day Average" value={fmt(s.cq_score_7day_avg)} helper={`Peer avg ${fmt(s.peer_avg)}`} />
            <Tile label="30-Day Average" value={fmt(s.cq_score_30day_avg)} helper={
              s.cq_score_7day_avg >= s.cq_score_30day_avg ? "Improving vs 30 days" : "Below your 30-day level"
            }>
              {s.cq_score_7day_avg >= s.cq_score_30day_avg
                ? <TrendingUp className="mt-1 text-emerald-600" size={16} />
                : <TrendingDown className="mt-1 text-rose-600" size={16} />}
            </Tile>
            <Tile label="Rank in your process" value={s.rank.position ? `#${s.rank.position}` : "—"} helper={`of ${s.rank.total_agents} agents`}>
              <Award className="mt-1 text-amber-500" size={16} />
            </Tile>
          </div>

          {(weakness.data?.weakness_areas ?? []).length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Score components</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {GROUP_ORDER.map((g) => {
                  const c = weakness.data!.weakness_areas.find((a) => a.category === g);
                  return (
                    <div key={g} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5" style={{ borderTop: `3px solid ${GROUP_COLOR[g]}` }}>
                      <p className="text-[11px] font-medium text-gray-500">{g}</p>
                      <p className="text-lg font-bold text-gray-900">{fmt(c?.score)}</p>
                      <p className="text-[10px] text-gray-400">peer {fmt(c?.peer_avg)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Parameter scores</h3>
            {weakness.isLoading && <p className="text-xs text-gray-400">Loading parameter scores…</p>}
            {weakness.isError && <p className="text-xs text-gray-400">Parameter scores are unavailable right now.</p>}
            {weakness.isSuccess && params.length === 0 && <p className="text-xs text-gray-400">None</p>}

            {weakest && (weakest.score ?? 100) < 90 && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p>
                  <strong>Focus area: {weakest.label}</strong> — missed on {weakest.failed_calls} of {weakest.graded_calls} audited
                  calls ({fmt(weakest.score)}; process average {fmt(weakest.peer_avg)}).
                  {weakest.is_fatal_component && " This is a fatal-call parameter."}
                </p>
                {weakest.tip && (
                  <p className="mt-1">
                    <span className="font-semibold">How to improve:</span> {weakest.tip}
                  </p>
                )}
                {latestFeedback && (
                  <p className="mt-1">
                    <span className="font-semibold">Latest audit feedback:</span> {latestFeedback}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3">
              {GROUP_ORDER.map((group) => {
                const rows = params.filter((p) => p.group === group);
                if (rows.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                      <span className="h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[group] }} />
                      {group} <span className="font-normal normal-case text-gray-400">· {rows.length} parameter{rows.length === 1 ? "" : "s"}</span>
                    </p>
                    <div className="space-y-1.5">
                      {rows.map((p) => (
                        <div key={p.key} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[230px_1fr_170px]">
                          <span className="truncate text-gray-700" title={p.tip ? `${p.label} — ${p.tip}` : p.label}>
                            {p.label}
                            {p.is_fatal_component && <span className="ml-1 text-[10px] font-semibold text-rose-600">FATAL</span>}
                          </span>
                          {p.score === null ? (
                            <>
                              <div className="h-2 rounded-full bg-gray-100" />
                              <span className="text-right text-xs text-gray-400">Not evaluated</span>
                            </>
                          ) : (
                            <>
                              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                                <div
                                  className={`h-full rounded-full ${p.score >= 90 ? "bg-emerald-500" : p.score >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                                  style={{ width: `${Math.min(100, Math.max(0, p.score))}%` }}
                                />
                              </div>
                              <span className="text-right text-xs text-gray-500">
                                {fmt(p.score)} · peer {fmt(p.peer_avg)}
                                {p.failed_calls > 0 && <span className="text-rose-600"> · {p.failed_calls} missed</span>}
                              </span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, helper, children }: { label: string; value: string; helper: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-400">{helper}</p>
      {children}
    </div>
  );
}
