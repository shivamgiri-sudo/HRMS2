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

export async function getProjectHourly(filters: InboundFilters, projectKey: string) {
  const p = PROJECTS.find((x) => x.key === projectKey);
  if (!p) throw new Error(`Unknown project key: ${projectKey}`);

  const { startDate, endDate } = filters;
  const pool = await getDialerPool();
  const ph   = p.campaigns.map(() => "?").join(",");
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  let sql: string;
  if (p.pattern === "A") {
    sql = `SELECT HOUR(CallDate) AS hour,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR   (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY HOUR(CallDate) ORDER BY hour ASC`;
  } else {
    sql = `SELECT HOUR(CallDate) AS hour,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num
     FROM dialer_db.${p.table}
     WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
       AND CampaignName IN (${ph})
     GROUP BY HOUR(CallDate) ORDER BY hour ASC`;
  }

  const [rows] = await pool.execute(sql, params);
  return rows;
}
