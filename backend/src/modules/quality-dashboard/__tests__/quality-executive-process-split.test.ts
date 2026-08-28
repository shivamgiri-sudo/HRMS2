import { describe, expect, it, vi } from "vitest";
import { QualityExecutiveService } from "../quality-executive.service.js";

/**
 * `process_performance` grouped by `db_audit.call_quality_assessment.Campaign`.
 *
 * Campaign stopped being written after April 2026: verified on the live audit database
 * on 2026-08-28, every one of the 14,488 rows in the trailing 30-day window has
 * Campaign IS NULL (COUNT(DISTINCT Campaign) = 0), while `ClientId` is populated on all
 * of them and resolves to 9 distinct processes.
 *
 * `GROUP BY Campaign` therefore collapsed the entire organisation into ONE row with a
 * NULL name, which the CEO dashboard rendered as the literal string "Process 1" — a
 * single blended 73.6% standing in for nine processes ranging 47% to 87%. The panel
 * looked populated, so nothing reported it as broken.
 *
 * The split has to key on ClientId, and the display name has to come from
 * `Shivamgiri.portal_client_config` (the same lookup call-master.service.ts already
 * uses), falling back to Campaign where it is still populated for historic windows and
 * to `Client <id>` for the two ids that carry no config row.
 */

type Captured = { sql: string; params: unknown[] };

function capturingConn(rows: unknown[][]) {
  const captured: Captured[] = [];
  let call = 0;
  return {
    captured,
    conn: {
      execute: vi.fn(async (sql: string, params?: unknown[]) => {
        captured.push({ sql, params: params ?? [] });
        const result = rows[call] ?? [];
        call++;
        return [result];
      }),
      release: vi.fn(),
    },
  };
}

/**
 * Eight execute() calls in order: current metrics, 7-day, 30-day, top performers,
 * bottom performers, process metrics, per-agent scores, org benchmarks.
 * Index 5 is the process-performance query under test.
 */
const PROCESS_QUERY_INDEX = 5;

function fixture(processRows: unknown[]) {
  return [
    [{ current_quality: "73.59", total_calls: 14488, unique_agents: 59 }],
    [{ avg_quality: "73.59" }],
    [{ avg_quality: "73.59" }],
    [],
    [],
    processRows,
    [],
    [{ avg_quality: "73.59", std_dev: "12.00" }],
  ];
}

async function runWith(processRows: unknown[]) {
  const { captured, conn } = capturingConn(fixture(processRows));
  const service = new QualityExecutiveService({ getConnection: async () => conn as any });
  const result = await service.getExecutiveSummary(30);
  return { result, captured };
}

describe("QualityExecutiveService process_performance — splits by client, not by the dead Campaign column", () => {
  it("does not group process performance by Campaign", async () => {
    const { captured } = await runWith([]);
    const processSql = captured[PROCESS_QUERY_INDEX]!.sql.replace(/\s+/g, " ");

    // Campaign is NULL on 100% of the live 30-day window, so grouping by it yields one
    // NULL-named row for the whole organisation.
    expect(processSql).not.toMatch(/GROUP BY\s+cqa\.Campaign/i);
  });

  it("groups process performance by ClientId", async () => {
    const { captured } = await runWith([]);
    const processSql = captured[PROCESS_QUERY_INDEX]!.sql.replace(/\s+/g, " ");

    expect(processSql).toMatch(/GROUP BY\s+cqa\.ClientId/i);
  });

  it("resolves the process label from portal_client_config", async () => {
    const { captured } = await runWith([]);
    const processSql = captured[PROCESS_QUERY_INDEX]!.sql.replace(/\s+/g, " ");

    expect(processSql).toMatch(/portal_client_config/i);
    expect(processSql).toMatch(/display_name/i);
  });

  it("carries the resolved name through to process_performance[].process", async () => {
    // The shape the fixed query returns for the live top three clients.
    const { result } = await runWith([
      { process_name: "Clovia", avg_quality: "86.53", agent_count: 12, calls_handled: 1961 },
      { process_name: "Neemans", avg_quality: "82.45", agent_count: 11, calls_handled: 2319 },
      { process_name: "Bellavita", avg_quality: "69.70", agent_count: 12, calls_handled: 6308 },
    ]);

    expect(result.process_performance.map((row) => row.process)).toEqual([
      "Clovia",
      "Neemans",
      "Bellavita",
    ]);
    expect(result.process_performance[0]!.avg_quality).toBe(86.53);
    expect(result.process_performance[2]!.status).toBe("Critical");
  });

  it("never emits a null process label", async () => {
    // Two ids in the live window (487, 417) have no portal_client_config row. They must
    // still be named, not fall through to the frontend's positional "Process N" filler.
    const { result } = await runWith([
      { process_name: "Client 487", avg_quality: "85.14", agent_count: 4, calls_handled: 603 },
    ]);

    expect(result.process_performance[0]!.process).toBe("Client 487");
  });

  it("labels top and bottom performers by client, not by the dead Campaign column", async () => {
    const { captured } = await runWith([]);
    const topSql = captured[3]!.sql.replace(/\s+/g, " ");
    const bottomSql = captured[4]!.sql.replace(/\s+/g, " ");

    // Both carried `SUBSTRING(cqa.Campaign, 1, 10)` as the agent's process label, which
    // is NULL for every current row, so every performer read "N/A".
    expect(topSql).not.toMatch(/cqa\.Campaign/i);
    expect(bottomSql).not.toMatch(/cqa\.Campaign/i);
  });
});
