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

/**
 * readSourceValues (the employee-grain read path) had no case for
 * source_type "named_pool" -- it fell through to the default branch and
 * returned 'Unknown source type "named_pool"', even though
 * readConnectorQuery (which it never routed to) already had a complete
 * named_pool branch. Hit live 2026-09-09 by ONFIDO_AGENT_DAILY, an
 * employee-grain source with 4 active definitions. The fix is one added
 * case in the switch; this proves it actually dispatches there now rather
 * than trusting that the switch statement was edited correctly.
 */
describe("readSourceValues dispatches named_pool sources", () => {
  it("routes a named_pool source to the connector path instead of erroring", async () => {
    vi.resetModules();
    const execute = vi.fn().mockResolvedValue([
      [{ id: "emp-1", employee_code: "MAS999" }],
      [],
    ]);
    vi.doMock("../../../db/mysql.js", () => ({ db: { query: vi.fn(), execute } }));
    const namedQuery = vi.fn().mockResolvedValue([
      [{ __employee_key: "MAS999", __score_date: "2026-09-09", answered: 5 }],
      [],
    ]);
    vi.doMock("../kpi-studio.pools.js", () => ({
      getNamedPool: vi.fn(async () => ({ query: namedQuery })),
    }));

    const { readSourceValues } = await import("../kpi-studio.sources.js");

    const source = {
      id: "s-onfido", source_code: "ONFIDO_AGENT_DAILY", source_type: "named_pool",
      integration_key: "onfido", source_object: "onfido_agent_daily_raw",
      employee_key_column: "agent_name", employee_key_kind: "employee_code",
      date_column: "work_date",
    };
    const fields = [{ id: "f1", data_source_id: "s-onfido", field_name: "answered", source_column: "answered", aggregate_fn: "SUM" }];

    const result = await readSourceValues(source as never, fields as never, ["emp-1"], "2026-09-01", "2026-09-09");

    expect(result.error).toBeUndefined();
    expect(namedQuery).toHaveBeenCalled();
    expect(result.rowsRead).toBe(1);
  });
});
