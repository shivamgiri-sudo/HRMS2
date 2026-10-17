import { describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute } }));

import { attendanceEngineService, istMinutesOfDay } from "../attendance-engine.service.js";

/**
 * Since 2026-10-12 the COSEC sync attributes a whole night shift (evening entry -> morning exit)
 * to the date it STARTED, so the start-date wfm_attendance_session row already carries the
 * cross-midnight minutes. The engine used to also add any next-date session that logged in
 * before 08:00 IST to a Partial session that started after 20:00, which counted minutes twice:
 *   MAS57822 2026-10-02: session 23:02 -> 10-03 07:27 = 505 min, ADR written as 1826.
 *   MAS63454 2026-10-05: 21:28 -> 10-06 04:22 = 414 min, plus a separate 10-06 05:31 shift (509).
 */
type Session = { id: string; total_login_minutes: number; current_status: string; login_time: string };

function mockSessions(byDate: Record<string, Session[]>) {
  const seenDates: string[] = [];
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("wfm_attendance_session")) {
      const date = String(params[1]);
      seenDates.push(date);
      return [byDate[date] ?? []];
    }
    return [[]];
  });
  return seenDates;
}

describe("getBiometricEvidence never double counts a start-date-attributed night shift", () => {
  it("MAS57822 2026-10-02: counts only the 505-minute start-date session", async () => {
    const seen = mockSessions({
      "2026-10-02": [
        { id: "s-1002", total_login_minutes: 505, current_status: "Partial", login_time: "2026-10-02 23:02:26" },
      ],
      // A stale next-date row (pre-rebuild calendar split) that logged in before 08:00 IST.
      "2026-10-03": [
        { id: "s-1003-stale", total_login_minutes: 1321, current_status: "Partial", login_time: "2026-10-03 07:27:26" },
      ],
    });
    const res = await attendanceEngineService.getBiometricEvidence("emp-57822", "2026-10-02");
    expect(res).toEqual({ minutes: 505, sourceSystem: "wfm_attendance_session", sourceReference: "s-1002" });
    expect(seen).not.toContain("2026-10-03");
  });

  it("a separate early-morning shift on the next date is not added to the night before", async () => {
    mockSessions({
      "2026-10-05": [
        { id: "s-1005", total_login_minutes: 414, current_status: "Partial", login_time: "2026-10-05 21:28:35" },
      ],
      "2026-10-06": [
        { id: "s-1006", total_login_minutes: 509, current_status: "Partial", login_time: "2026-10-06 05:31:47" },
      ],
    });
    const res = await attendanceEngineService.getBiometricEvidence("emp-63454", "2026-10-05");
    expect(res.minutes).toBe(414);
  });

  it("still sums several sessions that belong to the same date", async () => {
    mockSessions({
      "2026-10-07": [
        { id: "a", total_login_minutes: 200, current_status: "Partial", login_time: "2026-10-07 09:00:00" },
        { id: "b", total_login_minutes: 250, current_status: "Partial", login_time: "2026-10-07 14:00:00" },
      ],
    });
    const res = await attendanceEngineService.getBiometricEvidence("emp-1", "2026-10-07");
    expect(res).toEqual({ minutes: 450, sourceSystem: "wfm_attendance_session", sourceReference: "b" });
  });
});

describe("istMinutesOfDay is host-timezone independent", () => {
  it("reads the clock digits of an IST DATETIME string (dateStrings pool)", () => {
    expect(istMinutesOfDay("2026-10-02 23:02:26")).toBe(23 * 60 + 2);
    expect(istMinutesOfDay("2026-10-03 07:27:26")).toBe(7 * 60 + 27);
  });
  it("shifts an absolute instant to IST", () => {
    expect(istMinutesOfDay(new Date("2026-10-02T17:32:26Z"))).toBe(23 * 60 + 2);
    expect(istMinutesOfDay("2026-10-02T17:32:26.000Z")).toBe(23 * 60 + 2);
  });
  it("returns null for empty or unparseable input", () => {
    expect(istMinutesOfDay(null)).toBeNull();
    expect(istMinutesOfDay("")).toBeNull();
    expect(istMinutesOfDay("not a date")).toBeNull();
  });
});
