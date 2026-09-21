import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  type ChartSpec, type CoverageRow, type DetailPayload, type Directory, type Fmt, type Insight, type Kpi, type LobPayload,
  type PeriodBreakdown, type PeriodColumn, type PeriodTable, type QualRow, type DispoRow, type TableSpec, type Tone,
  DATE_EXPR, WEEKDAYS, agentName, avg, buildPeriodColumns, categoryPeriodRows, coverageOf, dispoKpis, dispoSection,
  fmtDdMmYyyy, inRange, kpiPeriodRows, listDays, loadDirectory, loadDispo, loadQuality, num, pct, qualitySection,
  resolveRange, round1, round2, sum, tlOf, weekdayOf,
} from "./clovia-lob.shared.js";
import { dispoDetail, qualityDetail } from "./clovia-lob.detail.js";

/**
 * CLOVIA -- EMAIL slide.
 *
 * Source: db_masmis.cl_email_raw -- ONE ROW PER AGENT PER DAY of daily counts
 * (report_date "1-Sep-26"). It holds no per-email timestamp, so there is no
 * hour-wise view, no turn-around time and no ageing bucket: those metrics are
 * OMITTED rather than invented (see `notes`).
 *
 * Definitions (rows = agent-days after removing exact duplicate uploads):
 *   Assigned   = Sum total_mail_assigned          Touched = Sum total_touched_email
 *   Closed     = Sum closed_email                 Closure % = Closed / Assigned
 *   Touch %    = Touched / Assigned (can exceed 100%: agents also touch carry-over mail)
 *   Open / In-process / Re-open / Junk = Sum of the columns as uploaded. The status
 *     buckets are NOT mutually exclusive with Assigned (e.g. Kanishka 1-Sep: closed 47 +
 *     open 56 + in-process 9 = 112 against 104 assigned), so they are shown "as
 *     reported" and each % is against Assigned; no "backlog" total is derived from them.
 *   Re-open %  = Re-open / Assigned               Junk % = Junk / Assigned
 *   Active agents = distinct emp_id; Avg touched per agent-day = Touched / agent-day rows
 *   Quality    = cl_quality rows with lob = 'Email', filtered on audit_date
 *   Tickets    = cl_dispo rows with skill = 'email' (CRM dispositions), by ticket date
 *
 * DATA QUALITY: cl_email_raw contains exact duplicate rows (same unique_id,
 * same figures -- e.g. Kanishka and Rashmi on 1-Sep and 2-Sep). They are
 * removed on (report_date, emp_id), keeping the latest upload (highest id), and
 * the number removed is shown on the slide. The pre-existing Channels slide sums
 * the raw table and so double-counts them.
 */

export interface EmailRow {
  id: number; date: string; empId: string; agent: string; assigned: number; touched: number; closed: number;
  open: number; inProcess: number; reOpen: number; junk: number;
}
export interface EmailBundle { rows: EmailRow[]; q: QualRow[]; d: DispoRow[] }
interface Loaded extends EmailBundle { dir: Directory; duplicatesRemoved: number; coverage: CoverageRow[]; unparseable: number }

const DMY = "%e-%b-%y";

async function load(from: string, to: string): Promise<Loaded> {
  const [raw] = await db.execute<RowDataPacket[]>(
    `SELECT id, DATE_FORMAT(STR_TO_DATE(report_date,'${DMY}'),'%Y-%m-%d') AS d, emp_id, agent_name, total_mail_assigned, total_touched_email,
            closed_email, open_email, in_process, re_open, junk_mail
       FROM db_masmis.cl_email_raw
      WHERE STR_TO_DATE(report_date,'${DMY}') BETWEEN ? AND ? ORDER BY id`, [from, to],
  );
  const latest = new Map<string, EmailRow>();
  for (const r of raw) {
    const row: EmailRow = {
      id: num(r.id), date: String(r.d), empId: String(r.emp_id ?? ""), agent: String(r.agent_name ?? ""),
      assigned: num(r.total_mail_assigned), touched: num(r.total_touched_email), closed: num(r.closed_email),
      open: num(r.open_email), inProcess: num(r.in_process), reOpen: num(r.re_open), junk: num(r.junk_mail),
    };
    latest.set(`${row.date}|${row.empId}`, row); // later id overwrites: latest upload wins
  }
  const rows = [...latest.values()].sort((a, b) => a.date.localeCompare(b.date) || a.empId.localeCompare(b.empId));
  const [q, d, dir, cov, covQ, covD] = await Promise.all([
    loadQuality(from, to, "Email"), loadDispo(from, to, ["email"]), loadDirectory(),
    coverageOf("Email daily counts", "cl_email_raw", DATE_EXPR.email, "one row per agent per day"),
    coverageOf("Quality audits", "cl_quality", DATE_EXPR.quality, "lob = Email is used here"),
    coverageOf("CRM dispositions", "cl_dispo", DATE_EXPR.dispo, "skill = email is used here"),
  ]);
  return {
    rows, q, d, dir, duplicatesRemoved: raw.length - rows.length, unparseable: cov.unparseable + covQ.unparseable + covD.unparseable,
    coverage: [cov, covQ, covD].map(({ unparseable: _u, ...c }) => c),
  };
}

/* ───────────────────────────── KPI engine ───────────────────────────── */

interface KpiDef { key: string; label: string; fmt: Fmt; tone: Tone; icon: string; tab?: string; sub?: (b: EmailBundle, v: Record<string, number | null>) => string | undefined }
const nf = (n: number) => n.toLocaleString("en-IN");

export function computeEmail(b: EmailBundle): Record<string, number | null> {
  const r = b.rows;
  const assigned = sum(r.map((x) => x.assigned)); const touched = sum(r.map((x) => x.touched)); const closed = sum(r.map((x) => x.closed));
  const reOpen = sum(r.map((x) => x.reOpen)); const junk = sum(r.map((x) => x.junk));
  const days = new Set(r.map((x) => x.date)).size;
  const ql = b.q; const tk = dispoKpis(b.d, "");
  return {
    assigned, touched, closed, open: sum(r.map((x) => x.open)), inProcess: sum(r.map((x) => x.inProcess)), reOpen, junk,
    closurePct: pct(closed, assigned), touchPct: pct(touched, assigned), reopenPct: pct(reOpen, assigned), junkPct: pct(junk, assigned),
    agents: new Set(r.map((x) => x.empId)).size, days,
    avgAssignedPerDay: round1(avg(assigned, days)), avgTouchedPerAgentDay: round1(avg(touched, r.length)),
    audits: ql.length, auditCoverage: pct(ql.length, touched), avgQuality: ql.length ? round2(sum(ql.map((x) => x.score)) / ql.length) : 0,
    fatal: ql.filter((x) => x.fatal).length,
    tickets: b.d.length, ticketEsc: tk[2].value as number, ticketFtr: tk[1].value as number,
  };
}

const DEFS: KpiDef[] = [
  { key: "assigned", label: "Emails assigned", fmt: "int", tone: "sky", icon: "Mail", sub: (_b, v) => `${v.avgAssignedPerDay} per day over ${v.days} days` },
  { key: "touched", label: "Emails touched", fmt: "int", tone: "indigo", icon: "MailOpen", sub: (_b, v) => `${v.touchPct}% of assigned` },
  { key: "closed", label: "Emails closed", fmt: "int", tone: "emerald", icon: "MailCheck" },
  { key: "closurePct", label: "Closure %", fmt: "pct", tone: "teal", icon: "Gauge", sub: (_b, v) => `${nf(v.closed as number)} of ${nf(v.assigned as number)} assigned` },
  { key: "open", label: "Open (as reported)", fmt: "int", tone: "amber", icon: "Inbox", sub: () => "status column, not reconciled to assigned" },
  { key: "inProcess", label: "In process (as reported)", fmt: "int", tone: "cyan", icon: "Hourglass" },
  { key: "reOpen", label: "Re-opened", fmt: "int", tone: "rose", icon: "RotateCcw", sub: (_b, v) => `${v.reopenPct}% of assigned` },
  { key: "junk", label: "Junk mail", fmt: "int", tone: "violet", icon: "Trash2", sub: (_b, v) => `${v.junkPct}% of assigned` },
  { key: "agents", label: "Active agents", fmt: "int", tone: "sky", icon: "Users", sub: (_b, v) => `${v.avgTouchedPerAgentDay} touched per agent-day` },
  { key: "avgQuality", label: "Avg quality score", fmt: "pct", tone: "emerald", icon: "ShieldCheck", sub: (_b, v) => `${v.audits} audits · ${v.fatal} fatal` },
  { key: "auditCoverage", label: "Audit coverage", fmt: "pct", tone: "indigo", icon: "ClipboardCheck", sub: () => "audits ÷ emails touched" },
  { key: "tickets", label: "CRM tickets (email)", fmt: "int", tone: "violet", icon: "ClipboardList", sub: (_b, v) => `${v.ticketEsc}% escalated · FTR ${v.ticketFtr}%` },
];
/** Extra rows only the export / period table carries. */
const PERIOD_EXTRA: Array<{ key: string; label: string; fmt: Fmt }> = [
  { key: "touchPct", label: "Touched vs assigned %", fmt: "pct" }, { key: "reopenPct", label: "Re-open %", fmt: "pct" }, { key: "junkPct", label: "Junk %", fmt: "pct" },
  { key: "avgAssignedPerDay", label: "Avg assigned per day", fmt: "dec1" }, { key: "avgTouchedPerAgentDay", label: "Avg touched per agent-day", fmt: "dec1" },
  { key: "audits", label: "Quality audits", fmt: "int" }, { key: "fatal", label: "Fatal audits", fmt: "int" },
  { key: "ticketEsc", label: "Tickets escalated %", fmt: "pct" }, { key: "ticketFtr", label: "Tickets FTR % (order-linked)", fmt: "pct" },
];

const slice = (b: EmailBundle, from: string, to: string): EmailBundle => ({ rows: inRange(b.rows, from, to), q: inRange(b.q, from, to), d: inRange(b.d, from, to) });

/* ───────────────────────────── report spec ───────────────────────────── */

function agentRows(b: EmailBundle, dir: Directory) {
  const m = new Map<string, EmailRow[]>();
  for (const r of b.rows) (m.get(r.empId) ?? m.set(r.empId, []).get(r.empId)!).push(r);
  const totalAssigned = sum(b.rows.map((r) => r.assigned));
  return [...m.entries()].map(([id, rs]) => {
    const a = sum(rs.map((r) => r.assigned)); const t = sum(rs.map((r) => r.touched)); const c = sum(rs.map((r) => r.closed));
    const aud = b.q.filter((x) => x.empId === id);
    return {
      _key: id, agent: agentName(dir, id), empId: id, tl: tlOf(dir, id), days: rs.length, assigned: a, share: pct(a, totalAssigned), touched: t, closed: c,
      closurePct: pct(c, a), open: sum(rs.map((r) => r.open)), reOpen: sum(rs.map((r) => r.reOpen)), reopenPct: pct(sum(rs.map((r) => r.reOpen)), a),
      junk: sum(rs.map((r) => r.junk)), perDay: round1(avg(t, rs.length)), audits: aud.length, quality: aud.length ? round2(sum(aud.map((x) => x.score)) / aud.length) : null,
    };
  }).sort((x, y) => y.assigned - x.assigned);
}

export async function getEmailLob(fromIn: string, toIn: string): Promise<LobPayload> {
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  const b: EmailBundle = { rows: L.rows, q: L.q, d: L.d };
  const v = computeEmail(b);
  const kpis: Kpi[] = DEFS.map((d) => ({ key: d.key, label: d.label, value: v[d.key] ?? 0, fmt: d.fmt, tone: d.tone, icon: d.icon, sub: d.sub?.(b, v), tab: d.tab ?? "overview" }));

  const days = listDays(from, to);
  const dayRows = days.map((date) => {
    const s = slice(b, date, date); const k = computeEmail(s);
    return {
      _key: date, date, weekday: WEEKDAYS[weekdayOf(date)], agents: k.agents as number, assigned: k.assigned as number, touched: k.touched as number,
      closed: k.closed as number, closurePct: k.closurePct as number, open: k.open as number, inProcess: k.inProcess as number, reOpen: k.reOpen as number, junk: k.junk as number,
    };
  }).filter((d) => d.assigned > 0 || d.touched > 0 || d.closed > 0);

  const wd = new Map<number, { dates: Set<string>; rows: EmailRow[] }>();
  for (const r of b.rows) { const w = weekdayOf(r.date); const e = wd.get(w) ?? { dates: new Set<string>(), rows: [] }; e.dates.add(r.date); e.rows.push(r); wd.set(w, e); }
  const weekdayRows = [1, 2, 3, 4, 5, 6, 0].filter((w) => wd.has(w)).map((w) => {
    const e = wd.get(w)!; const a = sum(e.rows.map((r) => r.assigned)); const c = sum(e.rows.map((r) => r.closed));
    return { _key: String(w), weekday: WEEKDAYS[w], days: e.dates.size, assigned: a, avgAssigned: round1(avg(a, e.dates.size)), closed: c, closurePct: pct(c, a), reOpen: sum(e.rows.map((r) => r.reOpen)) };
  });

  const agents = agentRows(b, L.dir);
  const tlMap = new Map<string, typeof agents>();
  for (const a of agents) (tlMap.get(a.tl) ?? tlMap.set(a.tl, []).get(a.tl)!).push(a);
  const tlRows = [...tlMap.entries()].map(([tl, as]) => {
    const asg = sum(as.map((a) => a.assigned)); const cl = sum(as.map((a) => a.closed));
    return { _key: tl, tl, agents: as.length, assigned: asg, touched: sum(as.map((a) => a.touched)), closed: cl, closurePct: pct(cl, asg), reOpen: sum(as.map((a) => a.reOpen)), reopenPct: pct(sum(as.map((a) => a.reOpen)), asg) };
  }).sort((x, y) => y.assigned - x.assigned);

  const charts: ChartSpec[] = [
    {
      key: "email_daily", title: "Daily assigned, touched and closed", subtitle: "Bars = mail counts; line = closure % (right axis)", tab: "overview", kind: "combo", xKey: "date", xFmt: "date", span: 2,
      series: [
        { key: "assigned", label: "Assigned", color: "#a5b4fc", type: "bar" }, { key: "touched", label: "Touched", color: "#6366f1", type: "bar" },
        { key: "closed", label: "Closed", color: "#10b981", type: "bar" }, { key: "closurePct", label: "Closure %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" },
      ],
      data: dayRows.map((d) => ({ date: d.date, assigned: d.assigned, touched: d.touched, closed: d.closed, closurePct: d.closurePct })), drill: { kind: "day", keyField: "date" },
    },
    {
      key: "email_status", title: "Status columns as reported", subtitle: "Sums of the uploaded status columns (not mutually exclusive with assigned)", tab: "overview", kind: "hbar", xKey: "label", xFmt: "text",
      series: [{ key: "count", label: "Emails", color: "#0ea5e9" }],
      data: [
        { label: "Assigned", count: v.assigned }, { label: "Touched", count: v.touched }, { label: "Closed", count: v.closed }, { label: "Open", count: v.open },
        { label: "In process", count: v.inProcess }, { label: "Re-open", count: v.reOpen }, { label: "Junk", count: v.junk },
      ],
    },
    {
      key: "email_status_daily", title: "Open, in-process and re-open by day", subtitle: "As reported per day", tab: "trends", kind: "combo", xKey: "date", xFmt: "date", span: 2,
      series: [
        { key: "open", label: "Open", color: "#f59e0b", type: "bar", stackId: "s" }, { key: "inProcess", label: "In process", color: "#06b6d4", type: "bar", stackId: "s" },
        { key: "reOpen", label: "Re-open", color: "#f43f5e", type: "bar", stackId: "s" },
      ],
      data: dayRows.map((d) => ({ date: d.date, open: d.open, inProcess: d.inProcess, reOpen: d.reOpen })), drill: { kind: "day", keyField: "date" },
    },
    {
      key: "email_weekday", title: "Average assigned per weekday", tab: "trends", kind: "combo", xKey: "weekday", xFmt: "text",
      series: [{ key: "avgAssigned", label: "Avg assigned / day", color: "#6366f1", type: "bar" }, { key: "closurePct", label: "Closure %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }],
      data: weekdayRows.map((w) => ({ weekday: w.weekday, avgAssigned: w.avgAssigned, closurePct: w.closurePct })), drill: { kind: "weekday", keyField: "weekday" },
    },
    {
      key: "email_agents", title: "Assigned vs closed by agent", tab: "people", kind: "combo", xKey: "agent", xFmt: "text", span: 2,
      series: [{ key: "assigned", label: "Assigned", color: "#a5b4fc", type: "bar" }, { key: "closed", label: "Closed", color: "#10b981", type: "bar" }, { key: "closurePct", label: "Closure %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }],
      data: agents.map((a) => ({ agent: a.agent, _key: a._key, assigned: a.assigned, closed: a.closed, closurePct: a.closurePct })), drill: { kind: "agent", keyField: "_key" },
    },
  ];

  const tables: TableSpec[] = [
    {
      key: "email_daily_t", title: "Date-wise performance", tab: "trends", drillKind: "day", keyField: "_key", defaultSort: { key: "date", dir: "asc" },
      columns: [{ key: "date", label: "Date", align: "left" }, { key: "weekday", label: "Day", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "assigned", label: "Assigned", fmt: "int" }, { key: "touched", label: "Touched", fmt: "int" }, { key: "closed", label: "Closed", fmt: "int" }, { key: "closurePct", label: "Closure %", fmt: "pct" }, { key: "open", label: "Open", fmt: "int" }, { key: "inProcess", label: "In process", fmt: "int" }, { key: "reOpen", label: "Re-open", fmt: "int" }, { key: "junk", label: "Junk", fmt: "int" }],
      rows: dayRows, totals: { date: "Total", assigned: v.assigned, touched: v.touched, closed: v.closed, closurePct: v.closurePct, open: v.open, inProcess: v.inProcess, reOpen: v.reOpen, junk: v.junk },
    },
    {
      key: "email_weekday_t", title: "Weekday pattern", tab: "trends", drillKind: "weekday", keyField: "_key",
      columns: [{ key: "weekday", label: "Weekday", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "assigned", label: "Assigned", fmt: "int" }, { key: "avgAssigned", label: "Avg / day", fmt: "dec1" }, { key: "closed", label: "Closed", fmt: "int" }, { key: "closurePct", label: "Closure %", fmt: "pct" }, { key: "reOpen", label: "Re-open", fmt: "int" }],
      rows: weekdayRows,
    },
    {
      key: "email_agents_t", title: "Agent-wise performance", tab: "people", drillKind: "agent", keyField: "_key", searchable: true, defaultSort: { key: "assigned", dir: "desc" },
      columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "assigned", label: "Assigned", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "touched", label: "Touched", fmt: "int" }, { key: "closed", label: "Closed", fmt: "int" }, { key: "closurePct", label: "Closure %", fmt: "pct" }, { key: "perDay", label: "Touched / day", fmt: "dec1" }, { key: "reOpen", label: "Re-open", fmt: "int" }, { key: "reopenPct", label: "Re-open %", fmt: "pct" }, { key: "junk", label: "Junk", fmt: "int" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "quality", label: "Quality", fmt: "pct" }],
      rows: agents,
    },
    {
      key: "email_tl_t", title: "TL-wise performance", tab: "people", drillKind: "tl", keyField: "_key",
      subtitle: "cl_email_raw carries no TL column: each agent is mapped to the TL recorded for them in the chat log / quality audits.",
      columns: [{ key: "tl", label: "TL", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "assigned", label: "Assigned", fmt: "int" }, { key: "touched", label: "Touched", fmt: "int" }, { key: "closed", label: "Closed", fmt: "int" }, { key: "closurePct", label: "Closure %", fmt: "pct" }, { key: "reOpen", label: "Re-open", fmt: "int" }, { key: "reopenPct", label: "Re-open %", fmt: "pct" }],
      rows: tlRows,
    },
  ];

  const qs = qualitySection(b.q, "quality", "email_q");
  kpis.push(...qs.kpis);
  charts.push(...qs.charts); tables.push(...qs.tables);
  const ds = dispoSection(b.d, "tickets", "email_tk");
  kpis.push(...dispoKpis(b.d, "tickets"));
  charts.push(...ds.charts); tables.push(...ds.tables);

  // ── insights (every sentence is computed from the figures above) ──
  const insights: Insight[] = [];
  if (v.assigned) {
    insights.push({ tone: (v.closurePct as number) >= 60 ? "good" : "warn", text: `${nf(v.closed as number)} of ${nf(v.assigned as number)} assigned emails were closed (${v.closurePct}%); ${nf(v.touched as number)} were touched (${v.touchPct}% of assigned).` });
    const bestDay = [...dayRows].filter((d) => d.assigned >= 20).sort((a, z) => z.closurePct - a.closurePct)[0];
    const worstDay = [...dayRows].filter((d) => d.assigned >= 20).sort((a, z) => a.closurePct - z.closurePct)[0];
    if (bestDay && worstDay && bestDay.date !== worstDay.date) insights.push({ tone: "info", text: `Closure % ranged from ${worstDay.closurePct}% (${fmtDdMmYyyy(worstDay.date)}) to ${bestDay.closurePct}% (${fmtDdMmYyyy(bestDay.date)}) on days with 20+ assigned.` });
    if ((v.reopenPct as number) >= 30) insights.push({ tone: "bad", text: `Re-opened mail equals ${v.reopenPct}% of assigned (${nf(v.reOpen as number)}) -- customers are writing back on mail that was already handled; check first-reply quality.` });
    else if (v.reOpen) insights.push({ tone: "info", text: `Re-opened mail is ${v.reopenPct}% of assigned (${nf(v.reOpen as number)}).` });
    const top = agents[0];
    if (top && agents.length > 1) insights.push({ tone: top.share >= 50 ? "warn" : "info", text: `${top.agent} handles ${top.share}% of assigned mail; ${agents.length} agents worked email in the range.` });
    const lowClose = [...agents].filter((a) => a.assigned >= 100).sort((a, z) => a.closurePct - z.closurePct)[0];
    if (lowClose && agents.length > 1) insights.push({ tone: lowClose.closurePct < 50 ? "warn" : "info", text: `Lowest closure among agents with 100+ assigned: ${lowClose.agent} at ${lowClose.closurePct}%.` });
    const over = dayRows.filter((d) => d.touched > d.assigned).length;
    if (over) insights.push({ tone: "info", text: `Touched exceeded assigned on ${over} day(s) -- agents worked carry-over mail as well as new assignments.` });
  }
  if (b.q.length) {
    const p = qs.tables.find((t) => t.key === "email_q_params")?.rows as Array<{ label: string; passPct: number }> | undefined;
    const weakest = p ? [...p].sort((a, z) => a.passPct - z.passPct)[0] : undefined;
    insights.push({ tone: (v.avgQuality as number) >= 90 ? "good" : "warn", text: `Email quality averages ${v.avgQuality}% across ${b.q.length} audits (${pct(b.q.length, v.touched as number)}% of touched mail).${weakest && weakest.passPct < 100 ? ` Weakest parameter: ${weakest.label} (${weakest.passPct}% compliance).` : ""}`, tab: "quality" });
  }
  if (b.d.length) insights.push({ tone: "info", text: `${nf(b.d.length)} email-skill CRM tickets: ${v.ticketEsc}% escalated, order-linked FTR ${v.ticketFtr}%.`, tab: "tickets" });

  const notes = [
    `${L.duplicatesRemoved} exact duplicate row(s) in cl_email_raw were removed (same date and agent uploaded more than once; latest upload kept). The Channels slide sums the raw table, so its email figures are higher by exactly these rows.`,
    "Status columns (open / in-process / re-open) are shown as uploaded and do not reconcile to 'assigned' (e.g. closed + open + in-process can exceed assigned), so no backlog total is derived from them.",
    "Omitted because the source has no data for them: email turn-around time (TAT), first-response time, ageing buckets, hour-wise volume, per-email handle time and CSAT. cl_email_raw holds only daily counts per agent; the IVR feedback survey covers voice calls only.",
    ...(L.unparseable ? [`${L.unparseable} row(s) across the sources have an unreadable date and are excluded from every date range.`] : []),
    ...qs.notes,
  ];
  const definitions = [
    { term: "Closure %", meaning: "Closed ÷ Assigned (sum of the uploaded closed_email and total_mail_assigned columns)." },
    { term: "Touched vs assigned", meaning: "Touched ÷ Assigned; may exceed 100% because carry-over mail is also touched." },
    { term: "Weeks", meaning: "W-1 = 1st-7th of the month, W-2 = 8th-14th, W-3 = 15th-21st, W-4 = 22nd-28th, W-5 = 29th onward." },
    { term: "Quality / Tickets", meaning: "Audits with lob = Email (by audit date); CRM tickets with skill = email (by ticket date)." },
  ];
  return {
    lob: "email", label: "Email", from, to, filters: {}, options: {},
    tabs: [{ key: "overview", label: "Overview" }, { key: "trends", label: "Date & weekday" }, { key: "people", label: "Agents & TL" }, { key: "quality", label: "Quality" }, { key: "tickets", label: "Tickets" }],
    coverage: L.coverage, kpis, charts, tables, insights, notes, definitions, metrics: v,
    empty: b.rows.length === 0, latestDate: L.coverage[0]?.maxDate ?? null,
  };
}

/* ───────────────────────────── week / date columns ───────────────────────────── */

export async function getEmailPeriods(fromIn: string, toIn: string): Promise<PeriodBreakdown> {
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  const { columns, dailyColumnsOmitted } = buildPeriodColumns(from, to);
  const b: EmailBundle = { rows: L.rows, q: L.q, d: L.d };
  const defs = [...DEFS.map((d) => ({ key: d.key, label: d.label, fmt: d.fmt })), ...PERIOD_EXTRA];
  const seen = new Set<string>();
  const uniq = defs.filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
  const tables: PeriodTable[] = [
    { title: "Email metrics", rowsLabel: "Metric", rows: kpiPeriodRows(uniq, computeEmail, (f, t) => slice(b, f, t), from, to, columns) },
    { title: "Ticket reasons (email skill)", rowsLabel: "Reason", rows: categoryPeriodRows(b.d, (r) => r.reason, columns) },
  ];
  return { from, to, columns: columns as PeriodColumn[], tables, dailyColumnsOmitted };
}

/* ───────────────────────────── drill-down ───────────────────────────── */

const ROW_COLS = [
  { key: "date", label: "Date", align: "left" as const }, { key: "agent", label: "Agent", align: "left" as const }, { key: "assigned", label: "Assigned", fmt: "int" as Fmt },
  { key: "touched", label: "Touched", fmt: "int" as Fmt }, { key: "closed", label: "Closed", fmt: "int" as Fmt }, { key: "open", label: "Open", fmt: "int" as Fmt },
  { key: "inProcess", label: "In process", fmt: "int" as Fmt }, { key: "reOpen", label: "Re-open", fmt: "int" as Fmt }, { key: "junk", label: "Junk", fmt: "int" as Fmt },
];

export async function getEmailDetail(kind: string, key: string, fromIn: string, toIn: string): Promise<DetailPayload | null> {
  const { from, to } = resolveRange(fromIn, toIn);
  const L = await load(from, to);
  const b: EmailBundle = { rows: L.rows, q: L.q, d: L.d };
  if (kind.startsWith("dispo_")) return dispoDetail(kind, key, b.d);
  if (kind.startsWith("quality_")) return qualityDetail(kind, key, b.q);

  let rows: EmailRow[]; let title: string; let subtitle: string; let audits: QualRow[] = [];
  if (kind === "agent") {
    rows = b.rows.filter((r) => r.empId === key); title = agentName(L.dir, key); subtitle = `${key} · TL ${tlOf(L.dir, key)}`; audits = b.q.filter((x) => x.empId === key);
  } else if (kind === "day") { rows = b.rows.filter((r) => r.date === key); title = `Email — ${fmtDdMmYyyy(key)}`; subtitle = WEEKDAYS[weekdayOf(key)]; }
  else if (kind === "weekday") { const w = WEEKDAYS.indexOf(key); if (w < 0) return null; rows = b.rows.filter((r) => weekdayOf(r.date) === w); title = `Email — ${key}s`; subtitle = "All matching weekdays in the range"; }
  else if (kind === "tl") { rows = b.rows.filter((r) => tlOf(L.dir, r.empId) === key); title = `TL — ${key}`; subtitle = "Agents mapped to this TL"; audits = b.q.filter((x) => tlOf(L.dir, x.empId) === key); }
  else return null;

  const s: EmailBundle = { rows, q: audits, d: [] };
  const k = computeEmail(s);
  const kp = (key2: string, label: string, fmt: Fmt, tone: Tone, icon: string, sub?: string): Kpi => ({ key: key2, label, value: k[key2] ?? 0, fmt, tone, icon, sub });
  const byDate = new Map<string, EmailRow[]>();
  for (const r of rows) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  const trend = [...byDate.entries()].sort((a, z) => a[0].localeCompare(z[0])).map(([date, rs]) => ({ date, assigned: sum(rs.map((r) => r.assigned)), closed: sum(rs.map((r) => r.closed)), closurePct: pct(sum(rs.map((r) => r.closed)), sum(rs.map((r) => r.assigned))) }));
  const byAgent = new Map<string, EmailRow[]>();
  for (const r of rows) (byAgent.get(r.empId) ?? byAgent.set(r.empId, []).get(r.empId)!).push(r);
  const sections: DetailPayload["sections"] = [
    { title: "Summary", type: "kpis", kpis: [kp("assigned", "Assigned", "int", "sky", "Mail"), kp("touched", "Touched", "int", "indigo", "MailOpen"), kp("closed", "Closed", "int", "emerald", "MailCheck"), kp("closurePct", "Closure %", "pct", "teal", "Gauge"), kp("reopenPct", "Re-open %", "pct", "rose", "RotateCcw"), kp("junkPct", "Junk %", "pct", "violet", "Trash2")] },
    { title: "Trend", type: "chart", chart: { key: "d", title: "Assigned, closed and closure %", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "assigned", label: "Assigned", color: "#a5b4fc", type: "bar" }, { key: "closed", label: "Closed", color: "#10b981", type: "bar" }, { key: "closurePct", label: "Closure %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }], data: trend } },
  ];
  if (kind !== "agent") {
    sections.push({ title: "Agents", type: "table", table: { columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "assigned", label: "Assigned", fmt: "int" }, { key: "closed", label: "Closed", fmt: "int" }, { key: "closurePct", label: "Closure %", fmt: "pct" }], rows: [...byAgent.entries()].map(([id, rs]) => ({ agent: agentName(L.dir, id), assigned: sum(rs.map((r) => r.assigned)), closed: sum(rs.map((r) => r.closed)), closurePct: pct(sum(rs.map((r) => r.closed)), sum(rs.map((r) => r.assigned))) })).sort((a, z) => z.assigned - a.assigned) }, empty: "No agents." });
  }
  sections.push({
    title: `Agent-day rows (${rows.length})`, type: "table",
    table: { columns: ROW_COLS, rows: [...rows].sort((a, z) => z.date.localeCompare(a.date)).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), agent: agentName(L.dir, r.empId), assigned: r.assigned, touched: r.touched, closed: r.closed, open: r.open, inProcess: r.inProcess, reOpen: r.reOpen, junk: r.junk })), recordType: "emailrow", keyField: "id" },
    empty: "No rows.",
  });
  if (audits.length) {
    sections.push({
      title: `Quality audits (${audits.length})`, type: "table",
      table: { columns: [{ key: "date", label: "Audited", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "query", label: "Query", align: "left" }, { key: "score", label: "Score", fmt: "pct" }, { key: "acpt", label: "Owner", align: "left" }], rows: audits.map((a) => ({ id: a.id, date: fmtDdMmYyyy(a.date), agent: a.empName, query: a.cxQuery, score: a.score, acpt: a.acpt })), recordType: "audit", keyField: "id" },
    });
  }
  return { title, subtitle, badge: { label: `${(k.closurePct as number) ?? 0}% closure`, tone: (k.closurePct as number) >= 60 ? "green" : "amber" }, sections };
}
