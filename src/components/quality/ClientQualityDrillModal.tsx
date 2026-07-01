import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Activity, AlertTriangle, Target, BarChart2, Phone, FileText, TrendingUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientKpiData {
  client_id: string;
  client_name?: string;
  audit_count: number;
  cq_score: number;
  without_fatal_cq: number;
  excellent_pct: number;
  good_pct: number;
  below_avg_pct: number;
  fatal_count: number;
  avg_parameters: number;
}

interface DailyPoint {
  date: string;
  cq_score: number;
  without_fatal_cq: number;
  fatal_count: number;
  audit_count: number;
}

interface AgentRow {
  agent_name: string;
  agent_code?: string;
  audit_count: number;
  cq_score: number;
  without_fatal_cq: number;
  fatal_count: number;
  excellent_count: number;
  good_count: number;
  below_avg_count: number;
}

interface FatalRow {
  fatal_parameter: string;
  count: number;
  agents_affected: number;
}

interface ScenarioRow {
  scenario: string;
  sub_scenario?: string;
  count: number;
  avg_score: number;
}

interface RepeatRow {
  mobile: string;
  repeat_count: number;
  first_call_date: string;
  last_call_date: string;
  unique_agents: number;
}

interface TranscriptData {
  lead_id: string;
  date: string;
  agent_name?: string;
  cq_score: number;
  transcript_text: string;
  fatal_parameters?: string;
}

// ─── Micro Components ─────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
    </div>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {msg}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  clientName?: string;
  from: string;
  to: string;
  onClose: () => void;
}

type TabId = "performance" | "fatal" | "detail" | "repeat";

const TABS: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: "performance", label: "Quality Performance", icon: <Activity className="h-4 w-4" /> },
  { id: "fatal", label: "Fatal Analysis", icon: <AlertTriangle className="h-4 w-4" /> },
  { id: "detail", label: "Detail Analysis", icon: <Target className="h-4 w-4" /> },
  { id: "repeat", label: "Repeat Analysis", icon: <Phone className="h-4 w-4" /> },
];

export function ClientQualityDrillModal({ clientId, clientName, from, to, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("performance");
  const [transcriptModal, setTranscriptModal] = useState<string | null>(null);

  const key = [clientId, from, to];

  const kpisQ = useQuery({
    queryKey: ["client-kpis", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: ClientKpiData }>(`/api/quality-dashboard/client-drill/kpis?clientId=${clientId}&from=${from}&to=${to}`).then(r => (r as any)?.data ?? r),
  });

  const dailyQ = useQuery({
    queryKey: ["client-daily", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: DailyPoint[] }>(`/api/quality-dashboard/client-drill/daily?clientId=${clientId}&from=${from}&to=${to}`).then(r => Array.isArray(r) ? r : (r as any)?.data ?? []),
    enabled: activeTab === "performance",
  });

  const agentsQ = useQuery({
    queryKey: ["client-agents", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: AgentRow[] }>(`/api/quality-dashboard/client-drill/agents?clientId=${clientId}&from=${from}&to=${to}`).then(r => Array.isArray(r) ? r : (r as any)?.data ?? []),
    enabled: activeTab === "performance",
  });

  const fatalQ = useQuery({
    queryKey: ["client-fatal", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: FatalRow[] }>(`/api/quality-dashboard/client-drill/fatal?clientId=${clientId}&from=${from}&to=${to}`).then(r => Array.isArray(r) ? r : (r as any)?.data ?? []),
    enabled: activeTab === "fatal",
  });

  const scenariosQ = useQuery({
    queryKey: ["client-scenarios", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: ScenarioRow[] }>(`/api/quality-dashboard/client-drill/scenarios?clientId=${clientId}&from=${from}&to=${to}`).then(r => Array.isArray(r) ? r : (r as any)?.data ?? []),
    enabled: activeTab === "detail",
  });

  const repeatQ = useQuery({
    queryKey: ["client-repeat", ...key],
    queryFn: () => hrmsApi.get<{ success: boolean; data: RepeatRow[] }>(`/api/quality-dashboard/client-drill/repeat?clientId=${clientId}&from=${from}&to=${to}`).then(r => Array.isArray(r) ? r : (r as any)?.data ?? []),
    enabled: activeTab === "repeat",
  });

  const transcriptQ = useQuery({
    queryKey: ["client-transcript", transcriptModal],
    queryFn: () => hrmsApi.get<{ success: boolean; data: TranscriptData }>(`/api/quality-dashboard/client-drill/transcript?leadId=${transcriptModal}`).then(r => (r as any)?.data ?? r),
    enabled: !!transcriptModal,
  });

  const kpi = kpisQ.data;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
        <div className="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900">{clientName ?? clientId}</h2>
              <p className="text-sm text-slate-500">Client Quality Drill · {from} to {to}</p>
            </div>
            <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* KPI Summary Bar */}
          {kpisQ.isLoading ? <div className="px-6 py-3"><Spinner /></div> : kpisQ.isError ? <div className="px-6 py-3"><ErrBanner msg="Failed to load KPIs" /></div> : kpi ? (
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-slate-50 px-6 py-4">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs font-semibold text-slate-500">CQ Score</p>
                  <p className="text-xl font-black text-blue-700">{kpi.cq_score}%</p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <p className="text-xs font-semibold text-slate-500">Without Fatal</p>
                  <p className="text-xl font-black text-emerald-700">{kpi.without_fatal_cq}%</p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <p className="text-xs font-semibold text-slate-500">Fatal Count</p>
                  <p className="text-xl font-black text-rose-700">{kpi.fatal_count}</p>
                </div>
                <div className="h-8 w-px bg-slate-200" />
                <div>
                  <p className="text-xs font-semibold text-slate-500">Audits</p>
                  <p className="text-xl font-black text-slate-700">{kpi.audit_count}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-center">
                  <p className="text-xs font-semibold text-emerald-600">Excellent</p>
                  <p className="text-sm font-black text-emerald-900">{kpi.excellent_pct}%</p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-center">
                  <p className="text-xs font-semibold text-amber-600">Good</p>
                  <p className="text-sm font-black text-amber-900">{kpi.good_pct}%</p>
                </div>
                <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-center">
                  <p className="text-xs font-semibold text-rose-600">Below Avg</p>
                  <p className="text-sm font-black text-rose-900">{kpi.below_avg_pct}%</p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-3 no-scrollbar">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition-all ${
                  activeTab === tab.id ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}>
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(90vh - 240px)" }}>
            {activeTab === "performance" && (
              <div className="space-y-5">
                {/* Daily Trend */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-4 font-black text-slate-900">Daily Quality Trend</h3>
                  {dailyQ.isLoading ? <Spinner /> : dailyQ.isError ? <ErrBanner msg="Failed to load daily data" /> : (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={dailyQ.data ?? []} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                        <Line type="monotone" dataKey="cq_score" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="CQ Score%" />
                        <Line type="monotone" dataKey="without_fatal_cq" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="W/O Fatal%" />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Agent Performance Table */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">Agent Performance</h3>
                    <p className="text-xs text-slate-500">Ranked by CQ Score</p>
                  </div>
                  {agentsQ.isLoading ? <Spinner /> : agentsQ.isError ? <div className="p-4"><ErrBanner msg="Failed" /></div> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Agent</th>
                            <th className="px-4 py-3 font-semibold text-right">Audits</th>
                            <th className="px-4 py-3 font-semibold text-right">CQ Score%</th>
                            <th className="px-4 py-3 font-semibold text-right">W/O Fatal%</th>
                            <th className="px-4 py-3 font-semibold text-right">Fatal</th>
                            <th className="px-4 py-3 font-semibold text-right">Excellent</th>
                            <th className="px-4 py-3 font-semibold text-right">Good</th>
                            <th className="px-4 py-3 font-semibold text-right">Below Avg</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(agentsQ.data ?? []).map((a, i) => (
                            <tr key={i} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">{a.agent_name}</div>
                                {a.agent_code && <div className="text-xs text-slate-400">{a.agent_code}</div>}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-700">{a.audit_count}</td>
                              <td className="px-4 py-3 text-right">
                                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${a.cq_score >= 80 ? "bg-emerald-100 text-emerald-700" : a.cq_score >= 70 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                                  {a.cq_score}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-emerald-700 font-semibold">{a.without_fatal_cq}%</td>
                              <td className="px-4 py-3 text-right text-rose-700 font-bold">{a.fatal_count}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{a.excellent_count}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{a.good_count}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{a.below_avg_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "fatal" && (
              <div className="space-y-5">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">Fatal Parameter Breakdown</h3>
                    <p className="text-xs text-slate-500">Which parameters are causing fatal failures</p>
                  </div>
                  {fatalQ.isLoading ? <Spinner /> : fatalQ.isError ? <div className="p-4"><ErrBanner msg="Failed" /></div> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Fatal Parameter</th>
                            <th className="px-4 py-3 font-semibold text-right">Count</th>
                            <th className="px-4 py-3 font-semibold text-right">Agents Affected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(fatalQ.data ?? []).map((f, i) => (
                            <tr key={i} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                              <td className="px-4 py-3 font-semibold text-slate-800">{f.fatal_parameter}</td>
                              <td className="px-4 py-3 text-right">
                                <span className="inline-block rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">{f.count}</span>
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600">{f.agents_affected}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "detail" && (
              <div className="space-y-5">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">Scenario & Sub-Scenario Breakdown</h3>
                    <p className="text-xs text-slate-500">Call distribution by scenario type</p>
                  </div>
                  {scenariosQ.isLoading ? <Spinner /> : scenariosQ.isError ? <div className="p-4"><ErrBanner msg="Failed" /></div> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Scenario</th>
                            <th className="px-4 py-3 font-semibold">Sub-Scenario</th>
                            <th className="px-4 py-3 font-semibold text-right">Count</th>
                            <th className="px-4 py-3 font-semibold text-right">Avg Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(scenariosQ.data ?? []).map((s, i) => (
                            <tr key={i} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                              <td className="px-4 py-3 font-semibold text-slate-800">{s.scenario}</td>
                              <td className="px-4 py-3 text-slate-600">{s.sub_scenario ?? "—"}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-700">{s.count}</td>
                              <td className="px-4 py-3 text-right">
                                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${s.avg_score >= 80 ? "bg-emerald-100 text-emerald-700" : s.avg_score >= 70 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                                  {s.avg_score}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "repeat" && (
              <div className="space-y-5">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-5 py-4">
                    <h3 className="font-black text-slate-900">Repeat Callers</h3>
                    <p className="text-xs text-slate-500">Customers who called multiple times</p>
                  </div>
                  {repeatQ.isLoading ? <Spinner /> : repeatQ.isError ? <div className="p-4"><ErrBanner msg="Failed" /></div> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                          <tr>
                            <th className="px-4 py-3 font-semibold">Mobile</th>
                            <th className="px-4 py-3 font-semibold text-right">Repeat Count</th>
                            <th className="px-4 py-3 font-semibold text-right">First Call</th>
                            <th className="px-4 py-3 font-semibold text-right">Last Call</th>
                            <th className="px-4 py-3 font-semibold text-right">Unique Agents</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(repeatQ.data ?? []).map((r, i) => (
                            <tr key={i} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                              <td className="px-4 py-3 font-semibold text-slate-800">{r.mobile}</td>
                              <td className="px-4 py-3 text-right">
                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${r.repeat_count >= 5 ? "bg-rose-100 text-rose-700" : r.repeat_count >= 3 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                                  {r.repeat_count}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-slate-600">{r.first_call_date}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{r.last_call_date}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{r.unique_agents}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transcript Viewer Modal (nested) */}
      {transcriptModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setTranscriptModal(null)}>
          <div className="relative w-full max-w-3xl max-h-[80vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-blue-600" />
                <div>
                  <h3 className="font-black text-slate-900">Call Transcript</h3>
                  <p className="text-xs text-slate-500">Lead ID: {transcriptModal}</p>
                </div>
              </div>
              <button onClick={() => setTranscriptModal(null)} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-6" style={{ maxHeight: "calc(80vh - 80px)" }}>
              {transcriptQ.isLoading ? <Spinner /> : transcriptQ.isError ? <ErrBanner msg="Failed to load transcript" /> : transcriptQ.data ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Date</p>
                      <p className="text-sm font-bold text-slate-900">{transcriptQ.data.date}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Agent</p>
                      <p className="text-sm font-bold text-slate-900">{transcriptQ.data.agent_name ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">CQ Score</p>
                      <p className={`text-sm font-bold ${transcriptQ.data.cq_score >= 80 ? "text-emerald-700" : transcriptQ.data.cq_score >= 70 ? "text-yellow-700" : "text-red-700"}`}>{transcriptQ.data.cq_score}%</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">Fatal Parameters</p>
                      <p className="text-sm font-bold text-rose-700">{transcriptQ.data.fatal_parameters ?? "None"}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{transcriptQ.data.transcript_text || "No transcript available."}</p>
                  </div>
                </div>
              ) : <p className="text-center text-sm text-slate-500">No transcript data found.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
