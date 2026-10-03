/**
 * SBI Card Collections -- teams and team leaders (pure calculations, no DB).
 *
 * The day-end export names an agent by DIALER ID only. The roster (TEAM_LIST) says who that is, which team (HIGHBAL / LOWBAL) and which
 * team leader. With it we can answer what the floor needs: how each team leader's people are converting, and whether the high-balance
 * accounts are being worked by the high-balance team. The APR names people, not dialer ids, so it joins to the roster by NAME, and only
 * when the name is unique in the roster; the page says how many agents matched.
 */
import type { AccountOpsRow } from "./sbi-card-collections-ops.calc.js";
import type { AgentTimeRow } from "./sbi-card-agent-time.calc.js";
import { isNoConversation, isPromise, parseCallTable } from "./sbi-card-dispositions.js";
import { chiSquareP } from "./sbi-card-stats.js";

export interface RosterRow { dialerId: string; employeeId: string | null; name: string | null; gh: string | null; team: string | null; teamLeader: string | null; mode: string | null }
export type TeamKind = "HIGHBAL" | "LOWBAL" | "OTHER";
export const teamKind = (team: string | null | undefined): TeamKind => { const t = String(team ?? "").toUpperCase(); return t.includes("HIGH") ? "HIGHBAL" : t.includes("LOW") ? "LOWBAL" : "OTHER"; };
/** High / low balance by the call table: HB and HB1 are high balance, _L_ is low balance (see parseCallTable). */
export const tableKind = (callTable: string | null | undefined): "high" | "low" | "other" => { const t = parseCallTable(callTable).tier; return t === "HB" || t === "HB1" ? "high" : t === "Low" ? "low" : "other"; };
const norm = (s: string | null | undefined): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const r1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (n: number, d: number): number => (d > 0 ? r1((n / d) * 100) : 0);

export interface GroupRow {
  key: string; teams: string[]; agents: number; activeAgents: number; attempts: number; accountsTouched: number; ptp: number; ptpPct: number; deadPct: number;
  aprMatched: number; loginHours: number | null; utilisationPct: number | null; pausePct: number | null; callsPerLoginHour: number | null;
}
export interface TeamBoard {
  hasRoster: boolean; rosterSize: number;
  byTeam: GroupRow[]; byLeader: GroupRow[];
  alignment: {
    high: { attempts: number; byHighbal: number; byLowbal: number; byOther: number; lowbalPct: number };
    low: { attempts: number; byLowbal: number; byHighbal: number; byOther: number; highbalPct: number };
  };
  unmapped: { agents: number; attempts: number; pct: number };
  apr: { agents: number; matched: number };
  evidence: { leaderPtpP: number | null };
}

interface Acc { attempts: number; ptp: number; dead: number; accounts: Set<string> }

export function teamOf(roster: RosterRow[], accounts: AccountOpsRow[], apr: AgentTimeRow[]): TeamBoard {
  const byDialer = new Map(roster.map((r) => [r.dialerId, r] as const));
  const per = new Map<string, Acc>();
  const align = { high: { all: 0, HIGHBAL: 0, LOWBAL: 0, OTHER: 0 }, low: { all: 0, HIGHBAL: 0, LOWBAL: 0, OTHER: 0 } };
  let totalAttempts = 0; let unmappedAttempts = 0; const unmappedIds = new Set<string>();
  for (const a of accounts) {
    const kind = tableKind(a.callTable);
    for (const t of a.attempts) {
      if (!t.agent) continue;
      totalAttempts += 1;
      const e = byDialer.get(String(t.agent));
      const acc = per.get(String(t.agent)) ?? { attempts: 0, ptp: 0, dead: 0, accounts: new Set<string>() };
      acc.attempts += 1; if (isPromise(t.disp)) acc.ptp += 1; if (isNoConversation(t.disp)) acc.dead += 1; acc.accounts.add(a.accountNo); per.set(String(t.agent), acc);
      if (!e) { unmappedAttempts += 1; unmappedIds.add(String(t.agent)); }
      if (kind !== "other") { const g = kind === "high" ? align.high : align.low; g.all += 1; g[e ? teamKind(e.team) : "OTHER"] += 1; }
    }
  }

  // APR joins by NAME, only where the name is unique in the roster.
  const rosterByName = new Map<string, RosterRow[]>();
  for (const r of roster) { const k = norm(r.name); if (k) rosterByName.set(k, [...(rosterByName.get(k) ?? []), r]); }
  const aprBy = new Map<string, { login: number; busy: number; pause: number; calls: number }>(); let aprMatched = 0;
  const aprAgents = new Set<string>();
  const aprByDialer = new Map<string, { login: number; busy: number; pause: number; calls: number }>();
  for (const r of apr) {
    aprAgents.add(r.employeeId);
    const hits = rosterByName.get(norm(r.name));
    if (!hits || hits.length !== 1) continue;
    const d = hits[0]!.dialerId; const a = aprByDialer.get(d) ?? { login: 0, busy: 0, pause: 0, calls: 0 };
    a.login += r.loginSec ?? 0; a.busy += (r.talkSec ?? 0) + (r.dispoSec ?? 0); a.pause += r.pauseSec ?? 0; a.calls += r.calls ?? 0; aprByDialer.set(d, a);
  }
  aprMatched = aprByDialer.size; void aprBy;

  const group = (keyOf: (r: RosterRow) => string | null): GroupRow[] => {
    const g = new Map<string, { rows: RosterRow[] }>();
    for (const r of roster) { const k = keyOf(r); if (k) (g.get(k) ?? g.set(k, { rows: [] }).get(k)!).rows.push(r); }
    return [...g.entries()].map(([key, { rows }]) => {
      let attempts = 0; let ptp = 0; let dead = 0; let active = 0; const touched = new Set<string>();
      let login = 0; let busy = 0; let pause = 0; let calls = 0; let matched = 0;
      for (const r of rows) {
        const a = per.get(r.dialerId); if (a) { attempts += a.attempts; ptp += a.ptp; dead += a.dead; active += 1; a.accounts.forEach((x) => touched.add(x)); }
        const p = aprByDialer.get(r.dialerId); if (p) { matched += 1; login += p.login; busy += p.busy; pause += p.pause; calls += p.calls; }
      }
      return {
        key, teams: [...new Set(rows.map((r) => r.team).filter((t): t is string => !!t))].sort(), agents: rows.length, activeAgents: active, attempts, accountsTouched: touched.size,
        ptp, ptpPct: pct(ptp, attempts), deadPct: pct(dead, attempts), aprMatched: matched,
        loginHours: matched ? r1(login / 3600) : null, utilisationPct: login > 0 ? pct(busy, login) : null, pausePct: login > 0 ? pct(pause, login) : null,
        callsPerLoginHour: login > 0 ? r1(calls / (login / 3600)) : null,
      };
    }).sort((x, y) => y.attempts - x.attempts || x.key.localeCompare(y.key));
  };
  const byLeader = group((r) => r.teamLeader);
  const withEnough = byLeader.filter((l) => l.attempts >= 30);
  return {
    hasRoster: roster.length > 0, rosterSize: roster.length,
    byTeam: group((r) => r.team), byLeader,
    alignment: {
      high: { attempts: align.high.all, byHighbal: align.high.HIGHBAL, byLowbal: align.high.LOWBAL, byOther: align.high.OTHER, lowbalPct: pct(align.high.LOWBAL, align.high.all) },
      low: { attempts: align.low.all, byLowbal: align.low.LOWBAL, byHighbal: align.low.HIGHBAL, byOther: align.low.OTHER, highbalPct: pct(align.low.HIGHBAL, align.low.all) },
    },
    unmapped: { agents: unmappedIds.size, attempts: unmappedAttempts, pct: pct(unmappedAttempts, totalAttempts) },
    apr: { agents: aprAgents.size, matched: aprMatched },
    evidence: { leaderPtpP: withEnough.length >= 2 ? chiSquareP(withEnough.map((l) => [l.ptp, l.attempts - l.ptp] as [number, number])) : null },
  };
}
