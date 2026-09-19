import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Bellavita's real Chat performance dashboard -- live aggregates over
 * db_masmis.bb_chat, via GET /api/process-performance/
 * bellavita-chat-dashboard. This table is genuinely huge (189,018 rows,
 * confirmed live 2026-09-17) -- a date-range filter is required here (not
 * just a UX nicety, as with the smaller dashboards elsewhere in this
 * folder) so a query doesn't scan the whole table on every page load.
 * Defaults to the last 30 days.
 *
 * Column caveats found while building this, kept as-is rather than
 * silently "corrected":
 * - is_resolved is NOT a boolean despite its name -- confirmed live it
 *   holds decimal numbers ("32.89", "1148.19", etc., 24,000+ distinct
 *   values) on most rows, which look like a resolution-time figure that
 *   landed in the wrong column during export/upload. "Resolved" is
 *   instead derived from ticket_status IN ('resolved','closed'), which is
 *   clean, reliable text.
 * - agent_name/emp_id/chat_date are NULL on a meaningful share of rows
 *   (visibly true for the most recently uploaded batch) while tl_name
 *   stays populated -- TL-wise is offered as the more complete breakdown;
 *   Agent-wise groups the NULL rows under "Unassigned" rather than
 *   dropping them.
 */

export interface BellavitaChatHeadline {
  totalTickets: number;
  resolvedPct: number;
  repeatPct: number;
  /** Real repeat_status column values, live 2026-09-18: 'Unique' (159,683
   * rows) / 'Repeat' (63,028 rows) -- exposed as counts here (not just
   * repeatPct above) since "how many unique chats overall" is its own
   * headline figure, not just a percentage. */
  uniqueCount: number;
  repeatCount: number;
  /** frt_1/resolution_time/average_wait_time are all small decimal-minute
   * figures on live data (e.g. average_wait_time ranges 0.2-78.73) -- not
   * seconds or hours, confirmed by inspecting real distinct values rather
   * than assumed from the column name. */
  avgFrtMin: number;
  avgResolutionMin: number;
  avgWaitTimeMin: number;
  activeAgents: number;
  activeTls: number;
}

export interface BellavitaChatTrendRow { date: string; tickets: number; uniqueCount: number; resolvedPct: number }
export interface BellavitaChatDispositionRow { disposition: string; count: number; pct: number }
export interface BellavitaChatTlRow {
  tlName: string; tickets: number; uniqueCount: number;
  frtPct: number; inTatPct: number; repeatPct: number;
  /** disposition = 'Saleschat' (see BellavitaChatAgentRow's own note on why
   * 'Inactive sale chat' is excluded). */
  saleCount: number; conversionPct: number;
  /** SUM(db_masmis.bb_sale.amount) for this TL, WHERE campaign = 'Chat',
   * over the same date range -- bb_sale has its own real `tl` column
   * (confirmed live: Bidesh/OJT/Saurabh/Shamsher appear in both bb_chat's
   * tl_name and bb_sale's tl with identical spelling) so this is a real,
   * name-matched figure, not fabricated. It reflects ALL Chat-channel
   * sales for that TL -- bb_sale's `campaign`/`lob` columns only ever hold
   * 'Chat' as a whole (plus 'Repeat customer LOB'/'Abandon Cart'/'Inbound'),
   * with no Bevzilla/Kenaz split, so this figure does NOT narrow further
   * when the page's LOB filter is set to Bevzilla or Kenaz specifically. */
  amount: number;
}
export interface BellavitaChatAgentRow {
  agent: string; empId: string; tickets: number; uniqueCount: number;
  /** disposition = 'Saleschat' specifically -- the real, distinct
   * "Inactive sale chat" disposition (22,782 rows live) is NOT counted
   * here since "inactive" means it didn't convert; only the completed
   * 'Saleschat' disposition (8,860 rows live) represents an actual sale
   * chat, confirmed against real distinct disposition values. */
  saleChatCount: number; conversionPct: number;
  resolvedPct: number; avgWaitTimeMin: number;
}

export interface BellavitaChatDashboardData {
  headline: BellavitaChatHeadline;
  from: string;
  to: string;
  dateWiseTrend: BellavitaChatTrendRow[];
  dispositionBreakdown: BellavitaChatDispositionRow[];
  byTl: BellavitaChatTlRow[];
  agents: BellavitaChatAgentRow[];
  /** Every real LOB value in bb_chat (live 2026-09-18: Chat, Kenaz,
   * Bevzilla, Chat Email, Kenaz Email, Bevzilla Email), independent of the
   * requested date range -- so the filter dropdown always offers every LOB
   * that ever appears in the table, not just whichever happen to fall in
   * the currently selected window. */
  lobOptions: string[];
  /** Only populated when `headline.totalTickets` is 0 for the requested
   * range -- MAX(chat_date) across all of bb_chat, so the frontend can tell
   * "genuinely no chat data yet" apart from "data exists, just not in this
   * window" and offer to jump to it. Confirmed live 2026-09-18: this
   * table's newest row is 2026-09-04, so the page's own "last 7 days"
   * default (2026-09-12..18 today) shows nothing despite 222k+ real rows
   * existing -- not a bug in the data or the query, just a default window
   * that goes stale whenever uploads lag behind the calendar. Computed only
   * on the empty-result path so the common case pays no extra query cost. */
  latestAvailableDate: string | null;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function pad2(n: number): string { return String(n).padStart(2, "0"); }

/** bb_chat has no index on chat_date/tl_name/agent_name/disposition and
 * this app's DB user has no ALTER privilege to add one (same boundary
 * documented elsewhere in this codebase) -- confirmed live, a 30-day
 * window over this table's 189K rows took ~112s end to end, unacceptable
 * for a page load. Defaulting to 7 days keeps the common case fast; the
 * picker still allows widening it (slower, but the user's own choice). */
function last7DaysRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  const f = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { from: f(from), to: f(now) };
}

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = last7DaysRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

const RESOLVED_EXPR = "ticket_status IN ('resolved','closed')";

export async function getBellavitaChatDashboard(
  fromInput: string, toInput: string, lobInput?: string,
): Promise<BellavitaChatDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const lob = lobInput && lobInput.trim() ? lobInput.trim() : null;
  const lobClause = lob ? "AND lob = ?" : "";
  const range = lob ? [from, to, lob] : [from, to];

  const [[headlineRow]] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN repeat_status = 'Repeat' THEN 1 ELSE 0 END) AS repeat_count,
       SUM(CASE WHEN repeat_status = 'Unique' THEN 1 ELSE 0 END) AS unique_count,
       AVG(NULLIF(frt_1, '') + 0) AS avg_frt,
       AVG(NULLIF(resolution_time, '') + 0) AS avg_resolution,
       AVG(NULLIF(average_wait_time, '') + 0) AS avg_wait,
       COUNT(DISTINCT NULLIF(emp_id, '')) AS active_agents,
       COUNT(DISTINCT NULLIF(tl_name, '')) AS active_tls
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) ${lobClause}`,
    range,
  );

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT chat_date AS d, COUNT(*) AS tickets,
       SUM(CASE WHEN repeat_status = 'Unique' THEN 1 ELSE 0 END) AS unique_count,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) ${lobClause}
     GROUP BY chat_date ORDER BY d ASC`,
    range,
  );

  const [dispositionRows] = await db.execute<RowDataPacket[]>(
    `SELECT disposition, COUNT(*) AS n
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) ${lobClause} AND disposition IS NOT NULL AND disposition != ''
     GROUP BY disposition ORDER BY n DESC`,
    range,
  );

  const [tlRows] = await db.execute<RowDataPacket[]>(
    `SELECT tl_name, COUNT(*) AS n,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN repeat_status = 'Repeat' THEN 1 ELSE 0 END) AS repeat_count,
       SUM(CASE WHEN repeat_status = 'Unique' THEN 1 ELSE 0 END) AS unique_count,
       SUM(CASE WHEN frt_tat = 'IN TAT' THEN 1 ELSE 0 END) AS frt_in_tat,
       SUM(CASE WHEN resolution_tat = 'IN TAT' THEN 1 ELSE 0 END) AS res_in_tat,
       SUM(CASE WHEN disposition = 'Saleschat' THEN 1 ELSE 0 END) AS sale_count
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) ${lobClause} AND tl_name IS NOT NULL AND tl_name != ''
     GROUP BY tl_name ORDER BY n DESC`,
    range,
  );

  /** bb_sale's own date column (`Date`) is a plain "YYYY-MM-DD" string
   * (confirmed live) -- directly comparable to `from`/`to` without parsing. */
  const [salesByTlRows] = await db.execute<RowDataPacket[]>(
    `SELECT tl, SUM(amount) AS revenue
     FROM db_masmis.bb_sale
     WHERE campaign = 'Chat' AND \`Date\` >= ? AND \`Date\` <= ? AND tl IS NOT NULL AND tl != ''
     GROUP BY tl`,
    [from, to],
  );
  const revenueByTl = new Map<string, number>();
  for (const r of salesByTlRows) revenueByTl.set(String(r.tl), num(r.revenue));

  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(agent_name, ''), NULLIF(current_agent, ''), 'Unassigned') AS agent, MAX(emp_id) AS emp_id, COUNT(*) AS n,
       SUM(CASE WHEN ${RESOLVED_EXPR} THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN repeat_status = 'Unique' THEN 1 ELSE 0 END) AS unique_count,
       SUM(CASE WHEN disposition = 'Saleschat' THEN 1 ELSE 0 END) AS sale_chat_count,
       AVG(NULLIF(average_wait_time, '') + 0) AS avg_wait
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date < DATE_ADD(?, INTERVAL 1 DAY) ${lobClause}
     GROUP BY agent ORDER BY n DESC LIMIT 200`,
    range,
  );

  const [lobRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT lob FROM db_masmis.bb_chat WHERE lob IS NOT NULL AND lob != '' ORDER BY lob`,
  );

  const total = num(headlineRow?.total);

  let latestAvailableDate: string | null = null;
  if (total === 0) {
    const [[latestRow]] = await db.execute<RowDataPacket[]>(
      `SELECT MAX(chat_date) AS latest FROM db_masmis.bb_chat`,
    );
    latestAvailableDate = latestRow?.latest ? String(latestRow.latest) : null;
  }

  return {
    headline: {
      totalTickets: total,
      resolvedPct: pct(num(headlineRow?.resolved), total),
      repeatPct: pct(num(headlineRow?.repeat_count), total),
      uniqueCount: num(headlineRow?.unique_count),
      repeatCount: num(headlineRow?.repeat_count),
      avgFrtMin: Math.round(num(headlineRow?.avg_frt) * 100) / 100,
      avgResolutionMin: Math.round(num(headlineRow?.avg_resolution) * 100) / 100,
      avgWaitTimeMin: Math.round(num(headlineRow?.avg_wait) * 100) / 100,
      activeAgents: num(headlineRow?.active_agents),
      activeTls: num(headlineRow?.active_tls),
    },
    from, to,
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d), tickets: num(r.tickets), uniqueCount: num(r.unique_count), resolvedPct: pct(num(r.resolved), num(r.tickets)),
    })),
    dispositionBreakdown: dispositionRows.map((r) => ({
      disposition: String(r.disposition), count: num(r.n), pct: pct(num(r.n), total),
    })),
    byTl: tlRows.map((r) => {
      const tlName = String(r.tl_name);
      const n = num(r.n);
      return {
        tlName, tickets: n, uniqueCount: num(r.unique_count),
        frtPct: pct(num(r.frt_in_tat), n), inTatPct: pct(num(r.res_in_tat), n),
        repeatPct: pct(num(r.repeat_count), n),
        saleCount: num(r.sale_count), conversionPct: pct(num(r.sale_count), n),
        amount: revenueByTl.get(tlName) ?? 0,
      };
    }),
    agents: agentRows.map((r) => ({
      agent: String(r.agent), empId: String(r.emp_id || ""), tickets: num(r.n),
      uniqueCount: num(r.unique_count), saleChatCount: num(r.sale_chat_count),
      conversionPct: pct(num(r.sale_chat_count), num(r.n)),
      resolvedPct: pct(num(r.resolved), num(r.n)), avgWaitTimeMin: Math.round(num(r.avg_wait) * 100) / 100,
    })),
    lobOptions: lobRows.map((r) => String(r.lob)),
    latestAvailableDate,
  };
}

/* ------------------------------------------------------------------------ *
 * LOB Snapshot Matrix -- MTD / weekly / daily breakdown per LOB, the same
 * shape as the reference "Chat Dashboard BVO" sheet the user supplied.
 * Scoped to exactly 3 real LOBs per explicit request: Chat, Bevzilla, Kenaz
 * (the 3 chat-channel LOBs; the "...Email" siblings are a separate channel
 * and excluded here, same as the reference sheet).
 *
 * Metrics NOT included, and why -- no real source exists, so they are
 * omitted rather than fabricated (same standard applied throughout this
 * codebase to target/mandate-style figures):
 * - Planned Capacity / Capacity Utilization: no capacity/target table for
 *   Bellavita chat was found in db_masmis after checking every table whose
 *   name suggested one (ci_target_*, kpi_target_master, dashboard_metric_
 *   target, bill_revenue_target_snapshot, etc.) -- none reference bb_chat.
 * - With Out Agent FRT Chat Volume: bb_chat.agent_frt_at is NULL on all
 *   222,711 rows, confirmed live -- a column that exists but was never
 *   populated by any upload, not a real signal.
 * - "Repeat 72hrs" as its own bucket: the real repeat_status_on_assign
 *   column only has 3 populated values (Within 24hrs / Within 48hrs / More
 *   then 48hrs) -- there's no distinct 72-hour cut in the real data, so the
 *   3 real buckets are shown under their real labels instead of forcing a
 *   4th split the data doesn't make.
 * - Revenue / AOV, for Bevzilla and Kenaz specifically: db_masmis.bb_sale's
 *   own campaign/lob columns only ever hold a single combined 'Chat' value
 *   (plus 'Repeat customer LOB'/'Abandon Cart'/'Inbound') -- there is no
 *   Bevzilla/Kenaz split anywhere in bb_sale, confirmed live. Revenue/AOV
 *   are real and shown only for the 'Chat' LOB snapshot; Bevzilla/Kenaz
 *   show null there, not an invented split.
 */

const SNAPSHOT_LOBS = ["Chat", "Bevzilla", "Kenaz"] as const;
export type SnapshotLob = typeof SNAPSHOT_LOBS[number];

export interface LobSnapshotPeriod { key: string; label: string }
export interface LobSnapshotMetricRow {
  metric: string;
  /** Values keyed by period.key; number for a real figure, null when this
   * metric has no real value for that LOB (Revenue/AOV on Bevzilla/Kenaz). */
  values: Record<string, number | null>;
  /** '%' | 'currency' | 'count' -- purely a formatting hint for the frontend. */
  format: "count" | "pct" | "currency";
}
export interface LobSnapshot { lob: SnapshotLob; rows: LobSnapshotMetricRow[] }
export interface LobSnapshotData { periods: LobSnapshotPeriod[]; snapshots: LobSnapshot[] }

function formatDMonYY(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export async function getBellavitaChatLobSnapshot(): Promise<LobSnapshotData> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = isoDate(monthStart);
  const to = isoDate(now);
  const daysSoFar = now.getDate();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lob, chat_date AS d,
       COUNT(*) AS total,
       SUM(CASE WHEN repeat_status = 'Unique' THEN 1 ELSE 0 END) AS unique_count,
       SUM(CASE WHEN frt_tat = 'IN TAT' THEN 1 ELSE 0 END) AS frt_in_tat,
       SUM(CASE WHEN repeat_status_on_assign = 'Within 24hrs' THEN 1 ELSE 0 END) AS rep_24,
       SUM(CASE WHEN repeat_status_on_assign = 'Within 48hrs' THEN 1 ELSE 0 END) AS rep_48,
       SUM(CASE WHEN repeat_status_on_assign = 'More then 48hrs' THEN 1 ELSE 0 END) AS rep_48plus,
       SUM(CASE WHEN disposition = 'Saleschat' THEN 1 ELSE 0 END) AS sale_made
     FROM db_masmis.bb_chat
     WHERE chat_date >= ? AND chat_date <= ? AND lob IN (?, ?, ?)
     GROUP BY lob, chat_date`,
    [from, to, ...SNAPSHOT_LOBS],
  );

  /** bb_sale has no per-LOB (Bevzilla/Kenaz) split -- only ever attributable
   * to the combined 'Chat' campaign, so this is keyed by date only and
   * applied solely to the 'Chat' snapshot below. */
  const [saleRows] = await db.execute<RowDataPacket[]>(
    `SELECT \`Date\` AS d, SUM(amount) AS revenue
     FROM db_masmis.bb_sale
     WHERE campaign = 'Chat' AND \`Date\` >= ? AND \`Date\` <= ?
     GROUP BY \`Date\``,
    [from, to],
  );
  const revenueByDate = new Map<string, number>();
  for (const r of saleRows) revenueByDate.set(String(r.d), num(r.revenue));

  type DayAgg = {
    total: number; unique: number; frtInTat: number;
    rep24: number; rep48: number; rep48plus: number; saleMade: number;
  };
  const byLobByDate = new Map<string, Map<string, DayAgg>>();
  for (const lobName of SNAPSHOT_LOBS) byLobByDate.set(lobName, new Map());
  for (const r of rows) {
    const lobName = String(r.lob);
    const map = byLobByDate.get(lobName);
    if (!map) continue;
    map.set(String(r.d), {
      total: num(r.total), unique: num(r.unique_count), frtInTat: num(r.frt_in_tat),
      rep24: num(r.rep_24), rep48: num(r.rep_48), rep48plus: num(r.rep_48plus), saleMade: num(r.sale_made),
    });
  }

  // Period columns: MTD, then W-1/W-2/... (7-day buckets from day 1, matching
  // bb_chat's own real `week` column convention confirmed live), then every
  // individual day from the 1st through today.
  const periods: LobSnapshotPeriod[] = [{ key: "mtd", label: "MTD" }];
  const weekCount = Math.ceil(daysSoFar / 7);
  for (let w = 1; w <= weekCount; w++) periods.push({ key: `w${w}`, label: `W-${w}` });
  const dayDates: Date[] = [];
  for (let day = 1; day <= daysSoFar; day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    dayDates.push(d);
    periods.push({ key: isoDate(d), label: formatDMonYY(d) });
  }

  const snapshots: LobSnapshot[] = SNAPSHOT_LOBS.map((lobName) => {
    const dateMap = byLobByDate.get(lobName)!;
    const zero: DayAgg = { total: 0, unique: 0, frtInTat: 0, rep24: 0, rep48: 0, rep48plus: 0, saleMade: 0 };
    const dayAggFor = (d: Date) => dateMap.get(isoDate(d)) ?? zero;
    const revenueFor = (d: Date) => (lobName === "Chat" ? revenueByDate.get(isoDate(d)) ?? 0 : null);

    const sumRange = (dates: Date[]): DayAgg => dates.reduce((acc, d) => {
      const a = dayAggFor(d);
      return {
        total: acc.total + a.total, unique: acc.unique + a.unique, frtInTat: acc.frtInTat + a.frtInTat,
        rep24: acc.rep24 + a.rep24, rep48: acc.rep48 + a.rep48, rep48plus: acc.rep48plus + a.rep48plus,
        saleMade: acc.saleMade + a.saleMade,
      };
    }, { ...zero });
    const revenueForRange = (dates: Date[]): number | null =>
      lobName === "Chat" ? dates.reduce((s, d) => s + (revenueFor(d) ?? 0), 0) : null;

    const weekDates: Date[][] = [];
    for (let w = 0; w < weekCount; w++) weekDates.push(dayDates.slice(w * 7, w * 7 + 7));

    const values = {
      total: {} as Record<string, number | null>,
      unique: {} as Record<string, number | null>,
      frtPct: {} as Record<string, number | null>,
      rep24: {} as Record<string, number | null>,
      rep48: {} as Record<string, number | null>,
      rep48plus: {} as Record<string, number | null>,
      saleMade: {} as Record<string, number | null>,
      revenue: {} as Record<string, number | null>,
      aov: {} as Record<string, number | null>,
      convOverall: {} as Record<string, number | null>,
      convUnique: {} as Record<string, number | null>,
    };

    const fill = (key: string, dates: Date[]) => {
      const agg = sumRange(dates);
      const revenue = revenueForRange(dates);
      values.total[key] = agg.total;
      values.unique[key] = agg.unique;
      values.frtPct[key] = pct(agg.frtInTat, agg.total);
      values.rep24[key] = agg.rep24;
      values.rep48[key] = agg.rep48;
      values.rep48plus[key] = agg.rep48plus;
      values.saleMade[key] = agg.saleMade;
      values.revenue[key] = revenue;
      values.aov[key] = revenue != null && agg.saleMade > 0 ? Math.round((revenue / agg.saleMade) * 100) / 100 : (revenue != null ? 0 : null);
      values.convOverall[key] = pct(agg.saleMade, agg.total);
      values.convUnique[key] = pct(agg.saleMade, agg.unique);
    };

    fill("mtd", dayDates);
    weekDates.forEach((dates, i) => fill(`w${i + 1}`, dates));
    dayDates.forEach((d) => fill(isoDate(d), [d]));

    const rowsOut: LobSnapshotMetricRow[] = [
      { metric: "Overall Chat Volume", values: values.total, format: "count" },
      { metric: "Unique Chat Volume", values: values.unique, format: "count" },
      { metric: "FRT %", values: values.frtPct, format: "pct" },
      { metric: "Repeat — Within 24hrs", values: values.rep24, format: "count" },
      { metric: "Repeat — Within 48hrs", values: values.rep48, format: "count" },
      { metric: "Repeat — More than 48hrs", values: values.rep48plus, format: "count" },
      { metric: "Sale Made", values: values.saleMade, format: "count" },
      { metric: "Revenue", values: values.revenue, format: "currency" },
      { metric: "AOV", values: values.aov, format: "currency" },
      { metric: "Conversion % On Overall", values: values.convOverall, format: "pct" },
      { metric: "Conversion % On Unique", values: values.convUnique, format: "pct" },
    ];
    return { lob: lobName, rows: rowsOut };
  });

  return { periods, snapshots };
}
