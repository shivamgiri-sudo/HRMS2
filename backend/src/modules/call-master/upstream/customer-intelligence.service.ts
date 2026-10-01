// @ts-nocheck
// AUTO-SYNCED from tausifansari-mcn/Mydashboards backend/src/modules/call-master/customer-intelligence.service.ts @ 4fbd5df - do not edit; run scripts/sync-mydashboards.mjs
import { querySource } from '../upstream-shim/sourceDb.js';
import { CallMasterFilters } from './call-master.service.js';

// ─── SQL fragments ────────────────────────────────────────────────────────────

const _cf = (ids?: number[]) =>
  ids?.length ? `AND client_id IN (${ids.map(() => '?').join(',')})` : '';

const _p = (s: string, e: string, ids?: number[]) => [s, e, ...(ids ?? [])];

const SALE      = `(SaleDone='1' OR SaleDone=1)`;
const POSITIVE  = `Feedback='Positive'`;
const NEGATIVE  = `Feedback='Negative'`;
const NEUTRAL   = `Feedback='Neutral'`;
const KNOWN_FB  = `Feedback IN ('Positive','Negative','Neutral')`;
const OFF_REJ   = `OfferingRejected='1'`;
const AFTER_REJ = `AfterListeningOfferRejected='1'`;

// Offer was presented = a decision exists (rejected or sold)
const OFFERED = `(OfferingRejected IN ('0','1') OR AfterListeningOfferRejected IN ('0','1') OR ${SALE})`;

// ─── Executive Summary ────────────────────────────────────────────────────────

export async function getCIExecutiveSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const [curr] = await querySource<{
    total: number;
    positive: number;
    negative: number;
    neutral: number;
    known_fb: number;
    sales: number;
    off_rej: number;
    after_rej: number;
    offered: number;
    intent: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${POSITIVE}  THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN ${NEGATIVE}  THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN ${NEUTRAL}   THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN ${KNOWN_FB}  THEN 1 ELSE 0 END) AS known_fb,
      SUM(CASE WHEN ${SALE}      THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN ${OFF_REJ}   THEN 1 ELSE 0 END) AS off_rej,
      SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej,
      SUM(CASE WHEN ${OFFERED}   THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN
        Category LIKE '%Purchase Readiness%' OR Category LIKE '%Wants to buy later%'
        OR SubCategory LIKE '%buy later%' OR SubCategory LIKE '%bulk buy%'
        OR SubCategory LIKE '%wants to buy%'
        THEN 1 ELSE 0 END) AS intent
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const total    = Number(curr?.total)    || 1;
  const positive = Number(curr?.positive) || 0;
  const negative = Number(curr?.negative) || 0;
  const neutral  = Number(curr?.neutral)  || 0;
  const knownFb  = Number(curr?.known_fb) || 1;
  const sales    = Number(curr?.sales)    || 0;
  const offRej   = Number(curr?.off_rej)  || 0;
  const afterRej = Number(curr?.after_rej)|| 0;
  const offered  = Number(curr?.offered)  || 1;
  const intent   = Number(curr?.intent)   || 0;

  const satisfactionPct   = +(positive / knownFb * 100).toFixed(2);
  const positivePct       = +(positive / total * 100).toFixed(2);
  const negativePct       = +(negative / total * 100).toFixed(2);
  const neutralPct        = +(neutral  / total * 100).toFixed(2);
  const offerAcceptPct    = +(sales    / offered * 100).toFixed(2);
  const offerRejectionPct = +((offRej + afterRej) / offered * 100).toFixed(2);
  // Trust Score: weighted composite (positive feedback + no rejection)
  const trustScore        = +(satisfactionPct * 0.5 + offerAcceptPct * 0.3 + (100 - negativePct) * 0.2).toFixed(2);
  // CX Score: positive_pct + conversion bonus
  const cxScore           = +(positivePct * 0.6 + offerAcceptPct * 0.4).toFixed(2);
  // Happiness Index: satisfaction + no_negative + sale_rate
  const happinessIndex    = +(satisfactionPct * 0.4 + (100 - negativePct) * 0.4 + offerAcceptPct * 0.2).toFixed(2);
  const purchaseIntentPct = +(intent / total * 100).toFixed(2);

  return {
    totalCalls: total,
    satisfactionPct,
    positivePct,
    negativePct,
    neutralPct,
    offerAcceptPct,
    offerRejectionPct,
    trustScore: Math.min(trustScore, 100),
    cxScore:    Math.min(cxScore, 100),
    happinessIndex: Math.min(happinessIndex, 100),
    purchaseIntentPct,
  };
}

// ─── Sentiment Distribution ───────────────────────────────────────────────────

export async function getSentimentDistribution(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const [row] = await querySource<{
    positive: number; negative: number; neutral: number; total: number;
  }>(`
    SELECT
      SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END) AS neutral,
      COUNT(*) AS total
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const total = Number(row?.total) || 1;
  const pos   = Number(row?.positive) || 0;
  const neg   = Number(row?.negative) || 0;
  const neu   = Number(row?.neutral)  || 0;
  const unk   = total - pos - neg - neu;

  return [
    { sentiment: 'Positive', count: pos, pct: +(pos / total * 100).toFixed(2) },
    { sentiment: 'Negative', count: neg, pct: +(neg / total * 100).toFixed(2) },
    { sentiment: 'Neutral',  count: neu, pct: +(neu / total * 100).toFixed(2) },
    { sentiment: 'Unknown',  count: unk, pct: +(unk / total * 100).toFixed(2) },
  ];
}

// ─── Sentiment Trend ──────────────────────────────────────────────────────────

export async function getSentimentTrend(
  filters: CallMasterFilters,
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'daily'
) {
  const { startDate, endDate, clientIds } = filters;

  const groupBy = {
    daily:     `DATE_FORMAT(CallDate,'%Y-%m-%d')`,
    weekly:    `CONCAT(YEAR(CallDate),'-W',LPAD(WEEK(CallDate,1),2,'0'))`,
    monthly:   `DATE_FORMAT(CallDate,'%Y-%m')`,
    quarterly: `CONCAT(YEAR(CallDate),'-Q',QUARTER(CallDate))`,
    yearly:    `YEAR(CallDate)`,
  }[period];

  return querySource<{
    period: string; calls: number; positive: number; negative: number; neutral: number; unknown: number;
    positive_pct: number; negative_pct: number;
  }>(`
    SELECT
      ${groupBy} AS period,
      COUNT(*) AS calls,
      SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN Feedback NOT IN ('Positive','Negative','Neutral') OR Feedback IS NULL THEN 1 ELSE 0 END) AS unknown,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 120
  `, _p(startDate, endDate, clientIds));
}

// ─── VOC – Feedback Categories ────────────────────────────────────────────────

export async function getFeedbackCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{
    category: string; count: number; positive: number; negative: number; neutral: number; conv_pct: number;
  }>(`
    SELECT
      COALESCE(NULLIF(Feedback_Category,''), 'Unknown') AS category,
      COUNT(*) AS count,
      SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END) AS neutral,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND Feedback_Category IS NOT NULL AND Feedback_Category != ''
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 20
  `, _p(startDate, endDate, clientIds));
}

// ─── VOC – Feedback Sub-Categories ───────────────────────────────────────────

export async function getFeedbackSubCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const rows = await querySource<{
    subCategory: string; count: number;
    pos_cnt: number; neg_cnt: number; neu_cnt: number;
  }>(`
    SELECT
      COALESCE(NULLIF(SubCategory,''), 'Unknown') AS subCategory,
      COUNT(*) AS count,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS pos_cnt,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS neg_cnt,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neu_cnt
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND SubCategory IS NOT NULL AND SubCategory != '' AND SubCategory != 'None'
    GROUP BY 1
    ORDER BY count DESC
    LIMIT 25
  `, _p(startDate, endDate, clientIds));

  return rows.map(r => ({
    subCategory: r.subCategory,
    count: Number(r.count),
    feedback: Number(r.pos_cnt) >= Number(r.neg_cnt) && Number(r.pos_cnt) >= Number(r.neu_cnt)
      ? 'Positive'
      : Number(r.neg_cnt) >= Number(r.pos_cnt) && Number(r.neg_cnt) >= Number(r.neu_cnt)
      ? 'Negative'
      : Number(r.neu_cnt) > 0 ? 'Neutral' : 'Unknown',
  }));
}

// ─── VOC – Top Objections & Not Interested Reasons ───────────────────────────

export async function getTopObjections(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const [objections, notInterestedReasons] = await Promise.all([
    querySource<{ reason: string; count: number }>(`
      SELECT
        CustomerObjectionCategory AS reason,
        COUNT(*) AS count
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
        AND CustomerObjectionCategory IS NOT NULL
        AND CustomerObjectionCategory != ''
        AND CustomerObjectionCategory != 'None'
      GROUP BY CustomerObjectionCategory
      ORDER BY count DESC
      LIMIT 15
    `, _p(startDate, endDate, clientIds)),

    querySource<{ reason: string; count: number }>(`
      SELECT
        NotInterestedBucketReason AS reason,
        COUNT(*) AS count
      FROM db_external.CallDetails
      WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
        AND NotInterestedBucketReason IS NOT NULL
        AND NotInterestedBucketReason != ''
        AND NotInterestedBucketReason != 'None'
      GROUP BY NotInterestedBucketReason
      ORDER BY count DESC
      LIMIT 15
    `, _p(startDate, endDate, clientIds)),
  ]);

  return { objections, notInterestedReasons };
}

// ─── Customer Journey Funnel ──────────────────────────────────────────────────

export async function getCustomerJourney(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const [row] = await querySource<{
    contact: number;
    reached_opening: number;
    context_set: number;
    feedback_collected: number;
    offer_presented: number;
    objection_raised: number;
    objection_handled: number;
    decision_made: number;
    sale_closed: number;
  }>(`
    SELECT
      COUNT(*) AS contact,
      SUM(CASE WHEN Opening IS NOT NULL AND Opening!='' AND Opening!='None' AND Opening!='null' THEN 1 ELSE 0 END) AS reached_opening,
      SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!='' AND ContactSettingCategory!='None' THEN 1 ELSE 0 END) AS context_set,
      SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END) AS feedback_collected,
      SUM(CASE WHEN ${OFFERED}  THEN 1 ELSE 0 END) AS offer_presented,
      SUM(CASE WHEN CustomerObjectionCategory IS NOT NULL AND CustomerObjectionCategory!='' AND CustomerObjectionCategory!='None' THEN 1 ELSE 0 END) AS objection_raised,
      SUM(CASE WHEN AgentRebuttalCategory IS NOT NULL AND AgentRebuttalCategory!='' AND AgentRebuttalCategory!='None' THEN 1 ELSE 0 END) AS objection_handled,
      SUM(CASE WHEN ${SALE} OR ${OFF_REJ} OR ${AFTER_REJ} THEN 1 ELSE 0 END) AS decision_made,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sale_closed
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const stages = [
    { stage: 'Customer Contact',   key: 'contact',           icon: '📞' },
    { stage: 'Opening',            key: 'reached_opening',   icon: '👋' },
    { stage: 'Context Setting',    key: 'context_set',       icon: '💬' },
    { stage: 'Feedback Collected', key: 'feedback_collected', icon: '📝' },
    { stage: 'Offer Presented',    key: 'offer_presented',   icon: '🎯' },
    { stage: 'Objection Raised',   key: 'objection_raised',  icon: '❓' },
    { stage: 'Objection Handled',  key: 'objection_handled', icon: '🛡️' },
    { stage: 'Decision Made',      key: 'decision_made',     icon: '⚖️' },
    { stage: 'Sale Closed',        key: 'sale_closed',       icon: '✅' },
  ] as const;

  const contact = Number((row as Record<string, unknown>)?.contact) || 1;
  return stages.map((s, i) => {
    const count = Number((row as Record<string, unknown>)?.[s.key]) || 0;
    const prevCount = i === 0 ? contact : Number((row as Record<string, unknown>)?.[stages[i - 1].key]) || 1;
    return {
      stage:      s.stage,
      icon:       s.icon,
      count,
      pct_of_total: +(count / contact * 100).toFixed(1),
      dropoff_pct:  i === 0 ? 0 : +(100 - count / Math.max(prevCount, 1) * 100).toFixed(1),
    };
  });
}

// ─── Feedback by Dimension ────────────────────────────────────────────────────

export async function getFeedbackByDimension(
  filters: CallMasterFilters,
  dimension: 'client' | 'agent' | 'campaign' = 'agent'
) {
  const { startDate, endDate, clientIds } = filters;

  const dimCol = {
    client:   'CAST(client_id AS CHAR)',
    agent:    'AgentName',
    campaign: 'campaign_id',
  }[dimension];

  return querySource<{
    dim: string; calls: number; positive_pct: number; negative_pct: number;
    neutral_pct: number; satisfaction_score: number; conv_pct: number;
  }>(`
    SELECT
      COALESCE(NULLIF(${dimCol},''),'Unknown') AS dim,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS neutral_pct,
      ROUND(
        SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0), 2
      ) AS satisfaction_score,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND ${dimCol} IS NOT NULL AND ${dimCol} != ''
    GROUP BY 1
    HAVING calls >= 5
    ORDER BY satisfaction_score DESC
    LIMIT 25
  `, _p(startDate, endDate, clientIds));
}

// ─── Client Comparison ────────────────────────────────────────────────────────

export async function getClientComparison(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{
    client_id: string; calls: number; satisfaction_pct: number;
    positive_pct: number; negative_pct: number;
    offer_accept_pct: number; conv_pct: number; trust_score: number;
  }>(`
    SELECT
      CAST(client_id AS CHAR) AS client_id,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct,
      ROUND(
        SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
          / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0) * 0.5
        + SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0
          / NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0) * 0.3
        + (100 - SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0)) * 0.2
      ,2) AS trust_score
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY client_id
    ORDER BY satisfaction_pct DESC
    LIMIT 20
  `, _p(startDate, endDate, clientIds));
}

// ─── Campaign Comparison ──────────────────────────────────────────────────────

export async function getCampaignComparison(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{
    campaign: string; calls: number; satisfaction_pct: number;
    positive_pct: number; negative_pct: number; offer_accept_pct: number; conv_pct: number;
  }>(`
    SELECT
      COALESCE(NULLIF(campaign_id,''),'Unknown') AS campaign,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
    GROUP BY 1
    HAVING calls >= 5
    ORDER BY satisfaction_pct DESC
    LIMIT 20
  `, _p(startDate, endDate, clientIds));
}

// ─── Agent CX Rankings ────────────────────────────────────────────────────────

export async function getAgentCXRanking(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const baseSelect = `
    SELECT
      COALESCE(am.AgentName, d.AgentName) AS agent,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
      ROUND(
        SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
          / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0) * 0.5
        + SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0
          / NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0) * 0.3
        + (100 - SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0)) * 0.2
      ,2) AS trust_score,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
    FROM db_external.CallDetails d
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
    WHERE d.CallDate BETWEEN ? AND ?
      AND d.AgentName IS NOT NULL AND d.AgentName != ''
      ${_cf(clientIds)}
    GROUP BY d.AgentName HAVING calls >= 5
  `;

  const [top10, bottom10] = await Promise.all([
    querySource<{
      agent: string; calls: number; satisfaction_pct: number; positive_pct: number;
      negative_pct: number; offer_accept_pct: number; trust_score: number; conv_pct: number;
    }>(`${baseSelect} ORDER BY trust_score DESC LIMIT 10`, _p(startDate, endDate, clientIds)),
    querySource<{
      agent: string; calls: number; satisfaction_pct: number; positive_pct: number;
      negative_pct: number; offer_accept_pct: number; trust_score: number; conv_pct: number;
    }>(`${baseSelect} ORDER BY trust_score ASC LIMIT 10`, _p(startDate, endDate, clientIds)),
  ]);

  return { top10, bottom10 };
}

// ─── Agent-wise NPS & CSAT ───────────────────────────────────────────────────

export async function getAgentNPSCSAT(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  return querySource<{
    agent: string;
    calls: number;
    positive_count: number;
    negative_count: number;
    neutral_count: number;
    positive_pct: number;
    negative_pct: number;
    neutral_pct: number;
    promoter: number;
    passive: number;
    detractor: number;
    csat: number;
    nps: number;
    conv_pct: number;
  }>(`
    SELECT
      COALESCE(am.AgentName, d.AgentName)                                                 AS agent,
      COUNT(*)                                                                             AS calls,
      SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)                                       AS positive_count,
      SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)                                       AS negative_count,
      SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END)                                       AS neutral_count,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1)    AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1)    AS negative_pct,
      ROUND(SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1)    AS neutral_pct,
      SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)                                       AS promoter,
      SUM(CASE WHEN ${NEUTRAL}  THEN 1 ELSE 0 END)                                       AS passive,
      SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)                                       AS detractor,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0
        / NULLIF(SUM(CASE WHEN ${KNOWN_FB} THEN 1 ELSE 0 END),0),1)                     AS csat,
      ROUND((SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)
           - SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END))*100.0/NULLIF(COUNT(*),0),1) AS nps,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1)        AS conv_pct
    FROM db_external.CallDetails d
    LEFT JOIN db_masmis.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
    WHERE d.CallDate BETWEEN ? AND ?
      AND d.AgentName IS NOT NULL AND d.AgentName != ''
      ${_cf(clientIds)}
    GROUP BY d.AgentName
    HAVING calls >= 1
    ORDER BY csat DESC
  `, _p(startDate, endDate, clientIds));
}

// ─── Product Feedback ─────────────────────────────────────────────────────────

export async function getProductFeedback(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  return querySource<{ product: string; calls: number; positive_pct: number; negative_pct: number; conv_pct: number }>(`
    SELECT
      COALESCE(NULLIF(ProductOffering,''),'Unknown') AS product,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN ${POSITIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN ${NEGATIVE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND ProductOffering IS NOT NULL AND ProductOffering != ''
    GROUP BY 1
    ORDER BY calls DESC
    LIMIT 15
  `, _p(startDate, endDate, clientIds));
}

// ─── Offering Funnel (Success / Rejected / Post-Offer Rejected) ───────────────

export async function getOfferingFunnel(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const [row] = await querySource<{
    total: number; offered: number; sales: number; off_rej: number; after_rej: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${OFFERED}   THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN ${SALE}      THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN ${OFF_REJ}   THEN 1 ELSE 0 END) AS off_rej,
      SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const total    = Number(row?.total)    || 1;
  const offered  = Number(row?.offered)  || 0;
  const sales    = Number(row?.sales)    || 0;
  const offRej   = Number(row?.off_rej)  || 0;
  const afterRej = Number(row?.after_rej)|| 0;

  return [
    { stage: 'Total Calls',         count: total,    pct: 100 },
    { stage: 'Offer Presented',      count: offered,  pct: +(offered  / total   * 100).toFixed(1) },
    { stage: 'Offer Accepted (Sale)', count: sales,   pct: +(sales    / offered * 100).toFixed(1) },
    { stage: 'Rejected at Offering', count: offRej,   pct: +(offRej   / offered * 100).toFixed(1) },
    { stage: 'Post-Offer Rejected',  count: afterRej, pct: +(afterRej / offered * 100).toFixed(1) },
  ];
}

// ─── AI Insights ──────────────────────────────────────────────────────────────

export async function getCIAIInsights(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;

  const [curr] = await querySource<{
    total: number; positive: number; negative: number; neutral: number;
    known_fb: number; sales: number; off_rej: number; after_rej: number; offered: number;
  }>(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${POSITIVE}  THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN ${NEGATIVE}  THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN ${NEUTRAL}   THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN ${KNOWN_FB}  THEN 1 ELSE 0 END) AS known_fb,
      SUM(CASE WHEN ${SALE}      THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN ${OFF_REJ}   THEN 1 ELSE 0 END) AS off_rej,
      SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej,
      SUM(CASE WHEN ${OFFERED}   THEN 1 ELSE 0 END) AS offered
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
  `, _p(startDate, endDate, clientIds));

  const [topNegCat] = await querySource<{ category: string; count: number }>(`
    SELECT Feedback_Category AS category, COUNT(*) AS count
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND ${NEGATIVE} AND Feedback_Category IS NOT NULL AND Feedback_Category != ''
    GROUP BY Feedback_Category ORDER BY count DESC LIMIT 1
  `, _p(startDate, endDate, clientIds));

  const [topObjCat] = await querySource<{ reason: string; count: number }>(`
    SELECT CustomerObjectionCategory AS reason, COUNT(*) AS count
    FROM db_external.CallDetails
    WHERE CallDate BETWEEN ? AND ? ${_cf(clientIds)}
      AND CustomerObjectionCategory IS NOT NULL AND CustomerObjectionCategory!='' AND CustomerObjectionCategory!='None'
    GROUP BY CustomerObjectionCategory ORDER BY count DESC LIMIT 1
  `, _p(startDate, endDate, clientIds));

  const total    = Number(curr?.total)    || 1;
  const positive = Number(curr?.positive) || 0;
  const negative = Number(curr?.negative) || 0;
  const knownFb  = Number(curr?.known_fb) || 1;
  const sales    = Number(curr?.sales)    || 0;
  const offRej   = Number(curr?.off_rej)  || 0;
  const afterRej = Number(curr?.after_rej)|| 0;
  const offered  = Number(curr?.offered)  || 1;

  const satisfPct       = +(positive / knownFb * 100).toFixed(1);
  const negPct          = +(negative / total   * 100).toFixed(1);
  const offerAcceptPct  = +(sales    / offered * 100).toFixed(1);
  const afterRejPct     = +(afterRej / offered * 100).toFixed(1);
  const convPct         = +(sales    / total   * 100).toFixed(1);

  const insights = [];

  if (negPct > 30) {
    insights.push({
      type: 'alert' as const, priority: 'high',
      title: 'High Negative Feedback Alert',
      what: `${negPct}% of calls resulted in negative customer feedback — above the 30% risk threshold.`,
      why: `Customers are expressing dissatisfaction${topNegCat ? ` — most frequently about "${topNegCat.category}"` : ''}.`,
      impact: 'High negative feedback correlates with reduced repeat purchases and lower brand trust.',
      action: `Immediate review of ${topNegCat?.category ?? 'top feedback categories'} — identify root cause and run agent calibration sessions.`,
    });
  } else if (satisfPct >= 70) {
    insights.push({
      type: 'success' as const, priority: 'low',
      title: 'Strong Customer Satisfaction',
      what: `Customer satisfaction stands at ${satisfPct}% for the selected period.`,
      why: 'Agents are collecting positive feedback consistently, indicating good customer experience.',
      impact: 'High satisfaction correlates with higher conversion rates and better brand reputation.',
      action: 'Share top-performing agent scripts as training material for the broader team.',
    });
  }

  if (afterRejPct > 25) {
    insights.push({
      type: 'alert' as const, priority: 'high',
      title: 'Post-Offer Rejection Too High',
      what: `${afterRejPct}% of customers rejected the offer after listening — losing interested prospects at the last step.`,
      why: 'Customers are not convinced by the closing pitch or pricing after hearing the full offer.',
      impact: `Reducing post-offer rejection by 10% could add ~${Math.round(offered * 0.1)} additional sales.`,
      action: 'Revise the closing pitch script. Focus on urgency, value, and objection handling after the offer pitch.',
    });
  }

  if (offerAcceptPct < 20) {
    insights.push({
      type: 'alert' as const, priority: 'medium',
      title: 'Low Offer Acceptance Rate',
      what: `Only ${offerAcceptPct}% of calls where an offer was presented resulted in a sale.`,
      why: topObjCat ? `The most common objection is "${topObjCat.reason}" — agents are not effectively handling it.` : 'Objections are not being handled effectively before and after the pitch.',
      impact: 'A 5% improvement in offer acceptance would significantly boost revenue.',
      action: `Train agents specifically on handling "${topObjCat?.reason ?? 'top objection'}" — provide rebuttal scripts and role-play sessions.`,
    });
  }

  if (offerAcceptPct >= 40) {
    insights.push({
      type: 'opportunity' as const, priority: 'medium',
      title: 'Offer Acceptance Rate Opportunity',
      what: `${offerAcceptPct}% offer acceptance rate is strong — identify what top agents are doing differently.`,
      why: 'High-performing agents have specific objection handling techniques that convert skeptical customers.',
      impact: 'Scaling top agent techniques across the team could lift overall conversion by 5-10%.',
      action: 'Record top 10 agent calls for analysis. Extract winning rebuttal patterns and update scripts.',
    });
  }

  if (convPct < 5) {
    insights.push({
      type: 'alert' as const, priority: 'high',
      title: 'Very Low Overall Conversion Rate',
      what: `Overall conversion rate is ${convPct}% — significantly below target.`,
      why: 'A combination of poor opening quality, low offer acceptance, and high post-offer rejection is compounding into low conversion.',
      impact: 'Current conversion trajectory will miss monthly targets. Immediate intervention required.',
      action: 'Conduct a full-funnel audit: opening → context setting → feedback → offer → closing. Fix the weakest link first.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: 'success' as const, priority: 'low',
      title: 'Customer Intelligence Metrics Look Healthy',
      what: `Satisfaction at ${satisfPct}%, conversion at ${convPct}%, offer acceptance at ${offerAcceptPct}%.`,
      why: 'All key customer intelligence metrics are within acceptable ranges for the selected period.',
      impact: 'Stable metrics indicate consistent agent performance and customer experience delivery.',
      action: 'Focus on improving top performers further and identifying the next growth lever in the customer journey funnel.',
    });
  }

  return insights;
}
