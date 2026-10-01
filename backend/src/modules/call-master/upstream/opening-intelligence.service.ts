// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards backend/src/modules/call-master/opening-intelligence.service.ts @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { querySource } from '../upstream-shim/sourceDb.js';
import { CallMasterFilters } from './call-master.service.js';

// ─── SQL helper fragments ─────────────────────────────────────────────────────

const _cf = (ids?: number[]) =>
  ids?.length ? `AND client_id IN (${ids.map(() => '?').join(',')})` : '';

const _p = (s: string, e: string, ids?: number[]) => [s, e, ...(ids ?? [])];

// "Good opening" = at least Greeting + Self-Introduction present
const OPENING_GOOD_EXPR = `(
  OpeningPitchCategory LIKE '%Greeting%'
  AND OpeningPitchCategory LIKE '%Self-Introduction%'
)`;

// "Full opening" = all 3 elements
const OPENING_FULL_EXPR = `(
  OpeningPitchCategory LIKE '%Greeting%'
  AND OpeningPitchCategory LIKE '%Self-Introduction%'
  AND OpeningPitchCategory LIKE '%Company Introduction%'
)`;

// "No opening" = None/null/empty/JSON-null values
const OPENING_NONE_EXPR = `(
  OpeningPitchCategory IS NULL
  OR OpeningPitchCategory = ''
  OR OpeningPitchCategory = 'None'
  OR OpeningPitchCategory = 'null'
  OR OpeningPitchCategory = '["None"]'
  OR OpeningPitchCategory = '["null"]'
)`;

// Opening score per call (0-100)
const OPENING_SCORE_EXPR = `CASE
  WHEN OpeningPitchCategory LIKE '%Greeting%'
   AND OpeningPitchCategory LIKE '%Self-Introduction%'
   AND OpeningPitchCategory LIKE '%Company Introduction%' THEN 100
  WHEN OpeningPitchCategory LIKE '%Greeting%'
   AND OpeningPitchCategory LIKE '%Self-Introduction%' THEN 75
  WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 40
  WHEN OpeningPitchCategory IS NULL OR OpeningPitchCategory='' OR OpeningPitchCategory='None' THEN 0
  ELSE 20
END`;

// Grouped context category (Looker 4-bucket mapping)
const CONTEXT_GROUP_EXPR = `CASE
  WHEN ContactSettingCategory LIKE '%Pitch Same Time%'
    OR ContactSettingCategory LIKE '%at Once%'
    OR ContactSettingCategory LIKE '%at once%'
    OR ContactSettingCategory = 'Feedback&Offer Pitch Same Time'
    OR ContactSettingCategory = 'Feedback & Offer Pitch Same Time'
    THEN 'Dual Approach: Feedback & Offer at Once'
  WHEN ContactSettingCategory LIKE '%Order Confirmation%'
    OR ContactSettingCategory = 'Order Confirmation'
    THEN 'Order Confirmation'
  WHEN ContactSettingCategory LIKE '%previous call%'
    OR ContactSettingCategory LIKE '%Follow%'
    OR ContactSettingCategory LIKE '%Setting Call Duration%'
    THEN 'Follow Up'
  WHEN ContactSettingCategory LIKE '%Feedback%'
    OR ContactSettingCategory LIKE '%Offer%'
    THEN 'Feedback-First Approach then Offer Pitched'
  WHEN ContactSettingCategory IS NULL
    OR ContactSettingCategory = ''
    OR ContactSettingCategory = 'None'
    THEN 'Not Set'
  ELSE 'Other'
END`;

const SALE_EXPR = `(SaleDone='1' OR SaleDone=1)`;

// ─── Executive Summary ────────────────────────────────────────────────────────

export async function getOIExecutiveSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const [row] = await querySource<{
    total: number;
    opening_good: number;
    opening_none: number;
    opening_score: number;
    context_set: number;
    context_none: number;
    context_score: number;
    sales: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END) AS opening_good,
      SUM(CASE WHEN ${OPENING_NONE_EXPR} THEN 1 ELSE 0 END) AS opening_none,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score,
      SUM(CASE WHEN ContactSettingCategory IS NOT NULL
                AND ContactSettingCategory != ''
                AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END) AS context_set,
      SUM(CASE WHEN ContactSettingCategory IS NULL
                OR ContactSettingCategory = ''
                OR ContactSettingCategory IN ('None','null') THEN 1 ELSE 0 END) AS context_none,
      ROUND(
        SUM(CASE WHEN ContactSettingCategory IS NOT NULL
                  AND ContactSettingCategory != ''
                  AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END)
        * 100.0 / NULLIF(COUNT(*), 0), 2
      ) AS context_score,
      SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END) AS sales
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const total = Number(row?.total) || 0;
  const openingGood = Number(row?.opening_good) || 0;
  const openingNone = Number(row?.opening_none) || 0;
  const contextSet = Number(row?.context_set) || 0;
  const contextNone = Number(row?.context_none) || 0;

  return {
    totalCalls:         total,
    openingSuccessPct:  total ? +(openingGood / total * 100).toFixed(2) : 0,
    openingFailPct:     total ? +(openingNone / total * 100).toFixed(2) : 0,
    openingScore:       Number(row?.opening_score) || 0,
    contextSuccessPct:  total ? +(contextSet / total * 100).toFixed(2) : 0,
    contextFailPct:     total ? +(contextNone / total * 100).toFixed(2) : 0,
    contextScore:       Number(row?.context_score) || 0,
    salesConvPct:       total ? +((Number(row?.sales) / total) * 100).toFixed(2) : 0,
  };
}

// ─── Opening by Category ──────────────────────────────────────────────────────

export async function getOpeningByCategory(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ category: string; calls: number; sales: number; conv_pct: number }>(`
    SELECT
      CASE
        WHEN ${OPENING_FULL_EXPR} THEN 'Full Opening'
        WHEN ${OPENING_GOOD_EXPR} THEN 'Standard Opening'
        WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
        WHEN ${OPENING_NONE_EXPR}                   THEN 'No Opening'
        ELSE 'Other'
      END AS category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY calls DESC
  `, _p(startDate, endDate, clientIds));
}

// ─── Opening Raw Category Breakdown ──────────────────────────────────────────

export async function getOpeningRawCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ category: string; calls: number; conv_pct: number }>(`
    SELECT
      COALESCE(NULLIF(OpeningPitchCategory,''), 'None') AS category,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY calls DESC
    LIMIT 20
  `, _p(startDate, endDate, clientIds));
}

// ─── Opening Trend ────────────────────────────────────────────────────────────

export async function getOpeningTrend(
  filters: CallMasterFilters,
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'daily'
) {
  const { startDate, endDate, clientIds } = filters;

  const groupBy = {
    daily:     `DATE_FORMAT(CallDate,'%Y-%m-%d')`,
    weekly:    `CONCAT(YEAR(CallDate), '-W', LPAD(WEEK(CallDate,1),2,'0'))`,
    monthly:   `DATE_FORMAT(CallDate,'%Y-%m')`,
    quarterly: `CONCAT(YEAR(CallDate), '-Q', QUARTER(CallDate))`,
    yearly:    `YEAR(CallDate)`,
  }[period];

  return querySource<{
    period: string; calls: number; opening_good_pct: number; opening_score: number; conv_pct: number;
  }>(`
    SELECT
      ${groupBy} AS period,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS opening_good_pct,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 120
  `, _p(startDate, endDate, clientIds));
}

// ─── Opening by Dimension ─────────────────────────────────────────────────────

export async function getOpeningByDimension(
  filters: CallMasterFilters,
  dimension: 'client' | 'agent' | 'campaign' = 'agent'
) {
  const { startDate, endDate, clientIds } = filters;

  const dimCol = {
    client:   'client_id',
    agent:    'AgentName',
    campaign: 'campaign_id',
  }[dimension];

  return querySource<{
    dim: string; calls: number; opening_good_pct: number; opening_score: number; conv_pct: number;
  }>(`
    SELECT
      COALESCE(NULLIF(CAST(${dimCol} AS CHAR), ''), 'Unknown') AS dim,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS opening_good_pct,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY calls DESC
    LIMIT 30
  `, _p(startDate, endDate, clientIds));
}

// ─── Context by Category (Looker 4-bucket) ───────────────────────────────────

export async function getContextByCategory(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ category: string; calls: number; sales: number; conv_pct: number }>(`
    SELECT
      (${CONTEXT_GROUP_EXPR}) AS category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY calls DESC
  `, _p(startDate, endDate, clientIds));
}

// ─── Context Trend ────────────────────────────────────────────────────────────

export async function getContextTrend(
  filters: CallMasterFilters,
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'daily'
) {
  const { startDate, endDate, clientIds } = filters;

  const groupBy = {
    daily:     `DATE_FORMAT(CallDate,'%Y-%m-%d')`,
    weekly:    `CONCAT(YEAR(CallDate), '-W', LPAD(WEEK(CallDate,1),2,'0'))`,
    monthly:   `DATE_FORMAT(CallDate,'%Y-%m')`,
    quarterly: `CONCAT(YEAR(CallDate), '-Q', QUARTER(CallDate))`,
    yearly:    `YEAR(CallDate)`,
  }[period];

  return querySource<{
    period: string; calls: number; context_set_pct: number; conv_pct: number;
  }>(`
    SELECT
      ${groupBy} AS period,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL
                      AND ContactSettingCategory != ''
                      AND ContactSettingCategory NOT IN ('None','null')
                 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS context_set_pct,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 120
  `, _p(startDate, endDate, clientIds));
}

// ─── Context by Dimension ─────────────────────────────────────────────────────

export async function getContextByDimension(
  filters: CallMasterFilters,
  dimension: 'client' | 'agent' | 'campaign' = 'agent'
) {
  const { startDate, endDate, clientIds } = filters;

  const dimCol = {
    client:   'client_id',
    agent:    'AgentName',
    campaign: 'campaign_id',
  }[dimension];

  return querySource<{
    dim: string; calls: number; context_set_pct: number; conv_pct: number;
  }>(`
    SELECT
      COALESCE(NULLIF(CAST(${dimCol} AS CHAR), ''), 'Unknown') AS dim,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ContactSettingCategory IS NOT NULL
                      AND ContactSettingCategory != ''
                      AND ContactSettingCategory NOT IN ('None','null')
                 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS context_set_pct,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY calls DESC
    LIMIT 30
  `, _p(startDate, endDate, clientIds));
}

// ─── Opening vs Sales Correlation ────────────────────────────────────────────

export async function getOpeningVsSales(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{
    opening_category: string; calls: number; sales: number; conv_pct: number; opening_score: number;
  }>(`
    SELECT
      CASE
        WHEN ${OPENING_FULL_EXPR} THEN 'Full Opening'
        WHEN ${OPENING_GOOD_EXPR} THEN 'Standard Opening'
        WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
        WHEN ${OPENING_NONE_EXPR}                   THEN 'No Opening'
        ELSE 'Other'
      END AS opening_category,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END) AS sales,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY conv_pct DESC
  `, _p(startDate, endDate, clientIds));
}

// ─── Opening Leaderboard ──────────────────────────────────────────────────────

export async function getOpeningLeaderboard(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const baseSelect = `
    SELECT
      COALESCE(am.AgentName, d.AgentName) AS name,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS opening_pct,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
    FROM db_external.CallDetails d
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
    WHERE d.CallDate BETWEEN ? AND ?
      AND d.AgentName IS NOT NULL AND d.AgentName != ''
      ${_cf(clientIds)}
    GROUP BY d.AgentName
    HAVING calls >= 5
  `;

  const [top10, bottom5, topClients, topCampaigns] = await Promise.all([
    querySource<{ name: string; calls: number; opening_pct: number; opening_score: number; conv_pct: number }>(
      `${baseSelect} ORDER BY opening_score DESC LIMIT 10`, _p(startDate, endDate, clientIds)
    ),
    querySource<{ name: string; calls: number; opening_pct: number; opening_score: number; conv_pct: number }>(
      `${baseSelect} ORDER BY opening_score ASC LIMIT 5`, _p(startDate, endDate, clientIds)
    ),
    querySource<{ name: string; calls: number; opening_pct: number; conv_pct: number }>(`
      SELECT
        CAST(client_id AS CHAR) AS name,
        COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS opening_pct,
        ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      GROUP BY client_id
      ORDER BY opening_pct DESC LIMIT 10
    `, _p(startDate, endDate, clientIds)),
    querySource<{ name: string; calls: number; opening_pct: number; conv_pct: number }>(`
      SELECT
        COALESCE(NULLIF(campaign_id,''), 'Unknown') AS name,
        COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS opening_pct,
        ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      GROUP BY campaign_id
      ORDER BY opening_pct DESC LIMIT 10
    `, _p(startDate, endDate, clientIds)),
  ]);

  return { top10Agents: top10, bottom5Agents: bottom5, topClients, topCampaigns };
}

// ─── AI Insights (rule-based) ─────────────────────────────────────────────────

export async function getOIAIInsights(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  // Current period metrics
  const [curr] = await querySource<{
    total: number; opening_good: number; context_set: number; sales: number; opening_score: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${OPENING_GOOD_EXPR} THEN 1 ELSE 0 END) AS opening_good,
      SUM(CASE WHEN ContactSettingCategory IS NOT NULL
                AND ContactSettingCategory != ''
                AND ContactSettingCategory NOT IN ('None','null') THEN 1 ELSE 0 END) AS context_set,
      SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END) AS sales,
      ROUND(AVG(${OPENING_SCORE_EXPR}), 2) AS opening_score
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  // Best performing opening category by conversion
  const bestOpening = await querySource<{ category: string; conv_pct: number; calls: number }>(`
    SELECT
      CASE
        WHEN ${OPENING_FULL_EXPR} THEN 'Full Opening'
        WHEN ${OPENING_GOOD_EXPR} THEN 'Standard Opening'
        WHEN OpeningPitchCategory LIKE '%Greeting%' THEN 'Basic Greeting'
        ELSE 'No Opening'
      END AS category,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct,
      COUNT(*) AS calls
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1 HAVING calls >= 10
    ORDER BY conv_pct DESC LIMIT 1
  `, _p(startDate, endDate, clientIds));

  // Best context category by conversion
  const bestContext = await querySource<{ category: string; conv_pct: number; calls: number }>(`
    SELECT
      (${CONTEXT_GROUP_EXPR}) AS category,
      ROUND(SUM(CASE WHEN ${SALE_EXPR} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0), 2) AS conv_pct,
      COUNT(*) AS calls
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1 HAVING calls >= 10
    ORDER BY conv_pct DESC LIMIT 1
  `, _p(startDate, endDate, clientIds));

  const total = Number(curr?.total) || 1;
  const openingGoodPct = +(Number(curr?.opening_good) / total * 100).toFixed(1);
  const contextSetPct = +(Number(curr?.context_set) / total * 100).toFixed(1);
  const convPct = +(Number(curr?.sales) / total * 100).toFixed(1);
  const openingScore = Number(curr?.opening_score) || 0;

  const insights = [];

  if (openingGoodPct < 50) {
    insights.push({
      type: 'alert' as const,
      title: 'Low Opening Compliance',
      what: `Only ${openingGoodPct}% of calls have a proper opening (Greeting + Self-Introduction).`,
      why: 'Poor opening reduces customer receptivity and lowers conversion probability from the first interaction.',
      impact: `Improving opening quality to 75%+ could improve conversion rate by an estimated 3-5%.`,
      action: 'Run targeted coaching sessions on the Greeting + Self-Introduction + Company Introduction framework for agents below 50% opening compliance.',
    });
  } else if (openingGoodPct >= 80) {
    insights.push({
      type: 'success' as const,
      title: 'Strong Opening Compliance',
      what: `${openingGoodPct}% of calls include a proper structured opening.`,
      why: 'High opening quality correlates with better customer engagement and higher conversion rates.',
      impact: 'Maintaining this standard supports consistent customer experience across all agents.',
      action: 'Identify and share best-performing opening scripts from top agents as templates for the broader team.',
    });
  }

  if (contextSetPct < 60) {
    insights.push({
      type: 'alert' as const,
      title: 'Context Setting Gap',
      what: `${contextSetPct}% of calls have structured context setting before the pitch.`,
      why: 'Without proper context setting, customers lack the framework to evaluate the offer, reducing receptivity.',
      impact: 'Calls with proper context setting typically show 2-4x higher conversion rates.',
      action: 'Train agents on the 4 context-setting approaches: Feedback-First, Dual Approach, Follow Up, and Order Confirmation.',
    });
  }

  if (bestOpening.length > 0 && bestOpening[0].conv_pct > convPct + 2) {
    insights.push({
      type: 'opportunity' as const,
      title: `"${bestOpening[0].category}" Drives Highest Conversions`,
      what: `Calls with "${bestOpening[0].category}" convert at ${bestOpening[0].conv_pct}% vs overall ${convPct}%.`,
      why: `A structured, complete opening builds credibility and sets the right tone for the pitch.`,
      impact: `Shifting more agents to this opening style could add ${(bestOpening[0].conv_pct - convPct).toFixed(1)} points to overall conversion.`,
      action: `Make "${bestOpening[0].category}" the standard opening framework and measure agent compliance weekly.`,
    });
  }

  if (bestContext.length > 0 && bestContext[0].conv_pct > convPct + 2) {
    insights.push({
      type: 'opportunity' as const,
      title: `"${bestContext[0].category}" Most Effective Context`,
      what: `The "${bestContext[0].category}" approach yields ${bestContext[0].conv_pct}% conversion (${(bestContext[0].conv_pct - convPct).toFixed(1)}pts above average).`,
      why: 'Matching context-setting style to customer state improves receptivity and reduces objections.',
      impact: `Prioritizing this context approach for eligible calls could meaningfully lift overall conversion.`,
      action: `Brief TLs on identifying when to use "${bestContext[0].category}" and add it to call scripts.`,
    });
  }

  if (openingScore < 50) {
    insights.push({
      type: 'alert' as const,
      title: 'Opening Quality Score Below Threshold',
      what: `Average opening quality score is ${openingScore}/100 — below the 50-point threshold.`,
      why: 'Many calls are starting with incomplete introductions, missing company identification.',
      impact: 'Low opening scores reduce brand credibility and customer trust from the first moment.',
      action: 'Introduce daily opening quality monitoring. Flag agents scoring below 40 for immediate coaching.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'success' as const,
      title: 'Opening & Context Metrics On Track',
      what: `Opening compliance at ${openingGoodPct}%, context setting at ${contextSetPct}%, conversion at ${convPct}%.`,
      why: 'All key metrics are within healthy ranges for the selected period.',
      impact: 'Consistent performance is the foundation for further conversion optimization.',
      action: 'Focus on top performers — identify what they do differently and scale those behaviors.',
    });
  }

  return insights;
}
