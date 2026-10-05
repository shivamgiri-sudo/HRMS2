import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";

/**
 * Clovia's non-Inbound channels, read from the real db_masmis.cl_* tables
 * the CL_*_MASMIS bulk uploaders write into (Uploader -> APR / Chat /
 * Disposition / Email Raw / Feedback / Outbound / Quality / Rechurn Call).
 *
 * This REPLACES an earlier version of this file that read from a
 * different, older set of mas_hrms tables (clovia_email_daily_actual,
 * clovia_chat_daily_actual, clovia_feedback_raw, clovia_quality_audit_raw,
 * clovia_team_alignment, clovia_rechurn_calls_raw) -- those have their own
 * separate, working upload path too, but confirmed live 2026-09-16 that
 * nobody has ever uploaded through it (still 0 rows), while the CL_*_MASMIS
 * uploaders this page's own Uploader tab actually exposes had real data
 * uploaded the same day (cl_apr 189, cl_chat 2010, cl_dispo 7296,
 * cl_email_raw 37, cl_feedback 736, cl_ib_cdr 3790, cl_outbound 3270,
 * cl_quality 146, cl_rechurn_call 426 rows). Querying the wrong table set
 * was why the dashboard showed all zeros despite real uploads existing.
 *
 * Every one of these tables stores its source date as free text in a
 * format that varies table-to-table (confirmed against real sample rows,
 * not assumed) -- each query below parses its own table's actual format
 * via STR_TO_DATE rather than a shared assumption:
 *   - cl_apr / cl_email_raw / cl_feedback / cl_quality / cl_rechurn_call
 *     report_date/audit_date: "1-Sep-26"            -> %e-%b-%y
 *   - cl_outbound call_date:                          "9/1/26"           -> %c/%e/%y
 *   - cl_dispo report_date:                            "01/09/2026 09:35:25" -> %d/%m/%Y %H:%i:%s
 *   - cl_chat date_time: already a real DATETIME column, no parsing needed.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return { from, to };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/%/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export interface EmailChannel {
  available: true;
  totalAssigned: number;
  touched: number;
  closed: number;
  open: number;
  inProcess: number;
  reOpen: number;
  junk: number;
  trend: { date: string; assigned: number; closed: number }[];
}

export interface ChatChannel {
  available: true;
  totalChats: number;
  respondedChats: number;
  resolvedYes: number;
  resolvedNo: number;
  csatPct: number;
  avgChatDurationSec: number;
  trend: { date: string; chats: number }[];
}

export interface FeedbackChannel {
  available: true;
  totalFeedback: number;
  satisfiedCount: number;
  notSatisfiedCount: number;
  csatPct: number;
  dsatPct: number;
}

export interface QualityChannel {
  available: true;
  auditsCount: number;
  avgScorePct: number;
  fatalCount: number;
}

/** One agent's one day on one campaign, from vicidial_agent_log_250. Seconds are
 * left as raw numbers (not pre-formatted HH:MM:SS) for the frontend to format/sort. */
export interface ProductivityAgentRow {
  date: string;
  agent: string;
  campaignId: string;
  calls: number;
  waitSec: number;
  talkSec: number;
  dispoSec: number;
  pauseSec: number;
  ahtSec: number;
  loginTime: string;
  logoutTime: string;
  netLoginSec: number;
  loginSec: number;
  bioSec: number;
  lunchSec: number;
  qaSec: number;
  dismxSec: number;
  trainingSec: number;
  shortBreakSec: number;
  outcallSec: number;
  laggedSec: number;
}

export interface ProductivityChannel {
  available: true;
  agentCount: number;
  presentDays: number;
  totalLoginSeconds: number;
  avgUtilizationPct: number;
  totalCallsLogged: number;
  byAgent: ProductivityAgentRow[];
}

export interface RechurnChannel {
  available: true;
  totalCalls: number;
  abandonedCount: number;
  byStatus: { status: string; count: number }[];
}

export interface DispositionChannel {
  available: true;
  totalTickets: number;
  ftrCount: number;
  ftrPct: number;
  topReasons: { reason: string; count: number }[];
}

export interface OutboundChannel {
  available: true;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  avgTalkSec: number;
  agentCount: number;
  trend: { date: string; calls: number; connected: number }[];
}

export interface CloviaChannelsData {
  from: string;
  to: string;
  email: EmailChannel;
  chat: ChatChannel;
  feedback: FeedbackChannel;
  quality: QualityChannel;
  productivity: ProductivityChannel;
  rechurn: RechurnChannel;
  disposition: DispositionChannel;
  outbound: OutboundChannel;
}

const DMY_SHORT = "%e-%b-%y";

async function getEmailChannel(from: string, to: string): Promise<EmailChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COALESCE(SUM(CAST(total_mail_assigned AS UNSIGNED)),0) AS totalAssigned,
       COALESCE(SUM(CAST(total_touched_email AS UNSIGNED)),0) AS touched,
       COALESCE(SUM(CAST(closed_email AS UNSIGNED)),0) AS closed,
       COALESCE(SUM(CAST(open_email AS UNSIGNED)),0) AS open_email,
       COALESCE(SUM(CAST(in_process AS UNSIGNED)),0) AS inProcess,
       COALESCE(SUM(CAST(re_open AS UNSIGNED)),0) AS reOpen,
       COALESCE(SUM(CAST(junk_mail AS UNSIGNED)),0) AS junk
     FROM db_masmis.cl_email_raw
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?`,
    [from, to],
  );
  const [trendRows] = await db.execute<any[]>(
    `SELECT DATE_FORMAT(STR_TO_DATE(report_date, '${DMY_SHORT}'), '%Y-%m-%d') AS date,
       COALESCE(SUM(CAST(total_mail_assigned AS UNSIGNED)),0) AS assigned,
       COALESCE(SUM(CAST(closed_email AS UNSIGNED)),0) AS closed
     FROM db_masmis.cl_email_raw
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?
     GROUP BY date ORDER BY date ASC`,
    [from, to],
  );
  return {
    available: true,
    totalAssigned: num(totals?.totalAssigned),
    touched: num(totals?.touched),
    closed: num(totals?.closed),
    open: num(totals?.open_email),
    inProcess: num(totals?.inProcess),
    reOpen: num(totals?.reOpen),
    junk: num(totals?.junk),
    trend: (trendRows as any[]).map((r) => ({ date: String(r.date), assigned: num(r.assigned), closed: num(r.closed) })),
  };
}

async function getChatChannel(from: string, to: string): Promise<ChatChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS totalChats,
       COALESCE(SUM(CASE WHEN response_rcv = '1' THEN 1 ELSE 0 END),0) AS respondedChats,
       COALESCE(SUM(CASE WHEN issue_resolved_yes = '1' THEN 1 ELSE 0 END),0) AS resolvedYes,
       COALESCE(SUM(CASE WHEN issue_resolved_no = '1' THEN 1 ELSE 0 END),0) AS resolvedNo,
       COALESCE(AVG(TIME_TO_SEC(chat_duration)),0) AS avgDurationSec
     FROM db_masmis.cl_chat
     WHERE DATE(date_time) BETWEEN ? AND ?`,
    [from, to],
  );
  const [trendRows] = await db.execute<any[]>(
    `SELECT DATE(date_time) AS date, COUNT(*) AS chats
     FROM db_masmis.cl_chat
     WHERE DATE(date_time) BETWEEN ? AND ?
     GROUP BY DATE(date_time) ORDER BY date ASC`,
    [from, to],
  );
  const resolvedYes = num(totals?.resolvedYes);
  const resolvedNo = num(totals?.resolvedNo);
  const resolvedTotal = resolvedYes + resolvedNo;
  return {
    available: true,
    totalChats: num(totals?.totalChats),
    respondedChats: num(totals?.respondedChats),
    resolvedYes,
    resolvedNo,
    csatPct: resolvedTotal > 0 ? Math.round((resolvedYes / resolvedTotal) * 10000) / 100 : 0,
    avgChatDurationSec: Math.round(num(totals?.avgDurationSec)),
    trend: (trendRows as any[]).map((r) => ({ date: String(r.date), chats: num(r.chats) })),
  };
}

/**
 * Live feedback, from dialer_db.feedback_log_250 -- the same Clovia dialer
 * instance (_250) as Inbound/Outbound. Confirmed live 2026-09-30: option1 is
 * the feedback answer, with exactly two real values across 81k rows --
 * '1' (75,328 rows, the large majority) and '2' (5,693 rows) -- mapped
 * satisfied/not-satisfied the same direction db_masmis.cl_feedback's own
 * csat_dsat flag already used ('1' = satisfied). calltime is a real DATETIME
 * column, no free-text parsing needed. REPLACES db_masmis.cl_feedback (a
 * manual Uploader -> Feedback upload) the same way Outbound replaced
 * cl_outbound -- cl_feedback and its uploader are left in place, just no
 * longer read here.
 */
async function getFeedbackChannel(from: string, to: string): Promise<FeedbackChannel> {
  const pool = await getDialerPool();
  const [[totals]] = await pool.execute<any[]>(
    `SELECT
       COUNT(*) AS totalFeedback,
       COALESCE(SUM(CASE WHEN option1 = '1' THEN 1 ELSE 0 END),0) AS satisfiedCount,
       COALESCE(SUM(CASE WHEN option1 = '2' THEN 1 ELSE 0 END),0) AS notSatisfiedCount
     FROM feedback_log_250
     WHERE calltime >= ? AND calltime < DATE_ADD(?, INTERVAL 1 DAY)`,
    [from, to],
  );
  const totalFeedback = num(totals?.totalFeedback);
  const satisfiedCount = num(totals?.satisfiedCount);
  const notSatisfiedCount = num(totals?.notSatisfiedCount);
  return {
    available: true,
    totalFeedback,
    satisfiedCount,
    notSatisfiedCount,
    csatPct: totalFeedback > 0 ? Math.round((satisfiedCount / totalFeedback) * 10000) / 100 : 0,
    dsatPct: totalFeedback > 0 ? Math.round((notSatisfiedCount / totalFeedback) * 10000) / 100 : 0,
  };
}

async function getQualityChannel(from: string, to: string): Promise<QualityChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS auditsCount,
       COALESCE(AVG(CAST(REPLACE(cq_score,'%','') AS DECIMAL(6,2))),0) AS avgScorePct,
       COALESCE(SUM(CASE WHEN fatal = '1' THEN 1 ELSE 0 END),0) AS fatalCount
     FROM db_masmis.cl_quality
     WHERE STR_TO_DATE(audit_date, '${DMY_SHORT}') BETWEEN ? AND ?`,
    [from, to],
  );
  return {
    available: true,
    auditsCount: num(totals?.auditsCount),
    avgScorePct: Math.round(num(totals?.avgScorePct) * 100) / 100,
    fatalCount: num(totals?.fatalCount),
  };
}

/**
 * Live agent productivity, from dialer_db.vicidial_agent_log_250 -- the same
 * Clovia dialer instance (_250) as Inbound/Outbound/Feedback. Confirmed live
 * 2026-09-30: sub_status values match this query's CASE labels exactly
 * (LOGIN, OutCal, Short, LAGGED, Lunch, Bio, Qualit all seen in real recent
 * rows; DISMX/Traini are real valid codes too, just not hit in a 2-day
 * sample). campaign_id here is a call-TYPE label per log row (OUTBOUND/
 * INBOUND/CHAT/EMAIL), not a company filter -- Clovia's whole dialer tenant
 * already scopes this table, so every row belongs to Clovia. Per-agent
 * query and column names port the user's own reference SQL (2026-09-30)
 * directly, parametrised by date range instead of CURDATE() and grouped the
 * same way (date, agent, campaign) so an agent who worked more than one
 * campaign in a day gets one row per campaign, not one blended row.
 *
 * REPLACES db_masmis.cl_apr (a manual Uploader -> APR upload) the same way
 * Outbound replaced cl_outbound -- cl_apr and its uploader are left in
 * place, just no longer read here. The aggregate totals below are derived
 * from the same per-row data as byAgent, not a separate query: totalLoginSeconds
 * sums the real "Login" sub_status time (closest live equivalent to cl_apr's
 * actual_login_hrs), and avgUtilizationPct is (talk+dispo) / login time.
 */
export async function getProductivityChannel(from: string, to: string): Promise<ProductivityChannel> {
  const pool = await getDialerPool();
  const [rows] = await pool.execute<any[]>(
    `SELECT
       DATE(event_time) AS date, user AS agent, campaign_id AS campaignId,
       COUNT(*) AS calls,
       COALESCE(SUM(wait_sec),0) AS waitSec,
       COALESCE(SUM(talk_sec),0) AS talkSec,
       COALESCE(SUM(dispo_sec),0) AS dispoSec,
       COALESCE(SUM(pause_sec),0) AS pauseSec,
       ROUND((COALESCE(SUM(wait_sec),0)+COALESCE(SUM(talk_sec),0)+COALESCE(SUM(dispo_sec),0)) / NULLIF(COUNT(*),0)) AS ahtSec,
       DATE_FORMAT(MIN(event_time), '%H:%i:%s') AS loginTime,
       DATE_FORMAT(MAX(event_time), '%H:%i:%s') AS logoutTime,
       TIMESTAMPDIFF(SECOND, MIN(event_time), MAX(event_time)) AS netLoginSec,
       COALESCE(SUM(CASE WHEN sub_status = 'LOGIN' THEN pause_sec ELSE 0 END),0) AS loginSec,
       COALESCE(SUM(CASE WHEN sub_status = 'Bio' THEN pause_sec ELSE 0 END),0) AS bioSec,
       COALESCE(SUM(CASE WHEN sub_status = 'Lunch' THEN pause_sec ELSE 0 END),0) AS lunchSec,
       COALESCE(SUM(CASE WHEN sub_status = 'Qualit' THEN pause_sec ELSE 0 END),0) AS qaSec,
       COALESCE(SUM(CASE WHEN sub_status = 'DISMX' THEN pause_sec ELSE 0 END),0) AS dismxSec,
       COALESCE(SUM(CASE WHEN sub_status = 'Traini' THEN pause_sec ELSE 0 END),0) AS trainingSec,
       COALESCE(SUM(CASE WHEN sub_status = 'Short' THEN pause_sec ELSE 0 END),0) AS shortBreakSec,
       COALESCE(SUM(CASE WHEN sub_status = 'OutCal' THEN pause_sec ELSE 0 END),0) AS outcallSec,
       COALESCE(SUM(CASE WHEN sub_status = 'LAGGED' THEN pause_sec ELSE 0 END),0) AS laggedSec
     FROM vicidial_agent_log_250
     WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY) AND user IS NOT NULL AND user != ''
     GROUP BY DATE(event_time), user, campaign_id
     ORDER BY date ASC, agent ASC, campaignId ASC`,
    [from, to],
  );

  const byAgent: ProductivityAgentRow[] = (rows as any[]).map((r) => ({
    date: String(r.date), agent: String(r.agent), campaignId: String(r.campaignId ?? ""),
    calls: num(r.calls), waitSec: num(r.waitSec), talkSec: num(r.talkSec), dispoSec: num(r.dispoSec), pauseSec: num(r.pauseSec),
    ahtSec: num(r.ahtSec), loginTime: String(r.loginTime ?? ""), logoutTime: String(r.logoutTime ?? ""), netLoginSec: num(r.netLoginSec),
    loginSec: num(r.loginSec), bioSec: num(r.bioSec), lunchSec: num(r.lunchSec), qaSec: num(r.qaSec), dismxSec: num(r.dismxSec),
    trainingSec: num(r.trainingSec), shortBreakSec: num(r.shortBreakSec), outcallSec: num(r.outcallSec), laggedSec: num(r.laggedSec),
  }));

  const agentCount = new Set(byAgent.map((r) => r.agent)).size;
  const presentDays = new Set(byAgent.map((r) => `${r.agent}|${r.date}`)).size;
  const totalLoginSeconds = byAgent.reduce((s, r) => s + r.loginSec, 0);
  const totalTalkDispo = byAgent.reduce((s, r) => s + r.talkSec + r.dispoSec, 0);
  const totalCallsLogged = byAgent.reduce((s, r) => s + r.calls, 0);

  return {
    available: true,
    agentCount,
    presentDays,
    totalLoginSeconds,
    avgUtilizationPct: totalLoginSeconds > 0 ? Math.round((totalTalkDispo / totalLoginSeconds) * 10000) / 100 : 0,
    totalCallsLogged,
    byAgent,
  };
}

async function getRechurnChannel(from: string, to: string): Promise<RechurnChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT COUNT(*) AS totalCalls,
       COALESCE(SUM(CASE WHEN abandoned_date IS NOT NULL AND abandoned_date != '' THEN 1 ELSE 0 END),0) AS abandonedCount
     FROM db_masmis.cl_rechurn_call
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?`,
    [from, to],
  );
  const [byStatus] = await db.execute<any[]>(
    `SELECT COALESCE(NULLIF(status,''),'Unknown') AS status, COUNT(*) AS count
     FROM db_masmis.cl_rechurn_call
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?
     GROUP BY status ORDER BY count DESC LIMIT 8`,
    [from, to],
  );
  return {
    available: true,
    totalCalls: num(totals?.totalCalls),
    abandonedCount: num(totals?.abandonedCount),
    byStatus: (byStatus as any[]).map((r) => ({ status: String(r.status), count: num(r.count) })),
  };
}

async function getDispositionChannel(from: string, to: string): Promise<DispositionChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT COUNT(*) AS totalTickets,
       COALESCE(SUM(CASE WHEN repeat_ftr = 'FTR' THEN 1 ELSE 0 END),0) AS ftrCount
     FROM db_masmis.cl_dispo
     WHERE STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s') BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)`,
    [from, to],
  );
  const [topReasons] = await db.execute<any[]>(
    `SELECT COALESCE(NULLIF(reason,''),'Unknown') AS reason, COUNT(*) AS count
     FROM db_masmis.cl_dispo
     WHERE STR_TO_DATE(report_date, '%d/%m/%Y %H:%i:%s') BETWEEN ? AND DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY reason ORDER BY count DESC LIMIT 8`,
    [from, to],
  );
  const totalTickets = num(totals?.totalTickets);
  const ftrCount = num(totals?.ftrCount);
  return {
    available: true,
    totalTickets,
    ftrCount,
    ftrPct: totalTickets > 0 ? Math.round((ftrCount / totalTickets) * 10000) / 100 : 0,
    topReasons: (topReasons as any[]).map((r) => ({ reason: String(r.reason), count: num(r.count) })),
  };
}

/**
 * Live outbound calling, from dialer_db.cdr_ob_250 -- the same dialer
 * instance Clovia's Inbound tab already reads (cdr_in_250), confirmed live
 * 2026-09-30 to be Clovia's real outbound dialer feed: CallDate is a real
 * DATE column (no free-text parsing needed), campaign_id = 'OUTBOUND' is
 * the live outbound-calling scope (197k+ rows, current through yesterday,
 * 3-7 agents/day this month). Connected = LengthInSec >= 20 (user
 * instruction, 2026-09-30), not CallStatus = 'A' -- a call is only counted
 * once it ran long enough to be a real conversation, regardless of how the
 * dialer itself tagged the attempt. talk_sec is real per-call talk time,
 * read straight off the row rather than re-derived.
 *
 * This REPLACES the previous db_masmis.cl_outbound source (a manual
 * Uploader -> Outbound upload, last real data 2026-09-16, only 3,270 rows
 * total) -- same reasoning as Inbound already not needing a manual upload.
 * cl_outbound and its uploader are left in place, just no longer read here.
 */
async function getOutboundChannel(from: string, to: string): Promise<OutboundChannel> {
  const pool = await getDialerPool();
  const [[totals]] = await pool.execute<any[]>(
    `SELECT
       COUNT(*) AS totalCalls,
       COALESCE(SUM(CASE WHEN CAST(LengthInSec AS UNSIGNED) >= 20 THEN 1 ELSE 0 END),0) AS connectedCalls,
       COALESCE(AVG(CASE WHEN CAST(LengthInSec AS UNSIGNED) >= 20 THEN CAST(talk_sec AS UNSIGNED) END),0) AS avgTalkSec,
       COUNT(DISTINCT Agent) AS agentCount
     FROM cdr_ob_250
     WHERE campaign_id = 'OUTBOUND' AND CallDate BETWEEN ? AND ?`,
    [from, to],
  );
  const [trendRows] = await pool.execute<any[]>(
    `SELECT DATE_FORMAT(CallDate, '%Y-%m-%d') AS date,
       COUNT(*) AS calls,
       COALESCE(SUM(CASE WHEN CAST(LengthInSec AS UNSIGNED) >= 20 THEN 1 ELSE 0 END),0) AS connected
     FROM cdr_ob_250
     WHERE campaign_id = 'OUTBOUND' AND CallDate BETWEEN ? AND ?
     GROUP BY date ORDER BY date ASC`,
    [from, to],
  );
  const totalCalls = num(totals?.totalCalls);
  const connectedCalls = num(totals?.connectedCalls);
  return {
    available: true,
    totalCalls,
    connectedCalls,
    connectedPct: totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 10000) / 100 : 0,
    avgTalkSec: Math.round(num(totals?.avgTalkSec)),
    agentCount: num(totals?.agentCount),
    trend: (trendRows as any[]).map((r) => ({ date: String(r.date), calls: num(r.calls), connected: num(r.connected) })),
  };
}

export async function getCloviaChannelsDashboard(fromInput: string, toInput: string): Promise<CloviaChannelsData> {
  const { from, to } = resolveRange(fromInput, toInput);

  const [email, chat, feedback, quality, productivity, rechurn, disposition, outbound] = await Promise.all([
    getEmailChannel(from, to),
    getChatChannel(from, to),
    getFeedbackChannel(from, to),
    getQualityChannel(from, to),
    getProductivityChannel(from, to),
    getRechurnChannel(from, to),
    getDispositionChannel(from, to),
    getOutboundChannel(from, to),
  ]);

  return { from, to, email, chat, feedback, quality, productivity, rechurn, disposition, outbound };
}
