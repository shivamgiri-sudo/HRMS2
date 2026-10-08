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

const SALE     = `(SaleDone='1' OR SaleDone=1)`;
const OFF_REJ  = `OfferingRejected='1'`;
const AFTER_REJ= `AfterListeningOfferRejected='1'`;
const OFFERED  = `(OfferingRejected IN ('0','1') OR AfterListeningOfferRejected IN ('0','1') OR ${SALE})`;

export async function getCIExecutiveSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);

  const [row] = await querySource<{
    total: number; positive: number; negative: number; neutral: number; known_fb: number;
    sales: number; off_rej: number; after_rej: number; offered: number; intent: number;
  }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END) AS known_fb,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN ${OFF_REJ} THEN 1 ELSE 0 END) AS off_rej,
      SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej,
      SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN Category LIKE '%Purchase Readiness%' OR Category LIKE '%Wants to buy later%'
                OR SubCategory LIKE '%buy later%' OR SubCategory LIKE '%bulk buy%'
                OR SubCategory LIKE '%wants to buy%' THEN 1 ELSE 0 END) AS intent
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );

  if (!row) return null;

  const { total, positive, negative, neutral, known_fb, sales, off_rej, after_rej, offered } = row;
  const satisfactionPct   = known_fb ? Math.round(positive / known_fb * 100 * 100) / 100 : 0;
  const offerAcceptPct    = offered  ? Math.round(sales / offered * 100 * 100) / 100 : 0;
  const negativePct       = total    ? Math.round(negative / total * 100 * 100) / 100 : 0;
  const positivePct       = total    ? Math.round(positive / total * 100 * 100) / 100 : 0;
  const neutralPct        = total    ? Math.round(neutral / total * 100 * 100) / 100 : 0;
  const convPct           = total    ? Math.round(sales / total * 100 * 100) / 100 : 0;
  const afterRejPct       = offered  ? Math.round(after_rej / offered * 100 * 100) / 100 : 0;
  const trustScore        = Math.round((satisfactionPct * 0.5 + offerAcceptPct * 0.3 + (100 - negativePct) * 0.2) * 100) / 100;
  const cxScore           = Math.round((positivePct + neutralPct * 0.5) / 100 * 10 * 100) / 100;
  const happinessIndex    = Math.round((positivePct * 2 + neutralPct) / 3 * 100) / 100;

  return {
    ...row,
    satisfaction_pct: satisfactionPct,
    offer_accept_pct: offerAcceptPct,
    negative_pct: negativePct,
    positive_pct: positivePct,
    neutral_pct: neutralPct,
    conv_pct: convPct,
    after_rej_pct: afterRejPct,
    trust_score: trustScore,
    cx_score: cxScore,
    happiness_index: happinessIndex,
    off_rej_count: off_rej,
    after_rej_count: after_rej,
  };
}

export async function getSentimentDistribution(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<{ positive: number; negative: number; neutral: number; total: number }>(
    `SELECT SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neutral,
      COUNT(*) AS total
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? null;
}

export async function getSentimentTrend(filters: CallMasterFilters, period: Period = "daily") {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const g = periodExpr(period);
  return querySource<{
    period: string; calls: number; positive: number; negative: number; neutral: number;
    unknown: number; positive_pct: number; negative_pct: number;
  }>(
    `SELECT ${g} AS period, COUNT(*) AS calls,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN Feedback NOT IN ('Positive','Negative','Neutral') OR Feedback IS NULL THEN 1 ELSE 0 END) AS unknown,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 ORDER BY 1 ASC LIMIT 120`,
    [startDate, endDate, ...f.params]
  );
}

export async function getFeedbackCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ category: string; count: number; positive: number; negative: number; neutral: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(Feedback_Category,''),'Unknown') AS category,
      COUNT(*) AS count,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neutral,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
       AND Feedback_Category IS NOT NULL AND Feedback_Category != ''
     GROUP BY 1 ORDER BY count DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getFeedbackSubCategories(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ subCategory: string; count: number; pos_cnt: number; neg_cnt: number; neu_cnt: number }>(
    `SELECT COALESCE(NULLIF(SubCategory,''),'Unknown') AS subCategory,
      COUNT(*) AS count,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS pos_cnt,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS neg_cnt,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neu_cnt
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
       AND SubCategory IS NOT NULL AND SubCategory != '' AND SubCategory != 'None'
     GROUP BY 1 ORDER BY count DESC LIMIT 25`,
    [startDate, endDate, ...f.params]
  );
}

export async function getTopObjections(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [objections, notInterested] = await Promise.all([
    querySource<{ reason: string; count: number }>(
      `SELECT CustomerObjectionCategory AS reason, COUNT(*) AS count
       FROM db_external.CallDetails
       WHERE CallDate BETWEEN ? AND ?${f.clause}
         AND CustomerObjectionCategory IS NOT NULL
         AND CustomerObjectionCategory != '' AND CustomerObjectionCategory != 'None'
       GROUP BY CustomerObjectionCategory ORDER BY count DESC LIMIT 15`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ reason: string; count: number }>(
      `SELECT NotInterestedBucketReason AS reason, COUNT(*) AS count
       FROM db_external.CallDetails
       WHERE CallDate BETWEEN ? AND ?${f.clause}
         AND NotInterestedBucketReason IS NOT NULL
         AND NotInterestedBucketReason != '' AND NotInterestedBucketReason != 'None'
       GROUP BY NotInterestedBucketReason ORDER BY count DESC LIMIT 15`,
      [startDate, endDate, ...f.params]
    ),
  ]);
  return { objections, not_interested: notInterested };
}

export async function getCustomerJourney(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<{
    contact: number; reached_opening: number; context_set: number;
    feedback_collected: number; offer_presented: number; objection_raised: number;
    objection_handled: number; decision_made: number; sale_closed: number;
  }>(
    `SELECT COUNT(*) AS contact,
      SUM(CASE WHEN Opening IS NOT NULL AND Opening!='' AND Opening!='None' AND Opening!='null' THEN 1 ELSE 0 END) AS reached_opening,
      SUM(CASE WHEN ContactSettingCategory IS NOT NULL AND ContactSettingCategory!='' AND ContactSettingCategory!='None' THEN 1 ELSE 0 END) AS context_set,
      SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END) AS feedback_collected,
      SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END) AS offer_presented,
      SUM(CASE WHEN CustomerObjectionCategory IS NOT NULL AND CustomerObjectionCategory!='' AND CustomerObjectionCategory!='None' THEN 1 ELSE 0 END) AS objection_raised,
      SUM(CASE WHEN AgentRebuttalCategory IS NOT NULL AND AgentRebuttalCategory!='' AND AgentRebuttalCategory!='None' THEN 1 ELSE 0 END) AS objection_handled,
      SUM(CASE WHEN ${SALE} OR ${OFF_REJ} OR ${AFTER_REJ} THEN 1 ELSE 0 END) AS decision_made,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sale_closed
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? null;
}

export async function getClientComparison(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{
    client_id: string; calls: number; satisfaction_pct: number;
    positive_pct: number; negative_pct: number; offer_accept_pct: number; conv_pct: number; trust_score: number;
  }>(
    `SELECT CAST(client_id AS CHAR) AS client_id, COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct,
      ROUND(
        SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0)*0.5
        + SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0)*0.3
        + (100-SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0))*0.2
      ,2) AS trust_score
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY client_id ORDER BY satisfaction_pct DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getCampaignComparison(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{
    campaign: string; calls: number; satisfaction_pct: number;
    positive_pct: number; negative_pct: number; offer_accept_pct: number; conv_pct: number;
  }>(
    `SELECT COALESCE(NULLIF(campaign_id,''),'Unknown') AS campaign, COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
     GROUP BY 1 HAVING calls >= 5 ORDER BY satisfaction_pct DESC LIMIT 20`,
    [startDate, endDate, ...f.params]
  );
}

export async function getAgentCXRanking(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [top, bottom] = await Promise.all([
    querySource<{ agent: string; calls: number; satisfaction_pct: number; positive_pct: number; negative_pct: number; offer_accept_pct: number; trust_score: number; conv_pct: number }>(
      `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS agent, COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
        ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0)*0.5
          + SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0)*0.3
          + (100-SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0))*0.2,2) AS trust_score,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails d
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
       WHERE d.CallDate BETWEEN ? AND ?${f.clause}
         AND d.AgentName IS NOT NULL AND d.AgentName != ''
       GROUP BY d.AgentName HAVING calls >= 5
       ORDER BY trust_score DESC LIMIT 10`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ agent: string; calls: number; satisfaction_pct: number; positive_pct: number; negative_pct: number; offer_accept_pct: number; trust_score: number; conv_pct: number }>(
      `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS agent, COUNT(*) AS calls,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0),2) AS satisfaction_pct,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
        ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0),2) AS offer_accept_pct,
        ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0)*0.5
          + SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END),0)*0.3
          + (100-SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0))*0.2,2) AS trust_score,
        ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
       FROM db_external.CallDetails d
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
       WHERE d.CallDate BETWEEN ? AND ?${f.clause}
         AND d.AgentName IS NOT NULL AND d.AgentName != ''
       GROUP BY d.AgentName HAVING calls >= 5
       ORDER BY trust_score ASC LIMIT 10`,
      [startDate, endDate, ...f.params]
    ),
  ]);
  return { top, bottom };
}

export async function getAgentNPSCSAT(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{
    agent: string; calls: number; positive_count: number; negative_count: number; neutral_count: number;
    positive_pct: number; negative_pct: number; neutral_pct: number;
    promoter: number; passive: number; detractor: number; csat: number; nps: number; conv_pct: number;
  }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, d.AgentName)) AS agent, COUNT(*) AS calls,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive_count,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative_count,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS neutral_count,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS positive_pct,
      ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS negative_pct,
      ROUND(SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS neutral_pct,
      SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS promoter,
      SUM(CASE WHEN Feedback='Neutral'  THEN 1 ELSE 0 END) AS passive,
      SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS detractor,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END),0),1) AS csat,
      ROUND((SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)-SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END))*100.0/NULLIF(COUNT(*),0),1) AS nps,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS conv_pct
     FROM db_external.CallDetails d
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = d.AgentName COLLATE utf8mb4_unicode_ci
     WHERE d.CallDate BETWEEN ? AND ?${f.clause}
       AND d.AgentName IS NOT NULL AND d.AgentName != ''
     GROUP BY d.AgentName HAVING calls >= 1 ORDER BY csat DESC`,
    [startDate, endDate, ...f.params]
  );
}

export async function getProductFeedback(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  return querySource<{ product: string; calls: number; positive_pct: number; negative_pct: number; conv_pct: number }>(
    `SELECT COALESCE(NULLIF(ProductOffering,''),'Unknown') AS product, COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
      ROUND(SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
      ROUND(SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conv_pct
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}
       AND ProductOffering IS NOT NULL AND ProductOffering != ''
     GROUP BY 1 ORDER BY calls DESC LIMIT 15`,
    [startDate, endDate, ...f.params]
  );
}

export async function getOfferingFunnel(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);
  const [row] = await querySource<{ total: number; offered: number; sales: number; off_rej: number; after_rej: number }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
      SUM(CASE WHEN ${OFF_REJ} THEN 1 ELSE 0 END) AS off_rej,
      SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej
     FROM db_external.CallDetails
     WHERE CallDate BETWEEN ? AND ?${f.clause}`,
    [startDate, endDate, ...f.params]
  );
  return row ?? null;
}

export async function getCIAIInsights(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const f = obFilter(clientIds);

  const [[metrics], topNegCat, topObjCat] = await Promise.all([
    querySource<{
      total: number; positive: number; negative: number; known_fb: number;
      sales: number; after_rej: number; offered: number;
    }>(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN Feedback='Positive' THEN 1 ELSE 0 END) AS positive,
        SUM(CASE WHEN Feedback='Negative' THEN 1 ELSE 0 END) AS negative,
        SUM(CASE WHEN Feedback IN ('Positive','Negative','Neutral') THEN 1 ELSE 0 END) AS known_fb,
        SUM(CASE WHEN ${SALE} THEN 1 ELSE 0 END) AS sales,
        SUM(CASE WHEN ${AFTER_REJ} THEN 1 ELSE 0 END) AS after_rej,
        SUM(CASE WHEN ${OFFERED} THEN 1 ELSE 0 END) AS offered
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ category: string }>(
      `SELECT COALESCE(NULLIF(Feedback_Category,''),'Unknown') AS category, COUNT(*) AS cnt
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}
         AND Feedback='Negative' AND Feedback_Category IS NOT NULL AND Feedback_Category != ''
       GROUP BY 1 ORDER BY cnt DESC LIMIT 1`,
      [startDate, endDate, ...f.params]
    ),
    querySource<{ reason: string }>(
      `SELECT CustomerObjectionCategory AS reason, COUNT(*) AS cnt
       FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${f.clause}
         AND CustomerObjectionCategory IS NOT NULL AND CustomerObjectionCategory != '' AND CustomerObjectionCategory != 'None'
       GROUP BY 1 ORDER BY cnt DESC LIMIT 1`,
      [startDate, endDate, ...f.params]
    ),
  ]);

  const insights: Array<{
    type: string; priority: string; title: string;
    what: string; why: string; impact: string; action: string;
  }> = [];
  if (!metrics) return insights;

  const { total, positive, negative, known_fb, sales, after_rej, offered } = metrics;
  const negPct       = total   ? Math.round(negative / total * 100 * 100) / 100 : 0;
  const satisfPct    = known_fb? Math.round(positive / known_fb * 100 * 100) / 100 : 0;
  const afterRejPct  = offered ? Math.round(after_rej / offered * 100 * 100) / 100 : 0;
  const offerAccPct  = offered ? Math.round(sales / offered * 100 * 100) / 100 : 0;
  const convPct      = total   ? Math.round(sales / total * 100 * 100) / 100 : 0;

  if (negPct > 30) insights.push({ type: "alert", priority: "high", title: "High Negative Feedback Alert",
    what: `${negPct}% of calls have negative feedback${topNegCat.length ? ` — top category: ${topNegCat[0].category}` : ""}`,
    why: "Poor call handling or product/service issues", impact: `${negative} negative calls in period`, action: "Review top negative category; targeted agent coaching" });

  if (satisfPct >= 70) insights.push({ type: "success", priority: "low", title: "Strong Customer Satisfaction",
    what: `${satisfPct}% satisfaction rate`, why: "Effective agent handling and empathy",
    impact: "Positive NPS driver", action: "Document and scale best practices" });

  if (afterRejPct > 25) insights.push({ type: "alert", priority: "high", title: "Post-Offer Rejection Too High",
    what: `${afterRejPct}% of offers rejected after customer listened`,
    why: "Offer relevance or agent pitch quality issues",
    impact: `~${Math.round(offered * 0.1)} additional sales if reduced to <15%`, action: "Review offer relevance and agent rebuttal training" });

  if (offerAccPct < 20) insights.push({ type: "alert", priority: "medium", title: "Low Offer Acceptance Rate",
    what: `Only ${offerAccPct}% of offers accepted`,
    why: "Pitch timing, product match or objection handling gaps",
    impact: `${Math.round((20 - offerAccPct) / 100 * offered)} missed potential sales`,
    action: "Focus on objection handling and value proposition clarity" });
  else if (offerAccPct >= 40) insights.push({ type: "opportunity", priority: "medium", title: "Offer Acceptance Rate Opportunity",
    what: `${offerAccPct}% offer acceptance — above industry average`,
    why: "Strong agent training and product fit",
    impact: "Scale to lower-performing agents",
    action: "Identify and replicate top-performer techniques" });

  if (convPct < 5) insights.push({ type: "alert", priority: "high", title: "Very Low Overall Conversion Rate",
    what: `Only ${convPct}% overall conversion`,
    why: topObjCat.length ? `Top objection: ${topObjCat[0].reason}` : "Multiple factors",
    impact: "Revenue at risk",
    action: "Immediate audit of pitch, timing and product alignment" });

  if (insights.length === 0) insights.push({ type: "success", priority: "low", title: "Customer Intelligence Metrics Stable",
    what: "All CI metrics within acceptable range", why: "Consistent performance",
    impact: "Stable customer experience", action: "Continue monitoring; set stretch targets" });

  return insights;
}
