import { createHmac } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  type ChartSpec, type Column, type CoverageRow, type DetailPayload, type DispoRow, type Directory, type Fmt, type Insight, type Kpi,
  type LobPayload, type PeriodBreakdown, type PeriodTable, type QualRow, type TableSpec, type Tone,
  DATE_EXPR, WEEKDAYS, agentName, avg, bucketOf, buildPeriodColumns, categoryPeriodRows, coverageOf, dispoKpis, dispoSection, fmtDdMmYyyy, inRange,
  kpiPeriodRows, listDays, loadDirectory, loadDispo, loadQuality, maskPhone, num, pct, qualitySection, resolveRange, round1, round2, sum, tlOf, weekdayOf,
} from "./clovia-lob.shared.js";
import { dispoDetail, qualityDetail } from "./clovia-lob.detail.js";

/**
 * CLOVIA -- OUTBOUND slide.
 *
 * Source: db_masmis.cl_outbound -- one row per DIAL by an agent (3,270 rows,
 * 1-15 Sep 2026). Columns used: call_date ("9/1/26"), start_time
 * ("9/1/26 10:33" -> hour), length_sec, status, reason, campaign, u_r, count_val.
 *
 * Definitions:
 *   Dials       = rows.  Every row is one dial; there is no unique call id, so rows that
 *                 share agent + number + start + end + length are FLAGGED (not removed)
 *                 as suspected double uploads -- see notes.
 *   Connected   = status = 'Connected' as uploaded. In this file that is exactly
 *                 length_sec > 10 (every 'Not Connected' row is 0-10s, every 'Connected'
 *                 row is 11s or more), so a connected call means "talked more than 10 seconds".
 *   Connect %   = Connected / Dials
 *   Avg talk    = mean length_sec of Connected dials only;  Talk hours = their sum / 3600
 *   Repeat dial = u_r = 'Repeat' (the same number dialled again that day; count_val = the
 *                 dial-count of that number that day)
 *   Unique numbers = distinct valid numbers (10-12 digits, last 10 compared)
 *   Disconnected by = the `reason` column (CALLER / AGENT / NONE): who ended the call
 *   Campaign    = OUTBOUND (dedicated outbound work) or INBOUND / CHAT / EMAIL (call-backs
 *                 placed by agents working those LOBs). "All campaigns" is the default so the
 *                 total equals the Overview / Channels 'Outbound dialled' figure.
 *   Quality     = cl_quality lob = 'Outbound' (audit date);  Tickets = cl_dispo skill =
 *                 'outbound' (ticket date). Ticket capture = tickets / Connected dials of
 *                 campaign OUTBOUND.
 *
 * OMITTED (no source column): dial attempts by disposition outcome (right-party contact,
 * promise, refusal...) -- the dial log only knows connected / not connected; ring time; list
 * / lead penetration; dials per LOGIN hour (APR's lob tag is unreliable: agent MAS60581 makes
 * 1,117 outbound dials but is tagged 'Inbound' in cl_apr).
 */

export interface OutRow {
  id: number; date: string; hour: number; hm: string; agentKey: string; agent: string; tl: string; phoneRaw: string; phoneKey: string;
  callCode: string; len: number; hasLen: boolean; connected: boolean; campaign: string; reason: string; repeat: boolean; countVal: number; ts: number;
}
export interface OutBundle { rows: OutRow[]; q: QualRow[]; d: DispoRow[] }
interface Loaded extends OutBundle {
  dir: Directory; coverage: CoverageRow[]; unparseable: number; dupRows: number; badPhones: number; noLen: number; campaigns: string[];
  outboundConnected: number;
}

const LEN_BUCKETS = [
  { label: "0s", min: 0, max: 0 }, { label: "1-10s (not connected)", min: 1, max: 10 }, { label: "11-30s", min: 11, max: 30 }, { label: "31-60s", min: 31, max: 60 },
  { label: "1-3 min", min: 61, max: 180 }, { label: "3-10 min", min: 181, max: 600 }, { label: "10+ min", min: 601, max: Infinity },
] as const;
const nf = (n: number) => n.toLocaleString("en-IN");
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`);
const custKey = (phoneKey: string) => createHmac("sha256", process.env.JWT_SECRET || process.env.SESSION_SECRET || "clovia-out").update(phoneKey).digest("hex").slice(0, 12);

async function load(from: string, to: string, campaign: string | null): Promise<Loaded> {
  const [raw] = await db.execute<RowDataPacket[]>(
    `SELECT id, agent, phone_number, DATE_FORMAT(STR_TO_DATE(call_date,'%c/%e/%y'),'%Y-%m-%d') AS d,
            HOUR(STR_TO_DATE(start_time,'%c/%e/%y %H:%i')) AS hr, DATE_FORMAT(STR_TO_DATE(start_time,'%c/%e/%y %H:%i'),'%H:%i') AS hm,
            end_time, start_time, call_code, length_sec, campaign, reason, status, count_val, u_r
       FROM db_masmis.cl_outbound WHERE STR_TO_DATE(call_date,'%c/%e/%y') BETWEEN ? AND ? ORDER BY id`, [from, to],
  );
  const dir = await loadDirectory();
  let badPhones = 0; let noLen = 0;
  const all: OutRow[] = raw.map((r) => {
    const phone = String(r.phone_number ?? "").trim();
    const validPhone = /^\d{10,12}$/.test(phone);
    if (!validPhone) badPhones++;
    const lenRaw = String(r.length_sec ?? "").trim();
    const hasLen = /^\d+$/.test(lenRaw);
    if (!hasLen) noLen++;
    const agentKey = String(r.agent ?? "").trim();
    return {
      id: num(r.id), date: String(r.d), hour: num(r.hr), hm: String(r.hm ?? ""), agentKey, agent: agentName(dir, agentKey), tl: tlOf(dir, agentKey),
      phoneRaw: phone, phoneKey: validPhone ? phone.slice(-10) : "", callCode: String(r.call_code ?? ""), len: hasLen ? Number(lenRaw) : 0, hasLen,
      connected: String(r.status ?? "") === "Connected", campaign: String(r.campaign ?? "").trim() || "(blank)", reason: String(r.reason ?? "").trim() || "(blank)",
      repeat: String(r.u_r ?? "") === "Repeat", countVal: num(r.count_val), ts: Date.parse(`${r.d}T${r.hm ?? "00:00"}:00Z`),
    };
  });
  const sigs = new Map<string, number>();
  for (const [i, r] of raw.entries()) { const s = [r.agent, r.phone_number, r.start_time, r.end_time, r.length_sec].join("|"); sigs.set(s, (sigs.get(s) ?? 0) + 1); void i; }
  const dupRows = [...sigs.values()].reduce((s, c) => s + (c > 1 ? c - 1 : 0), 0);
  const rows = campaign ? all.filter((r) => r.campaign === campaign) : all;
  const campaigns = [...new Set(all.map((r) => r.campaign))].sort();
  const [q, d, cov, covQ, covD, [[oc]]] = await Promise.all([
    loadQuality(from, to, "Outbound"), loadDispo(from, to, ["outbound"]),
    coverageOf("Outbound dial log", "cl_outbound", DATE_EXPR.outbound, "one row per dial"),
    coverageOf("Quality audits", "cl_quality", DATE_EXPR.quality, "lob = Outbound is used here"),
    coverageOf("CRM dispositions", "cl_dispo", DATE_EXPR.dispo, "skill = outbound is used here"),
    db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM db_masmis.cl_outbound WHERE STR_TO_DATE(call_date,'%c/%e/%y') BETWEEN ? AND ? AND campaign = 'OUTBOUND' AND status = 'Connected'`, [from, to]),
  ]);
  return {
    rows, q, d, dir, dupRows, badPhones, noLen, campaigns, outboundConnected: num(oc.n), unparseable: cov.unparseable + covQ.unparseable + covD.unparseable,
    coverage: [cov, covQ, covD].map(({ unparseable: _u, ...c }) => c),
  };
}

/* ───────────────────────────── KPI engine ───────────────────────────── */

interface KpiDef { key: string; label: string; fmt: Fmt; tone: Tone; icon: string; sub?: (v: Record<string, number | null>) => string | undefined }

export function computeOutbound(b: OutBundle, outboundConnected?: number): Record<string, number | null> {
  const r = b.rows; const n = r.length;
  const conn = r.filter((x) => x.connected); const connLens = conn.map((x) => x.len);
  const real = r.filter((x) => x.agentKey !== "VDAD");
  const agentDays = new Set(real.map((x) => `${x.agentKey}|${x.date}`)).size;
  const valid = r.filter((x) => x.phoneKey);
  const ql = b.q; const tk = dispoKpis(b.d, "");
  const connOb = outboundConnected ?? r.filter((x) => x.connected && x.campaign === "OUTBOUND").length;
  return {
    dials: n, connected: conn.length, connectPct: pct(conn.length, n), notConnected: n - conn.length,
    uniqueNumbers: new Set(valid.map((x) => x.phoneKey)).size, repeatDials: r.filter((x) => x.repeat).length, repeatPct: pct(r.filter((x) => x.repeat).length, n),
    avgTalk: round1(avg(sum(connLens), conn.length)), talkHours: round1(sum(connLens) / 3600), avgDial: round1(avg(sum(r.map((x) => x.len)), n)),
    shortConnPct: pct(conn.filter((x) => x.len <= 30).length, conn.length), longConnPct: pct(conn.filter((x) => x.len > 180).length, conn.length),
    callerEnd: pct(r.filter((x) => x.reason === "CALLER").length, n), agentEnd: pct(r.filter((x) => x.reason === "AGENT").length, n),
    agents: new Set(real.map((x) => x.agentKey)).size, dialsPerAgentDay: round1(avg(real.length, agentDays)),
    obDials: r.filter((x) => x.campaign === "OUTBOUND").length, obShare: pct(r.filter((x) => x.campaign === "OUTBOUND").length, n),
    audits: ql.length, avgQuality: ql.length ? round2(sum(ql.map((x) => x.score)) / ql.length) : 0, fatal: ql.filter((x) => x.fatal).length,
    tickets: b.d.length, ticketCapture: pct(b.d.length, connOb), ticketEsc: tk[2].value as number, ticketFtr: tk[1].value as number,
  };
}

const DEFS: KpiDef[] = [
  { key: "dials", label: "Dials", fmt: "int", tone: "sky", icon: "PhoneOutgoing", sub: (v) => `${v.agents} agents · ${v.dialsPerAgentDay} per agent-day` },
  { key: "connected", label: "Connected (>10s)", fmt: "int", tone: "emerald", icon: "PhoneCall", sub: (v) => `${nf(v.notConnected as number)} not connected` },
  { key: "connectPct", label: "Connect %", fmt: "pct", tone: "teal", icon: "Gauge", sub: () => "connected ÷ dials" },
  { key: "avgTalk", label: "Avg talk time", fmt: "sec", tone: "violet", icon: "Timer", sub: (v) => `${v.talkHours} talk hours in total` },
  { key: "uniqueNumbers", label: "Unique numbers dialled", fmt: "int", tone: "indigo", icon: "Hash", sub: (v) => `${nf(v.dials as number)} dials` },
  { key: "repeatPct", label: "Repeat dial %", fmt: "pct", tone: "rose", icon: "Repeat", sub: (v) => `${nf(v.repeatDials as number)} re-dials of the same number` },
  { key: "shortConnPct", label: "Connected ≤30s", fmt: "pct", tone: "amber", icon: "Hourglass", sub: (v) => `${v.longConnPct}% run over 3 min` },
  { key: "callerEnd", label: "Ended by customer", fmt: "pct", tone: "cyan", icon: "PhoneOff", sub: (v) => `${v.agentEnd}% ended by agent` },
  { key: "obShare", label: "Dedicated OUTBOUND share", fmt: "pct", tone: "blue", icon: "PieChart", sub: (v) => `${nf(v.obDials as number)} dials on campaign OUTBOUND` },
  { key: "avgQuality", label: "Avg quality score", fmt: "pct", tone: "emerald", icon: "ShieldCheck", sub: (v) => `${v.audits} audits · ${v.fatal} fatal` },
  { key: "tickets", label: "CRM tickets (outbound)", fmt: "int", tone: "violet", icon: "ClipboardList", sub: (v) => `${v.ticketCapture}% of connected OUTBOUND dials · ${v.ticketEsc}% escalated` },
];
const PERIOD_EXTRA: Array<{ key: string; label: string; fmt: Fmt }> = [
  { key: "notConnected", label: "Not connected", fmt: "int" }, { key: "repeatDials", label: "Repeat dials", fmt: "int" }, { key: "talkHours", label: "Talk hours", fmt: "dec1" },
  { key: "avgDial", label: "Avg dial length (all)", fmt: "sec" }, { key: "longConnPct", label: "Connected over 3 min", fmt: "pct" }, { key: "agentEnd", label: "Ended by agent", fmt: "pct" },
  { key: "agents", label: "Active agents", fmt: "int" }, { key: "dialsPerAgentDay", label: "Dials per agent-day", fmt: "dec1" }, { key: "obDials", label: "OUTBOUND-campaign dials", fmt: "int" },
  { key: "audits", label: "Quality audits", fmt: "int" }, { key: "fatal", label: "Fatal audits", fmt: "int" }, { key: "ticketCapture", label: "Ticket capture %", fmt: "pct" },
  { key: "ticketEsc", label: "Tickets escalated %", fmt: "pct" }, { key: "ticketFtr", label: "Tickets FTR % (order-linked)", fmt: "pct" },
];
const slice = (b: OutBundle, from: string, to: string): OutBundle => ({ rows: inRange(b.rows, from, to), q: inRange(b.q, from, to), d: inRange(b.d, from, to) });

/* ───────────────────────────── report spec ───────────────────────────── */

const groupRows = <T,>(rows: T[], keyFn: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};
const grp = (rs: OutRow[], total: number) => {
  const conn = rs.filter((r) => r.connected);
  return { dials: rs.length, share: pct(rs.length, total), connected: conn.length, connectPct: pct(conn.length, rs.length), avgTalk: round1(avg(sum(conn.map((r) => r.len)), conn.length)), talkHours: round1(sum(conn.map((r) => r.len)) / 3600), repeatPct: pct(rs.filter((r) => r.repeat).length, rs.length) };
};

export async function getOutboundLob(fromIn: string, toIn: string, campaignIn?: string): Promise<LobPayload> {
  const { from, to } = resolveRange(fromIn, toIn);
  const campaign = campaignIn && campaignIn !== "all" ? campaignIn : null;
  const L = await load(from, to, campaign);
  if (campaign && !L.campaigns.includes(campaign)) throw new Error("Unknown campaign");
  const b: OutBundle = { rows: L.rows, q: L.q, d: L.d };
  const v = computeOutbound(b);
  const kpis: Kpi[] = DEFS.map((d) => ({ key: d.key, label: d.label, value: v[d.key] ?? 0, fmt: d.fmt, tone: d.tone, icon: d.icon, sub: d.sub?.(v), tab: "overview" }));
  const total = b.rows.length;

  const days = listDays(from, to);
  const dayRows = days.map((date) => {
    const rs = b.rows.filter((r) => r.date === date);
    const k = computeOutbound({ rows: rs, q: [], d: [] });
    return { _key: date, date, weekday: WEEKDAYS[weekdayOf(date)], agents: k.agents as number, dials: k.dials as number, connected: k.connected as number, connectPct: k.connectPct as number, avgTalk: k.avgTalk as number, talkHours: k.talkHours as number, uniqueNumbers: k.uniqueNumbers as number, repeatPct: k.repeatPct as number, callerEnd: k.callerEnd as number };
  }).filter((d) => d.dials > 0);
  const hourRows = [...groupRows(b.rows, (r) => String(r.hour)).entries()].map(([h, rs]) => ({ _key: h, hour: Number(h), label: `${h.padStart(2, "0")}:00`, ...grp(rs, total), avgPerDay: round1(avg(rs.length, new Set(rs.map((r) => r.date)).size)) })).sort((a, z) => a.hour - z.hour);
  const wd = groupRows(b.rows, (r) => String(weekdayOf(r.date)));
  const weekdayRows = [1, 2, 3, 4, 5, 6, 0].filter((w) => wd.has(String(w))).map((w) => { const rs = wd.get(String(w))!; const ds = new Set(rs.map((r) => r.date)).size; return { _key: WEEKDAYS[w], weekday: WEEKDAYS[w], days: ds, ...grp(rs, total), avgPerDay: round1(avg(rs.length, ds)) }; });
  const campRows = [...groupRows(b.rows, (r) => r.campaign).entries()].map(([k, rs]) => ({ _key: k, label: k, agents: new Set(rs.map((r) => r.agentKey)).size, ...grp(rs, total) })).sort((a, z) => z.dials - a.dials);
  const reasonRows = [...groupRows(b.rows, (r) => r.reason).entries()].map(([k, rs]) => ({ _key: k, label: k === "CALLER" ? "CALLER (customer hung up)" : k === "AGENT" ? "AGENT (agent hung up)" : k, raw: k, ...grp(rs, total) })).sort((a, z) => z.dials - a.dials);
  const lenRows = LEN_BUCKETS.map((w) => { const rs = b.rows.filter((r) => bucketOf(r.len, LEN_BUCKETS) === w.label); return { _key: w.label, label: w.label, dials: rs.length, share: pct(rs.length, total) }; });
  const redial = [1, 2, 3, 4, 5].map((c) => { const rs = b.rows.filter((r) => Math.min(r.countVal, 5) === c); return { _key: String(c), label: c === 5 ? "5+ times that day" : c === 1 ? "Dialled once that day" : `Dialled ${c}x that day`, dials: rs.length, share: pct(rs.length, total), connectPct: pct(rs.filter((r) => r.connected).length, rs.length) }; }).filter((r) => r.dials > 0);

  const realAgents = [...groupRows(b.rows, (r) => r.agentKey).entries()].map(([k, rs]) => {
    const aud = b.q.filter((x) => x.empId === k); const ds = new Set(rs.map((r) => r.date)).size;
    return { _key: k, agent: rs[0].agent, empId: k, tl: rs[0].tl, days: ds, ...grp(rs, total), perDay: round1(avg(rs.length, ds)), uniqueNumbers: new Set(rs.filter((r) => r.phoneKey).map((r) => r.phoneKey)).size, ownCampaign: [...groupRows(rs, (r) => r.campaign).entries()].sort((a, z) => z[1].length - a[1].length)[0]?.[0] ?? "—", audits: aud.length, quality: aud.length ? round2(sum(aud.map((x) => x.score)) / aud.length) : null };
  }).sort((a, z) => z.dials - a.dials);
  const tlRows = [...groupRows(realAgents, (a) => a.tl).entries()].map(([tl, as]) => { const rs = b.rows.filter((r) => as.some((a) => a._key === r.agentKey)); return { _key: tl, tl, agents: as.length, ...grp(rs, total) }; }).sort((a, z) => z.dials - a.dials);
  const custRows = [...groupRows(b.rows.filter((r) => r.phoneKey), (r) => r.phoneKey).entries()].filter(([, rs]) => rs.length > 1).map(([pk, rs]) => ({
    _key: custKey(pk), customer: maskPhone(rs[0].phoneRaw), dials: rs.length, connected: rs.filter((r) => r.connected).length, days: new Set(rs.map((r) => r.date)).size, agents: new Set(rs.map((r) => r.agentKey)).size, first: fmtDdMmYyyy(rs.map((r) => r.date).sort()[0]), last: fmtDdMmYyyy(rs.map((r) => r.date).sort().pop()),
  })).sort((a, z) => z.dials - a.dials).slice(0, 30);

  const hours = hourRows.map((h) => h.hour); const heatDays = dayRows.map((d) => d.date);
  const dh = groupRows(b.rows, (r) => `${r.date}|${r.hour}`); const cells: Array<{ x: number; y: number; v: number }> = [];
  heatDays.forEach((d, xi) => hours.forEach((h, yi) => { const c = dh.get(`${d}|${h}`)?.length ?? 0; if (c) cells.push({ x: xi, y: yi, v: c }); }));

  const charts: ChartSpec[] = [
    {
      key: "out_daily", title: "Daily dials, connected and connect %", subtitle: "Bars = calls; line = connect % (right axis)", tab: "overview", kind: "combo", xKey: "date", xFmt: "date", span: 2,
      series: [{ key: "dials", label: "Dials", color: "#a5b4fc", type: "bar" }, { key: "connected", label: "Connected", color: "#10b981", type: "bar" }, { key: "connectPct", label: "Connect %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }],
      data: dayRows.map((d) => ({ date: d.date, dials: d.dials, connected: d.connected, connectPct: d.connectPct })), drill: { kind: "day", keyField: "date" },
    },
    { key: "out_campaign", title: "Dials by campaign", subtitle: "OUTBOUND = dedicated; others are call-backs from those LOBs", tab: "overview", kind: "donut", xKey: "label", series: [{ key: "dials", label: "Dials", color: "#6366f1" }], data: campRows.map((c) => ({ label: c.label, dials: c.dials })), drill: { kind: "campaign", keyField: "label" } },
    { key: "out_reason", title: "Who ended the call", tab: "overview", kind: "donut", xKey: "label", series: [{ key: "dials", label: "Dials", color: "#0ea5e9" }], data: reasonRows.map((c) => ({ label: c.label, raw: c.raw, dials: c.dials })), drill: { kind: "reason", keyField: "raw" } },
    {
      key: "out_hour", title: "Hour-wise dials and connect %", subtitle: "Start hour of the dial", tab: "time", kind: "combo", xKey: "label", xFmt: "text", span: 2,
      series: [{ key: "dials", label: "Dials", color: "#6366f1", type: "bar" }, { key: "connectPct", label: "Connect %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }],
      data: hourRows.map((h) => ({ label: h.label, hour: h.hour, dials: h.dials, connectPct: h.connectPct })), drill: { kind: "hour", keyField: "hour" },
    },
    { key: "out_len", title: "Call length distribution", subtitle: "All dials by length_sec", tab: "time", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "dials", label: "Dials", color: "#8b5cf6" }], data: lenRows.map((w) => ({ label: w.label, dials: w.dials })), drill: { kind: "len", keyField: "label" } },
    { key: "out_weekday", title: "Average dials per weekday", tab: "time", kind: "combo", xKey: "weekday", xFmt: "text", series: [{ key: "avgPerDay", label: "Avg dials / day", color: "#0ea5e9", type: "bar" }, { key: "connectPct", label: "Connect %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }], data: weekdayRows.map((w) => ({ weekday: w.weekday, avgPerDay: w.avgPerDay, connectPct: w.connectPct })), drill: { kind: "weekday", keyField: "weekday" } },
    { key: "out_heat", title: "Date x hour heatmap", subtitle: "Dials started in each hour", tab: "time", kind: "heatmap", span: 2, heat: { xLabels: heatDays.map((d) => `${Number(d.slice(8, 10))}`), yLabels: hours.map((h) => `${String(h).padStart(2, "0")}:00`), xKeys: heatDays, yKeys: hours.map(String), cells, unit: "dials" }, drill: { kind: "heat" }, footnote: "Columns are days of the month; click a cell for that hour's dials." },
    { key: "out_agents", title: "Dials and connect % by agent", tab: "people", kind: "combo", xKey: "agent", xFmt: "text", span: 2, series: [{ key: "dials", label: "Dials", color: "#6366f1", type: "bar" }, { key: "connectPct", label: "Connect %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }], data: realAgents.map((a) => ({ agent: a.agent, _key: a._key, dials: a.dials, connectPct: a.connectPct })), drill: { kind: "agent", keyField: "_key" } },
    { key: "out_redial", title: "Re-dial depth", subtitle: "How many times the same number was dialled that day", tab: "repeat", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "dials", label: "Dials", color: "#f43f5e" }], data: redial.map((r) => ({ label: r.label, dials: r.dials })), drill: { kind: "redial", keyField: "label" } },
    { key: "out_repeat_daily", title: "Repeat dial % by day", tab: "repeat", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "repeatPct", label: "Repeat %", color: "#f43f5e", type: "line", fmt: "pct" }], data: dayRows.map((d) => ({ date: d.date, repeatPct: d.repeatPct })), drill: { kind: "day", keyField: "date" } },
  ];
  const tables: TableSpec[] = [
    {
      key: "out_daily_t", title: "Date-wise performance", tab: "overview", drillKind: "day", keyField: "_key", defaultSort: { key: "date", dir: "asc" },
      columns: [{ key: "date", label: "Date", align: "left" }, { key: "weekday", label: "Day", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }, { key: "talkHours", label: "Talk hrs", fmt: "dec1" }, { key: "uniqueNumbers", label: "Unique numbers", fmt: "int" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }, { key: "callerEnd", label: "Ended by cust. %", fmt: "pct" }],
      rows: dayRows, totals: { date: "Total", dials: v.dials, connected: v.connected, connectPct: v.connectPct, avgTalk: v.avgTalk, talkHours: v.talkHours, uniqueNumbers: v.uniqueNumbers, repeatPct: v.repeatPct, callerEnd: v.callerEnd },
    },
    { key: "out_campaign_t", title: "Campaign-wise", tab: "overview", drillKind: "campaign", keyField: "_key", columns: [{ key: "label", label: "Campaign", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }], rows: campRows },
    { key: "out_reason_t", title: "Call ended by", tab: "overview", drillKind: "reason", keyField: "raw", columns: [{ key: "label", label: "Ended by", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }], rows: reasonRows },
    {
      key: "out_hour_t", title: "Hour-wise performance", tab: "time", drillKind: "hour", keyField: "_key", defaultSort: { key: "hour", dir: "asc" },
      columns: [{ key: "label", label: "Hour", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "avgPerDay", label: "Avg / day", fmt: "dec1" }, { key: "share", label: "Share", fmt: "pct" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }], rows: hourRows,
    },
    { key: "out_weekday_t", title: "Weekday pattern", tab: "time", drillKind: "weekday", keyField: "_key", columns: [{ key: "weekday", label: "Weekday", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "avgPerDay", label: "Avg / day", fmt: "dec1" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }], rows: weekdayRows },
    { key: "out_len_t", title: "Call-length buckets", tab: "time", drillKind: "len", keyField: "_key", columns: [{ key: "label", label: "Length", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }], rows: lenRows },
    { key: "out_redial_t", title: "Re-dial depth", tab: "repeat", drillKind: "redial", keyField: "_key", columns: [{ key: "label", label: "Times dialled that day", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "connectPct", label: "Connect %", fmt: "pct" }], rows: redial },
    { key: "out_cust_t", title: "Most re-dialled numbers", tab: "repeat", drillKind: "customer", keyField: "_key", subtitle: "Numbers are masked; click a row for those dials.", columns: [{ key: "customer", label: "Number", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "days", label: "Days", fmt: "int" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "first", label: "First", align: "left" }, { key: "last", label: "Last", align: "left" }], rows: custRows },
    {
      key: "out_agents_t", title: "Agent-wise performance", tab: "people", drillKind: "agent", keyField: "_key", searchable: true, defaultSort: { key: "dials", dir: "desc" },
      columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "ownCampaign", label: "Main campaign", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "perDay", label: "Dials / day", fmt: "dec1" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }, { key: "talkHours", label: "Talk hrs", fmt: "dec1" }, { key: "uniqueNumbers", label: "Unique numbers", fmt: "int" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "quality", label: "Quality", fmt: "pct" }],
      rows: realAgents,
    },
    { key: "out_tl_t", title: "TL-wise performance", tab: "people", drillKind: "tl", keyField: "_key", subtitle: "cl_outbound carries no TL column: each agent is mapped to the TL recorded for them in the chat log / quality audits.", columns: [{ key: "tl", label: "TL", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "connected", label: "Connected", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }, { key: "talkHours", label: "Talk hrs", fmt: "dec1" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }], rows: tlRows },
  ];
  const qs = qualitySection(b.q, "quality", "out_q");
  kpis.push(...qs.kpis); charts.push(...qs.charts); tables.push(...qs.tables);
  const ds = dispoSection(b.d, "tickets", "out_tk");
  kpis.push(...dispoKpis(b.d, "tickets")); charts.push(...ds.charts); tables.push(...ds.tables);

  const insights: Insight[] = [];
  if (total) {
    insights.push({ tone: (v.connectPct as number) >= 85 ? "good" : "warn", text: `${nf(v.dials as number)} dials, ${nf(v.connected as number)} connected (${v.connectPct}%); ${nf(v.notConnected as number)} ended in 10 seconds or less.` });
    const ob = campRows.find((c) => c.label === "OUTBOUND");
    if (ob && !campaign && ob.share < 100) insights.push({ tone: "info", text: `Only ${ob.share}% of the dials are on the dedicated OUTBOUND campaign; the rest (${pct(total - ob.dials, total)}%) are call-backs placed by agents working INBOUND, CHAT and EMAIL.` });
    const peak = [...hourRows].sort((a, z) => z.dials - a.dials)[0];
    const best = [...hourRows].filter((h) => h.dials >= 50).sort((a, z) => z.connectPct - a.connectPct)[0];
    const worst = [...hourRows].filter((h) => h.dials >= 50).sort((a, z) => a.connectPct - z.connectPct)[0];
    insights.push({ tone: "info", text: `Dialling peaks at ${peak.label} (${peak.dials} dials, ${peak.share}%).${best && worst && best.label !== worst.label ? ` Connect % is best at ${best.label} (${best.connectPct}%) and weakest at ${worst.label} (${worst.connectPct}%).` : ""}` });
    insights.push({ tone: (v.shortConnPct as number) >= 40 ? "warn" : "info", text: `Average talk time is ${fmtSec(v.avgTalk as number)}; ${v.shortConnPct}% of connected calls end within 30s and ${v.longConnPct}% run past 3 minutes.` });
    if ((v.repeatPct as number) >= 5) insights.push({ tone: "info", text: `${v.repeatPct}% of dials are re-dials of a number already dialled that day (${nf(v.repeatDials as number)}).` });
    const top = realAgents[0];
    if (top && realAgents.length > 1 && top.share >= 30) insights.push({ tone: "warn", text: `${top.agent} placed ${top.share}% of all dials (${nf(top.dials)}) at a ${top.connectPct}% connect rate.` });
    const lowConn = [...realAgents].filter((a) => a.dials >= 100).sort((a, z) => a.connectPct - z.connectPct)[0];
    if (lowConn && realAgents.length > 1) insights.push({ tone: lowConn.connectPct < 80 ? "warn" : "info", text: `Lowest connect rate among agents with 100+ dials: ${lowConn.agent} at ${lowConn.connectPct}%.` });
  }
  if (b.d.length) insights.push({ tone: "info", text: `${nf(b.d.length)} outbound-skill CRM tickets (${v.ticketCapture}% of connected OUTBOUND dials); ${v.ticketEsc}% escalated. The dominant reason is "${(countTop(b.d))}".`, tab: "tickets" });
  if (b.q.length) insights.push({ tone: (v.avgQuality as number) >= 90 ? "good" : "warn", text: `Outbound quality averages ${v.avgQuality}% over ${b.q.length} audits.`, tab: "quality" });

  const notes = [
    `'Connected' is the status column as uploaded; in this file it means the call lasted more than 10 seconds (all 'Not Connected' rows are 0-10s, all 'Connected' rows 11s+).`,
    ...(L.dupRows ? [`${L.dupRows} row(s) share agent, number, start, end and length with another row -- suspected double uploads. They are KEPT because there is no call id to prove it; removing them would lower dials by ${L.dupRows}.`] : []),
    ...(L.badPhones ? [`${L.badPhones} dial row(s) hold a non-numeric or short 'number' (e.g. text) -- counted as dials but excluded from unique-number and repeat-customer analysis.`] : []),
    ...(L.noLen ? [`${L.noLen} dial row(s) have no call length; they count as 0 seconds (not connected).`] : []),
    "Omitted because the source has no data for them: right-party-contact / promise / refusal outcomes, ring time, list penetration, and dials per LOGIN hour (cl_apr's LOB tag is unreliable for outbound agents).",
    "The 'OUTBOUND' campaign is the dedicated outbound work; INBOUND / CHAT / EMAIL rows are call-backs made by agents working those LOBs. Pick a campaign above to isolate them; 'All' equals the Overview / Channels 'Outbound dialled' figure.",
    ...(campaign ? [`Campaign filter '${campaign}' applies to dial metrics only; quality audits and CRM tickets carry no campaign and are shown unfiltered.`] : []),
    ...(L.unparseable ? [`${L.unparseable} row(s) across the sources have an unreadable date and are excluded from every date range.`] : []),
    ...qs.notes,
  ];
  const definitions = [
    { term: "Connect %", meaning: "Connected ÷ Dials, where Connected = status 'Connected' (talk longer than 10 seconds)." },
    { term: "Repeat dial", meaning: "u_r = Repeat: the same number dialled again on the same day (count_val is that day's dial count for the number)." },
    { term: "Ticket capture", meaning: "CRM tickets with skill = outbound ÷ Connected dials on campaign OUTBOUND (a coverage ratio across two sources)." },
    { term: "Weeks", meaning: "W-1 = 1st-7th of the month, W-2 = 8th-14th, W-3 = 15th-21st, W-4 = 22nd-28th, W-5 = 29th onward." },
  ];
  return {
    lob: "outbound", label: "Outbound", from, to, filters: { campaign: campaign ?? "all" }, options: { campaign: L.campaigns },
    tabs: [{ key: "overview", label: "Overview" }, { key: "time", label: "Hour, weekday & length" }, { key: "repeat", label: "Re-dials" }, { key: "people", label: "Agents & TL" }, { key: "quality", label: "Quality" }, { key: "tickets", label: "Tickets" }],
    coverage: L.coverage, kpis, charts, tables, insights, notes, definitions, metrics: v, empty: b.rows.length === 0, latestDate: L.coverage[0]?.maxDate ?? null,
  };
}
function countTop(d: DispoRow[]): string {
  const m = new Map<string, number>();
  for (const r of d) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
  return [...m.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] ?? "—";
}

/* ───────────────────────────── week / date columns ───────────────────────────── */

export async function getOutboundPeriods(fromIn: string, toIn: string, campaignIn?: string): Promise<PeriodBreakdown> {
  const { from, to } = resolveRange(fromIn, toIn);
  const campaign = campaignIn && campaignIn !== "all" ? campaignIn : null;
  const L = await load(from, to, campaign);
  const { columns, dailyColumnsOmitted } = buildPeriodColumns(from, to);
  const b: OutBundle = { rows: L.rows, q: L.q, d: L.d };
  const seen = new Set<string>();
  const defs = [...DEFS.map((d) => ({ key: d.key, label: d.label, fmt: d.fmt })), ...PERIOD_EXTRA].filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
  const tables: PeriodTable[] = [
    { title: "Outbound metrics", rowsLabel: "Metric", rows: kpiPeriodRows(defs, (s: OutBundle) => computeOutbound(s, undefined), (f, t) => slice(b, f, t), from, to, columns) },
    { title: "Dials by campaign", rowsLabel: "Campaign", rows: categoryPeriodRows(b.rows, (r) => r.campaign, columns) },
    { title: "Dials by hour", rowsLabel: "Hour", rows: categoryPeriodRows(b.rows, (r) => `${String(r.hour).padStart(2, "0")}:00`, columns, 24).sort((a, z) => a.label.localeCompare(z.label)) },
    { title: "Ticket reasons (outbound skill)", rowsLabel: "Reason", rows: categoryPeriodRows(b.d, (r) => r.reason, columns) },
  ];
  return { from, to, columns, tables, dailyColumnsOmitted };
}

/* ───────────────────────────── drill-down ───────────────────────────── */

const CALL_COLS: Column[] = [
  { key: "date", label: "Date", align: "left" }, { key: "time", label: "Time", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "number", label: "Number", align: "left" },
  { key: "campaign", label: "Campaign", align: "left" }, { key: "status", label: "Status", align: "left" }, { key: "len", label: "Length", fmt: "sec" }, { key: "reason", label: "Ended by", align: "left" },
];

export async function getOutboundDetail(kind: string, key: string, fromIn: string, toIn: string, campaignIn?: string): Promise<DetailPayload | null> {
  const { from, to } = resolveRange(fromIn, toIn);
  const campaign = campaignIn && campaignIn !== "all" ? campaignIn : null;
  const L = await load(from, to, campaign);
  if (kind.startsWith("dispo_")) return dispoDetail(kind, key, L.d);
  if (kind.startsWith("quality_")) return qualityDetail(kind, key, L.q);
  const all = L.rows;
  let rows: OutRow[]; let title: string; let subtitle = ""; let audits: QualRow[] = [];
  switch (kind) {
    case "agent": rows = all.filter((r) => r.agentKey === key); title = rows[0]?.agent ?? key; subtitle = `${key} · TL ${rows[0]?.tl ?? "—"}`; audits = L.q.filter((x) => x.empId === key); break;
    case "day": rows = all.filter((r) => r.date === key); title = `Dials — ${fmtDdMmYyyy(key)}`; subtitle = WEEKDAYS[weekdayOf(key)]; break;
    case "hour": rows = all.filter((r) => r.hour === Number(key)); title = `Dials — ${String(key).padStart(2, "0")}:00 hour`; subtitle = "All days in the range"; break;
    case "weekday": { const w = WEEKDAYS.indexOf(key); if (w < 0) return null; rows = all.filter((r) => weekdayOf(r.date) === w); title = `Dials — ${key}s`; break; }
    case "campaign": rows = all.filter((r) => r.campaign === key); title = `Dials — campaign ${key}`; break;
    case "reason": rows = all.filter((r) => r.reason === key); title = `Dials — ended by ${key}`; break;
    case "len": rows = all.filter((r) => bucketOf(r.len, LEN_BUCKETS) === key); title = `Dials — length ${key}`; break;
    case "tl": rows = all.filter((r) => r.tl === key); title = `TL — ${key}`; audits = L.q.filter((x) => x.tl === key); break;
    case "redial": { const c = key.startsWith("5") ? 5 : key.startsWith("Dialled once") ? 1 : Number(key.match(/\d/)?.[0] ?? 1); rows = all.filter((r) => Math.min(r.countVal, 5) === c); title = `Dials — ${key}`; break; }
    case "heat": { const [d, h] = key.split("|"); rows = all.filter((r) => r.date === d && r.hour === Number(h)); title = `Dials — ${fmtDdMmYyyy(d)} ${String(h).padStart(2, "0")}:00`; break; }
    case "customer": { const pk = [...new Set(all.filter((r) => r.phoneKey).map((r) => r.phoneKey))].find((p) => custKey(p) === key); if (!pk) return null; rows = all.filter((r) => r.phoneKey === pk); title = `Number ${maskPhone(rows[0].phoneRaw)}`; subtitle = "All dials to this number in the range"; break; }
    default: return null;
  }
  const k = computeOutbound({ rows, q: audits, d: [] }, undefined);
  const kp = (key2: string, label: string, fmt: Fmt, tone: Tone, icon: string): Kpi => ({ key: key2, label, value: k[key2] ?? 0, fmt, tone, icon });
  const byDate = groupRows(rows, (r) => r.date);
  const byHour = groupRows(rows, (r) => String(r.hour));
  const sections: DetailPayload["sections"] = [
    { title: "Summary", type: "kpis", kpis: [kp("dials", "Dials", "int", "sky", "PhoneOutgoing"), kp("connected", "Connected", "int", "emerald", "PhoneCall"), kp("connectPct", "Connect %", "pct", "teal", "Gauge"), kp("avgTalk", "Avg talk", "sec", "violet", "Timer"), kp("talkHours", "Talk hours", "dec1", "indigo", "Clock3"), kp("repeatPct", "Repeat dial %", "pct", "rose", "Repeat")] },
    { title: "Trend by day", type: "chart", chart: { key: "d", title: "Dials, connected and connect %", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "dials", label: "Dials", color: "#a5b4fc", type: "bar" }, { key: "connected", label: "Connected", color: "#10b981", type: "bar" }, { key: "connectPct", label: "Connect %", color: "#f59e0b", type: "line", axis: "right", fmt: "pct" }], data: [...byDate.entries()].sort((a, z) => a[0].localeCompare(z[0])).map(([date, rs]) => ({ date, dials: rs.length, connected: rs.filter((r) => r.connected).length, connectPct: pct(rs.filter((r) => r.connected).length, rs.length) })) } },
    { title: "Trend by hour", type: "chart", chart: { key: "h", title: "Dials by start hour", tab: "", kind: "combo", xKey: "label", xFmt: "text", series: [{ key: "dials", label: "Dials", color: "#0ea5e9", type: "bar" }], data: [...byHour.entries()].sort((a, z) => Number(a[0]) - Number(z[0])).map(([h, rs]) => ({ label: `${h.padStart(2, "0")}:00`, dials: rs.length })) } },
  ];
  if (kind !== "agent") {
    sections.push({ title: "Agents", type: "table", table: { columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "dials", label: "Dials", fmt: "int" }, { key: "connectPct", label: "Connect %", fmt: "pct" }, { key: "avgTalk", label: "Avg talk", fmt: "sec" }], rows: [...groupRows(rows, (r) => r.agentKey).entries()].map(([, rs]) => ({ agent: rs[0].agent, dials: rs.length, connectPct: pct(rs.filter((r) => r.connected).length, rs.length), avgTalk: round1(avg(sum(rs.filter((r) => r.connected).map((r) => r.len)), rs.filter((r) => r.connected).length)) })).sort((a, z) => z.dials - a.dials) }, empty: "No agents." });
  }
  sections.push({
    title: `Dials (latest ${Math.min(rows.length, 200)} of ${nf(rows.length)})`, type: "table",
    table: { columns: CALL_COLS, rows: [...rows].sort((a, z) => z.ts - a.ts || z.id - a.id).slice(0, 200).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), time: r.hm, agent: r.agent, number: maskPhone(r.phoneRaw), campaign: r.campaign, status: r.connected ? "Connected" : "Not connected", len: r.len, reason: r.reason })), recordType: "call", keyField: "id" },
    empty: "No dials.",
  });
  if (audits.length) {
    sections.push({ title: `Quality audits (${audits.length})`, type: "table", table: { columns: [{ key: "date", label: "Audited", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "query", label: "Query", align: "left" }, { key: "score", label: "Score", fmt: "pct" }, { key: "acpt", label: "Owner", align: "left" }], rows: audits.map((a) => ({ id: a.id, date: fmtDdMmYyyy(a.date), agent: a.empName, query: a.cxQuery, score: a.score, acpt: a.acpt })), recordType: "audit", keyField: "id" } });
  }
  return { title, subtitle: subtitle || `${nf(rows.length)} dials in the selected range`, badge: { label: `${nf(rows.length)} dials`, tone: "blue" }, sections };
}
