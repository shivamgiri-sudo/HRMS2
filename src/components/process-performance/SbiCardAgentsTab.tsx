import { useMemo, useState } from "react";
import type { SbiAgentRow, SbiAgentTime, SbiTeamRow } from "./sbiCardTypes";
import { SbiCardAgentTimePanel } from "./SbiCardAgentTimePanel";
import { Empty, SortTable, inr, nz, ratio, pctTxt, timeTxt, type Col } from "./SbiCardShared";

const teamCols: Array<Col<SbiTeamRow>> = [
  { key: "team", label: "Team", align: "left", value: (r) => r.team ?? "—" },
  { key: "tl", label: "Team leader", align: "left", value: (r) => r.teamLeader ?? "—" },
  { key: "agents", label: "Agents", value: (r) => r.agents },
  { key: "calls", label: "Calls", value: (r) => r.calls },
  { key: "contacts", label: "Contacts", value: (r) => r.contacts },
  { key: "cr", label: "Contact %", value: (r) => ratio(r.contacts, r.calls), render: (r) => pctTxt(ratio(r.contacts, r.calls)) },
  { key: "ptp", label: "PTP", value: (r) => r.ptp },
  { key: "pad", label: "PAD", value: (r) => r.pad },
  { key: "amt", label: "Amount collected", value: (r) => r.amountCollected, render: (r) => inr(r.amountCollected) },
];

const agentCols: Array<Col<SbiAgentRow>> = [
  { key: "name", label: "Agent", align: "left", value: (r) => r.name ?? r.dialerId ?? r.employeeId ?? "—" },
  { key: "emp", label: "Emp ID", align: "left", value: (r) => r.employeeId ?? "—" },
  { key: "tl", label: "Team leader", align: "left", value: (r) => r.teamLeader ?? "—" },
  { key: "team", label: "Team", align: "left", value: (r) => r.team ?? "—" },
  { key: "days", label: "Days", value: (r) => r.days },
  { key: "calls", label: "Calls", value: (r) => r.calls },
  { key: "contacts", label: "Contacts", value: (r) => r.contacts },
  { key: "ptp", label: "PTP", value: (r) => r.ptp },
  { key: "pad", label: "PAD", value: (r) => r.pad },
  { key: "amt", label: "Amount collected", value: (r) => r.amountCollected, render: (r) => inr(r.amountCollected) },
  { key: "in", label: "First login", value: (r) => timeTxt(r.firstLogin) },
  { key: "out", label: "Last logout", value: (r) => timeTxt(r.lastLogout) },
  { key: "leak", label: "Leakage", value: (r) => (typeof r.leakage === "number" ? r.leakage : r.leakage ?? null), render: (r) => (typeof r.leakage === "number" ? nz(r.leakage) : r.leakage ?? "—") },
];

export function SbiCardAgentsTab({ agents, teams, time }: { agents: SbiAgentRow[]; teams: SbiTeamRow[]; time: SbiAgentTime }) {
  const [tl, setTl] = useState("");
  const leaders = useMemo(() => [...new Set(agents.map((a) => a.teamLeader).filter((x): x is string => !!x))].sort(), [agents]);
  const shown = useMemo(() => (tl ? agents.filter((a) => a.teamLeader === tl) : agents), [agents, tl]);
  if (!agents.length && !teams.length && !time.agents.length) return <Empty>No agent data for this range. Upload the Agent MIS or the dialer Agent Time (APR) export to populate it.</Empty>;
  return (
    <div className="space-y-5">
      <SbiCardAgentTimePanel time={time} />
      <section aria-labelledby="sbi-teams">
        <h3 id="sbi-teams" className="mb-2 text-sm font-bold text-slate-800">Teams (by team leader)</h3>
        {teams.length ? <SortTable rows={teams} cols={teamCols} caption="Team performance" rowKey={(r, i) => `${r.team}|${r.teamLeader}|${i}`} /> : <Empty>No team data.</Empty>}
      </section>
      <section aria-labelledby="sbi-agents">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 id="sbi-agents" className="text-sm font-bold text-slate-800">Agents ({shown.length})</h3>
          <label className="flex items-center gap-2 text-xs text-slate-600">Team leader
            <select value={tl} onChange={(e) => setTl(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
              <option value="">All</option>
              {leaders.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <SortTable rows={shown} cols={agentCols} caption="Agent performance" rowKey={(r, i) => `${r.employeeId ?? r.dialerId}|${i}`} />
      </section>
    </div>
  );
}
