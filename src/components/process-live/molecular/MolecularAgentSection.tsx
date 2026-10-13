/**
 * Molecular Email Dashboard — Daily / Agent performance (MOL-03).
 * Ticket counts (per assigned agent) and APR time (MOEMAIL campaign) are linked
 * by agent name and date; a side with no record is shown as missing, never as 0.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, Loading, MissingBadge, Notice } from "./MolecularUi";
import { fmtPct, fmtSecs, molApi, type MolAgentDayRow, type MolFilters } from "./molecularApi";

interface AgentAgg {
  agent: string;
  received: number | null; closed: number | null; pendingAssigned: number | null;
  talkSec: number | null; waitSec: number | null; pauseSec: number | null; netLoginSec: number | null;
  closurePct: number | null; utilization: number | null;
  hasTickets: boolean; hasApr: boolean;
}

const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

function aggregate(rows: MolAgentDayRow[]): AgentAgg[] {
  const m = new Map<string, AgentAgg>();
  for (const r of rows) {
    const key = r.agent.toLowerCase();
    const a = m.get(key) ?? {
      agent: r.agent, received: null, closed: null, pendingAssigned: null, talkSec: null, waitSec: null, pauseSec: null,
      netLoginSec: null, closurePct: null, utilization: null, hasTickets: false, hasApr: false,
    };
    if (r.dataStatus !== "apr_only") {
      a.hasTickets = true;
      a.received = add(a.received, r.received);
      a.closed = add(a.closed, r.closed);
      a.pendingAssigned = add(a.pendingAssigned, r.pendingAssigned);
    }
    if (r.dataStatus !== "tickets_only") {
      a.hasApr = true;
      a.talkSec = add(a.talkSec, r.talkSec);
      a.waitSec = add(a.waitSec, r.waitSec);
      a.pauseSec = add(a.pauseSec, r.pauseSec);
      a.netLoginSec = add(a.netLoginSec, r.netLoginSec);
    }
    m.set(key, a);
  }
  for (const a of m.values()) {
    a.closurePct = a.received && a.received > 0 ? Math.round(((a.closed ?? 0) / a.received) * 10000) / 100 : null;
    a.utilization = a.netLoginSec && a.netLoginSec > 0 ? Math.round((((a.talkSec ?? 0) + (a.waitSec ?? 0)) / a.netLoginSec) * 10000) / 100 : null;
  }
  return [...m.values()].sort((x, y) => (y.closed ?? -1) - (x.closed ?? -1));
}

export function MolecularAgentSection({ f }: { f: MolFilters }) {
  const q = useQuery({ queryKey: ["mol", "agent-daily", f], queryFn: () => molApi.agentDaily(f), staleTime: 60_000 });
  const [day, setDay] = useState<string>("");

  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const days = useMemo(() => [...new Set(rows.map((r) => r.date))].sort(), [rows]);
  const agents = useMemo(() => aggregate(day ? rows.filter((r) => r.date === day) : rows), [rows, day]);
  const daily = useMemo(() => days.map((d) => {
    const rs = rows.filter((r) => r.date === d && r.dataStatus !== "apr_only");
    const rec = rs.reduce((s, r) => s + (r.received ?? 0), 0);
    const clo = rs.reduce((s, r) => s + (r.closed ?? 0), 0);
    return { date: d, closurePct: rec > 0 ? Math.round((clo / rec) * 10000) / 100 : null, received: rec, closed: clo };
  }), [rows, days]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  if (rows.length === 0) return <Notice tone="warn">No agent ticket or APR data in this period.</Notice>;

  const chartAgents = agents.slice(0, 25).map((a) => ({
    agent: a.agent,
    closed: a.closed,
    utilization: a.utilization,
    talkH: a.talkSec === null ? null : a.talkSec / 3600,
    waitH: a.waitSec === null ? null : a.waitSec / 3600,
    pauseH: a.pauseSec === null ? null : a.pauseSec / 3600,
  }));
  const missingApr = agents.filter((a) => !a.hasApr).length;
  const missingTickets = agents.filter((a) => !a.hasTickets).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="font-semibold text-slate-600" htmlFor="mol-day">Day</label>
        <select id="mol-day" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 rounded-md border border-slate-300 px-2">
          <option value="">Whole period</option>
          {days.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {(missingApr > 0 || missingTickets > 0) && (
          <Notice tone="warn">
            {missingApr > 0 && `${missingApr} agent(s) have tickets but no APR time. `}
            {missingTickets > 0 && `${missingTickets} agent(s) have APR time but no tickets. `}
            Missing sides are not counted as zero. Agents are matched by name (ticket-system user vs HRMS employee of the dialler code).
          </Notice>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tickets closed per agent" sub="By final-closed date (top 25)">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartAgents}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="agent" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="closed" name="Closed" fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Daily closure %" sub="Closed that day ÷ received that day (assigned tickets)">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis unit="%" />
              <Tooltip />
              <Line dataKey="closurePct" name="Closure %" stroke="#2563eb" strokeWidth={2} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Utilization per agent" sub="(Talk + Wait) ÷ Net login — APR, MOEMAIL campaign">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartAgents}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="agent" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis unit="%" />
              <Tooltip />
              <Bar dataKey="utilization" name="Utilization %" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Talk / Wait / Pause per agent" sub="Hours, APR">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartAgents}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="agent" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis />
              <Tooltip formatter={(v: number) => `${Number(v).toFixed(2)} h`} />
              <Legend />
              <Bar dataKey="talkH" name="Talk" stackId="t" fill="#16a34a" />
              <Bar dataKey="waitH" name="Wait" stackId="t" fill="#60a5fa" />
              <Bar dataKey="pauseH" name="Pause" stackId="t" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Agent ranking" sub="Workload, output, backlog and time. Agent closure % = closed ÷ received (assigned) — business denominator to be confirmed.">
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr><th className="py-1">#</th><th>Agent</th><th className="text-right">Received</th><th className="text-right">Closed</th><th className="text-right">Pending assigned</th><th className="text-right">Closure %</th><th className="text-right">Net login</th><th className="text-right">Talk</th><th className="text-right">Wait</th><th className="text-right">Pause</th><th className="text-right">Utilization</th></tr>
            </thead>
            <tbody>
              {agents.map((a, i) => (
                <tr key={a.agent} className="border-t border-slate-100">
                  <td className="py-1">{i + 1}</td>
                  <td>{a.agent}{!a.hasApr && <MissingBadge what="APR" />}{!a.hasTickets && <MissingBadge what="tickets" />}</td>
                  <td className="text-right">{a.received ?? "N/A"}</td>
                  <td className="text-right">{a.closed ?? "N/A"}</td>
                  <td className="text-right">{a.pendingAssigned ?? "N/A"}</td>
                  <td className="text-right">{fmtPct(a.closurePct)}</td>
                  <td className="text-right">{fmtSecs(a.netLoginSec)}</td>
                  <td className="text-right">{fmtSecs(a.talkSec)}</td>
                  <td className="text-right">{fmtSecs(a.waitSec)}</td>
                  <td className="text-right">{fmtSecs(a.pauseSec)}</td>
                  <td className="text-right">{fmtPct(a.utilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
