import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import {
  FieldSpec, parseFlexibleSheet, normalizeDate, normalizeDurationSeconds,
  normalizeNumber, normalizeText, normalizeName,
} from "./flexible-parser.js";

const SALE_FIELDS: FieldSpec[] = [
  { key: "orderId", aliases: ["Order_ID", "Order ID"] },
  { key: "couponCode", aliases: ["coupon_code", "Coupon Code", "Coupon_Code"] },
  { key: "amount", aliases: ["Amount"] },
  { key: "createdAt", aliases: ["Created_At", "Created At"] },
  { key: "partnerName", aliases: ["Partner_Name", "Partner Name"] },
  { key: "agentName", aliases: ["Agent_Name", "Agent Name"] },
  { key: "tlName", aliases: ["TL_Name", "TL Name"] },
  { key: "time", aliases: ["Time"] },
  { key: "assignTl", aliases: ["Assign_TL", "Assign TL"] },
  { key: "orderValue", aliases: ["Order_Value", "Order Value"] },
  { key: "target", aliases: ["Target"] },
  { key: "slots", aliases: ["Slots", "Slot"] },
  { key: "count", aliases: ["Count"] },
  { key: "date", aliases: ["Date"] },
  { key: "week", aliases: ["Week"] },
  { key: "hour", aliases: ["Hour"] },
];

const CDR_FIELDS: FieldSpec[] = [
  { key: "caller", aliases: ["CALLER"] },
  { key: "member", aliases: ["MEMBER"] },
  { key: "endTime", aliases: ["End Time", "End_Time"] },
  { key: "duration", aliases: ["DURATION", "Duration"] },
  { key: "status", aliases: ["STATUS", "Status"] },
  { key: "routingNumbers", aliases: ["Routing Numbers", "Routing_Numbers"] },
  { key: "routingStatus", aliases: ["Routing Status", "Routing_Status"] },
  { key: "talkDuration", aliases: ["Talk Duration", "Talk_Duration"] },
  { key: "ringingDuration", aliases: ["Ringing Duration", "Ringing_Duration"] },
  { key: "time", aliases: ["Time"] },
  { key: "date", aliases: ["Date"] },
  { key: "tlName", aliases: ["TL Name", "TL_Name"] },
];

async function resolveProcessId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM process_master WHERE process_name = 'Housing Premium' LIMIT 1",
  );
  return (rows[0]?.id as string) ?? null;
}

/** Amount if valid, otherwise Order_Value -- never both summed (same transaction). */
function saleValue(amount: number | null, orderValue: number | null): number {
  if (amount !== null && amount > 0) return amount;
  return orderValue ?? 0;
}

export async function uploadSaleRaw(buffer: Buffer, uploadedBy: string) {
  const parsed = parseFlexibleSheet(buffer, SALE_FIELDS, ["orderId"]);
  const processId = await resolveProcessId();
  if (!processId) throw new Error('No "Housing Premium" process found');

  const batchId = randomUUID();
  for (const r of parsed.rows) {
    const amount = normalizeNumber(r.amount);
    const orderValue = normalizeNumber(r.orderValue);
    const reportDate = normalizeDate(r.date) ?? normalizeDate(r.createdAt);
    const hourVal = normalizeNumber(r.hour);
    await db.execute(
      `INSERT INTO housing_premium_dashboard_sale_raw
         (id, process_id, upload_batch_id, order_id, coupon_code, amount, created_at_source,
          report_date, partner_name, agent_name, agent_name_norm, tl_name, assigned_tl,
          source_time, hour_of_day, order_value, target, slot, sale_count, week_label, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), processId, batchId,
        normalizeText(r.orderId), normalizeText(r.couponCode), amount,
        normalizeDate(r.createdAt) ? `${normalizeDate(r.createdAt)} 00:00:00` : null,
        reportDate, normalizeText(r.partnerName),
        normalizeText(r.agentName), normalizeName(r.agentName),
        normalizeText(r.tlName), normalizeText(r.assignTl), normalizeText(r.time),
        hourVal !== null ? Math.max(0, Math.min(23, Math.round(hourVal))) : null,
        orderValue, normalizeNumber(r.target), normalizeText(r.slots),
        normalizeNumber(r.count) ?? 1, normalizeText(r.week), uploadedBy,
      ],
    );
  }

  return {
    batchId, fileType: "sale_raw",
    totalRows: parsed.totalRows, validRows: parsed.validRows, duplicateRows: parsed.duplicateRows,
    recognizedColumns: parsed.recognizedColumns, additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns, preview: parsed.previewRaw,
  };
}

function normalizeCallStatus(status: string | null, routingStatus: string | null): "Answered" | "Not Answered" | "Other" {
  const s = (status ?? "").toLowerCase();
  const rs = (routingStatus ?? "").toLowerCase();
  if (s.includes("answer") && !s.includes("no") && !s.includes("not")) return "Answered";
  if (rs === "answer") return "Answered";
  if (s.includes("no answer") || s.includes("not answered") || s.includes("missed")) return "Not Answered";
  return "Other";
}

export async function uploadCdrRaw(buffer: Buffer, uploadedBy: string) {
  const parsed = parseFlexibleSheet(buffer, CDR_FIELDS, ["caller", "endTime"]);
  const processId = await resolveProcessId();
  if (!processId) throw new Error('No "Housing Premium" process found');

  const batchId = randomUUID();
  for (const r of parsed.rows) {
    const status = normalizeText(r.status);
    const routingStatus = normalizeText(r.routingStatus);
    const reportDate = normalizeDate(r.date) ?? normalizeDate(r.endTime);
    await db.execute(
      `INSERT INTO housing_premium_dashboard_cdr_raw
         (id, process_id, upload_batch_id, caller, member, member_norm, report_date, source_time,
          end_time, duration_seconds, status, status_normalized, routing_numbers, routing_status,
          talk_duration_seconds, ringing_duration_seconds, tl_name, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), processId, batchId,
        normalizeText(r.caller), normalizeText(r.member), normalizeName(r.member),
        reportDate, normalizeText(r.time),
        normalizeDate(r.endTime) ? `${normalizeDate(r.endTime)} 00:00:00` : null,
        normalizeDurationSeconds(r.duration), status,
        normalizeCallStatus(status, routingStatus),
        normalizeText(r.routingNumbers), routingStatus,
        normalizeDurationSeconds(r.talkDuration), normalizeDurationSeconds(r.ringingDuration),
        normalizeText(r.tlName), uploadedBy,
      ],
    );
  }

  return {
    batchId, fileType: "cdr_raw",
    totalRows: parsed.totalRows, validRows: parsed.validRows, duplicateRows: parsed.duplicateRows,
    recognizedColumns: parsed.recognizedColumns, additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns, preview: parsed.previewRaw,
  };
}

interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  tlName?: string;
  agentName?: string;
}

function dateClause(alias: string, f: DashboardFilters, params: unknown[]): string {
  let clause = "";
  if (f.startDate) { clause += ` AND ${alias}.report_date >= ?`; params.push(f.startDate); }
  if (f.endDate) { clause += ` AND ${alias}.report_date <= ?`; params.push(f.endDate); }
  return clause;
}

export async function getOverview(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams) + (f.tlName ? " AND s.tl_name = ?" : "");
  if (f.tlName) saleParams.push(f.tlName);
  const [saleRows] = await db.execute<RowDataPacket[]>(
    `SELECT amount, order_value, sale_count, order_id, agent_name_norm, target, report_date, agent_name
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        ${saleWhere}`,
    saleParams,
  );

  let totalSalesValue = 0, totalSalesCount = 0;
  const uniqueOrders = new Set<string>();
  const uniqueAgents = new Set<string>();
  const targetByDateAgent = new Map<string, number>();
  for (const r of saleRows) {
    const v = saleValue(r.amount !== null ? Number(r.amount) : null, r.order_value !== null ? Number(r.order_value) : null);
    totalSalesValue += v;
    totalSalesCount += Number(r.sale_count ?? 1);
    if (r.order_id) uniqueOrders.add(String(r.order_id));
    if (r.agent_name_norm) uniqueAgents.add(String(r.agent_name_norm));
    if (r.target !== null && r.agent_name_norm && r.report_date) {
      const key = `${r.report_date}|${r.agent_name_norm}`;
      targetByDateAgent.set(key, Number(r.target));
    }
  }
  const totalTarget = Array.from(targetByDateAgent.values()).reduce((a, b) => a + b, 0);

  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams) + (f.tlName ? " AND c.tl_name = ?" : "");
  if (f.tlName) cdrParams.push(f.tlName);
  const [[cdrKpi]] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) totalCalls,
            SUM(status_normalized = 'Answered') answered,
            SUM(status_normalized = 'Not Answered') notAnswered,
            SUM(duration_seconds) totalDuration, SUM(talk_duration_seconds) totalTalk
       FROM housing_premium_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        ${cdrWhere}`,
    cdrParams,
  );

  const totalCalls = Number(cdrKpi?.totalCalls ?? 0);
  const answered = Number(cdrKpi?.answered ?? 0);
  const bothAvailable = totalSalesCount > 0 && answered > 0;

  return {
    dataSources: { saleRaw: saleRows.length > 0, cdr: totalCalls > 0 },
    sales: {
      totalSales: totalSalesCount, totalSalesValue,
      averageSaleValue: totalSalesCount > 0 ? totalSalesValue / totalSalesCount : 0,
      uniqueOrders: uniqueOrders.size, uniqueAgents: uniqueAgents.size,
    },
    calling: {
      totalCalls, answered, notAnswered: Number(cdrKpi?.notAnswered ?? 0),
      answerRatePct: totalCalls > 0 ? (answered / totalCalls) * 100 : 0,
      notAnswerRatePct: totalCalls > 0 ? (Number(cdrKpi?.notAnswered ?? 0) / totalCalls) * 100 : 0,
      totalTalkTimeSeconds: Number(cdrKpi?.totalTalk ?? 0),
      averageTalkTimeSeconds: answered > 0 ? Number(cdrKpi?.totalTalk ?? 0) / answered : 0,
      averageCallDurationSeconds: totalCalls > 0 ? Number(cdrKpi?.totalDuration ?? 0) / totalCalls : 0,
    },
    conversion: bothAvailable ? {
      conversionPct: (totalSalesCount / answered) * 100,
      salesPer100Answered: (totalSalesCount / answered) * 100,
      revenuePerAnsweredCall: totalSalesValue / answered,
      revenuePerCall: totalCalls > 0 ? totalSalesValue / totalCalls : 0,
    } : null,
    target: {
      totalTarget,
      achievement: totalSalesValue,
      achievementPct: totalTarget > 0 ? (totalSalesValue / totalTarget) * 100 : null,
      targetGap: totalSalesValue - totalTarget,
    },
  };
}

export async function getAgentPerformance(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams) + (f.tlName ? " AND s.tl_name = ?" : "");
  if (f.tlName) saleParams.push(f.tlName);
  const [saleRows] = await db.execute<RowDataPacket[]>(
    `SELECT agent_name_norm, agent_name, tl_name, amount, order_value, sale_count, target, report_date
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND agent_name_norm IS NOT NULL ${saleWhere}`,
    saleParams,
  );

  const byAgent = new Map<string, { agent: string; tl: string | null; sales: number; salesValue: number; targetSeen: Map<string, number> }>();
  for (const r of saleRows) {
    const key = r.agent_name_norm as string;
    const entry = byAgent.get(key) ?? { agent: r.agent_name as string, tl: r.tl_name as string | null, sales: 0, salesValue: 0, targetSeen: new Map() };
    entry.sales += Number(r.sale_count ?? 1);
    entry.salesValue += saleValue(r.amount !== null ? Number(r.amount) : null, r.order_value !== null ? Number(r.order_value) : null);
    if (r.target !== null && r.report_date) entry.targetSeen.set(String(r.report_date), Number(r.target));
    byAgent.set(key, entry);
  }

  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams) + (f.tlName ? " AND c.tl_name = ?" : "");
  if (f.tlName) cdrParams.push(f.tlName);
  const [cdrAgg] = await db.execute<RowDataPacket[]>(
    `SELECT member_norm, MAX(\`member\`) \`member\`, COUNT(*) calls,
            SUM(status_normalized = 'Answered') answered, SUM(status_normalized = 'Not Answered') notAnswered,
            SUM(talk_duration_seconds) talkTime
       FROM housing_premium_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        AND member_norm IS NOT NULL ${cdrWhere}
      GROUP BY member_norm`,
    cdrParams,
  );

  const result: Record<string, unknown>[] = [];
  const cdrByKey = new Map(cdrAgg.map((c) => [c.member_norm as string, c]));
  const allKeys = new Set([...byAgent.keys(), ...cdrByKey.keys()]);
  for (const key of allKeys) {
    const sale = byAgent.get(key);
    const cdr = cdrByKey.get(key);
    const calls = Number(cdr?.calls ?? 0);
    const answered = Number(cdr?.answered ?? 0);
    const salesCount = sale?.sales ?? 0;
    const salesValue = sale?.salesValue ?? 0;
    const target = sale ? Array.from(sale.targetSeen.values()).reduce((a, b) => a + b, 0) : 0;
    result.push({
      agentKey: key,
      agent: sale?.agent ?? cdr?.member ?? key,
      tl: sale?.tl ?? null,
      calls, answered, notAnswered: Number(cdr?.notAnswered ?? 0),
      answerPct: calls > 0 ? (answered / calls) * 100 : 0,
      sales: salesCount, salesValue,
      conversionPct: answered > 0 ? (salesCount / answered) * 100 : 0,
      avgSale: salesCount > 0 ? salesValue / salesCount : 0,
      talkTimeSeconds: Number(cdr?.talkTime ?? 0),
      target, achievementPct: target > 0 ? (salesValue / target) * 100 : null,
    });
  }
  return result.sort((a, b) => (b.salesValue as number) - (a.salesValue as number));
}

export async function getDailyTrend(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams);
  const [saleRows] = await db.execute<RowDataPacket[]>(
    `SELECT report_date, amount, order_value, sale_count, agent_name_norm, target
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND report_date IS NOT NULL ${saleWhere}`,
    saleParams,
  );
  const byDate = new Map<string, { salesValue: number; salesCount: number; target: Map<string, number> }>();
  for (const r of saleRows) {
    const d = String(r.report_date).slice(0, 10);
    const e = byDate.get(d) ?? { salesValue: 0, salesCount: 0, target: new Map() };
    e.salesValue += saleValue(r.amount !== null ? Number(r.amount) : null, r.order_value !== null ? Number(r.order_value) : null);
    e.salesCount += Number(r.sale_count ?? 1);
    if (r.target !== null && r.agent_name_norm) e.target.set(String(r.agent_name_norm), Number(r.target));
    byDate.set(d, e);
  }

  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams);
  const [cdrRows] = await db.execute<RowDataPacket[]>(
    `SELECT report_date, COUNT(*) calls, SUM(status_normalized = 'Answered') answered
       FROM housing_premium_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        AND report_date IS NOT NULL ${cdrWhere}
      GROUP BY report_date`,
    cdrParams,
  );
  const cdrByDate = new Map(cdrRows.map((r) => [String(r.report_date).slice(0, 10), r]));

  const allDates = new Set([...byDate.keys(), ...cdrByDate.keys()]);
  return Array.from(allDates).sort().map((d) => {
    const s = byDate.get(d);
    const c = cdrByDate.get(d);
    const target = s ? Array.from(s.target.values()).reduce((a, b) => a + b, 0) : 0;
    const calls = Number(c?.calls ?? 0);
    const answered = Number(c?.answered ?? 0);
    return {
      date: d, calls, answered,
      answerPct: calls > 0 ? (answered / calls) * 100 : 0,
      salesValue: s?.salesValue ?? 0, salesCount: s?.salesCount ?? 0,
      conversionPct: answered > 0 ? ((s?.salesCount ?? 0) / answered) * 100 : 0,
      target, achievementPct: target > 0 ? ((s?.salesValue ?? 0) / target) * 100 : null,
    };
  });
}

export async function getHourlyAnalysis(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams);
  const [byHour] = await db.execute<RowDataPacket[]>(
    `SELECT hour_of_day, COUNT(*) sales, SUM(COALESCE(amount, order_value, 0)) salesValue
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND hour_of_day IS NOT NULL ${saleWhere}
      GROUP BY hour_of_day ORDER BY hour_of_day`,
    saleParams,
  );
  const [bySlot] = await db.execute<RowDataPacket[]>(
    `SELECT slot, COUNT(*) sales, SUM(COALESCE(amount, order_value, 0)) salesValue
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND slot IS NOT NULL AND slot <> '' ${saleWhere}
      GROUP BY slot ORDER BY slot`,
    saleParams,
  );
  return {
    byHour: byHour.map((r) => ({ hour: Number(r.hour_of_day), sales: Number(r.sales), salesValue: Number(r.salesValue) })),
    bySlot: bySlot.map((r) => ({ slot: r.slot, sales: Number(r.sales), salesValue: Number(r.salesValue) })),
  };
}

export async function getTargetAchievement(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT agent_name_norm, MAX(agent_name) agentName, SUM(COALESCE(amount, order_value, 0)) achievement,
            MAX(target) target
       FROM housing_premium_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_premium_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND agent_name_norm IS NOT NULL ${saleWhere}
      GROUP BY agent_name_norm`,
    saleParams,
  );
  const agents = rows.map((r) => {
    const target = Number(r.target ?? 0);
    const achievement = Number(r.achievement ?? 0);
    return {
      agent: r.agentName, target, achievement,
      achievementPct: target > 0 ? (achievement / target) * 100 : null,
      gap: achievement - target,
    };
  });
  return {
    agents,
    overallTarget: agents.reduce((a, x) => a + x.target, 0),
    overallAchievement: agents.reduce((a, x) => a + x.achievement, 0),
    agentsAboveTarget: agents.filter((a) => a.target > 0 && a.achievement >= a.target).length,
    agentsBelowTarget: agents.filter((a) => a.target > 0 && a.achievement < a.target).length,
  };
}

export async function getFilterOptions() {
  const [tls] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT tl_name FROM housing_premium_dashboard_sale_raw WHERE tl_name IS NOT NULL
     UNION SELECT DISTINCT tl_name FROM housing_premium_dashboard_cdr_raw WHERE tl_name IS NOT NULL`,
  );
  const [dataStatus] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM housing_premium_dashboard_sale_raw) saleRows,
       (SELECT COUNT(*) FROM housing_premium_dashboard_cdr_raw) cdrRows`,
  );
  return {
    tlNames: tls.map((r) => r.tl_name as string).filter(Boolean).sort(),
    saleRawLoaded: Number(dataStatus[0]?.saleRows ?? 0) > 0,
    cdrLoaded: Number(dataStatus[0]?.cdrRows ?? 0) > 0,
  };
}
