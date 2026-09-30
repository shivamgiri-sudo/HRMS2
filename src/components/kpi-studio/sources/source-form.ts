/**
 * Pure rules for the Data Sources screen: which inputs apply to which kind of source, what the
 * server will accept, and how a field's row conditions are stored.
 *
 * Everything here mirrors backend/src/modules/kpi/kpi-studio.service.ts (saveDataSource,
 * saveSourceField), kpi-studio.gsheet.ts (validateSheetCsvUrl), kpi-studio.pools.ts (NAMED_POOLS)
 * and kpi-studio.sources.ts (DATE_FORMATS, compileFieldFilters). The server stays the authority;
 * these checks exist so a mistake is explained next to the input instead of after a round trip.
 * No React and no DOM, so it is unit-tested directly.
 */

export type SourceType =
  | "local_query"
  | "named_pool"
  | "integration_connector"
  | "google_sheet_csv"
  | "upload"
  | "manual";

export const SOURCE_TYPES: ReadonlyArray<{ value: SourceType; label: string; description: string }> = [
  {
    value: "local_query",
    label: "A table in this system",
    description: "Reads a table in the HRMS database itself, such as attendance or a synced daily report.",
  },
  {
    value: "named_pool",
    label: "One of our other databases",
    description: "Reads a table in a database this system already connects to, such as the dialer or MIS.",
  },
  {
    value: "integration_connector",
    label: "An external database",
    description: "Reads a table through a connection set up in the Integration Hub.",
  },
  {
    value: "google_sheet_csv",
    label: "A Google Sheet",
    description: "Reads a sheet that has been published to the web as CSV. Re-read on every calculation.",
  },
  {
    value: "upload",
    label: "Spreadsheet upload",
    description: "Figures are loaded by uploading a CSV or Excel file on this screen.",
  },
  {
    value: "manual",
    label: "Typed in by hand",
    description: "Figures are entered by a person, one value per employee per day, or uploaded.",
  },
];

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPES.find((entry) => entry.value === type)?.label ?? type;
}

/** Kept in step with NAMED_POOLS in kpi-studio.pools.ts; the key is what integration_key stores. */
export const NAMED_POOL_OPTIONS: ReadonlyArray<{ key: string; label: string; description: string }> = [
  { key: "dialer", label: "Dialer (dialer_db)", description: "Call detail and agent activity logs." },
  { key: "onfido", label: "Onfido (onfido_db)", description: "DOC and POA task, audit and escalation extracts." },
  { key: "bella", label: "Bella Vita (bella_db)", description: "Sales lines, lead allocation, target plan and cancellations." },
  { key: "apr", label: "APR productivity", description: "Agent productivity reports." },
  { key: "masmis", label: "MIS (db_masmis)", description: "Client operational exports: orders, chat tickets, allocations." },
];

/** Kept in step with DATE_FORMATS in kpi-studio.sources.ts. "" means a real date column. */
export const dateFormatOptions: ReadonlyArray<{ value: string; label: string; example: string }> = [
  { value: "%d-%m-%Y", label: "Day-Month-Year", example: "31-08-2026" },
  { value: "%d/%m/%Y", label: "Day/Month/Year", example: "31/08/2026" },
  { value: "%m/%d/%Y", label: "Month/Day/Year", example: "08/31/2026" },
  { value: "%Y-%m-%d", label: "Year-Month-Day", example: "2026-08-31" },
  { value: "%Y/%m/%d", label: "Year/Month/Day", example: "2026/08/31" },
  { value: "%d-%b-%Y", label: "Day-Mon-Year", example: "31-Aug-2026" },
  { value: "%d %b %Y", label: "Day Mon Year", example: "31 Aug 2026" },
  { value: "%Y-%m-%d %H:%i:%s", label: "Year-Month-Day with time", example: "2026-08-31 14:05:00" },
  { value: "%d-%m-%Y %H:%i:%s", label: "Day-Month-Year with time", example: "31-08-2026 14:05:00" },
  { value: "excel_serial", label: "Excel serial number", example: "46265" },
];

export type ProcessKeyKind = "none" | "constant" | "column" | "employee";

export const processKeyOptions: ReadonlyArray<{ value: ProcessKeyKind; label: string; explanation: string }> = [
  {
    value: "none",
    label: "Not tied to a process",
    explanation: "Figures are per employee only. This source cannot feed a process-level KPI.",
  },
  {
    value: "constant",
    label: "Every row belongs to one process",
    explanation: "The whole table is one client's data, so every row counts towards the process you pick.",
  },
  {
    value: "column",
    label: "A column says which process",
    explanation:
      "The table is shared. Only rows where the column holds the value you enter count towards the process you pick.",
  },
  {
    value: "employee",
    label: "Use each employee's own process",
    explanation:
      "Each row is matched to an employee, and counts towards whichever process that employee works in.",
  },
];

export interface SourceForm {
  id?: string;
  source_code: string;
  source_name: string;
  source_type: SourceType;
  integration_key: string;
  source_object: string;
  employee_key_column: string;
  employee_key_kind: string;
  date_column: string;
  date_format: string;
  description: string;
  csv_url: string;
  sheet_tab: string;
  process_key_kind: ProcessKeyKind;
  process_key_column: string;
  process_key_value: string;
  process_id: string;
}

export const emptySourceForm: SourceForm = {
  source_code: "",
  source_name: "",
  source_type: "local_query",
  integration_key: "",
  source_object: "",
  employee_key_column: "",
  employee_key_kind: "employee_code",
  date_column: "",
  date_format: "",
  description: "",
  csv_url: "",
  sheet_tab: "",
  process_key_kind: "none",
  process_key_column: "",
  process_key_value: "",
  process_id: "",
};

export function codeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(?=[0-9])/, "S_")
    .slice(0, 60);
}

/** Turns a stored source back into an editable form. config_json may arrive parsed or as text. */
export function formFromSource(source: Record<string, unknown>): SourceForm {
  const text = (key: string) => (source[key] === null || source[key] === undefined ? "" : String(source[key]));
  let config: Record<string, unknown> = {};
  const rawConfig = source.config_json;
  if (rawConfig && typeof rawConfig === "object") config = rawConfig as Record<string, unknown>;
  else if (typeof rawConfig === "string" && rawConfig.trim()) {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      if (parsed && typeof parsed === "object") config = parsed as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const kind = text("process_key_kind");
  return {
    id: text("id") || undefined,
    source_code: text("source_code"),
    source_name: text("source_name"),
    source_type: (SOURCE_TYPES.some((entry) => entry.value === source.source_type)
      ? source.source_type
      : "local_query") as SourceType,
    integration_key: text("integration_key"),
    source_object: text("source_object"),
    employee_key_column: text("employee_key_column"),
    employee_key_kind: text("employee_key_kind") || "employee_code",
    date_column: text("date_column"),
    date_format: text("date_format"),
    description: text("description"),
    csv_url: typeof config.csv_url === "string" ? config.csv_url : "",
    sheet_tab: typeof config.tab === "string" ? config.tab : "",
    process_key_kind: (processKeyOptions.some((option) => option.value === kind) ? kind : "none") as ProcessKeyKind,
    process_key_column: text("process_key_column"),
    process_key_value: text("process_key_value"),
    process_id: text("process_id"),
  };
}

export interface SourceFieldVisibility {
  /** Integration Hub key (integration_connector). */
  integrationKey: boolean;
  /** Pick one of the databases this system already connects to (named_pool). */
  namedPool: boolean;
  /** Table name. */
  table: boolean;
  /** Published CSV link and tab (google_sheet_csv). */
  sheet: boolean;
  /** Employee and date columns. For a sheet these are column headings, and both are required. */
  rowColumns: boolean;
  /** Text-date format: only a database table can have a date stored as text to parse. */
  dateFormat: boolean;
  /** Process-key settings: only meaningful where rows are read from a table. */
  processKey: boolean;
}

export function fieldsForType(type: string): SourceFieldVisibility {
  const table = type === "local_query" || type === "named_pool" || type === "integration_connector";
  const sheet = type === "google_sheet_csv";
  return {
    integrationKey: type === "integration_connector",
    namedPool: type === "named_pool",
    table,
    sheet,
    rowColumns: table || sheet,
    dateFormat: table,
    processKey: table,
  };
}

const SHEET_HOSTS = ["docs.google.com", "spreadsheets.google.com"];

/** Same checks, in the same order, as validateSheetCsvUrl on the server. Null means acceptable. */
export function checkSheetCsvUrl(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "Paste the published CSV link for the sheet.";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "That is not a valid link.";
  }
  if (url.protocol !== "https:") return "The link must start with https://";
  if (url.username || url.password) return "The link must not contain a username or password.";
  const host = url.hostname.toLowerCase();
  if (!SHEET_HOSTS.includes(host) && !host.endsWith(".googleusercontent.com")) {
    return `Only published Google Sheets links are accepted (${SHEET_HOSTS.join(", ")}). This one points at "${url.hostname}".`;
  }
  const published =
    url.pathname.includes("/pub") || url.searchParams.get("output") === "csv" || url.pathname.endsWith("/export");
  if (!published) {
    return (
      "That looks like a normal sheet link, not a published one. In the sheet use File > Share > Publish to web, " +
      'choose the tab, pick "Comma-separated values (.csv)", then paste the link it gives you.'
    );
  }
  return null;
}

export interface SourceFormContext {
  /** Whether the database can store these settings; when false they are neither checked nor sent. */
  processGrain?: boolean;
  dateFormat?: boolean;
}

/**
 * Problems that would stop the save, in plain words. Empty means ready to save.
 *
 * Two checks are stricter than the server on purpose (the server stores the source, and it then
 * reads nothing): a table-backed source needs a table, and "a column says which process" needs the
 * value to match.
 */
export function validateSource(form: SourceForm, context: SourceFormContext = {}): string[] {
  const problems: string[] = [];
  const show = fieldsForType(form.source_type);

  if (!form.source_name.trim()) problems.push("Give the source a name.");
  if (!/^[A-Z][A-Z0-9_]*$/.test(form.source_code.trim().toUpperCase())) {
    problems.push("The code must start with a letter and use only letters, numbers and underscores.");
  }
  if (!SOURCE_TYPES.some((entry) => entry.value === form.source_type)) {
    problems.push("Choose what kind of source this is.");
  }

  if (show.integrationKey && !form.integration_key.trim()) {
    problems.push("Enter the Integration Hub key of the external system this reads.");
  }
  if (show.namedPool) {
    if (!form.integration_key.trim()) problems.push("Pick which database this source reads.");
    else if (!NAMED_POOL_OPTIONS.some((pool) => pool.key === form.integration_key.trim())) {
      problems.push(`"${form.integration_key.trim()}" is not a database this system knows.`);
    }
  }
  if (show.table && !form.source_object.trim()) problems.push("Enter the name of the table to read.");

  if (show.sheet) {
    const urlProblem = checkSheetCsvUrl(form.csv_url);
    if (urlProblem) problems.push(urlProblem);
    if (!form.employee_key_column.trim()) problems.push("Say which column heading in the sheet holds the employee code.");
    if (!form.date_column.trim()) problems.push("Say which column heading in the sheet holds the date.");
  }

  if (context.dateFormat !== false && show.dateFormat && form.date_format) {
    if (!dateFormatOptions.some((option) => option.value === form.date_format)) {
      problems.push(`"${form.date_format}" is not a date format this can read.`);
    }
  }

  if (context.processGrain !== false && show.processKey && form.process_key_kind !== "none") {
    if (!form.process_id) problems.push("Pick the process this source belongs to.");
    if (form.process_key_kind === "column") {
      if (!form.process_key_column.trim()) problems.push("Name the column that says which process a row belongs to.");
      if (!form.process_key_value.trim()) problems.push("Enter the value that column holds for this process.");
    }
    if (form.process_key_kind === "employee") {
      if (form.source_type === "integration_connector") {
        problems.push(
          "Using each employee's own process only works for a table inside this system. " +
            "For an external database, choose one process or a column instead.",
        );
      }
      if (!form.employee_key_column.trim()) {
        problems.push("Name the column that holds the employee, so their process can be looked up.");
      }
    }
  }
  return problems;
}

/**
 * The body for POST /api/kpi-studio/data-sources. Inputs that do not apply to the chosen type are
 * sent as null so switching type while editing cannot leave a stale table or key behind.
 */
export function toSourcePayload(form: SourceForm, context: SourceFormContext = {}): Record<string, unknown> {
  const show = fieldsForType(form.source_type);
  const value = (text: string, applies: boolean) => (applies ? text.trim() || null : null);
  const payload: Record<string, unknown> = {
    source_code: form.source_code.trim().toUpperCase(),
    source_name: form.source_name.trim(),
    source_type: form.source_type,
    integration_key: value(form.integration_key, show.integrationKey || show.namedPool),
    source_object: value(form.source_object, show.table),
    employee_key_column: value(form.employee_key_column, show.rowColumns),
    employee_key_kind: form.employee_key_kind || "employee_code",
    date_column: value(form.date_column, show.rowColumns),
    description: form.description.trim() || null,
  };
  if (form.id) payload.id = form.id;
  if (show.sheet) {
    payload.csv_url = form.csv_url.trim();
    payload.sheet_tab = form.sheet_tab.trim() || null;
  }
  // Hidden settings are cleared on a new source (a leftover from switching type) but kept on an
  // edit: a source configured outside this screen must not lose a setting just by being renamed.
  const keepHidden = Boolean(form.id);
  if (context.dateFormat !== false) payload.date_format = value(form.date_format, show.dateFormat || keepHidden);
  if (context.processGrain !== false) {
    const kind = show.processKey || keepHidden ? form.process_key_kind : "none";
    payload.process_key_kind = kind;
    payload.process_key_column = kind === "column" ? form.process_key_column.trim() || null : null;
    payload.process_key_value = kind === "column" ? form.process_key_value.trim() || null : null;
    payload.process_id = kind === "none" ? null : form.process_id || null;
  }
  return payload;
}

// Field filters, field checks and server-error wording live next door to keep this file short.
export * from "./field-form";
