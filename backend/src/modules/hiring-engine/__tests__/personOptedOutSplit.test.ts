import { beforeEach, describe, expect, it, vi } from "vitest";

/** STOP lookup in two statements: the old he_lead STOP check can never be lost because followup_person (2138) is missing. */
const h = vi.hoisted(() => ({ sqls: [] as string[], leadHit: false, personHit: false, personMissing: false, leadFails: false, error: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: vi.fn(async (sql: string) => {
      const q = sql.replace(/\s+/g, " ").trim();
      h.sqls.push(q);
      if (q.includes("FROM he_lead l")) {
        if (h.leadFails) throw Object.assign(new Error("connection lost"), { code: "PROTOCOL_CONNECTION_LOST" });
        return [h.leadHit ? [{ hit: 1 }] : []];
      }
      if (q.includes("FROM followup_person")) {
        if (h.personMissing) throw Object.assign(new Error("Table 'x.followup_person' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
        return [h.personHit ? [{ hit: 1 }] : []];
      }
      return [[]];
    }),
  },
}));
vi.mock("../../../logger.js", () => ({ logger: { error: h.error, warn: vi.fn(), info: vi.fn() } }));

import { personOptedOut } from "../qualified-followup.service.js";
import { _resetFollowupSchemaLog } from "../followup-schema-guard.js";

beforeEach(() => { h.sqls = []; h.leadHit = false; h.personHit = false; h.personMissing = false; h.leadFails = false; h.error.mockClear(); _resetFollowupSchemaLog(); });

describe("personOptedOut", () => {
  it("two separate statements; neither carries the other's table", async () => {
    expect(await personOptedOut("9876543210")).toBe(false);
    expect(h.sqls).toHaveLength(2);
    expect(h.sqls[0]).toContain("FROM he_lead l");
    expect(h.sqls[0]).not.toContain("followup_person");
    expect(h.sqls[1]).toContain("FROM followup_person");
  });
  it("he_lead STOP answers true without reading followup_person", async () => {
    h.leadHit = true; h.personMissing = true;
    expect(await personOptedOut("9876543210")).toBe(true);
    expect(h.sqls).toHaveLength(1);
  });
  it("followup_person missing (before 2138): only that half is lost, the he_lead check still answers; one clear error", async () => {
    h.personMissing = true;
    expect(await personOptedOut("9876543210")).toBe(false);
    expect(await personOptedOut("9876543210")).toBe(false);
    expect(h.error).toHaveBeenCalledTimes(1);
  });
  it("followup_person STOP counts", async () => {
    h.personHit = true;
    expect(await personOptedOut("9876543210")).toBe(true);
  });
  it("the old he_lead half failing throws (callers fail closed for outbound)", async () => {
    h.leadFails = true;
    await expect(personOptedOut("9876543210")).rejects.toThrow(/connection lost/);
  });
});
