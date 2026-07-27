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

    dbQuery
      .mockResolvedValueOnce([[
        {
          employee_id: "emp-1",
          employee_code: "MAS47814",
          biometric_code: "MAS47814",
          cosec_user_id: "MAS47814",
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          employee_code: "MAS47814",
          record_date: "2026-07-25",
          biometric_minutes: 557,
          total_punches: 11,
        },
      ], []])
      .mockResolvedValueOnce([[
        {
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
        },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result = await attendanceReconciliationService.audit({
      from: "2026-07-25",
      to: "2026-07-25",
    });

    expect(result.countsByType.dialler_source_without_evidence).toBe(1);
  });
});
