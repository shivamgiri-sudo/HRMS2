/**
 * Attendance Register — day-column label helper (frontend copy) unit tests.
 *
 * Validates that `withDayColumnLabels` turns month-agnostic `day_N` columns
 * into "Mon-DD" calendar-date labels, drops any day beyond the actual length
 * of the selected month, and leaves every other column untouched.
 *
 * See also the backend copy's test file:
 * `backend/src/modules/reporting/__tests__/attendance-register-columns.test.ts`,
 * which asserts against the same fixture expectations.
 */

import { describe, expect, it } from "vitest";

import { buildDayColumnLabel, daysInMonth, withDayColumnLabels } from "@/lib/attendance-register-columns";

type Col = { key: string; label: string };

/** The non-day identity/summary columns that must always pass through unchanged. */
const baseColumns: Col[] = [
  { key: "sno", label: "SNo" },
  { key: "emp_code", label: "EmpCode" },
  { key: "bio_code", label: "BioCode" },
  { key: "emp_name", label: "EmpName" },
  { key: "department", label: "Department" },
  { key: "designation", label: "Designation" },
  { key: "profile", label: "Profile" },
  { key: "cost_center", label: "CostCenter" },
  { key: "emp_location", label: "EmpLocation" },
  { key: "billable", label: "Billable" },
  { key: "absent_count", label: "A" },
  { key: "present_count", label: "P" },
  { key: "od_count", label: "OD" },
  { key: "hd_count", label: "HD" },
  { key: "leave_count", label: "L" },
  { key: "holiday_count", label: "H" },
  { key: "weekoff_count", label: "W" },
  { key: "sal_days", label: "SalDays" },
  { key: "total", label: "Total" },
];

/** Full day_1..day_31 columns with the generic placeholder labels, as the catalogs declare them today. */
function dayColumns(): Col[] {
  return Array.from({ length: 31 }, (_, i) => ({
    key: `day_${i + 1}`,
    label: `Day ${i + 1}`,
  }));
}

function fullColumns(): Col[] {
  // Interleave base + day columns in roughly catalog order: identity block, days, summary block.
  const identity = baseColumns.slice(0, 10);
  const summary = baseColumns.slice(10);
  return [...identity, ...dayColumns(), ...summary];
}

function byKey(columns: Col[], key: string): Col | undefined {
  return columns.find((c) => c.key === key);
}

describe("withDayColumnLabels", () => {
  it("labels a normal 31-day month (2026-07) as Jul-01..Jul-31 with no generic Day label remaining", () => {
    const result = withDayColumnLabels(fullColumns(), "2026-07");

    expect(byKey(result, "day_1")?.label).toBe("Jul-01");
    expect(byKey(result, "day_31")?.label).toBe("Jul-31");
    expect(result.some((c) => /^Day \d+$/.test(c.label))).toBe(false);
  });

  it("labels a non-leap February (2025-02, 28 days) and drops day_29/30/31", () => {
    const result = withDayColumnLabels(fullColumns(), "2025-02");

    expect(byKey(result, "day_28")?.label).toBe("Feb-28");
    expect(byKey(result, "day_29")).toBeUndefined();
    expect(byKey(result, "day_30")).toBeUndefined();
    expect(byKey(result, "day_31")).toBeUndefined();
  });

  it("labels a leap February (2024-02, 29 days) and drops day_30/31", () => {
    const result = withDayColumnLabels(fullColumns(), "2024-02");

    expect(byKey(result, "day_29")?.label).toBe("Feb-29");
    expect(byKey(result, "day_30")).toBeUndefined();
    expect(byKey(result, "day_31")).toBeUndefined();
  });

  it("labels a 30-day month (2026-04, April) and drops day_31", () => {
    const result = withDayColumnLabels(fullColumns(), "2026-04");

    expect(byKey(result, "day_30")?.label).toBe("Apr-30");
    expect(byKey(result, "day_31")).toBeUndefined();
  });

  it("produces different label sets for two different months on the same base columns", () => {
    const july = withDayColumnLabels(fullColumns(), "2026-07");
    const february = withDayColumnLabels(fullColumns(), "2025-02");

    expect(byKey(july, "day_1")?.label).not.toBe(byKey(february, "day_1")?.label);
    expect(july.map((c) => c.label)).not.toEqual(february.map((c) => c.label));
  });

  it.each([["2026-07"], ["2025-02"], ["2024-02"], ["2026-04"]])(
    "passes non-day columns through with their original label unchanged (month %s)",
    (month) => {
      const result = withDayColumnLabels(fullColumns(), month);

      for (const base of baseColumns) {
        expect(byKey(result, base.key)?.label).toBe(base.label);
      }
    }
  );

  it.each([[undefined], [""], ["2026"]])(
    "returns the input columns array unchanged for malformed/missing month %j",
    (month) => {
      const input = fullColumns();
      const result = withDayColumnLabels(input, month as string | undefined);

      expect(result).toEqual(input);
    }
  );
});

describe("buildDayColumnLabel", () => {
  it("formats month and day as Mon-DD with zero-padded day", () => {
    expect(buildDayColumnLabel(7, 1)).toBe("Jul-01");
    expect(buildDayColumnLabel(7, 31)).toBe("Jul-31");
    expect(buildDayColumnLabel(2, 29)).toBe("Feb-29");
  });
});

describe("daysInMonth", () => {
  it("matches the calendar length for known months", () => {
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("visibleDayNumbers", () => {
  it("a single past month shows every day of it", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    const d = visibleDayNumbers({ month: "2026-09", today: "2026-10-15" });
    expect(d.size).toBe(30);
    expect(d.has(30)).toBe(true);
    expect(d.has(31)).toBe(false);
  });

  it("the current month stops at today", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    const d = visibleDayNumbers({ month: "2026-10", today: "2026-10-15" });
    expect([...d].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("a single-day range shows only that day (the '14th shows till 18th' report)", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    const d = visibleDayNumbers({ from: "2026-10-14", to: "2026-10-14", today: "2026-10-15" });
    expect([...d]).toEqual([14]);
  });

  it("a range into the future is cut at today", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    const d = visibleDayNumbers({ from: "2026-10-13", to: "2026-10-31", today: "2026-10-15" });
    expect([...d].sort((a, b) => a - b)).toEqual([13, 14, 15]);
  });

  it("a range across two months unions the day numbers", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    const d = visibleDayNumbers({ from: "2026-09-29", to: "2026-10-02", today: "2026-10-15" });
    expect([...d].sort((a, b) => a - b)).toEqual([1, 2, 29, 30]);
  });

  it("a month still to come shows nothing", async () => {
    const { visibleDayNumbers } = await import("@/lib/attendance-register-columns");
    expect(visibleDayNumbers({ month: "2026-12", today: "2026-10-15" }).size).toBe(0);
  });
});
