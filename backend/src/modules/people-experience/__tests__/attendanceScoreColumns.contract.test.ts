import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.resolve(__dirname, "../people-experience.service.ts"), "utf8");

describe("people experience attendance score queries", () => {
  it("uses record_date / attendance_status of attendance_daily_record", () => {
    expect(src).not.toContain("attendance_date");
    expect(src).not.toMatch(/LOWER\(status\) IN \('absent'/);
    expect(src).toContain("FROM attendance_daily_record WHERE employee_id = ? AND record_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)");
    expect(src).toContain("LOWER(attendance_status) IN ('absent','a','lwp')");
  });
  it("keeps the scoring formula", () => {
    expect(src).toContain("days > 0 ? clamp(100 - (absent / days) * 100) : 72");
  });
});
