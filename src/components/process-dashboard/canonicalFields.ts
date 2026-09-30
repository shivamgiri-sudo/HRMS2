/** Canonical APR fields an admin maps source columns onto (mirrors backend pd.fields.ts CANONICAL_FIELDS; required ones marked). */
export interface CanonicalField { key: string; label: string; required: boolean; time?: boolean; hint?: string }
export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "agent_code", label: "Agent code", required: true },
  { key: "date", label: "Date", required: true },
  { key: "agent_name", label: "Agent name", required: false },
  { key: "tl_name", label: "Team leader", required: false },
  { key: "lob", label: "LOB / campaign", required: false },
  { key: "calls", label: "Calls", required: false },
  { key: "login_sec", label: "Login time", required: false, time: true },
  { key: "talk_sec", label: "Talk time", required: false, time: true },
  { key: "wait_sec", label: "Wait / idle time", required: false, time: true },
  { key: "dispo_sec", label: "Dispo / wrap-up time", required: false, time: true },
  { key: "break_sec", label: "Break time", required: false, time: true },
  { key: "connected", label: "Connected calls", required: false },
  { key: "ptp", label: "Promise to pay", required: false },
  { key: "sales_count", label: "Sales", required: false },
  { key: "amount", label: "Amount", required: false },
  { key: "handled", label: "Handled", required: false },
  { key: "offered", label: "Offered", required: false },
  { key: "abandoned", label: "Abandoned", required: false },
  { key: "hour", label: "Hour of day (enables hourly view)", required: false },
];
export const CATEGORY_OPTIONS = [
  { value: "sales", label: "Sales" }, { value: "support_inbound", label: "Support / Inbound" },
  { value: "outbound", label: "Outbound" }, { value: "collections", label: "Collections" },
];
export const TIME_UNIT_OPTIONS = [
  { value: "sec", label: "Seconds (e.g. 3600)" }, { value: "day_fraction", label: "Day fraction (Excel duration, e.g. 0.0417)" },
  { value: "hhmmss", label: "Clock text (HH:MM:SS)" },
];
export const SOURCE_SCHEMAS = ["db_masmis", "mas_hrms"];

export interface SetupForm {
  processId: string; category: string; label: string; aprSchema: string; aprTable: string;
  columnMap: Record<string, string>; timeUnit: string; filterColumn: string; filterValue: string; refreshSeconds: number; enabled: boolean;
}
export const emptyForm = (processId = ""): SetupForm => ({ processId, category: "", label: "", aprSchema: SOURCE_SCHEMAS[0], aprTable: "", columnMap: {}, timeUnit: "sec", filterColumn: "", filterValue: "", refreshSeconds: 60, enabled: false });

/** Plain-language blocking/warning messages; empty array means the form can be saved. */
export function validateSetup(f: SetupForm): string[] {
  const errs: string[] = [];
  if (!f.processId) errs.push("Choose a process.");
  if (!f.category) errs.push("Choose a category: it decides which tiles and columns the dashboard shows.");
  if (!f.aprTable) errs.push("Choose the APR table that holds this process's daily agent data.");
  for (const c of CANONICAL_FIELDS) if (c.required && !f.columnMap[c.key]) errs.push(`Map a column to "${c.label}" (required).`);
  const used = new Map<string, string>();
  for (const [field, col] of Object.entries(f.columnMap)) {
    if (!col) continue;
    const prev = used.get(col);
    if (prev) errs.push(`Column "${col}" is mapped to both "${prev}" and "${field}". Each column can back only one field.`);
    used.set(col, field);
  }
  if (!!f.filterColumn !== !!f.filterValue.trim()) errs.push("Process filter needs both a column and a value, or neither.");
  if (!Number.isFinite(f.refreshSeconds) || f.refreshSeconds < 10 || f.refreshSeconds > 3600) errs.push("Refresh interval must be between 10 and 3600 seconds.");
  return errs;
}

/** Body sent to PUT /admin/configs/:processId and POST /admin/preview. Empty mappings are dropped. */
export function toConfigPayload(f: SetupForm) {
  return {
    processId: f.processId, category: f.category, label: f.label.trim() || null, aprSchema: f.aprSchema, aprTable: f.aprTable,
    columnMap: Object.fromEntries(Object.entries(f.columnMap).filter(([, v]) => v)), timeUnit: f.timeUnit,
    processFilter: f.filterColumn && f.filterValue.trim() ? { column: f.filterColumn, value: f.filterValue.trim() } : null,
    refreshSeconds: f.refreshSeconds, enabled: f.enabled,
  };
}
