import { describe, expect, it } from "vitest";
import {
  buildOutlierRows,
  buildTargetTile,
  leadingRun,
  previousPeriods,
  type ActionSummary,
  type AlertLike,
} from "../onfido-outlier.pure";

const alert = (
  email: string,
  metric: string,
  value: number,
  threshold = 1.5,
): AlertLike => ({
  analystEmail: email,
  tlName: "TL A",
  amName: "AM A",
  metric,
  value,
  threshold,
  severity: value >= threshold * 1.5 ? "high" : "medium",
});

describe("previousPeriods", () => {
  it("returns equal-length periods immediately before the range, nearest first", () => {
    expect(previousPeriods("2026-08-10", "2026-08-16", 2)).toEqual([
      { from: "2026-08-03", to: "2026-08-09" },
      { from: "2026-07-27", to: "2026-08-02" },
    ]);
  });

  it("handles a single day", () => {
    expect(previousPeriods("2026-08-10", "2026-08-10", 1)).toEqual([
      { from: "2026-08-09", to: "2026-08-09" },
    ]);
  });

  it("returns nothing for an invalid range", () => {
    expect(previousPeriods("2026-08-10", "2026-08-01")).toEqual([]);
  });
});

describe("leadingRun", () => {
  it("counts only the unbroken run from the nearest period", () => {
    expect(leadingRun([true, true, false, true])).toBe(2);
    expect(leadingRun([false, true])).toBe(0);
  });
});

describe("buildOutlierRows", () => {
  it("marks an analyst flagged in consecutive earlier periods as a repeat outlier", () => {
    const rows = buildOutlierRows(
      [
        alert("a@x.com", "Overall Error %", 3),
        alert("b@x.com", "Overall Error %", 2),
      ],
      [
        [alert("a@x.com", "Overall Error %", 2)],
        [alert("a@x.com", "Overall Error %", 2)],
        [],
      ],
      [],
    );
    expect(rows[0]).toMatchObject({
      analystEmail: "a@x.com",
      streak: 3,
      repeat: true,
      priorPeriodsFlagged: 2,
      variance: 1.5,
    });
    expect(rows[1]).toMatchObject({
      analystEmail: "b@x.com",
      streak: 1,
      repeat: false,
    });
  });

  it("does not call a gap a streak", () => {
    const [row] = buildOutlierRows(
      [alert("a@x.com", "Overall Error %", 3)],
      [[], [alert("a@x.com", "Overall Error %", 3)], []],
      [],
    );
    expect(row).toMatchObject({
      streak: 1,
      repeat: false,
      priorPeriodsFlagged: 1,
    });
  });

  it("ignores metrics that carry no dashboard target", () => {
    expect(
      buildOutlierRows([alert("a@x.com", "Manual FAR %", 9, 2)], [], []),
    ).toEqual([]);
  });

  it("attaches the open action, preferring it over a closed one", () => {
    const closed: ActionSummary = {
      id: "1",
      analystEmail: "A@x.com",
      metric: "Overall Error %",
      status: "closed",
      dueDate: null,
      ownerName: null,
    };
    const open: ActionSummary = {
      id: "2",
      analystEmail: "a@x.com",
      metric: "Overall Error %",
      status: "open",
      dueDate: "2026-09-30",
      ownerName: "TL A",
    };
    const [row] = buildOutlierRows(
      [alert("a@x.com", "Overall Error %", 3)],
      [],
      [closed, open],
    );
    expect(row.action?.id).toBe("2");
  });
});

describe("buildTargetTile", () => {
  it("computes variance and on-target for a lower-is-better metric", () => {
    expect(
      buildTargetTile("k", "Error", 1.2, 1.5, "percent", true),
    ).toMatchObject({ variance: -0.3, onTarget: true });
    expect(
      buildTargetTile("k", "Error", 2, 1.5, "percent", true),
    ).toMatchObject({ variance: 0.5, onTarget: false });
  });

  it("claims no variance when there is no target or no data", () => {
    expect(
      buildTargetTile("k", "AHT", 100, null, "seconds", true),
    ).toMatchObject({ variance: null, onTarget: null });
    expect(
      buildTargetTile("k", "Error", null, 1.5, "percent", true),
    ).toMatchObject({ achievement: null, variance: null });
  });
});
