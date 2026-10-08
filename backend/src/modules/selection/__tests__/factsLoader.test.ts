import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { sqls: [] as Array<[string, unknown[]]>, heRows: [] as Array<Record<string, unknown>>, metaRows: [] as Array<Record<string, unknown>>, heByMobile: new Map<string, Record<string, unknown>>() };
  const exec = async (sql: string, p: unknown[] = []) => {
    const s = sql.replace(/\s+/g, " ").trim();
    state.sqls.push([s, p]);
    if (s.startsWith("SELECT l.id, l.mobile10, l.age")) {
      const [after, limit] = [String(p[0]), Number(p[p.length - 1])];
      return [state.heRows.filter((r) => String(r.mobile10) > after).slice(0, limit), []];
    }
    if (s.startsWith("SELECT m.id, m.parsed_phone")) {
      const [after, , limit] = [String(p[0]), p[1], Number(p[p.length - 1])];
      return [state.metaRows.filter((r) => String(r.id) > after).slice(0, limit), []];
    }
    if (s.startsWith("SELECT l.id, l.mobile10, l.ats_candidate_id, l.status") ) {
      const mobiles = p as string[];
      return [mobiles.map((m) => state.heByMobile.get(m)).filter(Boolean), []];
    }
    return [[], []];
  };
  return { state, exec };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(h.exec) } }));
vi.mock("../../hiring-engine/he-eligibility.service.js", () => ({
  loadEligibilityFacts: vi.fn(async (leads: Array<{ id: string }>) => new Map(leads.map((l) => [l.id, {
    status: "new", finalStatus: "none", isEmployee: false, age: null, lastAttemptDate: null, walkinCount: 0, lastOutcome: null, approaches30d: 0, exEmployee: null,
    requisition: { processName: null }, rejections: [], alreadySelectedForRequisition: false, alreadyBookedForRequisition: false, noShowsForRequisition: 0, now: new Date(),
  }]))),
}));

import { HE_RECORD_TYPES, loadRawPeople } from "../facts-loader.service.js";
import { factsHashOf, refreshFactCache } from "../fact-cache.service.js";
import { fillTypeSql } from "../../hiring-engine/he-source-attribution.js";
import { baseFacts, ok } from "./fixtures/facts.js";

const heRow = (i: number, o: Record<string, unknown> = {}) => ({
  id: `L${i}`, mobile10: `9${String(100000000 + i).slice(-9)}`, ats_candidate_id: i % 3 ? `A${i}` : null, status: "new", final_status: "none", is_employee: 0, walkin_count: 0, last_attempt_date: null, last_outcome: null,
  age: 25, education_rank: 5, experience_years: 1, night_shift_ok: 1, locality: "Noida", lat: null, lng: null, email: null, updated_at: "2026-10-01 00:00:00", primary_source: "meta",
  record_type: i % 3 === 1 ? "naukri_import" : i % 3 === 2 ? "candidate" : null, sourcing_channel: i % 3 === 2 && i % 2 ? "Walk-in" : null, ...o,
});
const NOW = new Date("2026-10-09T06:00:00Z");
const own = () => h.state.sqls.length;

beforeEach(() => { h.state.sqls.length = 0; h.state.heRows = []; h.state.metaRows = []; h.state.heByMobile.clear(); vi.clearAllMocks(); });

describe("loadRawPeople (Hiring Engine pool)", () => {
  it("reads only candidate, Naukri and WorkIndia records (or pool leads with no ATS record), never legacy or test", async () => {
    h.state.heRows = [heRow(1)];
    await loadRawPeople({ sourceKind: "he", limit: 10 }, NOW);
    const base = h.state.sqls.find(([s]) => s.startsWith("SELECT l.id, l.mobile10"))![0];
    expect(HE_RECORD_TYPES).toEqual(["candidate", "naukri_import", "workindia_import"]);
    expect(base).toContain("(ac.id IS NULL OR ac.record_type IN ('candidate','naukri_import','workindia_import'))");
    expect(base).not.toMatch(/legacy_employee|'test'/);
    expect(base).toContain("ORDER BY l.mobile10 LIMIT ?");
  });
  it("one statement per fact family: at most 8 of its own per chunk (eligibility is its own module)", async () => {
    h.state.heRows = Array.from({ length: 50 }, (_, i) => heRow(i));
    await loadRawPeople({ sourceKind: "he", limit: 2000 }, NOW);
    expect(own()).toBeLessThanOrEqual(8);
    expect(h.state.sqls.filter(([s]) => s.startsWith("SELECT l.id, l.mobile10"))).toHaveLength(1);
  });
  it("resumes after the last mobile; the last short chunk ends the cursor", async () => {
    h.state.heRows = Array.from({ length: 5 }, (_, i) => heRow(i));
    const a = await loadRawPeople({ sourceKind: "he", limit: 3 }, NOW);
    expect(a.people).toHaveLength(3);
    expect(a.nextKey).toBe(h.state.heRows[2].mobile10);
    const b = await loadRawPeople({ sourceKind: "he", limit: 3, afterKey: a.nextKey! }, NOW);
    expect(h.state.sqls.filter(([s]) => s.startsWith("SELECT l.id, l.mobile10")).at(-1)![1][0]).toBe(a.nextKey);
    expect(b.people.map((x) => x.person.mobile)).toEqual(h.state.heRows.slice(3).map((r) => r.mobile10));
    expect(b.nextKey).toBeNull();
  });
  it("sub-sources: Naukri, WorkIndia, candidate, walk-in, pool lead without ATS", async () => {
    h.state.heRows = [heRow(0), heRow(1), heRow(2, { sourcing_channel: null }), heRow(5, { sourcing_channel: "Walk-in" }), heRow(7, { record_type: "workindia_import" })];
    const r = await loadRawPeople({ sourceKind: "he", limit: 10 }, NOW);
    expect(r.people.map((x) => x.person.subSource)).toEqual(["pool_other", "naukri_import", "candidate", "walk_in", "workindia_import"]);
  });
  it("a sub-source filter narrows the SQL", async () => {
    await loadRawPeople({ sourceKind: "he", subSources: ["naukri_import"], limit: 10 }, NOW);
    const [sql, params] = h.state.sqls.find(([s]) => s.startsWith("SELECT l.id, l.mobile10"))!;
    expect(sql).toContain("ac.record_type IN (?)");
    expect(params).toContain("naukri_import");
  });
});

describe("loadRawPeople (Meta)", () => {
  it("live = the shared attribution rule (first Meta fill on or after meta.live_from); joins the pool lead by mobile; skips invalid phones", async () => {
    h.state.metaRows = [
      { id: "m1", parsed_phone: "+91 98765 43210", raw_payload: "{\"id\":\"x\",\"field_data\":[]}", parsed_education: null, parsed_location: null, parsed_experience_yr: null, created_at: "2026-10-08 10:00:00", requisition_id: "r1" },
      { id: "m2", parsed_phone: "123", raw_payload: null, parsed_education: null, parsed_location: null, parsed_experience_yr: null, created_at: "2026-10-08 10:00:00", requisition_id: "r1" },
    ];
    h.state.heByMobile.set("9876543210", heRow(1, { mobile10: "9876543210", id: "Lx" }));
    const r = await loadRawPeople({ sourceKind: "meta_live", limit: 10, liveFrom: "2026-10-08" }, NOW);
    const [sql, params] = h.state.sqls.find(([s]) => s.startsWith("SELECT m.id, m.parsed_phone"))!;
    expect(sql).toContain(`${fillTypeSql("m", "2026-10-08")} = ?`.replace(/\s+/g, " "));
    expect(params[1]).toBe("meta_live");
    expect(r.people.map((x) => x.person.mobile)).toEqual(["9876543210"]);
    expect(r.people[0].person.lead?.id).toBe("Lx");
    expect(r.skippedInvalidMobile).toBe(1);
  });
});

describe("fact cache", () => {
  it("facts_hash changes only when the facts change", () => {
    const a = baseFacts({ age: ok(25) });
    expect(factsHashOf(a)).toBe(factsHashOf(baseFacts({ age: ok(25) })));
    expect(factsHashOf(a)).not.toBe(factsHashOf(baseFacts({ age: ok(26) })));
  });
  it("a person in two sources gets two cache rows (Live Meta and pool)", async () => {
    h.state.heRows = [heRow(1, { mobile10: "9876543210" })];
    h.state.metaRows = [{ id: "m1", parsed_phone: "9876543210", raw_payload: null, parsed_education: null, parsed_location: null, parsed_experience_yr: null, created_at: "2026-10-08 10:00:00", requisition_id: "r1" }];
    await refreshFactCache({ sourceKind: "he", chunk: 100, now: NOW });
    await refreshFactCache({ sourceKind: "meta_live", chunk: 100, now: NOW });
    const ups = h.state.sqls.filter(([s]) => s.startsWith("INSERT INTO selection_person_fact"));
    expect(ups.map(([, p]) => [p[0], p[1]])).toEqual([["9876543210", "he"], ["9876543210", "meta_live"]]);
  });
  it("60k pool rows refresh in 30 chunks of 2,000, then stale rows of that source are removed", async () => {
    h.state.heRows = Array.from({ length: 60000 }, (_, i) => heRow(i, { ats_candidate_id: null, record_type: null }));
    const r = await refreshFactCache({ sourceKind: "he", chunk: 2000, now: NOW });
    expect(r).toMatchObject({ chunks: 30, people: 60000 });
    expect(h.state.sqls.filter(([s]) => s.startsWith("INSERT INTO selection_person_fact"))).toHaveLength(30);
    const del = h.state.sqls.filter(([s]) => s.startsWith("DELETE FROM selection_person_fact"));
    expect(del).toHaveLength(1);
    expect(del[0][0]).toBe("DELETE FROM selection_person_fact WHERE source_kind = ? AND refreshed_at < ? LIMIT 5000");
  });
});
