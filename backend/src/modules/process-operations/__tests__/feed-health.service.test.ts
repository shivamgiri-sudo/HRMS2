import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getNeverReported() has two layers worth testing separately:
 *
 * 1. Grouping — (metric, source) pairs collapse into one row with real process
 *    names, not one row per process (the whole point when one dead table wears
 *    dozens of process names).
 * 2. The existence check — the part this session added after discovering it
 *    could be wrong in a specific, checkable way. A template targeting a
 *    table doesn't mean uploading through it is the fix; only an empty table
 *    does. Roster Ack % looked identical to process_delivery_actual (both
 *    "never reported" with a matching upload template) until the underlying
 *    table was actually queried — wfm_roster_assignment already held 75,058
 *    rows for one process alone, all still 'pending'. These tests pin both
 *    outcomes down: 0 existing rows says "table is empty", >0 says "raw data
 *    exists, never computed", so a future change can't silently swap them.
 */
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { getNeverReported } = await import("../feed-health.service.js");

describe("getNeverReported", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("returns nothing for a caller with no readable processes, without querying", async () => {
    const result = await getNeverReported(new Set());
    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("groups multiple processes under one (metric, source) pair and skips the existence check when there is no upload template", async () => {
    execute.mockResolvedValueOnce([
      [
        {
          process_id: "p1", process_name: "Onfido", metric_code: "SHRINKAGE_PCT",
          metric_name: "Shrinkage %", source_object: "attendance_daily_record",
          process_key_kind: "employee", process_key_column: null, process_key_value: null,
          employee_key_column: "emp_code", employee_key_kind: "employee_code",
          upload_type_code: null, upload_type_name: null,
        },
        {
          process_id: "p2", process_name: "Dalmia Cement", metric_code: "SHRINKAGE_PCT",
          metric_name: "Shrinkage %", source_object: "attendance_daily_record",
          process_key_kind: "employee", process_key_column: null, process_key_value: null,
          employee_key_column: "emp_code", employee_key_kind: "employee_code",
          upload_type_code: null, upload_type_name: null,
        },
      ],
      [],
    ]);

    const result = await getNeverReported(new Set(["p1", "p2"]));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      metricKey: "SHRINKAGE_PCT", sourceObject: "attendance_daily_record",
      processCount: 2, uploadTypeName: null, existingSourceRows: null,
    });
    expect(result[0].processNames).toEqual(["Onfido", "Dalmia Cement"]);
    // No template matched -> no second query is worth the round trip.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("excludes a process outside the caller's own scope from both the count and the names", async () => {
    execute.mockResolvedValueOnce([
      [
        {
          process_id: "visible", process_name: "Onfido", metric_code: "SHRINKAGE_PCT",
          metric_name: "Shrinkage %", source_object: "attendance_daily_record",
          process_key_kind: "employee", process_key_column: null, process_key_value: null,
          employee_key_column: "emp_code", employee_key_kind: "employee_code",
          upload_type_code: null, upload_type_name: null,
        },
        {
          process_id: "hidden", process_name: "Some Other Client", metric_code: "SHRINKAGE_PCT",
          metric_name: "Shrinkage %", source_object: "attendance_daily_record",
          process_key_kind: "employee", process_key_column: null, process_key_value: null,
          employee_key_column: "emp_code", employee_key_kind: "employee_code",
          upload_type_code: null, upload_type_name: null,
        },
      ],
      [],
    ]);

    const result = await getNeverReported(new Set(["visible"]));

    expect(result[0].processCount).toBe(1);
    expect(result[0].processNames).toEqual(["Onfido"]);
  });

  it("reports 'table is empty' (existingSourceRows: 0) when a matching upload template exists and the live count comes back zero", async () => {
    execute
      .mockResolvedValueOnce([
        [
          {
            process_id: "godfrey", process_name: "Godfrey Philips India Ltd",
            metric_code: "PROCESS_DELIVERED_UNITS", metric_name: "Delivered units",
            source_object: "process_delivery_actual",
            process_key_kind: "column", process_key_column: "process_id", process_key_value: "godfrey",
            employee_key_column: null, employee_key_kind: null,
            upload_type_code: "PROCESS_DELIVERY", upload_type_name: "Process Delivery Actuals (planned vs delivered)",
          },
        ],
        [],
      ])
      // the existence-check COUNT(*)
      .mockResolvedValueOnce([[{ n: 0 }], []]);

    const result = await getNeverReported(new Set(["godfrey"]));

    expect(result[0].uploadTypeName).toBe("Process Delivery Actuals (planned vs delivered)");
    expect(result[0].existingSourceRows).toBe(0);
    const countCall = execute.mock.calls[1];
    expect(String(countCall[0])).toContain("process_delivery_actual");
    expect(countCall[1]).toEqual(["godfrey"]);
  });

  it("reports the real row count (existingSourceRows > 0) when data already exists but was never computed — the Roster Ack % case", async () => {
    execute
      .mockResolvedValueOnce([
        [
          {
            process_id: "onfido", process_name: "Onfido",
            metric_code: "ROSTER_ACK_PCT", metric_name: "Roster acknowledged by employee %",
            source_object: "wfm_roster_assignment",
            process_key_kind: "employee", process_key_column: null, process_key_value: null,
            employee_key_column: "employee_code", employee_key_kind: "employee_code",
            upload_type_code: "ROSTER_UPLOAD", upload_type_name: "Shift Roster Bulk Upload",
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([[{ n: 75058 }], []]);

    const result = await getNeverReported(new Set(["onfido"]));

    expect(result[0].existingSourceRows).toBe(75058);
    expect(result[0].uploadTypeName).toBe("Shift Roster Bulk Upload");
    const countCall = execute.mock.calls[1];
    expect(String(countCall[0])).toContain("wfm_roster_assignment");
    expect(String(countCall[0])).toContain("JOIN employees");
  });

  it("leaves existingSourceRows null, not zero, when the source config doesn't resolve safely — unknown is not the same claim as empty", async () => {
    execute.mockResolvedValueOnce([
      [
        {
          process_id: "p1", process_name: "Some Process",
          metric_code: "SOME_METRIC", metric_name: "Some Metric",
          source_object: "some_table",
          // employee kind but no employee_key_column configured -- can't build a safe join.
          process_key_kind: "employee", process_key_column: null, process_key_value: null,
          employee_key_column: null, employee_key_kind: null,
          upload_type_code: "SOME_TEMPLATE", upload_type_name: "Some Upload Template",
        },
      ],
      [],
    ]);

    const result = await getNeverReported(new Set(["p1"]));

    expect(result[0].existingSourceRows).toBeNull();
    expect(result[0].uploadTypeName).toBe("Some Upload Template");
    // Nothing to safely count against -- must not have attempted a second query.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("sorts groups worst-first by process count", async () => {
    execute.mockResolvedValueOnce([
      [
        {
          process_id: "p1", process_name: "A", metric_code: "SMALL_GAP",
          metric_name: "Small gap", source_object: "t1",
          process_key_kind: "constant", process_key_column: null, process_key_value: null,
          employee_key_column: null, employee_key_kind: null,
          upload_type_code: null, upload_type_name: null,
        },
        {
          process_id: "p1", process_name: "A", metric_code: "BIG_GAP",
          metric_name: "Big gap", source_object: "t2",
          process_key_kind: "constant", process_key_column: null, process_key_value: null,
          employee_key_column: null, employee_key_kind: null,
          upload_type_code: null, upload_type_name: null,
        },
        {
          process_id: "p2", process_name: "B", metric_code: "BIG_GAP",
          metric_name: "Big gap", source_object: "t2",
          process_key_kind: "constant", process_key_column: null, process_key_value: null,
          employee_key_column: null, employee_key_kind: null,
          upload_type_code: null, upload_type_name: null,
        },
      ],
      [],
    ]);

    const result = await getNeverReported(new Set(["p1", "p2"]));

    expect(result.map((g) => g.metricKey)).toEqual(["BIG_GAP", "SMALL_GAP"]);
  });
});
