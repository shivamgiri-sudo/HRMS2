/**
 * SBI Card Collections -- agent time utilisation from the dialer's Agent Time Detail (APR) export (pure calculations, no DB).
 *
 *   utilisation %   (talk + dispo) / login time          share of logged-in time spent on calls and wrap
 *   occupancy %     (talk + dispo) / (talk + dispo + wait)   how busy the agent is while available (excludes pause)
 *   pause %         pause / login time                    shrinkage
 *   wait %          wait / login time                     idle on the floor
 *   ACHT            call-weighted average of the dialer's per-agent ACHT (seconds)
 *   calls / login hr  calls / (login time in hours)
 * Attention flags compare an agent with the team over the same range (no client target exists yet): utilisation below
 * LOW_VS_TEAM x team, pause above HIGH_VS_TEAM x team, calls per login hour below LOW_VS_TEAM x team. So the list always points at
 * the outliers instead of flagging everyone on a slow day. Empty denominators give null, never a fabricated 0 or NaN.
 */
import { round1 } from "./sbi-card-dashboard.calc.js";

export const LOW_VS_TEAM = 0.75;
export const HIGH_VS_TEAM = 1.25;

export interface AgentTimeRow {
  date: string; employeeId: string; name: string | null; calls: number | null; loginSec: number | null; waitSec: number | null;
  talkSec: number | null; dispoSec: number | null; pauseSec: number | null; deadSec: number | null; achtSec: number | null;
  firstLogin: string | null; lastLogout: string | null;
  lb: number | null; tb: number | null; wb: number | null; mb: number | null; qb: number | null; loginCode: number | null;
}
const n0 = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const rate = (num: number, den: number): number | null => (den > 0 ? round1((num / den) * 100) : null);

export interface AgentTimeAgent {
  employeeId: string; name: string | null; days: number; calls: number; loginHours: number; talkHours: number; dispoHours: number;
  waitHours: number; pauseHours: number; utilisationPct: number | null; occupancyPct: number | null; pausePct: number | null; waitPct: number | null;
  achtSec: number | null; callsPerLoginHour: number | null; firstLogin: string | null; lastLogout: string | null; flags: string[];
}
export interface AgentTimeOut {
  agents: AgentTimeAgent[];
  summary: {
    agents: number; days: number; calls: number; loginHours: number; utilisationPct: number | null; occupancyPct: number | null;
    pausePct: number | null; waitPct: number | null; achtSec: number | null; callsPerLoginHour: number | null; flagged: number;
  };
  pauseCodes: Array<{ code: string; hours: number; sharePct: number | null }>;
  daily: Array<{ date: string; agents: number; calls: number; utilisationPct: number | null; occupancyPct: number | null; pausePct: number | null; achtSec: number | null }>;
}

interface Acc {
  name: string | null; days: number; calls: number; login: number; wait: number; talk: number; dispo: number; pause: number; achtCalls: number;
  first: string | null; last: string | null;
}
const blank = (): Acc => ({ name: null, days: 0, calls: 0, login: 0, wait: 0, talk: 0, dispo: 0, pause: 0, achtCalls: 0, first: null, last: null });
const add = (a: Acc, r: AgentTimeRow): void => {
  a.name = a.name ?? r.name; a.days += 1; a.calls += n0(r.calls); a.login += n0(r.loginSec); a.wait += n0(r.waitSec);
  a.talk += n0(r.talkSec); a.dispo += n0(r.dispoSec); a.pause += n0(r.pauseSec); a.achtCalls += n0(r.achtSec) * n0(r.calls);
  if (r.firstLogin && (!a.first || r.firstLogin < a.first)) a.first = r.firstLogin;
  if (r.lastLogout && (!a.last || r.lastLogout > a.last)) a.last = r.lastLogout;
};
const metrics = (a: Acc) => ({
  utilisationPct: rate(a.talk + a.dispo, a.login), occupancyPct: rate(a.talk + a.dispo, a.talk + a.dispo + a.wait),
  pausePct: rate(a.pause, a.login), waitPct: rate(a.wait, a.login),
  achtSec: a.calls > 0 ? Math.round(a.achtCalls / a.calls) : null,
  callsPerLoginHour: a.login > 0 ? round1(a.calls / (a.login / 3600)) : null,
});
const hrs = (sec: number): number => round1(sec / 3600);

export function agentTimeOf(rows: AgentTimeRow[]): AgentTimeOut {
  const per = new Map<string, Acc>(); const day = new Map<string, Acc & { ids: Set<string> }>(); const all = blank();
  const codes = { LB: 0, TB: 0, WB: 0, MB: 0, QB: 0, LOGIN: 0 };
  for (const r of rows) {
    const a = per.get(r.employeeId) ?? blank(); add(a, r); per.set(r.employeeId, a);
    const d = day.get(r.date) ?? { ...blank(), ids: new Set<string>() }; add(d, r); d.ids.add(r.employeeId); day.set(r.date, d);
    add(all, r);
    codes.LB += n0(r.lb); codes.TB += n0(r.tb); codes.WB += n0(r.wb); codes.MB += n0(r.mb); codes.QB += n0(r.qb); codes.LOGIN += n0(r.loginCode);
  }
  const team = metrics(all);
  const agents: AgentTimeAgent[] = [...per.entries()].map(([employeeId, a]) => {
    const m = metrics(a); const flags: string[] = [];
    if (m.utilisationPct !== null && team.utilisationPct !== null && m.utilisationPct < team.utilisationPct * LOW_VS_TEAM) flags.push("Low utilisation");
    if (m.pausePct !== null && team.pausePct !== null && m.pausePct > team.pausePct * HIGH_VS_TEAM) flags.push("High pause");
    if (m.callsPerLoginHour !== null && team.callsPerLoginHour !== null && m.callsPerLoginHour < team.callsPerLoginHour * LOW_VS_TEAM) flags.push("Low call rate");
    return {
      employeeId, name: a.name, days: a.days, calls: a.calls, loginHours: hrs(a.login), talkHours: hrs(a.talk), dispoHours: hrs(a.dispo),
      waitHours: hrs(a.wait), pauseHours: hrs(a.pause), ...m, firstLogin: a.first, lastLogout: a.last, flags,
    };
  }).sort((x, y) => y.flags.length - x.flags.length || (x.utilisationPct ?? 999) - (y.utilisationPct ?? 999) || x.employeeId.localeCompare(y.employeeId));
  const named = codes.LB + codes.TB + codes.WB + codes.MB + codes.QB + codes.LOGIN;
  const other = Math.max(0, all.pause - named);
  const pauseCodes = [...Object.entries(codes), ["Other / unnamed", other] as [string, number]]
    .map(([code, sec]) => ({ code, hours: hrs(sec), sharePct: rate(sec, all.pause) }))
    .filter((c) => c.hours > 0).sort((a, b) => b.hours - a.hours);
  return {
    agents,
    summary: { agents: per.size, days: day.size, calls: all.calls, loginHours: hrs(all.login), ...metrics(all), flagged: agents.filter((a) => a.flags.length > 0).length },
    pauseCodes,
    daily: [...day.entries()].map(([date, d]) => {
      const m = metrics(d); return { date, agents: d.ids.size, calls: d.calls, utilisationPct: m.utilisationPct, occupancyPct: m.occupancyPct, pausePct: m.pausePct, achtSec: m.achtSec };
    }).sort((a, b) => a.date.localeCompare(b.date)),
  };
}
