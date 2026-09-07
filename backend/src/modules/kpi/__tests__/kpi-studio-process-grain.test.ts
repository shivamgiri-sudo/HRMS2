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

describe("field filters", () => {
  // The pair that motivated filters: two differently-filtered numbers out of the
  // SAME table in one query. Without this, AL% cannot be configured — which is
  // why it had to be hand-written in TypeScript.
  const AL_FIELDS = [
    { field_name: "offered", source_column: "id", aggregate_fn: "COUNT", source_expression: null },
    {
      field_name: "answered", source_column: "id", aggregate_fn: "COUNT", source_expression: null,
      filter_json: [{ column: "AgentId", op: "ne", value: "VDCL" }],
    },
  ] as never[];

  it("compiles a filter into a CASE inside the aggregate", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, AL_FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.sql).toMatch(/COUNT\(`id`\) AS `offered`/);
    expect(plan.sql).toMatch(/COUNT\(CASE WHEN `AgentId` <> \? THEN `id` END\) AS `answered`/);
  });

  it("binds the filter value and puts it BEFORE the date params", () => {
    // Order matters: the CASE sits in the SELECT list, which MySQL binds ahead of
    // the WHERE clause. A wrong order shifts every placeholder and yields a
    // plausible but wrong number instead of an error.
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, AL_FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.params).toEqual(["VDCL", "2026-08-01", "2026-08-31"]);
    expect(plan.sql).not.toContain("VDCL");
  });

  it("puts filter params before BOTH the dates and the process key value", () => {
    const plan = buildProcessQueryPlan(
      { ...CONSTANT_SOURCE, process_key_kind: "column", process_key_column: "CampaignName", process_key_value: "Blabliblu_IN" } as never,
      AL_FIELDS, "2026-08-01", "2026-08-31",
    );
    expect(plan.params).toEqual(["VDCL", "2026-08-01", "2026-08-31", "Blabliblu_IN"]);
  });

  it("emits no ELSE, so nothing matching reads as null rather than zero", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, AL_FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.sql).not.toMatch(/ELSE 0/);
  });

  it("supports an IN filter with each value bound", () => {
    const plan = buildProcessQueryPlan(
      CONSTANT_SOURCE as never,
      [{ field_name: "sales", source_column: "amount", aggregate_fn: "SUM",
         filter_json: [{ column: "status", op: "in", value: ["won", "closed"] }] }] as never[],
      "2026-08-01", "2026-08-31",
    );
    expect(plan.sql).toMatch(/`status` IN \(\?,\?\)/);
    expect(plan.params.slice(0, 2)).toEqual(["won", "closed"]);
  });

  it("supports IS NULL without expecting a value", () => {
    const plan = buildProcessQueryPlan(
      CONSTANT_SOURCE as never,
      [{ field_name: "unresolved", source_column: "id", aggregate_fn: "COUNT",
         filter_json: [{ column: "closed_at", op: "is_null" }] }] as never[],
      "2026-08-01", "2026-08-31",
    );
    expect(plan.sql).toMatch(/`closed_at` IS NULL/);
  });

  it("rejects an unknown operator by name", () => {
    expect(() =>
      buildProcessQueryPlan(
        CONSTANT_SOURCE as never,
        [{ field_name: "x", source_column: "id", aggregate_fn: "COUNT",
           filter_json: [{ column: "a", op: "; DROP TABLE t" }] }] as never[],
        "2026-08-01", "2026-08-31",
      ),
    ).toThrow(/Unsupported filter/i);
  });

  it("rejects an injected filter column", () => {
    expect(() =>
      buildProcessQueryPlan(
        CONSTANT_SOURCE as never,
        [{ field_name: "x", source_column: "id", aggregate_fn: "COUNT",
           filter_json: [{ column: "a` = 1 OR `1", op: "eq", value: 1 }] }] as never[],
        "2026-08-01", "2026-08-31",
      ),
    ).toThrow();
  });

  it("accepts filter_json arriving as a JSON string from the driver", () => {
    const plan = buildProcessQueryPlan(
      CONSTANT_SOURCE as never,
      [{ field_name: "answered", source_column: "id", aggregate_fn: "COUNT",
         filter_json: '[{"column":"AgentId","op":"ne","value":"VDCL"}]' }] as never[],
      "2026-08-01", "2026-08-31",
    );
    expect(plan.params).toContain("VDCL");
  });
});

/**
 * A date stored as text.
 *
 * Client tables keep dates as varchar constantly. db_masmis.bvo_order_export has
 * 3,050,861 order rows whose order_date reads "01-01-2025" — DD-MM-YYYY in a
 * varchar — alongside financial_status ('paid' vs 'COD') and total, which is
 * precisely the source for Prepaid % and Net Revenue.
 *
 * The danger is not that such a column fails. It is that it SUCCEEDS: comparing
 * `order_date >= '2026-08-01'` compares strings, "01-01-2025" sorts after that
 * bound, and a month filter returns a confident and completely wrong set of rows
 * with no error anywhere.
 */
describe("date stored as text", () => {
  const TEXT_DATE_SOURCE = {
    ...CONSTANT_SOURCE,
    source_object: "bvo_order_export",
    date_column: "order_date",
    date_format: "%d-%m-%Y",
  };

  it("parses the column everywhere the date is used", () => {
    const plan = buildProcessQueryPlan(TEXT_DATE_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    // Both WHERE bounds, the SELECT and the GROUP BY. Parsing in the filter while
    // grouping on the raw text would bucket rows by their spelling and produce one
    // group per distinct string.
    const occurrences = plan.sql.match(/STR_TO_DATE\(`order_date`, '%d-%m-%Y'\)/g) ?? [];
    expect(occurrences.length).toBe(4);
    expect(plan.sql).not.toMatch(/`order_date` >=/);
  });

  it("leaves a real date column alone", () => {
    const plan = buildProcessQueryPlan(CONSTANT_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.sql).not.toContain("STR_TO_DATE");
    expect(plan.sql).toContain("`order_date` >=");
  });

  it("refuses a format that is not on the list, rather than interpolating it", () => {
    // The format is interpolated, not bound, so this is the injection boundary.
    const evil = { ...TEXT_DATE_SOURCE, date_format: "%Y') OR 1=1 -- " };
    expect(() => buildProcessQueryPlan(evil as never, FIELDS, "2026-08-01", "2026-08-31"))
      .toThrow(/Unsupported date format/);
  });

  it("still binds the date bounds as parameters", () => {
    const plan = buildProcessQueryPlan(TEXT_DATE_SOURCE as never, FIELDS, "2026-08-01", "2026-08-31");
    expect(plan.params).toContain("2026-08-01");
    expect(plan.params).toContain("2026-08-31");
  });
});
