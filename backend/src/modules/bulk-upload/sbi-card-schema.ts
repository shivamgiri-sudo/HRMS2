/**
 * SBI Card Collections -- column specs shared by the five importers, the migration's upload_template_master rows and the tests.
 * (header as it appears in the client's workbook -> mas_hrms column). Headers match case/space/punctuation-insensitively.
 */
export type SbiKind = "int" | "dec";
export interface SbiCol { header: string; col: string; kind: SbiKind }

const C = (header: string, col: string, kind: SbiKind = "int"): SbiCol => ({ header, col, kind });

/** Campaign-level daily MIS ("DIALER MIS" sheets). Header row is row 2 of each sheet. */
export const SBI_DIALER_COLS: SbiCol[] = [
  C("Total Accounts", "total_accounts"), C("Accounts Excluded", "accounts_excluded"), C("Accounts Scheduled", "accounts_scheduled"),
  C("Accounts Called", "accounts_called"), C("Dials", "dials"), C("Actual Dialer Dials", "actual_dialer_dials"),
  C("Answers", "answers"), C("Connects", "connects"), C("Make Calls", "make_calls"), C("Aborts", "aborts"), C("DROP", "drop_calls"),
  C("PTP", "ptp"), C("PAD", "pad"), C("OTP", "otp"), C("DISP", "disp"), C("WN", "wn"), C("NC", "nc"), C("AU", "au"),
  C("VOML", "voml"), C("CT", "ct"), C("TC", "tc"), C("EWS", "ews"), C("WS", "ws"), C("DS", "ds"), C("BCTP", "bctp"),
  C("DPTP", "dptp"), C("WH", "wh"), C("LB", "lb"), C("TCBL", "tcbl"), C("TPC", "tpc"), C("RTP", "rtp"), C("CBL", "cbl"),
  C("TOTAL CALLS", "total_calls"), C("TOTAL Contacts", "total_contacts"), C("TOTAL Promises", "total_promises"),
  C("Count Of Agents", "agent_count"), C("Cur_Bal", "cur_bal", "dec"), C("PTP Value", "ptp_value", "dec"),
  C("Total PTP Value", "total_ptp_value", "dec"), C("Agent Hours", "agent_hours", "dec"),
];

export const SBI_DIALER_HEADERS = ["Date", "Campaign", ...SBI_DIALER_COLS.map((c) => c.header)] as const;

/** Agent MIS numeric columns (per agent per day). */
export const SBI_AGENT_COLS: SbiCol[] = [
  C("Calls", "calls"), C("AOD Calls", "aod_calls"), C("ACD Calls", "acd_calls"), C("Transfered Calls", "transferred_calls"),
  C("Manual Calls", "manual_calls"), C("ACW Active count", "acw_active_count"), C("Contacts", "contacts"), C("PTP", "ptp"),
  C("PAD", "pad"), C("Total Promises", "total_promises"), C("No Promise", "no_promise"),
  C("Amt collected PP", "amt_collected_pp", "dec"), C("Amt collected PU", "amt_collected_pu", "dec"), C("Amt collected", "amt_collected", "dec"),
  C("TOS", "tos_hours", "dec"), C("Talk", "talk_hours", "dec"), C("Wrap", "wrap_hours", "dec"), C("Idle", "idle_hours", "dec"),
];
export const SBI_AGENT_HEADERS = [
  "Employee ID", "DIALER ID", "Name", "TEAM", "TEAM LEADER", "Date", "First Login Time", "Target Time", "Last Logout Time",
  "Leakage Of Day", ...SBI_AGENT_COLS.map((c) => c.header),
] as const;

/**
 * Account-level dialer export. Only the columns the dashboard or an audit needs are kept -- customer name (EMBO_NAME), employer /
 * residence / additional phone numbers and the per-call history are deliberately NOT stored. MOBILE_NO is kept as given.
 */
export const SBI_ACCOUNT_HEADERS = [
  "ACCOUNT_NO", "Report Date", "BILLING_CYCLE", "DELQ1", "CIBIL_SCORE", "CREDIT_LIMIT", "CUR_BAL", "CUR_BAL_PLUS_DPI",
  "TOTAL_AMOUNT_DUE", "TOTAL_CUR_DUE", "DATE_LAST_PMT", "LAST_ACTION_CODE", "LAST_PTP_DATE", "MOBILE_NO", "VINTAGE", "REGION",
  "AGENCY_NAME", "CALL_TABLE_NAME", "DIAL_CNT",
] as const;

export const SBI_DOWNTIME_HEADERS = [
  "Date", "Start Time", "Up Time", "Downtime Minutes", "Total Impacted Users", "Responsibility",
  "Downtime Description/ Issue Reason", "Site", "Status", "RCA (If Any)", "Remarks",
] as const;

export const SBI_PEN_HEADERS = [
  "CALL TABLES", "Report Date", "Download", "Penetration", "Dials Required", "DPH", "Present Agents (Nos.)", "Actual Rostered Count",
  "Actual Present Agent Hrs.", "Dials", "Estimated PEN", "Target Penetration", "Required Agent Hrs.", "Excess/Deficit Agent Hrs.",
] as const;

/**
 * Campaign sheets that are rollups of the real campaigns ("Master", "Overall Low Bal", "Overall with PTP" ...). They are stored
 * (is_rollup = 1) but never summed into dashboard totals, or every account would be counted twice.
 */
export function isRollupCampaign(campaign: string): boolean {
  const n = campaign.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return n === "master" || n.startsWith("overall") || n === "total" || n === "grand total";
}
