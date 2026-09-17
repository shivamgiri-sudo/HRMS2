import { getDialerPool } from "../../db/dialerDb.js";

interface ProjectConfig {
  key: string;
  name: string;
  icon: string;
  color: string;
  table: string;
  pattern: "A" | "B";
  campaigns: string[];
  mandate: number;
  required: number;
  hasFCR: boolean;
  fcrClientId?: number;
}

interface InboundFilters {
  startDate: string;
  endDate: string;
}

export const PROJECTS: ProjectConfig[] = [
  { key: "gnc",         name: "GNC",          icon: "🛒", color: "#2E86C1", table: "cdr_in_4",     pattern: "A",
    campaigns: ["GNC_Order_Related","GNC_Product_Quality","GNC_Other_Queries","GNC_Product_Info","GNC_Offer_Order","GNC_Authentication"],
    mandate: 8, required: 6, hasFCR: false },
  { key: "bellavita",   name: "Bellavita",     icon: "🌸", color: "#E67E22", table: "cdr_in_11_5",  pattern: "A",
    campaigns: ["H_Bellavita_Luxury","E_Bellavita_Organic","E_Bellavita_Luxury","H_Bellavita_Organic","H_Bevzilla_Complaint",
                "H_Bevzilla_CC_Agent","E_Bevzilla_CC_Agent","H_Bevzilla_Order","E_Bevzilla_Order","E_Bevzilla_Complaint",
                "E_Emb_Existing_Order","H_Bevzilla_Product","H_Emb_New_Order","H_Emb_Existing_Order","E_Bevzilla_Product","E_Emb_New_Order"],
    mandate: 14, required: 12, hasFCR: false },
  { key: "clovia",      name: "Clovia",        icon: "👗", color: "#27AE60", table: "cdr_in_250",   pattern: "A",
    campaigns: ["Clovia_English","Clovia_Hindi"], mandate: 7, required: 6, hasFCR: false },
  { key: "neemans",     name: "Neemans",       icon: "👟", color: "#8E44AD", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Neemans_IB"], mandate: 10, required: 10, hasFCR: true, fcrClientId: 475 },
  { key: "viega",       name: "Viega",         icon: "🚰", color: "#E74C3C", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Viega"], mandate: 2, required: 2, hasFCR: false },
  { key: "exicom",      name: "Exicom",        icon: "⚡", color: "#3498DB", table: "cdr_in_9",     pattern: "B",
    campaigns: ["Exicom_TC_Battery","Exicom_EV_Battery","EV_Charger833"], mandate: 5, required: 5, hasFCR: false },
  { key: "dubangladesh",name: "DU Bangladesh", icon: "🇧🇩", color: "#F39C12", table: "cdr_in_4",   pattern: "B",
    campaigns: ["DU_Bangladesh_Bangla","DU_Bangladesh_Eng","DU_Bangladesh_Hindi"], mandate: 3, required: 3, hasFCR: false },
  // Live on cdr_in_249 (10 language-variant campaigns), confirmed live 2026-09-15:
  // ~1,700 calls/30 days, active through today. required/mandate set to 9 --
  // the observed daily distinct-agent-login count (8-9 over the last 14 days),
  // not an invented target, since no contractual mandate figure exists for this
  // process anywhere in this codebase.
  { key: "dalmia",      name: "Dalmia",        icon: "🏭", color: "#16A085", table: "cdr_in_249",   pattern: "B",
    campaigns: ["Dalmia_Hindi","Dalmia_English","Dalmia_Kannada","Dalmia_Tamil","Dalmia_Bengoli","Dalmia_Malayalam","Dalmia_Odiya","Dalmia_Marathi","Dalmia_Telugu","Dalmia_Assamese"],
    mandate: 9, required: 9, hasFCR: false },
];

type DailyRow = {
  date: string;
  login_count: number;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number;
  unique_phones: number;
};

async function runProjectQuery(p: ProjectConfig, filters: InboundFilters): Promise<DailyRow[]> {
  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph   = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN AgentId END) AS login_count,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR   (AgentId = 'VDCL'  AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END),0) AS acht,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d') ORDER BY date DESC`;
  } else {
    sql = `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      COUNT(DISTINCT CASE WHEN AgentId != 'VDCL' THEN AgentId END) AS login_count,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond),0) AS acht,
      COUNT(DISTINCT PhoneNumber) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d') ORDER BY date DESC`;
  }

  const [rows] = await pool.execute(sql, params);
  return rows as DailyRow[];
}

async function getFCRData(p: ProjectConfig, filters: InboundFilters) {
  if (!p.hasFCR || !p.fcrClientId) return [];
  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date,
      ROUND(100*SUM(CASE WHEN Field2='FCR' THEN 1 ELSE 0 END)/NULLIF(COUNT(Field2),0),2) AS fcr_pct
     FROM dialer_db.data_master_in
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND ClientId = ? AND Field1 = 'Inbound'
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d')`,
    [startDate, endDate, p.fcrClientId]
  );
  return rows as { date: string; fcr_pct: number }[];
}

const n = (v: unknown) => Number(v) || 0;

function aggregateRows(rows: DailyRow[]) {
  const totals = {
    login_count: 0, offered: 0, answered: 0, sl_num: 0, acht_sum: 0, acht_count: 0, unique_phones: 0,
  };
  for (const r of rows) {
    totals.login_count   = Math.max(totals.login_count, n(r.login_count));
    totals.offered      += n(r.offered);
    totals.answered     += n(r.answered);
    totals.sl_num       += n(r.sl_num);
    totals.acht_sum     += n(r.acht) * n(r.answered);
    totals.acht_count   += n(r.answered);
    totals.unique_phones += n(r.unique_phones);
  }
  const sl_pct     = totals.answered ? Math.round(totals.sl_num / totals.answered * 10000) / 100 : 0;
  const aht        = totals.acht_count ? Math.round(totals.acht_sum / totals.acht_count) : 0;
  const abandon_pct = totals.offered ? Math.round((totals.offered - totals.answered) / totals.offered * 10000) / 100 : 0;
  const ans_pct    = totals.offered ? Math.round(totals.answered / totals.offered * 10000) / 100 : 0;
  const avg_wait   = aht; // use AHT as proxy; replace with actual queue time if available
  return {
    total: totals.offered,
    answered: totals.answered,
    abandoned: totals.offered - totals.answered,
    ans_pct,
    abandon_pct,
    sl_pct,
    avg_wait,
    avg_handle: aht,
    login_count: totals.login_count,
    unique_phones: totals.unique_phones,
  };
}

export async function getProjectSummary(filters: InboundFilters, projectKey?: string) {
  const projects = projectKey ? PROJECTS.filter((p) => p.key === projectKey) : PROJECTS;

  const results = await Promise.all(
    projects.map(async (p) => {
      const rows = await runProjectQuery(p, filters);
      const fcrRows = await getFCRData(p, filters);
      const summary = aggregateRows(rows);
      const fcr_pct = fcrRows.length
        ? Math.round(fcrRows.reduce((s, r) => s + r.fcr_pct, 0) / fcrRows.length * 100) / 100
        : null;
      return {
        key: p.key, name: p.name, icon: p.icon, color: p.color,
        mandate: p.mandate, required: p.required, hasFCR: p.hasFCR,
        ...summary, fcr_pct,
      };
    })
  );

  return results;
}

export async function getProjectTrend(filters: InboundFilters, projectKey?: string) {
  const projects = projectKey ? PROJECTS.filter((p) => p.key === projectKey) : PROJECTS;

  return Promise.all(
    projects.map(async (p) => {
      const rows = await runProjectQuery(p, filters);
      return { key: p.key, name: p.name, color: p.color, trend: rows };
    })
  );
}

export async function getConsolidatedTrend(filters: InboundFilters) {
  const trendData = await getProjectTrend(filters);
  const byDate: Record<string, { date: string; offered: number; answered: number; sl_num: number }> = {};

  for (const proj of trendData) {
    for (const row of proj.trend) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, offered: 0, answered: 0, sl_num: 0 };
      byDate[row.date].offered   += n(row.offered);
      byDate[row.date].answered  += n(row.answered);
      byDate[row.date].sl_num    += n(row.sl_num);
    }
  }

  return Object.values(byDate)
    .map((r) => ({
      ...r,
      sl_pct:    r.answered ? Math.round(r.sl_num / r.answered * 100 * 100) / 100 : 0,
      abandon_pct: r.offered ? Math.round((r.offered - r.answered) / r.offered * 100 * 100) / 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

type AgentRow = {
  agent_id: string;
  agent_name: string | null;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number;
  unique_phones: number;
};

/**
 * Agent-wise breakdown for one project's selected date range — same
 * Pattern A/B query shape as runProjectQuery, just GROUP BY AgentId
 * instead of date. VDCL (the queue/no-agent sentinel every Pattern-A/B
 * client uses) is excluded, same as the login_count calculation above:
 * there is no real agent to attribute those rows to.
 */
export async function getProjectAgentSummary(filters: InboundFilters, projectKey: string) {
  const p = PROJECTS.find((x) => x.key === projectKey);
  if (!p) throw new Error(`Unknown project key: ${projectKey}`);

  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT AgentId AS agent_id, MAX(AgentName) AS agent_name,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END),0) AS acht,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph}) AND AgentId != 'VDCL'
     GROUP BY AgentId ORDER BY offered DESC`;
  } else {
    sql = `SELECT AgentId AS agent_id, MAX(AgentName) AS agent_name,
      COUNT(*) AS offered,
      COUNT(*) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond),0) AS acht,
      COUNT(DISTINCT PhoneNumber) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph}) AND AgentId != 'VDCL'
     GROUP BY AgentId ORDER BY offered DESC`;
  }

  const [rows] = await pool.execute(sql, params);
  return (rows as AgentRow[]).map((r) => {
    const offered = n(r.offered);
    const answered = n(r.answered);
    const sl_num = n(r.sl_num);
    const unique_phones = n(r.unique_phones);
    return {
      agentId: r.agent_id,
      // Additive field -- MAX(AgentName) alongside the existing AgentId
      // grouping. cdr_in_4/etc. all carry a real AgentName column (confirmed
      // live) that this query simply never selected before; every existing
      // consumer of this endpoint keeps working unchanged and now also gets
      // a human-readable name instead of a bare login id.
      agentName: r.agent_name || r.agent_id,
      offered,
      answered,
      sl_pct: offered ? Math.round((sl_num / offered) * 10000) / 100 : 0,
      acht: n(r.acht),
      repeat_pct: offered ? Math.round(((offered - unique_phones) / offered) * 10000) / 100 : 0,
    };
  });
}

/**
 * Date x hour matrix for one project -- same Pattern A/B logic as
 * getProjectHourly, but GROUP BY date AND hour instead of collapsing the
 * whole range into 24 buckets. Powers both a single day's slot-wise table
 * and a date x hour heatmap grid over a wider range from one query.
 *
 * Groups by HOUR(HoursSlot), not HOUR(CallDate): CallDate is a DATE column
 * with no time-of-day component (confirmed live -- every row's CallDate is
 * midnight), so HOUR(CallDate) always evaluated to 0 for every row. The
 * real per-call hour lives in HoursSlot ("09:00:00" .. "19:00:00" style
 * text), which a live check against Clovia's 15-Sep-26 data matched the
 * reference report's own slot-wise counts almost exactly.
 */
export async function getProjectHourlyByDate(filters: InboundFilters, projectKey: string) {
  const p = PROJECTS.find((x) => x.key === projectKey);
  if (!p) throw new Error(`Unknown project key: ${projectKey}`);

  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph   = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date, HOUR(HoursSlot) AS hour,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR   (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END),0) AS acht
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d'), HOUR(HoursSlot) ORDER BY date ASC, hour ASC`;
  } else {
    sql = `SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date, HOUR(HoursSlot) AS hour,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond),0) AS acht
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY DATE_FORMAT(CallDate,'%Y-%m-%d'), HOUR(HoursSlot) ORDER BY date ASC, hour ASC`;
  }

  const [rows] = await pool.execute(sql, params);
  return (rows as { date: string; hour: number; offered: number; answered: number; sl_num: number; acht: number }[]).map((r) => ({
    date: r.date,
    hour: n(r.hour),
    offered: n(r.offered),
    answered: n(r.answered),
    sl_pct: n(r.offered) ? Math.round((n(r.sl_num) / n(r.offered)) * 10000) / 100 : 0,
    acht: n(r.acht),
  }));
}

/**
 * Groups by HOUR(HoursSlot), not HOUR(CallDate) -- see getProjectHourlyByDate's
 * doc comment: CallDate has no time-of-day component, so the previous
 * HOUR(CallDate) grouping put every single row in hour 0. This is the
 * pre-existing endpoint ProjectDetailView's hourly chart calls for every
 * company (GNC/Bellavita/Clovia/Neemans/Dalmia/DU Bangladesh/Viega/Exicom),
 * so the fix benefits all of them, not just Clovia.
 */
export async function getProjectHourly(filters: InboundFilters, projectKey: string) {
  const p = PROJECTS.find((x) => x.key === projectKey);
  if (!p) throw new Error(`Unknown project key: ${projectKey}`);

  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph   = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT HOUR(HoursSlot) AS hour,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR   (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY HOUR(HoursSlot) ORDER BY hour ASC`;
  } else {
    sql = `SELECT HOUR(HoursSlot) AS hour,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY HOUR(HoursSlot) ORDER BY hour ASC`;
  }

  const [rows] = await pool.execute(sql, params);
  return rows;
}

type LobRow = {
  campaign: string;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number;
  unique_phones: number;
};

/**
 * LOB-wise (campaign-wise) breakdown for one project's selected date range
 * -- each project's real dialer_db CampaignName values ARE its LOBs (e.g.
 * Bellavita splits into 16 campaigns across Luxury/Organic/Complaint/Order/
 * Product sub-brands; GNC into 6 query-type campaigns; Clovia into just
 * English/Hindi). Same Pattern A/B query shape as runProjectQuery, GROUP BY
 * CampaignName instead of date/hour.
 */
export async function getProjectLobSummary(filters: InboundFilters, projectKey: string) {
  const p = PROJECTS.find((x) => x.key === projectKey);
  if (!p) throw new Error(`Unknown project key: ${projectKey}`);

  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT CampaignName AS campaign,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR   (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END),0) AS acht,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY CampaignName ORDER BY offered DESC`;
  } else {
    sql = `SELECT CampaignName AS campaign,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond),0) AS acht,
      COUNT(DISTINCT PhoneNumber) AS unique_phones
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY CampaignName ORDER BY offered DESC`;
  }

  const [rows] = await pool.execute(sql, params);
  return (rows as LobRow[]).map((r) => {
    const offered = n(r.offered);
    const answered = n(r.answered);
    const slNum = n(r.sl_num);
    return {
      campaign: r.campaign,
      offered,
      answered,
      answeredPct: offered ? Math.round((answered / offered) * 10000) / 100 : 0,
      abandonPct: offered ? Math.round(((offered - answered) / offered) * 10000) / 100 : 0,
      slPct: offered ? Math.round((slNum / offered) * 10000) / 100 : 0,
      acht: n(r.acht),
      uniquePhones: n(r.unique_phones),
    };
  });
}
