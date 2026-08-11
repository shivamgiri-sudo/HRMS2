import { beforeEach, describe, expect, it, vi } from "vitest";

type ExecuteCall = [string, unknown[]?];

const { dbExecute, aprExecute, qualityExecute, outboundExecute, salesBrandExecute, getPoolForKey } = vi.hoisted(() => {
  const dbExecute = vi.fn();
  const aprExecute = vi.fn();
  const qualityExecute = vi.fn();
  const outboundExecute = vi.fn();
  const salesBrandExecute = vi.fn();
  return {
    dbExecute,
    aprExecute,
    qualityExecute,
    outboundExecute,
    salesBrandExecute,
    getPoolForKey: vi.fn(async (key: string) => {
      if (key === "apr_productivity") return { execute: aprExecute };
      if (key === "quality_audit") return { execute: qualityExecute };
      if (key === "outbound_calls") return { execute: outboundExecute };
      if (key === "sales_brand_mis") return { execute: salesBrandExecute };
      throw new Error(`No credentials configured for integration: ${key}`);
    }),
  };
});

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: dbExecute },
}));

vi.mock("../../external-db/external-db.service.js", () => ({
  getPoolForKey,
}));

import {
  syncAprMetrics,
  syncSalesBrandMisMetrics,
  syncSalesOrderMetrics,
  syncConversionMetrics,
  syncQualityMetrics,
  resetEmployeeScopeCache,
} from "../kpi-data-connector.service.js";

function setupTargetDb(options: { lineageColumns?: boolean } = {}) {
  dbExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      return [[
        { COLUMN_NAME: "numerator_value" },
        { COLUMN_NAME: "denominator_value" },
        { COLUMN_NAME: "source_system" },
        { COLUMN_NAME: "source_record_count" },
        { COLUMN_NAME: "formula_version_id" },
        { COLUMN_NAME: "integration_run_id" },
        { COLUMN_NAME: "computed_at" },
      ].filter(() => options.lineageColumns !== false), []];
    }
    if (sql.includes("FROM kpi_metric_master")) {
      return [[
        { id: "metric-aht", metric_code: "AHT" },
        { id: "metric-talk", metric_code: "TALK_TIME" },
        { id: "metric-dials", metric_code: "DIALS" },
        { id: "metric-acw", metric_code: "ACW" },
        { id: "metric-quality", metric_code: "QUALITY_SCORE" },
        { id: "metric-fatal", metric_code: "FATAL_RATE" },
        { id: "metric-conversion", metric_code: "CONVERSION_RATE" },
        { id: "metric-sales", metric_code: "SALES_COUNT" },
        { id: "metric-revenue", metric_code: "REVENUE" },
        { id: "metric-aov", metric_code: "AOV" },
        { id: "metric-cod", metric_code: "COD_SHARE" },
        { id: "metric-rto", metric_code: "RTO_RATE" },
      ], []];
    }
    if (sql.includes("FROM kpi_formula_version")) {
      return [[
        { id: "formula-aht", metric_code: "AHT", formula_code: "AHT_WEIGHTED" },
        { id: "formula-talk", metric_code: "TALK_TIME", formula_code: "TALK_TIME_WEIGHTED" },
        { id: "formula-dials", metric_code: "DIALS", formula_code: "CALLS_TOTAL" },
        { id: "formula-acw", metric_code: "ACW", formula_code: "ACW_WEIGHTED" },
        { id: "formula-quality", metric_code: "QUALITY_SCORE", formula_code: "QUALITY_WEIGHTED" },
        { id: "formula-fatal", metric_code: "FATAL_RATE", formula_code: "FATAL_RATE" },
        { id: "formula-conversion", metric_code: "CONVERSION_RATE", formula_code: "CONVERSION_RATE" },
        { id: "formula-sales", metric_code: "SALES_COUNT", formula_code: "SALES_TOTAL" },
        { id: "formula-revenue", metric_code: "REVENUE", formula_code: "REVENUE_TOTAL" },
        { id: "formula-aov", metric_code: "AOV", formula_code: "AOV_WEIGHTED" },
        { id: "formula-cod", metric_code: "COD_SHARE", formula_code: "COD_SHARE" },
        { id: "formula-rto", metric_code: "RTO_RATE", formula_code: "RTO_RATE" },
      ], []];
    }
    if (sql.includes("FROM employees")) {
      return [[
        { id: "emp-1001", employee_code: "MAS1001", biometric_code: "BIO1001" },
        { id: "emp-1002", employee_code: "MAS1002", biometric_code: "BIO1002" },
      ], []];
    }
    if (sql.includes("INSERT INTO kpi_daily_actual")) {
      return [{ affectedRows: 1 }, []];
    }
    return [[], []];
  });
}

function insertedFacts(): ExecuteCall[] {
  return dbExecute.mock.calls.filter(([sql]: ExecuteCall) => sql.includes("INSERT INTO kpi_daily_actual"));
}

function mockAprPhysicalTables(rows: Array<Record<string, unknown>>) {
  aprExecute.mockImplementation(async (sql: string) => {
    if (!sql.includes("vicidial_agent_log_10_25")) return [[], []];
    return [rows, []];
  });
}

describe("kpi data source connector", () => {
  beforeEach(() => {
    dbExecute.mockReset();
    aprExecute.mockReset();
    qualityExecute.mockReset();
    outboundExecute.mockReset();
    salesBrandExecute.mockReset();
    getPoolForKey.mockClear();
    setupTargetDb({ lineageColumns: true });
  });

  it("syncs APR from live dialer columns with weighted AHT and biometric fallback", async () => {
    aprExecute.mockImplementation(async (sql: string) => {
      if (!sql.includes("vicidial_agent_log_10_25")) return [[], []];
      return [[
        {
          agent_user: "MAS1001",
          total_talk: 600,
          total_dispo: 120,
          total_calls: 12,
          source_records: 2,
        },
        {
          agent_user: "BIO1002",
          total_talk: 300,
          total_dispo: 60,
          total_calls: 6,
          source_records: 1,
        },
        {
          agent_user: "UNKNOWN",
          total_talk: 90,
          total_dispo: 10,
          total_calls: 1,
          source_records: 1,
        },
      ], []];
    });

    const result = await syncAprMetrics("2026-07-17");

    expect(result).toMatchObject({ synced: 2, skipped: 1, errors: [] });
    expect(aprExecute.mock.calls[0][0]).toContain("vicidial_agent_log_10_25");
    expect(aprExecute.mock.calls[0][0]).toContain("event_time >= ?");
    expect(aprExecute.mock.calls[0][0]).toContain("talk_sec");
    expect(aprExecute.mock.calls[0][0]).toContain("dispo_sec");
    const facts = insertedFacts();
    expect(facts).toHaveLength(8);
    expect(facts[0][0]).toContain("numerator_value");
    expect(facts.map(([, params]) => params?.[3])).toContain(60);
    expect(facts.map(([, params]) => params?.[3])).toContain(12);
  });

  it("syncs APR facts from healthy dialer tables and reports a failed table", async () => {
    aprExecute.mockImplementation(async (sql: string) => {
      if (sql.includes("vicidial_agent_log_11_5")) {
        throw new Error("Query execution was interrupted, maximum statement execution time exceeded");
      }
      if (sql.includes("vicidial_agent_log_10_25")) {
        return [[
          { agent_user: "MAS1001", total_talk: 600, total_dispo: 120, total_calls: 12, source_records: 2 },
        ], []];
      }
      return [[], []];
    });

    const result = await syncAprMetrics("2026-07-17");

    expect(result).toMatchObject({ synced: 1, skipped: 0 });
    expect(result.errors[0]).toContain("vicidial_agent_log_11_5");
    expect(insertedFacts()).toHaveLength(4);
  });

  it("syncs quality using weighted score and Mydashboards fatal definition", async () => {
    qualityExecute.mockResolvedValueOnce([[
      {
        agent_user: "MAS1001",
        points_earned: 180,
        points_possible: 200,
        fatal_audits: 1,
        // All four audits were scored here, so the fatal rate stays 1/4 = 25%
        // and this case is unchanged. The query now also selects scored_audits
        // because unscored audits must not sit in the denominator — 21% of
        // July's real audits carry quality_percentage NULL, and counting them
        // reported 0% fatal for work nobody assessed.
        scored_audits: 4,
        total_audits: 4,
        last_audit_date: "2026-07-18",
      },
    ], []]);

    const result = await syncQualityMetrics("2026-07");

    expect(result).toMatchObject({ synced: 1, skipped: 0, errors: [] });
    expect(qualityExecute.mock.calls[0][0]).toContain("quality_percentage = 0");
    const values = insertedFacts().map(([, params]) => params?.[3]);
    expect(values).toContain(90);
    expect(values).toContain(25);
  });

  it("syncs outbound conversion from SaleDone without requiring sales schema access", async () => {
    outboundExecute.mockResolvedValueOnce([[
      {
        agent_user: "MAS1001",
        converted_sales: 3,
        eligible_contacts: 12,
        source_records: 12,
      },
    ], []]);

    const result = await syncConversionMetrics("2026-07-18");

    expect(result).toMatchObject({ synced: 1, skipped: 0, errors: [] });
    expect(outboundExecute.mock.calls[0][0]).toContain("SaleDone");
    const values = insertedFacts().map(([, params]) => params?.[3]);
    expect(values).toContain(25);
  });

  it("falls back to legacy kpi_daily_actual columns before migration 504 is applied", async () => {
    setupTargetDb({ lineageColumns: false });
    outboundExecute.mockResolvedValueOnce([[
      {
        agent_user: "MAS1001",
        converted_sales: 2,
        eligible_contacts: 4,
        source_records: 4,
      },
    ], []]);

    await syncConversionMetrics("2026-07-18");

    const [sql] = insertedFacts()[0];
    expect(sql).not.toContain("numerator_value");
    expect(sql).not.toContain("source_system");
  });

  it("reports missing source connector configuration instead of hiding failures", async () => {
    getPoolForKey.mockRejectedValueOnce(new Error("No credentials configured for integration: outbound_calls"));

    const result = await syncConversionMetrics("2026-07-18");

    expect(result.synced).toBe(0);
    expect(result.errors).toEqual([
      "No credentials configured for integration: outbound_calls",
    ]);
  });
  it("syncs brand MIS APR rows from existing Bellavita, GNC and Neemans tables", async () => {
    salesBrandExecute.mockResolvedValueOnce([[
      {
        agent_user: "MAS1001",
        total_calls: 20,
        total_aht: 600,
        total_talk: 400,
        total_dispo: 100,
        source_records: 2,
      },
      {
        agent_user: "UNKNOWN",
        total_calls: 5,
        total_aht: 100,
        total_talk: 40,
        total_dispo: 10,
        source_records: 1,
      },
    ], []]);

    const result = await syncSalesBrandMisMetrics("2026-07-18");

    expect(result).toMatchObject({ synced: 1, skipped: 1, errors: [] });
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.bb_apr");
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.gnc_apr");
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.neemans_apr");
    const values = insertedFacts().map(([, params]) => params?.[3]);
    expect(values).toContain(20);
    expect(values).toContain(30);
    expect(values).toContain(5);
  });
  it("syncs rich sales order facts from Bellavita, GNC and Neemans sales tables", async () => {
    salesBrandExecute.mockResolvedValueOnce([[
      {
        agent_user: "MAS1001",
        converted_sales: 4,
        revenue: 2400,
        cod_orders: 1,
        rto_orders: 1,
        source_records: 4,
      },
    ], []]);

    const result = await syncSalesOrderMetrics("2026-07-18");

    expect(result).toMatchObject({ synced: 1, skipped: 0, errors: [] });
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.bb_sale");
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.gnc_sale");
    expect(salesBrandExecute.mock.calls[0][0]).toContain("db_masmis.neemans_sale_raw");
    const values = insertedFacts().map(([, params]) => params?.[3]);
    expect(values).toContain(4);
    expect(values).toContain(2400);
    expect(values).toContain(600);
    expect(values).toContain(25);
  });
});

/**
 * Every one of the ~45k kpi_daily_actual rows in production carries a NULL
 * process_id_at_event and branch_id_at_event, because this connector — the only writer that
 * has ever run in prod — never populated them. That makes per-process KPI targets and the
 * branch filter on the operations leaderboard impossible to evaluate: the facts do not record
 * which process or branch they belong to.
 */
describe("kpi daily actual scope attribution", () => {
  /** Zips the INSERT column list with its bound params so assertions do not hardcode offsets. */
  function insertedColumnMap(call: ExecuteCall): Record<string, unknown> {
    const [sql, params = []] = call;
    const columns = sql
      .slice(sql.indexOf("(") + 1, sql.indexOf(")"))
      .split(",")
      .map((column) => column.trim());
    return Object.fromEntries(columns.map((column, index) => [column, (params as unknown[])[index]]));
  }

  function setupWithScope(employees: Array<Record<string, unknown>>) {
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return [[
          { COLUMN_NAME: "numerator_value" },
          { COLUMN_NAME: "denominator_value" },
          { COLUMN_NAME: "source_system" },
          { COLUMN_NAME: "source_record_count" },
          { COLUMN_NAME: "formula_version_id" },
          { COLUMN_NAME: "integration_run_id" },
          { COLUMN_NAME: "computed_at" },
          { COLUMN_NAME: "process_id_at_event" },
          { COLUMN_NAME: "branch_id_at_event" },
        ], []];
      }
      if (sql.includes("FROM kpi_metric_master")) {
        return [[
          { id: "metric-talk", metric_code: "TALK_TIME" },
          { id: "metric-dials", metric_code: "DIALS" },
          { id: "metric-aht", metric_code: "AHT" },
          { id: "metric-acw", metric_code: "ACW" },
        ], []];
      }
      if (sql.includes("FROM kpi_formula_version")) return [[], []];
      // The scope lookup and the identifier lookup both read employees; they are told apart
      // by the columns they ask for, not by the table.
      if (sql.includes("process_id") && sql.includes("FROM employees")) return [employees, []];
      if (sql.includes("FROM employees")) {
        return [employees.map((employee) => ({
          id: employee.id,
          employee_code: employee.employee_code,
          biometric_code: employee.biometric_code,
        })), []];
      }
      if (sql.includes("INSERT INTO kpi_daily_actual")) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
  }

  beforeEach(() => {
    dbExecute.mockReset();
    aprExecute.mockReset();
    // The cache is module-level and TTL'd, so without this a scope loaded by one test would
    // still be live in the next one.
    resetEmployeeScopeCache();
  });

  it("stamps the employee's process and branch onto every fact it writes", async () => {
    setupWithScope([
      { id: "emp-1001", employee_code: "MAS1001", biometric_code: "BIO1001", process_id: "proc-cs", branch_id: "branch-noida" },
    ]);
    mockAprPhysicalTables([
      { agent_user: "MAS1001", total_talk: 600, total_dispo: 120, total_calls: 12, source_records: 2 },
    ]);

    await syncAprMetrics("2026-07-31");

    const facts = insertedFacts();
    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      const row = insertedColumnMap(fact);
      expect(row.process_id_at_event).toBe("proc-cs");
      expect(row.branch_id_at_event).toBe("branch-noida");
    }
  });

  it("writes NULL scope rather than failing when the employee has no process or branch", async () => {
    setupWithScope([
      { id: "emp-1002", employee_code: "MAS1002", biometric_code: "BIO1002", process_id: null, branch_id: null },
    ]);
    mockAprPhysicalTables([
      { agent_user: "MAS1002", total_talk: 300, total_dispo: 60, total_calls: 6, source_records: 1 },
    ]);

    const result = await syncAprMetrics("2026-07-31");

    expect(result).toMatchObject({ synced: 1, errors: [] });
    const row = insertedColumnMap(insertedFacts()[0]);
    expect(row.process_id_at_event).toBeNull();
    expect(row.branch_id_at_event).toBeNull();
  });

  it("omits the scope columns entirely on a schema that lacks them", async () => {
    // Guards the maybeAdd gating: an older database must not get an INSERT naming columns it
    // does not have.
    dbExecute.mockImplementation(async (sql: string) => {
      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) return [[{ COLUMN_NAME: "numerator_value" }], []];
      if (sql.includes("FROM kpi_metric_master")) return [[{ id: "metric-dials", metric_code: "DIALS" }], []];
      if (sql.includes("FROM kpi_formula_version")) return [[], []];
      if (sql.includes("FROM employees")) {
        return [[{ id: "emp-1001", employee_code: "MAS1001", biometric_code: "BIO1001" }], []];
      }
      if (sql.includes("INSERT INTO kpi_daily_actual")) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    mockAprPhysicalTables([
      { agent_user: "MAS1001", total_talk: 600, total_dispo: 120, total_calls: 12, source_records: 2 },
    ]);

    await syncAprMetrics("2026-07-31");

    for (const [sql] of insertedFacts()) {
      expect(sql).not.toContain("process_id_at_event");
      expect(sql).not.toContain("branch_id_at_event");
    }
  });
});
