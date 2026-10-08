import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * importWeekOffPreferenceBatch used to do a fresh "SELECT MAX(submission_order)"
 * round trip per row — for the same (week_start_date, process_id) group, each
 * row's INSERT saw the PREVIOUS row's already-committed max, which is exactly
 * how the numbering stayed correctly sequential despite there being no
 * transaction wrapping the loop.
 *
 * The rewrite fetches each group's starting max ONCE and then assigns every
 * row's submission_order locally while walking the rows in row_no order —
 * this file pins that the numbering comes out identical to the old per-row
 * round trips, both within one (week, process) group and across two different
 * groups that must not share a counter.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { importWeekOffPreferenceBatch } from "../weekoff-preference-bulk.service.js";

function row(id: string, row_no: number, data: Record<string, unknown>) {
  return { id, row_no, normalized_data: JSON.stringify(data) };
}

beforeEach(() => {
  execute.mockReset();
});

describe("importWeekOffPreferenceBatch — batched rewrite", () => {
  it("assigns strictly increasing submission_order within one (week, process) group, continuing from the existing max", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", week_start_date: "2026-08-17", preferred_day_1: "sunday" }),
        row("row-2", 2, { employee_code: "MAS002", week_start_date: "2026-08-17", preferred_day_1: "monday" }),
        row("row-3", 3, { employee_code: "MAS003", week_start_date: "2026-08-17", preferred_day_1: "tuesday" }),
      ],
      [],
    ]); // 1: SELECT upload_batch_row

    execute.mockResolvedValueOnce([
      [
        { employee_code: "MAS001", id: "emp-1", process_id: "proc-1", branch_id: "br-1" },
        { employee_code: "MAS002", id: "emp-2", process_id: "proc-1", branch_id: "br-1" },
        { employee_code: "MAS003", id: "emp-3", process_id: "proc-1", branch_id: "br-1" },
      ],
      [],
    ]); // 2: bulk SELECT employees

    execute.mockResolvedValueOnce([[{ week_start_date: "2026-08-17", process_id: "proc-1", max_order: 5 }], []]); // 3: bulk group-max SELECT (existing max is 5)
    execute.mockResolvedValueOnce([{}, []]); // 4: chunked INSERT week_off_preference
    execute.mockResolvedValueOnce([{}, []]); // 5: UPDATE upload_batch_row (imported)
    execute.mockResolvedValueOnce([{}, []]); // 6: UPDATE upload_batch summary

    const result = await importWeekOffPreferenceBatch("batch-1", "user-1");

    expect(result.imported).toBe(3);
    expect(result.skipped).toBe(0);

    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.startsWith("\n    INSERT INTO week_off_preference") || (typeof sql === "string" && sql.includes("INSERT INTO week_off_preference")));
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    // Each row is a 12-field tuple: id, employee_id, process_id, branch_id, week_start_date,
    // preferred_day, alternate_day, preferred_day_1, preferred_day_2, reason,
    // submission_order, created_by.
    const submissionOrders = [params[10], params[22], params[34]];
    expect(submissionOrders).toEqual([6, 7, 8]); // continues from the existing max of 5, in row_no order
  });

  it("keeps two different (week, process) groups on independent counters", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", week_start_date: "2026-08-17", preferred_day_1: "sunday" }), // process-1
        row("row-2", 2, { employee_code: "MAS009", week_start_date: "2026-08-17", preferred_day_1: "monday" }), // process-2
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([
      [
        { employee_code: "MAS001", id: "emp-1", process_id: "proc-1", branch_id: "br-1" },
        { employee_code: "MAS009", id: "emp-9", process_id: "proc-2", branch_id: "br-2" },
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([
      [
        { week_start_date: "2026-08-17", process_id: "proc-1", max_order: 0 },
        { week_start_date: "2026-08-17", process_id: "proc-2", max_order: 10 },
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([{}, []]); // INSERT
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch

    await importWeekOffPreferenceBatch("batch-1", "user-1");

    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO week_off_preference"));
    const params = insertCall![1] as unknown[];
    // row-1 (process-1, starting max 0) -> order 1; row-2 (process-2, starting max 10) -> order 11.
    expect([params[10], params[22]]).toEqual([1, 11]);
  });

  it("errors a row with an unresolvable employee_code without disturbing the others' ordering", async () => {
    execute.mockResolvedValueOnce([
      [
        row("row-1", 1, { employee_code: "MAS001", week_start_date: "2026-08-17", preferred_day_1: "sunday" }),
        row("row-2", 2, { employee_code: "GHOST", week_start_date: "2026-08-17", preferred_day_1: "monday" }),
      ],
      [],
    ]);
    execute.mockResolvedValueOnce([[{ employee_code: "MAS001", id: "emp-1", process_id: "proc-1", branch_id: "br-1" }], []]);
    execute.mockResolvedValueOnce([[{ week_start_date: "2026-08-17", process_id: "proc-1", max_order: 0 }], []]);
    execute.mockResolvedValueOnce([{}, []]); // INSERT (only row-1)
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row imported
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row error
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch

    const result = await importWeekOffPreferenceBatch("batch-1", "user-1");

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors[0]).toMatch(/GHOST.*not found or inactive/);
  });

  it("populates the legacy preferred_day/alternate_day columns, not just preferred_day_1/preferred_day_2", async () => {
    // week_off_preference.preferred_day is NOT NULL with no default, and it is the
    // column weekoff-allocation.service.ts's FCFS run and roster-generation.service.ts
    // actually read — neither reads preferred_day_1/preferred_day_2. Before this fix
    // the INSERT named only the split columns, so every bulk-upload row failed
    // outright with "Field 'preferred_day' doesn't have a default value" — 0
    // successful imports ever, live-confirmed via PREPARE. This pins that a fresh
    // row now carries both column generations, in agreement.
    execute.mockResolvedValueOnce([
      [row("row-1", 1, { employee_code: "MAS001", week_start_date: "2026-08-17", preferred_day_1: "sunday", preferred_day_2: "saturday" })],
      [],
    ]);
    execute.mockResolvedValueOnce([[{ employee_code: "MAS001", id: "emp-1", process_id: "proc-1", branch_id: "br-1" }], []]);
    execute.mockResolvedValueOnce([[{ week_start_date: "2026-08-17", process_id: "proc-1", max_order: 0 }], []]);
    execute.mockResolvedValueOnce([{}, []]); // INSERT
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch_row imported
    execute.mockResolvedValueOnce([{}, []]); // UPDATE upload_batch

    const result = await importWeekOffPreferenceBatch("batch-1", "user-1");
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const insertCall = execute.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO week_off_preference"));
    expect(insertCall).toBeDefined();
    const sql = insertCall![0] as string;
    expect(sql).toMatch(/\bpreferred_day\b,\s*alternate_day\b/);
    const params = insertCall![1] as unknown[];
    // id, employee_id, process_id, branch_id, week_start_date,
    // preferred_day, alternate_day, preferred_day_1, preferred_day_2, reason, submission_order, created_by
    expect(params[5]).toBe(0); // preferred_day = Sunday
    expect(params[6]).toBe(6); // alternate_day = Saturday
    expect(params[7]).toBe(0); // preferred_day_1 stays in agreement
    expect(params[8]).toBe(6); // preferred_day_2 stays in agreement
  });
});
