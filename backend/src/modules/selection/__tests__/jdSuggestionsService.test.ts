import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake of the tables: the real criteria write path (saveRequisitionCriteria) runs on top of it.
const h = vi.hoisted(() => {
  const state = { reqs: new Map<string, Record<string, unknown>>(), versions: [] as Array<Record<string, unknown>>, audit: [] as Array<Record<string, unknown>>, sqls: [] as string[] };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.sqls.push(s);
    if (s.startsWith("SELECT jr.id")) { const r = state.reqs.get(String(p[0])); return [r ? [r] : [], []]; }
    if (s.startsWith("SELECT job_description, business_justification FROM job_requisition")) { const r = state.reqs.get(String(p[0])); return [r ? [r] : [], []]; }
    if (s.startsWith("SELECT id, version_no, criteria_hash, columns_json FROM job_requisition_criteria_version") || s.startsWith("SELECT id, version_no FROM job_requisition_criteria_version")) {
      return [state.versions.filter((x) => x.requisition_id === p[0]).sort((a, b) => Number(b.version_no) - Number(a.version_no)).slice(0, 1), []];
    }
    if (s.startsWith("SELECT field, new_json FROM job_requisition_criteria_audit")) {
      return [state.audit.filter((a) => a.requisition_id === p[0] && a.source === "jd_suggestion").map((a) => ({ field: a.field, new_json: JSON.parse(String(a.new_json)) })), []];
    }
    if (s.startsWith("SELECT EXISTS")) return [[{ live: 0 }], []];
    if (s.startsWith("UPDATE job_requisition SET")) {
      const r = state.reqs.get(String(p[p.length - 1]))!;
      const cols = s.slice("UPDATE job_requisition SET ".length, s.indexOf(" WHERE")).split(", ").filter((c) => c.endsWith("= ?")).map((c) => c.replace(" = ?", ""));
      cols.forEach((c, i) => { r[c] = typeof p[i] === "string" && /^[[{]/.test(p[i] as string) ? JSON.parse(p[i] as string) : p[i]; });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO job_requisition_criteria_version")) {
      const [id, requisition_id, version_no, , , , , source, created_by, reason] = p;
      state.versions.push({ id, requisition_id, version_no, source, created_by, reason });
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("INSERT INTO job_requisition_criteria_audit")) {
      for (let i = 0; i < p.length; i += 10) {
        const [requisition_id, version_id, field, old_json, new_json, actor_id, actor_role, source, reason, approval_status_at_change] = p.slice(i, i + 10);
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
vi.mock("../reevaluate.service.js", () => ({ queueReevaluation: vi.fn() }));

import { acceptSuggestions, dismissSuggestions, getSuggestions } from "../jd-suggestions.service.js";

const row = (o: Record<string, unknown> = {}) => ({
  id: "r1", requisition_code: "NOIDA-Onfido-17", branch_name: "NOIDA-2", process_name: "Onfido", education_requirement: null, skills_required: "Graduation with good typing speed",
  experience_min_years: null, experience_max_years: null, meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null, meta_target_radius_km: null,
  shift_requirement: null, night_shift_required: 0, rotational_shift: 0, salary_min: 15000, salary_max: 18000, preferred_sources: null,
  meta_screening_config: { auto_notify: true }, selection_rules: null, approval_status: "approved", job_description: "", business_justification: "Analyst requisition is required to maintain adequate staffing",
  bcity: "Noida", bstate: "Uttar Pradesh", blat: null, blng: null, ...o,
});
const actor = { id: "u-hr", role: "hr" };
const writes = () => h.state.sqls.filter((s) => /^(UPDATE|INSERT)/.test(s));
const idsOf = async (id = "r1") => Object.fromEntries((await getSuggestions(id, "hr")).suggestions.map((s) => [s.key, s.id]));

beforeEach(() => {
  h.state.reqs.clear(); h.state.versions.length = 0; h.state.audit.length = 0; h.state.sqls.length = 0;
  h.state.reqs.set("r1", row());
  vi.clearAllMocks();
});

describe("getSuggestions", () => {
  it("returns the suggestions with the current state and the caller's permissions; reads only", async () => {
    const g = await getSuggestions("r1", "hr");
    expect(g.suggestions.map((s) => `${s.key} ${s.mode}`)).toEqual(["education_min must", "typing prefer"]);
    expect(g.current).toMatchObject({ approvalStatus: "approved", legacy: true, structuredEmpty: true, hasText: true, versionNo: null });
    expect(g.current.completeness.enrolmentReady).toBe(false);
    expect(g.permissions).toMatchObject({ read: true, edit: true });
    expect((await getSuggestions("r1", "ceo")).permissions).toMatchObject({ read: true, edit: false });
    expect(writes()).toEqual([]);
  });
  it("404 for an unknown requisition", async () => {
    await expect(getSuggestions("nope", "hr")).rejects.toMatchObject({ statusCode: 404 });
  });
  it("empty text: no suggestions, hasText false", async () => {
    h.state.reqs.set("r1", row({ skills_required: "", business_justification: "" }));
    const g = await getSuggestions("r1", "hr");
    expect(g.suggestions).toEqual([]);
    expect(g.current.hasText).toBe(false);
  });
});

describe("acceptSuggestions: through the audited criteria write path only", () => {
  it("approved requisition without a reason: 400, nothing written", async () => {
    const ids = await idsOf();
    await expect(acceptSuggestions({ requisitionId: "r1", ids: [ids.education_min], values: {}, reason: null, actor, dryRun: false })).rejects.toMatchObject({ statusCode: 400 });
    expect(writes()).toEqual([]);
  });
  it("approved + reason: column, rule mode, one version with source jd_suggestion and audit rows", async () => {
    const ids = await idsOf();
    const r = await acceptSuggestions({ requisitionId: "r1", ids: [ids.education_min, ids.typing], values: { [ids.typing]: 25 }, reason: "Owner: criteria are in the skills text", actor, dryRun: false });
    expect(r.versionNo).toBe(1);
    expect(r.leavesLegacy).toBe(true);
    const req = h.state.reqs.get("r1")!;
    expect(req.education_requirement).toBe("Graduate");
    expect(req.meta_screening_config).toEqual({ auto_notify: true, min_typing_speed_wpm: 25 });
    expect(req.selection_rules).toMatchObject({ schema: 1, rules: { education_min: { mode: "must" }, typing: { mode: "prefer" } } });
    expect(h.state.versions).toEqual([expect.objectContaining({ source: "jd_suggestion", reason: "Owner: criteria are in the skills text", created_by: "u-hr" })]);
    expect(h.state.audit.map((a) => a.field)).toEqual(["education_requirement", "meta_screening_config", "selection_rules"]);
    expect(h.state.audit.every((a) => a.source === "jd_suggestion" && a.approval_status_at_change === "approved")).toBe(true);
    expect((await getSuggestions("r1", "hr")).suggestions).toEqual([]);
  });
  it("dry run: the result and nothing written", async () => {
    const ids = await idsOf();
    const r = await acceptSuggestions({ requisitionId: "r1", ids: [ids.education_min], values: {}, reason: "x", actor, dryRun: true });
    expect(r.versionId).toBeNull();
    expect(r.changed).toEqual(["education_requirement", "selection_rules"]);
    expect(writes()).toEqual([]);
  });
  it("a draft requisition needs no reason; the reason recorded names the phrases", async () => {
    h.state.reqs.set("r1", row({ approval_status: "draft" }));
    const ids = await idsOf();
    await acceptSuggestions({ requisitionId: "r1", ids: [ids.education_min], values: {}, reason: null, actor, dryRun: false });
    expect(h.state.versions[0].reason).toBe('Accepted from the requisition text: "Graduation"');
  });
  it("closed requisition: 409, nothing written", async () => {
    h.state.reqs.set("r1", row({ approval_status: "closed" }));
    const ids = await idsOf();
    await expect(acceptSuggestions({ requisitionId: "r1", ids: [ids.education_min], values: {}, reason: "x", actor, dryRun: false })).rejects.toMatchObject({ statusCode: 409 });
    expect(writes()).toEqual([]);
  });
  it("a suggestion id that no longer applies: 409 (reload), nothing written", async () => {
    await expect(acceptSuggestions({ requisitionId: "r1", ids: ["000000000000"], values: {}, reason: "x", actor, dryRun: false })).rejects.toMatchObject({ statusCode: 409 });
    expect(writes()).toEqual([]);
  });
  it("typing without HR's number: 400 with the reason", async () => {
    const ids = await idsOf();
    await expect(acceptSuggestions({ requisitionId: "r1", ids: [ids.typing], values: {}, reason: "x", actor, dryRun: false }))
      .rejects.toMatchObject({ statusCode: 400, message: "Typing speed needs a number (wpm): the text gives none" });
    expect(writes()).toEqual([]);
  });
  it("the AHMEDABAD config case: certificate already set is skipped and the config is never touched", async () => {
    h.state.reqs.set("r1", row({ skills_required: "DRA certificate mandatory, 12th pass", meta_screening_config: { auto_notify: true, certifications: ["DRA"], custom_field_rules: [{ op: "is_yes", field: "can_you_work_from_our_ahmedabad_location?", value: "" }] } }));
    const g = await getSuggestions("r1", "hr");
    expect(g.skipped.map((s) => s.key)).toEqual(["certificate"]);
    await acceptSuggestions({ requisitionId: "r1", ids: g.suggestions.map((s) => s.id), values: {}, reason: "x", actor, dryRun: false });
    expect(h.state.reqs.get("r1")!.meta_screening_config).toEqual({ auto_notify: true, certifications: ["DRA"], custom_field_rules: [{ op: "is_yes", field: "can_you_work_from_our_ahmedabad_location?", value: "" }] });
    expect(h.state.reqs.get("r1")!.education_requirement).toBe("12th");
  });
});

describe("dismissSuggestions: remembered per text version, audited", () => {
  it("a dismissed suggestion is hidden and listed as dismissed; undo shows it again", async () => {
    const ids = await idsOf();
    await dismissSuggestions({ requisitionId: "r1", ids: [ids.typing], undo: false, reason: null, actor });
    let g = await getSuggestions("r1", "hr");
    expect(g.suggestions.map((s) => s.key)).toEqual(["education_min"]);
    expect(g.dismissed.map((s) => s.key)).toEqual(["typing"]);
    expect(h.state.audit).toEqual([expect.objectContaining({ field: "jd_suggestion_dismissed", source: "jd_suggestion", actor_id: "u-hr", approval_status_at_change: "approved" })]);
    await dismissSuggestions({ requisitionId: "r1", ids: [ids.typing], undo: true, reason: null, actor });
    g = await getSuggestions("r1", "hr");
    expect(g.suggestions.map((s) => s.key)).toEqual(["education_min", "typing"]);
    expect(g.dismissed).toEqual([]);
  });
  it("a changed text gives a new id, so an old dismissal no longer hides it", async () => {
    const ids = await idsOf();
    await dismissSuggestions({ requisitionId: "r1", ids: [ids.typing], undo: false, reason: null, actor });
    h.state.reqs.get("r1")!.skills_required = "Graduation with fast typing speed";
    expect((await getSuggestions("r1", "hr")).suggestions.map((s) => s.key)).toEqual(["education_min", "typing"]);
  });
  it("unknown ids: 409; closed: 409", async () => {
    await expect(dismissSuggestions({ requisitionId: "r1", ids: ["000000000000"], undo: false, reason: null, actor })).rejects.toMatchObject({ statusCode: 409 });
    h.state.reqs.set("r1", row({ approval_status: "closed" }));
    const ids = await idsOf();
    await expect(dismissSuggestions({ requisitionId: "r1", ids: [ids.typing], undo: false, reason: null, actor })).rejects.toMatchObject({ statusCode: 409 });
    expect(writes()).toEqual([]);
  });
});
