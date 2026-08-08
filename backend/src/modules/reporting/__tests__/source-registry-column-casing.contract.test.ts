/**
 * information_schema labels its columns UPPERCASE on this server.
 *
 * Measured against mas_hrms on 2026-08-08: the registry's own query returns TABLE_SCHEMA,
 * TABLE_NAME, COLUMN_NAME and DATA_TYPE in uppercase across all 13,092 rows. The loader read
 * `row.table_schema` etc., so every value was undefined and `key(undefined, undefined)` threw
 * `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` on the FIRST row.
 * loadSnapshot() rejected, its .catch rethrew, and nothing between there and the route caught
 * it — so all 14 BPO master report codes answered 500, and had since the registry was added.
 *
 * The existing suite could not see this: tests/setup.ts mocks db.execute to `[[], []]`, so the
 * loop never executes and the snapshot resolves to an empty map — green, and meaningless. These
 * tests therefore supply rows themselves, in BOTH casings, because which one the server sends is
 * a server property and hardcoding either reintroduces the bug on the other configuration.
 *
 * Reverting `pick()` to plain `row.table_schema` access makes the uppercase case below throw.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { sourceColumns, clearSourceRegistryCache } = await import("../bpo-master-source-registry.js");

/** One column of employee_bank_detail, in whichever case the server chose to label it. */
function row(upper: boolean) {
  const base = {
    table_schema: "mas_hrms",
    table_name: "employee_bank_detail",
    column_name: "account_number",
    data_type: "varbinary",
  };
  const shaped: Record<string, unknown> = { current_schema: "mas_hrms" };
  for (const [k, v] of Object.entries(base)) shaped[upper ? k.toUpperCase() : k] = v;
  return shaped;
}

beforeEach(() => {
  execute.mockReset();
  clearSourceRegistryCache();
});

describe("the source registry reads information_schema in either column case", () => {
  it("resolves columns when the server labels them UPPERCASE (the live shape)", async () => {
    execute.mockResolvedValue([[row(true)], []]);

    const columns = await sourceColumns("employee_bank_detail");

    expect(columns.size).toBe(1);
    const column = columns.get("account_number");
    expect(column).toBeDefined();
    expect(column!.column).toBe("account_number");
    expect(column!.table).toBe("employee_bank_detail");
    // dataType drives binary handling; undefined here is how a Buffer reaches JSON unnoticed.
    expect(column!.dataType).toBe("varbinary");
  });

  it("still resolves them when the server labels them lowercase", async () => {
    execute.mockResolvedValue([[row(false)], []]);

    const columns = await sourceColumns("employee_bank_detail");

    expect(columns.get("account_number")?.dataType).toBe("varbinary");
  });

  it("does not throw on a row that is missing identifiers entirely", async () => {
    // A malformed row must be skipped, not abort the whole snapshot and 500 every report.
    execute.mockResolvedValue([[{ current_schema: "mas_hrms" }, row(true)], []]);

    const columns = await sourceColumns("employee_bank_detail");

    expect(columns.get("account_number")).toBeDefined();
  });
});
