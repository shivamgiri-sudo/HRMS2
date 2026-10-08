import { Activity, Clock3, Gauge, PauseCircle, PhoneCall, Users } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { KpiCard } from "./DashboardKit";
import { TOOLTIP_PROPS } from "./lpCallShared";
import type { SbiAgentTime, SbiAgentTimeAgent } from "./sbiCardTypes";
import { PAL, reduceMotion } from "./sbiViz";
import { Empty, SortTable, nz, pctTxt, timeTxt, type Col } from "./SbiCardShared";

/**
 * Agent time utilisation from the dialer's Agent Time Detail (APR) export. Definitions: backend sbi-card-agent-time.calc.ts.
 * Utilisation = (talk + wrap) / login time; occupancy = busy / (busy + wait); pause % = pause / login time.
 * Colours follow the validated categorical order (talk, wrap, wait, pause) and every segment is labelled in the legend and the table.
 */
const mmss = (sec: number | null): string => (sec === null ? "—" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);

const cols: Array<Col<SbiAgentTimeAgent>> = [
  { key: "n", label: "Agent", align: "left", value: (r) => r.name ?? r.employeeId },
  { key: "e", label: "Emp ID", align: "left", value: (r) => r.employeeId },
  { key: "d", label: "Days", value: (r) => r.days },
  { key: "c", label: "Calls", value: (r) => r.calls },
  { key: "l", label: "Login hrs", value: (r) => r.loginHours },
  { key: "u", label: "Utilisation %", value: (r) => r.utilisationPct, render: (r) => pctTxt(r.utilisationPct) },
  { key: "o", label: "Occupancy %", value: (r) => r.occupancyPct, render: (r) => pctTxt(r.occupancyPct) },
  { key: "w", label: "Wait %", value: (r) => r.waitPct, render: (r) => pctTxt(r.waitPct) },
  { key: "p", label: "Pause %", value: (r) => r.pausePct, render: (r) => pctTxt(r.pausePct) },
  { key: "h", label: "Calls / login hr", value: (r) => r.callsPerLoginHour },
  { key: "a", label: "ACHT (m:ss)", value: (r) => r.achtSec, render: (r) => mmss(r.achtSec) },
  { key: "i", label: "First login", value: (r) => timeTxt(r.firstLogin) },
  { key: "x", label: "Last logout", value: (r) => timeTxt(r.lastLogout) },
  { key: "f", label: "Attention", align: "left", value: (r) => r.flags.join(", ") || "—", render: (r) => (r.flags.length ? <span className="font-semibold text-red-600">{r.flags.join(", ")}</span> : <span className="text-slate-400">—</span>) },
];

const PAUSE_COLORS = [PAL.blue, PAL.orange, PAL.aqua, PAL.yellow, PAL.magenta, PAL.violet, PAL.grayDark];

export function SbiCardAgentTimePanel({ time, bare = false }: { time: SbiAgentTime; bare?: boolean }) {
  const s = time.summary;
  if (!time.agents.length) return <Empty>No agent time (APR) data for this range. Upload the dialer Agent Time Detail export (AGENT_TIME*.csv) from the SBI Card uploaders.</Empty>;
  const stack = [...time.agents].sort((a, b) => (b.utilisationPct ?? -1) - (a.utilisationPct ?? -1)).slice(0, 30).map((a) => ({
    name: (a.name ?? a.employeeId).slice(0, 18), Talk: a.talkHours, Wrap: a.dispoHours, Wait: a.waitHours, Pause: a.pauseHours, flagged: a.flags.length > 0,
  }));
  const totalPause = time.pauseCodes.reduce((n, c) => n + c.hours, 0) || 1;
  return (
    <section aria-labelledby="sbi-apr" className="space-y-4">
      {!bare && <h3 id="sbi-apr" className="text-sm font-bold text-slate-800">Agent time utilisation (dialer APR)</h3>}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={Users} tone="sky" label="Agents logged in" value={nz(s.agents)} sub={`${s.days} day(s)`} />
        <KpiCard icon={Gauge} tone="emerald" label="Utilisation" value={pctTxt(s.utilisationPct)} sub="talk + wrap / login" />
        <KpiCard icon={Activity} tone="teal" label="Occupancy" value={pctTxt(s.occupancyPct)} sub="busy / busy + wait" />
        <KpiCard icon={PauseCircle} tone="amber" label="Pause" value={pctTxt(s.pausePct)} sub={`wait ${pctTxt(s.waitPct)}`} />
        <KpiCard icon={PhoneCall} tone="indigo" label="Calls / login hr" value={s.callsPerLoginHour === null ? "—" : String(s.callsPerLoginHour)} sub={`${nz(s.calls)} calls`} />
        <KpiCard icon={Clock3} tone={s.flagged > 0 ? "rose" : "violet"} label="ACHT" value={mmss(s.achtSec)} sub={`${s.flagged} agent(s) need attention`} />
      </div>

      <div>
        <p className="mb-1 text-xs font-bold text-slate-700">Where each agent's login time went (hours), most utilised first</p>
        <div role="img" aria-label="Stacked hours of talk, wrap, wait and pause for each agent" style={{ height: Math.max(220, stack.length * 24 + 50) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stack} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={3}>
              <CartesianGrid stroke={PAL.grid} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="h" />
              <YAxis type="category" dataKey="name" interval={0} width={112} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_PROPS} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)} h` : "—")} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Talk" stackId="t" fill={PAL.blue} isAnimationActive={!reduceMotion} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="Wrap" stackId="t" fill={PAL.orange} isAnimationActive={!reduceMotion} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="Wait" stackId="t" fill={PAL.aqua} isAnimationActive={!reduceMotion} stroke="#fff" strokeWidth={2} />
              <Bar dataKey="Pause" stackId="t" fill={PAL.yellow} isAnimationActive={!reduceMotion} stroke="#fff" strokeWidth={2} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {time.pauseCodes.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-bold text-slate-700">Pause time by dialer code</p>
          <div role="img" aria-label="Pause hours by code" className="flex h-7 overflow-hidden rounded-lg bg-slate-100">
            {time.pauseCodes.map((c, i) => (
              <div key={c.code} title={`${c.code}: ${c.hours} h`} style={{ width: `${(c.hours / totalPause) * 100}%`, background: PAUSE_COLORS[i % PAUSE_COLORS.length], borderRight: "2px solid #fff" }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
            {time.pauseCodes.map((c, i) => (
              <li key={c.code} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PAUSE_COLORS[i % PAUSE_COLORS.length] }} aria-hidden />{c.code} <b className="tabular-nums">{c.hours}h</b>{c.sharePct === null ? "" : ` · ${c.sharePct}%`}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs text-slate-700" open>
        <summary className="cursor-pointer rounded font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Agent table (flagged first)</summary>
        <div className="mt-2"><SortTable rows={time.agents} cols={cols} caption="Agent time utilisation" rowKey={(r) => r.employeeId} /></div>
      </details>
    </section>
  );
}
