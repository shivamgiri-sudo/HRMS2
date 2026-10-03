import { Users, UserCheck, Shuffle, HelpCircle } from "lucide-react";
import { KpiCard } from "./DashboardKit";
import type { SbiTeam, SbiTeamGroup } from "./sbiCardTypes";
import { PAL } from "./sbiViz";
import { Empty, SortTable, nz, pctTxt, type Col } from "./SbiCardShared";
import { SignalNote } from "./SbiCardOpsCharts";

/**
 * Teams and team leaders, from the agent roster (TEAM_LIST): who the dialer ids are, how each team leader's people convert, and whether the
 * high-balance tables are worked by the high-balance team. The APR names people, not dialer ids, so utilisation joins by unique name only.
 */
const cols = (first: string, withTeam = true): Array<Col<SbiTeamGroup>> => [
  { key: "k", label: first, align: "left", value: (r) => r.key },
  ...(withTeam ? [{ key: "t", label: "Team", align: "left" as const, value: (r: SbiTeamGroup) => r.teams.join(", ") || "—" }] : []),
  { key: "a", label: "Agents", value: (r) => r.agents },
  { key: "ac", label: "Dialled", value: (r) => r.activeAgents },
  { key: "at", label: "Attempts", value: (r) => r.attempts },
  { key: "tc", label: "Accounts touched", value: (r) => r.accountsTouched },
  { key: "p", label: "PTP", value: (r) => r.ptp },
  { key: "py", label: "PTP % of attempts", value: (r) => r.ptpPct, render: (r) => pctTxt(r.ptpPct) },
  { key: "d", label: "Dead-line %", value: (r) => r.deadPct, render: (r) => pctTxt(r.deadPct) },
  { key: "u", label: "Utilisation %", value: (r) => r.utilisationPct, render: (r) => (r.utilisationPct === null ? "—" : pctTxt(r.utilisationPct)) },
  { key: "pa", label: "Pause %", value: (r) => r.pausePct, render: (r) => (r.pausePct === null ? "—" : pctTxt(r.pausePct)) },
  { key: "m", label: "APR matched", value: (r) => r.aprMatched },
];

function Split({ label, parts }: { label: string; parts: Array<{ name: string; n: number; color: string }> }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (total === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-slate-700">{label}</p>
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.n}`).join(", ")}`} className="flex h-6 overflow-hidden rounded-lg bg-slate-100">
        {parts.filter((p) => p.n > 0).map((p) => <div key={p.name} title={`${p.name}: ${p.n}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color, borderRight: "2px solid #fff" }} />)}
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-4 text-[11px] text-slate-600">
        {parts.map((p) => <li key={p.name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />{p.name} <b className="tabular-nums">{nz(p.n)}</b> ({pctTxt(total ? (p.n / total) * 100 : 0)})</li>)}
      </ul>
    </div>
  );
}

export function TeamPanel({ team }: { team: SbiTeam }) {
  if (!team.hasRoster) return <Empty>No agent roster loaded. Upload the TEAM_LIST under SBI Card uploaders → Agent roster to see agents by name, team and team leader, and whether high-balance accounts reach the high-balance team.</Empty>;
  const a = team.alignment;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <KpiCard icon={Users} tone="sky" label="Roster" value={nz(team.rosterSize)} sub={`${team.byLeader.length} team leader(s) · ${team.byTeam.map((t) => `${t.key} ${t.agents}`).join(" · ")}`} />
        <KpiCard icon={Shuffle} tone={a.high.attempts > 0 && a.high.lowbalPct >= 10 ? "rose" : "emerald"} label="High-balance calls by LOWBAL" value={a.high.attempts ? pctTxt(a.high.lowbalPct) : "—"} sub={`${nz(a.high.byLowbal)} of ${nz(a.high.attempts)} attempts on HB tables`} />
        <KpiCard icon={UserCheck} tone={a.low.attempts > 0 && a.low.highbalPct >= 25 ? "amber" : "teal"} label="Low-balance calls by HIGHBAL" value={a.low.attempts ? pctTxt(a.low.highbalPct) : "—"} sub={`${nz(a.low.byHighbal)} of ${nz(a.low.attempts)} attempts on low tables`} />
        <KpiCard icon={HelpCircle} tone={team.unmapped.pct >= 10 ? "amber" : "violet"} label="Dialer ids not on the roster" value={nz(team.unmapped.agents)} sub={`${pctTxt(team.unmapped.pct)} of attempts`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Split label="Who worked the high-balance tables (HB, HB1)" parts={[{ name: "HIGHBAL", n: a.high.byHighbal, color: PAL.blue }, { name: "LOWBAL", n: a.high.byLowbal, color: PAL.orange }, { name: "Not on roster", n: a.high.byOther, color: PAL.gray }]} />
        <Split label="Who worked the low-balance tables" parts={[{ name: "LOWBAL", n: a.low.byLowbal, color: PAL.blue }, { name: "HIGHBAL", n: a.low.byHighbal, color: PAL.orange }, { name: "Not on roster", n: a.low.byOther, color: PAL.gray }]} />
      </div>
      <div>
        <p className="mb-2 text-xs font-bold text-slate-700">Team leaders</p>
        <SignalNote p={team.evidence.leaderPtpP} what="PTP yield" />
        <SortTable rows={team.byLeader} cols={cols("Team leader")} caption="Team leader scorecard" rowKey={(r) => r.key} />
      </div>
      <div>
        <p className="mb-2 text-xs font-bold text-slate-700">Teams</p>
        <SortTable rows={team.byTeam} cols={cols("Team", false)} caption="Team scorecard" rowKey={(r) => r.key} />
      </div>
      <p className="text-[11px] text-slate-500">Attempts, promises and dead-line share come from the day-end export by dialer id. Utilisation and pause come from the APR, joined to the roster by name only where the name is unique ({team.apr.matched} of {team.apr.agents} APR agents matched).</p>
    </div>
  );
}
