/**
 * Pure helpers for the Audit Sampling page (DOC Check internal + POA). No DB access.
 * Sampling % = Audits / Tasks Received; Error % = Errors / Audits.
 */

export type AuditQueue = "DOC" | "POA";

export interface TaskCountRow {
  client: string;
  documentType: string;
  taskType: string;
  tasks: number;
}
export interface AuditCountRow {
  client: string;
  documentType: string;
  taskType: string;
  audits: number;
  errors: number;
}

export interface AuditSamplingRow {
  queue: AuditQueue;
  client: string;
  documentType: string;
  taskType: string;
  tasksReceived: number;
  audits: number;
  samplingPct: number | null;
  errors: number;
  errPct: number | null;
}

export interface AuditPeriodRow {
  queue: AuditQueue;
  period: string;
  tasksReceived: number;
  audits: number;
  samplingPct: number | null;
  errors: number;
  errPct: number | null;
}

export interface TaskTypeSamplingRow {
  taskType: string;
  tasksReceived: number;
  audits: number;
  samplingPct: number | null;
  errors: number;
  errPct: number | null;
}

export const UNKNOWN_LABEL = "(unknown)";

export const pct1 = (num: number, den: number): number | null =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;

/** Case/whitespace-insensitive identity so "ACME ltd " from one file matches "Acme Ltd" from another. */
export function normKey(s: string | null | undefined): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function isBlankLabel(s: string | null | undefined): boolean {
  const k = normKey(s);
  return k === "" || k === UNKNOWN_LABEL || k === "(blank)" || k === "blank" || k === "null" || k === "(unassigned)";
}

const labelOrUnknown = (s: string | null | undefined): string => (isBlankLabel(s) ? UNKNOWN_LABEL : String(s).trim());

/**
 * Outer-merge tasks-received rows with audit rows on client x document type x task type
 * (normalised keys). Display label is the first non-blank spelling seen, tasks side first.
 */
export function mergeSampling(
  queue: AuditQueue,
  tasks: TaskCountRow[],
  audits: AuditCountRow[],
): AuditSamplingRow[] {
  type Acc = {
    client: string;
    documentType: string;
    taskType: string;
    tasks: number;
    audits: number;
    errors: number;
  };
  const m = new Map<string, Acc>();
  const touch = (c: string, d: string, t: string): Acc => {
    const key = `${normKey(c)}|${normKey(d)}|${normKey(t)}`;
    let e = m.get(key);
    if (!e) {
      e = { client: labelOrUnknown(c), documentType: labelOrUnknown(d), taskType: labelOrUnknown(t), tasks: 0, audits: 0, errors: 0 };
      m.set(key, e);
    }
    return e;
  };
  for (const r of tasks) touch(r.client, r.documentType, r.taskType).tasks += r.tasks;
  for (const r of audits) {
    const e = touch(r.client, r.documentType, r.taskType);
    e.audits += r.audits;
    e.errors += r.errors;
  }
  return [...m.values()]
    .filter((e) => e.tasks > 0 || e.audits > 0)
    .map((e) => ({
      queue,
      client: e.client,
      documentType: e.documentType,
      taskType: e.taskType,
      tasksReceived: e.tasks,
      audits: e.audits,
      samplingPct: pct1(e.audits, e.tasks),
      errors: e.errors,
      errPct: pct1(e.errors, e.audits),
    }))
    .sort(
      (a, b) =>
        b.tasksReceived - a.tasksReceived ||
        b.audits - a.audits ||
        a.client.localeCompare(b.client) ||
        a.documentType.localeCompare(b.documentType),
    );
}

/**
 * Task-type-wise analysis for DOC Check. Only *valid source* task types are shown: a task type must
 * be non-blank and have received tasks in the period (a type that only shows up on audit rows has no
 * source tasks, i.e. is obsolete/unmapped). Rows are summed across client x document type.
 */
export function buildTaskTypeRows(rows: AuditSamplingRow[]): TaskTypeSamplingRow[] {
  const m = new Map<string, { label: string; tasks: number; audits: number; errors: number }>();
  for (const r of rows) {
    if (isBlankLabel(r.taskType)) continue;
    const key = normKey(r.taskType);
    const e = m.get(key) ?? { label: r.taskType, tasks: 0, audits: 0, errors: 0 };
    e.tasks += r.tasksReceived;
    e.audits += r.audits;
    e.errors += r.errors;
    m.set(key, e);
  }
  return [...m.values()]
    .filter((e) => e.tasks > 0)
    .map((e) => ({
      taskType: e.label,
      tasksReceived: e.tasks,
      audits: e.audits,
      samplingPct: pct1(e.audits, e.tasks),
      errors: e.errors,
      errPct: pct1(e.errors, e.audits),
    }))
    .sort((a, b) => b.tasksReceived - a.tasksReceived || a.taskType.localeCompare(b.taskType));
}

/** DOC Check rows with a blank/unmapped task type cannot be traced to a source task type. */
export function splitUntraceableDoc(rows: AuditSamplingRow[]): {
  kept: AuditSamplingRow[];
  droppedAudits: number;
} {
  const kept: AuditSamplingRow[] = [];
  let droppedAudits = 0;
  for (const r of rows) {
    if (isBlankLabel(r.taskType)) droppedAudits += r.audits;
    else kept.push(r);
  }
  return { kept, droppedAudits };
}

export function mergePeriods(
  queue: AuditQueue,
  tasks: { period: string; tasks: number }[],
  audits: { period: string; audits: number; errors: number }[],
): AuditPeriodRow[] {
  const m = new Map<string, { tasks: number; audits: number; errors: number }>();
  const get = (p: string) => {
    let e = m.get(p);
    if (!e) {
      e = { tasks: 0, audits: 0, errors: 0 };
      m.set(p, e);
    }
    return e;
  };
  for (const t of tasks) get(t.period).tasks += t.tasks;
  for (const a of audits) {
    const e = get(a.period);
    e.audits += a.audits;
    e.errors += a.errors;
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, e]) => ({
      queue,
      period,
      tasksReceived: e.tasks,
      audits: e.audits,
      samplingPct: pct1(e.audits, e.tasks),
      errors: e.errors,
      errPct: pct1(e.errors, e.audits),
    }));
}
