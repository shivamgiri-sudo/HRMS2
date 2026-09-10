import { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import {
  FieldSpec, parseFlexibleSheet, normalizeDate, normalizeDurationSeconds,
  normalizeNumber, normalizeText, normalizeName,
} from "./flexible-parser.js";

const SALE_FIELDS: FieldSpec[] = [
  { key: "date", aliases: ["Date"] },
  { key: "agentId", aliases: ["Agent ID", "Agent_ID", "AgentId"] },
  { key: "agentName", aliases: ["Agent Name", "Agent_Name", "AgentName"] },
  { key: "value", aliases: ["Value", "Amount", "Order Value"] },
  { key: "count", aliases: ["Count", "Sale Count"] },
  { key: "paymentMode", aliases: ["Payment Mode", "Payment_Mode"] },
  { key: "packageName", aliases: ["Package Name", "Package_Name"] },
  { key: "packageType", aliases: ["Package Type", "Package_Type"] },
  { key: "oppId", aliases: ["Opp ID", "Opp_ID", "OppId"] },
  { key: "discountPct", aliases: ["Discount %", "Discount Pct", "Discount_Pct"] },
  { key: "tlName", aliases: ["TL Name", "TL_Name", "TLName"] },
  { key: "week", aliases: ["Week"] },
];

const CDR_FIELDS: FieldSpec[] = [
  { key: "uid", aliases: ["UID"] },
  { key: "date", aliases: ["Date"] },
  { key: "agent", aliases: ["Agent"] },
  { key: "email", aliases: ["Email ID", "Email_ID", "Email"] },
  { key: "tlName", aliases: ["TL Name", "TL_Name"] },
  { key: "am", aliases: ["AM"] },
  { key: "totalCalls", aliases: ["Total Calls"] },
  { key: "inboundOffered", aliases: ["Inbound Calls Offered"] },
  { key: "inboundAnswered", aliases: ["Inbound Calls Answered"] },
  { key: "inboundMissed", aliases: ["Inbound Calls Missed"] },
  { key: "obAttempted", aliases: ["Outbound Click to Call Attempted"] },
  { key: "obAnswered", aliases: ["Outbound Click to Call Answered"] },
  { key: "callsHandled", aliases: ["Calls Handled"] },
  { key: "connected", aliases: ["Connected"] },
  { key: "notConnected", aliases: ["Not Connected"] },
  { key: "availableDuration", aliases: ["Available Duration"] },
  { key: "inCallDuration", aliases: ["In-Call Duration", "In Call Duration"] },
  { key: "breakDuration", aliases: ["Break Duration"] },
  { key: "avgTalkTime", aliases: ["Average Talk time", "Average Talk Time"] },
];

async function resolveProcessId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM process_master WHERE process_name = 'Housing Owner' LIMIT 1",
  );
  return (rows[0]?.id as string) ?? null;
}

export async function uploadSaleRaw(buffer: Buffer, uploadedBy: string) {
  const parsed = parseFlexibleSheet(buffer, SALE_FIELDS, ["oppId", "date", "agentName"]);
  const processId = await resolveProcessId();
  if (!processId) throw new Error('No "Housing Owner" process found');

  const batchId = randomUUID();
  for (const r of parsed.rows) {
    await db.execute(
      `INSERT INTO housing_owner_dashboard_sale_raw
         (id, process_id, upload_batch_id, report_date, agent_id, agent_name, agent_name_norm,
          value, sale_count, payment_mode, package_name, package_type, opp_id, discount_pct,
          tl_name, week_label, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), processId, batchId,
        normalizeDate(r.date),
        normalizeText(r.agentId), normalizeText(r.agentName), normalizeName(r.agentName),
        normalizeNumber(r.value), normalizeNumber(r.count) ?? 1,
        normalizeText(r.paymentMode), normalizeText(r.packageName), normalizeText(r.packageType),
        normalizeText(r.oppId), normalizeNumber(r.discountPct),
        normalizeText(r.tlName), normalizeText(r.week), uploadedBy,
      ],
    );
  }

  return {
    batchId,
    fileType: "sale_raw",
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    duplicateRows: parsed.duplicateRows,
    recognizedColumns: parsed.recognizedColumns,
    additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns,
    preview: parsed.previewRaw,
  };
}

export async function uploadCdrRaw(buffer: Buffer, uploadedBy: string) {
  const parsed = parseFlexibleSheet(buffer, CDR_FIELDS, ["uid", "date", "agent"]);
  const processId = await resolveProcessId();
  if (!processId) throw new Error('No "Housing Owner" process found');

  const batchId = randomUUID();
  for (const r of parsed.rows) {
    await db.execute(
      `INSERT INTO housing_owner_dashboard_cdr_raw
         (id, process_id, upload_batch_id, report_date, uid, agent_name, agent_name_norm, email,
          tl_name, am_name, total_calls, inbound_calls_offered, inbound_calls_answered,
          inbound_calls_missed, outbound_click_to_call_attempted, outbound_click_to_call_answered,
          calls_handled, connected, not_connected, available_duration_seconds,
          in_call_duration_seconds, break_duration_seconds, average_talk_time_seconds, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(), processId, batchId,
        normalizeDate(r.date),
        normalizeText(r.uid), normalizeText(r.agent), normalizeName(r.agent), normalizeText(r.email),
        normalizeText(r.tlName), normalizeText(r.am),
        normalizeNumber(r.totalCalls), normalizeNumber(r.inboundOffered), normalizeNumber(r.inboundAnswered),
        normalizeNumber(r.inboundMissed), normalizeNumber(r.obAttempted), normalizeNumber(r.obAnswered),
        normalizeNumber(r.callsHandled), normalizeNumber(r.connected), normalizeNumber(r.notConnected),
        normalizeDurationSeconds(r.availableDuration), normalizeDurationSeconds(r.inCallDuration),
        normalizeDurationSeconds(r.breakDuration), normalizeDurationSeconds(r.avgTalkTime),
        uploadedBy,
      ],
    );
  }

  return {
    batchId,
    fileType: "cdr_raw",
    totalRows: parsed.totalRows,
    validRows: parsed.validRows,
    duplicateRows: parsed.duplicateRows,
    recognizedColumns: parsed.recognizedColumns,
    additionalColumns: parsed.additionalColumns,
    missingOptionalColumns: parsed.missingOptionalColumns,
    preview: parsed.previewRaw,
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
  const saleWhere = dateClause("s", f, saleParams) +
    (f.tlName ? " AND s.tl_name = ?" : "") + (f.agentName ? " AND s.agent_name_norm = ?" : "");
  if (f.tlName) saleParams.push(f.tlName);
  if (f.agentName) saleParams.push(f.agentName);

  const [[saleKpi]] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(value),0) totalSalesValue, COALESCE(SUM(sale_count),0) totalSalesCount,
            COUNT(DISTINCT agent_name_norm) uniqueAgents
       FROM housing_owner_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        ${saleWhere}`,
    saleParams,
  );

  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams) +
    (f.tlName ? " AND c.tl_name = ?" : "") + (f.agentName ? " AND c.agent_name_norm = ?" : "");
  if (f.tlName) cdrParams.push(f.tlName);
  if (f.agentName) cdrParams.push(f.agentName);

  const [[cdrKpi]] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(total_calls),0) totalCalls, COALESCE(SUM(connected),0) totalConnected,
            COALESCE(SUM(not_connected),0) totalNotConnected, COALESCE(SUM(calls_handled),0) callsHandled,
            COALESCE(SUM(inbound_calls_offered),0) inboundOffered, COALESCE(SUM(inbound_calls_answered),0) inboundAnswered,
            COALESCE(SUM(inbound_calls_missed),0) inboundMissed,
            COALESCE(SUM(outbound_click_to_call_attempted),0) obAttempted,
            COALESCE(SUM(outbound_click_to_call_answered),0) obAnswered,
            COALESCE(SUM(average_talk_time_seconds),0) sumTalkTime, COUNT(*) cdrRows
       FROM housing_owner_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        ${cdrWhere}`,
    cdrParams,
  );

  const totalSalesValue = Number(saleKpi?.totalSalesValue ?? 0);
  const totalSalesCount = Number(saleKpi?.totalSalesCount ?? 0);
  const totalCalls = Number(cdrKpi?.totalCalls ?? 0);
  const totalConnected = Number(cdrKpi?.totalConnected ?? 0);
  const callsHandled = Number(cdrKpi?.callsHandled ?? 0);
  const bothAvailable = totalSalesCount > 0 && totalCalls > 0;

  return {
    dataSources: { saleRaw: totalSalesCount > 0 || totalSalesValue > 0, cdr: totalCalls > 0 },
    sales: {
      totalSalesValue,
      totalSalesCount,
      averageSaleValue: totalSalesCount > 0 ? totalSalesValue / totalSalesCount : 0,
      uniqueSellingAgents: Number(saleKpi?.uniqueAgents ?? 0),
    },
    calling: {
      totalCalls,
      totalConnected,
      totalNotConnected: Number(cdrKpi?.totalNotConnected ?? 0),
      callsHandled,
      connectionRatePct: totalCalls > 0 ? (totalConnected / totalCalls) * 100 : 0,
      callHandlingRatePct: totalCalls > 0 ? (callsHandled / totalCalls) * 100 : 0,
      averageTalkTimeSeconds: Number(cdrKpi?.cdrRows) > 0 ? Number(cdrKpi.sumTalkTime) / Number(cdrKpi.cdrRows) : 0,
    },
    inbound: {
      offered: Number(cdrKpi?.inboundOffered ?? 0),
      answered: Number(cdrKpi?.inboundAnswered ?? 0),
      missed: Number(cdrKpi?.inboundMissed ?? 0),
      answerRatePct: Number(cdrKpi?.inboundOffered) > 0 ? (Number(cdrKpi.inboundAnswered) / Number(cdrKpi.inboundOffered)) * 100 : 0,
      missRatePct: Number(cdrKpi?.inboundOffered) > 0 ? (Number(cdrKpi.inboundMissed) / Number(cdrKpi.inboundOffered)) * 100 : 0,
    },
    outbound: {
      attempted: Number(cdrKpi?.obAttempted ?? 0),
      answered: Number(cdrKpi?.obAnswered ?? 0),
      connectionRatePct: Number(cdrKpi?.obAttempted) > 0 ? (Number(cdrKpi.obAnswered) / Number(cdrKpi.obAttempted)) * 100 : 0,
    },
    conversion: bothAvailable ? {
      salesConversionPct: (totalSalesCount / totalConnected) * 100,
      salesPer100Connected: (totalSalesCount / totalConnected) * 100,
      revenuePerConnectedCall: totalSalesValue / totalConnected,
      revenuePerHandledCall: callsHandled > 0 ? totalSalesValue / callsHandled : 0,
      averageRevenuePerSale: totalSalesCount > 0 ? totalSalesValue / totalSalesCount : 0,
    } : null,
  };
}

export async function getAgentPerformance(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams) + (f.tlName ? " AND s.tl_name = ?" : "");
  if (f.tlName) saleParams.push(f.tlName);

  const [saleAgg] = await db.execute<RowDataPacket[]>(
    `SELECT agent_name_norm, MAX(agent_name) agentName, MAX(tl_name) tlName,
            SUM(value) salesValue, SUM(sale_count) salesCount
       FROM housing_owner_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND agent_name_norm IS NOT NULL ${saleWhere}
      GROUP BY agent_name_norm`,
    saleParams,
  );

  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams) + (f.tlName ? " AND c.tl_name = ?" : "");
  if (f.tlName) cdrParams.push(f.tlName);

  const [cdrAgg] = await db.execute<RowDataPacket[]>(
    `SELECT agent_name_norm, MAX(agent_name) agentName, MAX(am_name) amName,
            SUM(total_calls) totalCalls, SUM(connected) connected, SUM(calls_handled) callsHandled,
            AVG(average_talk_time_seconds) avgTalkTime
       FROM housing_owner_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        AND agent_name_norm IS NOT NULL ${cdrWhere}
      GROUP BY agent_name_norm`,
    cdrParams,
  );

  const byAgent = new Map<string, Record<string, unknown>>();
  for (const s of saleAgg) {
    byAgent.set(s.agent_name_norm as string, {
      agentKey: s.agent_name_norm, agent: s.agentName, tl: s.tlName, am: null,
      salesCount: Number(s.salesCount ?? 0), salesValue: Number(s.salesValue ?? 0),
      totalCalls: 0, connected: 0, callsHandled: 0, avgTalkTime: 0,
    });
  }
  for (const c of cdrAgg) {
    const key = c.agent_name_norm as string;
    const existing = byAgent.get(key) ?? {
      agentKey: key, agent: c.agentName, tl: null, am: c.amName,
      salesCount: 0, salesValue: 0, totalCalls: 0, connected: 0, callsHandled: 0, avgTalkTime: 0,
    };
    existing.am = c.amName;
    existing.totalCalls = Number(c.totalCalls ?? 0);
    existing.connected = Number(c.connected ?? 0);
    existing.callsHandled = Number(c.callsHandled ?? 0);
    existing.avgTalkTime = Number(c.avgTalkTime ?? 0);
    byAgent.set(key, existing);
  }

  return Array.from(byAgent.values()).map((a) => {
    const connected = a.connected as number;
    const salesCount = a.salesCount as number;
    const salesValue = a.salesValue as number;
    return {
      ...a,
      connectionPct: (a.totalCalls as number) > 0 ? (connected / (a.totalCalls as number)) * 100 : 0,
      conversionPct: connected > 0 ? (salesCount / connected) * 100 : 0,
      avgSale: salesCount > 0 ? salesValue / salesCount : 0,
      revenuePerConnected: connected > 0 ? salesValue / connected : 0,
    };
  }).sort((a, b) => (b.salesValue as number) - (a.salesValue as number));
}

export async function getDailyTrend(f: DashboardFilters) {
  const saleParams: unknown[] = [];
  const saleWhere = dateClause("s", f, saleParams);
  const [saleDaily] = await db.execute<RowDataPacket[]>(
    `SELECT report_date, SUM(value) salesValue, SUM(sale_count) salesCount
       FROM housing_owner_dashboard_sale_raw s
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_sale_raw ORDER BY created_at DESC LIMIT 1)
        AND report_date IS NOT NULL ${saleWhere}
      GROUP BY report_date ORDER BY report_date`,
    saleParams,
  );
  const cdrParams: unknown[] = [];
  const cdrWhere = dateClause("c", f, cdrParams);
  const [cdrDaily] = await db.execute<RowDataPacket[]>(
    `SELECT report_date, SUM(total_calls) calls, SUM(connected) connected
       FROM housing_owner_dashboard_cdr_raw c
      WHERE upload_batch_id = (SELECT upload_batch_id FROM housing_owner_dashboard_cdr_raw ORDER BY created_at DESC LIMIT 1)
        AND report_date IS NOT NULL ${cdrWhere}
      GROUP BY report_date ORDER BY report_date`,
    cdrParams,
  );
  const byDate = new Map<string, Record<string, unknown>>();
  for (const s of saleDaily) {
    const d = String(s.report_date).slice(0, 10);
    byDate.set(d, { date: d, salesValue: Number(s.salesValue ?? 0), salesCount: Number(s.salesCount ?? 0), calls: 0, connected: 0 });
  }
  for (const c of cdrDaily) {
    const d = String(c.report_date).slice(0, 10);
    const existing = byDate.get(d) ?? { date: d, salesValue: 0, salesCount: 0, calls: 0, connected: 0 };
    existing.calls = Number(c.calls ?? 0);
    existing.connected = Number(c.connected ?? 0);
    byDate.set(d, existing);
  }
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export async function getFilterOptions() {
  const [tls] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT tl_name FROM housing_owner_dashboard_sale_raw WHERE tl_name IS NOT NULL
     UNION SELECT DISTINCT tl_name FROM housing_owner_dashboard_cdr_raw WHERE tl_name IS NOT NULL`,
  );
  const [dataStatus] = await db.execute<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM housing_owner_dashboard_sale_raw) saleRows,
       (SELECT COUNT(*) FROM housing_owner_dashboard_cdr_raw) cdrRows`,
  );
  return {
    tlNames: tls.map((r) => r.tl_name as string).filter(Boolean).sort(),
    saleRawLoaded: Number(dataStatus[0]?.saleRows ?? 0) > 0,
    cdrLoaded: Number(dataStatus[0]?.cdrRows ?? 0) > 0,
  };
}
