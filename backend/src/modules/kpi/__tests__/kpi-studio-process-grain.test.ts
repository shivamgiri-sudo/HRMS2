import { describe, expect, it, vi } from "vitest";

/**
 * Process grain.
 *
 * The property under protection is that aggregation happens IN THE QUERY. A
 * process ratio is SUM(numerator)/SUM(denominator) across the whole process,
 * and averaging each agent's personal ratio gives a different, wrong number
 * whenever agents carry uneven volume. A roll-up implementation masquerading as
 * process grain would pass a naive "does it produce a number" test, so these
 * assert on the SQL that is actually issued.
 */
vi.mock("../../../db/mysql.js", () => ({ db: { query: vi.fn(), execute: vi.fn() } }));
vi.mock("../../external-db/external-db.service.js", () => ({ getPoolForKey: vi.fn() }));

const { buildProcessQueryPlan } = await import("../kpi-studio.sources.js");

const FIELDS = [
  { field_name: "prepaid", source_column: "prepaid_flag", aggregate_fn: "SUM", source_expression: null },
  { field_name: "total", source_column: "id", aggregate_fn: "COUNT", source_expression: null },
] as never[];

const CONSTANT_SOURCE = {
  id: "s1", source_code: "CLIENT_ORDERS", source_name: "Client orders",
  source_type: "integration_connector", integration_key: "proc_abc",
  source_object: "orders", date_column: "order_date",
  process_key_kind: "constant" as const, process_id: "p-gs1",
};

describe("buildProcessQueryPlan", () => {
  it("groups by DAY only — never by employee", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.sql).toMatch(/GROUP BY DATE\(`order_date`\)/);
    expect(plan.sql).not.toMatch(/employee/i);
  });

  it("aggregates in SQL, so the formula receives process totals", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    // Both fields must arrive already aggregated. If either came back per-row,
    // the formula would be averaging ratios rather than dividing totals.
    expect(plan.sql).toMatch(/SUM\(`prepaid_flag`\)/);
    expect(plan.sql).toMatch(/COUNT\(`id`\)/);
  });

  it("binds dates rather than interpolating them", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.sql).not.toContain("2026-08-01");
    expect(plan.params).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("filters by the client column when the source maps by column, binding the value", () => {
    const plan = buildProcessQueryPlan(
      { ...CONSTANT_SOURCE, process_key_kind: "column", process_key_column: "client_id", process_key_value: "487" } as never,
      FIELDS, "2026-08-01", "2026-08-31",
    );
    expect(plan.sql).toMatch(/`client_id` = \?/);
    // The identifier is validated and interpolated; the VALUE is bound, because
    // it is configuration a person typed — data, not SQL.
    expect(plan.params).toContain("487");
    expect(plan.sql).not.toContain("487");
  });

  it("refuses an unmapped source by name instead of silently returning nothing", () => {
    expect(() =>
      buildProcessQueryPlan({ ...CONSTANT_SOURCE, process_key_kind: "none" } as never, FIELDS, "2026-08-01", "2026-08-31"),
    ).toThrow(/not mapped to a process/i);
  });

  it("refuses a mapping with no process selected", () => {
    expect(() =>
      buildProcessQueryPlan({ ...CONSTANT_SOURCE, process_id: null } as never, FIELDS, "2026-08-01", "2026-08-31"),
    ).toThrow(/no process selected/i);
  });

  it("refuses a column mapping that names no column", () => {
    expect(() =>
      buildProcessQueryPlan(
        { ...CONSTANT_SOURCE, process_key_kind: "column", process_key_column: null } as never,
        FIELDS, "2026-08-01", "2026-08-31",
      ),
    ).toThrow(/no column is named/i);
  });

  it("rejects an injected identifier", () => {
    expect(() =>
      buildProcessQueryPlan(
        { ...CONSTANT_SOURCE, process_key_kind: "column", process_key_column: "x`; DROP TABLE y; --", process_key_value: "1" } as never,
        FIELDS, "2026-08-01", "2026-08-31",
      ),
    ).toThrow();
  });

  it("quotes a schema-qualified table one part at a time", () => {
    const plan = buildProcessQueryPlan(
      { ...CONSTANT_SOURCE, source_object: "dialer_db.cdr_in_10_4" } as never,
      FIELDS, "2026-08-01", "2026-08-31",
    );
    // `db`.`table`, not `db.table` — the latter is one table with a dot in its name.
    expect(plan.sql).toContain("`dialer_db`.`cdr_in_10_4`");
  });
});
