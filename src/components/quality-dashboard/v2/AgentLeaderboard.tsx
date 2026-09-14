import type { AgentRow } from "./types";
import { safeNum } from "./types";
import { ScorePill, PanelShell, Spinner, ErrBanner } from "./shared";

interface Props {
  agents: AgentRow[] | undefined;
  loading: boolean;
  error: boolean;
}

const BAND_CLS: Record<string, string> = {
  elite:    "bg-blue-100 text-blue-700",
  good:     "bg-emerald-100 text-emerald-700",
  average:  "bg-yellow-100 text-yellow-700",
  poor:     "bg-red-100 text-red-700",
};

export function AgentLeaderboard({ agents, loading, error }: Props) {
  const rows = agents ?? [];

  const coachingCount = rows.filter((a) => safeNum(a.avg_score) < 70).length;

  return (
    <PanelShell
      title="Agent Leaderboard"
      subtitle="Ranked by avg quality · Top 20"
      action={
        coachingCount > 0 ? (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
            {coachingCount} need coaching
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <Spinner size="sm" />
      ) : error ? (
        <ErrBanner msg="Failed to load agents" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">No agents in this period</p>
      ) : (
        <div className="overflow-x-auto -mx-4">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-slate-50 text-left">
              <tr>
                {["#", "Agent", "Calls", "Score", "Band"].map((h) => (
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
              {rows.slice(0, 20).map((a, i) => {
                const needsCoaching = safeNum(a.avg_score) < 70;
                return (
                  <tr
                    key={a.agent_name}
                    className={`border-t border-slate-50 transition-colors hover:bg-slate-50/70 ${needsCoaching ? "bg-red-50/30" : ""}`}
                  >
                    <td className="px-4 py-2.5 font-bold text-slate-300 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-slate-800 leading-snug">{a.agent_name}</div>
                      {a.agent_code && (
                        <div className="text-[11px] text-slate-400">{a.agent_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{safeNum(a.total_calls).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <ScorePill score={safeNum(a.avg_score)} />
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${BAND_CLS[a.band] ?? "bg-slate-100 text-slate-600"}`}>
                        {a.band}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
}
