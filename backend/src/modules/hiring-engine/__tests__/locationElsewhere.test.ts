import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ matches: [] as Array<Record<string, unknown>>, sqls: [] as string[] }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async (sql: string) => {
    h.sqls.push(sql);
    if (sql.startsWith("UPDATE qualified_followup")) return [{ affectedRows: 2 }, []];
    if (sql.includes("FROM he_match m")) return [h.matches, []];
    if (sql.startsWith("UPDATE he_match")) return [{ affectedRows: 1 }, []];
    return [[], []];
  }) },
}));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-lead.service.js", () => ({ addEvent: vi.fn(async () => undefined) }));
import { markLocationElsewhere } from "../location-elsewhere.service.js";
import { detectOtherCity, elsewhereReply, type FactSheet } from "../reply-agent.rules.js";

beforeEach(() => { h.matches = [{ id: "M1", lead_id: "L1" }]; h.sqls = []; });

describe("markLocationElsewhere", () => {
  it("stops the person's open journeys and releases the slot they hold", async () => {
    const r = await markLocationElsewhere("7096078512", { city: "Ahmedabad", actor: "auto-reply" });
    expect(r).toEqual({ journeysStopped: 2, bookingsReleased: 1 });
    expect(h.sqls[0]).toContain("stopped_reason = ?");
    expect(h.sqls.some((s) => s.startsWith("UPDATE he_match SET state = 'declined'"))).toBe(true);
  });
});

describe("detectOtherCity", () => {
  it("finds a city the person says they live in, only when it is not the branch city", () => {
    expect(detectOtherCity("Sir I am in Ahmedabad currently", "NOIDA")).toBe("Ahmedabad");
    expect(detectOtherCity("I am staying in Surat", "NOIDA")).toBe("Surat");
    expect(detectOtherCity("I am in Noida, will come", "NOIDA")).toBeNull();
    expect(detectOtherCity("Is the interview in Ahmedabad also?", "NOIDA")).toBeNull(); // a question, no "I live / I am in" cue
    expect(detectOtherCity("I will come tomorrow", "NOIDA")).toBeNull();
  });
  it("answers politely and says which branch the walk-in is at", () => {
    const f = { name: "Sandip", branch: "NOIDA", company: "MAS Callnet", hrContact: null } as unknown as FactSheet;
    const t = elsewhereReply(f, "Ahmedabad");
    expect(t).toMatch(/^Dear Sandip,/);
    expect(t).toContain("you are in Ahmedabad");
    expect(t).toContain("NOIDA");
  });
});
