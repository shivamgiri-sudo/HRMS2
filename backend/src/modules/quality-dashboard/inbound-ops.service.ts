import { dialerQuery } from "../../db/dialerDb.js";
import mysql from "mysql2/promise";
import { env } from "../../config/env.js";
import type { RowDataPacket } from "mysql2";

// ─── Project Configuration (mirrors Tausif's Mydashboards) ─────────────────────

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
  clientId?: string;
}

const PROJECTS: ProjectConfig[] = [
  {
    key: "gnc", name: "GNC", icon: "\u{1F6D2}", color: "#2E86C1",
    table: "cdr_in_4", pattern: "A",
    campaigns: ["GNC_Order_Related", "GNC_Product_Quality", "GNC_Other_Queries", "GNC_Product_Info", "GNC_Offer_Order", "GNC_Authentication"],
    mandate: 8, required: 6, hasFCR: false, clientId: "409",
  },
  {
    key: "bellavita", name: "Bellavita", icon: "\u{1F338}", color: "#E67E22",
    table: "cdr_in_11_5", pattern: "A",
    campaigns: ["H_Bellavita_Luxury", "E_Bellavita_Organic", "E_Bellavita_Luxury", "H_Bellavita_Organic", "H_Bevzilla_Complaint", "H_Bevzilla_CC_Agent", "E_Bevzilla_CC_Agent", "H_Bevzilla_Order", "E_Bevzilla_Order", "E_Bevzilla_Complaint", "E_Emb_Existing_Order", "H_Bevzilla_Product", "H_Emb_New_Order", "H_Emb_Existing_Order", "E_Bevzilla_Product", "E_Emb_New_Order"],
    mandate: 14, required: 12, hasFCR: false, clientId: "375",
  },
  {
    key: "clovia", name: "Clovia", icon: "\u{1F457}", color: "#27AE60",
    table: "cdr_in_250", pattern: "A",
    campaigns: ["Clovia_English", "Clovia_Hindi"],
    mandate: 7, required: 6, hasFCR: false, clientId: "468",
  },
  {
    key: "neemans", name: "Neemans", icon: "\u{1F45F}", color: "#8E44AD",
    table: "cdr_in_249", pattern: "B",
    campaigns: ["Neemans_IB"],
    mandate: 10, required: 10, hasFCR: true, fcrClientId: 475, clientId: "475",
  },
  {
    key: "viega", name: "Viega", icon: "\u{1F6B0}", color: "#E74C3C",
    table: "cdr_in_249", pattern: "B",
    campaigns: ["Viega"],
    mandate: 2, required: 2, hasFCR: false, clientId: "352",
  },
  {
    key: "exicom", name: "Exicom", icon: "⚡", color: "#3498DB",
    table: "cdr_in_9", pattern: "B",
    campaigns: ["Exicom_TC_Battery", "Exicom_EV_Battery", "EV_Charger833"],
    mandate: 5, required: 5, hasFCR: false, clientId: "326",
  },
  {
    key: "dubangladesh", name: "DU Bangladesh", icon: "\u{1F1E7}\u{1F1E9}", color: "#F39C12",
    table: "cdr_in_4", pattern: "B",
    campaigns: ["DU_Bangladesh_Bangla", "DU_Bangladesh_Eng", "DU_Bangladesh_Hindi"],
    mandate: 3, required: 3, hasFCR: false, clientId: "380",
  },
];

export function getProjectsMeta() {
  return PROJECTS.map(p => ({
    key: p.key, name: p.name, icon: p.icon, color: p.color,
    mandate: p.mandate, required: p.required, hasFCR: p.hasFCR, clientId: p.clientId,
  }));
}

// ─── Cache ──────────────────────────────────────────────────────────────────────

const _cache = new Map<string, { value: unknown; exp: number }>();
function cacheGet<T>(key: string): T | null {
  const e = _cache.get(key);
  if (!e || Date.now() > e.exp) { _cache.delete(key); return null; }
  return e.value as T;
}
function cacheSet(key: string, value: unknown, ttlMs = 120_000) {
  _cache.set(key, { value, exp: Date.now() + ttlMs });
}

// ─── Query Builders (Pattern A = complex IVR routing, Pattern B = simpler) ────

function buildPatternAQuery(p: ProjectConfig): string {
  const placeholders = p.campaigns.map(() => "?").join(",");
  return `
    SELECT
      DATE(CallDate) AS date,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN AgentId END) AS login_count,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
               OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
               AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END), 0) AS acht,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
    FROM dialer_db.${p.table}
    WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
      AND CampaignName IN (${placeholders})
    GROUP BY DATE(CallDate)
    ORDER BY date DESC
  `;
}

function buildPatternBQuery(p: ProjectConfig): string {
  const placeholders = p.campaigns.map(() => "?").join(",");
  return `
    SELECT
      DATE(CallDate) AS date,
      COUNT(DISTINCT CASE WHEN AgentId != 'VDCL' THEN AgentId END) AS login_count,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond), 0) AS acht,
      COUNT(DISTINCT PhoneNumber) AS unique_phones
    FROM dialer_db.${p.table}
    WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
      AND CampaignName IN (${placeholders})
    GROUP BY DATE(CallDate)
    ORDER BY date DESC
  `;
}

function buildFCRQuery(): string {
  return `
    SELECT
      DATE(CallDate) AS date,
      ROUND(100 * SUM(CASE WHEN Field2='FCR' THEN 1 ELSE 0 END) / NULLIF(COUNT(Field2), 0), 2) AS fcr_pct
    FROM dialer_db.data_master_in
    WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
      AND ClientId = ?
      AND Field1 = 'Inbound'
    GROUP BY DATE(CallDate)
  `;
}

// ─── Row Normalizer ─────────────────────────────────────────────────────────────

export interface ProjectDailyRow {
  key: string;
  name: string;
  icon: string;
  color: string;
  date: string;
  offered: number;
  answered: number;
  abandoned: number;
  al: number;
  sl: number;
  acht: number;
  repeat_pct: number;
  login_count: number;
  fcr_pct: number | null;
  deficit: number;
  mandate: number;
  required: number;
}

interface RawRow {
  date: string;
  login_count: number;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number;
  unique_phones: number;
}

function normalizeRow(raw: RawRow, p: ProjectConfig, fcr: number | null = null): ProjectDailyRow {
  const offered = Number(raw.offered) || 0;
  const answered = Number(raw.answered) || 0;
  const sl_num = Number(raw.sl_num) || 0;
  const unique_phones = Number(raw.unique_phones) || 0;
  const login_count = Number(raw.login_count) || 0;
  const acht = Number(raw.acht) || 0;

  const al = offered > 0 ? Math.round(answered * 10000 / offered) / 100 : 0;
  const sl = offered > 0 ? Math.round(sl_num * 10000 / offered) / 100 : 0;
  const repeat_pct = offered > 0 ? Math.round((offered - unique_phones) * 10000 / offered) / 100 : 0;
  const deficit = p.required - login_count;

  return {
    key: p.key, name: p.name, icon: p.icon, color: p.color,
    date: String(raw.date),
    offered, answered, abandoned: offered - answered,
    al, sl, acht, repeat_pct, login_count, fcr_pct: fcr,
    deficit, mandate: p.mandate, required: p.required,
  };
}

// ─── getInboundSummary ──────────────────────────────────────────────────────────

export async function getInboundSummary(
  startDate: string, endDate: string, projectKeys?: string[]
): Promise<ProjectDailyRow[]> {
  const cacheKey = `ib-summary:${projectKeys?.join(",") ?? "all"}:${startDate}:${endDate}`;
  const cached = cacheGet<ProjectDailyRow[]>(cacheKey);
  if (cached) return cached;

  const projectsToQuery = projectKeys?.length
    ? PROJECTS.filter(p => projectKeys.includes(p.key))
    : PROJECTS;

  const results = await Promise.all(
    projectsToQuery.map(async (p) => {
      const sql = p.pattern === "A" ? buildPatternAQuery(p) : buildPatternBQuery(p);
      const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

      try {
        const rows = await dialerQuery<RawRow>(sql, params);

        let totalOffered = 0, totalAnswered = 0, totalSlNum = 0;
        let totalUniquePhones = 0, maxLoginCount = 0, weightedAcht = 0;

        for (const r of rows) {
          const offered = Number(r.offered) || 0;
          totalOffered += offered;
          totalAnswered += Number(r.answered) || 0;
          totalSlNum += Number(r.sl_num) || 0;
          totalUniquePhones += Number(r.unique_phones) || 0;
          maxLoginCount = Math.max(maxLoginCount, Number(r.login_count) || 0);
          weightedAcht += (Number(r.acht) || 0) * offered;
        }

        const acht = totalOffered > 0 ? Math.round(weightedAcht / totalOffered) : 0;

        let fcrPct: number | null = null;
        if (p.hasFCR && p.fcrClientId) {
          try {
            const fcrRows = await dialerQuery<{ date: string; fcr_pct: number }>(
              buildFCRQuery(), [startDate, endDate, p.fcrClientId]
            );
            if (fcrRows.length > 0) {
              const total = fcrRows.reduce((s, r) => s + (Number(r.fcr_pct) || 0), 0);
              fcrPct = Math.round((total / fcrRows.length) * 100) / 100;
            }
          } catch { /* FCR optional */ }
        }

        return normalizeRow({
          date: endDate, login_count: maxLoginCount,
          offered: totalOffered, answered: totalAnswered,
          sl_num: totalSlNum, acht, unique_phones: totalUniquePhones,
        }, p, fcrPct);
      } catch (err: any) {
        console.error(`[inbound-ops] Error querying ${p.key}:`, err.message);
        return normalizeRow({ date: endDate, login_count: 0, offered: 0, answered: 0, sl_num: 0, acht: 0, unique_phones: 0 }, p, null);
      }
    })
  );

  cacheSet(cacheKey, results);
  return results;
}

// ─── getInboundTrend ────────────────────────────────────────────────────────────

export interface TrendRow {
  date: string;
  offered: number;
  answered: number;
  al: number;
  sl: number;
  acht: number;
  repeat_pct: number;
  login_count: number;
}

export async function getInboundTrend(
  startDate: string, endDate: string, projectKey: string
): Promise<TrendRow[]> {
  const p = PROJECTS.find(proj => proj.key === projectKey);
  if (!p) return [];

  const cacheKey = `ib-trend:${projectKey}:${startDate}:${endDate}`;
  const cached = cacheGet<TrendRow[]>(cacheKey);
  if (cached) return cached;

  const sql = p.pattern === "A" ? buildPatternAQuery(p) : buildPatternBQuery(p);
  const params: (string | number)[] = [startDate, endDate, ...p.campaigns];

  try {
    const rows = await dialerQuery<RawRow>(sql, params);
    const result: TrendRow[] = rows.map(r => {
      const offered = Number(r.offered) || 0;
      const answered = Number(r.answered) || 0;
      const sl_num = Number(r.sl_num) || 0;
      const unique_phones = Number(r.unique_phones) || 0;
      return {
        date: String(r.date).slice(0, 10),
        offered, answered,
        al: offered > 0 ? Math.round(answered * 10000 / offered) / 100 : 0,
        sl: offered > 0 ? Math.round(sl_num * 10000 / offered) / 100 : 0,
        acht: Number(r.acht) || 0,
        repeat_pct: offered > 0 ? Math.round((offered - unique_phones) * 10000 / offered) / 100 : 0,
        login_count: Number(r.login_count) || 0,
      };
    });

    cacheSet(cacheKey, result, 300_000);
    return result;
  } catch (err: any) {
    console.error(`[inbound-ops] Trend error for ${projectKey}:`, err.message);
    return [];
  }
}

// ─── getConsolidatedTrend ───────────────────────────────────────────────────────

export interface ConsolidatedTrendRow {
  date: string;
  offered: number;
  answered: number;
  al: number;
  sl: number;
  acht: number;
  total_login: number;
}

export async function getConsolidatedTrend(
  startDate: string, endDate: string, projectKeys?: string[]
): Promise<ConsolidatedTrendRow[]> {
  const projects = projectKeys?.length
    ? PROJECTS.filter(p => projectKeys.includes(p.key))
    : PROJECTS;

  const allTrends = await Promise.all(
    projects.map(p => getInboundTrend(startDate, endDate, p.key))
  );

  const dateMap = new Map<string, { offered: number; answered: number; sl_num: number; acht_weighted: number; login: number }>();

  for (const trend of allTrends) {
    for (const row of trend) {
      const d = dateMap.get(row.date) ?? { offered: 0, answered: 0, sl_num: 0, acht_weighted: 0, login: 0 };
      d.offered += row.offered;
      d.answered += row.answered;
      d.sl_num += row.offered > 0 ? Math.round(row.sl * row.offered / 100) : 0;
      d.acht_weighted += (row.acht || 0) * row.offered;
      d.login += row.login_count;
      dateMap.set(row.date, d);
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      offered: d.offered,
      answered: d.answered,
      al: d.offered > 0 ? Math.round(d.answered * 10000 / d.offered) / 100 : 0,
      sl: d.offered > 0 ? Math.round(d.sl_num * 10000 / d.offered) / 100 : 0,
      acht: d.offered > 0 ? Math.round(d.acht_weighted / d.offered) : 0,
      total_login: d.login,
    }));
}

// ─── getHourlyDistribution ──────────────────────────────────────────────────────

export interface HourlyRow {
  hour: number;
  offered: number;
  answered: number;
  al: number;
  sl: number;
}

export async function getProjectHourly(projectKey: string, date: string): Promise<HourlyRow[]> {
  const p = PROJECTS.find(proj => proj.key === projectKey);
  if (!p) return [];

  const placeholders = p.campaigns.map(() => "?").join(",");
  let sql: string;
  if (p.pattern === "A") {
    sql = `
      SELECT HOUR(CallDate) AS hour,
        SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
        SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
                 OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
                 AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num
      FROM dialer_db.${p.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND CampaignName IN (${placeholders})
      GROUP BY HOUR(CallDate) ORDER BY hour ASC
    `;
  } else {
    sql = `
      SELECT HOUR(CallDate) AS hour,
        COUNT(*) AS offered,
        SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num
      FROM dialer_db.${p.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND CampaignName IN (${placeholders})
      GROUP BY HOUR(CallDate) ORDER BY hour ASC
    `;
  }

  const params: (string | number)[] = [date, date, ...p.campaigns];
  try {
    const rows = await dialerQuery<{ hour: number; offered: number; answered: number; sl_num: number }>(sql, params);
    return rows.map(r => {
      const offered = Number(r.offered) || 0;
      const answered = Number(r.answered) || 0;
      const sl_num = Number(r.sl_num) || 0;
      return {
        hour: Number(r.hour),
        offered, answered,
        al: offered > 0 ? Math.round(answered * 10000 / offered) / 100 : 0,
        sl: offered > 0 ? Math.round(sl_num * 10000 / offered) / 100 : 0,
      };
    });
  } catch (err: any) {
    console.error(`[inbound-ops] Hourly error for ${projectKey}:`, err.message);
    return [];
  }
}
