import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BranchOverview } from "../../../../../../backend/src/modules/branch-head-health/types";
import { PeopleVisual, buildPeople } from "../sections/PeopleVisual";
import { AttendanceVisual, buildAttendance, noPresentNote, shrinkageChange } from "../sections/AttendanceVisual";
import { AttritionVisual, RISK_TIER_COLORS, buildAttrition } from "../sections/AttritionVisual";
import * as fx from "./fixtures";

const NOOP = () => {};
const render = (C: typeof PeopleVisual, o: Partial<BranchOverview> = {}) => {
  const ov = fx.overviewOf(o);
  return renderToStaticMarkup(<C overview={ov} payload={fx.payloadOf(ov)} onSelect={NOOP} />);
};
const flat = (t: { rows: Array<Array<string | number | null>> }) => t.rows.map((r) => r.join("|")).join("\n");

describe("PeopleVisual", () => {
  const out = render(PeopleVisual);
  it("shows headcount vs mandate with the mandate marker, over and no-mandate as text", () => {
    expect(out).toContain("Headcount");
    expect(out).toContain("Headcount versus mandate by process");
    expect(out).toContain("Alpha Voice");
    expect(out).toContain("Over by 10");
    expect(out.match(/Over by/g)?.length).toBe(1);
    expect(out.match(/No mandate/g)?.length).toBe(2);
    expect(out).toContain('class="bh-marker"');
  });
  it("table twin carries every process with joined and left month to date", () => {
    const b = buildPeople(fx.people);
    expect(b.table.columns).toEqual(["Item", "Value", "Mandate seats", "Note", "Joined MTD", "Left MTD"]);
    expect(flat(b.table)).toContain("Alpha Voice|60|50|Over by 10|8|3");
    expect(flat(b.table)).toContain("Beta Chat|40||No mandate|4|2");
    expect(b.bars.items.map((i) => i.label)).toEqual(fx.people.byProcess.map((p) => p.process));
  });
  it("movement tiles and line of business", () => {
    for (const t of ["Joined MTD", "14", "Left MTD", "Upcoming exits (30 days)", "Exits not closed", "Banking", "Telecom", "Today: 2"]) expect(out).toContain(t);
  });
  it("folds lines of business past the top three into Other and keeps all of them in the list", () => {
    const d = { ...fx.people, byLob: ["A", "B", "C", "D", "E", "F"].map((lob, i) => ({ lob, active: 60 - i * 10 })) };
    const b = buildPeople(d);
    expect(b.lobTable.columns).toEqual(["Item", "A", "B", "C", "Other", "Total"]);
    expect(flat(b.lobTable)).toContain("Active|60|50|40|60|210");
    const o = render(PeopleVisual, { people: fx.ok(d) });
    expect(o).toContain("All lines of business");
    expect(o).toContain(">F<");
  });
  it("empty, error and missing", () => {
    expect(render(PeopleVisual, { people: fx.emptySection() })).toContain("No headcount data for this date");
    expect(render(PeopleVisual, { people: fx.err("boom") })).toContain("Headcount could not be loaded.");
    expect(render(PeopleVisual, { people: undefined as never })).toContain("Not available yet");
    const zero = { ...fx.people, byProcess: [], byLob: [], totalActive: 0, mandateSeatsTotal: null };
    expect(render(PeopleVisual, { people: fx.ok(zero) })).toContain("No data");
  });
});

describe("noPresentNote", () => {
  it("warns when a real roster has nobody present, and stays quiet otherwise", () => {
    expect(noPresentNote({ present: 0, scheduled: 160 })).toContain("may not have synced");
    expect(noPresentNote({ present: 0, scheduled: 4 })).toBeNull();
    expect(noPresentNote({ present: 88, scheduled: 100 })).toBeNull();
  });
  it("the attendance donut pins present 0, absent 1, on leave 3 so absent matches the by-process bars", () => {
    expect(buildAttendance(fx.attendance, []).donut.slices.map((x) => x.slot)).toEqual([0, 1, 3]);
  });
});

describe("AttendanceVisual", () => {
  const out = render(AttendanceVisual);
  it("donut with shrinkage in the centre and the vs-yesterday sentence", () => {
    for (const t of ["Attendance today", "Shrinkage", "12.0%", "Present", "Absent", "On leave", "+2.0 pts, up vs yesterday (10.0%)", "Yet to start", "Week-off worked", "Scheduled"]) expect(out).toContain(t);
    const b = buildAttendance(fx.attendance, []);
    expect(b.donut.slices.map((s) => s.key)).toEqual(["present", "absent", "onLeave"]);
    expect(flat(b.donutTable)).toContain("Present|88");
  });
  it("change sentence: down, flat, no data", () => {
    expect(shrinkageChange(12, { shrinkagePct: 15, absent: 9, scheduled: 100 })).toBe("-3.0 pts, down vs yesterday (15.0%)");
    expect(shrinkageChange(12, { shrinkagePct: 12, absent: 9, scheduled: 100 })).toBe("0.0 pts, no change vs yesterday (12.0%)");
    expect(shrinkageChange(12, { shrinkagePct: 0, absent: 0, scheduled: 0 })).toBe("No data for yesterday");
    expect(shrinkageChange(12, null)).toBe("No data for yesterday");
  });
  it("per-process stack sums shift slots and sorts by absent", () => {
    const d = { ...fx.attendance, bySlot: [
      { process: "Alpha Voice", shift: "09-18", planned: 50, present: 45, absent: 5, late: 6 },
      { process: "Beta Chat", shift: "09-18", planned: 20, present: 10, absent: 9, late: 1 },
      { process: "Alpha Voice", shift: "18-03", planned: 10, present: 6, absent: 2, late: 0 },
    ] };
    const b = buildAttendance(d, []);
    expect(b.byProcess.rows.map((r) => r.label)).toEqual(["Beta Chat", "Alpha Voice"]);
    expect(flat(b.byProcessTable)).toContain("Alpha Voice|51|7|2|60");
    expect(flat(b.byProcessTable)).toContain("Beta Chat|10|9|1|20");
  });
  it("keeps the shift-slot detail, late by process and late by team without names", () => {
    for (const t of ["Shift-slot detail", "09:00-18:00", "Late arrivals by process", "Beta Chat", "Late arrivals by team", "Team 1"]) expect(out).toContain(t);
    expect(out).not.toContain("Secret Manager");
  });
  it("empty, error and zero", () => {
    expect(render(AttendanceVisual, { attendance: fx.emptySection() })).toContain("No attendance data for this date");
    expect(render(AttendanceVisual, { attendance: fx.err("down") })).toContain("could not be loaded");
    const z = { ...fx.attendance, scheduled: 0, present: 0, absent: 0, onLeave: 0, shrinkagePct: 0, bySlot: [], processWise: [], previousDay: null };
    const o = render(AttendanceVisual, { attendance: fx.ok(z), leaderboard: fx.ok([]) });
    expect(o).toContain("No data");
    expect(o).not.toContain("NaN");
  });
});

describe("AttritionVisual", () => {
  const out = render(AttritionVisual);
  it("tiers low to critical on the ordinal risk tokens, and the names sentence", () => {
    const b = buildAttrition(fx.attrition, "2026-10-15");
    expect(b.tiers.series.map((s) => s.label)).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(b.tiers.series.map((s) => s.color)).toEqual(["var(--bh-risk-1)", "var(--bh-risk-2)", "var(--bh-risk-3)", "var(--bh-risk-4)"]);
    expect(RISK_TIER_COLORS).toEqual({ low: "var(--bh-risk-1)", medium: "var(--bh-risk-2)", high: "var(--bh-risk-3)", critical: "var(--bh-risk-4)" });
    expect(flat(b.tiersTable)).toContain("Risk tiers|30|9|5|2|46");
    expect(out).toContain("background:var(--bh-risk-4)");
    expect(out).toContain("Employees by attrition risk tier: Risk tiers 46 (Low 30, Medium 9, High 5, Critical 2)");
    for (const t of ["Attrition and retention", "Names are available in the process drill-down.", "7 people are flagged as top risk", "Model calibrated on 12 months of exits", "Expected exits (30 days)", "Absent streak", "New joiner risk", "Early exit share", "35.5%"]) expect(out).toContain(t);
  });
  it("monthly exits line with a dashed expected point at the current month", () => {
    const b = buildAttrition(fx.attrition, "2026-10-15");
    expect(b.exits.series[0].points.map((p) => p.x)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(b.exits.series[1].dashed).toBe(true);
    expect(b.exits.series[1].points.map((p) => p.y)).toEqual([null, null, 7]);
    expect(b.exits.series[0].points.map((p) => p.y)).toEqual([8, 10, null]);
    const same = buildAttrition({ ...fx.attrition, monthlyExits: [{ month: "2026-10", exits: 3 }] }, "2026-10-15");
    expect(same.exits.series[0].points).toEqual([{ x: "2026-10", y: 3 }]);
    const noExp = buildAttrition({ ...fx.attrition, expectedExits30: null }, "2026-10-15");
    expect(noExp.exits.series).toHaveLength(1);
  });
  it("high risk by process with headcount in the table", () => {
    const b = buildAttrition(fx.attrition, "2026-10-15");
    expect(flat(b.byProcessTable)).toContain("Alpha Voice|4|60 headcount, 2 absent streak");
  });
  it("no person names even when planted", () => {
    const leaky = { ...fx.attrition, topRisk: [{ name: "Paul Risky" }], byProcess: fx.attrition.byProcess.map((x) => ({ ...x, name: "Rita Risky" })) };
    const o = render(AttritionVisual, { attrition: fx.ok(leaky as never) });
    expect(o).not.toContain("Paul Risky");
    expect(o).not.toContain("Rita Risky");
  });
  it("empty and missing", () => {
    expect(render(AttritionVisual, { attrition: fx.emptySection() })).toContain("Attrition analysis is not available for this branch right now");
    expect(render(AttritionVisual, { attrition: undefined })).toContain("Not available yet");
  });
});
