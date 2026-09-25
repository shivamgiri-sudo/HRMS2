import { describe, expect, it } from "vitest";
import type { GridRow } from "@/hooks/useTeamRoster";
import {
  computeBulkFill,
  computeRepeatWeek,
  pageShiftOptions,
  describeSkipped,
} from "../rosterBulkFill";
import type { ShiftOption, TemplateProcess } from "../teamRosterFormat";

const morning: ShiftOption = {
  key: "09:00-18:00",
  start: "09:00",
  end: "18:00",
  night: false,
  label: "09:00-18:00",
  code: "M",
  name: "Morning",
  group: "Templates",
  sources: [],
  useCount: 0,
  templateId: "t1",
  shiftMasterId: null,
};
const night: ShiftOption = {
  ...morning,
  key: "21:00-06:00",
  start: "21:00",
  end: "06:00",
  night: true,
  label: "21:00-06:00",
  code: "N",
  templateId: "t2",
};
const templates: TemplateProcess[] = [
  { processId: "p1", processName: "Onfido", options: [morning, night] },
  { processId: "p2", processName: "Other", options: [morning] },
];

// 2026-09-28 is a Monday.
const dates = [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
];
const row = (
  id: string,
  processId: string,
  cells: GridRow["cells"] = {},
): GridRow => ({
  employeeId: id,
  code: id,
  name: id,
  processId,
  processName: null,
  cells,
});
const noStaged = () => undefined;
const today = "2026-09-28";

describe("computeBulkFill", () => {
  it("fills every blank cell with the chosen shift", () => {
    const r = computeBulkFill({
      rows: [row("a", "p1")],
      dates,
      today,
      templates,
      staged: noStaged,
      choice: { type: "SHIFT", shiftKey: morning.key },
      weekdays: [],
      onlyBlank: true,
    });
    expect(r.edits).toHaveLength(dates.length);
  });

  it("limits the fill to the chosen weekdays", () => {
    const r = computeBulkFill({
      rows: [row("a", "p1")],
      dates,
      today,
      templates,
      staged: noStaged,
      choice: { type: "WEEK_OFF", shiftKey: null },
      weekdays: [0],
      onlyBlank: true,
    });
    expect(r.edits.map((e) => e.date)).toEqual(["2026-10-04"]);
  });

  it("skips a shift the person's process does not offer and counts it", () => {
    const r = computeBulkFill({
      rows: [row("a", "p2")],
      dates,
      today,
      templates,
      staged: noStaged,
      choice: { type: "SHIFT", shiftKey: night.key },
      weekdays: [],
      onlyBlank: true,
    });
    expect(r.edits).toHaveLength(0);
    expect(r.skipped.shiftNotInProcess).toBe(dates.length);
  });

  it("never touches past, rostered or locked cells", () => {
    const rows = [
      row("a", "p1", {
        "2026-09-28": {
          assignment: {
            id: "1",
            type: "SHIFT",
            isWeekOff: false,
            shiftTemplateId: null,
            shiftCode: "M",
            shiftName: null,
            start: "09:00",
            end: "18:00",
            finalStatus: null,
          },
        },
        "2026-09-29": {
          lockedBy: {
            submissionId: 1,
            submissionNo: "S1",
            status: "PENDING",
            submitter: "x",
          },
        },
      }),
    ];
    const r = computeBulkFill({
      rows,
      dates,
      today: "2026-09-30",
      templates,
      staged: noStaged,
      choice: { type: "WEEK_OFF", shiftKey: null },
      weekdays: [],
      onlyBlank: true,
    });
    expect(r.edits.map((e) => e.date)).toEqual(
      dates.filter((d) => d >= "2026-09-30"),
    );
  });

  it("keeps existing proposals when only-blank is on and overwrites when it is off", () => {
    const staged = (_e: string, d: string) =>
      d === "2026-09-29"
        ? { type: "WEEK_OFF" as const, shiftKey: null }
        : undefined;
    const keep = computeBulkFill({
      rows: [row("a", "p1")],
      dates,
      today,
      templates,
      staged,
      choice: { type: "SHIFT", shiftKey: morning.key },
      weekdays: [],
      onlyBlank: true,
    });
    expect(keep.edits.some((e) => e.date === "2026-09-29")).toBe(false);
    expect(keep.skipped.alreadyProposed).toBe(1);
    const overwrite = computeBulkFill({
      rows: [row("a", "p1")],
      dates,
      today,
      templates,
      staged,
      choice: { type: "SHIFT", shiftKey: morning.key },
      weekdays: [],
      onlyBlank: false,
    });
    expect(overwrite.edits.some((e) => e.date === "2026-09-29")).toBe(true);
  });
});

describe("computeRepeatWeek", () => {
  it("copies the first week's pattern onto the same weekdays of later weeks", () => {
    const staged = (_e: string, d: string) => {
      if (d === "2026-09-28")
        return { type: "SHIFT" as const, shiftKey: morning.key };
      if (d === "2026-10-04")
        return { type: "WEEK_OFF" as const, shiftKey: null };
      return undefined;
    };
    const r = computeRepeatWeek({
      rows: [row("a", "p1")],
      dates,
      today,
      templates,
      staged,
      onlyBlank: true,
    });
    expect(r.edits.map((e) => [e.date, e.choice.type])).toEqual([
      ["2026-10-05", "SHIFT"],
    ]);
  });

  it("does nothing for a range of one week or less", () => {
    const r = computeRepeatWeek({
      rows: [row("a", "p1")],
      dates: dates.slice(0, 7),
      today,
      templates,
      staged: () => ({ type: "WEEK_OFF", shiftKey: null }),
      onlyBlank: true,
    });
    expect(r.edits).toHaveLength(0);
  });
});

describe("pageShiftOptions and describeSkipped", () => {
  it("lists each distinct shift once, ordered by start time", () => {
    const options = pageShiftOptions(
      [row("a", "p1"), row("b", "p2")],
      templates,
    );
    expect(options.map((o) => o.key)).toEqual(["09:00-18:00", "21:00-06:00"]);
  });

  it("describes what was skipped", () => {
    expect(
      describeSkipped({
        readOnly: 2,
        alreadyProposed: 0,
        shiftNotInProcess: 1,
      }),
    ).toContain("not offered");
  });
});
