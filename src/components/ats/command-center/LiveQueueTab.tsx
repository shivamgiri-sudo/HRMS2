import { useMemo } from "react";
import { AlertTriangle, Clock, TimerReset, Users } from "lucide-react";

import {
  ChartCard,
  ChartSkeleton,
  EmptyState,
  StatTile,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

interface LiveQueueTabProps {
  queueRows: AnyRow[];
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);
const S = (v: unknown) => String(v ?? "");

/**
 * Whether a queue row is actually in SLA breach.
 *
 * The payload carries `SLAFlag` as "Yes"/"No" and `_slaBreached` as a real boolean; both are
 * checked so this stays correct if a caller sends one and not the other. What it must never do
 * again is treat the presence of the field as the answer.
 */
function isBreached(row: Record<string, unknown>): boolean {
  if (typeof row._slaBreached === "boolean") return row._slaBreached;
  return String(row.SLAFlag ?? "").trim().toLowerCase() === "yes";
}

function mins(v: unknown) {
  const m = Math.round(N(v));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function LiveQueueTab({ queueRows, loading }: LiveQueueTabProps) {
  const model = useMemo(() => {
    const sorted = [...(queueRows || [])].sort((a, b) => N(b.WaitingMinutes) - N(a.WaitingMinutes));
    /**
     * SLAFlag is the STRING "Yes" or "No", not a boolean.
     *
     * `filter((r) => r.SLAFlag)` is therefore true for every row that has the field at all —
     * "No" is a non-empty string and non-empty strings are truthy. So the tile read
     * "SLA BREACH 5 · 100.0% of the queue", every row in the table was tinted red and stamped
     * BREACH, and the banner announced five candidates past target, while the API had returned
     * SLAFlag:"No" and sla_breached:0 for all five of them.
     */
    const breaches = sorted.filter((r) => isBreached(r));
    const totalWait = sorted.reduce((sum, r) => sum + N(r.WaitingMinutes), 0);
    return {
      sorted,
      breachCount: breaches.length,
      avgWait: sorted.length > 0 ? totalWait / sorted.length : 0,
      // The median resists the single 4-hour outlier that drags the mean and makes
      // a healthy queue look broken.
      medianWait:
        sorted.length > 0
          ? N(sorted[Math.floor(sorted.length / 2)]?.WaitingMinutes)
          : 0,
      longest: sorted[0],
    };
  }, [queueRows]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
        <ChartSkeleton height={300} />
      </div>
    );
  }

  const { sorted, breachCount, avgWait, medianWait, longest } = model;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Queue Length"
          value={num(sorted.length)}
          denominator="Candidates waiting now"
          icon={<Users className="h-4 w-4" />}
        />
        <StatTile
          label="Median Wait"
          value={mins(medianWait)}
          denominator={`Mean ${mins(avgWait)} — differs when a few wait far longer`}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatTile
          label="SLA Breach"
          value={num(breachCount)}
          denominator={`${pct(ratio(breachCount, sorted.length) ?? 0)} of the queue`}
          intent={breachCount > 0 ? "critical" : "good"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
        <StatTile
          label="Longest Wait"
          value={mins(longest?.WaitingMinutes)}
          denominator={longest ? `${S(longest.FullName) || "Unnamed"} · ${S(longest.Branch) || "no branch"}` : "Queue empty"}
          intent={longest && isBreached(longest) ? "critical" : "neutral"}
          icon={<TimerReset className="h-4 w-4" />}
        />
      </div>

      {breachCount > 0 && (
        <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-bold text-rose-900">
            <AlertTriangle className="h-4 w-4" />
            {num(breachCount)} candidate{breachCount === 1 ? "" : "s"} past the SLA target — highlighted in the table below
          </p>
        </div>
      )}

      <ChartCard
        title="Live Queue"
        subtitle="Everyone currently waiting, longest first. Rows in breach are tinted and flagged."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {num(sorted.length)} waiting
          </span>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState
            label="Queue is empty"
            hint="Nobody is waiting right now — this is a real zero, not a failed load."
            height={200}
          />
        ) : (
          <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[880px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">Token</th>
                  <th className="px-3 py-2 text-left font-semibold">Candidate</th>
                  <th className="px-3 py-2 text-left font-semibold">Branch</th>
                  <th className="px-3 py-2 text-left font-semibold">Role</th>
                  <th className="px-3 py-2 text-left font-semibold">Recruiter</th>
                  <th className="px-3 py-2 text-left font-semibold">Stage</th>
                  <th className="px-3 py-2 text-right font-semibold">Waiting</th>
                  <th className="px-3 py-2 text-center font-semibold">SLA</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <tr
                    key={`${S(row.CandidateID)}-${i}`}
                    className={`border-b border-slate-100 last:border-0 transition-colors duration-150 ${
                      isBreached(row) ? "bg-rose-50/70 hover:bg-rose-50" : "hover:bg-slate-50/60"
                    }`}
                  >
                    <td className="px-3 py-2 font-mono text-slate-600">{S(row.QToken) || "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{S(row.FullName) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row.Branch) || "—"}</td>
                    <td className="max-w-[130px] truncate px-3 py-2 text-slate-600" title={S(row.RoleApplied)}>
                      {S(row.RoleApplied) || "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{S(row.RecruiterAssignedName) || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{S(row.CurrentStage) || "—"}</td>
                    <td
                      className={`px-3 py-2 text-right font-bold tabular-nums ${
                        isBreached(row) ? "text-rose-700" : "text-slate-900"
                      }`}
                    >
                      {mins(row.WaitingMinutes)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {/* Status carries an icon and a word, never colour alone. */}
                      {isBreached(row) ? (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                          <AlertTriangle className="h-3 w-3" /> BREACH
                        </span>
                      ) : (
                        <span className="inline-flex rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
