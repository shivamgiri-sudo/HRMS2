import type { StudioDefinition } from "@/hooks/useKpiStudio";

/**
 * Pure rules behind the Definitions list and the edit/copy flow.
 *
 * Kept free of React and of the query layer so the parts that decide what a person is told —
 * "this rule is current", "this is the version that applies" — can be tested directly.
 */

/** A list row. The server adds these three; older servers omit them, so all are optional. */
export type DefinitionRow = StudioDefinition & {
  grain?: string | null;
  in_force?: number | boolean | null;
  starts_later?: number | boolean | null;
};

export type DefinitionStatus = "current" | "scheduled" | "ended";

export interface DefinitionGroup {
  /** metric + scope. Two rows with the same key are versions of one rule. */
  key: string;
  /** The version to show on the row: the one in force today, else the newest. */
  current: DefinitionRow;
  /** Every version, newest first. Includes `current`. */
  versions: DefinitionRow[];
  /** Current if any version applies today, else scheduled if one starts later, else ended. */
  status: DefinitionStatus;
}

export type DraftMode = "edit" | "clone";

/** The builder's form values. Strings throughout, because that is what the inputs hold. */
export interface DraftValues {
  branch_id: string;
  process_id: string;
  designation_id: string;
  employee_id: string;
  metric_id: string;
  data_source_id: string;
  extra_source_ids: string[];
  grain: string;
  formula_expression: string;
  aggregation_method: string;
  target_value: string;
  min_threshold: string;
  weightage: string;
  max_achievement: string;
  scoring_type: string;
  effective_from: string;
  notes: string;
}

export interface DefinitionDraft {
  mode: DraftMode;
  source_definition_id: string;
  metric_name: string;
  /** Seeds the builder's employee search so an employee-scoped rule shows who it is for. */
  employee_search: string;
  /** False when the server did not say whether this is a per-person or per-process KPI. */
  grain_known: boolean;
  values: DraftValues;
}

export const MAX_RANGE_DAYS = 62;

const pad = (value: number) => String(value).padStart(2, "0");

/** Today as YYYY-MM-DD in the viewer's own calendar. toISOString would give the UTC day. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The YYYY-MM-DD part of a date string or ISO timestamp. Empty when there is none. */
export function datePart(value: string | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return todayLocal(value);
  const match = /^\d{4}-\d{2}-\d{2}/.exec(String(value));
  return match ? match[0] : "";
}

export function statusOf(
  definition: Pick<StudioDefinition, "effective_from" | "effective_to">,
  today: string = todayLocal(),
): DefinitionStatus {
  const from = datePart(definition.effective_from);
  const to = datePart(definition.effective_to);
  if (to && to < today) return "ended";
  if (from && from > today) return "scheduled";
  return "current";
}

function scopeKey(definition: StudioDefinition): string {
  return [
    definition.metric_id,
    definition.branch_id ?? "",
    definition.process_id ?? "",
    definition.designation_id ?? "",
    definition.employee_id ?? "",
  ].join("|");
}

export function groupVersions(definitions: readonly DefinitionRow[], today: string = todayLocal()): DefinitionGroup[] {
  const byKey = new Map<string, DefinitionRow[]>();
  for (const definition of definitions) {
    const key = scopeKey(definition);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(definition);
    else byKey.set(key, [definition]);
  }

  const groups: DefinitionGroup[] = [];
  for (const [key, bucket] of byKey) {
    const versions = [...bucket].sort((a, b) => {
      const byDate = datePart(b.effective_from).localeCompare(datePart(a.effective_from));
      return byDate !== 0 ? byDate : String(b.id).localeCompare(String(a.id));
    });
    const statuses = versions.map((version) => statusOf(version, today));
    const currentIndex = statuses.indexOf("current");
    groups.push({
      key,
      versions,
      current: versions[currentIndex >= 0 ? currentIndex : 0],
      status: currentIndex >= 0 ? "current" : statuses.includes("scheduled") ? "scheduled" : "ended",
    });
  }
  return groups;
}

/** DECIMAL columns arrive as "240.0000"; the form should show 240. */
function numberText(value: string | number | null | undefined, fallback = ""): string {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return String(Math.round(parsed * 10_000) / 10_000);
}

export function draftFrom(definition: DefinitionRow, mode: DraftMode, today: string = todayLocal()): DefinitionDraft {
  const keepScope = mode === "edit";
  return {
    mode,
    source_definition_id: definition.id,
    metric_name: definition.metric_name,
    employee_search: keepScope && definition.employee_id ? (definition.employee_code ?? "") : "",
    grain_known: Boolean(definition.grain),
    values: {
      branch_id: keepScope ? (definition.branch_id ?? "") : "",
      process_id: keepScope ? (definition.process_id ?? "") : "",
      designation_id: keepScope ? (definition.designation_id ?? "") : "",
      employee_id: keepScope ? (definition.employee_id ?? "") : "",
      metric_id: definition.metric_id,
      data_source_id: definition.data_source_id ?? "",
      extra_source_ids: (definition.extra_sources ?? []).map((source) => source.id),
      grain: definition.grain || "employee",
      formula_expression: definition.formula_expression ?? "",
      aggregation_method: definition.aggregation_method || "average",
      target_value: numberText(definition.target_value),
      min_threshold: numberText(definition.min_threshold),
      weightage: numberText(definition.weightage, "100"),
      max_achievement: numberText(definition.max_achievement, "120"),
      scoring_type: definition.scoring_type ?? "",
      // A new version always starts today: the server closes the old one the day before, so
      // days already scored keep the rule they were scored under.
      effective_from: today,
      notes: definition.notes ?? "",
    },
  };
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * The sentence to show a person when a request fails.
 *
 * The API client already lifts the server's `message` onto Error.message, so most of the work is
 * not losing it: strip a leading code, unwrap a JSON body that arrived as text, and never show
 * "[object Object]".
 */
export function friendlyError(error: unknown): string {
  let text = "";
  if (typeof error === "string") text = error;
  else if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string") text = candidate.message;
    else if (typeof candidate.error === "string") text = candidate.error;
  }
  text = text.trim();

  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
      if (typeof parsed.message === "string") text = parsed.message.trim();
      else if (typeof parsed.error === "string") text = parsed.error.trim();
    } catch {
      // Not JSON after all; keep the text as it is.
    }
  }

  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "OUT_OF_SCOPE" || text.includes("OUT_OF_SCOPE")) {
    const sentence = text.replace(/^\W*OUT_OF_SCOPE\W*/, "").trim();
    return sentence || "That is outside the processes you manage.";
  }
  return text || GENERIC_ERROR;
}

export function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/** Whole days from..to inclusive, or null when either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return null;
  const start = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const end = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Mirrors the server's range rules so a bad range is explained before anything is sent. */
export function validateRange(from: string, to: string, today: string = todayLocal()): { days: number; message: string | null } {
  const days = daysBetween(from, to);
  if (days === null) return { days: 0, message: "Choose a start date and an end date." };
  if (days < 1) return { days: 0, message: "The start date is after the end date." };
  if (to > today) return { days, message: "The end date is in the future. Choose today or earlier." };
  if (days > MAX_RANGE_DAYS) {
    return { days, message: `That is ${days} days. A range can cover at most ${MAX_RANGE_DAYS} days, so run it in parts.` };
  }
  return { days, message: null };
}
