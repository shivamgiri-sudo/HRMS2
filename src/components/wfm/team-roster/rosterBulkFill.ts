import type { GridRow } from "@/hooks/useTeamRoster";
import {
  addDaysYmd,
  shiftKeyOf,
  weekdayNumber,
  type CellChoice,
  type ShiftOption,
  type TemplateProcess,
} from "./teamRosterFormat";

/** One staged cell edit produced by a bulk action. */
export interface BulkEdit {
  employeeId: string;
  date: string;
  choice: CellChoice;
}

export interface BulkResult {
  edits: BulkEdit[];
  /** Cells the action could not fill, by reason - shown to the user so nothing is silently dropped. */
  skipped: {
    readOnly: number;
    alreadyProposed: number;
    shiftNotInProcess: number;
  };
}

export type StagedLookup = (
  employeeId: string,
  date: string,
) => CellChoice | null | undefined;

const shiftOptionsOf = (
  templates: TemplateProcess[],
  processId: string | null,
): ShiftOption[] =>
  templates.find((p) => p.processId === processId)?.options ?? [];

/** The value currently proposed for a cell: an unsaved edit wins over the saved draft line. */
export function proposedChoice(
  row: GridRow,
  date: string,
  staged: StagedLookup,
): CellChoice | null {
  const edit = staged(row.employeeId, date);
  if (edit !== undefined) return edit;
  const draft = row.cells[date]?.draft;
  return draft
    ? {
        type: draft.type,
        shiftKey: shiftKeyOf(draft.shiftStart, draft.shiftEnd),
      }
    : null;
}

/** A cell a manager may write to: today or later, no stored roster, not locked by a pending submission. */
export function isFillable(row: GridRow, date: string, today: string): boolean {
  if (date < today) return false;
  const cell = row.cells[date];
  return !cell?.assignment && !cell?.lockedBy;
}

export interface BulkFillInput {
  rows: GridRow[];
  dates: string[];
  today: string;
  templates: TemplateProcess[];
  staged: StagedLookup;
  choice: CellChoice;
  /** JS weekday numbers (0 = Sunday .. 6 = Saturday) the action applies to; empty = every date. */
  weekdays: number[];
  /** true = leave cells that already carry a proposed value alone. */
  onlyBlank: boolean;
  /** Restrict to these employees; undefined = every row on the page. */
  employeeIds?: Set<string>;
}

/**
 * "Apply to all": one choice across many cells. A shift is only applied where the employee's own
 * process actually offers that shift (the server rejects anything else); other cells are counted as
 * skipped rather than failing the whole action.
 */
export function computeBulkFill(input: BulkFillInput): BulkResult {
  const {
    rows,
    dates,
    today,
    templates,
    staged,
    choice,
    weekdays,
    onlyBlank,
    employeeIds,
  } = input;
  const result: BulkResult = {
    edits: [],
    skipped: { readOnly: 0, alreadyProposed: 0, shiftNotInProcess: 0 },
  };
  const dayFilter = new Set(weekdays);
  for (const row of rows) {
    if (employeeIds && !employeeIds.has(row.employeeId)) continue;
    const allowed =
      choice.type === "SHIFT"
        ? shiftOptionsOf(templates, row.processId).some(
            (o) => o.key === choice.shiftKey,
          )
        : true;
    for (const date of dates) {
      if (dayFilter.size > 0 && !dayFilter.has(weekdayNumber(date))) continue;
      if (!isFillable(row, date, today)) {
        result.skipped.readOnly += 1;
        continue;
      }
      if (!allowed) {
        result.skipped.shiftNotInProcess += 1;
        continue;
      }
      if (onlyBlank && proposedChoice(row, date, staged)) {
        result.skipped.alreadyProposed += 1;
        continue;
      }
      result.edits.push({ employeeId: row.employeeId, date, choice });
    }
  }
  return result;
}

export interface RepeatWeekInput {
  rows: GridRow[];
  dates: string[];
  today: string;
  templates: TemplateProcess[];
  staged: StagedLookup;
  onlyBlank: boolean;
}

/**
 * "Repeat first week": each employee's proposed pattern for the first 7 dates of the range is copied
 * to the same weekday of every later week, so a manager fills one week and the rest follows.
 */
export function computeRepeatWeek(input: RepeatWeekInput): BulkResult {
  const { rows, dates, today, templates, staged, onlyBlank } = input;
  const result: BulkResult = {
    edits: [],
    skipped: { readOnly: 0, alreadyProposed: 0, shiftNotInProcess: 0 },
  };
  if (dates.length === 0) return result;
  const first = dates[0];
  for (const row of rows) {
    const options = shiftOptionsOf(templates, row.processId);
    for (const date of dates) {
      if (date < addDaysYmd(first, 7)) continue;
      const source = addDaysYmd(
        date,
        -7 * Math.floor(daysBetween(first, date) / 7),
      );
      const choice = proposedChoice(row, source, staged);
      if (!choice) continue;
      if (!isFillable(row, date, today)) {
        result.skipped.readOnly += 1;
        continue;
      }
      if (
        choice.type === "SHIFT" &&
        !options.some((o) => o.key === choice.shiftKey)
      ) {
        result.skipped.shiftNotInProcess += 1;
        continue;
      }
      if (onlyBlank && proposedChoice(row, date, staged)) {
        result.skipped.alreadyProposed += 1;
        continue;
      }
      result.edits.push({ employeeId: row.employeeId, date, choice });
    }
  }
  return result;
}

function daysBetween(from: string, to: string): number {
  const ms = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** Distinct shifts across every process on the page, so one toolbar select can offer them all. */
export function pageShiftOptions(
  rows: GridRow[],
  templates: TemplateProcess[],
): ShiftOption[] {
  const seen = new Map<string, ShiftOption>();
  for (const row of rows) {
    for (const option of shiftOptionsOf(templates, row.processId)) {
      if (!seen.has(option.key)) seen.set(option.key, option);
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  );
}

export function describeSkipped(skipped: BulkResult["skipped"]): string {
  const parts: string[] = [];
  if (skipped.shiftNotInProcess > 0)
    parts.push(
      `${skipped.shiftNotInProcess} where the shift is not offered for that person's process`,
    );
  if (skipped.alreadyProposed > 0)
    parts.push(`${skipped.alreadyProposed} already filled by you`);
  if (skipped.readOnly > 0)
    parts.push(`${skipped.readOnly} past, locked or already rostered`);
  return parts.join("; ");
}
