import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sqls: [] as Array<[string, unknown[]]>, reqs: [] as Array<Record<string, unknown>>, cache: [] as Array<Record<string, unknown>>,
  ats: [] as Array<Record<string, unknown>>, leads: [] as Array<Record<string, unknown>>, overrides: [] as Array<Record<string, unknown>>,
  decisions: [] as Array<Record<string, unknown>>, followups: [] as Array<Record<string, unknown>>, outOfScope: new Set<string>(), live: [] as unknown[], branchPeople: new Set<string>(),
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string, p: unknown[] = []) => {
      const s = sql.replace(/\s+/g, " ").trim();
      h.sqls.push([s, p]);
      if (s.startsWith("SELECT jr.id FROM job_requisition jr")) return [h.reqs.map((r) => ({ id: r.id })), []];
      if (s.startsWith("SELECT jr.id")) return [h.reqs.filter((r) => r.id === p[0]), []];
      if (s.startsWith("SELECT source_kind, sub_source, facts_json, facts_hash FROM selection_person_fact")) return [h.cache.filter((c) => c.mobile10 === p[0]), []];
      if (s.startsWith("SELECT ac.mobile, ac.full_name, ac.record_type FROM ats_candidate ac WHERE ac.candidate_code")) return [h.ats.filter((a) => a.candidate_code === p[0]), []];
      if (s.startsWith("SELECT ac.mobile, ac.full_name, ac.record_type FROM ats_candidate ac WHERE ac.mobile IN")) return [h.ats.filter((a) => (p as string[]).includes(String(a.mobile))), []];
      if (s.startsWith("SELECT x.mobile10, x.full_name FROM")) return [h.leads.filter((l) => String(l.full_name).toLowerCase().startsWith(String(p[0]).replace("%", "").toLowerCase())).slice(0, 10), []];
      if (s.startsWith("SELECT mobile10, requisition_scope")) return [h.overrides, []];
      if (s.startsWith("SELECT sc.run_id")) return [h.decisions.filter((d) => d.requisition_id === p[0]), []];
      if (s.startsWith("SELECT requisition_id, stopped_reason")) return [h.followups, []];
      if (s.startsWith("SELECT 1 AS hit FROM (")) return [h.branchPeople.has(`${p[0]}@${p[1]}`) ? [{ hit: 1 }] : [], []];
      return [[], []];
    }),
  },
}));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.outOfScope.has(k.id)) } }));
vi.mock("../facts-loader.service.js", async (orig) => ({ ...(await orig<typeof import("../facts-loader.service.js")>()), loadHePeopleByMobiles: vi.fn(async () => h.live) }));

import { whyNot } from "../why-not.service.js";
import { normaliseFacts } from "../facts-normalise.js";
import { baseFacts } from "./fixtures/facts.js";

const NOW = new Date("2026-10-09T06:00:00Z");
const user = { id: "u1", role: "hr" } as never;
const req = (id: string, code: string, branch: string, o: Record<string, unknown> = {}) => ({
  id, requisition_code: code, branch_name: branch, process_name: "Onfido", education_requirement: "12th", skills_required: null, experience_min_years: null, experience_max_years: null,
  meta_target_age_min: null, meta_target_age_max: null, meta_target_locations: null, meta_target_radius_km: null, shift_requirement: null, night_shift_required: 0, rotational_shift: 0,
  salary_min: null, salary_max: null, preferred_sources: null, meta_screening_config: null, selection_rules: null, approval_status: "approved", bcity: branch === "AHMEDABAD" ? "Ahmedabad" : "Noida", bstate: null, ...o,
});
const workIndia = () => normaliseFacts({ sourceKind: "he", subSource: "workindia_import", mobile: "9876543210", ats: { record_type: "workindia_import", education: "Graduate", address: "ccc", full_name: "Ravi Kumar" },
  lead: null, profile: null, meta: null, dra: null, system: baseFacts().system, contact: { lastFirstContactAt: null } }, NOW);

beforeEach(() => {
  h.sqls.length = 0; h.reqs = [req("r1", "REQ-N1", "NOIDA-2"), req("r2", "REQ-A1", "AHMEDABAD")]; h.cache = []; h.ats = []; h.leads = []; h.overrides = []; h.decisions = []; h.followups = []; h.outOfScope.clear(); h.live = []; h.branchPeople.clear();
});

describe("whyNot people scope (I3)", () => {
  const ahmHr = { all: false as const, branchName: "AHMEDABAD" };
  it("a branch user never sees a person with no row in their branch: not even a masked entry", async () => {
    h.ats = [{ mobile: "9876543210", full_name: "Old Staff", record_type: "legacy_employee", candidate_code: "C1" }];
    expect(await whyNot("9876543210", { user, now: NOW, scope: ahmHr })).toEqual([]);
    expect(h.sqls.some(([s]) => s.startsWith("SELECT ac.mobile, ac.full_name, ac.record_type FROM ats_candidate ac WHERE ac.mobile IN"))).toBe(false);
    expect(await whyNot("C1", { user, now: NOW, scope: ahmHr })).toEqual([]);
  });
  it("a person with a match / lead / follow-up row in the caller's branch is shown", async () => {
    h.ats = [{ mobile: "9876543210", full_name: "Old Staff", record_type: "legacy_employee", candidate_code: "C1" }];
    h.branchPeople.add("9876543210@AHMEDABAD");
    const r = await whyNot("9876543210", { user, now: NOW, scope: ahmHr });
    expect(r).toHaveLength(1);
    const sql = h.sqls.find(([s]) => s.startsWith("SELECT 1 AS hit FROM ("))![0];
    for (const t of ["he_match", "qualified_followup", "meta_lead_raw", "walkin_invite"]) expect(sql).toContain(t);
  });
  it("an org-wide user is not filtered (no scope lookup)", async () => {
    h.ats = [{ mobile: "9876543210", full_name: "Old Staff", record_type: "legacy_employee", candidate_code: "C1" }];
    expect(await whyNot("9876543210", { user, now: NOW, scope: { all: true } })).toHaveLength(1);
    expect(h.sqls.some(([s]) => s.startsWith("SELECT 1 AS hit FROM ("))).toBe(false);
  });
});

describe("whyNot", () => {
  it("a former-employee record is explained, never evaluated against criteria", async () => {
    h.ats = [{ mobile: "9876543210", full_name: "Old Staff", record_type: "legacy_employee", candidate_code: "C1" }];
    const [p] = await whyNot("9876543210", { user, now: NOW, scope: { all: true } });
    expect(p.perRequisition).toHaveLength(2);
    for (const r of p.perRequisition) expect(r).toMatchObject({ verdict: "fail", systemBlock: "legacy_employee", explanation: "Never contacted: former employee record (legacy import)" });
  });
  it("WorkIndia 'ccc' address: location unknown (placeholder 'ccc'), verdict review", async () => {
    h.cache = [{ mobile10: "9876543210", source_kind: "he", sub_source: "workindia_import", facts_json: JSON.stringify(workIndia()), facts_hash: "x" }];
    const [p] = await whyNot("9876543210", { user, now: NOW, scope: { all: true } });
    const r1 = p.perRequisition.find((r) => r.requisitionId === "r1")!;
    expect(r1.verdict).toBe("review");
    expect(r1.unknown.map((u) => u.actualText)).toContain("location unknown (placeholder 'ccc')");
    expect(p.person.sources).toEqual(["workindia_import"]);
  });
  it("an exclude override shows its actor and reason", async () => {
    h.cache = [{ mobile10: "9876543210", source_kind: "he", sub_source: "workindia_import", facts_json: workIndia(), facts_hash: "x" }];
    h.overrides = [{ mobile10: "9876543210", requisition_scope: "*", kind: "exclude", reason: "asked not to be called", actor_id: "hr-7", created_at: "2026-10-09 10:00:00" }];
    const [p] = await whyNot("9876543210", { user, now: NOW, scope: { all: true } });
    expect(p.perRequisition[0]).toMatchObject({ verdict: "fail", override: { kind: "exclude", reason: "asked not to be called", actorId: "hr-7" } });
  });
  it("the full mobile appears only when HR searched for it", async () => {
    h.cache = [{ mobile10: "9876543210", source_kind: "he", sub_source: "workindia_import", facts_json: workIndia(), facts_hash: "x" }];
    h.ats = [{ mobile: "9876543210", full_name: "Ravi Kumar", record_type: "workindia_import", candidate_code: "WI-77" }];
    const byMobile = await whyNot("+91 98765 43210", { user, now: NOW, scope: { all: true } });
    expect(byMobile[0].person).toMatchObject({ maskedMobile: "98xxxxxx10", fullMobileIfSearched: "9876543210", name: "Ravi" });
    const byCode = await whyNot("WI-77", { user, now: NOW, scope: { all: true } });
    expect(byCode[0].person.fullMobileIfSearched).toBeNull();
    expect(JSON.stringify(byCode)).not.toContain("9876543210");
  });
  it("requisitions outside the caller's scope are left out; one requisition can be asked for", async () => {
    h.cache = [{ mobile10: "9876543210", source_kind: "he", sub_source: "workindia_import", facts_json: workIndia(), facts_hash: "x" }];
    h.outOfScope.add("r2");
    expect((await whyNot("9876543210", { user, now: NOW, scope: { all: true } }))[0].perRequisition.map((r) => r.requisitionId)).toEqual(["r1"]);
    expect((await whyNot("9876543210", { user, now: NOW, scope: { all: true }, requisitionId: "r2" }))[0].perRequisition).toEqual([]);
  });
  it("a name search needs 3 characters and returns at most 10 people", async () => {
    await expect(whyNot("ra", { user, now: NOW, scope: { all: true } })).rejects.toMatchObject({ statusCode: 400 });
    h.leads = Array.from({ length: 14 }, (_, i) => ({ mobile10: `98${String(10000000 + i)}`, full_name: `Ravi ${i}` }));
    const out = await whyNot("Rav", { user, now: NOW, scope: { all: true } });
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.every((p) => p.person.fullMobileIfSearched === null)).toBe(true);
  });
  it("the last stored decision and the follow-up state are shown", async () => {
    h.cache = [{ mobile10: "9876543210", source_kind: "he", sub_source: "workindia_import", facts_json: workIndia(), facts_hash: "x" }];
    h.decisions = [{ requisition_id: "r1", run_id: "run-1", status: "approved", updated_at: "2026-10-09 09:00:00", version_no: 3 }];
    h.followups = [{ requisition_id: "r1", stopped_reason: null, email_status: "sent", wa_status: null, call_state: "pending" }];
    const r1 = (await whyNot("9876543210", { user, now: NOW, scope: { all: true } }))[0].perRequisition.find((r) => r.requisitionId === "r1")!;
    expect(r1.lastDecision).toEqual({ runId: "run-1", status: "approved", versionNo: 3, at: "2026-10-09 09:00:00" });
    expect(r1.journey).toEqual({ state: "in follow-up", requisitionId: "r1" });
  });
});
