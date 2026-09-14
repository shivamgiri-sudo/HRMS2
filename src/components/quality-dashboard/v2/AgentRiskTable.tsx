import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { Info, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import type { AgentRisk } from "./types";
import { RISK_MAP, safeNum } from "./types";
import { ScorePill, Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  from: string;
  to: string;
  queryKey: unknown[];
}

function AgentRadarModal({ agent, onClose }: { agent: AgentRisk; onClose: () => void }) {
  const risk = RISK_MAP[agent.risk_status] ?? { label: agent.risk_status, cls: "bg-slate-100 text-slate-600 border-slate-200" };

  const radarData = [
    { metric: "Overall",     value: agent.overall_avg },
    { metric: "This Week",   value: agent.week_avg ?? 0 },
    { metric: "Yesterday",   value: agent.yesterday_avg ?? 0 },
    { metric: "Consistency", value: Math.max(0, 100 - safeNum(agent.volatility)) },
    {
      metric: "Pass Rate",
      value: agent.total_calls > 0
        ? Math.round(((agent.total_calls - agent.critical_count) / agent.total_calls) * 100)
        : 0,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">{agent.agent_name}</h3>
            {agent.agent_code && <p className="text-xs text-slate-400">{agent.agent_code}</p>}
            <span className={`mt-1 inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${risk.cls}`}>
              {risk.label}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stats grid */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            { label: "Total Calls",   val: agent.total_calls },
            { label: "Overall Avg",   val: `${agent.overall_avg}%` },
            { label: "Week Avg",      val: `${agent.week_avg ?? "–"}%` },
            { label: "Yesterday",     val: `${agent.yesterday_avg ?? "–"}%` },
            { label: "Critical",      val: agent.critical_count },
            { label: "Volatility",    val: `${safeNum(agent.volatility).toFixed(1)}σ` },
          ].map(({ label, val }) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">{label}</p>
              <p className="mt-0.5 text-base font-black text-slate-900 tabular-nums">{val}</p>
            </div>
          ))}
        </div>

        {/* Radar */}
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#64748b" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar
              dataKey="value"
              stroke="#2563eb"
              fill="#2563eb"
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>

        {/* Recommended action */}
        {agent.recommended_action && (
          <div className="mt-4 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <p className="text-sm font-semibold text-blue-800">{agent.recommended_action}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentRiskTable({ from, to, queryKey }: Props) {
  const [selected, setSelected] = useState<AgentRisk | null>(null);

  const { data, isLoading, isError } = useQuery<AgentRisk[]>({
    queryKey: ["qd-agentrisk", ...queryKey],
    queryFn: () =>
      hrmsApi
        .get<{ agents: AgentRisk[] }>(`/api/quality-dashboard/agent-risk?from=${from}&to=${to}`)
        .then((r) => r.agents),
    staleTime: 5 * 60 * 1000,
  });

  const rows = data ?? [];

  return (
    <>
      <PanelShell
        title="Agent Risk Intelligence"
        subtitle="Click a row to drill into full agent analytics — red rows are at-risk"
      >
        {isLoading ? (
          <Spinner size="sm" />
        ) : isError ? (
          <ErrBanner msg="Failed to load agent risk data" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No agent risk data for this period</p>
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  {["Agent", "Total", "Overall", "Week", "Δ", "Status", "Action"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((agent) => {
                  const risk = RISK_MAP[agent.risk_status] ?? { label: agent.risk_status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
                  const isAtRisk = ["declining_fast", "declining", "consistently_poor"].includes(agent.risk_status);
                  const delta = safeNum(agent.trend_delta);
                  return (
                    <tr
                      key={agent.agent_name}
                      onClick={() => setSelected(agent)}
                      className={`cursor-pointer border-t border-slate-50 transition-colors hover:bg-blue-50/40 ${isAtRisk ? "bg-red-50/40" : ""}`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-800 leading-snug">{agent.agent_name}</div>
                        {agent.agent_code && <div className="text-[11px] text-slate-400">{agent.agent_code}</div>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-500">{agent.total_calls}</td>
                      <td className="px-4 py-2.5"><ScorePill score={agent.overall_avg} /></td>
                      <td className="px-4 py-2.5 tabular-nums text-slate-600">{agent.week_avg ?? "–"}%</td>
                      <td className={`px-4 py-2.5 font-bold tabular-nums text-sm ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-400"}`}>
                        {delta > 0 ? `+${delta}` : delta}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${risk.cls}`}>
                          {risk.label}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-4 py-2.5 text-xs text-slate-500">
                        {agent.recommended_action}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelShell>

      {selected && <AgentRadarModal agent={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
