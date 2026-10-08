import { querySource } from "../../db/sourceDb.js";
import type { CallMasterFilters } from "./call-master.service.js";

function obFilter(ids?: number[]) {
  if (!ids || ids.length === 0) return { clause: "", params: [] as number[] };
  return { clause: ` AND d.client_id IN (${ids.map(() => "?").join(",")})`, params: ids };
}

export async function getOBSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<{
    total: number; sales: number; conversion: number; avg_quality: number;
    avg_duration: number; opening_pct: number;
  }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conversion,
      ROUND(AVG((d.Opening+d.Offered+d.ObjectionHandling+d.PrepaidPitch+d.UpsellingEfforts+d.OfferUrgency)/6.0*100),2) AS avg_quality,
      ROUND(AVG(LengthSec)/60,2) AS avg_duration,
      ROUND(SUM(CASE WHEN d.Opening=1 OR d.Opening='1' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_pct
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? null;
}

export async function getOBDailyTrend(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ date: string; calls: number; sales: number; conversion: number }>(
    `SELECT DATE_FORMAT(d.CallDate,'%Y-%m-%d') AS date,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conversion
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY DATE_FORMAT(d.CallDate,'%Y-%m-%d') ORDER BY date ASC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBHourly(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ hour: number; calls: number; sales: number }>(
    `SELECT HOUR(d.CallDate) AS hour,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY HOUR(d.CallDate) ORDER BY hour ASC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBAgentPerf(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{
    agent: string; calls: number; sales: number;
    conversion: number; avg_quality: number;
  }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS agent,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conversion,
      ROUND(AVG((d.Opening+d.Offered+d.ObjectionHandling+d.PrepaidPitch+d.UpsellingEfforts+d.OfferUrgency)/6.0*100),2) AS avg_quality
     FROM db_external.CallDetails d
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
       AND d.AgentName IS NOT NULL AND d.AgentName != ''
     GROUP BY d.AgentName HAVING calls >= 3
     ORDER BY conversion DESC LIMIT 50`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBAgentDaily(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{
    date: string; agent: string; calls: number; sales: number; conversion: number;
  }>(
    `SELECT DATE_FORMAT(d.CallDate,'%Y-%m-%d') AS date,
      ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS agent,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conversion
     FROM db_external.CallDetails d
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
       AND d.AgentName IS NOT NULL AND d.AgentName != ''
     GROUP BY DATE_FORMAT(d.CallDate,'%Y-%m-%d'), d.AgentName ORDER BY date ASC LIMIT 2000`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBDisposition(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ disposition: string; calls: number; sales: number }>(
    `SELECT COALESCE(NULLIF(CallDisposition,''),'Unknown') AS disposition,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY CallDisposition ORDER BY calls DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBProductMix(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ product: string; calls: number; sales: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(ProductOffering,''),'Unknown') AS product,
      COUNT(*) AS calls,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
       AND ProductOffering IS NOT NULL AND ProductOffering != ''
     GROUP BY ProductOffering ORDER BY calls DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBNotInterested(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ reason: string; count: number }>(
    `SELECT NotInterestedBucketReason AS reason, COUNT(*) AS count
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
       AND NotInterestedBucketReason IS NOT NULL
       AND NotInterestedBucketReason != ''
       AND NotInterestedBucketReason != 'None'
     GROUP BY NotInterestedBucketReason ORDER BY count DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOBQualityParams(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<Record<string, number>>(
    `SELECT
      ROUND(AVG(CASE WHEN Opening=1 OR Opening='1' THEN 1 ELSE 0 END)*100,1) AS Opening,
      ROUND(AVG(CASE WHEN Offered=1 OR Offered='1' THEN 1 ELSE 0 END)*100,1) AS Offered,
      ROUND(AVG(CASE WHEN ObjectionHandling=1 OR ObjectionHandling='1' THEN 1 ELSE 0 END)*100,1) AS ObjectionHandling,
      ROUND(AVG(CASE WHEN PrepaidPitch=1 OR PrepaidPitch='1' THEN 1 ELSE 0 END)*100,1) AS PrepaidPitch,
      ROUND(AVG(CASE WHEN UpsellingEfforts=1 OR UpsellingEfforts='1' THEN 1 ELSE 0 END)*100,1) AS UpsellingEfforts,
      ROUND(AVG(CASE WHEN OfferUrgency=1 OR OfferUrgency='1' THEN 1 ELSE 0 END)*100,1) AS OfferUrgency,
      ROUND(AVG(CASE WHEN LOWER(COALESCE(SensitiveWordUsed,'none'))='none' THEN 1 ELSE 0 END)*100,1) AS SensitiveWordUsed
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? {};
}
