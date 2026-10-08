import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<[string, unknown[]]>, rows: [] as Array<Record<string, unknown>>, versions: [] as Array<Record<string, unknown>>,
  campaign: [] as Array<Record<string, unknown>>, open: [] as string[], outOfScope: new Set<string>(),
  run: null as Record<string, unknown> | null, counts: [] as Array<Record<string, unknown>>, standing: [] as Array<Record<string, unknown>>, latest: "v2" as string | null, blocker: null as string | null,
  cands: [] as Array<Record<string, unknown>>,
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      h.sqls.push([s, p]);
      if (s.startsWith("SELECT jr.id FROM job_requisition jr")) return [h.open.map((id) => ({ id })), []];
      if (s.startsWith("SELECT jr.id, jr.requisition_code")) return [h.rows.filter((r) => (p as string[]).includes(String(r.id))), []];
      if (s.startsWith("SELECT v.requisition_id, v.version_no")) return [h.versions, []];
      if (s.startsWith("SELECT DISTINCT mc.requisition_id")) return [h.campaign, []];
      if (s.startsWith("SELECT id, criteria_version_id, created_at, created_by FROM shortlist_run")) return [h.run ? [h.run] : [], []];
      if (s.startsWith("SELECT status, COUNT(*) AS n FROM shortlist_candidate")) return [h.counts, []];
      if (s.startsWith("SELECT id, valid_until, criteria_version_id, approved_by, approved_at FROM shortlist_approval")) return [h.standing, []];
      if (s.startsWith("SELECT id, version_no FROM job_requisition_criteria_version")) return [h.latest ? [{ id: h.latest, version_no: 2 }] : [], []];
      if (s.startsWith("SELECT requisition_id, source_kind FROM shortlist_run")) return [h.run ? [h.run] : [], []];
      if (s.startsWith("SELECT id, mobile10, sub_source, verdict, score, status, review_json FROM shortlist_candidate")) return [h.cands, []];
      if (s.startsWith("SELECT id, mobile10 FROM shortlist_candidate")) return [h.cands.filter((c) => (p as unknown[]).slice(1).includes(String(c.id))), []];
      return [[], []];
    }),
  },
}));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.outOfScope.has(k.id)) } }));
vi.mock("../approval.service.js", async (orig) => ({ ...(await orig<typeof import("../approval.service.js")>()), approvalBlocker: vi.fn(async () => h.blocker) }));

import { approvalState, campaignRequisitions, candidateMobiles, listCriteriaRequisitions, permissionsFor, runCandidates } from "../selection-ui.service.js";

const user = (role: string) => ({ id: "u1", role }) as never;
const row = (id: string, o: Record<string, unknown> = {}) => ({ id, requisition_code: `REQ-${id}`, branch_name: "NOIDA-2", process_name: "Onfido", designation_name: "CSE", approval_status: "approved",
  education_requirement: null, skills_required: "Excel", experience_min_years: null, experience_max_years: null, meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null,
  meta_target_radius_km: null, shift_requirement: null, night_shift_required: 0, rotational_shift: 0, salary_min: null, salary_max: 18000, preferred_sources: null, meta_screening_config: null,
  selection_rules: null, bcity: "Noida", bstate: null, ...o });

beforeEach(() => { Object.assign(h, { rows: [], versions: [], campaign: [], open: [], run: null, counts: [], standing: [], latest: "v2", blocker: null, cands: [] }); h.sqls.length = 0; h.outOfScope.clear(); });

describe("permissionsFor (what the UI may show; the server still refuses)", () => {
  it.each([
    ["super_admin", { read: true, edit: true, export: true, approve: true, override: true }],
    ["hr", { read: true, edit: true, export: true, approve: true, override: true }],
    ["branch_head", { read: true, edit: true, export: false, approve: false, override: false }],
    ["admin", { read: true, edit: false, export: false, approve: false, override: true }],
    ["ceo", { read: true, edit: false, export: false, approve: false, override: false }],
    ["recruiter", { read: false, edit: false, export: false, approve: false, override: false }],
  ])("%s", (role, want) => expect(permissionsFor(role)).toEqual(want));
});

describe("listCriteriaRequisitions", () => {
  it("open requisitions in scope with completeness, version and the number of rules HR has not decided; batched (no per-row queries)", async () => {
    h.open = ["a", "b", "c"];
    h.outOfScope.add("c");
    h.rows = [row("a"), row("b", { meta_target_age_min: 18, rotational_shift: 1, selection_rules: { schema: 1, rules: { age: { mode: "must" } } } }), row("c")];
    h.versions = [{ requisition_id: "b", version_no: 3, created_at: "2026-10-09 10:00:00", created_by: "u9", source: "criteria_panel" }];
    const out = await listCriteriaRequisitions(user("hr"), {});
    expect(out.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out.items[0]).toMatchObject({ code: "REQ-a", legacy: true, completeness: { label: "incomplete", enrolmentReady: false }, version: null, defaultedMust: [] });
    expect(out.items[1]).toMatchObject({ legacy: false, version: { versionNo: 3, at: "2026-10-09 10:00:00", by: "u9" }, defaultedMust: ["rotational_shift"] });
    expect(out.permissions.edit).toBe(true);
    expect(h.sqls.filter(([s]) => s.startsWith("SELECT jr.id, jr.requisition_code"))).toHaveLength(1);
  });
  it("only incomplete", async () => {
    h.open = ["a", "b"];
    h.rows = [row("a"), row("b", { targetLocations: null, meta_target_locations: ["Noida"], education_requirement: "12th", night_shift_required: 1, meta_target_age_min: 18 })];
    expect((await listCriteriaRequisitions(user("hr"), { onlyIncomplete: true })).items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("campaignRequisitions", () => {
  it("every requisition the campaign (or its sibling rows of the same Meta campaign) points at, in scope, any status", async () => {
    h.campaign = [{ requisition_id: "a" }, { requisition_id: "c" }];
    h.outOfScope.add("c");
    h.rows = [row("a", { approval_status: "closed" }), row("c")];
    const out = await campaignRequisitions(user("hr"), "camp-1");
    expect(out.items.map((i) => [i.id, i.approvalStatus])).toEqual([["a", "closed"]]);
    expect(h.sqls.find(([s]) => s.startsWith("SELECT DISTINCT mc.requisition_id"))![1]).toEqual(["camp-1", "camp-1"]);
  });
});

describe("approvalState", () => {
  it("latest run with counts, version drift, the blocker and active standing approvals", async () => {
    h.run = { id: "run-1", criteria_version_id: "v1", created_at: "2026-10-09 19:00:00", created_by: "u1" };
    h.counts = [{ status: "picked", n: 12 }, { status: "review", n: 4 }, { status: "approved", n: 3 }];
    h.standing = [{ id: "st-1", valid_until: "2026-10-15 10:00:00", criteria_version_id: "v2", approved_by: "u1", approved_at: "t" }];
    h.blocker = null;
    const s = await approvalState(user("hr"), "r1", "meta_live");
    expect(s).toMatchObject({ lastRun: { runId: "run-1", at: "2026-10-09 19:00:00", counts: { picked: 12, review: 4, approved: 3 } }, currentVersion: { id: "v2", versionNo: 2 },
      drift: true, blocker: "criteria changed since the last run; run the shortlist again", standing: [{ id: "st-1", validUntil: "2026-10-15 10:00:00" }], permissions: { approve: true } });
  });
  it("blocked by the gates (e.g. incomplete); out of scope is 404", async () => {
    h.blocker = "criteria_incomplete: decide location, education, shift and age";
    expect((await approvalState(user("hr"), "r1", "he")).blocker).toMatch(/criteria_incomplete/);
    h.outOfScope.add("r1");
    await expect(approvalState(user("hr"), "r1", "he")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("run candidates (the approve bar's untick list)", () => {
  it("masked mobiles and an opaque row id; never the full mobile", async () => {
    h.run = { requisition_id: "r1", source_kind: "he" };
    h.cands = [{ id: 7, mobile10: "9876543210", sub_source: "naukri_import", verdict: "pass", score: "62.5", status: "picked", review_json: null },
      { id: 8, mobile10: "9123456789", sub_source: "candidate", verdict: "review", score: "0", status: "review", review_json: ["Age: not known"] }];
    const out = await runCandidates(user("hr"), "run-1");
    expect(out).toEqual({ requisitionId: "r1", items: [
      { id: "7", maskedMobile: "98xxxxxx10", subSource: "naukri_import", verdict: "pass", score: 62.5, status: "picked", reasons: [] },
      { id: "8", maskedMobile: "91xxxxxx89", subSource: "candidate", verdict: "review", score: 0, status: "review", reasons: ["Age: not known"] }] });
    expect(JSON.stringify(out)).not.toMatch(/\d{10}/);
  });
  it("unknown run or out-of-scope requisition is 404", async () => {
    await expect(runCandidates(user("hr"), "nope")).rejects.toMatchObject({ statusCode: 404 });
    h.run = { requisition_id: "r1", source_kind: "he" }; h.outOfScope.add("r1");
    await expect(runCandidates(user("hr"), "run-1")).rejects.toMatchObject({ statusCode: 404 });
  });
  it("candidateMobiles resolves row ids of that run only", async () => {
    h.cands = [{ id: 7, mobile10: "9876543210" }, { id: 8, mobile10: "9123456789" }];
    expect(await candidateMobiles("run-1", ["7"])).toEqual(["9876543210"]);
    expect(await candidateMobiles("run-1", [])).toEqual([]);
  });
});
