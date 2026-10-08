import { describe, expect, it } from "vitest";
import {
  expectedFixedOffDates, floatingOffsPerWeek, formatWeekdays, hasFixedPolicy, isFixedOffDate, isValidYmd, parseWeekdays,
  pickPolicy, rangesOverlap, specificityFor, weekKey, weekOffColumns, weekdayOf, weeksOverFloatingLimit,
  type EmployeeOffScope, type OffdayPolicy,
} from "../roster-offday-resolver.js";

const P = "proc-1", L = "lob-1", B = "br-1";
const pol = (over: Partial<OffdayPolicy>): OffdayPolicy => ({
  id: "x", process_id: P, lob_id: null, branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: [0],
  floating_offs_per_week: null, effective_from: "2026-01-01", effective_to: null, ...over,
});
const scope: EmployeeOffScope = { processId: P, lobId: L, branchId: B };

describe("date helpers (UTC, string based)", () => {
  it("weekdayOf ignores the host timezone", () => {
    expect(weekdayOf("2026-09-06")).toBe(0); // Sunday
    expect(weekdayOf("2026-08-31")).toBe(1); // Monday
    expect(weekdayOf("2026-09-05")).toBe(6);
  });
  it("weekKey is the Monday of the Monday-Sunday week", () => {
    expect(weekKey("2026-09-06")).toBe("2026-08-31"); // Sunday belongs to the week that started Monday
    expect(weekKey("2026-08-31")).toBe("2026-08-31");
    expect(weekKey("2026-09-07")).toBe("2026-09-07");
  });
  it("isValidYmd rejects impossible dates", () => {
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("2026-9-1")).toBe(false);
    expect(isValidYmd("2026-09-01")).toBe(true);
  });
  it("parseWeekdays / formatWeekdays are sorted, unique and drop junk", () => {
    expect(parseWeekdays("6, 0,0,9,x")).toEqual([0, 6]);
    expect(parseWeekdays(null)).toEqual([]);
    expect(formatWeekdays([6, 0, 6])).toBe("0,6");
  });
});

describe("pickPolicy precedence", () => {
  const all = [
    pol({ id: "proc", fixed_weekdays: [1] }),
    pol({ id: "proc+branch", branch_id: B, fixed_weekdays: [2] }),
    pol({ id: "proc+lob", lob_id: L, fixed_weekdays: [3] }),
    pol({ id: "proc+lob+branch", lob_id: L, branch_id: B, fixed_weekdays: [4] }),
  ];
  it("process+LOB+branch beats process+LOB beats process+branch beats process", () => {
    expect(pickPolicy(all, scope, "2026-09-02")?.id).toBe("proc+lob+branch");
    expect(pickPolicy(all.filter((p) => p.id !== "proc+lob+branch"), scope, "2026-09-02")?.id).toBe("proc+lob");
    expect(pickPolicy(all.filter((p) => !p.id.includes("lob")), scope, "2026-09-02")?.id).toBe("proc+branch");
    expect(pickPolicy(all.filter((p) => p.id === "proc"), scope, "2026-09-02")?.id).toBe("proc");
  });
  it("a row scoped to another LOB / branch / process does not apply", () => {
    expect(pickPolicy([pol({ lob_id: "lob-2" })], scope, "2026-09-02")).toBeNull();
    expect(pickPolicy([pol({ branch_id: "br-2" })], scope, "2026-09-02")).toBeNull();
    expect(pickPolicy([pol({ process_id: "proc-2" })], scope, "2026-09-02")).toBeNull();
    expect(specificityFor(pol({ lob_id: L }), { processId: P, lobId: null, branchId: B })).toBeNull();
  });
  it("is effective-dated and ties go to the latest effective_from", () => {
    const a = pol({ id: "old", effective_from: "2026-01-01", effective_to: "2026-06-30" });
    const b = pol({ id: "new", effective_from: "2026-07-01" });
    expect(pickPolicy([a, b], scope, "2026-06-30")?.id).toBe("old");
    expect(pickPolicy([a, b], scope, "2026-07-01")?.id).toBe("new");
    expect(pickPolicy([a, b], scope, "2025-12-31")).toBeNull();
  });
  it("no employee process means nothing applies", () => {
    expect(pickPolicy(all, { processId: null, lobId: L, branchId: B }, "2026-09-02")).toBeNull();
  });
});

describe("fixed / floating semantics", () => {
  it("FIXED_DAY yields the exact off dates in a range (1 and 2 days)", () => {
    expect(expectedFixedOffDates([pol({})], scope, "2026-08-31", "2026-09-14")).toEqual(["2026-09-06", "2026-09-13"]);
    expect(expectedFixedOffDates([pol({ fixed_weekdays: [0, 6] })], scope, "2026-09-01", "2026-09-07"))
      .toEqual(["2026-09-05", "2026-09-06"]);
  });
  it("FLOATING forces no dates but exposes offs per week", () => {
    const f = pol({ off_type: "FLOATING", fixed_weekdays: [], floating_offs_per_week: 2 });
    expect(expectedFixedOffDates([f], scope, "2026-08-31", "2026-09-30")).toEqual([]);
    expect(isFixedOffDate([f], scope, "2026-09-06")).toBe(false);
    expect(hasFixedPolicy([f], scope, "2026-09-06")).toBe(false);
    expect(floatingOffsPerWeek([f], scope, "2026-09-06")).toBe(2);
    expect(floatingOffsPerWeek([pol({})], scope, "2026-09-06")).toBeNull();
  });
  it("no policy -> nothing expected", () => {
    expect(expectedFixedOffDates([], scope, "2026-08-31", "2026-09-30")).toEqual([]);
  });
  it("weeksOverFloatingLimit flags weeks with more offs than allowed", () => {
    expect(weeksOverFloatingLimit(["2026-08-31", "2026-09-02", "2026-09-06", "2026-09-07"], 2)).toEqual(["2026-08-31"]);
    expect(weeksOverFloatingLimit(["2026-08-31", "2026-08-31", "2026-09-07"], 1)).toEqual([]);
  });
});

describe("rangesOverlap and weekOffColumns", () => {
  it("treats null end as open-ended and is inclusive", () => {
    expect(rangesOverlap("2026-01-01", "2026-06-30", "2026-06-30", null)).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-06-29", "2026-06-30", null)).toBe(false);
    expect(rangesOverlap("2026-01-01", null, "2030-01-01", null)).toBe(true);
  });
  it("sets both week-off flags together", () => {
    expect(weekOffColumns(true)).toEqual({ is_week_off: 1, assignment_type: "WEEK_OFF" });
    expect(weekOffColumns(false).is_week_off).toBe(0);
  });
});
