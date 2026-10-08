/**
 * Pure rules for a source's fields: the row conditions stored in filter_json, the field checks
 * that mirror saveSourceField, and turning a refused save into a sentence. Re-exported from
 * source-form.ts, which is where callers import it from.
 */

// ─── Field filters ───────────────────────────────────────────────────────────────────────────

export type FilterOp =
  | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in"
  | "is_null" | "is_not_null" | "is_blank" | "is_not_blank";

/** `phrase` completes "<column> <phrase> <value>" in the sentence shown under the editor. */
export const FILTER_OPS: ReadonlyArray<{ value: FilterOp; label: string; phrase: string; needsValue: boolean }> = [
  { value: "eq", label: "is", phrase: "is", needsValue: true },
  { value: "ne", label: "is not", phrase: "is not", needsValue: true },
  { value: "gt", label: "is more than", phrase: "is more than", needsValue: true },
  { value: "gte", label: "is at least", phrase: "is at least", needsValue: true },
  { value: "lt", label: "is less than", phrase: "is less than", needsValue: true },
  { value: "lte", label: "is at most", phrase: "is at most", needsValue: true },
  { value: "in", label: "is one of", phrase: "is one of", needsValue: true },
  { value: "is_null", label: "has no value (NULL)", phrase: "has no value", needsValue: false },
  { value: "is_not_null", label: "has a value (not NULL)", phrase: "has a value", needsValue: false },
  { value: "is_blank", label: "is empty text", phrase: "is empty or missing", needsValue: false },
  { value: "is_not_blank", label: "has some text", phrase: "has some text in it", needsValue: false },
];

/** One editable condition. For "is one of" the value is a comma-separated list. */
export interface FilterRow {
  column: string;
  op: FilterOp;
  value: string;
}

export interface StoredFilter {
  column: string;
  op: FilterOp;
  value: string | string[] | null;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const opInfo = (op: string) => FILTER_OPS.find((entry) => entry.value === op);
const splitList = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);

/** Reads stored filter_json (text, or already parsed) into editable rows. Unreadable input gives no rows. */
export function parseFilter(json: unknown): FilterRow[] {
  let parsed: unknown = json;
  if (typeof json === "string") {
    if (!json.trim()) return [];
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      column: String(entry.column ?? ""),
      op: (opInfo(String(entry.op)) ? String(entry.op) : "eq") as FilterOp,
      value: Array.isArray(entry.value)
        ? entry.value.map(String).join(", ")
        : entry.value === null || entry.value === undefined
          ? ""
          : String(entry.value),
    }));
}

/**
 * The exact shape the server stores: a list of { column, op, value } where value is a list of
 * strings for "in", null for the four no-value operators, and a string otherwise. Every condition
 * must hold (they are joined with AND).
 */
export function filterToJson(rows: readonly FilterRow[]): StoredFilter[] {
  return rows.map((row) => ({
    column: row.column.trim(),
    op: row.op,
    value: row.op === "in" ? splitList(row.value) : opInfo(row.op)?.needsValue ? row.value.trim() : null,
  }));
}

export function validateFilterRows(rows: readonly FilterRow[]): string[] {
  const problems: string[] = [];
  rows.forEach((row, index) => {
    const where = `Condition ${index + 1}`;
    const info = opInfo(row.op);
    if (!row.column.trim()) problems.push(`${where}: choose a column.`);
    else if (!IDENTIFIER.test(row.column.trim())) {
      problems.push(`${where}: "${row.column.trim()}" is not a valid column name (letters, numbers and underscores only).`);
    }
    if (!info) problems.push(`${where}: choose how to compare.`);
    else if (info.needsValue && (row.op === "in" ? splitList(row.value).length === 0 : !row.value.trim())) {
      problems.push(`${where}: enter ${row.op === "in" ? "at least one value, separated by commas" : "a value"}.`);
    }
  });
  return problems;
}

/** "Counts only rows where status is 'answered' and queue is one of 'a', 'b'." */
export function describeFilterRows(rows: readonly FilterRow[]): string {
  const parts = rows
    .filter((row) => row.column.trim())
    .map((row) => {
      const info = opInfo(row.op);
      if (!info) return row.column.trim();
      if (!info.needsValue) return `${row.column.trim()} ${info.phrase}`;
      const values = row.op === "in" ? splitList(row.value) : [row.value.trim()];
      const shown = values.filter(Boolean).map((value) => `"${value}"`).join(" or ") || "…";
      return `${row.column.trim()} ${info.phrase} ${shown}`;
    });
  if (!parts.length) return "No conditions, so this field counts every row.";
  return `Counts only rows where ${parts.join(" and ")}.`;
}

// ─── Fields ──────────────────────────────────────────────────────────────────────────────────

export const AGGREGATES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "SUM", label: "Add them up (SUM)" },
  { value: "AVG", label: "Average them (AVG)" },
  { value: "COUNT", label: "Count the rows (COUNT)" },
  { value: "MIN", label: "Smallest value (MIN)" },
  { value: "MAX", label: "Largest value (MAX)" },
  { value: "NONE", label: "Take the value as-is" },
];

export interface FieldDraft {
  id?: string;
  field_name: string;
  display_name: string;
  source_column: string;
  aggregate_fn: string;
  unit: string;
  description: string;
}

export const emptyFieldDraft: FieldDraft = {
  field_name: "",
  display_name: "",
  source_column: "",
  aggregate_fn: "SUM",
  unit: "",
  description: "",
};

/** Mirrors saveSourceField. `fileBacked` sources have no column to read, so none of that applies. */
export function validateField(draft: FieldDraft, rows: readonly FilterRow[], fileBacked: boolean): string[] {
  const problems: string[] = [];
  if (!IDENTIFIER.test(draft.field_name.trim())) {
    problems.push(
      "The field name must start with a letter or underscore and use only letters, numbers and underscores, " +
        "because it is what you type in a formula.",
    );
  }
  if (fileBacked) return problems;
  const column = draft.source_column.trim();
  if (column && !IDENTIFIER.test(column)) problems.push(`"${column}" is not a valid column name.`);
  if (rows.length) {
    if (!column) problems.push("Conditions need a column to count. Pick the column first.");
    if (draft.aggregate_fn === "NONE") {
      problems.push('Conditions cannot be used with "Take the value as-is". Choose a way to combine the rows.');
    }
    problems.push(...validateFilterRows(rows));
  }
  return problems;
}

// ─── Server errors ───────────────────────────────────────────────────────────────────────────

/**
 * Turns a failed save into a sentence. The API answers 400 with a message written for the person
 * who made the mistake, and 403 { code: "OUT_OF_SCOPE" } when the source is mapped to a process
 * the caller does not look after.
 */
export function describeSaveError(error: unknown, fallback = "Could not save. Please try again."): string {
  const info = (error ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  const message = typeof info.message === "string" && info.message.trim() ? info.message.trim() : "";
  if (info.code === "OUT_OF_SCOPE") {
    return `You can only set up data for processes you look after.${message ? ` ${message}` : ""}`;
  }
  if (info.status === 403) return "You do not have permission to change data sources.";
  if (info.status === 503) return message || "KPI Studio is not fully installed on this server yet.";
  return message || fallback;
}
