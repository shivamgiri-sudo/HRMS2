import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evaluated } from "../preview.service.js";

const h = vi.hoisted(() => {
  const state = {
    req: {} as Record<string, unknown>, row: {} as Record<string, unknown>, runs: [] as Array<Record<string, unknown>>, cands: [] as Array<Record<string, unknown>>,
    approvals: [] as Array<Record<string, unknown>>, enrol: 0, version: "v1" as string | null, people: [] as Evaluated[], outOfScope: new Set<string>(), facts: new Map<string, unknown>(), nextId: 1,
  };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    const S = state;
    if (s.startsWith("SELECT approval_status, active_status")) return [[S.req], []];
    if (s.startsWith("SELECT jr.id")) return [[S.row], []];
    if (s.startsWith("SELECT value FROM he_model_param")) return [[{ value: S.enrol }], []];
    if (s.startsWith("SELECT mobile10, requisition_scope")) return [[], []];
    if (s.startsWith("INSERT INTO shortlist_run")) { S.runs.push({ id: p[0], requisition_id: p[1], source_kind: p[2], criteria_version_id: p[3], created_by: p[7] }); return [{}, []]; }
    if (s.startsWith("SELECT id, requisition_id, source_kind, criteria_version_id FROM shortlist_run")) return [S.runs.filter((r) => r.id === p[0]), []];
    if (s.startsWith("INSERT INTO shortlist_candidate") && s.includes("approval_id) VALUES")) {
      const [run_id, requisition_id, mobile10, sub_source, score, criteria_version_id, , override_kind, , approval_id] = p;
      if (!S.cands.some((c) => c.run_id === run_id && c.mobile10 === mobile10)) S.cands.push({ id: S.nextId++, run_id, requisition_id, mobile10, source_kind: "meta_live", sub_source, verdict: "pass", score, status: "approved", criteria_version_id, override_kind, approval_id });
      return [{}, []];
    }
    if (s.startsWith("INSERT INTO shortlist_candidate")) {
      for (let i = 0; i < p.length; i += 14) {
        const [run_id, requisition_id, mobile10, source_kind, sub_source, verdict, score, status, criteria_version_id, , , review_json, override_kind] = p.slice(i, i + 14);
        S.cands.push({ id: S.nextId++, run_id, requisition_id, mobile10, source_kind, sub_source, verdict, score, status, criteria_version_id, review_json: review_json ? JSON.parse(String(review_json)) : null, override_kind });
      }
      return [{}, []];
    }
    if (s.startsWith("UPDATE shortlist_candidate SET status = 'unticked'")) {
      const [run, ...ms] = p; S.cands.filter((c) => c.run_id === run && c.status === "picked" && ms.includes(c.mobile10)).forEach((c) => { c.status = "unticked"; }); return [{}, []];
    }
    if (s.startsWith("UPDATE shortlist_candidate SET status = 'approved'")) {
      const [aid, run, ...ms] = p;
      const hit = S.cands.filter((c) => c.run_id === run && (c.status === "picked" || (c.status === "review" && ms.includes(c.mobile10))));
      hit.forEach((c) => { c.status = "approved"; c.approval_id = aid; });
      return [{ affectedRows: hit.length }, []];
    }
    if (s.startsWith("INSERT INTO shortlist_approval")) {
      if (s.includes("'batch'")) S.approvals.push({ id: p[0], run_id: p[1], requisition_id: p[2], source_kind: p[3], criteria_version_id: p[4], mode: "batch", approved_by: p[5], approved_count: p[6], unticked: JSON.parse(String(p[7])), note: p[8], revoked_at: null });
      else S.approvals.push({ id: p[0], requisition_id: p[1], source_kind: "meta_live", criteria_version_id: p[2], mode: "standing", approved_by: p[3], valid_until: p[4], revoked_at: null });
      return [{}, []];
    }
    if (s.includes("FROM shortlist_approval WHERE requisition_id = ? AND source_kind = 'meta_live' AND mode = 'batch'")) return [S.approvals.filter((a) => a.mode === "batch" && a.source_kind === "meta_live" && a.requisition_id === p[0] && a.criteria_version_id === p[1] && !a.revoked_at), []];
    if (s.includes("mode = 'standing' AND revoked_at IS NULL AND valid_until > ?")) return [S.approvals.filter((a) => a.mode === "standing" && a.requisition_id === p[0] && !a.revoked_at && String(a.valid_until) > String(p[1]) && a.criteria_version_id === p[2]), []];
    if (s.startsWith("SELECT requisition_id FROM shortlist_approval WHERE id = ?")) return [S.approvals.filter((a) => a.id === p[0] && a.mode === "standing"), []];
    if (s.startsWith("UPDATE shortlist_approval SET revoked_at")) { S.approvals.filter((a) => a.id === p[1]).forEach((a) => { a.revoked_at = "now"; a.revoked_by = p[0]; }); return [{}, []]; }
    if (s.startsWith("UPDATE shortlist_candidate SET status = 'hr_rejected'")) {
      const [, rid, ...ms] = p; const hit = S.cands.filter((c) => c.requisition_id === rid && ms.includes(c.mobile10) && ["picked", "review", "approved", "unticked"].includes(String(c.status)));
      hit.forEach((c) => { c.status = "hr_rejected"; }); return [{ affectedRows: hit.length }, []];
    }
    if (s.startsWith("SELECT id, run_id, mobile10, criteria_version_id FROM shortlist_candidate")) return [S.cands.filter((c) => c.requisition_id === p[0] && c.source_kind === p[1] && c.status === "approved"), []];
    if (s.startsWith("SELECT facts_json FROM selection_person_fact")) return [S.facts.has(String(p[0])) ? [{ facts_json: S.facts.get(String(p[0])) }] : [], []];
    if (s.startsWith("UPDATE shortlist_candidate SET status = 'enrolled'")) { S.cands.filter((c) => c.id === p[0]).forEach((c) => { c.status = "enrolled"; }); return [{}, []]; }
    if (s.startsWith("SELECT id, status FROM shortlist_candidate WHERE run_id = ? AND mobile10 = ?")) return [S.cands.filter((c) => c.run_id === p[0] && c.mobile10 === p[1]), []];
    throw new Error(`unexpected SQL: ${s.slice(0, 80)}`);
  };
  const conn = { execute: vi.fn(exec), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(async () => {}), release: vi.fn() };
  return { state, exec, conn };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(h.exec), getConnection: vi.fn(async () => h.conn) } }));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.state.outOfScope.has(k.id)) } }));
vi.mock("../preview.service.js", async (orig) => ({
  ...(await orig<typeof import("../preview.service.js")>()),
  latestVersionId: vi.fn(async () => h.state.version),
  evaluatePopulation: vi.fn(async () => ({
    compiled: (await import("../compile-criteria.js")).compileCriteria((await import("../criteria-row.js")).toCriteriaRow(h.state.row)),
    versionId: h.state.version, people: h.state.people, partial: [],
  })),
}));

import { approveBatch, approveStanding, createShortlistRun, enrolApproved, enrolLiveArrival, rejectPeople, revokeStanding } from "../approval.service.js";
import { compileCriteria } from "../compile-criteria.js";
import { toCriteriaRow } from "../criteria-row.js";
import { evaluate } from "../evaluate.js";
import type { CandidateFacts } from "../selection-types.js";
import { baseFacts, NOW, ok } from "./fixtures/facts.js";

const actor = { id: "hr-1", role: "hr", user: { id: "hr-1", role: "hr" } as never };
const RULES = { schema: 1, rules: { age: { mode: "must", missing: "review" }, education_min: { mode: "must", missing: "review" }, location_region: { mode: "off", decided: true }, night_shift: { mode: "off", decided: true } },
  enrolment: { mode: "hr_approves", standingApprovalDays: 7 } };
const dbRow = (o: Record<string, unknown> = {}) => ({ id: "r1", requisition_code: "REQ-1", branch_name: "NOIDA-2", process_name: "Onfido", education_requirement: "12th", skills_required: null,
  experience_min_years: null, experience_max_years: null, meta_target_age_min: 18, meta_target_age_max: 35, meta_target_locations: null, meta_target_radius_km: null, shift_requirement: null,
  night_shift_required: 0, rotational_shift: 0, salary_min: null, salary_max: null, preferred_sources: null, meta_screening_config: null, selection_rules: RULES, approval_status: "approved", bcity: "Noida", bstate: null, ...o });
const person = (i: number, o: Partial<CandidateFacts> = {}) => baseFacts({ personKey: `98${String(10000000 + i)}`, firstName: `P${i}`, email: ok(`p${i}@x.com`), age: ok(25), educationRank: ok(5), ...o });
const evalAll = (facts: CandidateFacts[], overrides: Record<string, unknown> = {}) => {
  const c = compileCriteria(toCriteriaRow(h.state.row));
  return facts.map((f) => ({ facts: f, e: { ...evaluate(f, c, NOW), ...(overrides[f.personKey] ? { override: overrides[f.personKey] } : {}) } as never }));
};
const port = () => { const calls: unknown[] = []; return { calls, enqueue: vi.fn(async (i: unknown) => { calls.push(i); return { status: "enqueued" }; }) }; };

beforeEach(() => {
  Object.assign(h.state, { req: { approval_status: "approved", active_status: 1, closed_at: null, requested_headcount: 10, fulfilled_headcount: 0, requisition_validity: "2026-10-30", branch_name: "NOIDA-2", designation_name: "CSE" },
    row: dbRow(), runs: [], cands: [], approvals: [], enrol: 0, version: "v1", outOfScope: new Set(), facts: new Map(), nextId: 1 });
  h.state.people = evalAll([person(1), person(2), person(3), person(4, { age: { value: null, quality: "missing", from: "t" } }), person(5, { age: ok(50) }), person(6, { recordType: "legacy_employee" })]);
});

describe("shortlist run", () => {
  it("stores picked, review and overridden people with the criteria version; plain fails and system blocks stay counts", async () => {
    h.state.people = evalAll([person(1), person(4, { age: { value: null, quality: "missing", from: "t" } }), person(5, { age: ok(50) }), person(7, { age: ok(60) })],
      { [person(7).personKey]: { kind: "include", reason: "client asked for her", actorId: "hr", at: "t" } });
    const r = await createShortlistRun({ requisitionId: "r1", sourceKind: "he", actor, now: NOW });
    expect(h.state.runs[0]).toMatchObject({ id: r.runId, criteria_version_id: "v1", created_by: "hr-1" });
    expect(h.state.cands.map((c) => [c.mobile10, c.status, c.verdict])).toEqual([
      [person(1).personKey, "picked", "pass"], [person(4).personKey, "review", "review"], [person(7).personKey, "picked", "pass"],
    ]);
    expect(h.state.cands[2].review_json).toEqual(["HR included: client asked for her"]);
  });
});

describe("approveBatch", () => {
  const run = async () => (await createShortlistRun({ requisitionId: "r1", sourceKind: "he", actor, now: NOW })).runId;
  it("approves picked rows; untick excludes those people; review rows only when named; audit fields stored", async () => {
    const runId = await run();
    const r = await approveBatch({ requisitionId: "r1", sourceKind: "he", runId, untick: [person(2).personKey], approveReview: [], note: "batch 1", actor, now: NOW });
    expect(r).toMatchObject({ approved: 2, unticked: 1 });
    expect(h.state.cands.map((c) => c.status)).toEqual(["approved", "unticked", "approved", "review"]);
    expect(h.state.approvals[0]).toMatchObject({ mode: "batch", approved_by: "hr-1", approved_count: 2, unticked: [person(2).personKey], note: "batch 1", criteria_version_id: "v1", run_id: runId });
    const runId2 = await run();
    await approveBatch({ requisitionId: "r1", sourceKind: "he", runId: runId2, approveReview: [person(4).personKey], actor, now: NOW });
    expect(h.state.cands.filter((c) => c.run_id === runId2).map((c) => c.status)).toEqual(["approved", "approved", "approved", "approved"]);
  });
  it("incomplete criteria (S-O6) -> 409 criteria_incomplete", async () => {
    const runId = await run();
    h.state.row = dbRow({ selection_rules: { ...RULES, rules: { age: { mode: "must" }, education_min: { mode: "must" } } } });
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "he", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/criteria_incomplete/) });
  });
  it("version drift -> 409 criteria changed, re-run", async () => {
    const runId = await run();
    h.state.version = "v2";
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "he", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/criteria changed/) });
  });
  it.each([
    ["closed", { approval_status: "closed" }], ["not approved", { approval_status: "pending_approval" }], ["full", { fulfilled_headcount: 10 }],
    ["past its hiring deadline", { requisition_validity: "2026-10-01" }], ["inactive", { active_status: 0 }],
  ])("a requisition that is %s -> 409", async (_n, o) => {
    const runId = await run();
    Object.assign(h.state.req, o);
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "he", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("enrolment mode off -> 409", async () => {
    const runId = await run();
    h.state.row = dbRow({ selection_rules: { ...RULES, enrolment: { mode: "off", standingApprovalDays: 7 } } });
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "he", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Enrolment is off/) });
  });
  it("out of scope -> 404; a run of another requisition -> 404", async () => {
    const runId = await run();
    h.state.outOfScope.add("r1");
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "he", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 404 });
    h.state.outOfScope.clear();
    await expect(approveBatch({ requisitionId: "r1", sourceKind: "meta_old", runId, actor, now: NOW })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("enrol step", () => {
  const approveAll = async (sourceKind: "he" | "meta_live" = "he") => {
    const { runId } = await createShortlistRun({ requisitionId: "r1", sourceKind, actor, now: NOW });
    await approveBatch({ requisitionId: "r1", sourceKind, runId, actor, now: NOW });
  };
  it("switch off: approved stays approved and nothing is enqueued", async () => {
    await approveAll();
    const p = port();
    expect(await enrolApproved({ requisitionId: "r1", sourceKind: "he", port: p, now: NOW })).toEqual({ status: "enrol_switch_off", enrolled: 0 });
    expect(p.calls).toEqual([]);
    expect(h.state.cands.filter((c) => c.status === "approved")).toHaveLength(3);
  });
  it("switch on: approved people go to the follow-up with shortlistId and criteriaVersionId, then read enrolled", async () => {
    await approveAll();
    h.state.enrol = 1;
    h.state.facts.set(person(1).personKey, JSON.stringify(person(1)));
    const p = port();
    expect(await enrolApproved({ requisitionId: "r1", sourceKind: "he", port: p, now: NOW })).toEqual({ status: "done", enrolled: 3 });
    expect(p.calls[0]).toMatchObject({ sourceType: "he", requisitionId: "r1", mobile10: person(1).personKey, email: "p1@x.com", branchName: "NOIDA-2", roleName: "CSE", shortlistId: "1", criteriaVersionId: "v1" });
    expect(h.state.cands.filter((c) => c.status === "enrolled")).toHaveLength(3);
    expect(h.state.cands.find((c) => c.status === "review")).toBeTruthy(); // a review row is never enrolled
  });
});

describe("standing approval for Live Meta", () => {
  const firstBatch = async () => {
    const { runId } = await createShortlistRun({ requisitionId: "r1", sourceKind: "meta_live", actor, now: NOW });
    await approveBatch({ requisitionId: "r1", sourceKind: "meta_live", runId, actor, now: NOW });
  };
  it("needs a first approved Live Meta batch for this version; days 1-7", async () => {
    await expect(approveStanding({ requisitionId: "r1", versionId: "v1", actor, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    await firstBatch();
    await expect(approveStanding({ requisitionId: "r1", versionId: "v1", days: 8, actor, now: NOW })).rejects.toMatchObject({ statusCode: 400 });
    await expect(approveStanding({ requisitionId: "r1", versionId: "v0", actor, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    expect((await approveStanding({ requisitionId: "r1", versionId: "v1", actor, now: NOW })).validUntil).toBe("2026-10-16 11:30:00");
  });
  it("enrols a Live Meta arrival that passes, never one in review; a new criteria version ends it; revoking ends it", async () => {
    await firstBatch();
    await approveStanding({ requisitionId: "r1", versionId: "v1", actor, now: NOW });
    h.state.enrol = 1;
    const p = port();
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(20, { sourceKind: "meta_live", subSource: "meta_live" }), port: p, now: NOW })).decision).toBe("enrolled");
    expect(p.calls).toHaveLength(1);
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(20, { sourceKind: "meta_live", subSource: "meta_live" }), port: p, now: NOW })).decision).toBe("already_enrolled");
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(21, { sourceKind: "meta_live", subSource: "meta_live", age: { value: null, quality: "missing", from: "t" } }), port: p, now: NOW })).decision).toBe("review_waits");
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(22, { sourceKind: "meta_live", subSource: "meta_live", age: ok(55) }), port: p, now: NOW })).decision).toBe("not_eligible");
    h.state.version = "v2";
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(23, { sourceKind: "meta_live", subSource: "meta_live" }), port: p, now: NOW })).decision).toBe("no_standing_approval");
    h.state.version = "v1";
    await revokeStanding({ approvalId: String(h.state.approvals.find((a) => a.mode === "standing")!.id), actor });
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(24, { sourceKind: "meta_live", subSource: "meta_live" }), port: p, now: NOW })).decision).toBe("no_standing_approval");
    expect(p.calls).toHaveLength(1);
  });
  it("switch off: no arrival is enrolled", async () => {
    const p = port();
    expect((await enrolLiveArrival({ requisitionId: "r1", facts: person(20), port: p, now: NOW })).decision).toBe("enrol_switch_off");
  });
});

describe("reject", () => {
  it("needs a reason; marks rows hr_rejected", async () => {
    await createShortlistRun({ requisitionId: "r1", sourceKind: "he", actor, now: NOW });
    await expect(rejectPeople({ requisitionId: "r1", mobiles: [person(1).personKey], reason: " ", actor })).rejects.toMatchObject({ statusCode: 400 });
    expect(await rejectPeople({ requisitionId: "r1", mobiles: [person(1).personKey], reason: "failed client round before", actor })).toEqual({ rejected: 1 });
    expect(h.state.cands[0].status).toBe("hr_rejected");
  });
});
