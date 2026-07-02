import { describe, it, expect } from "vitest";
import { parseRosterCsv, type RosterCsvRow } from "../src/modules/wfm/rosterCsvParser.js";

const validCsv = `employee_code,roster_date,shift_start_time,shift_end_time,process_name,branch_name
EMP001,2026-05-20,09:00,18:00,Inbound,Mumbai
EMP002,2026-05-20,14:00,23:00,Outbound,Delhi`;

const minimalCsv = `employee_code,roster_date,shift_start_time,shift_end_time
EMP003,2026-05-21,09:00,18:00`;

describe("parseRosterCsv", () => {
  it("parses valid CSV into rows", () => {
    const { rows, errors } = parseRosterCsv(validCsv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("extracts employee_code correctly", () => {
    const { rows } = parseRosterCsv(validCsv);
    expect(rows[0].employee_code).toBe("EMP001");
    expect(rows[1].employee_code).toBe("EMP002");
  });

  it("extracts shift times correctly", () => {
    const { rows } = parseRosterCsv(validCsv);
    expect(rows[0].shift_start_time).toBe("09:00");
    expect(rows[0].shift_end_time).toBe("18:00");
  });

  it("extracts optional process_name and branch_name", () => {
    const { rows } = parseRosterCsv(validCsv);
    expect(rows[0].process_name).toBe("Inbound");
    expect(rows[0].branch_name).toBe("Mumbai");
  });

  it("handles missing optional columns gracefully", () => {
    const { rows, errors } = parseRosterCsv(minimalCsv);
    expect(errors).toHaveLength(0);
    expect(rows[0].process_name).toBeNull();
    expect(rows[0].branch_name).toBeNull();
  });

  it("reports error for row missing employee_code", () => {
    const csv = `employee_code,roster_date,shift_start_time,shift_end_time
,2026-05-20,09:00,18:00`;
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*employee_code/i);
    expect(rows).toHaveLength(0);
  });

  it("reports error for invalid date format", () => {
    const csv = `employee_code,roster_date,shift_start_time,shift_end_time
EMP001,20-05-2026,09:00,18:00`;
    const { errors } = parseRosterCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1.*date/i);
  });

  it("reports error for invalid time format", () => {
    const csv = `employee_code,roster_date,shift_start_time,shift_end_time
EMP001,2026-05-20,9:00,6pm`;
    const { errors } = parseRosterCsv(csv);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns empty arrays for empty CSV", () => {
    const { rows, errors } = parseRosterCsv("employee_code,roster_date,shift_start_time,shift_end_time\n");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("trims whitespace from all fields", () => {
    const csv = `employee_code,roster_date,shift_start_time,shift_end_time
  EMP001 , 2026-05-20 , 09:00 , 18:00 `;
    const { rows } = parseRosterCsv(csv);
    expect(rows[0].employee_code).toBe("EMP001");
    expect(rows[0].roster_date).toBe("2026-05-20");
  });

  it("skips blank lines", () => {
    const csv = `employee_code,roster_date,shift_start_time,shift_end_time
EMP001,2026-05-20,09:00,18:00

EMP002,2026-05-21,09:00,18:00`;
    const { rows } = parseRosterCsv(csv);
    expect(rows).toHaveLength(2);
  });
});
