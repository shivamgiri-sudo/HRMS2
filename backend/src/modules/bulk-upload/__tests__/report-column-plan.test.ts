import { describe, it, expect } from "vitest";
import { applyPlan, buildColumnPlan, describePlan, similarity } from "../report-column-plan.js";
import { SBI_APR_COLUMNS, aprLoginResolver } from "../sbi-card-apr-columns.js";
import { agentTimeSpec } from "../sbi-card-bulk.service.js";
import { canonicalizeRow } from "../dalmia-import-helpers.js";

const OPTS = { minRecognised: 6, resolvers: { login: aprLoginResolver } };
const agent = (n: number, o: Record<string, unknown> = {}) => ({
  USER: ["Asha Rao", "Vikas Ojha", "Shilpa Krishnan", "Kundan Kashyap", "Chrlluru Vamsi", "Angel Gracelin", "Nowfia Nazeer", "Jithin Jimmy", "Jabeen Shaik", "Javed Khan", "Abid Ali", "Preeti Sharma"][(n - 1) % 12]!, ID: `MAS6${String(n).padStart(4, "0")}`, CALLS: "59", "TIME CLOCK": "0:00:00", "LOGIN TIME": "8:59:30", WAIT: "2:14:27", TALK: "3:07:03",
  DISPO: "0:21:21", PAUSE: "3:16:39", DEAD: "0:00:11", CUSTOMER: "3:06:52", Login: "10:04:03", Logout: "19:03:41", ACHT: "212", DISMX: "0:47:12",
  LAGGED: "0:00:00", LB: "0:37:40", LOGIN: "0:18:30", MB: "0:00:00", QB: "0:00:00", TB: "0:15:43", WB: "0:00:00", "Report Date": "2026-09-28", ...o,
});
const sample = (f: (n: number) => Record<string, unknown>) => Array.from({ length: 12 }, (_, i) => f(i + 1));
const run = (row: Record<string, unknown>, plan: ReturnType<typeof buildColumnPlan>) =>
  agentTimeSpec.mapRow(canonicalizeRow(applyPlan(row, plan), agentTimeSpec.headers), 1, { processId: "p", batchId: "b", userId: "u" });
const values = (r: ReturnType<typeof run>) => { if (!("values" in r)) throw new Error(JSON.stringify(r)); return r.values; };

describe("column plan", () => {
  it("maps the standard export one to one", () => {
    const plan = buildColumnPlan(sample((n) => agent(n)), SBI_APR_COLUMNS, OPTS);
    expect(plan.fatal).toBeNull();
    expect(plan.report.missing).toEqual([]);
    expect(plan.report.unrecognised).toEqual([]);
    expect(plan.report.mapped.every((m) => m.via === "exact" || m.via === "value")).toBe(true);
  });
  it("is indifferent to column order", () => {
    const shuffled = (n: number) => Object.fromEntries(Object.entries(agent(n)).reverse());
    const a = buildColumnPlan(sample((n) => agent(n)), SBI_APR_COLUMNS, OPTS);
    const b = buildColumnPlan(sample(shuffled), SBI_APR_COLUMNS, OPTS);
    expect([...b.rename.entries()].sort()).toEqual([...a.rename.entries()].sort());
    expect(values(run(shuffled(1), b))).toEqual(values(run(agent(1), a)));
  });
  it("maps renamed headers by alias and a typo by fuzzy match", () => {
    const row = (n: number) => { const r = agent(n) as Record<string, unknown>; const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) o[k === "ID" ? "Agent ID" : k === "USER" ? "Agent Name" : k === "CALLS" ? "Total Calls" : k === "Logout" ? "Logoutt" : k] = v; return o; };
    const plan = buildColumnPlan(sample(row), SBI_APR_COLUMNS, OPTS);
    const via = Object.fromEntries(plan.report.mapped.map((m) => [m.canonical, m.via]));
    expect(via).toMatchObject({ ID: "alias", USER: "alias", CALLS: "alias", Logout: "fuzzy" });
    expect(describePlan(plan, SBI_APR_COLUMNS.length).join(" ")).toContain('"Logoutt" -> Logout');
  });
  it("derives LOGIN TIME and ACHT when the export dropped them, and says so", () => {
    const row = (n: number) => { const r = agent(n); delete (r as Record<string, unknown>)["LOGIN TIME"]; delete (r as Record<string, unknown>)["ACHT"]; return r; };
    const plan = buildColumnPlan(sample(row), SBI_APR_COLUMNS, OPTS);
    expect(plan.report.missing).toEqual(expect.arrayContaining(["LOGIN TIME", "ACHT"]));
    const res = run(row(1), plan);
    expect(values(res)).toContain(32381); // 2:14:27 + 3:07:03 + 0:21:21 + 3:16:39 + 0:00:11
    expect(values(res)).toContain(212);
    expect((res as { notes?: string[] }).notes?.join(" ")).toContain("derived");
  });
  it("tells the two Login columns apart by value even when they swap places or share a name", () => {
    const swapped = (n: number) => ({ ...agent(n), Login: "0:18:30", LOGIN: "10:04:03" });                  // headers swapped
    const plan = buildColumnPlan(sample(swapped), SBI_APR_COLUMNS, OPTS);
    const res = values(run(swapped(1), plan));
    expect(res).toContain("10:04:03");                       // first_login_time
    expect(res).toContain(1110);                             // pause code 0:18:30
    const sameName = (n: number) => { const r: Record<string, unknown> = { ...agent(n) }; delete r.Login; delete r.LOGIN; return { ...r, LOGIN: "10:04:03", LOGIN_1: "0:18:30" }; };
    const p2 = buildColumnPlan(sample(sameName), SBI_APR_COLUMNS, OPTS);
    const r2 = values(run(sameName(1), p2));
    expect(r2).toContain("10:04:03"); expect(r2).toContain(1110);
  });
  it("finds the employee code and name by content when the headers are unrecognisable", () => {
    const row = (n: number) => { const r = agent(n) as Record<string, unknown>; const o: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) o[k === "ID" ? "Col A" : k === "USER" ? "Col B" : k] = v; return o; };
    const plan = buildColumnPlan(sample(row), SBI_APR_COLUMNS, OPTS);
    expect(plan.fatal).toBeNull();
    expect(Object.fromEntries(plan.report.mapped.map((m) => [m.canonical, m.via]))).toMatchObject({ ID: "profile", USER: "profile" });
  });
  it("fails closed on a file that is not this report, or has no identity column", () => {
    const junk = buildColumnPlan(sample((n) => ({ foo: n, bar: "x", baz: "y" })), SBI_APR_COLUMNS, OPTS);
    expect(junk.fatal).toMatch(/Required column/);
    const noId = buildColumnPlan(sample((n) => { const r = agent(n) as Record<string, unknown>; delete r.ID; r.USER = "Asha Rao"; return r; }), SBI_APR_COLUMNS, OPTS);
    expect(noId.fatal).toMatch(/ID/);
  });
  it("warns when state times do not reconcile with login time", () => {
    const plan = buildColumnPlan(sample((n) => agent(n)), SBI_APR_COLUMNS, OPTS);
    const res = run(agent(1, { "LOGIN TIME": "3:00:00" }), plan);
    expect((res as { notes?: string[] }).notes?.join(" ")).toContain("do not add up");
  });
  it("never lets a percentage column stand in for a duration, in any column order", () => {
    const withPct = (n: number) => ({ ...agent(n), "WAIT %": "24.92%", "TALK TIME %": "34.67%" });
    const rev = (n: number) => Object.fromEntries(Object.entries(withPct(n)).reverse());
    const p1 = buildColumnPlan(sample(withPct), SBI_APR_COLUMNS, OPTS); const p2 = buildColumnPlan(sample(rev), SBI_APR_COLUMNS, OPTS);
    expect(values(run(rev(1), p2))).toEqual(values(run(withPct(1), p1)));
    expect(p2.report.unrecognised).toEqual(expect.arrayContaining(["WAIT %", "TALK TIME %"]));
    const noWait = (n: number) => { const r = withPct(n) as Record<string, unknown>; delete r.WAIT; return r; };
    const p3 = buildColumnPlan(sample(noWait), SBI_APR_COLUMNS, OPTS);
    expect(values(run(noWait(1), p3))).not.toContain(24); // the 24.92% share must not be read as WAIT seconds
  });
  it("similarity is symmetric and bounded", () => {
    expect(similarity("logout", "logoutt")).toBeGreaterThan(0.8);
    expect(similarity("abc", "xyz")).toBe(0);
  });
});
