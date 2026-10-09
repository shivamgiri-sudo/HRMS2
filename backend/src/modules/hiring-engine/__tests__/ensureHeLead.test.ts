import { beforeEach, describe, expect, it, vi } from "vitest";

// A journey row needs its Hiring Engine lead to book and send. Meta rows are bridged; a Hiring Engine row enrolled without the
// link (an older enrolment or another caller) finds the lead by mobile and stamps it (rig finding, final integration).
const h = vi.hoisted(() => ({ sqls: [] as Array<{ sql: string; p: unknown[] }>, lead: "L9" as string | null, bridge: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async (sql: string, p: unknown[] = []) => {
  h.sqls.push({ sql: sql.replace(/\s+/g, " ").trim(), p });
  if (sql.startsWith("SELECT id FROM he_lead")) return [h.lead ? [{ id: h.lead }] : []];
  return [{ affectedRows: 1 }];
}) } }));
vi.mock("../he-meta-bridge.service.js", () => ({ bridgeOneMetaLead: h.bridge }));

import { ensureHeLead, type FollowupRow } from "../qualified-followup.context.js";

const row = (o: Partial<FollowupRow>) => ({ id: "F1", sourceType: "he", metaLeadId: null, heLeadId: null, mobile10: "9876543210", ...o }) as FollowupRow;
beforeEach(() => { h.sqls = []; h.lead = "L9"; h.bridge.mockClear(); });

describe("ensureHeLead", () => {
  it("a row with its lead: no statement", async () => {
    expect(await ensureHeLead(row({ heLeadId: "L1" }))).toBe("L1");
    expect(h.sqls).toEqual([]);
  });
  it("a Hiring Engine row without the link: the lead by mobile, stamped on the row", async () => {
    expect(await ensureHeLead(row({}))).toBe("L9");
    expect(h.sqls.map((s) => s.sql)).toEqual(["SELECT id FROM he_lead WHERE mobile10 = ? COLLATE utf8mb4_unicode_ci LIMIT 1",
      "UPDATE qualified_followup SET he_lead_id = ? WHERE id = ? AND he_lead_id IS NULL"]);
    expect(h.bridge).not.toHaveBeenCalled();
  });
  it("no lead for the mobile: null (the step is blocked as before)", async () => {
    h.lead = null;
    expect(await ensureHeLead(row({}))).toBeNull();
  });
  it("a Meta row is bridged first", async () => {
    expect(await ensureHeLead(row({ sourceType: "meta_live", metaLeadId: "M1" }))).toBe("L9");
    expect(h.bridge).toHaveBeenCalledWith("M1");
  });
});
