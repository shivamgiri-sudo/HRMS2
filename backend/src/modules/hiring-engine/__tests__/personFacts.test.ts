import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

import { PersonFacts, personFactsSql, typeKeyColsSql } from "../he-person-facts.service.js";
import { attributeSource, liveFirstFillSql, metaDriveSql, metaOriginSql } from "../he-source-attribution.js";

beforeEach(() => { vi.clearAllMocks(); });

describe("person facts, once per build", () => {
  it("reads each lead's Meta origin and first-fill verdict once, by primary key, 500 ids per statement", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `lead-${i}`);
    execute.mockImplementation(async (_sql: string, p: string[]) => [p.slice(0, 2).map((id) => ({ id, pm: 1, fl: 0 }))]);
    const f = new PersonFacts("2026-10-08");
    await f.load([...ids, null, undefined, "lead-0", "bad id; DROP"]);
    await f.load(ids); // already known: no statement
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([500, 1]);
    expect(String(execute.mock.calls[0][0])).toBe(`SELECT /*+ MAX_EXECUTION_TIME(8000) */ l.id, ${metaOriginSql("l")} AS pm, ${liveFirstFillSql("l", "lf", "2026-10-08")} AS fl
  FROM he_lead l LEFT JOIN meta_lead_raw lf ON lf.id = l.meta_lead_id COLLATE utf8mb4_unicode_ci
 WHERE l.id IN (${Array(500).fill("?").join(",")})`);
    expect(personFactsSql(2, "2026-10-08")).toContain("WHERE l.id IN (?,?)");
  });

  it("types a row exactly as attributeSource does (person facts + the row's own signals)", async () => {
    execute.mockResolvedValue([[{ id: "meta-live", pm: 1, fl: 1 }, { id: "meta-old", pm: 1, fl: 0 }, { id: "pool", pm: 0, fl: 0 }]]);
    const f = new PersonFacts("2026-10-08");
    await f.load(["meta-live", "meta-old", "pool", "no-lead-row"]);
    const LIVE = "2026-10-08 10:00:00", OLD = "2026-09-20 10:00:00";
    const facts: Record<string, { metaOrigin: boolean; firstFillAt: string | null }> = {
      "meta-live": { metaOrigin: true, firstFillAt: LIVE }, "meta-old": { metaOrigin: true, firstFillAt: OLD }, pool: { metaOrigin: false, firstFillAt: null }, "no-lead-row": { metaOrigin: false, firstFillAt: null },
    };
    for (const tl of Object.keys(facts)) for (const tm of [0, 1]) for (const tr of [0, 1]) {
      const expected = attributeSource({ metaOrigin: facts[tl].metaOrigin, driveSourceKind: tm ? "meta" : "pool", firstFillAt: facts[tl].firstFillAt, activityAt: tr ? "2026-10-09" : "2026-10-01", liveFrom: "2026-10-08" });
      expect(f.typeOf({ tl, tm, tr })).toBe(expected);
    }
    // a follow-up row whose first fill is its own (no lead, or a lead without meta_lead_id) carries that verdict in tx
    expect(f.typeOf({ tl: null, tm: 1, tr: 1, tx: 1 })).toBe("meta_live");
    expect(f.typeOf({ tl: "pool", tm: 1, tr: 1, tx: 0 })).toBe("meta_old");
    // a row with no signals keeps the type it carries
    expect(f.typeOf({ source_type: "meta_old" })).toBe("meta_old");
  });

  it("puts the row signals next to the lead id: Meta credit / Meta drive / own Meta signal, and activity on or after the cutoff", () => {
    expect(typeKeyColsSql({ streams: true, d: "d", leadId: "m.lead_id", ref: "d.drive_date", liveFrom: "2026-10-08" }))
      .toBe(`m.lead_id AS tl, (rs.source_type IN ('meta_live','meta_old') OR ${metaDriveSql("d")}) AS tm, (d.drive_date >= TIMESTAMP '2026-10-08 00:00:00') AS tr`);
    expect(typeKeyColsSql({ streams: false, d: "qd", leadId: "hl.id", ref: "qf.qualified_at", liveFrom: "2026-10-08", extraMeta: "qf.meta_lead_id IS NOT NULL" }))
      .toBe(`hl.id AS tl, (${metaDriveSql("qd")} OR qf.meta_lead_id IS NOT NULL) AS tm, (qf.qualified_at >= TIMESTAMP '2026-10-08 00:00:00') AS tr`);
  });
});
