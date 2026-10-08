import { randomUUID } from "crypto";
import { parseDurationSeconds } from "./dalmia-import-helpers.js";
import { SBI_APR_COLUMNS, aprLoginResolver } from "./sbi-card-apr-columns.js";
import { SBI_OUTCOME_COLUMNS } from "./sbi-card-outcome-columns.js";
import { SBI_ROSTER_COLUMNS } from "./sbi-card-roster-columns.js";
import { runSbiBatch, type SbiBatchSpec } from "./sbi-card-batch-runner.js";
import {
  SBI_DIALER_COLS, SBI_DIALER_HEADERS, SBI_AGENT_COLS, SBI_AGENT_HEADERS, SBI_ACCOUNT_HEADERS, SBI_DOWNTIME_HEADERS,
  SBI_PEN_HEADERS, SBI_APR_HEADERS, SBI_OUTCOME_HEADERS, SBI_ROSTER_HEADERS, OUTCOME_DEFAULT_SEGMENT, SBI_ATTEMPTS, isRollupCampaign,
} from "./sbi-card-schema.js";
import {
  cleanText, cleanTeam, cleanId, coerceCol, decOrNull, intOrNull, parseSbiDate, parseSbiTime, parseSeconds,
  parseDowntimeMinutes, dateFromCallTable, parseSbiDateTime,
} from "./sbi-card-import-helpers.js";
import { refreshSbiKpiFromAccountFile, refreshSbiKpiFromAgentTime, refreshSbiKpiFromAgentMis, refreshSbiKpiFromDialerMis } from "../process-performance/sbi-card-kpi-sync.js";

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

const ACCOUNT_OPS_COLS = [
  "flow", "cd", "nrr", "block_1", "block_2", "ntc_flag", "new_to_card_flag", "promo_code", "product_class", "account_class", "donotcall", "callback_dt",
  ...SBI_ATTEMPTS.flatMap((n) => [`call${n}_dt`, `disp${n}_c`, `agent${n}_id`]),
];
/** The two day-end exports: MAS_AHM_FLOW_NEW_<date> and MAS_AHM_FLOW_MANUAL_<date>. Part of the account's identity for the day. */
const flowOf = (v: unknown): string => (/^manual/i.test(String(v ?? "").trim()) ? "MANUAL" : "NEW");
const flag = (v: unknown, len = 5): string | null => cleanText(v)?.slice(0, len).toUpperCase() ?? null;

/** Account-level dialer export/import file. Natural key: ACCOUNT_NO + report date (column "Report Date", default: today). */
export const accountFileSpec: SbiBatchSpec = {
  table: "sbi_card_account_file",
  columns: [
    "id", "process_id", "report_date", "account_no", "billing_cycle", "delq1", "cibil_score", "credit_limit", "cur_bal", "cur_bal_plus_dpi",
    "total_amount_due", "total_cur_due", "date_last_pmt", "last_action_code", "last_ptp_date", "mobile_no", "vintage", "region",
    "agency_name", "call_table_name", "dial_cnt", ...ACCOUNT_OPS_COLS, ...TAIL,
  ],
  updateColumns: [
    "billing_cycle", "delq1", "cibil_score", "credit_limit", "cur_bal", "cur_bal_plus_dpi", "total_amount_due", "total_cur_due",
    "date_last_pmt", "last_action_code", "last_ptp_date", "mobile_no", "vintage", "region", "agency_name", "call_table_name", "dial_cnt",
    ...ACCOUNT_OPS_COLS.filter((c) => c !== "flow"),
  ],
  headers: SBI_ACCOUNT_HEADERS,
  dateOf: dateOfSecond,
  afterImport: refreshSbiKpiFromAccountFile,
  mapRow(data, _rowNo, ctx) {
    const acct = cleanId(data["ACCOUNT_NO"]);
    if (!acct) return { error: 'a usable "ACCOUNT_NO" is required (Excel may have rounded it into scientific notation)' };
    const reportRaw = data["Report Date"];
    const reportDate = reportRaw === undefined || String(reportRaw).trim() === "" ? todayIso() : parseSbiDate(reportRaw);
    if (!reportDate) return { error: `"Report Date" is not a readable date` };
    // SBI Card's PII restriction: reporting exports carry masked contact numbers, and HRMS has no use for one. Never persisted.
    return {
      values: [
        reportDate, acct.slice(0, 40), cleanText(data["BILLING_CYCLE"])?.slice(0, 20) ?? null, cleanText(data["DELQ1"])?.slice(0, 20) ?? null,
        intOrNull(data["CIBIL_SCORE"]), decOrNull(data["CREDIT_LIMIT"]), decOrNull(data["CUR_BAL"]), decOrNull(data["CUR_BAL_PLUS_DPI"]),
        decOrNull(data["TOTAL_AMOUNT_DUE"]), decOrNull(data["TOTAL_CUR_DUE"]), parseSbiDate(data["DATE_LAST_PMT"]),
        cleanText(data["LAST_ACTION_CODE"])?.slice(0, 30) ?? null, parseSbiDate(data["LAST_PTP_DATE"]), null,
        cleanText(data["VINTAGE"])?.slice(0, 30) ?? null, cleanText(data["REGION"])?.slice(0, 50) ?? null,
        cleanText(data["AGENCY_NAME"])?.slice(0, 100) ?? null, cleanText(data["CALL_TABLE_NAME"])?.slice(0, 100) ?? null,
        intOrNull(data["DIAL_CNT"]),
        flowOf(data["Flow"]), intOrNull(data["CD"]), flag(data["NRR"]), flag(data["BLOCK_1"], 10), flag(data["BLOCK_2"], 10), flag(data["NTC_FLAG"]),
        flag(data["NEW_TO_CARD_FLAG"]), flag(data["PROMO_CODE"], 20), flag(data["PRODUCT_CLASS_FLAG"], 20), flag(data["ACCOUNTS_CLASS"], 30),
        flag(data["DONOTCALL"]), parseSbiDateTime(data["CALLBACK_DT"]),
        ...SBI_ATTEMPTS.flatMap((n) => [
          parseSbiDateTime(data[`CALL${n}_DT`]), flag(data[`DISP${n}_C`], 20), cleanId(data[`AGENT${n}_ID`])?.slice(0, 20) ?? null,
        ]),
        ...tail(ctx.batchId, ctx.userId),
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

const APR_SECONDS = [
  ["TIME CLOCK", "time_clock_sec"], ["LOGIN TIME", "login_sec"], ["WAIT", "wait_sec"], ["TALK", "talk_sec"], ["DISPO", "dispo_sec"],
  ["PAUSE", "pause_sec"], ["DEAD", "dead_sec"], ["CUSTOMER", "customer_sec"], ["ACHT", "acht_sec"], ["DISMX", "dismx_sec"], ["LAGGED", "lagged_sec"],
  ["LB", "pause_lb_sec"], ["MB", "pause_mb_sec"], ["QB", "pause_qb_sec"], ["TB", "pause_tb_sec"], ["WB", "pause_wb_sec"],
] as const;
/** The dialer's "-" / blank cells are no value; a duration is h:mm:ss or plain seconds, never negative. */
const aprSeconds = (v: unknown): number | null => (String(v ?? "").trim() === "-" ? null : parseDurationSeconds(v));

/**
 * Dialer Agent Time Detail (APR). One row per agent per day; the day is "Report Date" (the uploader reads it from the export's
 * "Time range:" line). The TOTALS footer and rows without an ID are skipped. Natural key: ID + report date.
 */
export const agentTimeSpec: SbiBatchSpec = {
  table: "sbi_card_agent_time",
  columns: [
    "id", "process_id", "report_date", "employee_id", "agent_name", "calls", ...APR_SECONDS.map((c) => c[1]),
    "first_login_time", "last_logout_time", "pause_login_sec", ...TAIL,
  ],
  updateColumns: [
    "agent_name", "calls", ...APR_SECONDS.map((c) => c[1]), "first_login_time", "last_logout_time", "pause_login_sec",
  ],
  headers: SBI_APR_HEADERS,
  columnSpecs: SBI_APR_COLUMNS,
  planOptions: { minRecognised: 6, resolvers: { login: aprLoginResolver } },
  dateOf: dateOfSecond,
  afterImport: refreshSbiKpiFromAgentTime,
  mapRow(data, _rowNo, ctx) {
    const user = cleanText(data["USER"]);
    if (user && /^totals?$/i.test(user)) return { skip: true };
    const id = cleanId(data["ID"]);
    if (!id) return String(data["ID"] ?? "").trim() === "" && !user ? { skip: true } : { error: 'a usable "ID" (employee code) is required' };
    const date = parseSbiDate(data["Report Date"]);
    if (!date) return { error: '"Report Date" is not a readable date (the uploader reads it from the "Time range:" line, else the date picker)' };
    const loginCode = data["LOGIN"] ?? data["Login_1"] ?? data["LOGIN_1"];
    const notes: string[] = [];
    const sec = Object.fromEntries(APR_SECONDS.map(([h]) => [h, aprSeconds(data[h])])) as Record<string, number | null>;
    const states = ["WAIT", "TALK", "DISPO", "PAUSE", "DEAD"].map((h) => sec[h]).filter((v): v is number => v !== null);
    const stateSum = states.reduce((a, b) => a + b, 0);
    // Columns the export dropped are derived where the dialer's own arithmetic allows it, and said so.
    if (data["LOGIN TIME"] === undefined && states.length >= 3) { sec["LOGIN TIME"] = stateSum; notes.push("LOGIN TIME was not in the file; derived from wait + talk + dispo + pause + dead"); }
    const calls = intOrNull(data["CALLS"]);
    if (data["ACHT"] === undefined && calls && calls > 0 && sec["TALK"] !== null) {
      sec["ACHT"] = Math.round(((sec["TALK"] ?? 0) + (sec["DISPO"] ?? 0)) / calls); notes.push("ACHT was not in the file; derived as (talk + dispo) / calls");
    }
    const login = sec["LOGIN TIME"];
    if (data["LOGIN TIME"] !== undefined && login !== null && login > 0 && states.length >= 4 && Math.abs(stateSum - login) > Math.max(300, login * 0.05)) {
      notes.push("State times (wait + talk + dispo + pause + dead) do not add up to LOGIN TIME; the columns may be mislabeled or shifted");
    }
    return {
      values: [
        date, id.slice(0, 30), user?.slice(0, 150) ?? null, calls,
        ...APR_SECONDS.map(([h]) => sec[h] ?? null),
        parseSbiTime(data["Login"]), parseSbiTime(data["Logout"]), aprSeconds(loginCode),
        ...tail(ctx.batchId, ctx.userId),
      ],
      notes,
    };
  },
};

/**
 * A percentage cell: "35%" and 35 mean 35; Excel's own percent cells arrive as 0.35. Fractions are only trusted as fractions when EVERY
 * percentage given on the row is at most 1, so a real "0.8%" next to a "35%" is not scaled up. Returns null for blank / junk.
 */
export function parsePctCells(raw: unknown[]): { values: Array<number | null>; scaledFromFraction: boolean } {
  const nums = raw.map((v) => {
    const t = String(v ?? "").trim();
    if (!t || t === "-" || t.startsWith("#")) return null;
    const hasPct = t.includes("%");
    const n = Number(t.replace(/[%\s,]/g, ""));
    return Number.isFinite(n) ? { n, hasPct } : null;
  });
  const given = nums.filter((x): x is { n: number; hasPct: boolean } => x !== null);
  const fractions = given.length > 0 && given.every((x) => !x.hasPct && x.n >= 0 && x.n <= 1);
  return { values: nums.map((x) => (x === null ? null : Math.round((fractions ? x.n * 100 : x.n) * 1000) / 1000)), scaledFromFraction: fractions };
}

/**
 * Cycle outcome: Resolution / Normalisation / Rollback, cumulative to Report Date, per Segment. Natural key: date + segment.
 * Either counts against Opening Accounts or the three percentages (or both) must be present, otherwise the row says what is missing.
 */
export const outcomeSpec: SbiBatchSpec = {
  table: "sbi_card_outcome",
  columns: [
    "id", "process_id", "report_date", "segment", "opening_accounts", "opening_amount", "resolved_accounts", "normalised_accounts", "rollback_accounts",
    "resolved_amount", "normalised_amount", "rollback_amount", "resolution_pct", "normalisation_pct", "rollback_pct", ...TAIL,
  ],
  updateColumns: [
    "opening_accounts", "opening_amount", "resolved_accounts", "normalised_accounts", "rollback_accounts", "resolved_amount", "normalised_amount",
    "rollback_amount", "resolution_pct", "normalisation_pct", "rollback_pct",
  ],
  headers: SBI_OUTCOME_HEADERS,
  columnSpecs: SBI_OUTCOME_COLUMNS,
  planOptions: { minRecognised: 3 },
  dateOf: dateOfSecond,
  mapRow(data, _rowNo, ctx) {
    const present = SBI_OUTCOME_HEADERS.some((h) => cleanText(data[h]) !== null);
    if (!present) return { skip: true };
    const date = parseSbiDate(data["Report Date"]);
    if (!date) return { error: '"Report Date" is required and must be a readable date (the uploader fills it from the date picker when the file has none)' };
    const segment = (cleanText(data["Segment"]) ?? OUTCOME_DEFAULT_SEGMENT).slice(0, 100);
    const open = intOrNull(data["Opening Accounts"]);
    const counts = [intOrNull(data["Resolved Accounts"]), intOrNull(data["Normalised Accounts"]), intOrNull(data["Rollback Accounts"])];
    const pcts = parsePctCells([data["Resolution %"], data["Normalisation %"], data["Rollback %"]]);
    const havePct = pcts.values.some((v) => v !== null);
    const haveCounts = open !== null && open > 0 && counts.some((c) => c !== null);
    if (!havePct && !haveCounts) return { error: "give Opening Accounts with at least one of Resolved / Normalised / Rollback Accounts, or the Resolution / Normalisation / Rollback percentages" };
    if (pcts.values.some((v) => v !== null && (v < 0 || v > 100))) return { error: "a percentage is outside 0-100" };
    const notes: string[] = [];
    if (pcts.scaledFromFraction) notes.push("percentages given as fractions (0.35) were read as percent (35%)");
    const total = counts.reduce<number>((a, c) => a + (c ?? 0), 0);
    if (haveCounts && total > (open ?? 0)) notes.push("Resolved + Normalised + Rollback accounts add up to more than Opening Accounts (outcomes overlap, or the opening base is wrong)");
    return {
      values: [
        date, segment, open, decOrNull(data["Opening Amount"]), ...counts, decOrNull(data["Resolved Amount"]), decOrNull(data["Normalised Amount"]), decOrNull(data["Rollback Amount"]),
        ...pcts.values, ...tail(ctx.batchId, ctx.userId),
      ],
      notes,
    };
  },
};

/**
 * Agent roster. Identity = DIALER ID (the id the dialer writes into AGENTn_ID). A blank row is a spacer. TEAM is stored upper-case so
 * "HighBal" and "HIGHBAL" are one team; a leader of "0" or "-" (a failed lookup in the workbook) is no leader, not a person called "0".
 */
export const rosterSpec: SbiBatchSpec = {
  table: "sbi_card_roster",
  columns: ["id", "process_id", "dialer_id", "employee_id", "agent_name", "gh", "team", "team_leader", "mode", ...TAIL],
  updateColumns: ["employee_id", "agent_name", "gh", "team", "team_leader", "mode"],
  headers: SBI_ROSTER_HEADERS,
  columnSpecs: SBI_ROSTER_COLUMNS,
  planOptions: { minRecognised: 3 },
  mapRow(data, _rowNo, ctx) {
    const dialer = cleanId(data["DIALER ID"]);
    const anything = SBI_ROSTER_HEADERS.some((h) => cleanText(data[h]) !== null);
    if (!dialer) return anything ? { error: 'a usable "DIALER ID" is required (it is how agents are named in the day-end export)' } : { skip: true };
    return {
      values: [
        dialer.slice(0, 20), cleanId(data["Employee ID"])?.slice(0, 30) ?? null, cleanText(data["Name"])?.slice(0, 150) ?? null, cleanId(data["GH"])?.slice(0, 30) ?? null,
        cleanText(data["TEAM"])?.toUpperCase().slice(0, 50) ?? null, cleanTeam(data["TEAM LEADER"])?.slice(0, 150) ?? null, cleanText(data["MODE"])?.slice(0, 30) ?? null,
        ...tail(ctx.batchId, ctx.userId),
      ],
    };
  },
};

const run = (spec: SbiBatchSpec) => (batchId: string, userId: string) => runSbiBatch(batchId, userId, spec, randomUUID);
export const importSbiCardDialerMisBatch = run(dialerMisSpec);
export const importSbiCardAgentMisBatch = run(agentMisSpec);
export const importSbiCardAccountFileBatch = run(accountFileSpec);
export const importSbiCardDowntimeBatch = run(downtimeSpec);
export const importSbiCardPenEstimationBatch = run(penEstimationSpec);
export const importSbiCardAgentTimeBatch = run(agentTimeSpec);
export const importSbiCardOutcomeBatch = run(outcomeSpec);
export const importSbiCardRosterBatch = run(rosterSpec);
