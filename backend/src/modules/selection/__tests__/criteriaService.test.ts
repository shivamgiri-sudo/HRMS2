import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of the three tables the criteria write path touches; every statement is recorded.
const h = vi.hoisted(() => {
  const state = {
    reqs: new Map<string, Record<string, unknown>>(),
    versions: [] as Array<Record<string, unknown>>,
    audit: [] as Array<Record<string, unknown>>,
    sqls: [] as string[],
  };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.sqls.push(s);
    if (s.startsWith("SELECT jr.id")) {
      const r = state.reqs.get(String(p[0]));
      return [r ? [r] : [], []];
    }
    if (s.startsWith("SELECT id, version_no, criteria_hash, columns_json FROM job_requisition_criteria_version")) {
      const v = state.versions.filter((x) => x.requisition_id === p[0]).sort((a, b) => Number(b.version_no) - Number(a.version_no));
      return [v.slice(0, 1), []];
    }
    if (s.startsWith("SELECT COUNT(*) AS n FROM job_requisition_criteria_version")) return [[{ n: state.versions.length }], []];
    if (s.startsWith("SELECT id FROM job_requisition WHERE id > ? ORDER BY id")) return [[...state.reqs.keys()].filter((k) => k > String(p[0] ?? "")).sort().map((id) => ({ id })), []];
    if (s.startsWith("SELECT EXISTS")) return [[{ live: 0 }], []];
    if (s.startsWith("UPDATE job_requisition SET")) {
      const r = state.reqs.get(String(p[p.length - 1]))!;
      const cols = s.slice("UPDATE job_requisition SET ".length, s.indexOf(" WHERE")).split(", ").filter((c) => c.endsWith("= ?")).map((c) => c.replace(" = ?", ""));
      cols.forEach((c, i) => { r[c] = typeof p[i] === "string" && /^[[{]/.test(p[i] as string) ? JSON.parse(p[i] as string) : p[i]; });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO job_requisition_criteria_version")) {
      const [id, requisition_id, version_no, criteria_hash, compiled_json, columns_json, engine_version, source, created_by, reason] = p;
      state.versions.push({ id, requisition_id, version_no, criteria_hash, compiled_json, columns_json: JSON.parse(String(columns_json)), engine_version, source, created_by, reason });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO job_requisition_criteria_audit")) {
      const per = 10;
      for (let i = 0; i < p.length; i += per) {
        const [requisition_id, version_id, field, old_json, new_json, actor_id, actor_role, source, reason, approval_status_at_change] = p.slice(i, i + per);
        state.audit.push({ requisition_id, version_id, field, old_json, new_json, actor_id, actor_role, source, reason, approval_status_at_change });
      }
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("SELECT COALESCE(MAX(version_no), 0) AS n")) return [[{ n: Math.max(0, ...state.versions.filter((x) => x.requisition_id === p[0]).map((x) => Number(x.version_no))) }], []];
    return [[], []];
  };
  const conn = { execute: vi.fn(exec), beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), release: vi.fn() };
  return { state, exec, conn };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(h.exec), getConnection: vi.fn(async () => h.conn) } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const queue = vi.hoisted(() => vi.fn());
vi.mock("../reevaluate.service.js", () => ({ queueReevaluation: queue }));

import { afterEach } from "vitest";
import { backfillCriteriaVersions, bulkSaveCriteria, copyCriteria, recordCriteriaVersion, saveRequisitionCriteria } from "../criteria.service.js";

const row = (o: Record<string, unknown> = {}) => ({
  id: "r1", requisition_code: "REQ-1", branch_name: "NOIDA-2", process_name: "Onfido", education_requirement: null, skills_required: "Excel",
  experience_min_years: null, experience_max_years: null, meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null, meta_target_radius_km: null,
  shift_requirement: null, night_shift_required: 0, rotational_shift: 0, salary_min: 15000, salary_max: 18000, preferred_sources: null,
  meta_screening_config: { auto_notify: false, gender: "female" }, selection_rules: null, approval_status: "approved",
  bcity: "Noida", bstate: "Uttar Pradesh", blat: null, blng: null, ...o,
});
const actor = { id: "u-hr", role: "hr" };
const writes = () => h.state.sqls.filter((s) => /^(UPDATE|INSERT)/.test(s));

beforeEach(() => {
  h.state.reqs.clear(); h.state.versions.length = 0; h.state.audit.length = 0; h.state.sqls.length = 0;
  h.state.reqs.set("r1", row());
  vi.clearAllMocks();
});

describe("saveRequisitionCriteria", () => {
  it("approved + education + reason: one version, an audit row old null -> new Graduate at status approved", async () => {
    const r = await saveRequisitionCriteria({ requisitionId: "r1", patch: { educationRequirement: "Graduate" }, actor, source: "criteria_panel", reason: "Client wants graduates" });
    expect(r.versionNo).toBe(1);
    expect(r.changed).toEqual(["education_requirement"]);
    expect(h.state.reqs.get("r1")!.education_requirement).toBe("Graduate");
    expect(h.state.audit).toEqual([expect.objectContaining({ field: "education_requirement", old_json: "null", new_json: "\"Graduate\"", actor_id: "u-hr", actor_role: "hr", approval_status_at_change: "approved", source: "criteria_panel", reason: "Client wants graduates" })]);
    expect(h.conn.commit).toHaveBeenCalled();
  });
  it("a second save with a version already present numbers it 2", async () => {
    await saveRequisitionCriteria({ requisitionId: "r1", patch: { educationRequirement: "Graduate" }, actor, source: "criteria_panel", reason: "x" });
    const r = await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 18 }, actor, source: "criteria_panel", reason: "y" });
    expect(r.versionNo).toBe(2);
  });
  it("approved without a reason -> 400, nothing written", async () => {
    await expect(saveRequisitionCriteria({ requisitionId: "r1", patch: { educationRequirement: "Graduate" }, actor, source: "criteria_panel", reason: " " })).rejects.toMatchObject({ statusCode: 400 });
    expect(writes()).toEqual([]);
  });
  it("draft without a reason is fine", async () => {
    h.state.reqs.set("r1", row({ approval_status: "draft" }));
    expect((await saveRequisitionCriteria({ requisitionId: "r1", patch: { educationRequirement: "Graduate" }, actor, source: "criteria_panel", reason: null })).versionNo).toBe(1);
  });
  it("salary in the patch -> 400 salary needs re-approval (runtime guard)", async () => {
    await expect(saveRequisitionCriteria({ requisitionId: "r1", patch: { salaryMax: 25000 } as never, actor, source: "criteria_panel", reason: "x" })).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/salary needs re-approval/) });
    await expect(saveRequisitionCriteria({ requisitionId: "r1", patch: { requestedHeadcount: 3 } as never, actor, source: "criteria_panel", reason: "x" })).rejects.toMatchObject({ statusCode: 400 });
    expect(writes()).toEqual([]);
  });
  it("closed -> 409", async () => {
    h.state.reqs.set("r1", row({ approval_status: "closed" }));
    await expect(saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 18 }, actor, source: "criteria_panel", reason: "x" })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("missing requisition -> 404", async () => {
    await expect(saveRequisitionCriteria({ requisitionId: "nope", patch: { ageMin: 18 }, actor, source: "criteria_panel", reason: "x" })).rejects.toMatchObject({ statusCode: 404 });
  });
  it("validation error -> 422 with issues, no write", async () => {
    const e = await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 40, ageMax: 30 }, actor, source: "criteria_panel", reason: "x" }).catch((x) => x);
    expect(e).toMatchObject({ statusCode: 422 });
    expect(e.issues[0].text).toMatch(/minimum is above/);
    expect(writes()).toEqual([]);
  });
  it("the same values twice -> no new version", async () => {
    await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 18 }, actor, source: "criteria_panel", reason: "x" });
    const r = await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 18 }, actor, source: "criteria_panel", reason: "x" });
    expect(r.versionId).toBeNull();
    expect(h.state.versions).toHaveLength(1);
  });
  it("auto_notify survives a screeningConfig patch and is never taken from the patch", async () => {
    await saveRequisitionCriteria({ requisitionId: "r1", patch: { screeningConfig: { written_english_level: "basic", auto_notify: true } as never }, actor, source: "criteria_panel", reason: "x" });
    expect(h.state.reqs.get("r1")!.meta_screening_config).toEqual({ auto_notify: false, gender: "female", written_english_level: "basic" });
  });
  it("selection_rules are parsed; a bad one is 422", async () => {
    const e = await saveRequisitionCriteria({ requisitionId: "r1", patch: { selectionRules: { schema: 1, rules: { age: { mode: "must", weight: 9 } } } as never }, actor, source: "criteria_panel", reason: "x" }).catch((x) => x);
    expect(e).toMatchObject({ statusCode: 422 });
    await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 18, selectionRules: { schema: 1, rules: { age: { mode: "must", missing: "review" } } } }, actor, source: "criteria_panel", reason: "x" });
    expect(h.state.reqs.get("r1")!.selection_rules).toEqual({ schema: 1, rules: { age: { mode: "must", missing: "review" } } });
  });
  it("dryRun returns the diff and compiled criteria without writing", async () => {
    const r = await saveRequisitionCriteria({ requisitionId: "r1", patch: { educationRequirement: "12th" }, actor, source: "criteria_panel", reason: "x", dryRun: true });
    expect(r.diff).toEqual([{ field: "education_requirement", from: null, to: "12th" }]);
    expect(r.compiled.rules.some((x) => x.key === "education_min")).toBe(true);
    expect(writes()).toEqual([]);
  });
});

describe("recordCriteriaVersion (form path)", () => {
  it("writes a version with source form when the hash differs from the latest, and not again when unchanged", async () => {
    h.state.reqs.set("r1", row({ approval_status: "draft", education_requirement: "Graduate" }));
    expect(await recordCriteriaVersion("r1", "u1", "form")).toEqual(expect.any(String));
    expect(h.state.versions[0]).toMatchObject({ source: "form", version_no: 1 });
    expect(await recordCriteriaVersion("r1", "u1", "form")).toBeNull();
    h.state.reqs.get("r1")!.education_requirement = "12th";
    await recordCriteriaVersion("r1", "u1", "form");
    expect(h.state.versions).toHaveLength(2);
    expect(h.state.audit).toEqual([expect.objectContaining({ field: "education_requirement", old_json: "\"Graduate\"", new_json: "\"12th\"", source: "form" })]);
  });
});

describe("bulk and copy", () => {
  beforeEach(() => {
    h.state.reqs.set("r2", row({ id: "r2", education_requirement: "12th", approval_status: "draft" }));
  });
  it("bulk dry-run: per-requisition diffs only, no UPDATE", async () => {
    const out = await bulkSaveCriteria({ requisitionIds: ["r1", "r2"], patch: { educationRequirement: "Graduate", ageMin: 18 }, replaceFilled: false, actor, reason: "x", dryRun: true });
    expect(out.find((o) => o.requisitionId === "r1")!.diff).toEqual([{ field: "education_requirement", from: null, to: "Graduate" }, { field: "meta_target_age_min", from: null, to: 18 }]);
    expect(out.find((o) => o.requisitionId === "r2")!.diff).toEqual([{ field: "education_requirement", from: "12th", to: "Graduate", skipped: "filled" }, { field: "meta_target_age_min", from: null, to: 18 }]);
    expect(h.state.sqls.some((s) => s.startsWith("UPDATE"))).toBe(false);
  });
  it("bulk with replaceFilled false skips filled fields and versions each requisition separately", async () => {
    const out = await bulkSaveCriteria({ requisitionIds: ["r1", "r2"], patch: { educationRequirement: "Graduate" }, replaceFilled: false, actor, reason: "x", dryRun: false });
    expect(h.state.reqs.get("r2")!.education_requirement).toBe("12th");
    expect(h.state.reqs.get("r1")!.education_requirement).toBe("Graduate");
    expect(out.find((o) => o.requisitionId === "r2")!.versionId).toBeNull();
    expect(h.state.versions.map((v) => v.requisition_id)).toEqual(["r1"]);
    expect(h.state.versions[0].source).toBe("bulk");
  });
  it("bulk reports a per-requisition error without stopping the others", async () => {
    h.state.reqs.set("r2", row({ id: "r2", approval_status: "closed" }));
    const out = await bulkSaveCriteria({ requisitionIds: ["r2", "r1"], patch: { ageMin: 18 }, replaceFilled: true, actor, reason: "x", dryRun: false });
    expect(out[0].issues[0]).toMatchObject({ level: "error", text: expect.stringMatching(/closed/) });
    expect(out[1].versionId).not.toBeNull();
  });
  it("copy takes the chosen keys from the source requisition", async () => {
    h.state.reqs.set("r3", row({ id: "r3", education_requirement: "Post Graduate", meta_target_age_min: 21, meta_target_age_max: 30, approval_status: "draft" }));
    const out = await copyCriteria({ fromRequisitionId: "r3", toRequisitionIds: ["r1"], keys: ["age"], replaceFilled: true, actor, reason: "x", dryRun: false });
    expect(out[0].diff.map((d) => d.field)).toEqual(["meta_target_age_min", "meta_target_age_max"]);
    expect(h.state.reqs.get("r1")!.education_requirement).toBeNull();
    expect(h.state.versions[0].source).toBe("copy");
  });
});

describe("backfill", () => {
  it("writes exactly one version per requisition, and is a no-op on a second run", async () => {
    h.state.reqs.set("r2", row({ id: "r2" }));
    expect(await backfillCriteriaVersions()).toBe(2);
    expect(h.state.versions.map((v) => [v.requisition_id, v.source])).toEqual([["r1", "backfill"], ["r2", "backfill"]]);
    expect(await backfillCriteriaVersions()).toBe(0);
    expect(h.state.versions).toHaveLength(2);
  });
});

describe("S14 re-check trigger", () => {
  afterEach(() => vi.unstubAllEnvs());
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it("guard on + HR's own criteria changed -> the enrolled people are re-checked against the new version", async () => {
    vi.stubEnv("SELECTION_FOLLOWUP_GUARD", "1");
    h.state.reqs.set("r1", row({ meta_target_age_min: 18, selection_rules: { schema: 1, rules: { age: { mode: "must" } } } }));
    const r = await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 21 }, actor, source: "criteria_panel", reason: "x" });
    await flush();
    expect(queue).toHaveBeenCalledWith("r1", r.versionId);
  });
  it("never in legacy mode, never for the backfill, never with the guard off", async () => {
    vi.stubEnv("SELECTION_FOLLOWUP_GUARD", "1");
    await saveRequisitionCriteria({ requisitionId: "r1", patch: { ageMin: 21 }, actor, source: "criteria_panel", reason: "x" }); // legacy row
    await backfillCriteriaVersions();
    vi.stubEnv("SELECTION_FOLLOWUP_GUARD", "");
    h.state.reqs.set("r2", row({ id: "r2", selection_rules: { schema: 1, rules: { age: { mode: "must" } } }, meta_target_age_min: 18 }));
    await saveRequisitionCriteria({ requisitionId: "r2", patch: { ageMin: 22 }, actor, source: "criteria_panel", reason: "x" });
    await flush();
    expect(queue).not.toHaveBeenCalled();
  });
});
