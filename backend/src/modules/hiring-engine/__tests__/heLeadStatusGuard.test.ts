import { beforeEach, describe, expect, it, vi } from "vitest";

/** E1: a no-show on one requisition never overwrites an opt-out, a join / arrival, or a live booking on another requisition. */
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }> }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => { h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p }); return [{ affectedRows: 1 }]; }) } }));

import { setLeadStatus } from "../he-lead.service.js";

beforeEach(() => { h.sqls = []; });

describe("setLeadStatus guards", () => {
  it("no_show leaves opted_out, joined, arrived and a person with another live booking alone", async () => {
    await setLeadStatus("L1", "no_show");
    expect(h.sqls[0].sql).toBe("UPDATE he_lead SET status = ?, status_at = NOW() WHERE id = ? AND status NOT IN ('opted_out','joined','arrived') AND NOT EXISTS (SELECT 1 FROM he_match x WHERE x.lead_id = ? AND x.state IN ('invited','confirmed') AND x.slot_at >= NOW())");
    expect(h.sqls[0].p).toEqual(["no_show", "L1", "L1"]);
  });
  it("nothing overwrites an opt-out (it is terminal); opting out itself always writes", async () => {
    await setLeadStatus("L1", "contacted");
    expect(h.sqls[0].sql).toBe("UPDATE he_lead SET status = ?, status_at = NOW() WHERE id = ? AND status <> 'opted_out'");
    await setLeadStatus("L1", "opted_out");
    expect(h.sqls[1].sql).toBe("UPDATE he_lead SET status = ?, status_at = NOW() WHERE id = ?");
  });
});
