// Pure rules for the weekly roster-upload tracker (no DB, no clock — `nowMs` is always passed in).
//
// Business rule (owner, 2026-09-21): every process must upload the roster for the week starting
// Monday W by the Sunday before it (W-1) at 18:00 IST. All times here are IST wall-clock, turned
// into epoch ms with a fixed +05:30 offset so the result does not depend on the host timezone.

export const UPLOAD_STATUSES = ['uploaded', 'delayed', 'partial', 'missing', 'due'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const ESCALATION_STAGES = ['reminder', 'heads_up', 'missing', 'escalated', 'late_upload'] as const;
export type EscalationStage = (typeof ESCALATION_STAGES)[number];
export type RecipientKind = 'wfm' | 'manager' | 'skip_level';

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DEADLINE_HOUR_IST = 18;

/** Wall-clock hour (IST) of each stage on the day named by its offset from the week's Monday. */
const STAGE_TRIGGER: Record<Exclude<EscalationStage, 'late_upload'>, { dayOffset: number; hour: number }> = {
  reminder: { dayOffset: -3, hour: 10 }, // Friday 10:00
  heads_up: { dayOffset: -1, hour: 12 }, // Sunday 12:00
  missing: { dayOffset: -1, hour: DEADLINE_HOUR_IST }, // Sunday 18:00 = the deadline itself
  escalated: { dayOffset: 0, hour: 10 }, // Monday 10:00
};

export const STAGE_RECIPIENTS: Record<EscalationStage, readonly RecipientKind[]> = {
  reminder: ['wfm'],
  heads_up: ['wfm', 'manager'],
  missing: ['wfm', 'manager'],
  escalated: ['wfm', 'manager', 'skip_level'],
  late_upload: ['wfm', 'manager'],
};

function parseDate(dateStr: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const { y, m, d } = parseDate(dateStr);
  return formatUtcDate(Date.UTC(y, m - 1, d) + days * DAY_MS);
}

/** Monday of the week containing `dateStr`. */
export function weekStartOf(dateStr: string): string {
  const { y, m, d } = parseDate(dateStr);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(dateStr, -((dow + 6) % 7));
}

/** Calendar date in IST for an epoch. */
export function istDateOf(epochMs: number): string {
  return formatUtcDate(epochMs + IST_OFFSET_MS);
}

export function currentWeekStart(nowMs: number): string {
  return weekStartOf(istDateOf(nowMs));
}

/** Epoch ms of `hour`:00 IST on `dateStr`. */
export function istEpoch(dateStr: string, hour: number): number {
  const { y, m, d } = parseDate(dateStr);
  return Date.UTC(y, m - 1, d, hour, 0, 0) - IST_OFFSET_MS;
}

/** Upload deadline for the week starting `weekStart`: the Sunday before, 18:00 IST. */
export function deadlineMs(weekStart: string): number {
  return istEpoch(addDays(weekStart, -1), DEADLINE_HOUR_IST);
}

export function stageTriggerMs(weekStart: string, stage: Exclude<EscalationStage, 'late_upload'>): number {
  const { dayOffset, hour } = STAGE_TRIGGER[stage];
  return istEpoch(addDays(weekStart, dayOffset), hour);
}

/** `count` consecutive week starts beginning at `firstWeek`. */
export function weekWindow(firstWeek: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(firstWeek, i * 7));
}

export interface CellInput {
  expected: number;
  covered: number;
  /** Epoch ms at which the last still-uncovered employee first got a committed roster. */
  fullCoverageAtMs: number | null;
  firstCommitAtMs: number | null;
  weekStart: string;
  nowMs: number;
}

export interface CellResult {
  status: UploadStatus;
  /** Hours past the deadline: upload lateness for `delayed`, current overdue time for `missing`/`partial`. */
  hoursLate: number | null;
  /** Hours until the deadline, only while it has not been reached. */
  hoursToDeadline: number | null;
}

const roundHours = (ms: number): number => Math.round((ms / HOUR_MS) * 10) / 10;

export function classifyCell(input: CellInput): CellResult {
  const { expected, covered, fullCoverageAtMs, weekStart, nowMs } = input;
  const deadline = deadlineMs(weekStart);
  const beforeDeadline = nowMs <= deadline;
  const toDeadline = beforeDeadline ? roundHours(deadline - nowMs) : null;

  if (expected > 0 && covered >= expected && fullCoverageAtMs !== null) {
    const late = fullCoverageAtMs - deadline;
    return late <= 0
      ? { status: 'uploaded', hoursLate: null, hoursToDeadline: null }
      : { status: 'delayed', hoursLate: roundHours(late), hoursToDeadline: null };
  }
  const overdue = beforeDeadline ? null : roundHours(nowMs - deadline);
  if (covered > 0) return { status: 'partial', hoursLate: overdue, hoursToDeadline: toDeadline };
  return beforeDeadline
    ? { status: 'due', hoursLate: null, hoursToDeadline: toDeadline }
    : { status: 'missing', hoursLate: overdue, hoursToDeadline: null };
}

export interface EscalationCandidate {
  key: string;
  weekStart: string;
  status: UploadStatus;
  sentStages: ReadonlySet<EscalationStage>;
}

export interface EscalationAction {
  key: string;
  stage: EscalationStage;
}

const INCOMPLETE: ReadonlySet<UploadStatus> = new Set(['due', 'partial', 'missing']);
const ACTIVE_STAGES = ['reminder', 'heads_up', 'missing', 'escalated'] as const;

/**
 * Which alert (at most one per cell) is owed right now.
 * An incomplete cell owes the highest stage whose trigger time has passed — earlier stages are
 * skipped rather than replayed, so switching the feature on mid-week sends one message per cell,
 * not four. A cell that became `delayed` after an overdue alert owes a single "uploaded late" note.
 */
export function planEscalations(cells: readonly EscalationCandidate[], nowMs: number): EscalationAction[] {
  const actions: EscalationAction[] = [];
  for (const cell of cells) {
    if (cell.status === 'delayed') {
      const alerted = cell.sentStages.has('missing') || cell.sentStages.has('escalated');
      if (alerted && !cell.sentStages.has('late_upload')) actions.push({ key: cell.key, stage: 'late_upload' });
      continue;
    }
    if (!INCOMPLETE.has(cell.status)) continue;
    const owed = [...ACTIVE_STAGES].reverse().find((stage) => stageTriggerMs(cell.weekStart, stage) <= nowMs);
    if (owed && !cell.sentStages.has(owed)) actions.push({ key: cell.key, stage: owed });
  }
  return actions;
}
