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

describe("a filtered field stores no source_expression", () => {
  /** Capability probes report the migrated schema; the rest answers a bare row. */
  function studio(rest: (sql: string) => unknown) {
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("INFORMATION_SCHEMA.TABLES")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("kpi_employee_resolved")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("source_cols")) {
        return Promise.resolve([[{ source_cols: 4, grain_col: 1, filter_col: 1 }], []]);
      }
      return rest(text) as never;
    });
  }

  // Regression: saveSourceField used to store COUNT(`col`) alongside the filters.
  // buildFieldSelect refuses a field that carries both ("use one or the other"),
  // so every filtered field saved through the API or the UI failed at READ time,
  // long after the save reported success. Proven live against dialer_db, where
  // it made AL% unreadable.
  it("leaves source_expression null so the filters can be compiled in", async () => {
    studio(() => Promise.resolve([[{ id: "s1" }], []]));
    await svc.saveSourceField({
      id: "f1",
      data_source_id: "s1",
      field_name: "answered",
      source_column: "CallDate",
      aggregate_fn: "COUNT",
      filter_json: [{ column: "AgentId", op: "ne", value: "VDCL" }],
    } as never);
    const write = execute.mock.calls.find(([sql]) =>
      String(sql).includes("kpi_studio_source_field") && String(sql).includes("source_expression"));
    expect(write).toBeTruthy();
    // Param order follows the SET list: field_name, display_name, source_column,
    // aggregate_fn, source_expression, ...
    expect((write?.[1] as unknown[])[4]).toBeNull();
  });

  it("still stores the expression when there are no filters", async () => {
    studio(() => Promise.resolve([[{ id: "s1" }], []]));
    await svc.saveSourceField({
      id: "f1",
      data_source_id: "s1",
      field_name: "total",
      source_column: "CallDate",
      aggregate_fn: "COUNT",
    } as never);
    const write = execute.mock.calls.find(([sql]) =>
      String(sql).includes("kpi_studio_source_field") && String(sql).includes("source_expression"));
    expect((write?.[1] as unknown[])[4]).toBe("COUNT(`CallDate`)");
  });
});

describe("deleteDataSource refuses while a KPI still reads it", () => {
  /** Capability probes, then whatever the caller says for the rest. */
  function studio(rest: (sql: string) => unknown) {
    execute.mockImplementation((sql: string) => {
      const text = String(sql);
      if (text.includes("INFORMATION_SCHEMA.TABLES")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("kpi_employee_resolved")) return Promise.resolve([[{ n: 6 }], []]);
      if (text.includes("source_cols")) {
        return Promise.resolve([[{ source_cols: 4, grain_col: 1, filter_col: 1 }], []]);
      }
      return rest(text) as never;
    });
  }

  it("names the KPIs using it rather than breaking them silently", async () => {
    studio((text) => {
      if (text.includes("FROM kpi_studio_definition d")) {
        return Promise.resolve([[{ metric_code: "AHT" }, { metric_code: "QUALITY_SCORE" }], []]);
      }
      return Promise.resolve([[], []]);
    });
    await expect(svc.deleteDataSource("s1")).rejects.toThrow(/still used by 2 KPIs/i);
    await expect(svc.deleteDataSource("s1")).rejects.toThrow(/AHT/);
  });

  it("counts a KPI that reads it as an EXTRA source too", async () => {
    // The definition's primary source is something else, but its formula still
    // reads this one. Missing that path would break exactly the cross-system
    // metrics extra_source_ids exists to support.
    studio((text) => {
      if (text.includes("FROM kpi_studio_definition_source")) {
        return Promise.resolve([[{ metric_code: "AL_PCT" }], []]);
      }
      return Promise.resolve([[], []]);
    });
    await expect(svc.deleteDataSource("s1")).rejects.toThrow(/AL_PCT/);
  });

  it("does not double-count a KPI that reads it both ways", async () => {
    studio((text) => {
      if (text.includes("FROM kpi_studio_definition d")) return Promise.resolve([[{ metric_code: "AHT" }], []]);
      if (text.includes("FROM kpi_studio_definition_source")) return Promise.resolve([[{ metric_code: "AHT" }], []]);
      return Promise.resolve([[], []]);
    });
    await expect(svc.deleteDataSource("s1")).rejects.toThrow("This source is still used by 1 KPI (AHT). Retire or repoint it first.");
  });

  it("retires the source when nothing uses it", async () => {
    studio((text) => text.includes("UPDATE")
      ? Promise.resolve([{ affectedRows: 1 }, []])
      : Promise.resolve([[], []]));
    await expect(svc.deleteDataSource("s1")).resolves.toEqual({ removed: true });
    const updates = execute.mock.calls.filter(([sql]) => String(sql).includes("SET active_status = 0"));
    expect(updates.some(([sql]) => String(sql).includes("kpi_studio_data_source"))).toBe(true);
  });

  // Retiring used to take the fields down too, which made restoring hand back an
  // empty source and every field a retyping job. The source flag alone hides them.
  it("leaves the fields alone so a restore returns the source whole", async () => {
    studio((text) => text.includes("UPDATE")
      ? Promise.resolve([{ affectedRows: 1 }, []])
      : Promise.resolve([[], []]));
    await svc.deleteDataSource("s1");
    const touched = execute.mock.calls.filter(([sql]) =>
      String(sql).includes("kpi_studio_source_field") && String(sql).includes("active_status = 0"));
    expect(touched).toHaveLength(0);
  });

  it("restores a retired source", async () => {
    studio((text) => text.includes("UPDATE")
      ? Promise.resolve([{ affectedRows: 1 }, []])
      : Promise.resolve([[], []]));
    await expect(svc.restoreDataSource("s1")).resolves.toEqual({ restored: true });
    const call = execute.mock.calls.find(([sql]) => String(sql).includes("SET active_status = 1"));
    expect(String(call?.[0])).toContain("kpi_studio_data_source");
    expect(call?.[1]).toEqual(["s1"]);
  });

  it("reports restored:false for an id that is not there", async () => {
    studio((text) => text.includes("UPDATE")
      ? Promise.resolve([{ affectedRows: 0 }, []])
      : Promise.resolve([[], []]));
    await expect(svc.restoreDataSource("nope")).resolves.toEqual({ restored: false });
  });

  it("hides retired sources by default and shows them on request", async () => {
    studio(() => Promise.resolve([[], []]));
    await svc.listDataSources();
    const normal = execute.mock.calls.find(([sql]) => String(sql).includes("FROM kpi_studio_data_source s"));
    expect(String(normal?.[0])).toContain("s.active_status = 1");
    execute.mockClear();
    await svc.listDataSources(true);
    const all = execute.mock.calls.find(([sql]) => String(sql).includes("FROM kpi_studio_data_source s"));
    expect(String(all?.[0])).not.toContain("s.active_status = 1");
  });

  it("deactivates rather than deleting, so the numbers keep their explanation", async () => {
    studio((text) => text.includes("UPDATE")
      ? Promise.resolve([{ affectedRows: 1 }, []])
      : Promise.resolve([[], []]));
    await svc.deleteDataSource("s1");
    expect(execute.mock.calls.some(([sql]) => /DELETE\s+FROM/i.test(String(sql)))).toBe(false);
  });

  it("reports not-removed for a source that was not there", async () => {
    studio((text) => {
      if (text.includes("UPDATE kpi_studio_data_source")) return Promise.resolve([{ affectedRows: 0 }, []]);
      return Promise.resolve([[], []]);
    });
    await expect(svc.deleteDataSource("nope")).resolves.toEqual({ removed: false });
  });

  it("treats a missing extra-source table as no references, not as an error", async () => {
    // kpi_studio_definition_source came in 1646 and is not in the capability
    // probe, so it may legitimately be absent.
    studio((text) => {
      if (text.includes("FROM kpi_studio_definition_source")) {
        return Promise.reject(new Error("Table 'kpi_studio_definition_source' doesn't exist"));
      }
      if (text.includes("UPDATE")) return Promise.resolve([{ affectedRows: 1 }, []]);
      return Promise.resolve([[], []]);
    });
    await expect(svc.deleteDataSource("s1")).resolves.toEqual({ removed: true });
  });
});
