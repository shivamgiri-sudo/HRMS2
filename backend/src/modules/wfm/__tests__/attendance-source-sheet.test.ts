import { describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2";
import {
  formatHours,
  parseMonth,
  statusCode,
  summariseSource,
  toSheetDay,
  type SheetDay,
} from "../attendance-source-sheet.service.js";
import {
  buildAttendanceSourceWorkbook,
  dayLabel,
  monthLabel,
} from "../attendance-source-sheet.xlsx.js";

const day = (over: Partial<SheetDay>): SheetDay => ({
  code: "P",
  status: "present",
  cosecMinutes: 540,
  aprMinutes: 485,
  payrollSource: "apr",
  ...over,
});

describe("attendance source sheet helpers", () => {
  it("formats minutes as H:MM Hrs and no reading as a dash", () => {
    expect(formatHours(540)).toBe("9:00 Hrs");
    expect(formatHours(485)).toBe("8:05 Hrs");
    expect(formatHours(0)).toBe("0:00 Hrs");
    expect(formatHours(null)).toBe("-");
  });

  it("maps every attendance_status to its short code", () => {
    expect(statusCode("present")).toBe("P");
    expect(statusCode("half_day")).toBe("HD");
    expect(statusCode("missing_punch")).toBe("MP");
    expect(statusCode("week_off_worked")).toBe("WOW");
  });

  it("parses a month into its calendar days", () => {
    const sep = parseMonth("2026-09");
    expect(sep?.days).toHaveLength(30);
    expect(sep?.from).toBe("2026-09-01");
    expect(sep?.to).toBe("2026-09-30");
    expect(parseMonth("2028-02")?.days).toHaveLength(29);
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("Sep-26")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
  });

  it("turns a dialler row into the APR payroll source and a biometric row into COSEC", () => {
    const apr = toSheetDay({
      attendance_status: "half_day",
      attendance_source: "dialler",
      dialler_minutes: 425,
      biometric_minutes: 526,
    } as RowDataPacket);
    expect(apr).toMatchObject({
      code: "HD",
      payrollSource: "apr",
      aprMinutes: 425,
      cosecMinutes: 526,
    });
    const cosec = toSheetDay({
      attendance_status: "present",
      attendance_source: "biometric",
      dialler_minutes: null,
      biometric_minutes: 545,
    } as RowDataPacket);
    expect(cosec).toMatchObject({
      code: "P",
      payrollSource: "cosec",
      aprMinutes: null,
      cosecMinutes: 545,
    });
  });

  it("labels an employee APR, COSEC, or APR + COSEC from the days' payroll sources", () => {
    expect(summariseSource([day({ payrollSource: "apr" })])).toBe("APR");
    expect(summariseSource([day({ payrollSource: "cosec" })])).toBe("COSEC");
    expect(
      summariseSource([
        day({ payrollSource: "apr" }),
        day({ payrollSource: "cosec" }),
      ]),
    ).toBe("APR + COSEC");
    expect(summariseSource([])).toBe("-");
  });
});

describe("attendance source sheet workbook", () => {
  it("writes identity columns, a merged date header and a Status/Cosec/APR triplet per day", () => {
    const wb = buildAttendanceSourceWorkbook(
      "2026-09",
      ["2026-09-01", "2026-09-02"],
      [
        {
          employeeId: "e1",
          employeeCode: "MAS10000",
          employeeName: "XYZ",
          branch: "Noida",
          costCentre: "CC1",
          process: "Proc",
          lob: "LOB",
          attendanceSource: "APR",
          days: {
            "2026-09-01": day({}),
            "2026-09-02": day({
              code: "HD",
              status: "half_day",
              cosecMinutes: 520,
              aprMinutes: 425,
            }),
          },
        },
      ],
    );
    const ws = wb.getWorksheet("Attendance Source Sheet")!;
    expect(ws.getCell(1, 9).value).toBe("01-Sep-26");
    expect(ws.getCell(1, 12).value).toBe("02-Sep-26");
    expect([9, 10, 11].map((c) => ws.getCell(2, c).value)).toEqual([
      "Status",
      "Cosec",
      "APR",
    ]);
    expect(ws.getCell(3, 1).value).toBe("Sep'26");
    expect(ws.getCell(3, 8).value).toBe("APR");
    expect([9, 10, 11].map((c) => ws.getCell(3, c).value)).toEqual([
      "P",
      "9:00 Hrs",
      "8:05 Hrs",
    ]);
    expect([12, 13, 14].map((c) => ws.getCell(3, c).value)).toEqual([
      "HD",
      "8:40 Hrs",
      "7:05 Hrs",
    ]);
    // The payroll source (APR here) is the bold duration.
    expect(ws.getCell(3, 11).font?.bold).toBe(true);
    expect(ws.getCell(3, 10).font?.bold).not.toBe(true);
  });

  it("formats month and day labels like the requested sheet", () => {
    expect(monthLabel("2026-09")).toBe("Sep'26");
    expect(dayLabel("2026-09-03")).toBe("03-Sep-26");
  });
});
