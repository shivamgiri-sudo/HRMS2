import { describe, it, expect } from "vitest";
import { teamOf, teamKind, tableKind, type RosterRow } from "../sbi-card-team.calc.js";
import type { AccountOpsRow } from "../sbi-card-collections-ops.calc.js";
import type { AgentTimeRow } from "../sbi-card-agent-time.calc.js";

const R = (dialerId: string, name: string, team: string, teamLeader: string | null): RosterRow => ({ dialerId, employeeId: `E${dialerId}`, name, gh: null, team, teamLeader, mode: null });
const roster = [R("1", "Asha Rao", "HIGHBAL", "Sourabh"), R("2", "Bela Shah", "HIGHBAL", "Sourabh"), R("3", "Chitra Nair", "LOWBAL", "Ankit"), R("4", "Dev Anand", "LOWBAL", "Ankit")];
const acct = (accountNo: string, callTable: string, attempts: Array<[string, string]>): AccountOpsRow => ({
  accountNo, delq: "4", billingCycle: "5", cibil: 700, vintage: 40, region: "NORTH", productClass: null, accountClass: null, callTable, promo: null, ntc: "N", newToCard: "N",
  totalDue: 1000, curBal: 5000, cd: 3, lastActionCode: null, lastPtpDate: null, callbackDt: null, dnc: "N", dialCnt: null,
  attempts: attempts.map(([agent, disp], i) => ({ dt: `2026-09-25 1${i}:00:00`, disp, agent })),
});
const HB = "MAS_AHM_CD3_HB_25092026"; const LOW = "EL_DEL_CD2_JO_L_";

describe("team kinds", () => {
  it("reads HIGHBAL / LOWBAL however they are spelled, and the balance tier off the call table", () => {
    expect([teamKind("HIGHBAL"), teamKind("High Bal"), teamKind("lowbal"), teamKind("Collections"), teamKind(null)]).toEqual(["HIGHBAL", "HIGHBAL", "LOWBAL", "OTHER", "OTHER"]);
    expect([tableKind(HB), tableKind("MAS_AHM_CD3_PTP_HB1_25092026"), tableKind(LOW), tableKind("EL_DEL_CD2_JO_")]).toEqual(["high", "high", "low", "other"]);
  });
});

describe("alignment of agents to balance tier", () => {
  const accounts = [
    acct("A1", HB, [["1", "PTP"], ["3", "NC"]]), acct("A2", HB, [["3", "NC"], ["4", "NC"], ["2", "CBL"]]),   // 3 of 5 high-balance attempts by LOWBAL agents
    acct("A3", LOW, [["1", "NC"], ["3", "PTP"]]), acct("A4", HB, [["99", "NC"]]),                            // dialer id 99 is not on the roster
  ];
  const t = teamOf(roster, accounts, []);
  it("counts who worked the high-balance tables", () => {
    expect(t.alignment.high).toMatchObject({ attempts: 6, byHighbal: 2, byLowbal: 3, byOther: 1 });
    expect(t.alignment.high.lowbalPct).toBe(50);
    expect(t.alignment.low).toMatchObject({ attempts: 2, byHighbal: 1, byLowbal: 1 });
  });
  it("reports dialer ids that are not on the roster", () => {
    expect(t.unmapped).toMatchObject({ agents: 1, attempts: 1 });
    expect(t.unmapped.pct).toBe(12.5);          // 1 of the 8 attempts
  });
});

describe("team leader scorecards", () => {
  const accounts = [acct("A1", HB, [["1", "PTP"], ["2", "NC"], ["1", "NC"]]), acct("A2", HB, [["3", "PTP"], ["3", "PTP"], ["4", "VOML"]])];
  it("rolls attempts, promises and dead-line share up to the leader", () => {
    const t = teamOf(roster, accounts, []);
    const s = Object.fromEntries(t.byLeader.map((l) => [l.key, l]));
    expect(s.Sourabh).toMatchObject({ agents: 2, activeAgents: 2, attempts: 3, ptp: 1, accountsTouched: 1 });
    expect(s.Sourabh!.ptpPct).toBeCloseTo(33.3, 1);
    expect(s.Ankit).toMatchObject({ attempts: 3, ptp: 2 });
    expect(s.Ankit!.deadPct).toBeCloseTo(33.3, 1);
    expect(t.byTeam.map((x) => x.key).sort()).toEqual(["HIGHBAL", "LOWBAL"]);
    expect(t.evidence.leaderPtpP).toBeNull();            // too few attempts per leader to test
  });
  it("joins the APR by name, only when the name is unique, and reports how many matched", () => {
    const apr: AgentTimeRow[] = [
      { date: "2026-09-25", employeeId: "MAS1", name: "ASHA RAO", calls: 100, loginSec: 36000, waitSec: 0, talkSec: 14400, dispoSec: 3600, pauseSec: 7200, deadSec: 0, achtSec: 100, firstLogin: null, lastLogout: null, lb: null, tb: null, wb: null, mb: null, qb: null, loginCode: null },
      { date: "2026-09-25", employeeId: "MAS2", name: "Nobody Here", calls: 5, loginSec: 3600, waitSec: 0, talkSec: 0, dispoSec: 0, pauseSec: 0, deadSec: 0, achtSec: 0, firstLogin: null, lastLogout: null, lb: null, tb: null, wb: null, mb: null, qb: null, loginCode: null },
    ];
    const t = teamOf(roster, accounts, apr);
    expect(t.apr).toEqual({ agents: 2, matched: 1 });
    const l = t.byLeader.find((x) => x.key === "Sourabh")!;
    expect([l.aprMatched, l.loginHours, l.utilisationPct, l.pausePct, l.callsPerLoginHour]).toEqual([1, 10, 50, 20, 10]);
    const dup = teamOf([...roster, R("5", "Asha Rao", "LOWBAL", "Ankit")], accounts, apr);    // two people called Asha Rao: never guess
    expect(dup.apr.matched).toBe(0);
  });
  it("is empty and honest without a roster", () => {
    const t = teamOf([], accounts, []);
    expect([t.hasRoster, t.rosterSize, t.byLeader, t.unmapped.pct]).toEqual([false, 0, [], 100]);
  });
});
