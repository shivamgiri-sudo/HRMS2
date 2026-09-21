import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getInboundInsights, getInboundPeriods } from "../call-master/inbound-insights.service.js";
import {
  type ChartSpec, type Column, type CoverageRow, type DetailPayload, type Insight, type Kpi, type LobPayload, type PeriodBreakdown, type PeriodTable, type TableSpec,
  DATE_EXPR, agentName, coverageOf, fmtDdMmYyyy, listDays, loadDirectory, loadQuality, num, pct, resolveRange, round2, sum,
} from "./clovia-lob.shared.js";
import { getEmailLob, getEmailPeriods } from "./clovia-lob-email.service.js";
import { getChatLob, getChatPeriods } from "./clovia-lob-chat.service.js";
import { getOutboundLob, getOutboundPeriods } from "./clovia-lob-outbound.service.js";
import { getInboundExtras, getInboundExtrasPeriods } from "./clovia-lob-inbound.service.js";

/**
 * CLOVIA -- OVERVIEW scorecard (one row per LOB) built ONLY from the four LOB
 * services, so every number on the Overview is the same number the LOB slide
 * shows for the same dates:
 *   Inbound   = shared inbound insights on the live dialer (cdr_in_250): offered,
 *               answered (pattern-A rule), SL at 20s of OFFERED, AHT
 *   Email     = Email slide  (assigned / closure %)
 *   Chat      = Chat slide   (chats / accepted within 30s)
 *   Outbound  = Outbound slide (dials / connect %)
 *   Quality   = cl_quality by audit date, by LOB, plain mean of audit scores
 *   Agent mix = per agent: inbound calls handled (dialer AgentId = MAS id), e-mails
 *               touched, chats, outbound dials -- how each agent's day is split.
 * The four volumes are DIFFERENT units (calls offered / e-mails assigned / chats /
 * dials): they are never added together.
 */

type Row = Record<string, unknown>;
const nf = (n: number) => n.toLocaleString("en-IN");
const fmtSecShort = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`);
const kv = (p: LobPayload | null, key: string): number => Number(p?.metrics[key] ?? 0);

async function loadInbound(from: string, to: string) {
  try { return await getInboundInsights("clovia", { startDate: from, endDate: to }); } catch { return null; }
}

export async function getOverview(fromIn: string, toIn: string): Promise<LobPayload> {
  const { from, to } = resolveRange(fromIn, toIn);
  const [ib, em, ch, ob, ex, qAll, dir] = await Promise.all([
    loadInbound(from, to), getEmailLob(from, to), getChatLob(from, to), getOutboundLob(from, to), getInboundExtras(from, to), loadQuality(from, to, null), loadDirectory(),
  ]);
  const h = ib?.headline;

  const ibDaily = new Map((ib?.daily ?? []).map((d) => [d.date, d.offered as number]));
  const series = (p: LobPayload, chartKey: string, field: string) => new Map((p.charts.find((c) => c.key === chartKey)?.data ?? []).map((d) => [String(d.date), Number(d[field] ?? 0)]));
  const emDaily = series(em, "email_daily", "assigned"); const chDaily = new Map((ch.tables.find((t) => t.key === "chat_daily_t")?.rows ?? []).map((r) => [String(r.date), Number(r.chats)]));
  const obDaily = new Map((ob.tables.find((t) => t.key === "out_daily_t")?.rows ?? []).map((r) => [String(r.date), Number(r.dials)]));
  const days = listDays(from, to).filter((d) => ibDaily.has(d) || emDaily.has(d) || chDaily.has(d) || obDaily.has(d));

  const kpis: Kpi[] = [
    { key: "ib_off", label: "Inbound calls offered", value: h?.offered ?? null, fmt: "int", tone: "blue", icon: "PhoneIncoming", sub: h ? `${h.answeredPct}% answered · SL ${h.slPct}% (${h.slThresholdSec}s)` : "dialer unavailable", tab: "scorecard" },
    { key: "ib_aht", label: "Inbound AHT", value: h?.aht ?? null, fmt: "sec", tone: "violet", icon: "Timer", sub: h ? `ASA ${fmtSecShort(h.asa)} · abandon ${h.abandonPct}%` : undefined, tab: "scorecard" },
    { key: "em_asg", label: "Emails assigned", value: kv(em, "assigned"), fmt: "int", tone: "sky", icon: "Mail", sub: `closure ${kv(em, "closurePct")}% · re-open ${kv(em, "reopenPct")}%`, tab: "scorecard" },
    { key: "ch_n", label: "Chats handled", value: kv(ch, "chats"), fmt: "int", tone: "teal", icon: "MessageSquare", sub: `${kv(ch, "wait30")}% accepted ≤30s · repeat ${kv(ch, "repeatPct")}%`, tab: "scorecard" },
    { key: "ob_n", label: "Outbound dials", value: kv(ob, "dials"), fmt: "int", tone: "indigo", icon: "PhoneOutgoing", sub: `${kv(ob, "connectPct")}% connected · avg talk ${fmtSecShort(kv(ob, "avgTalk"))}`, tab: "scorecard" },
    { key: "csat", label: "CSAT (IVR survey)", value: kv(ex, "csatPct"), fmt: "pct", tone: "emerald", icon: "Smile", sub: `${nf(kv(ex, "fbN"))} responses`, tab: "scorecard" },
    { key: "qa_all", label: "Avg quality score (all LOBs)", value: qAll.length ? round2(sum(qAll.map((r) => r.score)) / qAll.length) : 0, fmt: "pct", tone: "amber", icon: "ShieldCheck", sub: `${qAll.length} audits · ${qAll.filter((r) => r.fatal).length} fatal`, tab: "scorecard" },
    { key: "rechurn", label: "Rechurn calls", value: kv(ex, "rcN"), fmt: "int", tone: "rose", icon: "PhoneForwarded", sub: `avg re-call gap ${kv(ex, "rcAvgDelay")} min`, tab: "scorecard" },
  ];

  const qByLob = ["Inbound", "Email", "Chat", "Outbound"].map((lob) => {
    const rs = qAll.filter((r) => r.lob === lob);
    return { _key: lob.toLowerCase(), label: lob, audits: rs.length, avg: rs.length ? round2(sum(rs.map((r) => r.score)) / rs.length) : 0, fatal: rs.filter((r) => r.fatal).length, below90: rs.filter((r) => r.score < 90).length };
  });
  const scorecard: Row[] = [
    { _key: "inbound", lob: "Inbound", unit: "calls offered", volume: h?.offered ?? null, rateLabel: "Answered % · SL %", rate: h ? `${h.answeredPct}% · ${h.slPct}%` : "—", timing: h ? `AHT ${fmtSecShort(h.aht)} · ASA ${fmtSecShort(h.asa)}` : "—", agents: h?.agentsActive ?? null, quality: qByLob[0].avg, audits: qByLob[0].audits, tickets: kv(ex, "tickets") },
    { _key: "email", lob: "Email", unit: "emails assigned", volume: kv(em, "assigned"), rateLabel: "Closure % · re-open %", rate: `${kv(em, "closurePct")}% · ${kv(em, "reopenPct")}%`, timing: "no timestamps in source", agents: kv(em, "agents"), quality: qByLob[1].avg, audits: qByLob[1].audits, tickets: kv(em, "tickets") },
    { _key: "chat", lob: "Chat", unit: "chats", volume: kv(ch, "chats"), rateLabel: "≤30s accept % · repeat %", rate: `${kv(ch, "wait30")}% · ${kv(ch, "repeatPct")}%`, timing: `wait ${fmtSecShort(kv(ch, "avgWait"))} · duration ${fmtSecShort(kv(ch, "avgDur"))}`, agents: kv(ch, "agents"), quality: qByLob[2].avg, audits: qByLob[2].audits, tickets: kv(ch, "tickets") },
    { _key: "outbound", lob: "Outbound", unit: "dials", volume: kv(ob, "dials"), rateLabel: "Connect % · repeat %", rate: `${kv(ob, "connectPct")}% · ${kv(ob, "repeatPct")}%`, timing: `avg talk ${fmtSecShort(kv(ob, "avgTalk"))}`, agents: kv(ob, "agents"), quality: qByLob[3].avg, audits: qByLob[3].audits, tickets: kv(ob, "tickets") },
  ];

  // Agent x LOB work mix
  const mix = new Map<string, { inbound: number; email: number; chat: number; outbound: number }>();
  const bump = (id: string, k: "inbound" | "email" | "chat" | "outbound", n: number) => { if (!id || n <= 0) return; const e = mix.get(id) ?? { inbound: 0, email: 0, chat: 0, outbound: 0 }; e[k] += n; mix.set(id, e); };
  for (const a of ib?.agents ?? []) bump(a.agentId, "inbound", a.handled);
  for (const r of em.tables.find((t) => t.key === "email_agents_t")?.rows ?? []) bump(String(r.empId), "email", Number(r.touched));
  for (const r of ch.tables.find((t) => t.key === "chat_agents_t")?.rows ?? []) bump(String(r._key), "chat", Number(r.chats));
  for (const r of ob.tables.find((t) => t.key === "out_agents_t")?.rows ?? []) bump(String(r._key), "outbound", Number(r.dials));
  const mixRows = [...mix.entries()].filter(([id]) => id.startsWith("MAS")).map(([id, m]) => {
    const total = m.inbound + m.email + m.chat + m.outbound;
    const lobs = (m.inbound > 0 ? 1 : 0) + (m.email > 0 ? 1 : 0) + (m.chat > 0 ? 1 : 0) + (m.outbound > 0 ? 1 : 0);
    const top = (Object.entries(m) as Array<[string, number]>).sort((a, z) => z[1] - a[1])[0];
    return { _key: id, agent: agentName(dir, id), empId: id, ...m, total, lobs, main: top[1] > 0 ? `${top[0][0].toUpperCase()}${top[0].slice(1)} (${pct(top[1], total)}%)` : "—" };
  }).sort((a, z) => z.total - a.total);

  const charts: ChartSpec[] = [
    {
      key: "ov_volume", title: "Daily volume by LOB", subtitle: "Calls offered · emails assigned · chats · dials (different units, shown side by side)", tab: "volume", kind: "combo", xKey: "date", xFmt: "date", span: 2,
      series: [{ key: "inbound", label: "Inbound calls", color: "#3b82f6", type: "line" }, { key: "email", label: "Emails assigned", color: "#0ea5e9", type: "line" }, { key: "chat", label: "Chats", color: "#10b981", type: "line" }, { key: "outbound", label: "Outbound dials", color: "#8b5cf6", type: "line" }],
      data: days.map((d) => ({ date: d, inbound: ibDaily.get(d) ?? 0, email: emDaily.get(d) ?? 0, chat: chDaily.get(d) ?? 0, outbound: obDaily.get(d) ?? 0 })),
    },
    { key: "ov_quality", title: "Average quality score by LOB", subtitle: "Mean audit score by audit date", tab: "quality", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "avg", label: "Avg score", color: "#10b981", fmt: "pct" }], data: qByLob.map((q) => ({ label: q.label, avg: q.avg })), drill: { kind: "lob", keyField: "label" } },
    { key: "ov_qcount", title: "Audits by LOB", tab: "quality", kind: "donut", xKey: "label", series: [{ key: "audits", label: "Audits", color: "#6366f1" }], data: qByLob.map((q) => ({ label: q.label, audits: q.audits })), drill: { kind: "lob", keyField: "label" } },
    { key: "ov_mix", title: "Work mix by agent", subtitle: "Inbound handled · emails touched · chats · dials", tab: "agents", kind: "combo", xKey: "agent", xFmt: "text", span: 2, series: [{ key: "inbound", label: "Inbound", color: "#3b82f6", type: "bar", stackId: "m" }, { key: "email", label: "Email", color: "#0ea5e9", type: "bar", stackId: "m" }, { key: "chat", label: "Chat", color: "#10b981", type: "bar", stackId: "m" }, { key: "outbound", label: "Outbound", color: "#8b5cf6", type: "bar", stackId: "m" }], data: mixRows.slice(0, 20).map((a) => ({ agent: a.agent, _key: a._key, inbound: a.inbound, email: a.email, chat: a.chat, outbound: a.outbound })), drill: { kind: "agent", keyField: "_key" } },
  ];
  const tables: TableSpec[] = [
    { key: "ov_scorecard", title: "LOB scorecard", subtitle: "Volumes are in different units and are not added together. Click a row for that LOB's headline figures.", tab: "scorecard", drillKind: "lob", keyField: "_key", columns: [{ key: "lob", label: "LOB", align: "left" }, { key: "unit", label: "Volume unit", align: "left" }, { key: "volume", label: "Volume", fmt: "int" }, { key: "rateLabel", label: "Rates", align: "left" }, { key: "rate", label: "Value", align: "right" }, { key: "timing", label: "Timing", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "quality", label: "Quality", fmt: "pct" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "tickets", label: "CRM tickets", fmt: "int" }], rows: scorecard },
    { key: "ov_quality_t", title: "Quality by LOB", tab: "quality", drillKind: "lob", keyField: "_key", columns: [{ key: "label", label: "LOB", align: "left" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "avg", label: "Avg score", fmt: "pct" }, { key: "below90", label: "Below 90%", fmt: "int" }, { key: "fatal", label: "Fatal", fmt: "int" }], rows: qByLob },
    { key: "ov_mix_t", title: "Agent work mix", subtitle: "Where each agent's contacts went in the range (units differ; totals are contact counts).", tab: "agents", drillKind: "agent", keyField: "_key", searchable: true, defaultSort: { key: "total", dir: "desc" }, columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "inbound", label: "Inbound handled", fmt: "int" }, { key: "email", label: "Emails touched", fmt: "int" }, { key: "chat", label: "Chats", fmt: "int" }, { key: "outbound", label: "Dials", fmt: "int" }, { key: "total", label: "Total contacts", fmt: "int" }, { key: "lobs", label: "LOBs", fmt: "int" }, { key: "main", label: "Main LOB", align: "left" }], rows: mixRows },
  ];

  // coverage: all sources once
  const [cApr, cIb] = await Promise.all([coverageOf("Agent productivity (APR)", "cl_apr", DATE_EXPR.apr, "not used on the LOB slides: its LOB tag is unreliable"), coverageOf("Uploaded inbound CDR", "cl_ib_cdr", DATE_EXPR.ibcdr, "used by the MIS snapshot only; the live dialer is the inbound source")]);
  const covRows: CoverageRow[] = [];
  const seen = new Set<string>();
  for (const c of [...ex.coverage, ...em.coverage, ...ch.coverage, ...ob.coverage, { ...cApr, unparseable: undefined }, { ...cIb, unparseable: undefined }] as Array<CoverageRow & { unparseable?: number }>) {
    if (seen.has(c.table)) continue;
    seen.add(c.table);
    const { unparseable: _u, ...rest } = c;
    covRows.push(rest);
  }
  covRows.unshift({ source: "Live dialer (inbound)", table: "dialer_db.cdr_in_250", rows: h?.offered ?? 0, minDate: ib?.daily[0]?.date ?? null, maxDate: ib?.daily[ib.daily.length - 1]?.date ?? null, days: ib?.daily.length ?? 0, note: "read-only; rows shown are those in the selected range" });
  const covTable: TableSpec = { key: "ov_cov", title: "Data coverage", subtitle: "Which uploaded tables reach which dates. Click a row for its rows per day.", tab: "coverage", drillKind: "cov", keyField: "table", columns: [{ key: "source", label: "Source", align: "left" }, { key: "table", label: "Table", align: "left" }, { key: "rows", label: "Rows (whole table)", fmt: "int" }, { key: "minDate", label: "First date", align: "left" }, { key: "maxDate", label: "Last date", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "note", label: "Note", align: "left" }], rows: covRows.map((c) => ({ ...c, minDate: fmtDdMmYyyy(c.minDate), maxDate: fmtDdMmYyyy(c.maxDate) })) };
  tables.push(covTable);

  const insights: Insight[] = [];
  if (h) insights.push({ tone: h.slPct >= 80 ? "good" : "warn", text: `Inbound: ${nf(h.offered)} calls offered, ${h.answeredPct}% answered, SL ${h.slPct}% within ${h.slThresholdSec}s (of offered), AHT ${fmtSecShort(h.aht)}.` });
  insights.push({ tone: kv(em, "closurePct") >= 60 ? "good" : "warn", text: `Email: ${nf(kv(em, "assigned"))} assigned, ${kv(em, "closurePct")}% closed, ${kv(em, "reopenPct")}% re-opened.` });
  insights.push({ tone: kv(ch, "wait30") >= 80 ? "good" : "warn", text: `Chat: ${nf(kv(ch, "chats"))} chats, ${kv(ch, "wait30")}% accepted within 30s, ${kv(ch, "repeatPct")}% repeat.` });
  insights.push({ tone: kv(ob, "connectPct") >= 85 ? "good" : "warn", text: `Outbound: ${nf(kv(ob, "dials"))} dials, ${kv(ob, "connectPct")}% connected.` });
  const lowQ = [...qByLob].filter((q) => q.audits > 0).sort((a, z) => a.avg - z.avg)[0];
  if (lowQ) insights.push({ tone: lowQ.avg >= 90 ? "info" : "warn", text: `Lowest quality LOB: ${lowQ.label} at ${lowQ.avg}% over ${lowQ.audits} audits.`, tab: "quality" });
  const multi = mixRows.filter((a) => a.lobs >= 3).length;
  if (mixRows.length) insights.push({ tone: "info", text: `${multi} of ${mixRows.length} agents worked three or more LOBs in the range; the agent work-mix table shows the split.`, tab: "agents" });
  insights.push(...ex.insights.filter((i) => i.tab === "rechurn").slice(0, 1).map((i) => ({ ...i, tab: "scorecard" })));

  const notes = [
    "The four LOB volumes are different units (calls offered, emails assigned, chats, dials) and are deliberately never summed.",
    "Inbound figures come from the live dialer with the shared inbound definition (SL % = answered within 20s as a share of OFFERED); the 'Classic' inbound view keeps the earlier definition (SL % of answered), so its SL % differs by design.",
    ...(ib ? [] : ["The live dialer could not be read: inbound figures are blank."]),
    ...em.notes.slice(0, 2).map((n) => `Email: ${n}`), ...ch.notes.slice(0, 2).map((n) => `Chat: ${n}`), ...ob.notes.slice(0, 3).map((n) => `Outbound: ${n}`),
    "The Channels slide predates these definitions: it sums cl_email_raw and cl_chat including their duplicate rows, and its FTR % divides by all tickets rather than order-linked tickets.",
  ];
  return {
    lob: "overview", label: "Overview", from, to, filters: {}, options: {},
    tabs: [{ key: "scorecard", label: "Scorecard" }, { key: "volume", label: "Volume" }, { key: "quality", label: "Quality" }, { key: "agents", label: "Agent mix" }, { key: "coverage", label: "Data coverage" }],
    coverage: [], kpis, charts, tables, insights, notes, metrics: {},
    definitions: [
      { term: "Inbound SL %", meaning: "Calls answered within 20 seconds ÷ calls OFFERED (dialer pattern A, hold-time drops excluded)." },
      { term: "Quality score", meaning: "Plain mean of cl_quality cq_score by audit date; chat/e-mail audits also score six parameters." },
      { term: "Weeks", meaning: "W-1 = 1st-7th of the month, W-2 = 8th-14th, W-3 = 15th-21st, W-4 = 22nd-28th, W-5 = 29th onward." },
    ],
    empty: false, latestDate: null,
  };
}

/* ───────────────────────────── week / date columns ───────────────────────────── */

export async function getOverviewPeriods(fromIn: string, toIn: string): Promise<PeriodBreakdown> {
  const { from, to } = resolveRange(fromIn, toIn);
  const [ib, em, ch, ob, ex] = await Promise.all([
    getInboundPeriods("clovia", { startDate: from, endDate: to }).catch(() => null),
    getEmailPeriods(from, to), getChatPeriods(from, to), getOutboundPeriods(from, to), getInboundExtrasPeriods(from, to),
  ]);
  const tables: PeriodTable[] = [];
  if (ib) tables.push({ ...ib.tables[0], title: `Inbound — ${ib.tables[0].title}`, rows: ib.tables[0].rows as PeriodTable["rows"] });
  tables.push({ ...ex.tables[0], title: `Inbound add-ons — ${ex.tables[0].title}` });
  tables.push({ ...em.tables[0], title: `Email — ${em.tables[0].title}` });
  tables.push({ ...ch.tables[0], title: `Chat — ${ch.tables[0].title}` });
  tables.push({ ...ob.tables[0], title: `Outbound — ${ob.tables[0].title}` });
  return { from, to, columns: em.columns, tables, dailyColumnsOmitted: em.dailyColumnsOmitted };
}

/* ───────────────────────────── drill-down ───────────────────────────── */

const COV_EXPR: Record<string, { expr: string; label: string }> = {
  cl_email_raw: { expr: DATE_EXPR.email, label: "Email daily-count rows" }, cl_chat: { expr: DATE_EXPR.chat, label: "Chats" }, cl_outbound: { expr: DATE_EXPR.outbound, label: "Dials" },
  cl_quality: { expr: DATE_EXPR.quality, label: "Audits (by audit date)" }, cl_dispo: { expr: DATE_EXPR.dispo, label: "CRM tickets" }, cl_feedback: { expr: DATE_EXPR.feedback, label: "Survey responses" },
  cl_rechurn_call: { expr: DATE_EXPR.rechurn, label: "Rechurn calls" }, cl_apr: { expr: DATE_EXPR.apr, label: "APR rows" }, cl_ib_cdr: { expr: DATE_EXPR.ibcdr, label: "Uploaded CDR rows" },
};

export async function getOverviewDetail(kind: string, key: string, fromIn: string, toIn: string): Promise<DetailPayload | null> {
  const { from, to } = resolveRange(fromIn, toIn);
  if (kind === "cov") {
    const c = COV_EXPR[key];
    if (!c) return null;
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(${c.expr},'%Y-%m-%d') AS d, COUNT(*) AS n FROM db_masmis.${key} GROUP BY d ORDER BY d`);
    const good = rows.filter((r) => r.d);
    const bad = rows.find((r) => !r.d);
    return {
      title: key, subtitle: `${c.label} per day, whole table`, badge: { label: `${nf(sum(rows.map((r) => num(r.n))))} rows`, tone: "slate" },
      sections: [
        { title: "Rows per day", type: "chart", chart: { key: "cov", title: c.label, tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "n", label: "Rows", color: "#6366f1", type: "bar" }], data: good.map((r) => ({ date: String(r.d), n: num(r.n) })) } },
        { title: "Days", type: "table", table: { columns: [{ key: "date", label: "Date", align: "left" }, { key: "n", label: "Rows", fmt: "int" }], rows: good.map((r) => ({ date: fmtDdMmYyyy(String(r.d)), n: num(r.n) })) }, empty: "No rows." },
        { title: "Unreadable dates", type: "text", text: bad ? `${nf(num(bad.n))} row(s) have a date that could not be parsed and never appear in any date range.` : "None -- every row has a readable date." },
      ],
    };
  }
  if (kind === "lob") {
    const k = key.toLowerCase();
    if (k === "inbound") {
      const ib = await loadInbound(from, to); const ex = await getInboundExtras(from, to);
      if (!ib) return { title: "Inbound", subtitle: "Live dialer unavailable", sections: [{ title: "Note", type: "text", text: "The live dialer could not be read." }] };
      const hd = ib.headline;
      return {
        title: "Inbound", subtitle: `${fmtDdMmYyyy(from)} to ${fmtDdMmYyyy(to)}`, badge: { label: `${nf(hd.offered)} offered`, tone: "blue" },
        sections: [
          { title: "Headline", type: "kv", kv: [{ label: "Calls offered", value: hd.offered, fmt: "int" }, { label: "Answered", value: hd.answered, fmt: "int" }, { label: "Answer %", value: hd.answeredPct, fmt: "pct" }, { label: "Abandon %", value: hd.abandonPct, fmt: "pct" }, { label: `SL % (${hd.slThresholdSec}s, of offered)`, value: hd.slPct, fmt: "pct" }, { label: "AHT", value: hd.aht, fmt: "sec" }, { label: "ASA", value: hd.asa, fmt: "sec" }, { label: "Active agents", value: hd.agentsActive, fmt: "int" }, { label: "CSAT %", value: kv(ex, "csatPct"), fmt: "pct" }, { label: "Survey responses", value: kv(ex, "fbN"), fmt: "int" }, { label: "Rechurn calls", value: kv(ex, "rcN"), fmt: "int" }] },
          { title: "Daily calls", type: "chart", chart: { key: "d", title: "Offered and answered", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "offered", label: "Offered", color: "#93c5fd", type: "bar" }, { key: "answered", label: "Answered", color: "#3b82f6", type: "bar" }], data: ib.daily.map((d) => ({ date: d.date, offered: d.offered, answered: d.answered })) } },
          { title: "Insights", type: "text", text: ib.insights.map((i) => `• ${i.text}`).join("\n") || "None." },
        ],
      };
    }
    const p = k === "email" ? await getEmailLob(from, to) : k === "chat" ? await getChatLob(from, to) : k === "outbound" ? await getOutboundLob(from, to) : null;
    if (!p) return null;
    return {
      title: p.label, subtitle: `${fmtDdMmYyyy(from)} to ${fmtDdMmYyyy(to)}`, badge: { label: p.empty ? "no data" : "live", tone: p.empty ? "amber" : "green" },
      sections: [
        { title: "Headline", type: "kpis", kpis: p.kpis.filter((x) => x.tab === "overview").slice(0, 12) },
        { title: "Insights", type: "text", text: p.insights.filter((i) => !i.tab || i.tab === "overview").map((i) => `• ${i.text}`).join("\n") || "None." },
        ...(p.charts[0] ? [{ title: p.charts[0].title, type: "chart" as const, chart: p.charts[0] }] : []),
      ],
    };
  }
  if (kind === "agent") {
    const [em, ch, ob, ex] = await Promise.all([getEmailLob(from, to), getChatLob(from, to), getOutboundLob(from, to), getInboundExtras(from, to)]);
    const dir = await loadDirectory();
    const pick = (p: LobPayload, tableKey: string, idField: string) => p.tables.find((t) => t.key === tableKey)?.rows.find((r) => String(r[idField]) === key) as Row | undefined;
    const e = pick(em, "email_agents_t", "empId"); const c = pick(ch, "chat_agents_t", "_key"); const o = pick(ob, "out_agents_t", "_key"); const f = pick(ex, "in_csat_agent_t", "_key");
    const cols: Column[] = [{ key: "lob", label: "LOB", align: "left" }, { key: "volume", label: "Volume", fmt: "int" }, { key: "detail", label: "Detail", align: "left" }];
    return {
      title: agentName(dir, key), subtitle: `${key} · work across LOBs`, badge: { label: key, tone: "slate" },
      sections: [
        { title: "By LOB", type: "table", table: { columns: cols, rows: [
          { lob: "Email", volume: e ? Number(e.touched) : 0, detail: e ? `${e.assigned} assigned · closure ${e.closurePct}% · quality ${e.quality ?? "—"}` : "—" },
          { lob: "Chat", volume: c ? Number(c.chats) : 0, detail: c ? `${c.avgWait}s avg wait · repeat ${c.repeatPct}% · quality ${c.quality ?? "—"}` : "—" },
          { lob: "Outbound", volume: o ? Number(o.dials) : 0, detail: o ? `connect ${o.connectPct}% · avg talk ${o.avgTalk}s · quality ${o.quality ?? "—"}` : "—" },
          { lob: "Inbound survey", volume: f ? Number(f.responses) : 0, detail: f ? `CSAT ${f.csatPct}% (${f.satisfied} satisfied)` : "—" },
        ] }, empty: "No activity." },
        { title: "Note", type: "text", text: "Open the agent's row on each LOB slide for the full drill-down (daily trend, hourly pattern, records). Inbound call performance per agent is on the Inbound slide's Agent-wise tab." },
      ],
    };
  }
  return null;
}
