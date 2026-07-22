import { querySource } from "../../db/sourceDb.js";

export interface InboundQualityFilters {
  startDate: string;
  endDate: string;
  clientId?: string | number;
}

// ── Static NEG_CAT expression (fallback when DB rules unavailable) ─────────────
const NEG_CAT_STATIC = `CASE
  WHEN LOWER(q.top_negative_words) LIKE '%fraud%'          THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%scam%'           THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%cheat%'          THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%legal action%'   THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%consumer forum%' THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%court%'          THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%overcharg%'      THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%defraud%'        THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%cheated%'        THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%nuksan%'         THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%haani%'          THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%badnaam%'        THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%jhooth%'         THEN 'Threat'
  WHEN LOWER(q.top_negative_words) LIKE '%gaali%'          THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%abuse%'          THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%bewakoof%'       THEN 'Abuse'
  WHEN LOWER(q.top_negative_words) LIKE '%sarcas%'         THEN 'Sarcasm'
  WHEN LOWER(q.top_negative_words) LIKE '%mocking%'        THEN 'Sarcasm'
  WHEN LOWER(q.top_negative_words) LIKE '%pathetic%'       THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%disgusting%'     THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%frustrat%'       THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%terrible%'       THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%horrible%'       THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%worst%'          THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%useless%'        THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%pareshaan%'      THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%galat%'          THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%baar baar%'      THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%waste%'          THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%band karo%'      THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%not working%'    THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%broken%'         THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%defective%'      THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%complain%'       THEN 'Frustration'
  WHEN LOWER(q.top_negative_words) LIKE '%expired%'        THEN 'Frustration'
  ELSE 'No'
END`;

const ALERT_FIELD = `CASE
  WHEN (LOWER(TRIM(q.financial_fraud))='yes'
        OR LOWER(q.top_negative_words) LIKE '%scam%'
        OR LOWER(q.top_negative_words) LIKE '%fraud%'
        OR LOWER(q.top_negative_words) LIKE '%cheat%'
        OR LOWER(q.top_negative_words) LIKE '%fake%'
        OR LOWER(q.top_negative_words) LIKE '%loot%')
    THEN 'Scam Leads'
  WHEN (LOWER(q.sensetive_word) LIKE '%court%'
        OR LOWER(q.sensetive_word) LIKE '%consumer%'
        OR LOWER(q.sensetive_word) LIKE '%legal%'
        OR LOWER(q.sensetive_word) LIKE '%fir%'
        OR LOWER(q.sensetive_word) LIKE '%social%')
    THEN 'Social Media and Consumer Court Threat'
  WHEN (q.top_negative_words IS NOT NULL
        AND TRIM(q.top_negative_words) != ''
        AND LOWER(TRIM(q.top_negative_words)) != 'none')
    THEN 'Top Negative Signals'
  ELSE 'Not'
END`;

// ── Dynamic neg-cat expression (reloaded hourly from DB) ────────────────────
let NEG_CAT_EXPR = NEG_CAT_STATIC;

async function ensureNegKeywordsTable(): Promise<void> {
  await querySource(
    `CREATE TABLE IF NOT EXISTS db_audit.neg_category_keywords (
       id       INT AUTO_INCREMENT PRIMARY KEY,
       pattern  VARCHAR(500) NOT NULL COMMENT 'keyword to LIKE-match (case-insensitive)',
       category VARCHAR(50)  NOT NULL COMMENT 'Frustration|Threat|Abuse|Slang|Sarcasm',
       enabled  TINYINT(1)   NOT NULL DEFAULT 1,
       INDEX idx_enabled (enabled)
     )`, []
  );
  const [cnt] = await querySource<{ c: number }>(`SELECT COUNT(*) AS c FROM db_audit.neg_category_keywords`, []);
  if (!cnt || cnt.c === 0) {
    await querySource(
      `INSERT INTO db_audit.neg_category_keywords (pattern, category) VALUES
       ('tampered','Threat'),('expired','Frustration'),('not working','Frustration'),
       ('broken','Frustration'),('defective','Frustration'),('complain','Frustration'),
       ('overcharged','Threat'),('defraud','Threat'),('cheated','Threat'),
       ('baar baar','Frustration'),('pareshaan','Frustration'),('nuksan','Threat'),
       ('haani','Threat'),('badnaam','Threat'),('galat','Frustration'),
       ('jhooth','Threat'),('bewakoof','Abuse'),('gaali','Abuse'),
       ('band karo','Frustration'),('waste','Frustration')`, []
    );
  }
}

async function refreshNegCatExpr(): Promise<void> {
  try {
    await ensureNegKeywordsTable();
    const rules = await querySource<{ pattern: string; category: string }>(
      `SELECT pattern, category FROM db_audit.neg_category_keywords WHERE enabled=1 ORDER BY id ASC`, []
    );
    if (rules.length === 0) return;
    const dynamicWhens = rules
      .map((r) => `  WHEN LOWER(q.top_negative_words) LIKE ${querySource.toString().includes("execute") ? "'%" + r.pattern.replace(/'/g, "''") + "%'" : "'%' || ? || '%'"} THEN '${r.category}'`)
      .join("\n");
    // Build dynamic CASE properly
    const whenClauses = rules
      .map((r) => `  WHEN LOWER(q.top_negative_words) LIKE '%${r.pattern.replace(/'/g, "''")}%' THEN '${r.category}'`)
      .join("\n");
    NEG_CAT_EXPR = `CASE\n${whenClauses}\n  ELSE 'No'\nEND`;
  } catch {
    NEG_CAT_EXPR = NEG_CAT_STATIC;
  }
}

refreshNegCatExpr().catch(() => {});
const _timer = setInterval(() => refreshNegCatExpr().catch(() => {}), 60 * 60 * 1000);
if (typeof (_timer as NodeJS.Timeout).unref === "function") (_timer as NodeJS.Timeout).unref();

// ── Helpers ───────────────────────────────────────────────────────────────────
function clientFilter(alias: string, clientId?: string | number) {
  if (!clientId) return { clause: "", params: [] as (string | number)[] };
  return { clause: ` AND ${alias}.ClientId = ?`, params: [clientId] };
}

// ── Neg Keywords CRUD ─────────────────────────────────────────────────────────
export async function getNegKeywords() {
  await ensureNegKeywordsTable().catch(() => {});
  return querySource<{ id: number; pattern: string; category: string; enabled: number }>(
    `SELECT id, pattern, category, enabled FROM db_audit.neg_category_keywords ORDER BY category, id`, []
  );
}

export async function addNegKeyword(pattern: string, category: string) {
  await querySource(`INSERT INTO db_audit.neg_category_keywords (pattern, category) VALUES (?, ?)`, [pattern, category]);
  await refreshNegCatExpr().catch(() => {});
}

export async function updateNegKeyword(id: number, enabled: boolean) {
  await querySource(`UPDATE db_audit.neg_category_keywords SET enabled=? WHERE id=?`, [enabled ? 1 : 0, id]);
  await refreshNegCatExpr().catch(() => {});
}

export async function reloadNegRules() {
  await refreshNegCatExpr();
}

// ── Client summary ────────────────────────────────────────────────────────────
export async function getInboundClients(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{
    client_id: string; client_name: string; audit_count: number;
    cq_score: number; cq_score_no_fatal: number;
    excellent: number; good: number; average_count: number; below_average: number; fatal_count: number;
  }>(
    `SELECT q.ClientId AS client_id,
      COALESCE(c.name, CONCAT('Client ', q.ClientId)) AS client_name,
      COUNT(*) AS audit_count,
      ROUND(AVG(q.quality_percentage),1) AS cq_score,
      ROUND(AVG(CASE WHEN q.quality_percentage>0 THEN q.quality_percentage END),1) AS cq_score_no_fatal,
      SUM(CASE WHEN q.quality_percentage>=98 THEN 1 ELSE 0 END) AS excellent,
      SUM(CASE WHEN q.quality_percentage>=90 AND q.quality_percentage<98 THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN q.quality_percentage>=85 AND q.quality_percentage<90 THEN 1 ELSE 0 END) AS average_count,
      SUM(CASE WHEN q.quality_percentage>0 AND q.quality_percentage<85 THEN 1 ELSE 0 END) AS below_average,
      SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count
     FROM db_audit.call_quality_assessment q
     LEFT JOIN shivamgiri.md_clients c ON c.dialdesk_client_id = CAST(q.ClientId AS UNSIGNED)
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
     GROUP BY q.ClientId, c.name ORDER BY client_name ASC`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Process KPIs aggregation ──────────────────────────────────────────────────
export async function getInboundProcessKPIs(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);

  const [kpis, achtBands, negCats] = await Promise.all([
    querySource<{
      audit_count: number; cq_score: number; cq_score_no_fatal: number;
      fatal_count: number; fatal_pct: number;
      avg_opening: number; avg_soft: number; avg_hold: number; avg_resolution: number; avg_closing: number;
      social_threat: number; potential_scam: number;
    }>(
      `SELECT COUNT(*) AS audit_count,
        ROUND(AVG(q.quality_percentage),1) AS cq_score,
        ROUND(AVG(CASE WHEN q.quality_percentage>0 THEN q.quality_percentage END),1) AS cq_score_no_fatal,
        SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
        ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct,
        ROUND(AVG(COALESCE(q.professionalism_maintained,0))*100,1) AS avg_opening,
        ROUND(AVG(COALESCE(q.correct_and_complete_information,0))*100,1) AS avg_soft,
        ROUND(AVG(COALESCE(q.proper_hold_procedure,0))*100,1) AS avg_hold,
        ROUND(AVG(COALESCE(q.address_recorded_completely,0))*100,1) AS avg_resolution,
        ROUND(AVG(COALESCE(q.proper_call_closure,0))*100,1) AS avg_closing,
        SUM(CASE WHEN (${ALERT_FIELD})='Social Media and Consumer Court Threat' THEN 1 ELSE 0 END) AS social_threat,
        SUM(CASE WHEN (${ALERT_FIELD})='Scam Leads' THEN 1 ELSE 0 END) AS potential_scam
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}`,
      [startDate, endDate, ...cf.params]
    ),
    querySource<{ category: string; audit_count: number; score_pct: number; fatal_count: number; fatal_pct: number }>(
      `SELECT
        CASE
          WHEN CAST(q.length_in_sec AS UNSIGNED) < 60   THEN 'Short(<1min)'
          WHEN CAST(q.length_in_sec AS UNSIGNED) < 301  THEN 'Average(1min-5min)'
          WHEN CAST(q.length_in_sec AS UNSIGNED) < 600  THEN 'Long(5min-10min)'
          ELSE 'Extremely Long(>10min)'
        END AS category,
        COUNT(*) AS audit_count,
        ROUND(AVG(quality_percentage),1) AS score_pct,
        SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
        ROUND(SUM(CASE WHEN quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL
         AND q.length_in_sec IS NOT NULL AND TRIM(q.length_in_sec) != ''${cf.clause}
       GROUP BY category`,
      [startDate, endDate, ...cf.params]
    ),
    querySource<{ neg_cat: string; cnt: number }>(
      `SELECT (${NEG_CAT_EXPR}) AS neg_cat, COUNT(*) AS cnt
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       GROUP BY neg_cat`,
      [startDate, endDate, ...cf.params]
    ),
  ]);

  return { kpis: kpis[0] ?? null, acht_bands: achtBands, neg_cats: negCats };
}

// ── Top performers ────────────────────────────────────────────────────────────
export async function getTopPerformers(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ user: string; audit_count: number; avg_score: number }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, q.User)) AS user, COUNT(*) AS audit_count,
      ROUND(AVG(q.quality_percentage),1) AS avg_score
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL
       AND q.User IS NOT NULL AND TRIM(q.User) != ''${cf.clause}
     GROUP BY q.User ORDER BY avg_score DESC LIMIT 5`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Daily scores ──────────────────────────────────────────────────────────────
export async function getDailyScores(filters: InboundQualityFilters) {
  const { endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ call_date: string; avg_score: number; audit_count: number }>(
    `SELECT DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date,
      ROUND(AVG(q.quality_percentage),1) AS avg_score, COUNT(*) AS audit_count
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate >= DATE_SUB(DATE(?), INTERVAL 6 DAY)
       AND q.CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND q.quality_percentage IS NOT NULL${cf.clause}
     GROUP BY DATE_FORMAT(q.CallDate,'%Y-%m-%d') ORDER BY call_date ASC`,
    [endDate, endDate, ...cf.params]
  );
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
export async function getScenarios(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ scenario: string; scenario1: string; cnt: number }>(
    `SELECT
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CASE WHEN TRIM(q.scenario1)='' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
      COUNT(*) AS cnt
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
     GROUP BY scenario, scenario1 ORDER BY scenario, cnt DESC`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Social media threats ──────────────────────────────────────────────────────
export async function getSocialMediaThreats(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ scenario: string; scenario1: string; cnt: number }>(
    `SELECT
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CASE WHEN TRIM(q.scenario1)='' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
      COUNT(*) AS cnt
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (${ALERT_FIELD}) = 'Social Media and Consumer Court Threat'
     GROUP BY scenario, scenario1 ORDER BY cnt DESC`,
    [startDate, endDate, ...cf.params]
  );
}

export async function getSocialThreatDetail(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const rows = await querySource<{
    lead_id: string; agent_id: string; threat_word: string; threat_type: string;
    scenario: string; call_date: string;
  }>(
    `SELECT
      COALESCE(q.lead_id,'') AS lead_id,
      q.User AS agent_id,
      COALESCE(NULLIF(TRIM(q.sensetive_word),''),'—') AS threat_word,
      CASE WHEN LOWER(q.sensetive_word) LIKE '%social%' THEN 'Social Media' ELSE 'Court & Legal' END AS threat_type,
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (LOWER(q.sensetive_word) LIKE '%social%' OR LOWER(q.sensetive_word) LIKE '%court%'
            OR LOWER(q.sensetive_word) LIKE '%consumer%' OR LOWER(q.sensetive_word) LIKE '%legal%'
            OR LOWER(q.sensetive_word) LIKE '%fir%')
     ORDER BY q.CallDate DESC LIMIT 500`,
    [startDate, endDate, ...cf.params]
  );
  return { total: rows.length, rows };
}

// ── Positive signals ──────────────────────────────────────────────────────────
export async function getTopPositiveSignals(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const keywords = [
    { keyword: "Thank You",   pattern: "thank"    },
    { keyword: "Satisfied",   pattern: "satisf"   },
    { keyword: "Helpful",     pattern: "helpful"  },
    { keyword: "Resolved",    pattern: "resolv"   },
    { keyword: "Happy",       pattern: "happy"    },
    { keyword: "Excellent",   pattern: "excellen" },
    { keyword: "Quick",       pattern: "quick"    },
    { keyword: "Appreciated", pattern: "appreciat"},
  ];

  const [row] = await querySource<Record<string, number>>(
    `SELECT ${keywords.map((k) =>
      `SUM(CASE WHEN LOWER(q.top_positive_words) LIKE '%${k.pattern}%' THEN 1 ELSE 0 END) AS cust_${k.pattern},
       SUM(CASE WHEN LOWER(q.top_positive_words_agent) LIKE '%${k.pattern}%' THEN 1 ELSE 0 END) AS agent_${k.pattern}`
    ).join(",")}
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}`,
    [startDate, endDate, ...cf.params]
  );

  return keywords.map((k) => ({
    keyword: k.keyword,
    customer_count: row?.[`cust_${k.pattern}`] ?? 0,
    agent_count:    row?.[`agent_${k.pattern}`] ?? 0,
  }));
}

// ── Transcripts ───────────────────────────────────────────────────────────────
export async function getTranscript(leadId: string) {
  const [row] = await querySource<{
    lead_id: string; agent_id: string; date: string; transcript: string;
  }>(
    `SELECT COALESCE(lead_id,'') AS lead_id,
      COALESCE(NULLIF(TRIM(User),''),'Unknown') AS agent_id,
      DATE_FORMAT(CallDate,'%Y-%m-%d %H:%i') AS date,
      COALESCE(Transcribe_Text,'') AS transcript
     FROM db_audit.call_quality_assessment
     WHERE lead_id = ? LIMIT 1`,
    [leadId]
  );
  return row ?? null;
}

// ── Score component detail ────────────────────────────────────────────────────
export async function getScoreComponentDetail(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const params: (string | number)[] = [startDate, endDate, ...cf.params];

  const [row] = await querySource<Record<string, number>>(
    `SELECT COUNT(*) AS total,
      ROUND(100.0*SUM(COALESCE(call_answered_within_5_seconds,0))/NULLIF(COUNT(*),0),1) AS call_answered_within_5_seconds,
      ROUND(100.0*SUM(COALESCE(professionalism_maintained,0))/NULLIF(COUNT(*),0),1) AS call_identified_by_name,
      ROUND(100.0*SUM(COALESCE(customer_concern_acknowledged,0))/NULLIF(COUNT(*),0),1) AS customer_concern_acknowledged,
      ROUND(100.0*SUM(COALESCE(express_empathy,0))/NULLIF(COUNT(*),0),1) AS express_empathy,
      ROUND(100.0*SUM(COALESCE(active_listening,0))/NULLIF(COUNT(*),0),1) AS active_listening,
      ROUND(100.0*SUM(COALESCE(assurance_or_appreciation_provided,0))/NULLIF(COUNT(*),0),1) AS assurance_or_appreciation_provided,
      ROUND(100.0*SUM(COALESCE(politeness_and_no_sarcasm,0))/NULLIF(COUNT(*),0),1) AS politeness_and_no_sarcasm,
      ROUND(100.0*SUM(COALESCE(correct_and_complete_information,0))/NULLIF(COUNT(*),0),1) AS correct_and_complete_information,
      ROUND(100.0*SUM(COALESCE(proper_hold_procedure,0))/NULLIF(COUNT(*),0),1) AS proper_hold_procedure,
      ROUND(100.0*SUM(COALESCE(call_avoidance,0))/NULLIF(COUNT(*),0),1) AS call_avoidance,
      ROUND(100.0*SUM(COALESCE(address_recorded_completely,0))/NULLIF(COUNT(*),0),1) AS address_recorded_completely,
      ROUND(100.0*SUM(COALESCE(professionalism_maintained,0))/NULLIF(COUNT(*),0),1) AS professionalism_maintained,
      ROUND(100.0*SUM(COALESCE(proper_call_closure,0))/NULLIF(COUNT(*),0),1) AS proper_call_closure,
      ROUND(100.0*SUM(COALESCE(first_call_resolution,0))/NULLIF(COUNT(*),0),1) AS first_call_resolution
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}`,
    params
  );
  return row ?? {};
}

// ── Top negative signal details ───────────────────────────────────────────────
export async function getTopNegativeSignalDetails(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ scenario: string; scenario1: string; neg_signal: string; cnt: number }>(
    `SELECT
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CASE WHEN TRIM(q.scenario1)='' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
      (${NEG_CAT_EXPR}) AS neg_signal,
      COUNT(*) AS cnt
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (${ALERT_FIELD}) = 'Top Negative Signals'
     GROUP BY scenario, scenario1, neg_signal HAVING neg_signal != 'No'
     ORDER BY cnt DESC LIMIT 50`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Potential scams ───────────────────────────────────────────────────────────
export async function getPotentialScams(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ scenario: string; scenario1: string; cnt: number }>(
    `SELECT
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CASE WHEN TRIM(q.scenario1)='' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
      COUNT(*) AS cnt
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (${ALERT_FIELD}) = 'Scam Leads'
     GROUP BY scenario, scenario1 ORDER BY cnt DESC`,
    [startDate, endDate, ...cf.params]
  );
}

export async function getPotentialScamsDetail(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const [counts] = await querySource<{ financial_fraud: number; scam_words: number }>(
    `SELECT
      SUM(CASE WHEN LOWER(TRIM(q.financial_fraud))='yes' THEN 1 ELSE 0 END) AS financial_fraud,
      SUM(CASE WHEN LOWER(TRIM(q.financial_fraud))!='yes' AND (${ALERT_FIELD})='Scam Leads' THEN 1 ELSE 0 END) AS scam_words
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (${ALERT_FIELD}) = 'Scam Leads'`,
    [startDate, endDate, ...cf.params]
  );
  const rows = await querySource<{
    lead_id: string; agent_id: string; word: string;
    scenario: string; call_date: string; flag: string;
  }>(
    `SELECT
      COALESCE(q.lead_id,'') AS lead_id,
      q.User AS agent_id,
      COALESCE(q.top_negative_words,'') AS word,
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date,
      CASE WHEN LOWER(TRIM(q.financial_fraud))='yes' THEN 'Financial Fraud' ELSE 'Scam Keywords' END AS flag
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND (${ALERT_FIELD}) = 'Scam Leads'
     ORDER BY q.CallDate DESC LIMIT 300`,
    [startDate, endDate, ...cf.params]
  );
  return { counts: counts ?? { financial_fraud: 0, scam_words: 0 }, rows };
}

// ── Sensitive word analysis ───────────────────────────────────────────────────
export async function getSensitiveWordAnalysis(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const HAS_SW = `(q.sensetive_word IS NOT NULL AND TRIM(q.sensetive_word) != '' AND LOWER(TRIM(q.sensetive_word)) NOT IN ('none','null'))`;
  const SCAM_EXCL = `(${ALERT_FIELD}) != 'Scam Leads'`;

  const [distribution, [dims]] = await Promise.all([
    querySource<{ label: string; cnt: number }>(
      `SELECT TRIM(q.sensetive_word) AS label, COUNT(*) AS cnt
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
         AND ${SCAM_EXCL} AND ${HAS_SW}
       GROUP BY TRIM(q.sensetive_word) ORDER BY cnt DESC LIMIT 20`,
      [startDate, endDate, ...cf.params]
    ),
    querySource<{ akash_count: number; social_count: number; court_count: number }>(
      `SELECT
        SUM(CASE WHEN LOWER(q.sensetive_word) LIKE '%akash%' THEN 1 ELSE 0 END) AS akash_count,
        SUM(CASE WHEN LOWER(q.sensetive_word) LIKE '%social%' THEN 1 ELSE 0 END) AS social_count,
        SUM(CASE WHEN LOWER(q.sensetive_word) LIKE '%court%' OR LOWER(q.sensetive_word) LIKE '%consumer%'
                  OR LOWER(q.sensetive_word) LIKE '%legal%' OR LOWER(q.sensetive_word) LIKE '%fir%' THEN 1 ELSE 0 END) AS court_count
       FROM db_audit.call_quality_assessment q
       WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
         AND ${SCAM_EXCL} AND ${HAS_SW}`,
      [startDate, endDate, ...cf.params]
    ),
  ]);

  return { distribution, dims: dims ?? { akash_count: 0, social_count: 0, court_count: 0 } };
}

// ── Fatal analysis ────────────────────────────────────────────────────────────
export async function getFatalAnalysis(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  const WHERE = `q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}`;
  const baseParams: (string | number)[] = [startDate, endDate, ...cf.params];

  const [kpis, topContributors, dayWise] = await Promise.all([
    querySource<{
      audit_count: number; cq_score: number; fatal_count: number; fatal_pct: number;
    }>(
      `SELECT COUNT(*) AS audit_count, ROUND(AVG(q.quality_percentage),1) AS cq_score,
        SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
        ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct
       FROM db_audit.call_quality_assessment q WHERE ${WHERE}`,
      baseParams
    ),
    querySource<{ agent: string; audit_count: number; fatal_count: number; fatal_pct: number }>(
      `SELECT ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
        COUNT(*) AS audit_count,
        SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count,
        ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct
       FROM db_audit.call_quality_assessment q
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
       WHERE ${WHERE}
       GROUP BY q.User HAVING fatal_count > 0 ORDER BY fatal_count DESC LIMIT 10`,
      baseParams
    ),
    querySource<{ call_date: string; total_audits: number; total_fatal: number; fatal_pct: number }>(
      `SELECT DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date,
        COUNT(*) AS total_audits,
        SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS total_fatal,
        ROUND(SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS fatal_pct
       FROM db_audit.call_quality_assessment q WHERE ${WHERE}
       GROUP BY DATE_FORMAT(q.CallDate,'%Y-%m-%d') HAVING total_fatal > 0 ORDER BY call_date ASC`,
      baseParams
    ),
  ]);

  return { kpis: kpis[0] ?? null, top_contributors: topContributors, day_wise: dayWise };
}

// ── Fatal calls list ──────────────────────────────────────────────────────────
export async function getFatalCallsList(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{
    lead_id: string; agent_id: string; agent_name: string;
    call_date: string; scenario: string; client: string;
  }>(
    `SELECT
      COALESCE(q.lead_id,'') AS lead_id,
      q.User AS agent_id,
      COALESCE(am.AgentName, q.User) AS agent_name,
      DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date,
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CONCAT('Client ', q.ClientId) AS client
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage = 0${cf.clause}
     ORDER BY q.CallDate DESC LIMIT 500`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Agent parameter-wise ──────────────────────────────────────────────────────
export async function getAgentParameterWise(
  filters: InboundQualityFilters & { scenario?: string }
) {
  const { startDate, endDate, clientId, scenario } = filters;
  const cf = clientFilter("q", clientId);
  const scenarioClause = scenario ? ` AND TRIM(q.scenario) = ?` : "";
  const extraParams: (string | number)[] = scenario ? [scenario] : [];

  return querySource<{
    agent: string; campaign: string; audit_count: number;
    opening_pct: number; soft_pct: number; hold_pct: number; resolution_pct: number; closing_pct: number;
    cq_score: number; fatal_count: number;
  }>(
    `SELECT
      ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
      COALESCE(NULLIF(TRIM(q.Campaign),''),'Unknown') AS campaign,
      COUNT(*) AS audit_count,
      ROUND(AVG(COALESCE(q.professionalism_maintained,0))*100,1) AS opening_pct,
      ROUND(AVG(COALESCE(q.correct_and_complete_information,0))*100,1) AS soft_pct,
      ROUND(AVG(COALESCE(q.proper_hold_procedure,0))*100,1) AS hold_pct,
      ROUND(AVG(COALESCE(q.address_recorded_completely,0))*100,1) AS resolution_pct,
      ROUND(AVG(COALESCE(q.proper_call_closure,0))*100,1) AS closing_pct,
      ROUND(AVG(q.quality_percentage),1) AS cq_score,
      SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}${scenarioClause}
     GROUP BY q.User, q.Campaign ORDER BY cq_score DESC`,
    [startDate, endDate, ...cf.params, ...extraParams]
  );
}

// ── Repeat call analysis ──────────────────────────────────────────────────────
export async function getRepeatAnalysis(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{
    scenario: string; total_calls: number; repeat_calls: number; repeat_pct: number;
  }>(
    `SELECT
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      COUNT(*) AS total_calls,
      SUM(CASE WHEN q.quality_percentage > 0 AND q.quality_percentage < 60 THEN 1 ELSE 0 END) AS repeat_calls,
      ROUND(SUM(CASE WHEN q.quality_percentage > 0 AND q.quality_percentage < 60 THEN 1 ELSE 0 END)*100.0/NULLIF(COUNT(*),0),1) AS repeat_pct
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
     GROUP BY scenario ORDER BY repeat_calls DESC`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Agent audit band summary ──────────────────────────────────────────────────
export async function getAgentAuditBandSummary(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{
    agent: string; audit_count: number; cq_score: number;
    excellent: number; good: number; average_count: number; below_average: number; fatal_count: number;
  }>(
    `SELECT ANY_VALUE(COALESCE(am.AgentName, q.User)) AS agent,
      COUNT(*) AS audit_count,
      ROUND(AVG(q.quality_percentage),1) AS cq_score,
      SUM(CASE WHEN q.quality_percentage>=98 THEN 1 ELSE 0 END) AS excellent,
      SUM(CASE WHEN q.quality_percentage>=90 AND q.quality_percentage<98 THEN 1 ELSE 0 END) AS good,
      SUM(CASE WHEN q.quality_percentage>=85 AND q.quality_percentage<90 THEN 1 ELSE 0 END) AS average_count,
      SUM(CASE WHEN q.quality_percentage>0 AND q.quality_percentage<85 THEN 1 ELSE 0 END) AS below_average,
      SUM(CASE WHEN q.quality_percentage=0 THEN 1 ELSE 0 END) AS fatal_count
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
     GROUP BY q.User ORDER BY cq_score DESC`,
    [startDate, endDate, ...cf.params]
  );
}

// ── Raw data ──────────────────────────────────────────────────────────────────
export async function getRawData(filters: InboundQualityFilters, limit = 500) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<Record<string, unknown>>(
    `SELECT
      COALESCE(q.lead_id,'') AS lead_id,
      COALESCE(am.AgentName, q.User) AS agent_name,
      q.User AS agent_code,
      DATE_FORMAT(q.CallDate,'%Y-%m-%d') AS call_date,
      q.quality_percentage AS cq_score,
      CASE WHEN TRIM(q.scenario)='' OR q.scenario IS NULL THEN 'Unknown' ELSE TRIM(q.scenario) END AS scenario,
      CASE WHEN TRIM(q.scenario1)='' OR q.scenario1 IS NULL THEN 'Unknown' ELSE TRIM(q.scenario1) END AS scenario1,
      CONCAT('Client ', q.ClientId) AS client,
      q.top_negative_words, q.top_positive_words, q.sensetive_word, q.financial_fraud,
      (${ALERT_FIELD}) AS alert_flag,
      (${NEG_CAT_EXPR}) AS neg_category
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
     ORDER BY q.CallDate DESC LIMIT ?`,
    [startDate, endDate, ...cf.params, String(limit)]
  );
}

// ── Agent master ──────────────────────────────────────────────────────────────
export async function getAgentMaster() {
  return querySource<{ MasId: string; AgentName: string }>(
    `SELECT MasId, AgentName FROM Shivamgiri.AgentMaster ORDER BY AgentName`
  );
}

export async function getMissingAgents(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = clientFilter("q", clientId);
  return querySource<{ agent_code: string; audit_count: number }>(
    `SELECT q.User AS agent_code, COUNT(*) AS audit_count
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ? AND q.quality_percentage IS NOT NULL${cf.clause}
       AND am.MasId IS NULL
       AND q.User IS NOT NULL AND TRIM(q.User) != ''
     GROUP BY q.User ORDER BY audit_count DESC`,
    [startDate, endDate, ...cf.params]
  );
}

export async function insertAgentMaster(masId: string, agentName: string) {
  await querySource(
    `INSERT IGNORE INTO Shivamgiri.AgentMaster (MasId, AgentName) VALUES (?, ?)`,
    [masId, agentName]
  );
}

// ── CLAP VOC Quotes (verbatim customer voice, populated from 2026-07-17) ─────

const CLAP_BRANCHES = ["customer", "logistic", "agent", "product"] as const;
type ClapBranch = (typeof CLAP_BRANCHES)[number];

function buildClientFilter2(id?: string | number): { clause: string; params: (string | number)[] } {
  if (!id) return { clause: "", params: [] };
  return { clause: " AND q.ClientId = ?", params: [id] };
}

export async function getClapVocQuotes(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = buildClientFilter2(clientId);
  const VOC_DATE_CUTOFF = "2026-07-17";
  const effectiveStart = startDate < VOC_DATE_CUTOFF ? VOC_DATE_CUTOFF : startDate;

  const rows: Record<string, unknown>[] = [];
  for (const branch of CLAP_BRANCHES) {
    const pos = `customer_voc_${branch}_positive`;
    const neg = `customer_voc_${branch}_negative`;
    const result = await querySource<Record<string, unknown>>(
      `SELECT
        q.CallDate AS call_date,
        COALESCE(am.AgentName, q.User) AS agent_name,
        CONCAT('Client ', q.ClientId) AS client,
        q.\`${pos}\` AS positive_quote,
        q.\`${neg}\` AS negative_quote
       FROM db_audit.call_quality_assessment q
       LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
       WHERE q.CallDate BETWEEN ? AND ?
         AND q.CallDate >= ?
         AND (q.\`${pos}\` IS NOT NULL OR q.\`${neg}\` IS NOT NULL)
         ${cf.clause ? cf.clause : ""}
       ORDER BY q.CallDate DESC LIMIT 200`,
      [effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params]
    );
    rows.push(...result.map(r => ({ ...r, branch })));
  }
  return rows;
}

export async function getClapProductVocSummary(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = buildClientFilter2(clientId);
  const VOC_DATE_CUTOFF = "2026-07-17";
  const effectiveStart = startDate < VOC_DATE_CUTOFF ? VOC_DATE_CUTOFF : startDate;

  return querySource<{
    branch: string; positive_count: number; negative_count: number; total_calls: number;
  }>(
    `SELECT
      'customer' AS branch,
      SUM(CASE WHEN customer_voc_customer_positive IS NOT NULL AND customer_voc_customer_positive != '' THEN 1 ELSE 0 END) AS positive_count,
      SUM(CASE WHEN customer_voc_customer_negative IS NOT NULL AND customer_voc_customer_negative != '' THEN 1 ELSE 0 END) AS negative_count,
      COUNT(*) AS total_calls
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.CallDate >= ?${cf.clause}
     UNION ALL
     SELECT
      'logistic',
      SUM(CASE WHEN customer_voc_logistic_positive IS NOT NULL AND customer_voc_logistic_positive != '' THEN 1 ELSE 0 END),
      SUM(CASE WHEN customer_voc_logistic_negative IS NOT NULL AND customer_voc_logistic_negative != '' THEN 1 ELSE 0 END),
      COUNT(*)
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.CallDate >= ?${cf.clause}
     UNION ALL
     SELECT
      'agent',
      SUM(CASE WHEN customer_voc_agent_positive IS NOT NULL AND customer_voc_agent_positive != '' THEN 1 ELSE 0 END),
      SUM(CASE WHEN customer_voc_agent_negative IS NOT NULL AND customer_voc_agent_negative != '' THEN 1 ELSE 0 END),
      COUNT(*)
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.CallDate >= ?${cf.clause}
     UNION ALL
     SELECT
      'product',
      SUM(CASE WHEN customer_voc_product_positive IS NOT NULL AND customer_voc_product_positive != '' THEN 1 ELSE 0 END),
      SUM(CASE WHEN customer_voc_product_negative IS NOT NULL AND customer_voc_product_negative != '' THEN 1 ELSE 0 END),
      COUNT(*)
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.CallDate >= ?${cf.clause}`,
    [
      effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params,
      effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params,
      effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params,
      effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params,
    ]
  );
}

export async function getClapProductVocQuotes(filters: InboundQualityFilters & { branch?: ClapBranch }) {
  const { startDate, endDate, clientId, branch = "product" } = filters;
  const cf = buildClientFilter2(clientId);
  const VOC_DATE_CUTOFF = "2026-07-17";
  const effectiveStart = startDate < VOC_DATE_CUTOFF ? VOC_DATE_CUTOFF : startDate;
  const posCol = `customer_voc_${branch}_positive`;
  const negCol = `customer_voc_${branch}_negative`;

  return querySource<{
    call_date: string; agent_name: string; client: string; sentiment: string; quote: string;
  }>(
    `SELECT
      q.CallDate AS call_date,
      COALESCE(am.AgentName, q.User) AS agent_name,
      CONCAT('Client ', q.ClientId) AS client,
      CASE WHEN q.\`${posCol}\` IS NOT NULL AND q.\`${posCol}\` != '' THEN 'positive' ELSE 'negative' END AS sentiment,
      COALESCE(q.\`${posCol}\`, q.\`${negCol}\`) AS quote
     FROM db_audit.call_quality_assessment q
     LEFT JOIN Shivamgiri.AgentMaster am ON am.MasId = q.User COLLATE utf8mb4_unicode_ci
     WHERE q.CallDate BETWEEN ? AND ?
       AND q.CallDate >= ?
       AND (q.\`${posCol}\` IS NOT NULL OR q.\`${negCol}\` IS NOT NULL)
       ${cf.clause ? cf.clause : ""}
     ORDER BY q.CallDate DESC LIMIT 300`,
    [effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params]
  );
}

export async function getClapIntelligence(filters: InboundQualityFilters) {
  const { startDate, endDate, clientId } = filters;
  const cf = buildClientFilter2(clientId);
  const VOC_DATE_CUTOFF = "2026-07-17";
  const effectiveStart = startDate < VOC_DATE_CUTOFF ? VOC_DATE_CUTOFF : startDate;

  const [summary] = await querySource<{
    total_audits: number; avg_cq_score: number; positive_voc_count: number; negative_voc_count: number;
  }>(
    `SELECT
      COUNT(*) AS total_audits,
      ROUND(AVG(quality_percentage), 1) AS avg_cq_score,
      SUM(CASE WHEN
        (customer_voc_customer_positive IS NOT NULL AND customer_voc_customer_positive != '') OR
        (customer_voc_logistic_positive IS NOT NULL AND customer_voc_logistic_positive != '') OR
        (customer_voc_agent_positive    IS NOT NULL AND customer_voc_agent_positive    != '') OR
        (customer_voc_product_positive  IS NOT NULL AND customer_voc_product_positive  != '')
      THEN 1 ELSE 0 END) AS positive_voc_count,
      SUM(CASE WHEN
        (customer_voc_customer_negative IS NOT NULL AND customer_voc_customer_negative != '') OR
        (customer_voc_logistic_negative IS NOT NULL AND customer_voc_logistic_negative != '') OR
        (customer_voc_agent_negative    IS NOT NULL AND customer_voc_agent_negative    != '') OR
        (customer_voc_product_negative  IS NOT NULL AND customer_voc_product_negative  != '')
      THEN 1 ELSE 0 END) AS negative_voc_count
     FROM db_audit.call_quality_assessment q
     WHERE q.CallDate BETWEEN ? AND ? AND q.CallDate >= ?${cf.clause}`,
    [effectiveStart, endDate, VOC_DATE_CUTOFF, ...cf.params]
  );

  const branchSummary = await getClapProductVocSummary(filters);

  const insights: string[] = [];
  if (summary) {
    const posRate = summary.total_audits > 0
      ? Math.round((summary.positive_voc_count / summary.total_audits) * 100)
      : 0;
    const negRate = summary.total_audits > 0
      ? Math.round((summary.negative_voc_count / summary.total_audits) * 100)
      : 0;
    if (posRate >= 50) insights.push(`Strong positive VOC coverage at ${posRate}% of audits`);
    if (negRate >= 20) insights.push(`Elevated negative VOC at ${negRate}% — review product/logistic branches`);
    const topNeg = branchSummary.sort((a, b) => b.negative_count - a.negative_count)[0];
    if (topNeg) insights.push(`Highest negative volume in '${topNeg.branch}' branch (${topNeg.negative_count} quotes)`);
  }

  return { summary, branch_summary: branchSummary, insights };
}
