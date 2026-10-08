import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { ov: new Map<string, Record<string, unknown>>(), log: [] as Array<Record<string, unknown>>, leads: [] as Array<Record<string, unknown>>,
    ats: [] as Array<Record<string, unknown>>, outOfScope: new Set<string>(), orgWide: true, sqls: [] as string[] };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.sqls.push(s);
    if (s.startsWith("SELECT mobile10, requisition_scope, kind, reason, actor_id, created_at FROM shortlist_override WHERE mobile10 = ? AND requisition_scope = ?")) {
      const r = state.ov.get(`${p[0]}|${p[1]}`); return [r ? [r] : [], []];
    }
    if (s.startsWith("SELECT mobile10, requisition_scope, kind, reason, actor_id, created_at FROM shortlist_override WHERE requisition_scope IN")) {
      return [[...state.ov.values()].filter((r) => r.requisition_scope === p[0] || r.requisition_scope === "*"), []];
    }
    if (s.startsWith("INSERT INTO shortlist_override (")) {
      const [mobile10, requisition_scope, kind, reason, actor_id, actor_role] = p;
      state.ov.set(`${mobile10}|${requisition_scope}`, { mobile10, requisition_scope, kind, reason, actor_id, actor_role, created_at: "now" }); return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("DELETE FROM shortlist_override")) { state.ov.delete(`${p[0]}|${p[1]}`); return [{ affectedRows: 1 }, []]; }
    if (s.startsWith("INSERT INTO shortlist_override_log")) {
      const [mobile10, requisition_scope, action, before_json, after_json, reason, actor_id] = p;
      state.log.push({ mobile10, requisition_scope, action, before: JSON.parse(String(before_json)), after: JSON.parse(String(after_json)), reason, actor_id }); return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("SELECT l.status, l.final_status, l.is_employee FROM he_lead l")) return [state.leads.filter((l) => l.mobile10 === p[0]), []];
    if (s.startsWith("SELECT ac.record_type, ac.hard_reject_reason FROM ats_candidate ac")) return [state.ats.filter((a) => (p as string[]).includes(String(a.mobile))), []];
    if (s.startsWith("SELECT action, requisition_scope")) return [state.log.filter((l) => l.mobile10 === p[0]).map((l) => ({ ...l, before_json: l.before, after_json: l.after })), []];
    return [[], []];
  };
  const conn = { execute: vi.fn(exec), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(async () => {}), release: vi.fn() };
  return { state, exec, conn };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(h.exec), getConnection: vi.fn(async () => h.conn) } }));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({
  jobRequisitionService: {
    isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.state.outOfScope.has(k.id)),
    getBranchScope: vi.fn(async () => ({ orgWide: h.state.orgWide, branchNames: [] })),
  },
}));

import { loadOverrides, overrideHistory, removeOverride, setOverride } from "../override.service.js";
import { evaluate } from "../evaluate.js";
import { finalVerdict } from "../funnel.js";
import { baseFacts, compiled, NOW, ok, rule } from "./fixtures/facts.js";

const actor = { id: "hr-1", role: "hr", user: { id: "hr-1", role: "hr" } as never };
const M = "9876543210";
beforeEach(() => { h.state.ov.clear(); h.state.log.length = 0; h.state.leads = []; h.state.ats = []; h.state.outOfScope.clear(); h.state.orgWide = true; h.state.sqls.length = 0; });

describe("setOverride / removeOverride", () => {
  it.each(["", "   ", "x".repeat(301)])("a blank or overlong reason is 400 (%#)", async (reason) => {
    await expect(setOverride({ mobile: M, requisitionScope: "r1", kind: "include", reason, actor })).rejects.toMatchObject({ statusCode: 400 });
    expect(h.state.ov.size).toBe(0);
  });
  it("a bad mobile or kind is 400", async () => {
    await expect(setOverride({ mobile: "123", requisitionScope: "r1", kind: "include", reason: "x", actor })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setOverride({ mobile: M, requisitionScope: "r1", kind: "maybe" as never, reason: "x", actor })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("an include on someone who fails age makes them pass, with the HR reason", async () => {
    const r = await setOverride({ mobile: M, requisitionScope: "r1", kind: "include", reason: "Client met her already", actor });
    expect(r.warning).toBeNull();
    const ov = (await loadOverrides("r1")).get(M);
    const e = { ...evaluate(baseFacts({ age: ok(50) }), compiled([rule("age", { min: 18, max: 35 })]), NOW), override: ov };
    expect(e.verdict).toBe("fail");
    expect(finalVerdict(e)).toBe("pass");
    expect(ov).toMatchObject({ kind: "include", reason: "Client met her already", actorId: "hr-1" });
  });
  it.each([
    ["legacy employee", { ats: [{ mobile: M, record_type: "legacy_employee", hard_reject_reason: null }] }, "legacy_employee"],
    ["test record", { ats: [{ mobile: M, record_type: "test", hard_reject_reason: null }] }, "test"],
    ["opted out", { leads: [{ mobile10: M, status: "opted_out", final_status: "none", is_employee: 0 }] }, "opted_out"],
    ["hard reject", { ats: [{ mobile: M, record_type: "candidate", hard_reject_reason: "Fraud documents" }] }, "hard_reject"],
  ])("an include on a %s is stored but never lifts the exclusion: the response warns", async (_n, setup, code) => {
    Object.assign(h.state, setup);
    const r = await setOverride({ mobile: M, requisitionScope: "r1", kind: "include", reason: "please", actor });
    expect(r.warning).toBe(`system exclusion cannot be overridden (${code})`);
    const e = { ...evaluate(baseFacts({ recordType: code === "legacy_employee" || code === "test" ? code : "candidate", system: { ...baseFacts().system, eligibility: { ok: code === "legacy_employee" || code === "test", blocks: [code], priority: 1 } } }), compiled([]), NOW), override: (await loadOverrides("r1")).get(M) };
    expect(finalVerdict(e)).toBe("fail");
  });
  it("an exclude on * applies to every requisition; a requisition's own override wins over *", async () => {
    await setOverride({ mobile: M, requisitionScope: "*", kind: "exclude", reason: "asked not to be called", actor });
    expect((await loadOverrides("r1")).get(M)?.kind).toBe("exclude");
    expect((await loadOverrides("r2")).get(M)?.kind).toBe("exclude");
    await setOverride({ mobile: M, requisitionScope: "r2", kind: "include", reason: "called back, interested in r2", actor });
    expect((await loadOverrides("r2")).get(M)?.kind).toBe("include");
    expect((await loadOverrides("r1")).get(M)?.kind).toBe("exclude");
  });
  it("only org-wide callers may set *; a branch-scoped one gets 403", async () => {
    h.state.orgWide = false;
    await expect(setOverride({ mobile: M, requisitionScope: "*", kind: "exclude", reason: "x", actor })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("a requisition outside the caller's scope is 404", async () => {
    h.state.outOfScope.add("r-noida");
    await expect(setOverride({ mobile: M, requisitionScope: "r-noida", kind: "include", reason: "x", actor })).rejects.toMatchObject({ statusCode: 404 });
    await expect(removeOverride({ mobile: M, requisitionScope: "r-noida", reason: "x", actor })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("every set and remove writes the log with before/after; removing nothing is 404", async () => {
    await setOverride({ mobile: M, requisitionScope: "r1", kind: "include", reason: "first", actor });
    await setOverride({ mobile: M, requisitionScope: "r1", kind: "exclude", reason: "changed mind", actor });
    await removeOverride({ mobile: M, requisitionScope: "r1", reason: "cleared", actor });
    await expect(removeOverride({ mobile: M, requisitionScope: "r1", reason: "again", actor })).rejects.toMatchObject({ statusCode: 404 });
    expect(h.state.log.map((l) => [l.action, (l.before as { kind?: string } | null)?.kind ?? null, (l.after as { kind?: string } | null)?.kind ?? null, l.reason])).toEqual([
      ["set", null, "include", "first"], ["set", "include", "exclude", "changed mind"], ["remove", "exclude", null, "cleared"],
    ]);
    expect((await overrideHistory(M, actor)).map((x) => x.action)).toEqual(["set", "set", "remove"]);
  });
});
