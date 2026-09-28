import { describe, expect, it } from "vitest";
import type { GridRow } from "@/hooks/useTeamRoster";
import { planAutofill, type AutofillSuggestion } from "../autofillPlan";
import type { TemplateProcess } from "../teamRosterFormat";

const opt = (start: string, end: string) => ({ key: `${start}-${end}`, start, end, night: false, label: `${start}-${end}`, code: null, name: null, group: "In use" as const, sources: ["in_use"], useCount: 5, templateId: null, shiftMasterId: null });
const templates: TemplateProcess[] = [{ processId: "p1", processName: "P1", options: [opt("10:00", "19:00")] }];
const row = (cells: GridRow["cells"] = {}): GridRow => ({ employeeId: "e1", code: "MAS1", name: "A", processId: "p1", processName: "P1", cells });
const sug = (date: string, type: AutofillSuggestion["type"], start: string | null = null, end: string | null = null): AutofillSuggestion => ({ employeeId: "e1", date, type, shiftStart: start, shiftEnd: end });
const TODAY = "2026-09-25";

describe("planAutofill", () => {
  it("fills blank future cells with an offered shift or a week off", () => {
    const plan = planAutofill([row()], [sug("2026-09-28", "SHIFT", "10:00", "19:00"), sug("2026-09-29", "WEEK_OFF")], {}, templates, TODAY);
    expect(plan.edits.map((e) => [e.date, e.choice.type, e.choice.shiftKey])).toEqual([["2026-09-28", "SHIFT", "10:00-19:00"], ["2026-09-29", "WEEK_OFF", null]]);
  });
  it("never touches a cell that has a roster, a draft, a lock, leave or an unsaved edit", () => {
    const cells: GridRow["cells"] = {
      "2026-09-28": { assignment: { id: "a", type: "SHIFT", isWeekOff: false, shiftTemplateId: null, shiftCode: null, shiftName: null, start: "10:00", end: "19:00", finalStatus: null } },
      "2026-09-29": { leave: "FULL" },
      "2026-09-30": { draft: { kind: "FILL_BLANK", type: "WEEK_OFF", shiftTemplateId: null, shiftStart: null, shiftEnd: null, reason: null } },
    };
    const staged = { "e1|2026-10-01": { choice: { type: "WEEK_OFF" as const, shiftKey: null }, reason: null } };
    const plan = planAutofill([row(cells)], ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((d) => sug(d, "WEEK_OFF")), staged, templates, TODAY);
    expect(plan.edits).toEqual([]);
    expect(plan.skippedOccupied).toBe(4);
  });
  it("skips dates before today", () => {
    expect(planAutofill([row()], [sug("2026-09-24", "WEEK_OFF")], {}, templates, TODAY).edits).toEqual([]);
  });
  it("skips a shift the process does not offer and counts it", () => {
    const plan = planAutofill([row()], [sug("2026-09-28", "SHIFT", "22:00", "07:00")], {}, templates, TODAY);
    expect(plan.edits).toEqual([]);
    expect(plan.skippedNoShiftOption).toBe(1);
  });
});
