import { describe, expect, it, vi } from "vitest";

/**
 * Reading a database this codebase already connects to.
 *
 * A source could read mas_hrms, or a connector registered in integration_config.
 * Neither reaches onfido_db or bella_db: both have their own credentials and
 * their own pool module, so local_query is access-denied and a connector would
 * mean copying the secret into a second place — two records of one credential
 * that can disagree, which is the trap provider-config already warns about.
 *
 * A named pool resolves to the pool that exists, and the secret never moves.
 */
vi.mock("../../../db/dialerDb.js", () => ({ getDialerPool: vi.fn() }));
vi.mock("../../../db/onfidoDb.js", () => ({ getOnfidoPool: vi.fn(async () => ({ query: vi.fn() })) }));
vi.mock("../../../db/bellaDb.js", () => ({ getBellaPool: vi.fn() }));
vi.mock("../../../db/aprDb.js", () => ({ getAprPool: vi.fn() }));
vi.mock("../../../db/masmisDb.js", () => ({ getMasmisPool: vi.fn() }));

const pools = await import("../kpi-studio.pools.js");

describe("named pools", () => {
  it("lists the databases a source may name", () => {
    const keys = pools.listNamedPools().map((p) => p.key);
    expect(keys).toContain("onfido");
    expect(keys).toContain("bella");
    expect(keys).toContain("dialer");
  });

  it("recognises a known pool and rejects anything else", () => {
    expect(pools.isNamedPool("onfido")).toBe(true);
    // The value arrives from stored configuration, so only a key in the fixed map
    // can ever resolve to a connection.
    expect(pools.isNamedPool("../../etc/passwd")).toBe(false);
    expect(pools.isNamedPool("constructor")).toBe(false);
    expect(pools.isNamedPool("")).toBe(false);
  });

  it("resolves a known pool to its existing accessor", async () => {
    const pool = await pools.getNamedPool("onfido");
    expect(pool).toBeTruthy();
  });

  it("names the alternatives when a source points at nothing", async () => {
    // Failing loudly beats returning no rows, which reads as "this client has no data".
    await expect(pools.getNamedPool("nope")).rejects.toThrow(/not a database this system knows/i);
    await expect(pools.getNamedPool("nope")).rejects.toThrow(/onfido/);
  });
});
