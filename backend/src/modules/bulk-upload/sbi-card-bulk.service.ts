import { randomUUID } from "crypto";
import { runSbiBatch, type SbiBatchSpec } from "./sbi-card-batch-runner.js";
import {
  SBI_DIALER_COLS, SBI_DIALER_HEADERS, SBI_AGENT_COLS, SBI_AGENT_HEADERS, SBI_ACCOUNT_HEADERS, SBI_DOWNTIME_HEADERS,
  SBI_PEN_HEADERS, isRollupCampaign,
} from "./sbi-card-schema.js";
import {
  cleanText, cleanTeam, cleanId, coerceCol, decOrNull, intOrNull, parseSbiDate, parseSbiTime, parseSeconds,
  parseDowntimeMinutes, dateFromCallTable,
} from "./sbi-card-import-helpers.js";
import { refreshSbiKpiFromAgentMis, refreshSbiKpiFromDialerMis } from "../process-performance/sbi-card-kpi-sync.js";

/**
 * SBI Card Collections importers (process_master 'SBI Card Collections', code SBI_CARD). Each is an upsert on its table's natural key
 * (see sql/1932), so re-uploading a sheet refreshes rather than duplicates. No phone number or account number is ever logged.
 */

const TAIL = ["data_source", "source_reference", "created_by"];
const tail = (batchId: string, userId: string): unknown[] => ["bulk_upload", batchId, userId];
const dateOfSecond = (v: unknown[]): string | null => (typeof v[0] === "string" ? (v[0] as string) : null);

const HEADLINE_COLS = ["Total Accounts", "Accounts Called", "Dials", "Answers", "Connects", "TOTAL Contacts"];

/** Campaign-level daily MIS. Campaign = the workbook sheet name, injected by the uploader as a "Campaign" column. */
export const dialerMisSpec: SbiBatchSpec = {
  table: "sbi_card_dialer_mis",
  columns: ["id", "process_id", "report_date", "campaign", "is_rollup", ...SBI_DIALER_COLS.map((c) => c.col), ...TAIL],
  updateColumns: ["is_rollup", ...SBI_DIALER_COLS.map((c) => c.col)],
  headers: SBI_DIALER_HEADERS,
  dateOf: dateOfSecond,
  afterImport: refreshSbiKpiFromDialerMis,
  mapRow(data, _rowNo, ctx) {
    const date = parseSbiDate(data["Date"]);
    // "Average" / "Total" footer rows, blank day-counter rows (1900-01-xx) and the title row have no real date.
    if (!date) return { skip: true };
    const campaign = cleanText(data["Campaign"]);
    if (!campaign) return { error: 'a "Campaign" value is required (the uploader adds it from the chosen sheet name)' };
    const nums = SBI_DIALER_COLS.map((c) => coerceCol(c, data[c.header]));
    // A future / unfilled day in the workbook is all blanks, not zeros: nothing to store. Judged on the headline volume columns only:
    // an empty campaign-day still carries stray formula cells (e.g. VOML = 0), which must not create a zero "day" for the campaign.
    if (HEADLINE_COLS.every((h) => coerceCol(SBI_DIALER_COLS.find((c) => c.header === h)!, data[h]) === null)) return { skip: true };
    return { values: [date, campaign.slice(0, 100), isRollupCampaign(campaign) ? 1 : 0, ...nums, ...tail(ctx.batchId, ctx.userId)] };
  },
};

const AGENT_TIMES = ["First Login Time", "Target Time", "Last Logout Time"] as const;

export const agentMisSpec: SbiBatchSpec = {
  table: "sbi_card_agent_mis",
  columns: [
    "id", "process_id", "report_date", "employee_id", "dialer_id", "agent_name", "team", "team_leader",
    "first_login_time", "target_time", "last_logout_time", "leakage_seconds", ...SBI_AGENT_COLS.map((c) => c.col), ...TAIL,
  ],
  updateColumns: [
    "dialer_id", "agent_name", "team", "team_leader", "first_login_time", "target_time", "last_logout_time", "leakage_seconds",
    ...SBI_AGENT_COLS.map((c) => c.col),
  ],
  headers: SBI_AGENT_HEADERS,
  dateOf: dateOfSecond,
  afterImport: refreshSbiKpiFromAgentMis,
  mapRow(data, _rowNo, ctx) {
    const employeeId = cleanId(data["Employee ID"]);
    const date = parseSbiDate(data["Date"]);
    if (!employeeId && !date) return { skip: true }; // the sample sheet is mostly blank formula rows
    if (!employeeId || !date) return { error: 'both "Employee ID" and a readable "Date" are required -- together they are this row\'s identity' };
    const [first, target, last] = AGENT_TIMES.map((h) => parseSbiTime(data[h]));
    return {
      values: [
        date, employeeId.slice(0, 30), cleanId(data["DIALER ID"])?.slice(0, 30) ?? null, cleanText(data["Name"])?.slice(0, 150) ?? null,
        cleanTeam(data["TEAM"])?.slice(0, 100) ?? null, cleanTeam(data["TEAM LEADER"])?.slice(0, 150) ?? null,
        first, target, last, parseSeconds(data["Leakage Of Day"]),
        ...SBI_AGENT_COLS.map((c) => coerceCol(c, data[c.header])), ...tail(ctx.batchId, ctx.userId),
      ],
    };
  },
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** Account-level dialer export/import file. Natural key: ACCOUNT_NO + report date (column "Report Date", default: today). */
export const accountFileSpec: SbiBatchSpec = {
  table: "sbi_card_account_file",
  columns: [
    "id", "process_id", "report_date", "account_no", "billing_cycle", "delq1", "cibil_score", "credit_limit", "cur_bal", "cur_bal_plus_dpi",
    "total_amount_due", "total_cur_due", "date_last_pmt", "last_action_code", "last_ptp_date", "mobile_no", "vintage", "region",
    "agency_name", "call_table_name", "dial_cnt", ...TAIL,
  ],
  updateColumns: [
    "billing_cycle", "delq1", "cibil_score", "credit_limit", "cur_bal", "cur_bal_plus_dpi", "total_amount_due", "total_cur_due",
    "date_last_pmt", "last_action_code", "last_ptp_date", "mobile_no", "vintage", "region", "agency_name", "call_table_name", "dial_cnt",
  ],
  headers: SBI_ACCOUNT_HEADERS,
  dateOf: dateOfSecond,
  mapRow(data, _rowNo, ctx) {
    const acct = cleanId(data["ACCOUNT_NO"]);
    if (!acct) return { error: 'a usable "ACCOUNT_NO" is required (Excel may have rounded it into scientific notation)' };
    const reportRaw = data["Report Date"];
    const reportDate = reportRaw === undefined || String(reportRaw).trim() === "" ? todayIso() : parseSbiDate(reportRaw);
    if (!reportDate) return { error: `"Report Date" is not a readable date` };
    const mobile = String(data["MOBILE_NO"] ?? "").replace(/[^\d+]/g, "");
    return {
      values: [
        reportDate, acct.slice(0, 40), cleanText(data["BILLING_CYCLE"])?.slice(0, 20) ?? null, cleanText(data["DELQ1"])?.slice(0, 20) ?? null,
        intOrNull(data["CIBIL_SCORE"]), decOrNull(data["CREDIT_LIMIT"]), decOrNull(data["CUR_BAL"]), decOrNull(data["CUR_BAL_PLUS_DPI"]),
        decOrNull(data["TOTAL_AMOUNT_DUE"]), decOrNull(data["TOTAL_CUR_DUE"]), parseSbiDate(data["DATE_LAST_PMT"]),
        cleanText(data["LAST_ACTION_CODE"])?.slice(0, 30) ?? null, parseSbiDate(data["LAST_PTP_DATE"]), mobile ? mobile.slice(0, 20) : null,
        cleanText(data["VINTAGE"])?.slice(0, 30) ?? null, cleanText(data["REGION"])?.slice(0, 50) ?? null,
        cleanText(data["AGENCY_NAME"])?.slice(0, 100) ?? null, cleanText(data["CALL_TABLE_NAME"])?.slice(0, 100) ?? null,
        intOrNull(data["DIAL_CNT"]), ...tail(ctx.batchId, ctx.userId),
      ],
    };
  },
};

export const downtimeSpec: SbiBatchSpec = {
  table: "sbi_card_downtime",
  columns: [
    "id", "process_id", "report_date", "start_time", "up_time", "site", "downtime_minutes", "impacted_users", "responsibility",
    "reason", "status", "rca", "remarks", ...TAIL,
  ],
  updateColumns: ["up_time", "downtime_minutes", "impacted_users", "responsibility", "reason", "status", "rca", "remarks"],
  headers: SBI_DOWNTIME_HEADERS,
  dateOf: dateOfSecond,
  mapRow(data, _rowNo, ctx) {
    const date = parseSbiDate(data["Date"]);
    if (!date) return String(data["Date"] ?? "").trim() === "" ? { skip: true } : { error: '"Date" is not a readable date' };
    const start = parseSbiTime(data["Start Time"]);
    if (!start) return { error: 'a readable "Start Time" is required (with Date and Site it identifies the outage)' };
    const up = parseSbiTime(data["Up Time"]);
    let minutes = parseDowntimeMinutes(data["Downtime Minutes"]);
    if (minutes === null && up) {
      const s = start.split(":").map(Number); const u = up.split(":").map(Number);
      const diff = (u[0] * 60 + u[1]) - (s[0] * 60 + s[1]);
      minutes = diff >= 0 ? diff : null;
    }
    return {
      values: [
        date, start, up, (cleanText(data["Site"]) ?? "").slice(0, 100), minutes === null ? null : Math.round(minutes * 100) / 100,
        intOrNull(data["Total Impacted Users"]), cleanText(data["Responsibility"])?.slice(0, 100) ?? null,
        cleanText(data["Downtime Description/ Issue Reason"])?.slice(0, 255) ?? null, cleanText(data["Status"])?.slice(0, 50) ?? null,
        cleanText(data["RCA (If Any)"])?.slice(0, 255) ?? null, cleanText(data["Remarks"])?.slice(0, 255) ?? null,
        ...tail(ctx.batchId, ctx.userId),
      ],
    };
  },
};

const PEN_NUM = [
  ["Download", "download_count", "int"], ["Penetration", "penetration", "dec"], ["Dials Required", "dials_required", "int"],
  ["DPH", "dph", "dec"], ["Present Agents (Nos.)", "present_agents", "int"], ["Actual Rostered Count", "rostered_count", "int"],
  ["Actual Present Agent Hrs.", "present_agent_hrs", "dec"], ["Dials", "dials", "int"], ["Estimated PEN", "estimated_pen", "dec"],
  ["Target Penetration", "target_penetration", "dec"], ["Required Agent Hrs.", "required_agent_hrs", "dec"],
  ["Excess/Deficit Agent Hrs.", "excess_deficit_hrs", "dec"],
] as const;

/** Pen Estimation: one row per dialer call table; the day comes from "Report Date" or the call table's ddmmyyyy suffix. */
export const penEstimationSpec: SbiBatchSpec = {
  table: "sbi_card_pen_estimation",
  columns: ["id", "process_id", "report_date", "call_table", ...PEN_NUM.map((c) => c[1]), ...TAIL],
  updateColumns: PEN_NUM.map((c) => c[1]),
  headers: SBI_PEN_HEADERS,
  dateOf: dateOfSecond,
  mapRow(data, _rowNo, ctx) {
    const table = cleanText(data["CALL TABLES"]);
    if (!table) return { skip: true }; // the sheet's spare rows carry only the target penetration
    const date = parseSbiDate(data["Report Date"]) ?? dateFromCallTable(table);
    if (!date && /total/i.test(table)) return { skip: true }; // the GRAND TOTAL row is derived from the rows above it
    if (!date) return { error: `no "Report Date" given and "${table}" has no ddmmyyyy suffix to read the day from` };
    const nums = PEN_NUM.map(([h, , k]) => (k === "int" ? intOrNull(data[h]) : decOrNull(data[h])));
    return { values: [date, table.slice(0, 120), ...nums, ...tail(ctx.batchId, ctx.userId)] };
  },
};

const run = (spec: SbiBatchSpec) => (batchId: string, userId: string) => runSbiBatch(batchId, userId, spec, randomUUID);
export const importSbiCardDialerMisBatch = run(dialerMisSpec);
export const importSbiCardAgentMisBatch = run(agentMisSpec);
export const importSbiCardAccountFileBatch = run(accountFileSpec);
export const importSbiCardDowntimeBatch = run(downtimeSpec);
export const importSbiCardPenEstimationBatch = run(penEstimationSpec);
