/**
 * Headcount & Shortage — the HR hiring-alert board.
 *
 * One row per branch + process: the mandate the client is billed for, the people actually on it,
 * the buffer that should be carried, and what that adds up to as a shortage. Rows are scoped
 * server-side to the caller's own processes (user_assignment_scope), so a branch HR executive
 * sees their branch, a process-mapped executive sees only their processes, and super_admin sees
 * everything.
 *
 * Figures come from /api/manpower-risk/cost-center, which is also what the dashboard tile and its
 * drill-down read — the three cannot disagree because there is one query behind them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Users } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { KpiCard } from "@/components/enterprise/KpiCard";
import { KpiCardGrid } from "@/components/enterprise/KpiCardGrid";
import { RightDetailDrawer } from "@/components/enterprise/RightDetailDrawer";
import { Button } from "@/components/ui/button";

type ShortageRow = {
  mandate_id: string;
  process_id: string | null;
  process_name: string;
  branch_id: string | null;
  branch_name: string;
  mandated_hc: number;
  active_hc: number;
  buffer_pct: number;
  buffer_to_maintain: number;
  buffer_count: number;
  target_hc: number;
  shortage: number;
  surplus: number;
  coverage_pct: number | null;
  in_notice_count: number;
  hiring_recommendation: number;
  risk_level: "critical" | "high" | "medium" | "low";
};

type UnmappedRow = {
  branch_id: string | null;
  branch_name: string;
  cost_centre_count: number;
  mandated_hc: number;
};

type Summary = {
  total_mandate: number;
  total_active: number;
  total_buffer_to_maintain: number;
  total_shortage: number;
  processes_short: number;
  total_in_notice: number;
  unmapped_mandate: number;
  unmapped_cost_centres: number;
};

type ApiResponse = {
  success: boolean;
  data: ShortageRow[];
  summary: Summary;
  unmapped: UnmappedRow[];
};

const RISK_BADGE: Record<ShortageRow["risk_level"], string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-amber-100 text-amber-700 border-amber-200",
  medium: "bg-blue-100 text-blue-700 border-blue-200",
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

/** Signed buffer: spare people carried today, negative when already below mandate. */
function BufferCell({ value }: { value: number }) {
  const tone = value < 0 ? "text-red-600" : value === 0 ? "text-slate-500" : "text-emerald-600";
  return <span className={`font-semibold ${tone}`}>{value > 0 ? `+${value}` : value}</span>;
}

export function HeadcountShortagePanel({
  branchId,
  processId,
}: {
  branchId?: string;
  processId?: string;
}) {
  const [rows, setRows] = useState<ShortageRow[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ShortageRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<ApiResponse>("/api/manpower-risk/cost-center");
      setRows(res?.data ?? []);
      setUnmapped(res?.unmapped ?? []);
      setSummary(res?.summary ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the headcount board.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Client-side narrowing on top of the server's own scoping, so the page's existing branch and
  // process filters drive this tab too rather than needing a second filter bar.
  const visible = useMemo(
    () =>
      rows.filter(
        (r) => (!branchId || r.branch_id === branchId) && (!processId || r.process_id === processId),
      ),
    [rows, branchId, processId],
  );

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, r) => ({
          mandate: acc.mandate + r.mandated_hc,
          active: acc.active + r.active_hc,
          buffer: acc.buffer + r.buffer_to_maintain,
          shortage: acc.shortage + r.shortage,
          short: acc.short + (r.shortage > 0 ? 1 : 0),
        }),
        { mandate: 0, active: 0, buffer: 0, shortage: 0, short: 0 },
      ),
    [visible],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading headcount board…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
        <Button variant="outline" size="sm" className="ml-3" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }

  // A caller with the role but no scope row gets an empty list from the API. That is not the same
  // as "you are fully staffed", and saying so is the difference between a working page and a
  // silently wrong one.
  if (visible.length === 0 && unmapped.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 py-14 text-center">
        <Users className="w-8 h-8 mx-auto text-slate-300 mb-3" />
        <p className="font-semibold text-slate-700">No processes are mapped to you yet</p>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          Headcount and shortage are shown for the branches and processes you are assigned to. Ask
          an administrator to map you under Settings → User Roles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <KpiCardGrid>
        <KpiCard title="Mandate" value={totals.mandate} description="Seats billed to clients" tone="brand" />
        <KpiCard title="Active headcount" value={totals.active} description="People on these processes today" tone="people" />
        <KpiCard title="Buffer to maintain" value={totals.buffer} description="Spare capacity target" tone="info" />
        <KpiCard
          title="Shortage"
          value={totals.shortage}
          description={`${totals.short} process${totals.short === 1 ? "" : "es"} below target`}
          tone={totals.shortage > 0 ? "danger" : "success"}
        />
      </KpiCardGrid>

      {summary && summary.unmapped_mandate > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>{summary.unmapped_mandate} mandated seats</strong> sit on{" "}
            {summary.unmapped_cost_centres} cost centre
            {summary.unmapped_cost_centres === 1 ? "" : "s"} with no process mapping, so they are
            not counted in any row above. Set the process on those cost centres in Cost Centre
            Master to bring them onto this board.
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Mandate and buffer % come from the client billing configuration. Click a row for the cost
          centres behind it.
        </p>
        <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => void load()}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left font-semibold px-4 py-2.5">Branch / Process</th>
              <th className="text-right font-semibold px-3 py-2.5">Mandate</th>
              <th className="text-right font-semibold px-3 py-2.5">Active</th>
              <th className="text-right font-semibold px-3 py-2.5">Buffer now</th>
              <th className="text-right font-semibold px-3 py-2.5">Buffer target</th>
              <th className="text-right font-semibold px-3 py-2.5">Shortage</th>
              <th className="text-right font-semibold px-3 py-2.5">In notice</th>
              <th className="text-center font-semibold px-3 py-2.5">Risk</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.mandate_id}
                onClick={() => setSelected(r)}
                className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
              >
                <td className="px-4 py-2.5">
                  <div className="font-semibold text-slate-800">{r.process_name}</div>
                  <div className="text-xs text-slate-500">{r.branch_name}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.mandated_hc}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.active_hc}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <BufferCell value={r.buffer_count} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {r.buffer_to_maintain} <span className="text-[10px]">({r.buffer_pct}%)</span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold">
                  {r.shortage > 0 ? (
                    <span className="text-red-600">{r.shortage}</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                  {r.in_notice_count || "—"}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${RISK_BADGE[r.risk_level]}`}
                  >
                    {r.risk_level}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmapped.length > 0 && (
        <div className="rounded-xl border border-slate-200">
          <div className="px-4 py-2.5 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
            Unmapped mandate — no process set on the cost centre
          </div>
          <table className="w-full text-sm">
            <tbody>
              {unmapped.map((u) => (
                <tr key={u.branch_id ?? u.branch_name} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 font-semibold text-slate-700">{u.branch_name}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500">
                    {u.cost_centre_count} cost centre{u.cost_centre_count === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {u.mandated_hc} seats
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RightDetailDrawer
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected ? selected.process_name : ""}
        description={
          selected ? `${selected.branch_name} · mandate ${selected.mandated_hc} seats` : undefined
        }
      >
        {selected && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Mandate headcount", selected.mandated_hc],
                  ["Available active headcount", selected.active_hc],
                  [
                    "Buffer carried today",
                    selected.buffer_count > 0 ? `+${selected.buffer_count}` : selected.buffer_count,
                  ],
                  ["Buffer to be maintained", `${selected.buffer_to_maintain} (${selected.buffer_pct}%)`],
                  ["Target headcount", selected.target_hc],
                  ["Shortage", selected.shortage],
                  ["In notice", selected.in_notice_count],
                  ["Coverage", selected.coverage_pct == null ? "—" : `${selected.coverage_pct}%`],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {label}
                  </div>
                  <div className="text-lg font-semibold text-slate-800 tabular-nums">{value}</div>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
              Shortage = mandate ({selected.mandated_hc}) + buffer to maintain (
              {selected.buffer_to_maintain}) − active ({selected.active_hc}), floored at zero.
              {selected.hiring_recommendation > 0 && (
                <>
                  {" "}
                  Recommended hiring including projected exits:{" "}
                  <strong>{selected.hiring_recommendation}</strong>.
                </>
              )}
            </div>
          </div>
        )}
      </RightDetailDrawer>
    </div>
  );
}

export default HeadcountShortagePanel;
