/**
 * Owner rule 2026-10-05: payroll, salary days and F&F count attendance only from the salary start date to
 * the exit date (per stint for a rejoiner). Every pay-relevant attendance read must carry
 * attendanceInEmploymentWindowSql, so a stray row before joining / after exit is never paid or docked.
 * F&F reads salary_prep_line.paid_working_days, which payrollCalculate produces, so it is covered through it.
 * Verified on real MySQL 8 (2026-10-06): salary start 5th + exit 20th -> 5..20; notice-serving LWD 14th
 * with status still active -> 1..14; rejoiner stints -> gap excluded; withdrawn ('rejoined') exit -> full month.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { attendanceInEmploymentWindowSql } from "../../../shared/employmentWindow.js";

const read = (f: string) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");

describe("pay-relevant attendance reads stay inside the employment window", () => {
  it("the predicate bounds by salary start / joining date, resolved exit date and stints", () => {
    const sql = attendanceInEmploymentWindowSql("adr");
    expect(sql).toContain("COALESCE(e.salary_start_date, e.date_of_joining, adr.record_date)");
    expect(sql).toContain("exit_request");
    expect(sql).toContain("e.date_of_exit");
    expect(sql).toContain("employment_stint");
  });

  it.each([
    ["payrollCalculate.service.ts", 3],
    ["running-salary.service.ts", 1],
    ["payroll.routes.ts", 1],
    ["payroll-more.routes.ts", 2],
  ])("%s applies it to its attendance reads", (file, n) => {
    const src = read(file);
    expect((src.match(/\$\{attendanceInEmploymentWindowSql\(/g) ?? []).length).toBeGreaterThanOrEqual(n);
  });
});
