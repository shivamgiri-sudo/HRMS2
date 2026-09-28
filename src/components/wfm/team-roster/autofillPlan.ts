import type { GridRow } from "@/hooks/useTeamRoster";
import { shiftOptionsFor, stagedKey, type StagedEdit } from "./TeamRosterGrid";
import {
  shiftKeyOf,
  type CellChoice,
  type CellType,
  type TemplateProcess,
} from "./teamRosterFormat";

export interface AutofillSuggestion {
  employeeId: string;
  date: string;
  type: CellType;
  shiftStart: string | null;
  shiftEnd: string | null;
}
export interface PlannedEdit {
  row: GridRow;
  date: string;
  choice: CellChoice;
}
export interface AutofillPlan {
  edits: PlannedEdit[];
  skippedOccupied: number;
  skippedNoShiftOption: number;
}

/** A cell can be auto-filled only if it is a future, untouched blank: no roster, no draft, no lock, no leave, no unsaved edit. */
function isBlank(
  row: GridRow,
  date: string,
  today: string,
  staged: Record<string, StagedEdit>,
): boolean {
  if (date < today) return false;
  const cell = row.cells[date];
  if (cell?.assignment || cell?.draft || cell?.lockedBy || cell?.leave)
    return false;
  return staged[stagedKey(row.employeeId, date)] === undefined;
}

/** Turns server suggestions into edits for blank cells only, and only shifts that process actually offers. */
export function planAutofill(
  rows: GridRow[],
  suggestions: AutofillSuggestion[],
  staged: Record<string, StagedEdit>,
  templates: TemplateProcess[],
  today: string,
): AutofillPlan {
  const byId = new Map(rows.map((r) => [r.employeeId, r]));
  const plan: AutofillPlan = {
    edits: [],
    skippedOccupied: 0,
    skippedNoShiftOption: 0,
  };
  for (const s of suggestions) {
    const row = byId.get(s.employeeId);
    if (!row) continue;
    if (!isBlank(row, s.date, today, staged)) {
      plan.skippedOccupied += 1;
      continue;
    }
    if (s.type !== "SHIFT") {
      plan.edits.push({
        row,
        date: s.date,
        choice: { type: s.type, shiftKey: null },
      });
      continue;
    }
    const key = shiftKeyOf(s.shiftStart, s.shiftEnd);
    const allowed = key
      ? shiftOptionsFor(templates, row.processId).some((o) => o.key === key)
      : false;
    if (!key || !allowed) {
      plan.skippedNoShiftOption += 1;
      continue;
    }
    plan.edits.push({
      row,
      date: s.date,
      choice: { type: "SHIFT", shiftKey: key },
    });
  }
  return plan;
}
