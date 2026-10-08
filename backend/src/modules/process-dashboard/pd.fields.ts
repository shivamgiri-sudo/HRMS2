/**
 * Process Dashboard -- canonical APR fields, metric catalogue and per-category profiles (pure data, no DB).
 *
 * An APR table is whatever shape a client's sheet has; the admin maps ITS columns onto these canonical keys (column_map) and every
 * dashboard number is then computed from the canonical fields by pd.metrics.ts. A category is only a PROFILE: which KPI tiles and
 * table columns are shown, their direction, and which metric ranks agents. Targets are never defined here (see pd.config.service.ts).
 */

export const CATEGORIES = ["sales", "support_inbound", "outbound", "collections"] as const;
export type Category = (typeof CATEGORIES)[number];
export const ALL_CATEGORIES = [...CATEGORIES, "unconfigured"] as const;
export type CategoryOrUnconfigured = (typeof ALL_CATEGORIES)[number];

export const TIME_UNITS = ["sec", "day_fraction", "hhmmss"] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export type FieldKind = "text" | "date" | "count" | "time" | "money" | "hour";
export interface CanonicalField { key: string; label: string; kind: FieldKind; required: boolean; synonyms: string[] }

export const CANONICAL_FIELDS: CanonicalField[] = [
  { key: "agent_code", label: "Agent code", kind: "text", required: true, synonyms: ["agent_code", "agent_id", "emp_id", "employee_id", "employee_code", "emp_code", "empcode", "user_id", "userid", "agentid", "login_id", "mas_id"] },
  { key: "date", label: "Date", kind: "date", required: true, synonyms: ["date", "report_date", "call_date", "reportdate", "calldate", "day", "activity_date", "log_date", "work_date", "data_date"] },
  { key: "agent_name", label: "Agent name", kind: "text", required: false, synonyms: ["agent_name", "emp_name", "employee_name", "name", "agentname", "full_name"] },
  { key: "tl_name", label: "Team leader", kind: "text", required: false, synonyms: ["tl_name", "tl", "team_leader", "teamleader", "supervisor", "team_lead", "reporting_manager", "manager_name"] },
  { key: "lob", label: "LOB / campaign", kind: "text", required: false, synonyms: ["lob", "line_of_business", "campaign", "queue", "skill", "dashboard_label", "product", "team"] },
  { key: "calls", label: "Calls", kind: "count", required: false, synonyms: ["calls", "total_calls", "calls_chats", "calls_handled", "call_count", "dials", "total_dials", "calls_made", "chats"] },
  { key: "login_sec", label: "Login time", kind: "time", required: false, synonyms: ["login_sec", "login_seconds", "login_time_sec", "login_time", "logged_in_time", "login_duration", "staffed_time", "net_login_seconds", "actual_login_sec"] },
  { key: "talk_sec", label: "Talk time", kind: "time", required: false, synonyms: ["talk_sec", "talk_seconds", "talk_time", "talktime", "talk_duration"] },
  { key: "wait_sec", label: "Wait / idle time", kind: "time", required: false, synonyms: ["wait_sec", "wait_seconds", "wait_time", "idle_seconds", "idle_time", "ready_time", "waiting_time"] },
  { key: "dispo_sec", label: "Dispo / wrap-up time", kind: "time", required: false, synonyms: ["dispo_sec", "dispo_seconds", "dispo_time", "wrapup_seconds", "wrap_up_time", "acw", "after_call_work", "dispose_time"] },
  { key: "break_sec", label: "Break time", kind: "time", required: false, synonyms: ["break_sec", "break_seconds", "break_time", "total_break_sec", "pause_sec", "pause_time", "aux_time"] },
  { key: "connected", label: "Connected calls", kind: "count", required: false, synonyms: ["connected", "connects", "connected_calls", "contacts", "right_party_contact", "rpc", "answered", "total_contacts"] },
  { key: "ptp", label: "Promise to pay", kind: "count", required: false, synonyms: ["ptp", "ptp_count", "promise_to_pay", "promises", "total_promises"] },
  { key: "sales_count", label: "Sales", kind: "count", required: false, synonyms: ["sales_count", "sales", "sales_closed", "orders", "conversions", "bookings", "sale_count", "total_sales", "converted"] },
  { key: "amount", label: "Amount", kind: "money", required: false, synonyms: ["amount", "amt_collected", "amount_collected", "collection", "collected", "revenue", "sales_amount", "sale_value", "gmv", "order_value"] },
  { key: "handled", label: "Handled", kind: "count", required: false, synonyms: ["handled", "calls_handled", "answered_calls", "handled_calls", "acd_calls"] },
  { key: "offered", label: "Offered", kind: "count", required: false, synonyms: ["offered", "calls_offered", "total_offered", "received", "calls_received", "inbound_calls"] },
  { key: "abandoned", label: "Abandoned", kind: "count", required: false, synonyms: ["abandoned", "abandon", "abandoned_calls", "abandon_calls", "drop_calls", "dropped"] },
  { key: "hour", label: "Hour of day (optional, enables hourly view)", kind: "hour", required: false, synonyms: ["hour", "hr", "hour_of_day", "interval", "time_slot", "call_hour"] },
];
export const FIELD_KEYS = CANONICAL_FIELDS.map((f) => f.key);
export const REQUIRED_FIELDS = CANONICAL_FIELDS.filter((f) => f.required).map((f) => f.key);
export const TIME_FIELDS = CANONICAL_FIELDS.filter((f) => f.kind === "time").map((f) => f.key);
export const NUMERIC_FIELDS = CANONICAL_FIELDS.filter((f) => f.kind === "count" || f.kind === "money" || f.kind === "time").map((f) => f.key);
export const fieldKind = (key: string): FieldKind | undefined => CANONICAL_FIELDS.find((f) => f.key === key)?.kind;

export type MetricUnit = "count" | "percent" | "seconds" | "hours" | "currency" | "ratio";
export type Direction = "higher" | "lower";
export interface MetricDef {
  key: string; label: string; unit: MetricUnit; direction: Direction;
  /** Canonical fields that must ALL be mapped for this metric to exist (a missing one makes the metric null, never 0). */
  requires: string[];
  /** kpi_metric_master.metric_code whose kpi_master_config(process) target applies, for scale-free metrics only. */
  targetCode?: string;
}

export const METRICS: MetricDef[] = [
  { key: "calls", label: "Calls", unit: "count", direction: "higher", requires: ["calls"] },
  { key: "login_hours", label: "Login hours", unit: "hours", direction: "higher", requires: ["login_sec"] },
  { key: "handled", label: "Handled", unit: "count", direction: "higher", requires: ["handled"] },
  { key: "offered", label: "Offered", unit: "count", direction: "higher", requires: ["offered"] },
  { key: "abandoned", label: "Abandoned", unit: "count", direction: "lower", requires: ["abandoned"] },
  { key: "connected", label: "Connected", unit: "count", direction: "higher", requires: ["connected"] },
  { key: "ptp", label: "PTP", unit: "count", direction: "higher", requires: ["ptp"] },
  { key: "sales_count", label: "Sales", unit: "count", direction: "higher", requires: ["sales_count"] },
  { key: "amount", label: "Amount", unit: "currency", direction: "higher", requires: ["amount"] },
  { key: "utilization", label: "Utilization", unit: "percent", direction: "higher", requires: ["talk_sec", "wait_sec", "dispo_sec", "login_sec"], targetCode: "UTILIZATION" },
  { key: "occupancy", label: "Occupancy", unit: "percent", direction: "higher", requires: ["talk_sec", "wait_sec", "dispo_sec"] },
  { key: "aht", label: "AHT", unit: "seconds", direction: "lower", requires: ["talk_sec", "dispo_sec", "calls"], targetCode: "AHT" },
  { key: "calls_per_login_hr", label: "Calls / login hr", unit: "ratio", direction: "higher", requires: ["calls", "login_sec"] },
  { key: "connect_rate", label: "Connect rate", unit: "percent", direction: "higher", requires: ["connected", "calls"] },
  { key: "conversion", label: "Conversion", unit: "percent", direction: "higher", requires: ["sales_count"] /* + connected OR calls, see metricAvailable */ },
  { key: "ptp_rate", label: "PTP rate", unit: "percent", direction: "higher", requires: ["ptp", "connected"] },
  { key: "answer_rate", label: "Answer rate", unit: "percent", direction: "higher", requires: ["handled", "offered"] },
  { key: "abandon_rate", label: "Abandon rate", unit: "percent", direction: "lower", requires: ["abandoned", "offered"] },
  { key: "qa_score", label: "QA score", unit: "percent", direction: "higher", requires: [], targetCode: "QUALITY_SCORE" },
];
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const METRIC_KEYS = METRICS.map((m) => m.key);

export interface CategoryProfile {
  category: Category; label: string;
  /** KPI tiles, in display order. */
  kpis: string[];
  /** Agent / team table columns, in display order. */
  columns: string[];
  /** Metric that ranks agents and feeds top/bottom. */
  rankMetric: string;
}

export const PROFILES: Record<Category, CategoryProfile> = {
  sales: {
    category: "sales", label: "Sales", rankMetric: "sales_count",
    kpis: ["sales_count", "conversion", "calls", "aht", "utilization", "calls_per_login_hr", "amount", "qa_score"],
    columns: ["calls", "sales_count", "conversion", "aht", "utilization", "login_hours", "amount", "qa_score"],
  },
  support_inbound: {
    category: "support_inbound", label: "Support (inbound)", rankMetric: "calls",
    kpis: ["calls", "answer_rate", "abandon_rate", "aht", "utilization", "occupancy", "qa_score"],
    columns: ["calls", "handled", "offered", "answer_rate", "abandon_rate", "aht", "utilization", "occupancy", "login_hours", "qa_score"],
  },
  outbound: {
    category: "outbound", label: "Outbound", rankMetric: "calls",
    kpis: ["calls", "connect_rate", "conversion", "aht", "utilization", "calls_per_login_hr", "qa_score"],
    columns: ["calls", "connected", "connect_rate", "sales_count", "conversion", "aht", "utilization", "login_hours", "qa_score"],
  },
  collections: {
    category: "collections", label: "Collections", rankMetric: "amount",
    kpis: ["amount", "ptp", "ptp_rate", "connect_rate", "calls", "aht", "utilization", "qa_score"],
    columns: ["calls", "connected", "connect_rate", "ptp", "ptp_rate", "amount", "aht", "utilization", "login_hours", "qa_score"],
  },
};
export const profileFor = (c: string): CategoryProfile | null => (c in PROFILES ? PROFILES[c as Category] : null);

/** Columns that must never be mapped: personal / financial / credential data has no place on a productivity dashboard. */
export const SENSITIVE_COLUMN_RE = /(salary|ctc|\bpan\b|pan_no|aadhaar|aadhar|bank|account_no|acct_no|ifsc|password|passwd|token|secret|dob|birth|phone|mobile|msisdn|email|address|otp|api_key)/i;
/** mas_hrms tables that hold credentials / payroll and are never offered or accepted as an APR source. */
export const SENSITIVE_TABLE_RE = /(payroll|salary|password|token|secret|credential|session|otp|bank|statutory|gratuity|user_account|api_key|refresh)/i;
export const ALLOWED_SCHEMAS = ["db_masmis", "mas_hrms"] as const;
