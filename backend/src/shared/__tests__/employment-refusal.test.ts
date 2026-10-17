// employmentRefusal: the approval-time refusal must say WHICH bound a date crossed (Ahmedabad HR,
// 2026-10-17, read a generic "outside employment period" as an approval bug for left employees).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

import { employmentRefusal } from "../employmentWindow.js";

function employee(row: Record<string, unknown>) {
  dbExecute.mockResolvedValueOnce([[{ id: "emp-1", ...row }], []]); // employees row
  dbExecute.mockResolvedValueOnce([[], []]); // no rejoin stints
}

beforeEach(() => dbExecute.mockReset());

describe("employmentRefusal", () => {
  it("allows a day before the leaver's exit date", async () => {
    employee({ salary_start_date: "2025-07-10", date_of_joining: "2025-07-10", end_date: "2026-09-07" });
    expect(await employmentRefusal("emp-1", "2026-09-05")).toBeNull();
  });

  it("allows the exit date itself (last working day)", async () => {
    employee({ salary_start_date: "2025-07-10", date_of_joining: "2025-07-10", end_date: "2026-09-07" });
    expect(await employmentRefusal("emp-1", "2026-09-07")).toBeNull();
  });

  it("refuses a day after the exit date and names the exit date on record", async () => {
    employee({ salary_start_date: "2025-07-10", date_of_joining: "2025-07-10", end_date: "2026-09-07" });
    const text = await employmentRefusal("emp-1", "2026-09-15");
    expect(text).toContain("2026-09-15 is outside this employee's employment period (2025-07-10 to 2026-09-07)");
    expect(text).toContain("The exit date on record is 2026-09-07");
  });

  it("refuses a day before the salary start date and names the start", async () => {
    employee({ salary_start_date: "2026-09-09", date_of_joining: "2026-09-09", end_date: null });
    expect(await employmentRefusal("emp-1", "2026-09-02")).toContain("(2026-09-09 to no exit date)");
  });

  it("does not refuse an employee it cannot find (same as isEmployedOn)", async () => {
    dbExecute.mockResolvedValueOnce([[], []]);
    dbExecute.mockResolvedValueOnce([[], []]);
    expect(await employmentRefusal("ghost", "2026-09-15")).toBeNull();
  });

  it("accepts a DATETIME-shaped session date", async () => {
    employee({ salary_start_date: "2025-07-10", date_of_joining: "2025-07-10", end_date: "2026-09-07" });
    expect(await employmentRefusal("emp-1", "2026-09-05 00:00:00")).toBeNull();
  });
});
