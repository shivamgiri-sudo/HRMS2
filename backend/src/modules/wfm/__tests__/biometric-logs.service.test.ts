import { describe, expect, it } from "vitest";
import { mapPunchIoLabel, mergeBiometricPunchLogDays } from "../biometric-logs.service.js";

describe("biometric logs service helpers", () => {
  it("maps COSEC io_type values to readable labels", () => {
    expect(mapPunchIoLabel(0)).toBe("IN");
    expect(mapPunchIoLabel(1)).toBe("OUT");
    expect(mapPunchIoLabel(9)).toBe("UNKNOWN");
  });

  it("merges raw punches, biometric summaries, and attendance summaries by date", () => {
    const result = mergeBiometricPunchLogDays({
      rawPunches: [
        {
          cosec_index: 10,
          user_id: "MAS47814",
          punch_time: "2026-07-18 12:54:40",
          io_type: 0,
          device_id: 15,
          synced_at: "2026-07-18 15:00:25",
        },
      ],
      biometricSummaries: [
        {
          punch_date: "2026-07-18",
          first_punch_in: "2026-07-18 12:54:40",
          last_punch_out: null,
          total_punches: 1,
          raw_minutes: 0,
          source_system: "cosec_sqlserver",
        },
      ],
      attendanceSummaries: [
        {
          record_date: "2026-07-18",
          clock_in_time: "2026-07-18 12:54:40",
          clock_out_time: null,
          attendance_status: "missing_punch",
          biometric_minutes: null,
          attendance_source: "biometric",
          source_system: "cosec_sqlserver_sync",
          processed_at: "2026-07-18 15:08:56",
          is_locked: 0,
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-07-18");
    expect(result[0].rawPunches[0].ioLabel).toBe("IN");
    expect(result[0].biometricSummary?.totalPunches).toBe(1);
    expect(result[0].attendanceSummary?.attendanceStatus).toBe("missing_punch");
  });
});
