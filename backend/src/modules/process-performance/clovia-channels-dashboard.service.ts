import { db } from "../../db/mysql.js";

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

export interface ProductivityChannel {
  available: true;
  agentCount: number;
  presentDays: number;
  totalLoginSeconds: number;
  avgUtilizationPct: number;
  totalCallsLogged: number;
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

async function getFeedbackChannel(from: string, to: string): Promise<FeedbackChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS totalFeedback,
       COALESCE(SUM(CASE WHEN csat_dsat = '1' THEN 1 ELSE 0 END),0) AS satisfiedCount,
       COALESCE(SUM(CASE WHEN csat_dsat = '0' THEN 1 ELSE 0 END),0) AS notSatisfiedCount
     FROM db_masmis.cl_feedback
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?`,
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

async function getProductivityChannel(from: string, to: string): Promise<ProductivityChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COUNT(DISTINCT mas_id) AS agentCount,
       COALESCE(SUM(CAST(attendance AS UNSIGNED)),0) AS presentDays,
       COALESCE(SUM(TIME_TO_SEC(actual_login_hrs)),0) AS totalLoginSeconds,
       COALESCE(AVG(CAST(REPLACE(utilization,'%','') AS DECIMAL(6,2))),0) AS avgUtilizationPct,
       COALESCE(SUM(CAST(total_calls AS UNSIGNED)),0) AS totalCallsLogged
     FROM db_masmis.cl_apr
     WHERE STR_TO_DATE(report_date, '${DMY_SHORT}') BETWEEN ? AND ?`,
    [from, to],
  );
  return {
    available: true,
    agentCount: num(totals?.agentCount),
    presentDays: num(totals?.presentDays),
    totalLoginSeconds: num(totals?.totalLoginSeconds),
    avgUtilizationPct: Math.round(num(totals?.avgUtilizationPct) * 100) / 100,
    totalCallsLogged: num(totals?.totalCallsLogged),
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

async function getOutboundChannel(from: string, to: string): Promise<OutboundChannel> {
  const [[totals]] = await db.execute<any[]>(
    `SELECT
       COUNT(*) AS totalCalls,
       COALESCE(SUM(CASE WHEN status = 'Connected' THEN 1 ELSE 0 END),0) AS connectedCalls,
       COALESCE(AVG(CASE WHEN status = 'Connected' THEN CAST(length_sec AS UNSIGNED) END),0) AS avgTalkSec,
       COUNT(DISTINCT agent) AS agentCount
     FROM db_masmis.cl_outbound
     WHERE STR_TO_DATE(call_date, '%c/%e/%y') BETWEEN ? AND ?`,
    [from, to],
  );
  const [trendRows] = await db.execute<any[]>(
    `SELECT DATE_FORMAT(STR_TO_DATE(call_date, '%c/%e/%y'), '%Y-%m-%d') AS date,
       COUNT(*) AS calls,
       COALESCE(SUM(CASE WHEN status = 'Connected' THEN 1 ELSE 0 END),0) AS connected
     FROM db_masmis.cl_outbound
     WHERE STR_TO_DATE(call_date, '%c/%e/%y') BETWEEN ? AND ?
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
