import { describe, expect, it } from "vitest";
import {
  rollupTeams,
  sortWorstFirst,
  type DayGridAnalyst,
} from "../metric-day-grid.service.js";

const a = (
  code: string,
  tl: string | null,
  values: Array<number | null>,
): DayGridAnalyst => ({
  employeeId: code,
  employeeCode: code,
  name: code,
  teamLeader: tl ? { employeeCode: tl, name: `TL ${tl}` } : null,
  values,
  average:
    values.filter((v): v is number => v !== null).reduce((x, y) => x + y, 0) /
    Math.max(1, values.filter((v) => v !== null).length),
});

describe("metric day grid", () => {
  it("rolls analysts up to team leaders per day, ignoring missing days, and groups the leaderless", () => {
    const teams = rollupTeams(
      [
        a("E1", "T1", [80, null]),
        a("E2", "T1", [60, 40]),
        a("E3", null, [10, 20]),
      ],
      2,
    );
    const t1 = teams.find((t) => t.key === "T1")!;
    expect(t1.analysts).toBe(2);
    expect(t1.values).toEqual([70, 40]); // day 2: only E2 reported
    expect(t1.average).toBe(55);
    const none = teams.find((t) => t.key === "__none__")!;
    expect(none.name).toMatch(/No team leader/);
    expect(none.values).toEqual([10, 20]);
  });
  it("sorts worst first by direction, with no-data last", () => {
    const rows = [
      { average: 50 },
      { average: null },
      { average: 90 },
      { average: 10 },
    ];
    expect(
      sortWorstFirst(rows, "higher_is_better").map((r) => r.average),
    ).toEqual([10, 50, 90, null]);
    expect(
      sortWorstFirst(rows, "lower_is_better").map((r) => r.average),
    ).toEqual([90, 50, 10, null]);
  });
});
