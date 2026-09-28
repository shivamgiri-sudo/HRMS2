import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNamedPool } from "../kpi/kpi-studio.pools.js";

/**
 * Inbound Process's own "SOP" (Inbound Process.docx) is not a manual-paste
 * procedure -- it is the literal source of a Google Apps Script that reads
 * LIVE data via JDBC from dialer_db and writes daily per-client call-centre
 * KPIs into a Google Sheet (fetchGNCData/fetchBellavitaData/fetchCloviaData/
 * fetchNeemansData/fetchViegaData/fetchExicomData/fetchDUBangladeshData).
 * Those exact CDR tables already exist live in this project's own dialer_db
 * (NAMED_POOLS.dialer, confirmed live 2026-09-09: 150K-830K rows each,
 * current to the day before). This module ports each client's query
 * verbatim (same table, same campaign filters, same VDCL/QueueDuration
 * conventions) and lands the result in mas_hrms's inbound_cdr_daily_actual
 * (sql/1712), per the Database Boundary Rule -- dialer_db stays read-only.
 *
 * Each query is reproduced AS WRITTEN in the SOP, not paraphrased into one
 * shared template -- GNC/Bellavita/Clovia each carry a VDCL/QueueDuration
 * nuance (a dialer "virtual" agent counted as answered only when its queue
 * time is exactly 0) that Neemans/Viega/Exicom/DU Bangladesh's simpler
 * queries do not have. Flattening these into a single generic shape would
 * silently change what "answered" means for three of the seven clients.
 */

export type InboundClientCode =
  | "GNC" | "BELLAVITA" | "CLOVIA" | "NEEMANS" | "VIEGA" | "EXICOM" | "DU_BANGLADESH";

interface DailyRow {
  CallDate: string;
  LoginCount: number | null;
  Call_Offered: number;
  Call_Answered: number;
  AL: number | null;
  SL: number | null;
  ACHT_In_Sec: number | null;
  Repeat_Percent: number | null;
  FCR_Percent: number | null;
  tagging_count: number | null;
}
interface MandateRow {
  CallDate: string;
  Mandate: number;
  Required_Login: number;
  Login_Count: number;
  Deficit_Manpower: number;
}

const GNC_CAMPAIGNS = [
  "GNC_Order_Related", "GNC_Product_Quality", "GNC_Other_Queries",
  "GNC_Product_Info", "GNC_Offer_Order", "GNC_Authentication",
];
const BELLAVITA_CAMPAIGNS = [
  "H_Bellavita_Luxury", "E_Bellavita_Organic", "E_Bellavita_Luxury", "H_Bellavita_Organic",
  "H_Bevzilla_Complaint", "H_Bevzilla_CC_Agent", "E_Bevzilla_CC_Agent", "H_Bevzilla_Order",
  "E_Bevzilla_Order", "E_Bevzilla_Complaint", "E_Emb_Existing_Order", "H_Bevzilla_Product",
  "H_Emb_New_Order", "H_Emb_Existing_Order", "E_Bevzilla_Product", "E_Emb_New_Order",
];
const CLOVIA_CAMPAIGNS = ["Clovia_English", "Clovia_Hindi"];
const DU_BANGLADESH_CAMPAIGNS = ["DU_Bangladesh_Bangla", "DU_Bangladesh_Eng", "DU_Bangladesh_Hindi"];
const EXICOM_CAMPAIGNS = ["Exicom_TC_Battery", "Exicom_EV_Battery", "EV_Charger833"];

function inList(vals: string[]): string {
  return vals.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
}

/** GNC/DU Bangladesh's cdr_in_4-style "VDCL zero-queue counts as answered" query. */
function complexQuery(table: string, campaigns: string[]): string {
  const list = inList(campaigns);
  return `WITH aggr AS (
    SELECT DATE(CallDate) AS CallDate,
      COUNT(DISTINCT CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN AgentId END) AS LoginCount,
      SUM(CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS Call_Offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME') OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS Call_Answered,
      SUM(CASE WHEN CampaignName IN (${list}) AND TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME' AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS SL_Numerator,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END), 0) AS ACHT_In_Sec,
      COUNT(DISTINCT CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS UniquePhones
    FROM ${table}
    WHERE CallDate >= ? AND CampaignName IN (${list})
    GROUP BY DATE(CallDate)
  )
  SELECT CallDate, LoginCount, Call_Offered, Call_Answered,
    ROUND(Call_Answered * 100.0 / NULLIF(Call_Offered, 0), 2) AS AL,
    ROUND(SL_Numerator * 100.0 / NULLIF(Call_Offered, 0), 2) AS SL,
    ACHT_In_Sec,
    ROUND((Call_Offered - UniquePhones) * 100.0 / NULLIF(Call_Offered, 0), 2) AS Repeat_Percent,
    NULL AS FCR_Percent, NULL AS tagging_count
  FROM aggr ORDER BY CallDate DESC`;
}
function complexMandateQuery(table: string, campaigns: string[], mandate: number, requiredLogin: number): string {
  const list = inList(campaigns);
  return `SELECT CallDate, ${mandate} AS Mandate, ${requiredLogin} As Required_Login, COUNT(DISTINCT AgentId) AS Login_Count, (${requiredLogin} - COUNT(DISTINCT AgentId)) AS Deficit_Manpower
    FROM ${table} WHERE CallDate >= ? AND AgentId <> 'VDCL'
    AND CampaignName IN (${list})
    GROUP BY CallDate ORDER BY CallDate DESC`;
}

/** Bellavita's cdr_in_11_5 query, with FCR/tagging joined from data_master_in. */
function bellavitaQuery(fcrClientId: number): string {
  const list = inList(BELLAVITA_CAMPAIGNS);
  return `WITH fcr_summary AS (
    SELECT DATE(CallDate) AS CallDate,
      ROUND(100 * SUM(CASE WHEN Field28 = 'FCR' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS FCR_Percent,
      SUM(CASE WHEN Field1 = 'Inbound' THEN 1 ELSE 0 END) AS tagging_count
    FROM data_master_in
    WHERE CallDate >= ? AND ClientId = ${fcrClientId} AND Field13 = 'Inbound'
    GROUP BY DATE(CallDate)
  ),
  aggr AS (
    SELECT CallDate,
      COUNT(DISTINCT CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN AgentId END) AS LoginCount,
      SUM(CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS Call_Offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME') OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS Call_Answered,
      SUM(CASE WHEN CampaignName IN (${list}) AND TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME' AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS SL_Numerator,
      AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END) AS ACHT_In_Sec,
      COUNT(DISTINCT CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS UniquePhones
    FROM cdr_in_11_5
    WHERE CallDate >= ?
    GROUP BY CallDate
  )
  SELECT a.CallDate, a.LoginCount, a.Call_Offered, a.Call_Answered,
    ROUND(a.Call_Answered * 100.0 / NULLIF(a.Call_Offered, 0), 2) AS AL,
    ROUND(a.SL_Numerator * 100.0 / NULLIF(a.Call_Offered, 0), 2) AS SL,
    ROUND(a.ACHT_In_Sec, 0) AS ACHT_In_Sec,
    ROUND((a.Call_Offered - a.UniquePhones) * 100.0 / NULLIF(a.Call_Offered, 0), 2) AS Repeat_Percent,
    COALESCE(f.FCR_Percent, 0) AS FCR_Percent,
    COALESCE(f.tagging_count, 0) AS tagging_count
  FROM aggr a
  LEFT JOIN fcr_summary f ON a.CallDate = f.CallDate
  ORDER BY a.CallDate DESC`;
}
function bellavitaMandateQuery(): string {
  const list = inList(BELLAVITA_CAMPAIGNS);
  return `SELECT CallDate, 14 AS Mandate, 12 As Required_Login, COUNT(DISTINCT AgentId) AS Login_Count, (12 - COUNT(DISTINCT AgentId)) AS Deficit_Manpower
    FROM cdr_in_11_5 WHERE CallDate >= ? AND AgentId <> 'VDCL'
    AND CampaignName IN (${list})
    GROUP BY CallDate ORDER BY CallDate DESC`;
}

/** Clovia's cdr_in_250 query -- same shape as complexQuery but no separate CTE in the SOP; behaviourally identical. */
function cloviaQuery(): string {
  const list = inList(CLOVIA_CAMPAIGNS);
  return `SELECT CallDate,
    COUNT(DISTINCT CASE WHEN (CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME') THEN AgentId END) AS LoginCount,
    SUM(CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS Call_Offered,
    SUM(CASE WHEN (AgentId != 'VDCL' AND CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME') OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS Call_Answered,
    ROUND(SUM(CASE WHEN (AgentId != 'VDCL' AND CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME') OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END), 0), 2) AS AL,
    ROUND(SUM(CASE WHEN CampaignName IN (${list}) AND TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME' AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN CampaignName IN (${list}) AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END), 0), 2) AS SL,
    ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END), 0) AS ACHT_In_Sec,
    ROUND((COUNT(*) - COUNT(DISTINCT PhoneNumber)) * 100.0 / NULLIF(COUNT(*), 0), 2) AS Repeat_Percent,
    NULL AS FCR_Percent, NULL AS tagging_count
    FROM cdr_in_250 WHERE CallDate >= ?
    GROUP BY CallDate ORDER BY CallDate DESC`;
}
function cloviaMandateQuery(): string {
  const list = inList(CLOVIA_CAMPAIGNS);
  return `SELECT CallDate, 7 AS Mandate, 6 As Required_Login, COUNT(DISTINCT AgentId) AS Login_Count, (6 - COUNT(DISTINCT AgentId)) AS Deficit_Manpower
    FROM cdr_in_250 WHERE CallDate >= ? AND AgentId <> 'VDCL'
    AND CampaignName IN (${list})
    GROUP BY CallDate ORDER BY CallDate DESC`;
}

/** Neemans' cdr_in_249 query -- no VDCL/QueueDuration nuance, SL threshold is 30s not 20s, and FCR is joined in. */
function neemansQuery(fcrClientId: number): string {
  return `WITH fcr_summary AS (
    SELECT DATE(CallDate) AS CallDate,
      ROUND(100 * SUM(CASE WHEN Field2='FCR' THEN 1 ELSE 0 END)/NULLIF(COUNT(Field2),0),2) AS FCR_Percent,
      SUM(CASE WHEN Field1='Inbound' THEN 1 ELSE 0 END) AS tagging_count
    FROM data_master_in WHERE CallDate >= ? AND ClientId = ${fcrClientId} AND Field1='Inbound'
    GROUP BY DATE(CallDate)
  ),
  kpi_daily AS (
    SELECT DATE(CallDate) AS CallDate,
      COUNT(*) AS Call_Offered,
      COUNT(DISTINCT PhoneNumber) AS Unique_Phones,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS Call_Answered,
      ROUND(SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END)*100.0 / NULLIF(COUNT(*),0),2) AS AL,
      ROUND(SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END)*100.0 / NULLIF(COUNT(*) - SUM(CASE WHEN AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END),0),2) AS SL,
      ROUND(AVG(CallDurationSecond),0) AS ACHT_In_Sec,
      ROUND(100 * (COUNT(*) - COUNT(DISTINCT PhoneNumber)) / NULLIF(COUNT(*),0),2) AS Repeat_Percent
    FROM cdr_in_249 WHERE CampaignName = 'Neemans_IB' AND CallDate >= ?
    GROUP BY DATE(CallDate)
  )
  SELECT k.CallDate, NULL AS LoginCount, k.Call_Offered, k.Call_Answered, k.AL, k.SL, k.ACHT_In_Sec, k.Repeat_Percent, COALESCE(f.FCR_Percent, 0) AS FCR_Percent, COALESCE(f.tagging_count, 0) AS tagging_count
  FROM kpi_daily k LEFT JOIN fcr_summary f ON k.CallDate = f.CallDate
  ORDER BY k.CallDate DESC`;
}
function neemansMandateQuery(): string {
  return `SELECT CallDate, 10 AS Mandate, 10 As Required_Login, COUNT(DISTINCT AgentId) AS Login_Count, (10 - COUNT(DISTINCT AgentId)) AS Deficit_Manpower
    FROM cdr_in_249 WHERE CallDate >= ? AND AgentId <> 'VDCL' AND CampaignName = 'Neemans_IB'
    GROUP BY CallDate ORDER BY CallDate DESC`;
}

/** Shared shape for Viega/Exicom/DU Bangladesh's simple no-FCR queries (SL threshold 30s, no VDCL/QueueDuration nuance). */
function simpleQuery(table: string, campaignClause: string): string {
  return `SELECT DATE(CallDate) AS CallDate, NULL AS LoginCount,
      COUNT(*) AS Call_Offered,
      COUNT(DISTINCT PhoneNumber) AS Unique_Phones,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS Call_Answered,
      ROUND(SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END)*100.0 / NULLIF(COUNT(*),0),2) AS AL,
      ROUND(SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END)*100.0 / NULLIF(COUNT(*) - SUM(CASE WHEN AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END),0),2) AS SL,
      ROUND(AVG(CallDurationSecond),0) AS ACHT_In_Sec,
      ROUND(100 * (COUNT(*) - COUNT(DISTINCT PhoneNumber)) / NULLIF(COUNT(*),0),2) AS Repeat_Percent,
      NULL AS FCR_Percent, NULL AS tagging_count
    FROM ${table} WHERE ${campaignClause} AND CallDate >= ?
    GROUP BY DATE(CallDate)
    ORDER BY CallDate DESC`;
}
function simpleMandateQuery(table: string, campaignClause: string, mandate: number, requiredLogin: number): string {
  return `SELECT CallDate, ${mandate} AS Mandate, ${requiredLogin} As Required_Login, COUNT(DISTINCT AgentId) AS Login_Count, (${requiredLogin} - COUNT(DISTINCT AgentId)) AS Deficit_Manpower
    FROM ${table} WHERE CallDate >= ? AND AgentId <> 'VDCL' AND ${campaignClause}
    GROUP BY CallDate ORDER BY CallDate DESC`;
}

interface ClientPlan {
  code: InboundClientCode;
  processName: string;
  dailySql: string;
  mandateSql: string;
}

/** fcrClientIds mirror CONFIG.fcrClientIds' documented defaults in the SOP script (Bellavita=375, Neemans=475). */
/** Exported so unit tests can assert on the exact SQL text without needing a live dialer_db connection. */
export function buildPlans(): ClientPlan[] {
  return [
    { code: "GNC", processName: "GNC", dailySql: complexQuery("cdr_in_4", GNC_CAMPAIGNS), mandateSql: complexMandateQuery("cdr_in_4", GNC_CAMPAIGNS, 8, 6) },
    { code: "BELLAVITA", processName: "Bella-Vita Organic", dailySql: bellavitaQuery(375), mandateSql: bellavitaMandateQuery() },
    { code: "CLOVIA", processName: "Clovia", dailySql: cloviaQuery(), mandateSql: cloviaMandateQuery() },
    { code: "NEEMANS", processName: "Neemans Private Limited", dailySql: neemansQuery(475), mandateSql: neemansMandateQuery() },
    { code: "VIEGA", processName: "Viega", dailySql: simpleQuery("cdr_in_249", `CampaignName = 'Viega'`), mandateSql: simpleMandateQuery("cdr_in_249", `CampaignName = 'Viega'`, 2, 2) },
    { code: "EXICOM", processName: "Exicom", dailySql: simpleQuery("cdr_in_9", `CampaignName IN (${inList(EXICOM_CAMPAIGNS)})`), mandateSql: simpleMandateQuery("cdr_in_9", `CampaignName IN (${inList(EXICOM_CAMPAIGNS)})`, 5, 5) },
    { code: "DU_BANGLADESH", processName: "DU Digital", dailySql: simpleQuery("cdr_in_4", `CampaignName IN (${inList(DU_BANGLADESH_CAMPAIGNS)})`), mandateSql: simpleMandateQuery("cdr_in_4", `CampaignName IN (${inList(DU_BANGLADESH_CAMPAIGNS)})`, 3, 3) },
  ];
}

interface Ref extends RowDataPacket { id: string }

/**
 * mysql2 returns a DATE column as a JS Date object by default (no
 * `dateStrings` option set on this pool) -- `String(new Date(...))` gives
 * "Thu Sep 10 2026 00:00:00 GMT+0530 (India Standard Time)", not an ISO
 * date, so the old `String(row.CallDate).slice(0, 10)` produced "Thu Sep 10"
 * and MySQL rejected it as an invalid date on insert. Caught live on the
 * first real sync run once dialer_db's LAN path came back (2026-09-10).
 *
 * `.toISOString()` is deliberately NOT used to fix this: it converts to
 * UTC, and on this host (IST, UTC+5:30) that rolls a local midnight date
 * back to the previous day -- verified live against a real
 * `SELECT DATE('2026-09-10')`, whose Date object's own toISOString() comes
 * back "2026-09-09T18:30:00.000Z". The LOCAL calendar components
 * (getFullYear/getMonth/getDate) are what the driver's own toString()
 * already shows as correct, so those are used instead.
 */
export function formatCallDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(raw).slice(0, 10);
}

/**
 * Bellavita's and Neemans' queries each carry TWO placeholders (one per CTE
 * that filters on CallDate >= ?), but every plan was bound with a single
 * one-element params array -- the other five clients have exactly one `?`
 * each, so this went unnoticed until a real dialer_db connection actually
 * ran these two queries and MySQL errored on the unbound second `?`.
 * Counting the literal `?` occurrences (the only values ever bound here)
 * is safe and avoids hardcoding a per-plan parameter count that could drift
 * out of sync with the SQL text again.
 */
export function paramsFor(sql: string, value: string): string[] {
  const count = (sql.match(/\?/g) ?? []).length;
  return Array(count).fill(value);
}

export async function syncInboundCdrDaily(
  importedByUserId: string,
  lookbackDays = 30,
): Promise<{ clientResults: Record<string, { rowsUpserted: number; error?: string }> }> {
  const dialerPool = await getNamedPool("dialer");
  const sinceDate = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);

  const [procRows] = await db.execute<Ref[] & RowDataPacket[]>(
    `SELECT id, process_name FROM process_master WHERE process_name IN
      ('GNC','Viega','Exicom','Bella-Vita Organic','Clovia','Neemans Private Limited','DU Digital')
      AND active_status = 1`,
  );
  const processIdByName = new Map((procRows as (Ref & { process_name: string })[]).map((r) => [r.process_name, r.id]));

  const clientResults: Record<string, { rowsUpserted: number; error?: string }> = {};

  for (const plan of buildPlans()) {
    const processId = processIdByName.get(plan.processName);
    if (!processId) {
      clientResults[plan.code] = { rowsUpserted: 0, error: `No active process named "${plan.processName}" found` };
      continue;
    }
    try {
      const [dailyRows] = await dialerPool.query(plan.dailySql, paramsFor(plan.dailySql, sinceDate));
      const [mandateRows] = await dialerPool.query(plan.mandateSql, paramsFor(plan.mandateSql, sinceDate));
      const mandateByDate = new Map(
        (mandateRows as MandateRow[]).map((m) => [formatCallDate(m.CallDate), m]),
      );

      let rowsUpserted = 0;
      for (const row of dailyRows as DailyRow[]) {
        const callDate = formatCallDate(row.CallDate);
        const mandate = mandateByDate.get(callDate);
        await db.execute(
          `INSERT INTO inbound_cdr_daily_actual
             (id, process_id, client_code, call_date, login_count, call_offered, call_answered,
              answer_rate_pct, service_level_pct, acht_seconds, repeat_pct, fcr_pct, tagging_count,
              manpower_mandate, required_login, deficit_manpower, data_source, synced_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'dialer_db_live_sync', NOW(), ?)
           ON DUPLICATE KEY UPDATE
              login_count = VALUES(login_count),
              call_offered = VALUES(call_offered),
              call_answered = VALUES(call_answered),
              answer_rate_pct = VALUES(answer_rate_pct),
              service_level_pct = VALUES(service_level_pct),
              acht_seconds = VALUES(acht_seconds),
              repeat_pct = VALUES(repeat_pct),
              fcr_pct = VALUES(fcr_pct),
              tagging_count = VALUES(tagging_count),
              manpower_mandate = VALUES(manpower_mandate),
              required_login = VALUES(required_login),
              deficit_manpower = VALUES(deficit_manpower),
              synced_at = NOW()`,
          [
            randomUUID(), processId, plan.code, callDate,
            row.LoginCount, row.Call_Offered ?? 0, row.Call_Answered ?? 0,
            row.AL, row.SL, row.ACHT_In_Sec, row.Repeat_Percent,
            row.FCR_Percent, row.tagging_count,
            mandate?.Mandate ?? null, mandate?.Required_Login ?? null, mandate?.Deficit_Manpower ?? null,
            importedByUserId,
          ] as never[],
        );
        rowsUpserted++;
      }
      clientResults[plan.code] = { rowsUpserted };
    } catch (err: unknown) {
      clientResults[plan.code] = { rowsUpserted: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return { clientResults };
}
