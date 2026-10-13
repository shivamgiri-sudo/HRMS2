import { beforeEach, describe, expect, it, vi } from "vitest";

// D4 arrival runs: each new Live Meta lead's facts are upserted into the cache (rewritten only when the hash changes) before the run.
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, facts: new Map<string, Record<string, unknown> | null>() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p }); return sql.trim().startsWith("SELECT") ? [[]] : [{ affectedRows: 1 }]; }) } }));
vi.mock("../facts-loader.service.js", async (orig) => ({ ...(await orig<object>()), loadMetaLeadFacts: vi.fn(async (id: string) => h.facts.get(id) ?? null) }));

import { cacheMetaLeadFacts, readFactCache } from "../fact-cache.service.js";

beforeEach(() => { h.sqls = []; h.facts = new Map(); });

describe("cacheMetaLeadFacts", () => {
  it("upserts one meta_live row per lead with facts; a lead without a valid mobile is skipped", async () => {
    h.facts.set("M1", { personKey: "9876543210", subSource: "meta_live", sourceKind: "meta_live" });
    h.facts.set("M2", null);
    expect(await cacheMetaLeadFacts(["M1", "M2"], new Date("2026-10-09T06:00:00Z"))).toBe(1);
    expect(h.sqls).toHaveLength(1);
    expect(h.sqls[0].sql).toContain("INSERT INTO selection_person_fact (mobile10, source_kind, sub_source, source_ref, facts_json, facts_hash, refreshed_at) VALUES (?, 'meta_live', ?, ?, ?, ?, ?)");
    expect(h.sqls[0].sql).toContain("facts_json = IF(facts_hash = VALUES(facts_hash), facts_json, VALUES(facts_json))");
    expect(h.sqls[0].p.slice(0, 2)).toEqual(["9876543210", "meta_live"]);
    expect(h.sqls[0].p[2]).toBe("M1");
    expect(h.sqls[0].p[5]).toBe("2026-10-09 11:30:00");
  });
});

describe("readFactCache: the Live Meta cache follows the rolling cutoff", () => {
  it("meta_live rows count only while the person is Live now (their source fill and FIRST fill on or after the cutoff); a person who rolled out is skipped", async () => {
    const { fillTypeSql } = await import("../../hiring-engine/he-source-attribution.js");
    await readFactCache({ sourceKind: "meta_live", limit: 10, liveFrom: "2026-10-02" });
    expect(h.sqls[0].sql).toContain("FROM selection_person_fact spf FORCE INDEX (idx_spf_source)");
    expect(h.sqls[0].sql).toContain(`AND EXISTS (SELECT 1 FROM meta_lead_raw r WHERE r.id = spf.source_ref COLLATE utf8mb4_unicode_ci AND ${fillTypeSql("r", "2026-10-02").replace(/\s+/g, " ")} = 'meta_live')`);
    expect(h.sqls[0].p).toEqual(["meta_live", "", 10]);
  });
  it("Old Meta and Hiring Engine rows are read as before (no fill check)", async () => {
    await readFactCache({ sourceKind: "meta_old", limit: 10, liveFrom: "2026-10-02" });
    await readFactCache({ sourceKind: "he", limit: 10 });
    for (const s of h.sqls) expect(s.sql).not.toContain("meta_lead_raw");
  });
});
