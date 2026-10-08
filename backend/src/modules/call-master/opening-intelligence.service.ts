import { querySource } from "../../db/sourceDb.js";
import type { CallMasterFilters } from "./call-master.service.js";

type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

function obFilter(ids?: number[]) {
  if (!ids || ids.length === 0) return { clause: "", params: [] as number[] };
  return { clause: ` AND client_id IN (${ids.map(() => "?").join(",")})`, params: ids };
}

function periodExpr(p: Period) {
  switch (p) {
    case "weekly":    return "CONCAT(YEAR(CallDate),'-W',LPAD(WEEK(CallDate,1),2,'0'))";
    case "monthly":   return "DATE_FORMAT(CallDate,'%Y-%m')";
    case "quarterly": return "CONCAT(YEAR(CallDate),'-Q',QUARTER(CallDate))";
    case "yearly":    return "YEAR(CallDate)";
    default:          return "DATE_FORMAT(CallDate,'%Y-%m-%d')";
  }
}

const OPENING_GOOD = `(OpeningPitchCategory LIKE '%Greeting%' AND OpeningPitchCategory LIKE '%Self-Introduction%')`;
const OPENING_FULL = `(OpeningPitchCategory LIKE '%Greeting%' AND OpeningPitchCategory LIKE '%Self-Introduction%' AND OpeningPitchCategory LIKE '%Company Introduction%')`;
const OPENING_NONE = `(OpeningPitchCategory IS NULL OR OpeningPitchCategory='' OR OpeningPitchCategory='None' OR OpeningPitchCategory='null' OR OpeningPitchCategory='["None"]' OR OpeningPitchCategory='["null"]')`;
const OPENING_SCORE = `CASE
  WHEN OpeningPitchCategory LIKE '%Greeting%' AND OpeningPitchCategory LIKE '%Self-Introduction%' AND OpeningPitchCategory LIKE '%Company Introduction%' THEN 100
  WHEN OpeningPitchCategory LIKE '%Greeting%' AND OpeningPitchCategory LIKE '%Self-Introduction%' THEN 75
  WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 40
  WHEN OpeningPitchCategory IS NULL OR OpeningPitchCategory='' OR OpeningPitchCategory='None' THEN 0
  ELSE 20
END`;
const SALE = `(SaleDone='1' OR SaleDone=1)`;
const CONTEXT_GROUP = `CASE
  WHEN ContactSettingCategory LIKE '%Pitch Same Time%' OR ContactSettingCategory LIKE '%at Once%' OR ContactSettingCategory LIKE '%at once%'
       OR ContactSettingCategory='Feedback&Offer Pitch Same Time' OR ContactSettingCategory='Feedback & Offer Pitch Same Time'
    THEN 'Dual Approach: Feedback & Offer at Once'
  WHEN ContactSettingCategory LIKE '%Order Confirmation%' OR ContactSettingCategory='Order Confirmation'
    THEN 'Order Confirmation'
  WHEN ContactSettingCategory LIKE '%previous call%' OR ContactSettingCategory LIKE '%Follow%'
       OR ContactSettingCategory LIKE '%Setting Call Duration%'
    THEN 'Follow Up'
  WHEN ContactSettingCategory LIKE '%Feedback%' OR ContactSettingCategory LIKE '%Offer%'
    THEN 'Feedback-First Approach then Offer Pitched'
  WHEN ContactSettingCategory IS NULL OR ContactSettingCategory='' OR ContactSettingCategory='None'
    THEN 'Not Set'
  ELSE 'Other'
END`;

export async function getOIExecutiveSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<{
    total: number; opening_good: number; opening_none: number; opening_score: number;
    context_set: number; context_none: number; context_score: number; sales: number;
  }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END) AS opening_good,
      SUM(CASE WHEN ${OPENING_NONE} THEN 1 ELSE 0 END) AS opening_none,
      ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
      SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!=''
                AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END) AS context_set,
      SUM(CASE WHEN ContactSettingCategory IS NULL OR ContactSettingCategory=''
                OR ContactSettingCategory IN ('None','null') THEN 1 ELSE 0 END) AS context_none,
      ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!=''
                      AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS context_score,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? null;
}

export async function getOpeningByCategory(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ category: string; calls: number; sales: number; conv_pct: number }>(
    `SELECT
      CASE
        WHEN ${OPENING_FULL} THEN 'Full Opening'
        WHEN ${OPENING_GOOD} THEN 'Standard Opening'
        WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
        WHEN ${OPENING_NONE} THEN 'No Opening'
        ELSE 'Other'
      END AS category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY calls DESC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOpeningRawCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ category: string; calls: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(OpeningPitchCategory,''),'None') AS category,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY calls DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOpeningTrend(filters: CallMasterFilters, period: Period = "daily") {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const g = periodExpr(period);
  return querySource<{ period: string; calls: number; opening_good_pct: number; opening_score: number; conv_pct: number }>(
    `SELECT ${g} AS period,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_good_pct,
      ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY 1 ASC LIMIT 120`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOpeningByDimension(
  filters: CallMasterFilters,
  dim: "client_id" | "AgentName" | "campaign_id" = "client_id"
) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ dim: string; calls: number; opening_good_pct: number; opening_score: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(CAST(${dim} AS CHAR),''),'Unknown') AS dim,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_good_pct,
      ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY calls DESC LIMIT 30`,
    [startDate, endDate, ...f.params]
  );
}

export async function getContextByCategory(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ category: string; calls: number; sales: number; conv_pct: number }>(
    `SELECT (${CONTEXT_GROUP}) AS category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY calls DESC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getContextTrend(filters: CallMasterFilters, period: Period = "daily") {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const g = periodExpr(period);
  return querySource<{ period: string; calls: number; context_set_pct: number; conv_pct: number }>(
    `SELECT ${g} AS period, COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!=''
                      AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS context_set_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY 1 ASC LIMIT 120`,
    [startDate, endDate, ...f.params]
  );
}

export async function getContextByDimension(
  filters: CallMasterFilters,
  dim: "client_id" | "AgentName" | "campaign_id" = "client_id"
) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ dim: string; calls: number; context_set_pct: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(CAST(${dim} AS CHAR),''),'Unknown') AS dim,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!=''
                      AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS context_set_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY calls DESC LIMIT 30`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOpeningVsSales(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ opening_category: string; calls: number; sales: number; conv_pct: number; opening_score: number }>(
    `SELECT
      CASE
        WHEN ${OPENING_FULL} THEN 'Full Opening'
        WHEN ${OPENING_GOOD} THEN 'Standard Opening'
        WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
        WHEN ${OPENING_NONE} THEN 'No Opening'
        ELSE 'Other'
      END AS opening_category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct,
      ROUND(AVG(${OPENING_SCORE}),2) AS opening_score
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY conv_pct DESC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOpeningLeaderboard(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);

  const [top, bottom, clients, campaigns] = await Promise.all([
    querySource<{ name: string; calls: number; opening_pct: number; opening_score: number; conv_pct: number }>(
      `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS name,
        COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_pct,
        ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails d
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
       WHERE d.CallDate BETWEEN ? AND ?${f.clause}
         AND d.AgentName IS NOT NULL AND d.AgentName != ''
       GROUP BY d.AgentName HAVING calls >= 5
       ORDER BY opening_score DESC LIMIT 10`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ name: string; calls: number; opening_pct: number; opening_score: number; conv_pct: number }>(
      `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS name,
        COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_pct,
        ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails d
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
       WHERE d.CallDate BETWEEN ? AND ?${f.clause}
         AND d.AgentName IS NOT NULL AND d.AgentName != ''
       GROUP BY d.AgentName HAVING calls >= 5
       ORDER BY opening_score ASC LIMIT 5`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ name: string; calls: number; opening_pct: number; conv_pct: number }>(
      `SELECT CAST(client_id AS CHAR) AS name, COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_pct,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails
       WHERE CallDate BETWEEN ? AND ?${f.clause}
       GROUP BY client_id ORDER BY opening_pct DESC LIMIT 10`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ name: string; calls: number; opening_pct: number; conv_pct: number }>(
      `SELECT COALESCE(NULLIF(campaign_id,''),'Unknown') AS name, COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_pct,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails
       WHERE CallDate BETWEEN ? AND ?${f.clause}
       GROUP BY campaign_id ORDER BY opening_pct DESC LIMIT 10`,
      [startDate, endDate, ...f.params]
    ),
  ]);

  return { top_agents: top, bottom_agents: bottom, top_clients: clients, top_campaigns: campaigns };
}

export async function getOIAIInsights(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);

  const [[metrics], bestOpening, bestContext] = await Promise.all([
    querySource<{ total: number; opening_good_pct: number; context_set_pct: number; opening_score: number; conv_pct: number }>(
      `SELECT COUNT(*) AS total,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS opening_good_pct,
        ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!=''
                        AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS context_set_pct,
        ROUND(AVG(${OPENING_SCORE}),2) AS opening_score,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ category: string; conv_pct: number }>(
      `SELECT
        CASE WHEN ${OPENING_FULL} THEN 'Full Opening' WHEN ${OPENING_GOOD} THEN 'Standard Opening'
             WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
             WHEN ${OPENING_NONE} THEN 'No Opening' ELSE 'Other' END AS category,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}
       GROUP BY 1 ORDER BY conv_pct DESC LIMIT 1`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ category: string; conv_pct: number }>(
      `SELECT (${CONTEXT_GROUP}) AS category,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}
       GROUP BY 1 ORDER BY conv_pct DESC LIMIT 1`,
      [startDate, endDate, ...f.params]
    ),
  ]);

  const insights: Array<{ type: string; title: string; what: string; why: string; impact: string; action: string }> = [];
  if (!metrics) return insights;

  const { opening_good_pct: ogp, context_set_pct: csp, opening_score: osc, conv_pct: cvp } = metrics;

  if (ogp < 50) insights.push({ type: "alert", title: "Low Opening Compliance", what: `Only ${ogp}% of calls follow proper opening script`, why: "Agents skipping greeting or self-introduction", impact: `~${Math.round((100 - ogp) / 100 * (metrics.total ?? 0))} calls missing opening`, action: "Conduct refresher on opening script; monitor daily" });
  else if (ogp >= 80) insights.push({ type: "success", title: "Strong Opening Compliance", what: `${ogp}% of calls have proper opening`, why: "Consistent coaching and monitoring", impact: "Positive CX signal", action: "Maintain current coaching cadence" });

  if (csp < 60) insights.push({ type: "alert", title: "Context Setting Gap", what: `Only ${csp}% of calls set proper contact context`, why: "Agents not confirming call purpose or prior interactions", impact: "Lower conversion potential", action: "Add context-setting to call checklist" });

  if (bestOpening.length > 0 && bestOpening[0].conv_pct > cvp + 2) insights.push({ type: "opportunity", title: `${bestOpening[0].category} Drives Higher Conversion`, what: `${bestOpening[0].category} achieves ${bestOpening[0].conv_pct}% vs ${cvp}% average`, why: "Opening structure directly correlates with sales outcome", impact: `+${(bestOpening[0].conv_pct - cvp).toFixed(1)}pp conversion uplift if adopted broadly`, action: "Make full opening script mandatory" });

  if (bestContext.length > 0 && bestContext[0].conv_pct > cvp + 2) insights.push({ type: "opportunity", title: `Context: "${bestContext[0].category}" is Best Approach`, what: `This approach converts at ${bestContext[0].conv_pct}% vs ${cvp}% average`, why: "Customers respond better to structured context-setting", impact: `+${(bestContext[0].conv_pct - cvp).toFixed(1)}pp if rolled out`, action: "Train all agents on this context-setting approach" });

  if (osc < 50) insights.push({ type: "alert", title: "Opening Quality Score Below Threshold", what: `Opening score is ${osc}/100`, why: "Agents not completing full opening sequence", impact: "Missed opportunities to build rapport", action: "Focus on all 3 components: Greeting + Self-Intro + Company Intro" });

  if (insights.length === 0) insights.push({ type: "success", title: "Opening & Context Metrics On Track", what: "All opening and context metrics are within expected range", why: "Consistent training and monitoring", impact: "Stable conversion baseline", action: "Continue current practices" });

  return insights;
}
