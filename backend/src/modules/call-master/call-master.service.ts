import { querySource } from "../../db/sourceDb.js";

export interface CallMasterFilters {
  startDate: string;
  endDate: string;
  clientIds?: number[];
  lob?: "Inbound" | "Outbound" | "All";
}

/*
 * Eight of these nineteen keys were not columns of db_audit.call_quality_assessment, and both
 * queries below built their SELECT straight from this list, so /api/call-master/export and the
 * parameter summary raised ER_BAD_FIELD_ERROR and returned nothing. Eleven working parameters
 * were lost to eight that were never there.
 *
 * `column` is the actual source column; null means the scorecard does not measure that parameter
 * and the queries select NULL for it. Two of the eight did exist under a different name -
 * probing_done is accurate_issue_probing and escalation_handled is case_escalated_correctly -
 * and those are mapped rather than nulled.
 *
 * The remaining six stay in the list with their labels so no export column silently disappears
 * from a file someone reconciles against. They read as blank, which is what they are: there is
 * no call_identified_by_name, call_avoidance, repeat_call_case_registered, resolution_provided,
 * first_call_resolution or social_media_threat parameter in the scorecard. Adding them means
 * adding them upstream, not aliasing a different parameter into their place.
 */
const INBOUND_PARAMS = [
  { key: "call_answered_within_5_seconds",          label: "Answered <5s",           column: "call_answered_within_5_seconds" },
  { key: "call_identified_by_name",                 label: "Identified by Name",     column: null },
  { key: "customer_concern_acknowledged",           label: "Concern Acknowledged",   column: "customer_concern_acknowledged" },
  { key: "express_empathy",                         label: "Empathy Expressed",      column: "express_empathy" },
  { key: "active_listening",                        label: "Active Listening",       column: "active_listening" },
  { key: "assurance_or_appreciation_provided",      label: "Assurance Provided",     column: "assurance_or_appreciation_provided" },
  { key: "politeness_and_no_sarcasm",               label: "Politeness",             column: "politeness_and_no_sarcasm" },
  { key: "correct_and_complete_information",        label: "Correct Info",           column: "correct_and_complete_information" },
  { key: "proper_hold_procedure",                   label: "Hold Procedure",         column: "proper_hold_procedure" },
  { key: "call_avoidance",                          label: "Call Avoidance",         column: null },
  { key: "address_recorded_completely",             label: "Address Recorded",       column: "address_recorded_completely" },
  { key: "professionalism_maintained",              label: "Professionalism",        column: "professionalism_maintained" },
  { key: "proper_call_closure",                     label: "Proper Closure",         column: "proper_call_closure" },
  { key: "repeat_call_case_registered",             label: "Repeat Case Registered", column: null },
  { key: "probing_done",                            label: "Probing Done",           column: "accurate_issue_probing" },
  { key: "resolution_provided",                     label: "Resolution Provided",    column: null },
  { key: "first_call_resolution",                   label: "FCR",                    column: null },
  { key: "escalation_handled",                      label: "Escalation Handled",     column: "case_escalated_correctly" },
  { key: "social_media_threat",                     label: "Social Media Threat",    column: null },
] as const;

const OUTBOUND_PARAMS = [
  { key: "Opening",          label: "Opening" },
  { key: "Offered",          label: "Offered" },
  { key: "ObjectionHandling",label: "Objection Handling" },
  { key: "PrepaidPitch",     label: "Prepaid Pitch" },
  { key: "UpsellingEfforts", label: "Upselling Efforts" },
  { key: "OfferUrgency",     label: "Offer Urgency" },
  { key: "SensitiveWordUsed",label: "Sensitive Word" },
] as const;

function buildClientFilter(alias: "q" | "d" | "", field: string, ids?: number[]): { clause: string; params: number[] } {
  if (!ids || ids.length === 0) return { clause: "", params: [] };
  const ph = ids.map(() => "?").join(",");
  const col = alias ? `${alias}.${field}` : field;
  return { clause: ` AND ${col} IN (${ph})`, params: ids };
}

function buildInboundClientFilter(ids?: number[]) {
  return buildClientFilter("q", "ClientId", ids);
}
function buildOutboundClientFilter(ids?: number[]) {
  return buildClientFilter("d", "client_id", ids);
}

export async function getKPIs(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds, lob = "All" } = filters;

  const ibF = buildInboundClientFilter(clientIds);
  const obF = buildOutboundClientFilter(clientIds);

  const results: Record<string, unknown> = {};

  if (lob === "All" || lob === "Inbound") {
    const [ib] = await querySource<{
      total: number; avg_quality: number; fatal_score: number;
      avg_cx: number; avg_compliance: number;
    }>(
      `SELECT
        COUNT(*) AS total,
        ROUND(AVG(quality_percentage),2) AS avg_quality,
        ROUND(SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS fatal_score,
        ROUND(AVG((COALESCE(customer_concern_acknowledged,0)+COALESCE(express_empathy,0)+
          COALESCE(active_listening,0)+COALESCE(assurance_or_appreciation_provided,0)+
          COALESCE(politeness_and_no_sarcasm,0))/5.0*100),2) AS avg_cx,
        ROUND(AVG((COALESCE(professionalism_maintained,0)+COALESCE(proper_hold_procedure,0)+
          COALESCE(correct_and_complete_information,0)+COALESCE(proper_call_closure,0)+
          COALESCE(address_recorded_completely,0))/5.0*100),2) AS avg_compliance
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}`,
      [startDate, endDate, ...ibF.params]
    );
    results.inbound = ib;
  }

  if (lob === "All" || lob === "Outbound") {
    const [ob] = await querySource<{
      total: number; conversion: number; ob_quality: number;
      satisfaction_pct: number; positive_pct: number; negative_pct: number;
      offer_accept_pct: number; cx_score: number; trust_score: number;
    }>(
      `SELECT
        COUNT(*) AS total,
        ROUND(SUM(CASE WHEN SaleDone='1' THEN 1 ELSE 0 END)/COUNT(*)*100,2) AS conversion,
        ROUND(AVG((Opening+Offered+ObjectionHandling+PrepaidPitch+UpsellingEfforts+OfferUrgency+SensitiveWordUsed)/7.0*100),2) AS ob_quality,
        ROUND(SUM(CASE WHEN LOWER(COALESCE(Feedback_Category,''))='positive' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS positive_pct,
        ROUND(SUM(CASE WHEN LOWER(COALESCE(Feedback_Category,''))='negative' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS negative_pct,
        ROUND(SUM(CASE WHEN LOWER(COALESCE(Feedback_Category,'')) NOT IN ('negative','') AND Feedback IS NOT NULL THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS satisfaction_pct,
        ROUND(SUM(CASE WHEN SaleDone='1' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS offer_accept_pct
       FROM db_external.CallDetails d
       WHERE d.CallDate BETWEEN ? AND ?${obF.clause}`,
      [startDate, endDate, ...obF.params]
    );
    if (ob) {
      // Composite scores from Mydashboards customer-intelligence formulas
      // Trust Score = satisfaction*0.5 + offer_accept*0.3 + (100-negative)*0.2
      const trustScore = Math.round(
        (ob.satisfaction_pct ?? 0) * 0.5 +
        (ob.offer_accept_pct ?? 0) * 0.3 +
        (100 - (ob.negative_pct ?? 0)) * 0.2
      );
      // CX Score = positive*0.6 + offer_accept*0.4
      const cxScore = Math.round(
        (ob.positive_pct ?? 0) * 0.6 +
        (ob.offer_accept_pct ?? 0) * 0.4
      );
      // Happiness Index = rule-based tier
      const happinessIndex =
        trustScore >= 70 && cxScore >= 65 && (ob.conversion ?? 0) > 0 ? "High"
        : trustScore >= 50 || cxScore >= 50 ? "Medium"
        : "Low";
      results.outbound = { ...ob, cx_score: cxScore, trust_score: trustScore, happiness_index: happinessIndex };
    } else {
      results.outbound = ob;
    }
  }

  // Active agents (union)
  if (lob === "All") {
    const ibF2 = buildClientFilter("", "ClientId", clientIds);
    const obF2 = buildClientFilter("", "client_id", clientIds);
    const [cnt] = await querySource<{ cnt: number }>(
      `SELECT COUNT(DISTINCT agent) AS cnt FROM (
        SELECT CONVERT(User USING utf8mb4) COLLATE utf8mb4_general_ci AS agent
        FROM db_audit.call_quality_assessment WHERE CallDate BETWEEN ? AND ?${ibF2.clause}
        UNION
        SELECT CONVERT(AgentName USING utf8mb4) COLLATE utf8mb4_general_ci AS agent
        FROM db_external.CallDetails WHERE CallDate BETWEEN ? AND ?${obF2.clause}
          AND AgentName IS NOT NULL AND AgentName != ''
       ) t`,
      [startDate, endDate, ...ibF2.params, startDate, endDate, ...obF2.params]
    );
    results.active_agents = cnt?.cnt ?? 0;
  } else if (lob === "Inbound") {
    const [cnt] = await querySource<{ cnt: number }>(
      `SELECT COUNT(DISTINCT User) AS cnt FROM db_audit.call_quality_assessment
       WHERE CallDate BETWEEN ? AND ?${ibF.clause}`,
      [startDate, endDate, ...ibF.params]
    );
    results.active_agents = cnt?.cnt ?? 0;
  } else {
    const [cnt] = await querySource<{ cnt: number }>(
      `SELECT COUNT(DISTINCT AgentName) AS cnt FROM db_external.CallDetails d
       WHERE CallDate BETWEEN ? AND ?${obF.clause}
         AND AgentName IS NOT NULL AND AgentName != ''`,
      [startDate, endDate, ...obF.params]
    );
    results.active_agents = cnt?.cnt ?? 0;
  }

  return results;
}

export async function getQualityTrend(
  filters: CallMasterFilters,
  granularity: "daily" | "weekly" | "monthly" = "daily"
) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  const groupExpr =
    granularity === "monthly" ? "DATE_FORMAT(CallDate,'%Y-%m')"
    : granularity === "weekly" ? "DATE_FORMAT(CallDate,'%Y-%u')"
    : "DATE_FORMAT(CallDate,'%Y-%m-%d')";

  return querySource<{ period: string; quality: number; calls: number; fatal: number }>(
    `SELECT ${groupExpr} AS period,
      ROUND(AVG(quality_percentage),2) AS quality,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS fatal
     FROM db_audit.call_quality_assessment q
     WHERE CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY ${groupExpr} ORDER BY period ASC LIMIT 90`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getTopAgents(
  filters: CallMasterFilters,
  limit = 10,
  order: "top" | "bottom" = "top"
) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  const dir = order === "top" ? "DESC" : "ASC";

  return querySource<{
    agent: string; calls: number; quality: number; compliance: number; fatal_rate: number;
  }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
      COUNT(*) AS calls,
      ROUND(AVG(q.quality_percentage),2) AS quality,
      ROUND(AVG((COALESCE(q.professionalism_maintained,0)+COALESCE(q.correct_and_complete_information,0)+
        COALESCE(q.proper_call_closure,0))/3.0*100),2) AS compliance,
      ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS fatal_rate
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY q.User HAVING calls >= 3
     ORDER BY quality ${dir} LIMIT ?`,
    [startDate, endDate, ...ibF.params, String(limit)]
  );
}

export async function getAgentAuditSummary(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);

  return querySource<{
    agent: string; audit_count: number; cq_score: number;
    fatal_count: number; fatal_pct: number; tq_count: number; mq_count: number; bq_count: number;
  }>(
    `SELECT
      ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
      COUNT(*) AS audit_count,
      ROUND(AVG(q.quality_percentage),1) AS cq_score,
      SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
      ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct,
      SUM(CASE WHEN q.quality_percentage>=80 THEN 1 ELSE 0 END) AS tq_count,
      SUM(CASE WHEN q.quality_percentage>=60 AND q.quality_percentage<80 THEN 1 ELSE 0 END) AS mq_count,
      SUM(CASE WHEN q.quality_percentage>0 AND q.quality_percentage<60 THEN 1 ELSE 0 END) AS bq_count
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY q.User ORDER BY cq_score DESC`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getSalesFunnel(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const obF = buildOutboundClientFilter(clientIds);

  const [row] = await querySource<{
    total: number; offered: number; objection: number; upsell: number; sold: number;
  }>(
    `SELECT COUNT(*) AS total,
      SUM(CASE WHEN Opening='1' OR Opening=1 THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN ObjectionHandling='1' OR ObjectionHandling=1 THEN 1 ELSE 0 END) AS objection,
      SUM(CASE WHEN UpsellingEfforts='1' OR UpsellingEfforts=1 THEN 1 ELSE 0 END) AS upsell,
      SUM(CASE WHEN SaleDone='1' OR SaleDone=1 THEN 1 ELSE 0 END) AS sold
     FROM db_external.CallDetails d
     WHERE d.CallDate BETWEEN ? AND ?${obF.clause}`,
    [startDate, endDate, ...obF.params]
  );
  return row ?? null;
}

export async function getCXParameters(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds, lob = "Inbound" } = filters;

  if (lob === "Inbound") {
    const ibF = buildInboundClientFilter(clientIds);
    // AVG() already ignores NULL; COALESCE(x,0) would force a not-recorded parameter
    // to count as a fail, deflating every pass-rate column (same bug fixed in
    // quality-dashboard.routes.ts / inbound-quality.service.ts for this same table).
    const cols = INBOUND_PARAMS.map((p) =>
      p.column
        ? `ROUND(AVG(\`${p.column}\`)*100,1) AS \`${p.key}\``
        : `NULL AS \`${p.key}\``
    ).join(",\n      ");
    const [row] = await querySource<Record<string, number>>(
      `SELECT ${cols} FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}`,
      [startDate, endDate, ...ibF.params]
    );
    return { params: row ?? {}, definitions: INBOUND_PARAMS };
  }

  // Outbound
  const obF = buildOutboundClientFilter(clientIds);
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
     WHERE d.CallDate BETWEEN ? AND ?${obF.clause}`,
    [startDate, endDate, ...obF.params]
  );
  return { params: row ?? {}, definitions: OUTBOUND_PARAMS };
}

export async function getFatalAgentSummary(filters: CallMasterFilters, limit = 500) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);

  return querySource<{
    date: string; agent: string; client: string;
    total_calls: number; fatal_calls: number; fatal_rate: number; avg_quality: number;
  }>(
    `SELECT q.CallDate AS date,
      ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
      ANY_VALUE(COALESCE(c.display_name, CONCAT('Client ', q.ClientId))) AS client,
      COUNT(*) AS total_calls,
      SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_calls,
      ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS fatal_rate,
      ROUND(AVG(q.quality_percentage),2) AS avg_quality
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     LEFT JOIN Shivamgiri.portal_client_config c ON c.client_id = CAST(q.ClientId AS UNSIGNED)
     WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY q.CallDate, q.User, q.ClientId
     ORDER BY q.CallDate DESC, q.User ASC LIMIT ?`,
    [startDate, endDate, ...ibF.params, String(limit)]
  );
}

export async function getCallsByClient(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds, lob = "All" } = filters;

  const ibF = buildInboundClientFilter(clientIds);
  const obF = buildOutboundClientFilter(clientIds);

  const ibQuery = () => querySource<{ client: string; calls: number; avg_quality?: number; conversion?: number }>(
    `SELECT COALESCE(c.display_name, CONCAT('Client ', q.ClientId)) AS client,
      COUNT(*) AS calls,
      ROUND(AVG(q.quality_percentage),2) AS avg_quality
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.portal_client_config c ON c.client_id = CAST(q.ClientId AS UNSIGNED)
     WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY q.ClientId, c.display_name ORDER BY calls DESC`,
    [startDate, endDate, ...ibF.params]
  );

  const obQuery = () => querySource<{ client: string; calls: number; avg_quality?: number; conversion?: number }>(
    `SELECT COALESCE(c.display_name, CONCAT('Client ', d.client_id)) AS client,
      COUNT(*) AS calls,
      ROUND(SUM(CASE WHEN SaleDone='1' THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS conversion
     FROM db_external.CallDetails d
     LEFT JOIN Shivamgiri.portal_client_config c ON c.client_id = CAST(d.client_id AS UNSIGNED)
     WHERE d.CallDate BETWEEN ? AND ?${obF.clause}
     GROUP BY d.client_id, c.display_name ORDER BY calls DESC`,
    [startDate, endDate, ...obF.params]
  );

  if (lob === "Outbound") return obQuery();
  if (lob === "Inbound") return ibQuery();

  // lob === "All": merge inbound + outbound by client name
  const [ib, ob] = await Promise.all([ibQuery(), obQuery()]);
  const merged = new Map<string, { client: string; calls: number; avg_quality?: number; conversion?: number }>();
  for (const r of ib) merged.set(r.client, { ...r });
  for (const r of ob) {
    const existing = merged.get(r.client);
    if (existing) { existing.calls += r.calls; }
    else merged.set(r.client, r);
  }
  return [...merged.values()].sort((a, b) => b.calls - a.calls);
}

export async function getCallsByDay(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  return querySource<{ date: string; calls: number; avg_quality: number; fatal: number }>(
    `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(*) AS calls,
      ROUND(AVG(quality_percentage),2) AS avg_quality,
      SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END) AS fatal
     FROM db_audit.call_quality_assessment q
     WHERE CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d') ORDER BY date ASC`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getFatalByDay(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  return querySource<{ date: string; total: number; fatal: number; fatal_pct: number }>(
    `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(*) AS total,
      SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END) AS fatal,
      ROUND(SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),2) AS fatal_pct
     FROM db_audit.call_quality_assessment q
     WHERE CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d') ORDER BY date ASC`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getScenarioDetail(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  return querySource<{ scenario: string; cnt: number }>(
    `SELECT scenario, COUNT(*) AS cnt
     FROM db_audit.call_quality_assessment q
     WHERE CallDate BETWEEN ? AND ?${ibF.clause}
       AND scenario IS NOT NULL AND scenario != ''
     GROUP BY scenario ORDER BY cnt DESC`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getActiveAgentsList(filters: CallMasterFilters) {
  const { startDate, endDate, clientIds } = filters;
  const ibF = buildInboundClientFilter(clientIds);
  return querySource<{ agent: string; calls: number }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent, COUNT(*) AS calls
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
     GROUP BY q.User ORDER BY calls DESC`,
    [startDate, endDate, ...ibF.params]
  );
}

export async function getClientList() {
  // Query the client master directly — never scan call_quality_assessment without a date range.
  //
  // This read `shivamgiri.md_clients` until 2026-08-11, which was wrong twice over. The MIS host
  // runs lower_case_table_names=0, so `shivamgiri` and `Shivamgiri` are different schemas and the
  // grant (`ON \`Shivamgiri\`.*`) covered neither the lowercase name nor a table that has never
  // existed on this server — there is no md_clients in any schema shivam_user can see. MySQL
  // reports a missing table you lack rights to as ER_TABLEACCESS_DENIED_ERROR rather than
  // "unknown table", so this surfaced as a permissions error and read as a grant problem.
  // The dashboard swallowed the throw and rendered empty, so it looked like "no clients yet".
  //
  // portal_client_config is the real client master on this host: client_id is INT UNSIGNED with a
  // UNIQUE index (18 rows, 18 distinct ids), so it joins 1:1 against the CAST below and cannot
  // fan out. process_mapping_master also carries dialdesk_client_id but is 1:many (22 rows over
  // 17 clients) and would multiply every COUNT/SUM that joins it.
  return querySource<{ id: number; name: string }>(
    `SELECT client_id AS id, display_name AS name
     FROM Shivamgiri.portal_client_config
     WHERE is_active = 1 AND display_name IS NOT NULL AND display_name != ''
     ORDER BY display_name`
  );
}

export async function getExportData(
  filters: CallMasterFilters,
  limit = 5000
) {
  const { startDate, endDate, clientIds, lob = "Inbound" } = filters;

  if (lob !== "Outbound") {
    const ibF = buildInboundClientFilter(clientIds);
    const paramCols = INBOUND_PARAMS.map((p) =>
      p.column ? `q.\`${p.column}\` AS \`${p.key}\`` : `NULL AS \`${p.key}\``
    ).join(", ");
    return querySource<Record<string, unknown>>(
      `SELECT q.CallDate, q.User AS agent_code,
        COALESCE(c.display_name, CONCAT('Client ', q.ClientId)) AS client,
        q.quality_percentage, q.scenario, q.scenario1, ${paramCols}
       FROM db_audit.call_quality_assessment q
       LEFT JOIN Shivamgiri.portal_client_config c ON c.client_id = CAST(q.ClientId AS UNSIGNED)
       WHERE q.CallDate BETWEEN ? AND ?${ibF.clause}
       ORDER BY q.CallDate DESC LIMIT ?`,
      [startDate, endDate, ...ibF.params, String(limit)]
    );
  }

  const obF = buildOutboundClientFilter(clientIds);
  return querySource<Record<string, unknown>>(
    `SELECT d.CallDate, d.AgentName,
      COALESCE(c.display_name, CONCAT('Client ', d.client_id)) AS client,
      d.LengthSec, d.CallDisposition, d.StartTime, d.EndTime,
      d.Opening, d.Offered, d.ObjectionHandling, d.PrepaidPitch, d.UpsellingEfforts, d.OfferUrgency,
      ROUND((d.Opening+d.Offered+d.ObjectionHandling+d.PrepaidPitch+d.UpsellingEfforts+d.OfferUrgency)/6.0*100,1) AS OBQuality,
      d.SaleDone, d.ProductOffering, d.DiscountType, d.Category, d.SubCategory,
      d.Feedback, d.Feedback_Category, d.AreaForImprovement, d.SensitiveWordContext, d.NotInterestedBucketReason
     FROM db_external.CallDetails d
     LEFT JOIN Shivamgiri.portal_client_config c ON c.client_id = CAST(d.client_id AS UNSIGNED)
     WHERE d.CallDate BETWEEN ? AND ?${obF.clause}
       AND d.AgentName IS NOT NULL AND d.AgentName != ''
     ORDER BY d.CallDate DESC LIMIT ?`,
    [startDate, endDate, ...obF.params, String(limit)]
  );
}
