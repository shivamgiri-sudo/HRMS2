import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ops = read(
  "src/modules/process-operations/process-operations.service.ts",
);
const feeds = read("src/modules/process-operations/feed-health.service.ts");
const manifest = read("src/db/runPendingMigrations.ts");

const listProcessesSql = (): string => {
  const start = ops.indexOf("export async function listProcesses");
  const end = ops.indexOf("export type ReportPeriod");
  return ops.slice(start, end);
};

const feedHealthMainSql = (): string => {
  const start = feeds.indexOf("export async function getFeedHealth");
  return feeds.slice(start, start + 3000);
};

describe("listProcesses is aggregate-first (10s -> ~1s measured on prod data)", () => {
  it("pre-aggregates process_metric_actual per process instead of joining it raw into a wide GROUP BY", () => {
    const sql = listProcessesSql();
    expect(sql).toMatch(
      /LEFT JOIN \(\s*SELECT process_id, COUNT\(DISTINCT metric_key\) metrics, MAX\(score_date\) latest\s+FROM process_metric_actual/,
    );
    expect(sql).not.toMatch(/GROUP BY p\.id, p\.process_name/);
  });

  it("computes headcount once per process, not as a per-row correlated subquery", () => {
    const sql = listProcessesSql();
    expect(sql).not.toMatch(
      /\(SELECT COUNT\(\*\) FROM employees e\s+WHERE e\.process_id = p\.id/,
    );
    expect(sql).toMatch(
      /FROM employees WHERE active_status = 1 GROUP BY process_id/,
    );
  });

  it("keeps the result contract: same fields, most-covered process first", () => {
    const sql = listProcessesSql();
    expect(sql).toMatch(/ORDER BY metrics DESC, p\.process_name/);
    expect(sql).toMatch(/COALESCE\(am\.metrics, ?0\)/);
    expect(sql).toMatch(/COALESCE\(h\.headcount, ?0\)/);
    expect(sql).toMatch(/WHERE p\.active_status = 1/);
  });
});

describe("getFeedHealth is aggregate-first", () => {
  it("aggregates process_metric_actual in a derived table, then joins process_master and kpi_metric_master", () => {
    const sql = feedHealthMainSql();
    expect(sql).toMatch(
      /FROM \(\s*SELECT process_id, metric_key, MAX\(score_date\) latest,[\s\S]*?FROM process_metric_actual\s+WHERE actual_value IS NOT NULL\s+GROUP BY process_id, metric_key\s+HAVING MAX\(score_date\) >= DATE_SUB\(CURDATE\(\), INTERVAL 120 DAY\)\s*\) x/,
    );
    expect(sql).toMatch(
      /JOIN process_master p ON p\.id = x\.process_id AND p\.active_status = 1/,
    );
    expect(sql).toMatch(
      /LEFT JOIN kpi_metric_master m ON m\.metric_code = x\.metric_key/,
    );
  });
});

describe("migration 1871 covering indexes", () => {
  it("is registered in the migration manifest", () => {
    expect(manifest).toContain(
      '"1871_process_metric_actual_covering_indexes.sql"',
    );
  });

  it("is additive, idempotent and online", () => {
    const sql = read("sql/1871_process_metric_actual_covering_indexes.sql");
    expect(sql).toContain(
      "idx_pma_feed_cover (process_id, metric_key, score_date, actual_value)",
    );
    expect(sql).toContain(
      "idx_pma_source_date (source, score_date, process_id, metric_key)",
    );
    expect(sql).toContain("ALGORITHM=INPLACE, LOCK=NONE");
    expect(sql).toContain("INFORMATION_SCHEMA.STATISTICS");
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)|DELETE FROM|TRUNCATE/i);
  });
});
