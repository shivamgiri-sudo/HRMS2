import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, CartesianGrid, LabelList } from "recharts";
import { Clock3, Gauge, PhoneCall, PlugZap, Target } from "lucide-react";
import { KpiCard } from "./DashboardKit";
import { TOOLTIP_PROPS } from "./lpCallShared";
import type { SbiCapacity } from "./sbiCardTypes";
import { PAL, reduceMotion } from "./sbiViz";
import { Empty, SortTable, nz, type Col } from "./SbiCardShared";

/**
 * Penetration and capacity, the client's Pen Estimation arithmetic: every loaded account is owed `target` dials (3), so Dials Required =
 * accounts x target; the gap, turned into login hours at the dials-per-hour the APR shows, is what staffing has to find. Downtime is
 * users x hours lost, the tracker's own "Total Downtime".
 */
const cols: Array<Col<SbiCapacity["rows"][number]>> = [
  { key: "t", label: "Call table", align: "left", value: (r) => r.table },
  { key: "a", label: "Accounts", value: (r) => r.accounts },
  { key: "r", label: "Dials required", value: (r) => r.requiredDials },
  { key: "d", label: "Attempts", value: (r) => r.attempts },
  { key: "s", label: "Shortfall", value: (r) => r.shortfallDials },
  { key: "p", label: "Penetration", value: (r) => r.penetration, render: (r) => r.penetration.toFixed(2) },
  { key: "st", label: "Status", align: "left", value: (r) => r.status, render: (r) => (
    <span className={`font-semibold ${r.status === "on-target" ? "text-emerald-700" : "text-red-700"}`}>{r.status === "on-target" ? "✓ On target" : "▼ Behind"}</span>) },
];

export function CapacityPanel({ cap }: { cap: SbiCapacity }) {
  if (!cap.total.accounts) return <Empty>No account file in this range, so penetration per call table can't be worked out. Upload the day-end export.</Empty>;
  const t = cap.total; const c = cap.capacity;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        <KpiCard icon={Gauge} tone={t.penetration >= cap.target ? "emerald" : "rose"} label="Penetration" value={t.penetration.toFixed(2)} sub={`dials per account · target ${cap.target}${cap.targetFromClient ? "" : " (client's sheet)"}`} />
        <KpiCard icon={Target} tone="amber" label="Dial gap" value={nz(t.shortfallDials)} sub={`of ${nz(t.requiredDials)} required · ${t.behindTables} table(s) behind`} />
        <KpiCard icon={PhoneCall} tone="indigo" label="Dials per login hour" value={c ? String(c.dph) : "—"} sub={c ? `from the APR · ${c.loginHours} login hrs` : "needs the APR"} />
        <KpiCard icon={Clock3} tone="violet" label="Hours to close the gap" value={c ? `${c.extraHoursToCloseGap} h` : "—"} sub={c ? `${c.requiredHoursAtTarget} h in all at target` : "needs the APR"} />
        <KpiCard icon={PlugZap} tone={cap.downtime.agentHoursLost > 0 ? "rose" : "teal"} label="Lost to downtime" value={`${cap.downtime.agentHoursLost} h`} sub={cap.downtime.events ? `${cap.downtime.events} outage(s)${cap.downtime.dialsLost !== null ? ` · ≈ ${nz(cap.downtime.dialsLost)} dials` : ""}` : "no outages in range"} />
      </div>
      <div role="img" aria-label="Penetration by call table against the target" style={{ height: Math.max(180, cap.rows.length * 34 + 40) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={cap.rows} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={PAL.grid} horizontal={false} />
            <XAxis type="number" domain={[0, Math.max(cap.target + 1, ...cap.rows.map((r) => r.penetration)) ]} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="table" width={150} interval={0} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_PROPS} formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)} dials per account` : "—")} />
            <ReferenceLine x={cap.target} stroke={PAL.ink} strokeDasharray="4 3" label={{ value: `target ${cap.target}`, position: "top", fontSize: 10, fill: PAL.inkSoft }} />
            <Bar dataKey="penetration" name="Penetration" radius={[0, 4, 4, 0]} isAnimationActive={!reduceMotion}>
              {cap.rows.map((r) => <Cell key={r.table} fill={r.status === "on-target" ? PAL.aqua : PAL.orange} />)}
              <LabelList dataKey="penetration" position="right" formatter={(v: unknown) => Number(v).toFixed(2)} style={{ fontSize: 11, fill: PAL.ink }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SortTable rows={cap.rows} cols={cols} caption="Penetration and dial shortfall by call table" rowKey={(r) => r.table} />
      <p className="text-[11px] text-slate-500">Dials required = accounts loaded × {cap.target}, as in the client's Pen Estimation sheet. Dials per login hour = APR calls ÷ APR login hours over the range. Downtime hours = users impacted × outage hours.</p>
    </div>
  );
}
