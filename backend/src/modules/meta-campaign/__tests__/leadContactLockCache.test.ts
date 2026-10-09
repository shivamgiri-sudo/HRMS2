import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ tables: ["qualified_followup"] as string[], calls: 0 }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => { h.calls++; return [h.tables.map((t) => ({ t }))]; }) },
}));

import { optionalTables, resetOptionalTables } from "../lead-contact-lock.js";

describe("optional table presence cache", () => {
  beforeEach(() => { resetOptionalTables(); h.tables = ["qualified_followup"]; h.calls = 0; });

  it("a table created after the first check (migration 2140 applied while running) is picked up after a short TTL, no restart", async () => {
    const t0 = 1_000_000;
    expect([...(await optionalTables(t0))]).toEqual(["qualified_followup"]);
    h.tables = ["qualified_followup", "walkin_invite"];
    expect((await optionalTables(t0 + 10_000)).has("walkin_invite")).toBe(false); // still cached within the TTL
    expect((await optionalTables(t0 + 61_000)).has("walkin_invite")).toBe(true);
  });

  it("once every optional table is present the answer is kept (no more lookups)", async () => {
    h.tables = ["qualified_followup", "walkin_invite"];
    await optionalTables(0);
    await optionalTables(10 * 86_400_000);
    expect(h.calls).toBe(1);
  });
});
