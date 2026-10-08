import { describe, it, expect } from "vitest";
import { totalsOf, dailyRows, byCampaign, agentsOf, teamsOf, accountsOf, pct, type DialerRow, type AgentRow } from "../sbi-card-dashboard.calc.js";
import { resolveRange } from "../sbi-card-dashboard.service.js";

const d = (o: Partial<DialerRow>): DialerRow => ({
  date: "2026-08-01", campaign: "A", accountsCalled: 100, totalAccounts: 100, dials: 400, answers: 40, connects: 20, ptp: 5, pad: 1, otp: 0, totalContacts: 10, ...o,
});

describe("dialer totals", () => {
  it("uses the workbook's rate definitions", () => {
    const t = totalsOf([d({}), d({ campaign: "B", accountsCalled: null, totalAccounts: 100, dials: 600, connects: 30, ptp: 5, totalContacts: 10 })]);
    expect(t.accounts).toBe(200);
    expect(t.dials).toBe(1000);
    expect(t.contactRatePct).toBe(10);   // 20 contacts / 200 accounts
    expect(t.connectRatePct).toBe(5);    // 50 connects / 1000 dials
    expect(t.ptpRatePct).toBe(50);       // 10 ptp / 20 contacts
  });
  it("never produces NaN on empty input", () => {
    const t = totalsOf([]);
    expect([t.contactRatePct, t.connectRatePct, t.ptpRatePct]).toEqual([0, 0, 0]);
    expect(pct(1, 0)).toBe(0);
  });
  it("groups per day and per campaign", () => {
    const rows = [d({}), d({ date: "2026-08-02" }), d({ campaign: "B" })];
    expect(dailyRows(rows).map((r) => `${r.date}|${r.campaign}`)).toEqual(["2026-08-01|A", "2026-08-01|B", "2026-08-02|A"]);
    const c = byCampaign(rows);
    expect(c.find((x) => x.campaign === "A")!.dials).toBe(800);
  });
  it("daily rows carry the contacts the client needs to re-aggregate rates with the server's definition", () => {
    const r = dailyRows([d({ totalContacts: 50, accountsCalled: 200 })])[0]!;
    expect(r.contacts).toBe(totalsOf([d({ totalContacts: 50, accountsCalled: 200 })]).contacts);
    expect(r.contacts).toBe(50);
  });
});

describe("agents, teams, accounts", () => {
  const a = (o: Partial<AgentRow>): AgentRow => ({
    date: "2026-08-01", employeeId: "1", dialerId: "9", name: "Sarita", team: "HIGHBAL", teamLeader: "Sourabh", calls: 100, contacts: 10, ptp: 2, pad: 1,
    amtCollected: 500, firstLogin: "09:00:46", lastLogout: "18:40:12", leakageSeconds: 60, ...o,
  });
  it("rolls an agent over days and teams over agents", () => {
    const ag = agentsOf([a({}), a({ date: "2026-08-02", firstLogin: "08:55:00", lastLogout: "19:00:00", calls: 50 }), a({ employeeId: "2", team: null, teamLeader: null, calls: 10 })]);
    const one = ag.find((x) => x.employeeId === "1")!;
    expect(one).toMatchObject({ calls: 150, days: 2, firstLogin: "08:55:00", lastLogout: "19:00:00", leakage: 2, amountCollected: 1000 });
    const teams = teamsOf(ag);
    expect(teams.map((t) => t.team)).toEqual(["HIGHBAL", "Unassigned"]);
    expect(teams[0]).toMatchObject({ agents: 1, calls: 150 });
  });
  it("summarises the account file by delinquency and cycle", () => {
    const r = accountsOf([
      { delq: "2", billingCycle: "12", totalDue: 100, curBal: 1000 }, { delq: "10", billingCycle: "3", totalDue: 50, curBal: 500 }, { delq: "2", billingCycle: "12", totalDue: null, curBal: null },
    ]);
    expect(r).toMatchObject({ total: 3, totalDue: 150, curBal: 1500 });
    expect(r.byDelq).toEqual([{ delq: "2", count: 2, totalDue: 100 }, { delq: "10", count: 1, totalDue: 50 }]);
    expect(r.byBillingCycle).toEqual([{ cycle: "3", count: 1 }, { cycle: "12", count: 2 }]);
  });
});

describe("resolveRange", () => {
  const now = new Date(2026, 7, 19);
  it("prefers from/to, then month, then month-to-date", () => {
    expect(resolveRange("2026-07", "2026-08-05", "2026-08-09", now)).toEqual({ from: "2026-08-05", to: "2026-08-09" });
    expect(resolveRange("2026-07", undefined, undefined, now)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    expect(resolveRange(undefined, undefined, undefined, now)).toEqual({ from: "2026-08-01", to: "2026-08-19" });
  });
});

describe("penetration and completion (client workbook definitions)", () => {
  it("penetration = dials / accounts scheduled, completion = accounts called / scheduled", () => {
    const t = totalsOf([d({ accountsScheduled: 100, accountsCalled: 90, dials: 300 }), d({ campaign: "B", accountsScheduled: 100, accountsCalled: 80, dials: 250 })]);
    expect(t.scheduled).toBe(200);
    expect(t.penetration).toBe(2.75);
    expect(t.completionPct).toBe(85);
  });
  it("is zero, not NaN, when nothing was scheduled", () => {
    const t = totalsOf([d({ accountsScheduled: null })]);
    expect([t.penetration, t.completionPct]).toEqual([0, 0]);
  });
});
