import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The writers must actually STORE the new configuration.
 *
 * This file exists because the opposite happened: the UI was extended to collect
 * grain, the process mapping and field filters while all three writers silently
 * dropped them. Everything looked configured and nothing changed. These tests
 * assert the columns reach the SQL.
 *
 * They also pin the capability gate: on a database without 1680/1681 the writers
 * must NOT name columns that do not exist, or a working form starts 400ing.
 */
const { execute, query } = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query, getConnection: vi.fn() },
}));
vi.mock("../kpi-studio.gsheet.js", () => ({
  validateSheetCsvUrl: (u: string) => u,
  fetchSheetCsv: vi.fn(),
  parseSheetDate: vi.fn(),
  parseSheetNumber: vi.fn(),
}));

const svc = await import("../kpi-studio.service.js");

/** Answers the capability probes, then a generated UUID for inserts. */
function mockCapability(opts: { processGrain: boolean; fieldFilters: boolean }) {
  execute.mockImplementation((sql: string) => {
    const text = String(sql);
    if (text.includes("INFORMATION_SCHEMA.TABLES")) return Promise.resolve([[{ n: 6 }], []]);
    if (text.includes("kpi_employee_resolved")) return Promise.resolve([[{ n: 6 }], []]);
    if (text.includes("source_cols")) {
      return Promise.resolve([[{
        source_cols: opts.processGrain ? 4 : 0,
        grain_col: opts.processGrain ? 1 : 0,
        filter_col: opts.fieldFilters ? 1 : 0,
      }], []]);
    }
    if (text.includes("SELECT UUID()")) return Promise.resolve([[{ id: "generated-id" }], []]);
    return Promise.resolve([{ affectedRows: 1 }, []]);
  });
}

const insertInto = (table: string) =>
  execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO " + table));

const storedJson = (params: unknown[]) =>
  params.find((p) => typeof p === "string" && p.startsWith("["));

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  svc.resetStudioCapability();
});

describe("saveDataSource stores the process mapping", () => {
  it("writes the mapping when the schema supports it", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await svc.saveDataSource({
      source_code: "CLIENT_ORDERS", source_name: "Client orders", source_type: "integration_connector",
      integration_key: "proc_abc", source_object: "orders", date_column: "order_date",
      process_key_kind: "column", process_key_column: "client_id", process_key_value: "487",
      process_id: "p-gs1",
    } as never);

    const call = insertInto("kpi_studio_data_source");
    expect(call).toBeTruthy();
    expect(String(call![0])).toContain("process_key_kind");
    expect(call![1]).toContain("column");
    expect(call![1]).toContain("client_id");
    expect(call![1]).toContain("487");
    expect(call![1]).toContain("p-gs1");
  });

  it("does not name the columns when the schema lacks them", async () => {
    mockCapability({ processGrain: false, fieldFilters: false });
    await svc.saveDataSource({
      source_code: "X", source_name: "X", source_type: "local_query",
      source_object: "t", date_column: "d", process_key_kind: "constant", process_id: "p1",
    } as never);
    expect(String(insertInto("kpi_studio_data_source")![0])).not.toContain("process_key_kind");
  });

  it("refuses a mapping with no process chosen", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveDataSource({
        source_code: "X", source_name: "X", source_type: "local_query",
        source_object: "t", date_column: "d", process_key_kind: "constant",
      } as never),
    ).rejects.toThrow(/Pick the process/i);
  });

  it("refuses a column mapping that names no column", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveDataSource({
        source_code: "X", source_name: "X", source_type: "local_query",
        source_object: "t", date_column: "d", process_key_kind: "column", process_id: "p1",
      } as never),
    ).rejects.toThrow(/Name the column/i);
  });

  it("refuses an unknown mapping kind", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveDataSource({
        source_code: "X", source_name: "X", source_type: "local_query",
        source_object: "t", date_column: "d", process_key_kind: "sneaky", process_id: "p1",
      } as never),
    ).rejects.toThrow(/Unknown process mapping/i);
  });
});

describe("saveSourceField stores filters", () => {
  it("writes filters as JSON when the schema supports it", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await svc.saveSourceField({
      data_source_id: "s1", field_name: "answered", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "AgentId", op: "ne", value: "VDCL" }],
    } as never);
    const call = insertInto("kpi_studio_source_field");
    expect(String(call![0])).toContain("filter_json");
    expect(JSON.parse(String(storedJson(call![1] as unknown[])))).toEqual([
      { column: "AgentId", op: "ne", value: "VDCL" },
    ]);
  });

  it("splits an is-one-of list into real values", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await svc.saveSourceField({
      data_source_id: "s1", field_name: "won", source_column: "amount", aggregate_fn: "SUM",
      filter_json: [{ column: "status", op: "in", value: "won, closed , " }],
    } as never);
    const call = insertInto("kpi_studio_source_field");
    expect(JSON.parse(String(storedJson(call![1] as unknown[])))[0].value).toEqual(["won", "closed"]);
  });

  it("refuses an injected filter column", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveSourceField({
        data_source_id: "s1", field_name: "x", source_column: "id", aggregate_fn: "COUNT",
        filter_json: [{ column: "a OR 1=1", op: "eq", value: "1" }],
      } as never),
    ).rejects.toThrow(/not a valid column name/i);
  });

  it("refuses an unknown operator", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveSourceField({
        data_source_id: "s1", field_name: "x", source_column: "id", aggregate_fn: "COUNT",
        filter_json: [{ column: "a", op: "DROP", value: "1" }],
      } as never),
    ).rejects.toThrow(/Unsupported condition/i);
  });

  it("refuses a condition that needs a value but has none", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveSourceField({
        data_source_id: "s1", field_name: "x", source_column: "id", aggregate_fn: "COUNT",
        filter_json: [{ column: "a", op: "eq", value: "  " }],
      } as never),
    ).rejects.toThrow(/needs a value/i);
  });

  it("allows is_null without a value", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await svc.saveSourceField({
      data_source_id: "s1", field_name: "open_items", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "closed_at", op: "is_null" }],
    } as never);
    const call = insertInto("kpi_studio_source_field");
    expect(JSON.parse(String(storedJson(call![1] as unknown[])))[0]).toEqual({
      column: "closed_at", op: "is_null", value: null,
    });
  });

  it("refuses a filter with no aggregate to apply it inside", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveSourceField({
        data_source_id: "s1", field_name: "x", source_column: "id", aggregate_fn: "NONE",
        filter_json: [{ column: "a", op: "eq", value: "1" }],
      } as never),
    ).rejects.toThrow(/needs an aggregate/i);
  });

  it("ignores filters entirely when the schema lacks the column", async () => {
    mockCapability({ processGrain: false, fieldFilters: false });
    await svc.saveSourceField({
      data_source_id: "s1", field_name: "x", source_column: "id", aggregate_fn: "COUNT",
      filter_json: [{ column: "a", op: "eq", value: "1" }],
    } as never);
    expect(String(insertInto("kpi_studio_source_field")![0])).not.toContain("filter_json");
  });
});

describe("saveDefinition stores grain", () => {
  it("refuses an unknown grain rather than defaulting silently", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    await expect(
      svc.saveDefinition({ metric_id: "m1", process_id: "p1", grain: "sideways" } as never),
    ).rejects.toThrow(/Unknown grain/i);
  });
});

describe("resolveStudioForEmployee excludes process-grain definitions", () => {
  it("filters them out in SQL, so a process figure never lands on a personal scorecard", async () => {
    mockCapability({ processGrain: true, fieldFilters: true });
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("INFORMATION_SCHEMA.TABLES")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("kpi_employee_resolved")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("source_cols")) {
        return Promise.resolve([[{ source_cols: 4, grain_col: 1, filter_col: 1 }], []]);
      }
      if (text.includes("FROM employees")) {
        return Promise.resolve([[{ id: "e1", branch_id: "b1", process_id: "p1", designation_id: "d1" }], []]);
      }
      return Promise.resolve([[], []]);
    });

    await svc.resolveStudioForEmployee("e1", "2026-09-07");

    const call = execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM kpi_studio_definition"));
    expect(call).toBeTruthy();
    expect(String(call![0])).toContain("= 'employee'");
  });

  it("omits the clause on a database without the grain column", async () => {
    mockCapability({ processGrain: false, fieldFilters: false });
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("INFORMATION_SCHEMA.TABLES")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("kpi_employee_resolved")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("source_cols")) {
        return Promise.resolve([[{ source_cols: 0, grain_col: 0, filter_col: 0 }], []]);
      }
      if (text.includes("FROM employees")) {
        return Promise.resolve([[{ id: "e1", branch_id: null, process_id: null, designation_id: null }], []]);
      }
      return Promise.resolve([[], []]);
    });

    await svc.resolveStudioForEmployee("e1", "2026-09-07");
    const call = execute.mock.calls.find(([sql]) =>
      String(sql).includes("FROM kpi_studio_definition"));
    expect(String(call![0])).not.toContain("grain");
  });
});
