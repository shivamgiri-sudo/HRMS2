import { describe, expect, it, vi } from "vitest";
import { ENGINE_MIGRATIONS, waitForMigrations } from "../wait-for-migrations.js";

/** hrms2-workers starts with the API and never runs migrations: the engine scheduler waits for the ledger (schema_migrations success rows). */
function clock() {
  let t = 0;
  return { now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }) };
}

describe("waitForMigrations", () => {
  it("lists the follow-up / selection migrations the engine needs", () => {
    expect(ENGINE_MIGRATIONS).toEqual(["migrations/2138_unified_followup.sql", "migrations/2140_walkin_invite.sql", "migrations/2141_candidate_response.sql",
      "migrations/2142_campaign_requisition.sql", "migrations/2145_requisition_selection_rules.sql", "migrations/2146_selection_person_fact.sql",
      "migrations/2147_shortlist_decisions.sql", "migrations/2148_followup_shortlist_link.sql"]);
  });
  it("starts at once when every row is already recorded successful", async () => {
    const c = clock(); const applied = vi.fn(async () => [...ENGINE_MIGRATIONS]);
    expect(await waitForMigrations(ENGINE_MIGRATIONS, { applied, ...c, log: vi.fn() })).toEqual({ ready: true, missing: [], waitedMs: 0 });
    expect(c.sleep).not.toHaveBeenCalled();
  });
  it("polls every 10 s until the API has applied them, logging once per minute", async () => {
    const c = clock(); const log = vi.fn();
    let polls = 0;
    const applied = vi.fn(async () => (++polls >= 13 ? [...ENGINE_MIGRATIONS] : ENGINE_MIGRATIONS.slice(0, 2)));
    const r = await waitForMigrations(ENGINE_MIGRATIONS, { applied, ...c, log });
    expect(r).toMatchObject({ ready: true, missing: [], waitedMs: 120_000 });
    expect(c.sleep.mock.calls.every(([ms]) => ms === 10_000)).toBe(true);
    expect(log).toHaveBeenCalledTimes(2); // 0 s and 60 s (120 s is ready)
    expect(String(log.mock.calls[0][0])).toContain("2141_candidate_response");
    expect(String(log.mock.calls[0][0])).not.toContain("2138_unified_followup");
  });
  it("gives up after 15 minutes and starts anyway (safe fallbacks), saying what is missing", async () => {
    const c = clock(); const log = vi.fn();
    const r = await waitForMigrations(ENGINE_MIGRATIONS, { applied: async () => [], ...c, log });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(ENGINE_MIGRATIONS);
    expect(r.waitedMs).toBe(15 * 60_000);
    expect(String(log.mock.calls.at(-1)?.[0])).toMatch(/starting anyway/);
  });
  it("a ledger read error is retried, never thrown", async () => {
    const c = clock(); let n = 0;
    const applied = vi.fn(async () => { if (++n === 1) throw new Error("ECONNREFUSED"); return [...ENGINE_MIGRATIONS]; });
    expect(await waitForMigrations(ENGINE_MIGRATIONS, { applied, ...c, log: vi.fn() })).toMatchObject({ ready: true, waitedMs: 10_000 });
  });
});
