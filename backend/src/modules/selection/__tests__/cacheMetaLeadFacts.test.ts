import { beforeEach, describe, expect, it, vi } from "vitest";

// D4 arrival runs: each new Live Meta lead's facts are upserted into the cache (rewritten only when the hash changes) before the run.
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, facts: new Map<string, Record<string, unknown> | null>() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p }); return [{ affectedRows: 1 }]; }) } }));
vi.mock("../facts-loader.service.js", async (orig) => ({ ...(await orig<object>()), loadMetaLeadFacts: vi.fn(async (id: string) => h.facts.get(id) ?? null) }));

import { cacheMetaLeadFacts } from "../fact-cache.service.js";

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
