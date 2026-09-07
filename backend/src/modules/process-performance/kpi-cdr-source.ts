import { dialerQuery } from "../../db/dialerDb.js";
import type { RowDataPacket } from "mysql2";

/**
 * Real call-center metrics (AL%, SL%, Abn%, Repeat%) for processes whose
 * Inbound LOB has a live campaign in dialer_db.cdr_in_* — a second real data
 * source alongside kpi_daily_actual, for the concepts nothing in
 * kpi_metric_master captures.
 *
 * Reuses the exact Pattern-A CASE-expression logic already proven live in
 * quality-dashboard/inbound-ops.service.ts (verified there against 7 named
 * clients) rather than re-deriving it. Verified live 2026-09-06 against
 * BLA_BLI_BLU's own campaign specifically: dialer_db.cdr_in_10_4,
 * CampaignName='Blabliblu_IN', 40,560 rows through today, AgentId carries the
 * same 'VDCL' (=queue/no-agent) sentinel the other Pattern-A clients use, and
 * DisconnBy never contains 'HOLDTIME' on this table (0 rows) — so the
 * HOLDTIME exclusion is a harmless no-op here, not a mismatch; Pattern A is
 * the correct, faithful choice, not a guess.
 *
 * No cross-database join to `employees` is attempted for the drilldown: the
 * dialer AgentId values (e.g. 'MAS60390') look like mas_hrms employee codes,
 * but that mapping has not been verified live (mas_hrms was unreachable from
 * this box at the time this was written), so the drilldown stays honestly
 * within dialer_db — by agent (as dialer_db names them), then that agent's
 * raw calls. No fabricated "team leader" layer.
 */

export interface CdrSource {
  table: string;
  campaigns: string[];
  pattern: "A" | "B";
}

export type CdrField = "al_pct" | "sl_pct" | "abn_pct" | "repeat_pct" | "acht_sec";

interface CdrDayRow extends RowDataPacket {
  date: string;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number | null;
  unique_phones: number;
}

function buildDayQuery(source: CdrSource): string {
  const placeholders = source.campaigns.map(() => "?").join(",");
  if (source.pattern === "A") {
    return `
      SELECT
        DATE(CallDate) AS date,
        SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
        SUM(CASE WHEN (AgentId != 'VDCL' AND DisconnBy != 'HOLDTIME')
                 OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0) THEN 1 ELSE 0 END) AS answered,
        SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME'
                 AND (AgentId != 'VDCL' OR (AgentId = 'VDCL' AND TIME_TO_SEC(QueueDuration) = 0)) THEN 1 ELSE 0 END) AS sl_num,
        ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END), 0) AS acht,
        COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
      FROM ${source.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
        AND CampaignName IN (${placeholders})
      GROUP BY DATE(CallDate)
      ORDER BY date ASC`;
  }
  return `
    SELECT
      DATE(CallDate) AS date,
      COUNT(*) AS offered,
      SUM(CASE WHEN AgentId != 'VDCL' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN AgentId != 'VDCL' AND TIME_TO_SEC(QueueDuration) <= 30 THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CallDurationSecond), 0) AS acht,
      COUNT(DISTINCT PhoneNumber) AS unique_phones
    FROM ${source.table}
    WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
      AND CampaignName IN (${placeholders})
    GROUP BY DATE(CallDate)
    ORDER BY date ASC`;
}

function metricFromDay(field: CdrField, r: CdrDayRow): number | null {
  const offered = Number(r.offered) || 0;
  const answered = Number(r.answered) || 0;
  const sl_num = Number(r.sl_num) || 0;
  const unique_phones = Number(r.unique_phones) || 0;
  switch (field) {
    case "al_pct": return offered > 0 ? Math.round((answered * 10000) / offered) / 100 : null;
    case "sl_pct": return offered > 0 ? Math.round((sl_num * 10000) / offered) / 100 : null;
    case "abn_pct": return offered > 0 ? Math.round(((offered - answered) * 10000) / offered) / 100 : null;
    case "repeat_pct": return offered > 0 ? Math.round(((offered - unique_phones) * 10000) / offered) / 100 : null;
    case "acht_sec": return r.acht == null ? null : Number(r.acht);
  }
}

export interface CdrScorecardResult {
  value: number | null;
  count: number;
  trend: Array<{ period: string; value: number | null }>;
}

/** Level 1: overall value for the window + a monthly trend, for the scorecard card. */
export async function resolveCdrScorecard(source: CdrSource, field: CdrField, from: string, to: string): Promise<CdrScorecardResult> {
  const rows = await dialerQuery<CdrDayRow>(buildDayQuery(source), [from, to, ...source.campaigns]);
  if (!rows.length) return { value: null, count: 0, trend: [] };

  const totals = rows.reduce(
    (acc, r) => {
      acc.offered += Number(r.offered) || 0;
      acc.answered += Number(r.answered) || 0;
      acc.sl_num += Number(r.sl_num) || 0;
      acc.unique_phones += Number(r.unique_phones) || 0;
      if (r.acht != null) { acc.achtSum += Number(r.acht) * (Number(r.offered) || 0); acc.achtWeight += Number(r.offered) || 0; }
      return acc;
    },
    { offered: 0, answered: 0, sl_num: 0, unique_phones: 0, achtSum: 0, achtWeight: 0 },
  );
  const overall: CdrDayRow = {
    date: "", offered: totals.offered, answered: totals.answered, sl_num: totals.sl_num,
    unique_phones: totals.unique_phones,
    acht: totals.achtWeight > 0 ? totals.achtSum / totals.achtWeight : null,
  } as CdrDayRow;

  const byMonth = new Map<string, CdrDayRow[]>();
  for (const r of rows) {
    const period = String(r.date).slice(0, 7);
    const list = byMonth.get(period) ?? [];
    list.push(r);
    byMonth.set(period, list);
  }
  const trend = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, dayRows]) => {
      const monthTotals = dayRows.reduce(
        (acc, r) => {
          acc.offered += Number(r.offered) || 0;
          acc.answered += Number(r.answered) || 0;
          acc.sl_num += Number(r.sl_num) || 0;
          acc.unique_phones += Number(r.unique_phones) || 0;
          if (r.acht != null) { acc.achtSum += Number(r.acht) * (Number(r.offered) || 0); acc.achtWeight += Number(r.offered) || 0; }
          return acc;
        },
        { offered: 0, answered: 0, sl_num: 0, unique_phones: 0, achtSum: 0, achtWeight: 0 },
      );
      const monthRow: CdrDayRow = {
        date: "", offered: monthTotals.offered, answered: monthTotals.answered, sl_num: monthTotals.sl_num,
        unique_phones: monthTotals.unique_phones,
        acht: monthTotals.achtWeight > 0 ? monthTotals.achtSum / monthTotals.achtWeight : null,
      } as CdrDayRow;
      return { period, value: metricFromDay(field, monthRow) };
    });

  return { value: metricFromDay(field, overall), count: rows.length, trend };
}

interface CdrAgentRow extends RowDataPacket {
  AgentId: string;
  AgentName: string;
  offered: number;
  answered: number;
  sl_num: number;
  acht: number | null;
  unique_phones: number;
}

function buildAgentQuery(source: CdrSource): string {
  const placeholders = source.campaigns.map(() => "?").join(",");
  // Agent-grain breakdown excludes the VDCL "no agent" queue rows entirely —
  // there is no real agent to attribute them to at this level.
  return `
    SELECT
      AgentId, MAX(AgentName) AS AgentName,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS offered,
      SUM(CASE WHEN DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN TIME_TO_SEC(QueueDuration) <= 20 AND DisconnBy != 'HOLDTIME' THEN 1 ELSE 0 END) AS sl_num,
      ROUND(AVG(CASE WHEN DisconnBy != 'HOLDTIME' THEN CallDurationSecond END), 0) AS acht,
      COUNT(DISTINCT CASE WHEN DisconnBy != 'HOLDTIME' THEN PhoneNumber END) AS unique_phones
    FROM ${source.table}
    WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
      AND CampaignName IN (${placeholders})
      AND AgentId != 'VDCL'
    GROUP BY AgentId
    ORDER BY offered DESC
    LIMIT 100`;
}

export interface CdrAgentBreakdownRow {
  agentId: string;
  agentName: string;
  value: number | null;
  offered: number;
}

/** Level 2: by agent, worst/best ordered by the caller. */
export async function getCdrAgentBreakdown(source: CdrSource, field: CdrField, from: string, to: string): Promise<CdrAgentBreakdownRow[]> {
  const rows = await dialerQuery<CdrAgentRow>(buildAgentQuery(source), [from, to, ...source.campaigns]);
  return rows.map((r) => ({
    agentId: r.AgentId,
    agentName: r.AgentName || r.AgentId,
    value: metricFromDay(field, r as unknown as CdrDayRow),
    offered: Number(r.offered) || 0,
  }));
}

interface CdrCallRow extends RowDataPacket {
  id: number;
  CallDate: string;
  Disposition: string;
  DisconnBy: string;
  CallDurationSecond: number;
  QueueDuration: string;
}

/** Level 3 (leaf): raw calls for one agent. */
export async function getCdrAgentCalls(source: CdrSource, agentId: string, from: string, to: string): Promise<CdrCallRow[]> {
  const placeholders = source.campaigns.map(() => "?").join(",");
  const rows = await dialerQuery<CdrCallRow>(
    `SELECT id, CallDate, Disposition, DisconnBy, CallDurationSecond, QueueDuration
       FROM ${source.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY)
        AND CampaignName IN (${placeholders})
        AND AgentId = ?
      ORDER BY CallDate DESC
      LIMIT 200`,
    [from, to, ...source.campaigns, agentId],
  );
  return rows;
}
