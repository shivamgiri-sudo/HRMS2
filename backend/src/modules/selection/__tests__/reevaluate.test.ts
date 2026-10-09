import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { lock: 1, row: {} as Record<string, unknown>, fu: [] as Array<Record<string, unknown>>, cache: [] as Array<Record<string, unknown>>, updates: [] as unknown[][],
    sqls: [] as string[], outOfScope: new Set<string>(), booked: [] as Array<Record<string, unknown>>, overrides: [] as Array<Record<string, unknown>>, released: [] as unknown[][] };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.sqls.push(s);
    if (s.startsWith("SELECT GET_LOCK")) return [[{ got: state.lock }], []];
    if (s.startsWith("SELECT RELEASE_LOCK")) return [[{}], []];
    if (s.startsWith("SELECT jr.id")) return [[state.row], []];
    if (s.startsWith("SELECT id, mobile10, source_type, criteria_version_id, held_reason FROM qualified_followup")) return [state.fu.filter((r) => String(r.id) > String(p[1])), []];
    if (s.startsWith("SELECT mobile10, source_kind, facts_json FROM selection_person_fact")) return [state.cache.filter((c) => (p as string[]).includes(String(c.mobile10))), []];
    if (s.startsWith("SELECT mobile10, requisition_scope")) return [state.overrides, []];
    if (s.startsWith("UPDATE qualified_followup SET criteria_version_id")) { state.updates.push(p); return [{ affectedRows: 1 }, []]; }
    if (s.startsWith("SELECT requisition_id FROM qualified_followup")) return [state.fu.filter((r) => r.id === p[0] && r.journey_state === "held_manual" && r.held_reason === "criteria_review"), []];
    if (s.startsWith("UPDATE qualified_followup SET criteria_verdict = 'released'")) { state.updates.push(["released", p[0]]); return [{ affectedRows: 1 }, []]; }
    if (s.startsWith("SELECT qf.id, qf.mobile10, qf.full_name")) return [state.booked, []];
    return [[], []];
  };
  const conn = { execute: vi.fn(exec), release: vi.fn() };
  return { state, exec, conn };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(h.exec), getConnection: vi.fn(async () => h.conn) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.state.outOfScope.has(k.id)) } }));
vi.mock("../../hiring-engine/qualified-followup.service.js", () => ({
  releaseHeldManual: vi.fn(async (id: string, actor: string) => {
    h.state.released.push([id, actor]);
    const r = h.state.fu.find((x) => x.id === id && x.journey_state === "held_manual");
    if (r) { r.journey_state = "enrolled"; r.held_reason = null; }
    return Boolean(r);
  }),
}));
vi.mock("../facts-loader.service.js", async (orig) => ({ ...(await orig<typeof import("../facts-loader.service.js")>()), loadHePeopleByMobiles: vi.fn(async () => []) }));

import { bookedMismatch, reevaluateEnrolled, releaseCriteriaHold } from "../reevaluate.service.js";
import { baseFacts, NOW, ok } from "./fixtures/facts.js";

const actor = { id: "hr-1", role: "hr", user: { id: "hr-1", role: "hr" } as never };
const reqRow = { id: "r1", requisition_code: "REQ-1", branch_name: "NOIDA-2", process_name: "Onfido", education_requirement: "Graduate", skills_required: null, experience_min_years: null, experience_max_years: null,
  meta_target_age_min: 18, meta_target_age_max: 30, meta_target_locations: null, meta_target_radius_km: null, shift_requirement: null, night_shift_required: 0, rotational_shift: 0,
  salary_min: null, salary_max: null, preferred_sources: null, meta_screening_config: null, approval_status: "approved", bcity: "Noida", bstate: null,
  selection_rules: { schema: 1, rules: { age: { mode: "must", missing: "review" }, education_min: { mode: "must", missing: "review" } } } };
const fact = (m: string, o = {}) => ({ mobile10: m, source_kind: "he", facts_json: JSON.stringify(baseFacts({ personKey: m, age: ok(25), educationRank: ok(5), ...o })) });

beforeEach(() => {
  Object.assign(h.state, { lock: 1, row: reqRow, fu: [], cache: [], updates: [], sqls: [], outOfScope: new Set(), booked: [], overrides: [], released: [] });
});

describe("reevaluateEnrolled", () => {
  it("writes the verdict of every enrolled person against the new version; already-checked rows and unknown people are skipped", async () => {
    h.state.fu = [
      { id: "a", mobile10: "9800000001", source_type: "he", criteria_version_id: null },
      { id: "b", mobile10: "9800000002", source_type: "he", criteria_version_id: null },
      { id: "c", mobile10: "9800000003", source_type: "he", criteria_version_id: null },
      { id: "d", mobile10: "9800000004", source_type: "he", criteria_version_id: "v2" },
      { id: "e", mobile10: "9800000005", source_type: "he", criteria_version_id: null },
    ];
    // a passes; b is over the new age band; c has no age (review); e is enrolled here already (own journey ignored); 05 unknown
    h.state.cache = [fact("9800000001"), fact("9800000002", { age: ok(35) }), fact("9800000003", { age: { value: null, quality: "missing", from: "t" } }),
      fact("9800000005", { system: { ...baseFacts().system, inOtherJourney: "r1", bookedFor: "r1" } })];
    h.state.fu.push({ id: "f", mobile10: "9800000006", source_type: "he", criteria_version_id: null });
    const r = await reevaluateEnrolled("r1", "v2", NOW);
    expect(r).toEqual({ checked: 4, fail: 1, review: 1, pass: 2, noFacts: 1 });
    expect(h.state.updates).toEqual([["v2", "pass", "a"], ["v2", "fail", "b"], ["v2", "review", "c"], ["v2", "pass", "e"]]);
    expect(h.state.sqls.at(-1)).toMatch(/^SELECT RELEASE_LOCK/);
    // open journeys (one hold model): not stopped, not declined; a criteria_review hold is held_manual, so it is included
    expect(h.state.sqls.find((q) => q.startsWith("SELECT id, mobile10, source_type, criteria_version_id"))).toBe(
      "SELECT id, mobile10, source_type, criteria_version_id, held_reason FROM qualified_followup WHERE requisition_id = ? AND stopped_reason IS NULL AND journey_state NOT IN ('stopped','declined') AND id > ? ORDER BY id LIMIT 500");
  });
  it("someone held for review who now passes is released into the journey; one still in review stays held", async () => {
    h.state.fu = [
      { id: "a", mobile10: "9800000001", source_type: "he", criteria_version_id: "v1", journey_state: "held_manual", held_reason: "criteria_review" },
      { id: "c", mobile10: "9800000003", source_type: "he", criteria_version_id: "v1", journey_state: "held_manual", held_reason: "criteria_review" },
    ];
    h.state.cache = [fact("9800000001"), fact("9800000003", { age: { value: null, quality: "missing", from: "t" } })];
    await reevaluateEnrolled("r1", "v2", NOW);
    expect(h.state.released).toEqual([["a", "system:criteria_recheck"]]);
    expect(h.state.fu.map((r) => r.journey_state)).toEqual(["enrolled", "held_manual"]);
  });
  it("an HR include keeps someone who now fails", async () => {
    h.state.fu = [{ id: "b", mobile10: "9800000002", source_type: "he", criteria_version_id: null }];
    h.state.cache = [fact("9800000002", { age: ok(35) })];
    h.state.overrides = [{ mobile10: "9800000002", requisition_scope: "r1", kind: "include", reason: "known to the client", actor_id: "u", created_at: "t" }];
    await reevaluateEnrolled("r1", "v2", NOW);
    expect(h.state.updates).toEqual([["v2", "pass", "b"]]);
  });
  it("another run holds the lock: nothing is done", async () => {
    h.state.lock = 0;
    expect(await reevaluateEnrolled("r1", "v2", NOW)).toEqual({ skipped: "locked" });
    expect(h.state.updates).toEqual([]);
  });
});

describe("release and booked-mismatch", () => {
  it("HR releases a criteria_review hold with a reason through the unified release; anything else is 404", async () => {
    h.state.fu = [{ id: "a", requisition_id: "r1", journey_state: "held_manual", held_reason: "criteria_review" }, { id: "b", requisition_id: "r1", journey_state: "stopped", held_reason: null },
      { id: "c", requisition_id: "r1", journey_state: "held_manual", held_reason: "auto_notify_off" }];
    await expect(releaseCriteriaHold({ followupId: "a", reason: " ", actor })).rejects.toMatchObject({ statusCode: 400 });
    expect(await releaseCriteriaHold({ followupId: "a", reason: "spoke to her, she has the degree", actor })).toBe(true);
    expect(h.state.released).toEqual([["a", "hr-1"]]);
    expect(h.state.fu[0].journey_state).toBe("enrolled");
    expect(h.state.updates).toEqual([["released", "a"]]);
    await expect(releaseCriteriaHold({ followupId: "b", reason: "x", actor })).rejects.toMatchObject({ statusCode: 404 });
    await expect(releaseCriteriaHold({ followupId: "c", reason: "x", actor })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("a hold on a requisition outside the caller's scope is 404", async () => {
    h.state.fu = [{ id: "a", requisition_id: "r9", journey_state: "held_manual", held_reason: "criteria_review" }];
    h.state.outOfScope.add("r9");
    await expect(releaseCriteriaHold({ followupId: "a", reason: "x", actor })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("booked people who no longer meet the criteria are listed, masked", async () => {
    h.state.booked = [{ id: "q1", mobile10: "9876543210", full_name: "Asha Rani", criteria_verdict: "fail", criteria_checked_at: "t", state: "confirmed", slot_at: "2026-10-12 10:00:00" }];
    expect(await bookedMismatch({ requisitionId: "r1", actor })).toEqual([{ followupId: "q1", maskedMobile: "98xxxxxx10", firstName: "Asha", verdict: "fail", checkedAt: "t", matchState: "confirmed", slotAt: "2026-10-12 10:00:00" }]);
    // the journey's own booking (match_id), not any match of any lead with this mobile
    expect(h.state.sqls.find((q) => q.startsWith("SELECT qf.id, qf.mobile10, qf.full_name"))).toContain("FROM qualified_followup qf JOIN he_match m ON m.id = qf.match_id WHERE");
    // E2: only CONFIRMED people keep their walk-in (an invited, unanswered one is held / stopped instead)
    expect(h.state.sqls.find((q) => q.startsWith("SELECT qf.id, qf.mobile10, qf.full_name"))).toContain("AND m.state = 'confirmed' AND m.slot_at >= NOW()");
    h.state.outOfScope.add("r1");
    await expect(bookedMismatch({ requisitionId: "r1", actor })).rejects.toMatchObject({ statusCode: 404 });
  });
});
