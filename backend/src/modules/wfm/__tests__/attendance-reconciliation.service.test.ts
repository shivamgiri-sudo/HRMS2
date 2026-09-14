import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbQuery, dbExecute, ncosecQuery } = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbExecute: vi.fn(),
  ncosecQuery: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    query: dbQuery,
    execute: dbExecute,
  },
}));

vi.mock("../../../db/ncosecDb.js", () => ({
  getNcosecPool: vi.fn().mockResolvedValue({
    request() {
      return {
        input() {
          return this;
        },
        query: ncosecQuery,
      };
    },
  }),
}));

vi.mock("../../../config/env.js", () => ({
  env: {
    NCOSEC_RECONCILIATION_LOOKBACK_DAYS: 7,
  },
}));

vi.mock("../../../shared/timezone.js", () => ({
  nowIST: () => "2026-07-26T12:00:00+05:30",
}));

vi.mock("../cosec-sync.service.js", () => ({
  cosecSyncService: {
    isRunning: () => false,
    sync: vi.fn(),
  },
}));

import { attendanceReconciliationService } from "../attendance-reconciliation.service.js";

describe("attendanceReconciliationService", () => {
  beforeEach(() => {
    dbQuery.mockReset();
    dbExecute.mockReset();
    ncosecQuery.mockReset();
    dbExecute.mockResolvedValue([[], []]);
    // Same default as dbExecute above. Without it, any db.query call the test did
    // not explicitly queue returns undefined, and `const [rows] = await db.query()`
    // throws "is not iterable" — which is what resolveGoneIssues hit.
    // Queued mockResolvedValueOnce values still take priority over this.
    dbQuery.mockResolvedValue([[], []]);
  });

  it("flags dialler ADR rows that have biometric evidence but no APR or dialler source evidence", async () => {
    ncosecQuery.mockResolvedValueOnce({
      recordset: [
        {
          cosec_user_id: "MAS47814",
          punch_date: "2026-07-25",
          first_punch: "2026-07-25 10:24:42",
          last_punch: "2026-07-25 19:41:45",
          total_punches: 11,
          working_minutes: 557,
        },
      ],
    });

    // Keyed by the table each query reads, not by call order.
    //
    // This test used to queue results positionally with mockResolvedValueOnce.
    // When the COSEC-exclusion query was added at the top of audit() every mock
    // shifted by one: the employee row was consumed as the exclusion list, the
    // biometric row as the employee list, and so on, so no ADR row was ever
    // matched and countsByType came back empty. The assertion failed with
    // "expected undefined to be 1" — a mock-drift failure that reads like a
    // logic bug and cost real time to tell apart.
    //
    // Same fix, same reason as keying the payroll.security mocks by SQL.
    dbQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("attendance_reconciliation_cosec_exclusion")) return [[], []];

      if (sql.includes("employee_biometric_enrollment")) {
        return [[{
          employee_id: "emp-1",
          employee_code: "MAS47814",
          biometric_code: "MAS47814",
          cosec_user_id: "MAS47814",
          active_status: 1,
          employment_status: "active",
        }], []];
      }

      if (sql.includes("integration_biometric_daily")) {
        return [[{
          employee_code: "MAS47814",
          record_date: "2026-07-25",
          biometric_minutes: 557,
          total_punches: 11,
        }], []];
      }

      if (sql.includes("attendance_daily_record")) {
        return [[{
          employee_id: "emp-1",
          record_date: "2026-07-25",
          attendance_status: "absent",
          biometric_minutes: 557,
          raw_minutes: 0,
          dialler_minutes: 0,
          attendance_source: "dialler",
          source_system: "dialer_session_log.session_date",
          is_locked: 0,
          mismatch_flag: 1,
        }], []];
      }

      // apr, dialer_session_log, and anything added later: no rows, which is
      // what this scenario needs (biometric evidence but no APR or dialler).
      return [[], []];
    });

    const result = await attendanceReconciliationService.audit({
      from: "2026-07-25",
      to: "2026-07-25",
    });

    expect(result.countsByType.dialler_source_without_evidence).toBe(1);
  });
});
