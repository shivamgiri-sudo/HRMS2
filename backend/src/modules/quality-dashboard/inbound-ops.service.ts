import { dialerQuery } from "../../db/dialerDb.js";
import mysql from "mysql2/promise";
import { env } from "../../config/env.js";
import type { RowDataPacket } from "mysql2";
import { getInboundProject, getInboundProjects, type InboundProject } from "../call-master/inbound-projects.js";

// ─── Project Configuration (mirrors Tausif's Mydashboards) ─────────────────────

type ProjectConfig = InboundProject;

export async function getProjectsMeta() {
  return (await getInboundProjects()).map(p => ({
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

  const allProjects = await getInboundProjects();
  const projectsToQuery = projectKeys?.length
    ? allProjects.filter(p => projectKeys.includes(p.key))
    : allProjects;

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
  const p = await getInboundProject(projectKey);
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
  const allProjects = await getInboundProjects();
  const projects = projectKeys?.length
    ? allProjects.filter(p => projectKeys.includes(p.key))
    : allProjects;

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
  const p = await getInboundProject(projectKey);
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
