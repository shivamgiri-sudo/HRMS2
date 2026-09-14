import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, Info, TrendingDown, UserMinus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import TeamMemberDrawer from "./TeamMemberDrawer";

/**
 * Attrition and shrinkage for this manager's team — attributed point-in-time.
 *
 * The number a manager cares about is "how many of MY people left", and until now the
 * platform could not answer it honestly: reporting_manager_id is a single mutable pointer
 * with no history, so every exit silently re-attributes itself to whoever holds the pointer
 * today. Inherit a team, inherit its whole past attrition.
 *
 * So every figure here carries its attribution, and the screen says so out loud:
 *   observed        — the effective-dated history covers that date
 *   assumed_current — no history for that date; today's pointer was used. A GUESS.
 *
 * The disclosure banner is not decoration. Until migration 1624 runs and real manager changes
 * accumulate, almost everything will be `assumed_current`, and a confident-looking attrition
 * rate with no caveat is precisely the bug this work exists to remove.
 */

type Attribution = "observed" | "assumed_current";

interface Leaver {
  employee_id: string;
  full_name: string;
  employee_code: string | null;
  exit_date: string;
  tenure_days: number | null;
  attribution: Attribution;
}

interface Payload {
  attrition: {
    window_months: number;
    opening_headcount: number;
    closing_headcount: number;
    exits_observed: number;
    exits_assumed: number;
    exits_total: number;
    attrition_rate_pct: number | null;
    by_month: { month: string; exits: number; observed: number; assumed: number }[];
    leavers: Leaver[];
    mostly_assumed: boolean;
  };
  shrinkage: {
    window_days: number;
    scheduled_days: number;
    planned_days: number;
    unplanned_days: number;
    missing_punch_days: number;
    planned_pct: number | null;
    unplanned_pct: number | null;
    total_pct: number | null;
    by_day: { date: string; scheduled: number; planned: number; unplanned: number; pct: number | null }[];
    attribution: Attribution;
  };
}

const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
};

const fmtDate = (v: string) => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "—";
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
};

const tenureLabel = (days: number | null) => {
  if (days == null) return "—";
  if (days < 90) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}m`;
  return `${(days / 365).toFixed(1)}y`;
};

function Tile({ label, value, sub, tone = "slate" }: { label: string; value: React.ReactNode; sub?: string; tone?: "slate" | "warn" | "bad" | "good" }) {
  const toneClass = { slate: "text-slate-900", warn: "text-amber-700", bad: "text-rose-700", good: "text-emerald-700" }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function TeamRetentionTab() {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["team-retention"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: Payload }>("/api/management/team-retention");
      return res.data;
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  const a = data?.attrition;
  const s = data?.shrinkage;
  if (!a || !s) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
        <UserMinus className="mx-auto mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-500">No retention data for your team yet.</p>
      </div>
    );
  }

  const assumedAnywhere = a.exits_assumed > 0 || s.attribution === "assumed_current";
  const maxMonth = Math.max(1, ...a.by_month.map((m) => m.exits));

  return (
    <div className="space-y-6">
      {/* The honesty banner. Shown whenever ANY figure on this screen rests on today's
          pointer rather than on recorded history. */}
      {assumedAnywhere && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Attributed to the current reporting line.</strong> Manager history is not
            recorded yet, so {a.exits_assumed > 0 ? `${a.exits_assumed} of ${a.exits_total} exits` : "the shrinkage figures"}{" "}
            {a.exits_assumed > 0 ? "are" : "is"} attributed to whoever the reporting pointer names
            today — not necessarily to whoever managed these people at the time. Once effective-dated
            history is switched on, figures move to <em>observed</em> and stop shifting when a team
            changes hands.
          </span>
        </div>
      )}

      {/* ── Attrition ─────────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Attrition · last {a.window_months} months
        </h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile
            label="Annualised rate"
            value={a.attrition_rate_pct != null ? `${a.attrition_rate_pct}%` : "—"}
            sub={`On avg headcount of ${Math.round((a.opening_headcount + a.closing_headcount) / 2)}`}
            tone={a.attrition_rate_pct == null ? "slate" : a.attrition_rate_pct >= 60 ? "bad" : a.attrition_rate_pct >= 30 ? "warn" : "good"}
          />
          <Tile label="People left" value={a.exits_total} sub={`${a.exits_observed} observed · ${a.exits_assumed} assumed`} tone={a.exits_total > 0 ? "warn" : "good"} />
          <Tile label="Team now" value={a.closing_headcount} sub="Active reports" />
          <Tile label="Team then" value={a.opening_headcount} sub="Reconstructed, excludes joiners" />
        </div>

        {/* Exits by month */}
        {a.by_month.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Exits by month</p>
            <div className="flex items-end gap-1.5" style={{ height: 90 }}>
              {a.by_month.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${fmtMonth(m.month)}: ${m.exits} exit${m.exits === 1 ? "" : "s"}`}>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-500">{m.exits}</span>
                  <div
                    className="w-full rounded-t bg-rose-400"
                    style={{ height: `${Math.max(4, (m.exits / maxMonth) * 62)}px` }}
                  />
                  <span className="text-[9px] text-slate-400">{fmtMonth(m.month)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leavers */}
        {a.leavers.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 text-left font-semibold">Who left</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Exit date</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Tenure</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Attribution</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {a.leavers.map((l) => (
                  <tr
                    key={l.employee_id}
                    onClick={() => setSelected({ id: l.employee_id, name: l.full_name })}
                    className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{l.full_name}</p>
                      <p className="text-xs text-slate-400">{l.employee_code}</p>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{fmtDate(l.exit_date)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{tenureLabel(l.tenure_days)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-lg px-2 py-0.5 text-[11px] font-medium ${
                        l.attribution === "observed" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        {l.attribution === "observed" ? "observed" : "assumed"}
                      </span>
                    </td>
                    <td className="pr-3 text-slate-300"><ChevronRight className="h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Shrinkage ─────────────────────────────────────────────────── */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">
          Shrinkage · last {s.window_days} days
        </h3>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile
            label="Total shrinkage"
            value={s.total_pct != null ? `${s.total_pct}%` : "—"}
            sub={`${s.scheduled_days} scheduled days`}
            tone={s.total_pct == null ? "slate" : s.total_pct >= 25 ? "bad" : s.total_pct >= 12 ? "warn" : "good"}
          />
          <Tile label="Unplanned" value={s.unplanned_pct != null ? `${s.unplanned_pct}%` : "—"} sub={`${s.unplanned_days} days uncovered`} tone={s.unplanned_pct != null && s.unplanned_pct >= 15 ? "bad" : "warn"} />
          <Tile label="Planned" value={s.planned_pct != null ? `${s.planned_pct}%` : "—"} sub={`${s.planned_days} days, known ahead`} />
          <Tile label="Missing punch" value={s.missing_punch_days} sub="Usually a device fault" tone={s.missing_punch_days > 0 ? "warn" : "slate"} />
        </div>

        {s.missing_punch_days > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            Missing-punch days are counted as unplanned shrinkage because the shift could not be
            relied on — but they usually mean an unenrolled or failed biometric rather than
            someone not turning up. Worth checking before treating it as a person's behaviour.
          </p>
        )}

        {/* Daily shrinkage */}
        {s.by_day.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <TrendingDown className="h-3 w-3" /> Daily shrinkage
            </p>
            <div className="flex items-end gap-[3px]" style={{ height: 70 }}>
              {s.by_day.map((d) => (
                <div
                  key={d.date}
                  title={`${fmtDate(d.date)} — ${d.pct ?? 0}% (${d.unplanned} unplanned, ${d.planned} planned of ${d.scheduled})`}
                  className={`flex-1 rounded-t ${
                    (d.pct ?? 0) >= 25 ? "bg-rose-400" : (d.pct ?? 0) >= 12 ? "bg-amber-400" : "bg-emerald-400"
                  }`}
                  style={{ height: `${Math.max(3, ((d.pct ?? 0) / 100) * 62)}px` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <TeamMemberDrawer
        employeeId={selected?.id ?? null}
        employeeName={selected?.name}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
