import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateFacts } from "../selection-types.js";

const h = vi.hoisted(() => ({
  sqls: [] as string[], cache: [] as Array<{ mobile10: string; subSource: string; facts: unknown; factsHash: string }>,
  row: {} as Record<string, unknown>, overrides: [] as Array<Record<string, unknown>>, live: [] as unknown[],
}));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const s = sql.replace(/\s+/g, " ").trim();
      h.sqls.push(s);
      if (s.startsWith("SELECT jr.id")) return [[h.row], []];
      if (s.startsWith("SELECT id FROM job_requisition_criteria_version")) return [[{ id: "v7" }], []];
      if (s.startsWith("SELECT requested_headcount")) return [[{ requested_headcount: 25, fulfilled_headcount: 5 }], []];
      if (s.startsWith("SELECT mobile10, requisition_scope")) return [h.overrides, []];
      return [[], []];
    }),
  },
}));
vi.mock("../fact-cache.service.js", () => ({
  readFactCache: vi.fn(async (o: { afterKey?: string; limit: number }) => {
    const start = o.afterKey ? h.cache.findIndex((x) => x.mobile10 === o.afterKey) + 1 : 0;
    const rows = h.cache.slice(start, start + o.limit);
    return { rows, nextKey: rows.length === o.limit ? rows[rows.length - 1].mobile10 : null };
  }),
}));
vi.mock("../facts-loader.service.js", () => ({ loadRawPeople: vi.fn(async () => ({ people: h.live, nextKey: null, skippedInvalidMobile: 0 })) }));
vi.mock("../../hiring-engine/he-source-attribution.service.js", async () => {
  const { rollingLiveFrom } = await import("../../hiring-engine/he-source-attribution.js");
  return { loadLiveFrom: vi.fn(async (now: Date) => rollingLiveFrom(now)) };
});

import { previewCsv, previewRequisition } from "../preview.service.js";
import { readFactCache } from "../fact-cache.service.js";
import { baseFacts, ok } from "./fixtures/facts.js";

const reqRow = (o: Record<string, unknown> = {}) => ({
  id: "r1", requisition_code: "REQ-1", branch_name: "NOIDA-2", process_name: "Onfido", education_requirement: "12th", skills_required: null, experience_min_years: null, experience_max_years: null,
  meta_target_age_min: 18, meta_target_age_max: 35, meta_target_locations: null, meta_target_radius_km: null, shift_requirement: null, night_shift_required: 0, rotational_shift: 0,
  salary_min: null, salary_max: null, preferred_sources: null, meta_screening_config: null, approval_status: "approved",
  selection_rules: { schema: 1, rules: { age: { mode: "must", missing: "review" }, education_min: { mode: "must", missing: "review" } } }, bcity: "Noida", bstate: "Uttar Pradesh", ...o,
});
const person = (i: number, o: Partial<CandidateFacts> = {}) => {
  const m = `98${String(10000000 + i)}`;
  return { mobile10: m, subSource: "candidate", factsHash: `h${i}`, facts: baseFacts({ personKey: m, firstName: `Name${i} `.trim(), age: ok(20 + (i % 25)), educationRank: ok((i % 6) + 1), ...o }) };
};
const NOW = new Date("2026-10-09T06:00:00Z");

beforeEach(() => { h.sqls.length = 0; h.cache = []; h.row = reqRow(); h.overrides = []; h.live = []; });

describe("previewRequisition", () => {
  it("funnel, outcome, sample and seats for the saved criteria version", async () => {
    h.cache = Array.from({ length: 60 }, (_, i) => person(i));
    const p = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(p).toMatchObject({ requisitionId: "r1", versionId: "v7", draft: false, start: 60, capPreview: { seatsLeft: 20, dailyCap: null }, partial: [] });
    expect(p.steps.map((s) => s.key)).toEqual(["system", "age", "education_min"]);
    expect(p.outcome.shortlist + p.outcome.review + p.outcome.rejected + p.outcome.systemExcluded).toBe(60);
    expect(p.sample.every((x) => /^\d{2}x{6}\d{2}$/.test(x.maskedMobile))).toBe(true);
    expect(p.sample.length).toBeLessThanOrEqual(50);
  });
  it("a draft changes the counts and writes nothing", async () => {
    h.cache = Array.from({ length: 60 }, (_, i) => person(i));
    const saved = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    const draft = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW, draft: { educationRequirement: "Graduate" } });
    expect(draft).toMatchObject({ draft: true, versionId: null });
    expect(draft.outcome.shortlist).toBeLessThan(saved.outcome.shortlist);
    expect(h.sqls.some((s) => /^(INSERT|UPDATE|DELETE)/.test(s))).toBe(false);
  });
  it("a contradictory draft is 422 with issues", async () => {
    await expect(previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW, draft: { ageMin: 40, ageMax: 30 } })).rejects.toMatchObject({ statusCode: 422 });
  });
  it("this requisition's own journey is a system block; another requisition's is not", async () => {
    h.cache = [person(1, { system: { ...baseFacts().system, inOtherJourney: "r1" } }), person(2, { system: { ...baseFacts().system, inOtherJourney: "r9" } })];
    const p = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(p.outcome.systemExcluded).toBe(2); // r9 = in another journey (system), r1 = already in this requisition
  });
  it("HR overrides apply: include passes, exclude fails; specific beats '*'", async () => {
    h.cache = [person(1, { age: ok(50) }), person(2)];
    h.overrides = [
      { mobile10: h.cache[0].mobile10, requisition_scope: "*", kind: "exclude", reason: "global", actor_id: "u", created_at: "t" },
      { mobile10: h.cache[0].mobile10, requisition_scope: "r1", kind: "include", reason: "knows the process", actor_id: "u", created_at: "t" },
      { mobile10: h.cache[1].mobile10, requisition_scope: "*", kind: "exclude", reason: "duplicate", actor_id: "u", created_at: "t" },
    ];
    const p = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(p.sample.find((x) => x.override?.includes("knows the process"))?.verdict).toBe("pass");
    expect(p.sample.find((x) => x.override?.includes("duplicate"))?.verdict).toBe("fail");
  });
  it("an empty cache reads the records live, capped, and says so", async () => {
    h.live = [{ person: { sourceKind: "he", subSource: "candidate", mobile: "9876543210", ats: null, lead: { age: 25, education_rank: 5 }, profile: null, meta: null, dra: null,
      system: baseFacts().system, contact: { lastFirstContactAt: null } }, sourceRef: "L1" }];
    const p = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(p.start).toBe(1);
    expect(p.partial).toEqual(["facts_cache_empty_live_read"]);
  });
  it("404 for an unknown requisition", async () => {
    h.row = undefined as never;
    await expect(previewRequisition({ requisitionId: "x", sourceKind: "he", now: NOW })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("previewCsv", () => {
  it("has masked mobiles only (never a full 10-digit number) and first names", async () => {
    h.cache = Array.from({ length: 30 }, (_, i) => person(i));
    const csv = await previewCsv({ requisitionId: "r1", sourceKind: "he", now: NOW });
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("mobile,first_name,source,verdict,score,system_block,failed_rules,review_reasons,override");
    expect(lines).toHaveLength(31);
    expect(csv).not.toMatch(/\b[6-9]\d{9}\b/);
    expect(lines[1]).toMatch(/^98x{6}\d{2},Name0,candidate,/);
  });
  it("neutralises spreadsheet formulas from names and the override reason (= + - @ TAB CR), quoting where needed", async () => {
    h.cache = [person(0, { firstName: "=cmd|' /C calc'!A0" }), person(1, { firstName: "@SUM(1)" }), person(2, { firstName: "+1" }), person(3, { firstName: "-2" }), person(4, { firstName: "\tx" })];
    h.overrides = [{ mobile10: h.cache[0].mobile10, requisition_scope: "r1", kind: "include", reason: "=HYPERLINK(\"http://x\")", actor_id: "u1", created_at: "2026-10-09 10:00:00" }];
    const csv = await previewCsv({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(csv).toContain(",'=cmd|' /C calc'!A0,");
    expect(csv).toContain(",'@SUM(1),");
    expect(csv).toContain(",'+1,");
    expect(csv).toContain(",'-2,");
    expect(csv).toContain(",'\tx,");
    expect(csv).toContain(`"include: =HYPERLINK(""http://x"")"`); // the override cell starts with the kind, never with "="
    for (const line of csv.trim().split("\n").slice(1)) for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+@\t\r]/);
  });
});

describe("performance budget", () => {
  it.skipIf(process.env.SKIP_PERF === "1")("70k cached people evaluate into a funnel in under 5 s", async () => {
    h.cache = Array.from({ length: 70_000 }, (_, i) => person(i));
    const t0 = performance.now();
    const p = await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    const ms = performance.now() - t0;
    expect(p.start).toBe(70_000);
    expect(ms).toBeLessThan(5000);
  }, 30_000);
});

describe("Live Meta preview under the rolling cutoff", () => {
  it("reads the Live Meta cache with the cutoff of the preview's clock (people whose first fill left the window are not Live)", async () => {
    h.cache = [person(1)];
    await previewRequisition({ requisitionId: "r1", sourceKind: "meta_live", now: NOW });
    expect(vi.mocked(readFactCache).mock.calls.at(-1)?.[0]).toMatchObject({ sourceKind: "meta_live", liveFrom: "2026-10-02" });
    await previewRequisition({ requisitionId: "r1", sourceKind: "he", now: NOW });
    expect(vi.mocked(readFactCache).mock.calls.at(-1)?.[0]).not.toHaveProperty("liveFrom");
  });
});
