import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";

type AnyRow = Record<string, unknown>;

interface LiveQueueTabProps {
  queueRows: AnyRow[];
  loading?: boolean;
}

function mins(v: unknown) {
  const m = Number(v || 0);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function LiveQueueTab({ queueRows, loading }: LiveQueueTabProps) {
  const sorted = useMemo(
    () => [...queueRows].sort((a, b) => Number(b.WaitingMinutes || 0) - Number(a.WaitingMinutes || 0)),
    [queueRows]
  );

  const slaBreachCount = sorted.filter((r) => r.SLAFlag).length;
  const avgWait = sorted.length > 0
    ? Math.round(sorted.reduce((sum, r) => sum + Number(r.WaitingMinutes || 0), 0) / sorted.length)
    : 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Metrics */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Queue Length" value={String(sorted.length)} />
        <Stat label="Avg Wait" value={mins(avgWait)} />
        <Stat label="SLA Breach" value={String(slaBreachCount)} alert={slaBreachCount > 0} />
        <Stat label="Longest Wait" value={mins(sorted[0]?.WaitingMinutes)} />
      </div>

      {/* SLA alert */}
      {slaBreachCount > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="flex items-center gap-2 text-xs font-bold text-rose-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {slaBreachCount} candidate{slaBreachCount > 1 ? "s" : ""} in SLA breach
          </p>
        </div>
      )}

      {/* Queue Table */}
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Live Queue ({sorted.length})</h3>
          <span className="text-[11px] text-slate-500">Sorted by longest wait</span>
        </div>
        <div className="overflow-auto max-h-[500px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Token</th>
                <th className="text-left px-3 py-2 font-medium">Candidate</th>
                <th className="text-left px-3 py-2 font-medium">Branch</th>
                <th className="text-left px-3 py-2 font-medium">Role</th>
                <th className="text-left px-3 py-2 font-medium">Recruiter</th>
                <th className="text-left px-3 py-2 font-medium">Stage</th>
                <th className="text-right px-3 py-2 font-medium">Waiting</th>
                <th className="text-center px-3 py-2 font-medium">SLA</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr
                  key={String(row.CandidateID || i)}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${row.SLAFlag ? "bg-rose-50" : ""}`}
                >
                  <td className="px-3 py-2 font-mono text-slate-700">{String(row.QToken || "-")}</td>
                  <td className="px-3 py-2 font-medium text-slate-800">{String(row.FullName || "-")}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row.Branch || "-")}</td>
                  <td className="px-3 py-2 text-slate-600 max-w-[100px] truncate">{String(row.RoleApplied || "-")}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row.RecruiterAssignedName || "-")}</td>
                  <td className="px-3 py-2 text-slate-600">{String(row.CurrentStage || "-")}</td>
                  <td className="px-3 py-2 text-right font-bold text-slate-900">{mins(row.WaitingMinutes)}</td>
                  <td className="px-3 py-2 text-center">
                    {row.SLAFlag ? (
                      <span className="inline-flex rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">BREACH</span>
                    ) : (
                      <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-12">Queue is empty</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${alert ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${alert ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
