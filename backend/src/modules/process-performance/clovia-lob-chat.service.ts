import { createHmac } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  type ChartSpec, type Column, type CoverageRow, type DetailPayload, type DispoRow, type Directory, type Fmt, type Insight, type Kpi,
  type LobPayload, type PeriodBreakdown, type PeriodTable, type QualRow, type TableSpec, type Tone,
  DATE_EXPR, WEEKDAYS, agentName, avg, bucketOf, buildPeriodColumns, categoryPeriodRows, coverageOf, dispoKpis, dispoSection, fmtDdMmYyyy, inRange,
  isoAddDays, kpiPeriodRows, listDays, loadDirectory, loadDispo, loadQuality, maskPhone, num, pct, percentile, qualitySection, resolveRange, round1,
  round2, sum, timeToSec, titleCase, tlOf, weekdayOf,
} from "./clovia-lob.shared.js";
import { dispoDetail, qualityDetail } from "./clovia-lob.detail.js";

/**
 * CLOVIA -- CHAT slide.
 *
 * Source: db_masmis.cl_chat -- one row per ACCEPTED chat (2010 rows, 1-15 Sep
 * 2026, chat_id unique after removing 3 duplicated rows). date_time is the
 * chat start (wall-clock, see clovia-lob.shared.ts); accepted_time is when an
 * agent accepted it, and wait_time is exactly accepted - start (checked on all
 * 2010 rows). The raw transcript column is never read by this dashboard.
 *
 * Definitions:
 *   Chats            = distinct chat_id (latest upload wins on a duplicate)
 *   Wait to accept   = wait_time (queue wait before an agent accepted). It is the
 *                      chat equivalent of ASA, NOT a first-response time.
 *   Accepted <= 30s / <= 60s = share of chats whose wait_time is within the threshold
 *                      (a dashboard threshold, not a contractual SLA)
 *   Handle time      = chat_duration (accept to close)
 *   Repeat chat      = a chat from a phone number that had an earlier chat in the last 90
 *                      days of data. Phone key = last 10 digits. Chats with no phone number
 *                      (web widget) cannot be matched: they count as unique and are excluded
 *                      from the Repeat % denominator. Repeat 24 / 48 / 72 hrs = gap since
 *                      that number's previous chat (<=24h, 24-48h, 48-72h, >72h).
 *   Agent            = mas_id; 'NA' rows are matched to an agent only when the first name is
 *                      unique among identified agents, otherwise shown by name.
 *                      (`name` / `username` are the two shared chat-tool LOGINS, not agents.)
 *   Customer feedback= rating_received (star_rating_value 1-5), response_rcv (answered the
 *                      resolved? prompt), issue_resolved_yes / _no. Only ~1% of chats carry any.
 *   Quality / Tickets= cl_quality lob = 'Chat' (audit date); cl_dispo skill = 'chat' (ticket date)
 *
 * OMITTED (no source column): first-response time, chats abandoned in queue or missed
 * (the table lists accepted chats only), concurrency / occupancy, chat AHT excluding wrap.
 */

export interface ChatRow {
  id: number; chatId: string; date: string; time: string; hour: number; agentKey: string; agent: string; tl: string;
  dept: string; channel: string; phoneKey: string; phoneRaw: string; wait: number; dur: number; rated: boolean; star: number | null;
  responded: boolean; yes: boolean; no: boolean; isRepeat: boolean; gapHours: number | null; flow: string; ts: number;
}
export interface ChatBundle { rows: ChatRow[]; q: QualRow[]; d: DispoRow[] }
interface Loaded extends ChatBundle {
  dir: Directory; duplicatesRemoved: number; coverage: CoverageRow[]; unparseable: number;
  naTotal: number; naResolved: number; earliest: string | null; depts: string[];
}

const LOOKBACK_DAYS = 90;
const WAIT_BUCKETS = [
  { label: "0-15s", min: 0, max: 15 }, { label: "16-30s", min: 16, max: 30 }, { label: "31-60s", min: 31, max: 60 },
  { label: "1-2 min", min: 61, max: 120 }, { label: "2-5 min", min: 121, max: 300 }, { label: "5+ min", min: 301, max: Infinity },
] as const;
const DUR_BUCKETS = [
  { label: "0s (no conversation)", min: 0, max: 0 }, { label: "< 1 min", min: 1, max: 59 }, { label: "1-5 min", min: 60, max: 299 },
  { label: "5-10 min", min: 300, max: 599 }, { label: "10-20 min", min: 600, max: 1199 }, { label: "20+ min", min: 1200, max: Infinity },
] as const;
const GAP_BUCKETS = ["Within 24 hrs", "24-48 hrs", "48-72 hrs", "More than 72 hrs"] as const;
const nf = (n: number) => n.toLocaleString("en-IN");
const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.round(s)}s`);
const custKey = (phoneKey: string) => createHmac("sha256", process.env.JWT_SECRET || process.env.SESSION_SECRET || "clovia-chat").update(phoneKey).digest("hex").slice(0, 12);

async function load(from: string, to: string, dept: string | null): Promise<Loaded> {
  const lookFrom = isoAddDays(from, -LOOKBACK_DAYS);
  const [raw] = await db.execute<RowDataPacket[]>(
    `SELECT id, chat_id, phone_number, channel, dept, chat_flow, date_time, chat_duration, wait_time, star_rating_value, rating_received,
            response_rcv, issue_resolved_yes, issue_resolved_no, actual_agent_on_chat, tl_name, mas_id
       FROM db_masmis.cl_chat WHERE LEFT(date_time,10) BETWEEN ? AND ? ORDER BY id`, [lookFrom, to],
  );
  const latest = new Map<string, RowDataPacket>();
  for (const r of raw) latest.set(String(r.chat_id), r);
  const list = [...latest.values()];

  const dir = await loadDirectory();
  // 'NA' agents: match on a UNIQUE first name among identified agents.
  const firstTok = new Map<string, Set<string>>();
  for (const r of list) {
    const mas = String(r.mas_id ?? "");
    if (mas && mas !== "NA") {
      const tok = String(r.actual_agent_on_chat ?? "").trim().toLowerCase().split(/\s+/)[0];
      if (tok) (firstTok.get(tok) ?? firstTok.set(tok, new Set()).get(tok)!).add(mas);
    }
  }
  let naTotal = 0; let naResolved = 0;
  const rows: ChatRow[] = list.map((r) => {
    const dt = String(r.date_time ?? "");
    const date = dt.slice(0, 10); const time = dt.slice(11, 19);
    const actual = String(r.actual_agent_on_chat ?? "").trim();
    let agentKey = String(r.mas_id ?? "").trim();
    if (!agentKey || agentKey === "NA") {
      naTotal++;
      const cands = firstTok.get(actual.toLowerCase().split(/\s+/)[0] ?? "");
      if (cands && cands.size === 1) { agentKey = [...cands][0]; naResolved++; } else agentKey = `name:${actual || "Unknown"}`;
    }
    const phone = String(r.phone_number ?? "").replace(/\D/g, "");
    const star = String(r.star_rating_value ?? "").trim();
    return {
      id: num(r.id), chatId: String(r.chat_id), date, time, hour: Number(time.slice(0, 2)) || 0, agentKey,
      agent: agentKey.startsWith("name:") ? `${titleCase(actual)} (no MAS ID)` : agentName(dir, agentKey),
      tl: String(r.tl_name ?? "").trim() || tlOf(dir, agentKey), dept: String(r.dept ?? "").trim() || "(blank)", channel: String(r.channel ?? "").trim() || "(blank)",
      phoneKey: phone.length >= 7 ? phone.slice(-10) : "", phoneRaw: phone, wait: timeToSec(r.wait_time), dur: timeToSec(r.chat_duration),
      rated: String(r.rating_received) === "1", star: star ? num(star) : null, responded: String(r.response_rcv) === "1",
      yes: String(r.issue_resolved_yes) === "1", no: String(r.issue_resolved_no) === "1", isRepeat: false, gapHours: null,
      flow: String(r.chat_flow ?? "").trim(), ts: Date.parse(`${date}T${time || "00:00:00"}Z`),
    };
  }).sort((a, b) => a.ts - b.ts || a.id - b.id);

  const prev = new Map<string, number>();
  for (const r of rows) {
    if (!r.phoneKey) continue;
    const p = prev.get(r.phoneKey);
    if (p !== undefined) { r.isRepeat = true; r.gapHours = (r.ts - p) / 3_600_000; }
    prev.set(r.phoneKey, r.ts);
  }
  const inWin = rows.filter((r) => r.date >= from && r.date <= to && (!dept || r.dept === dept));
  const [q, d, cov, covQ, covD, deptRows] = await Promise.all([
    loadQuality(from, to, "Chat"), loadDispo(from, to, ["chat"]),
    coverageOf("Chat log", "cl_chat", DATE_EXPR.chat, "one row per accepted chat"),
    coverageOf("Quality audits", "cl_quality", DATE_EXPR.quality, "lob = Chat is used here"),
    coverageOf("CRM dispositions", "cl_dispo", DATE_EXPR.dispo, "skill = chat is used here"),
    db.execute<RowDataPacket[]>(`SELECT DISTINCT dept FROM db_masmis.cl_chat WHERE dept IS NOT NULL AND dept <> '' ORDER BY dept`),
  ]);
  return {
    rows: inWin, q, d, dir, duplicatesRemoved: raw.length - list.length, naTotal, naResolved, earliest: cov.minDate,
    unparseable: cov.unparseable + covQ.unparseable + covD.unparseable, depts: (deptRows[0] as RowDataPacket[]).map((x) => String(x.dept)),
    coverage: [cov, covQ, covD].map(({ unparseable: _u, ...c }) => c),
  };
}

/* ───────────────────────────── KPI engine ───────────────────────────── */

interface KpiDef { key: string; label: string; fmt: Fmt; tone: Tone; icon: string; tab?: string; sub?: (v: Record<string, number | null>) => string | undefined }

export function computeChat(b: ChatBundle): Record<string, number | null> {
  const r = b.rows; const n = r.length;
  const ident = r.filter((x) => x.phoneKey); const rep = r.filter((x) => x.isRepeat);
  const waits = r.map((x) => x.wait).sort((a, z) => a - z);
  const rated = r.filter((x) => x.star !== null);
  const yes = r.filter((x) => x.yes).length; const no = r.filter((x) => x.no).length;
  const agentDays = new Set(r.map((x) => `${x.agentKey}|${x.date}`)).size;
  const ql = b.q; const tk = dispoKpis(b.d, "");
  return {
    chats: n, unique: n - rep.length, repeat: rep.length, repeatPct: pct(rep.length, ident.length), unidentified: n - ident.length,
    rep24: rep.filter((x) => (x.gapHours ?? 0) <= 24).length, rep48: rep.filter((x) => (x.gapHours ?? 0) > 24 && (x.gapHours ?? 0) <= 48).length,
    rep72: rep.filter((x) => (x.gapHours ?? 0) > 48 && (x.gapHours ?? 0) <= 72).length, repOver72: rep.filter((x) => (x.gapHours ?? 0) > 72).length,
    avgWait: round1(avg(sum(waits), n)), p90Wait: percentile(waits, 90), maxWait: waits.length ? waits[waits.length - 1] : 0,
    wait30: pct(r.filter((x) => x.wait <= 30).length, n), wait60: pct(r.filter((x) => x.wait <= 60).length, n),
    avgDur: round1(avg(sum(r.map((x) => x.dur)), n)), handleHours: round1(sum(r.map((x) => x.dur)) / 3600),
    zeroDur: r.filter((x) => x.dur === 0).length, shortPct: pct(r.filter((x) => x.dur < 60).length, n),
    waPct: pct(r.filter((x) => x.channel === "WP").length, n), webChats: r.filter((x) => x.channel === "WEB").length,
    agents: new Set(r.map((x) => x.agentKey)).size, chatsPerAgentDay: round1(avg(n, agentDays)),
    ratings: rated.length, avgStar: rated.length ? round2(sum(rated.map((x) => x.star as number)) / rated.length) : 0,
    responded: r.filter((x) => x.responded).length, responseRate: pct(r.filter((x) => x.responded).length, n),
    resolvedYes: yes, resolvedNo: no, resolvedPct: pct(yes, yes + no),
    audits: ql.length, avgQuality: ql.length ? round2(sum(ql.map((x) => x.score)) / ql.length) : 0, fatal: ql.filter((x) => x.fatal).length,
    tickets: b.d.length, ticketEsc: tk[2].value as number, ticketFtr: tk[1].value as number, ticketCmp: tk[4].value as number,
  };
}

const DEFS: KpiDef[] = [
  { key: "chats", label: "Chats handled", fmt: "int", tone: "sky", icon: "MessageSquare", sub: (v) => `${v.agents} agents · ${v.chatsPerAgentDay} per agent-day` },
  { key: "unique", label: "Unique chats", fmt: "int", tone: "indigo", icon: "UserRound", sub: (v) => `${v.unidentified} with no phone number` },
  { key: "repeatPct", label: "Repeat %", fmt: "pct", tone: "rose", icon: "Repeat", sub: (v) => `${nf(v.repeat as number)} repeat chats · ${nf(v.rep24 as number)} within 24h` },
  { key: "avgWait", label: "Avg wait to accept", fmt: "sec", tone: "amber", icon: "Hourglass", sub: (v) => `p90 ${fmtSec(v.p90Wait as number)} · max ${fmtSec(v.maxWait as number)}` },
  { key: "wait30", label: "Accepted within 30s", fmt: "pct", tone: "emerald", icon: "Timer", sub: (v) => `${v.wait60}% within 60s` },
  { key: "avgDur", label: "Avg chat duration", fmt: "sec", tone: "violet", icon: "Clock3", sub: (v) => `${v.handleHours} handle hours in total` },
  { key: "zeroDur", label: "Zero-duration chats", fmt: "int", tone: "red", icon: "MessageSquareOff", sub: (v) => `${v.shortPct}% of chats under 1 min` },
  { key: "waPct", label: "WhatsApp share", fmt: "pct", tone: "teal", icon: "Smartphone", sub: (v) => `${nf(v.webChats as number)} web-widget chats` },
  { key: "responseRate", label: "Feedback response rate", fmt: "pct", tone: "cyan", icon: "MessageCircleQuestion", sub: (v) => `${v.responded} responded · ${v.ratings} star ratings` },
  { key: "resolvedPct", label: "Resolved (customer-reported)", fmt: "pct", tone: "teal", icon: "BadgeCheck", sub: (v) => `${v.resolvedYes} yes / ${v.resolvedNo} no -- small sample` },
  { key: "avgQuality", label: "Avg quality score", fmt: "pct", tone: "emerald", icon: "ShieldCheck", sub: (v) => `${v.audits} audits · ${v.fatal} fatal` },
  { key: "tickets", label: "CRM tickets (chat)", fmt: "int", tone: "violet", icon: "ClipboardList", sub: (v) => `${v.ticketEsc}% escalated · ${v.ticketCmp}% complaints` },
];
const PERIOD_EXTRA: Array<{ key: string; label: string; fmt: Fmt }> = [
  { key: "repeat", label: "Repeat chats", fmt: "int" }, { key: "rep24", label: "Repeat within 24 hrs", fmt: "int" }, { key: "rep48", label: "Repeat 24-48 hrs", fmt: "int" },
  { key: "rep72", label: "Repeat 48-72 hrs", fmt: "int" }, { key: "repOver72", label: "Repeat more than 72 hrs", fmt: "int" }, { key: "p90Wait", label: "p90 wait to accept", fmt: "sec" },
  { key: "maxWait", label: "Longest wait", fmt: "sec" }, { key: "wait60", label: "Accepted within 60s", fmt: "pct" }, { key: "handleHours", label: "Handle hours", fmt: "dec1" },
  { key: "shortPct", label: "Chats under 1 min", fmt: "pct" }, { key: "webChats", label: "Web-widget chats", fmt: "int" }, { key: "agents", label: "Active agents", fmt: "int" },
  { key: "chatsPerAgentDay", label: "Chats per agent-day", fmt: "dec1" }, { key: "ratings", label: "Star ratings received", fmt: "int" }, { key: "avgStar", label: "Avg star rating", fmt: "dec2" },
  { key: "responded", label: "Feedback responses", fmt: "int" }, { key: "resolvedYes", label: "Resolved: yes", fmt: "int" }, { key: "resolvedNo", label: "Resolved: no", fmt: "int" },
  { key: "audits", label: "Quality audits", fmt: "int" }, { key: "fatal", label: "Fatal audits", fmt: "int" }, { key: "ticketEsc", label: "Tickets escalated %", fmt: "pct" },
  { key: "ticketFtr", label: "Tickets FTR % (order-linked)", fmt: "pct" },
];
const slice = (b: ChatBundle, from: string, to: string): ChatBundle => ({ rows: inRange(b.rows, from, to), q: inRange(b.q, from, to), d: inRange(b.d, from, to) });

/* ───────────────────────────── report spec ───────────────────────────── */

const groupRows = <T,>(rows: T[], keyFn: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) { const k = keyFn(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

function agentTable(b: ChatBundle) {
  const total = b.rows.length;
  return [...groupRows(b.rows, (r) => r.agentKey).entries()].map(([key, rs]) => {
    const waits = rs.map((r) => r.wait).sort((a, z) => a - z);
    const aud = b.q.filter((x) => x.empId === key);
    return {
      _key: key, agent: rs[0].agent, empId: key.startsWith("name:") ? "NA" : key, tl: rs[0].tl, days: new Set(rs.map((r) => r.date)).size, chats: rs.length, share: pct(rs.length, total),
      perDay: round1(avg(rs.length, new Set(rs.map((r) => r.date)).size)), avgWait: round1(avg(sum(waits), rs.length)), p90Wait: percentile(waits, 90),
      avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)), repeatPct: pct(rs.filter((r) => r.isRepeat).length, rs.filter((r) => r.phoneKey).length),
      zeroDur: rs.filter((r) => r.dur === 0).length, ratings: rs.filter((r) => r.star !== null).length,
      avgStar: rs.filter((r) => r.star !== null).length ? round2(sum(rs.filter((r) => r.star !== null).map((r) => r.star as number)) / rs.filter((r) => r.star !== null).length) : null,
      audits: aud.length, quality: aud.length ? round2(sum(aud.map((x) => x.score)) / aud.length) : null,
    };
  }).sort((a, z) => z.chats - a.chats);
}

export async function getChatLob(fromIn: string, toIn: string, deptIn?: string): Promise<LobPayload> {
  const { from, to } = resolveRange(fromIn, toIn);
  const dept = deptIn && deptIn !== "all" ? deptIn : null;
  const L = await load(from, to, dept);
  if (dept && !L.depts.includes(dept)) throw new Error("Unknown department");
  const b: ChatBundle = { rows: L.rows, q: L.q, d: L.d };
  const v = computeChat(b);
  const kpis: Kpi[] = DEFS.map((d) => ({ key: d.key, label: d.label, value: v[d.key] ?? 0, fmt: d.fmt, tone: d.tone, icon: d.icon, sub: d.sub?.(v), tab: d.tab ?? "overview" }));

  const days = listDays(from, to);
  const dayRows = days.map((date) => {
    const s = { rows: b.rows.filter((r) => r.date === date), q: [], d: [] } as ChatBundle; const k = computeChat(s);
    return { _key: date, date, weekday: WEEKDAYS[weekdayOf(date)], chats: k.chats as number, unique: k.unique as number, repeat: k.repeat as number, repeatPct: k.repeatPct as number, avgWait: k.avgWait as number, wait30: k.wait30 as number, avgDur: k.avgDur as number, agents: k.agents as number, waPct: k.waPct as number, ratings: k.ratings as number };
  }).filter((d) => d.chats > 0);

  const hourMap = groupRows(b.rows, (r) => String(r.hour));
  const hourRows = [...hourMap.entries()].map(([h, rs]) => {
    const dset = new Set(rs.map((r) => r.date)).size;
    return { _key: h, hour: Number(h), label: `${h.padStart(2, "0")}:00`, chats: rs.length, avgPerDay: round1(avg(rs.length, dset)), share: pct(rs.length, b.rows.length), avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)), wait30: pct(rs.filter((r) => r.wait <= 30).length, rs.length), avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)), repeatPct: pct(rs.filter((r) => r.isRepeat).length, rs.filter((r) => r.phoneKey).length) };
  }).sort((a, z) => a.hour - z.hour);

  const wdGroups = groupRows(b.rows, (r) => String(weekdayOf(r.date)));
  const weekdayRows = [1, 2, 3, 4, 5, 6, 0].filter((w) => wdGroups.has(String(w))).map((w) => {
    const rs = wdGroups.get(String(w))!; const dset = new Set(rs.map((r) => r.date)).size;
    return { _key: WEEKDAYS[w], weekday: WEEKDAYS[w], days: dset, chats: rs.length, avgPerDay: round1(avg(rs.length, dset)), avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)), avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)) };
  });

  const deptRows = [...groupRows(b.rows, (r) => r.dept).entries()].map(([k, rs]) => ({ _key: k, label: k, chats: rs.length, share: pct(rs.length, b.rows.length), avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)), avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)), repeatPct: pct(rs.filter((r) => r.isRepeat).length, rs.filter((r) => r.phoneKey).length) })).sort((a, z) => z.chats - a.chats);
  const waitRows = WAIT_BUCKETS.map((w) => ({ _key: w.label, label: w.label, chats: b.rows.filter((r) => bucketOf(r.wait, WAIT_BUCKETS) === w.label).length })).map((x) => ({ ...x, share: pct(x.chats, b.rows.length) }));
  const durRows = DUR_BUCKETS.map((w) => ({ _key: w.label, label: w.label, chats: b.rows.filter((r) => bucketOf(r.dur, DUR_BUCKETS) === w.label).length })).map((x) => ({ ...x, share: pct(x.chats, b.rows.length) }));
  const gapOf = (g: number) => (g <= 24 ? GAP_BUCKETS[0] : g <= 48 ? GAP_BUCKETS[1] : g <= 72 ? GAP_BUCKETS[2] : GAP_BUCKETS[3]);
  const gapRows = GAP_BUCKETS.map((label) => ({ _key: label, label, chats: b.rows.filter((r) => r.isRepeat && gapOf(r.gapHours ?? 0) === label).length })).map((x) => ({ ...x, share: pct(x.chats, v.repeat as number) }));

  const agents = agentTable(b);
  const tlRows = [...groupRows(agents, (a) => a.tl).entries()].map(([tl, as]) => {
    const rs = b.rows.filter((r) => as.some((a) => a._key === r.agentKey));
    return { _key: tl, tl, agents: as.length, chats: rs.length, avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)), wait30: pct(rs.filter((r) => r.wait <= 30).length, rs.length), avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)), repeatPct: pct(rs.filter((r) => r.isRepeat).length, rs.filter((r) => r.phoneKey).length), ratings: rs.filter((r) => r.star !== null).length };
  }).sort((a, z) => z.chats - a.chats);

  const custMap = groupRows(b.rows.filter((r) => r.phoneKey), (r) => r.phoneKey);
  const topCust = [...custMap.entries()].filter(([, rs]) => rs.length > 1).map(([pk, rs]) => ({
    _key: custKey(pk), customer: maskPhone(rs[0].phoneRaw), chats: rs.length, agents: new Set(rs.map((r) => r.agentKey)).size,
    first: fmtDdMmYyyy(rs.map((r) => r.date).sort()[0]), last: fmtDdMmYyyy(rs.map((r) => r.date).sort().pop()), totalMin: round1(sum(rs.map((r) => r.dur)) / 60),
  })).sort((a, z) => z.chats - a.chats).slice(0, 30);
  const starRows = [1, 2, 3, 4, 5].map((s) => ({ _key: String(s), label: `${s} star`, count: b.rows.filter((r) => r.star === s).length }));

  // date x hour heatmap
  const hours = hourRows.map((h) => h.hour); const heatDays = dayRows.map((d) => d.date);
  const cells: Array<{ x: number; y: number; v: number }> = [];
  const dh = groupRows(b.rows, (r) => `${r.date}|${r.hour}`);
  heatDays.forEach((d, xi) => hours.forEach((h, yi) => { const c = dh.get(`${d}|${h}`)?.length ?? 0; if (c) cells.push({ x: xi, y: yi, v: c }); }));

  const charts: ChartSpec[] = [
    {
      key: "chat_daily", title: "Daily chats, repeat % and wait", subtitle: "Bars = chats (unique + repeat); lines on the right axis", tab: "overview", kind: "combo", xKey: "date", xFmt: "date", span: 2,
      series: [{ key: "unique", label: "Unique", color: "#6366f1", type: "bar", stackId: "c" }, { key: "repeat", label: "Repeat", color: "#f43f5e", type: "bar", stackId: "c" }, { key: "avgWait", label: "Avg wait (s)", color: "#f59e0b", type: "line", axis: "right" }],
      data: dayRows.map((d) => ({ date: d.date, unique: d.unique, repeat: d.repeat, avgWait: d.avgWait })), drill: { kind: "day", keyField: "date" },
    },
    { key: "chat_dept", title: "Chats by department", tab: "overview", kind: "donut", xKey: "label", series: [{ key: "chats", label: "Chats", color: "#0ea5e9" }], data: deptRows.map((d) => ({ label: d.label, chats: d.chats })), drill: { kind: "dept", keyField: "label" } },
    {
      key: "chat_hour", title: "Hour-wise chats and wait", subtitle: "Start hour of the chat", tab: "time", kind: "combo", xKey: "label", xFmt: "text", span: 2,
      series: [{ key: "chats", label: "Chats", color: "#6366f1", type: "bar" }, { key: "avgWait", label: "Avg wait (s)", color: "#f59e0b", type: "line", axis: "right" }],
      data: hourRows.map((h) => ({ label: h.label, hour: h.hour, chats: h.chats, avgWait: h.avgWait })), drill: { kind: "hour", keyField: "hour" },
    },
    { key: "chat_wait", title: "Wait-to-accept distribution", tab: "time", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "chats", label: "Chats", color: "#f59e0b" }], data: waitRows.map((w) => ({ label: w.label, chats: w.chats })), drill: { kind: "wait", keyField: "label" } },
    { key: "chat_dur", title: "Chat duration distribution", tab: "time", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "chats", label: "Chats", color: "#8b5cf6" }], data: durRows.map((w) => ({ label: w.label, chats: w.chats })), drill: { kind: "dur", keyField: "label" } },
    {
      key: "chat_weekday", title: "Average chats per weekday", tab: "time", kind: "combo", xKey: "weekday", xFmt: "text",
      series: [{ key: "avgPerDay", label: "Avg chats / day", color: "#0ea5e9", type: "bar" }], data: weekdayRows.map((w) => ({ weekday: w.weekday, avgPerDay: w.avgPerDay })), drill: { kind: "weekday", keyField: "weekday" },
    },
    { key: "chat_heat", title: "Date x hour heatmap", subtitle: "Chats started in each hour", tab: "time", kind: "heatmap", span: 2, heat: { xLabels: heatDays.map((d) => `${Number(d.slice(8, 10))}`), yLabels: hours.map((h) => `${String(h).padStart(2, "0")}:00`), xKeys: heatDays, yKeys: hours.map(String), cells, unit: "chats" }, drill: { kind: "heat" }, footnote: "Columns are days of the month; click a cell for that hour's chats." },
    { key: "chat_gap", title: "Repeat chats by gap since previous chat", tab: "repeat", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "chats", label: "Repeat chats", color: "#f43f5e" }], data: gapRows.map((g) => ({ label: g.label, chats: g.chats })), drill: { kind: "gap", keyField: "label" } },
    {
      key: "chat_repeat_daily", title: "Repeat % by day", tab: "repeat", kind: "combo", xKey: "date", xFmt: "date",
      series: [{ key: "repeatPct", label: "Repeat %", color: "#f43f5e", type: "line", fmt: "pct" }], data: dayRows.map((d) => ({ date: d.date, repeatPct: d.repeatPct })), drill: { kind: "day", keyField: "date" },
    },
    {
      key: "chat_agents", title: "Chats and wait by agent", tab: "people", kind: "combo", xKey: "agent", xFmt: "text", span: 2,
      series: [{ key: "chats", label: "Chats", color: "#6366f1", type: "bar" }, { key: "avgWait", label: "Avg wait (s)", color: "#f59e0b", type: "line", axis: "right" }],
      data: agents.map((a) => ({ agent: a.agent, _key: a._key, chats: a.chats, avgWait: a.avgWait })), drill: { kind: "agent", keyField: "_key" },
    },
    { key: "chat_stars", title: "Star ratings received", subtitle: `${v.ratings} ratings -- treat as a small sample`, tab: "feedback", kind: "hbar", xKey: "label", xFmt: "text", series: [{ key: "count", label: "Ratings", color: "#f59e0b" }], data: starRows.map((s) => ({ label: s.label, count: s.count })), drill: { kind: "star", keyField: "label" } },
    { key: "chat_resolved", title: "Customer-reported resolution", tab: "feedback", kind: "donut", xKey: "label", series: [{ key: "count", label: "Chats", color: "#10b981" }], data: [{ label: "Resolved: yes", count: v.resolvedYes }, { label: "Resolved: no", count: v.resolvedNo }], drill: { kind: "resolved", keyField: "label" } },
  ];

  const tables: TableSpec[] = [
    {
      key: "chat_daily_t", title: "Date-wise performance", tab: "overview", drillKind: "day", keyField: "_key", defaultSort: { key: "date", dir: "asc" },
      columns: [{ key: "date", label: "Date", align: "left" }, { key: "weekday", label: "Day", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "unique", label: "Unique", fmt: "int" }, { key: "repeat", label: "Repeat", fmt: "int" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "wait30", label: "≤30s %", fmt: "pct" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }, { key: "waPct", label: "WhatsApp %", fmt: "pct" }],
      rows: dayRows, totals: { date: "Total", chats: v.chats, unique: v.unique, repeat: v.repeat, repeatPct: v.repeatPct, avgWait: v.avgWait, wait30: v.wait30, avgDur: v.avgDur, waPct: v.waPct },
    },
    {
      key: "chat_dept_t", title: "Department-wise", tab: "overview", drillKind: "dept", keyField: "_key",
      columns: [{ key: "label", label: "Department", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }], rows: deptRows,
    },
    {
      key: "chat_hour_t", title: "Hour-wise performance", tab: "time", drillKind: "hour", keyField: "_key", defaultSort: { key: "hour", dir: "asc" },
      columns: [{ key: "label", label: "Hour", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "avgPerDay", label: "Avg / day", fmt: "dec1" }, { key: "share", label: "Share", fmt: "pct" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "wait30", label: "≤30s %", fmt: "pct" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }], rows: hourRows,
    },
    { key: "chat_weekday_t", title: "Weekday pattern", tab: "time", drillKind: "weekday", keyField: "_key", columns: [{ key: "weekday", label: "Weekday", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "avgPerDay", label: "Avg / day", fmt: "dec1" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }], rows: weekdayRows },
    { key: "chat_wait_t", title: "Wait-to-accept buckets", tab: "time", drillKind: "wait", keyField: "_key", columns: [{ key: "label", label: "Wait", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }], rows: waitRows },
    { key: "chat_dur_t", title: "Chat-duration buckets", tab: "time", drillKind: "dur", keyField: "_key", columns: [{ key: "label", label: "Duration", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }], rows: durRows },
    { key: "chat_gap_t", title: "Repeat chats by gap", tab: "repeat", drillKind: "gap", keyField: "_key", columns: [{ key: "label", label: "Gap since previous chat", align: "left" }, { key: "chats", label: "Repeat chats", fmt: "int" }, { key: "share", label: "Share of repeats", fmt: "pct" }], rows: gapRows },
    {
      key: "chat_cust_t", title: "Top repeat customers", tab: "repeat", drillKind: "customer", keyField: "_key", subtitle: "Numbers are masked; click a row for that customer's chats.",
      columns: [{ key: "customer", label: "Customer", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "totalMin", label: "Total minutes", fmt: "dec1" }, { key: "first", label: "First", align: "left" }, { key: "last", label: "Last", align: "left" }], rows: topCust,
    },
    {
      key: "chat_agents_t", title: "Agent-wise performance", tab: "people", drillKind: "agent", keyField: "_key", searchable: true, defaultSort: { key: "chats", dir: "desc" },
      columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "empId", label: "Emp ID", align: "left" }, { key: "days", label: "Days", fmt: "int" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "share", label: "Share", fmt: "pct" }, { key: "perDay", label: "Chats / day", fmt: "dec1" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "p90Wait", label: "p90 wait", fmt: "sec" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }, { key: "zeroDur", label: "0s chats", fmt: "int" }, { key: "ratings", label: "Ratings", fmt: "int" }, { key: "avgStar", label: "Avg ★", fmt: "dec2" }, { key: "audits", label: "Audits", fmt: "int" }, { key: "quality", label: "Quality", fmt: "pct" }],
      rows: agents,
    },
    {
      key: "chat_tl_t", title: "TL-wise performance", tab: "people", drillKind: "tl", keyField: "_key",
      columns: [{ key: "tl", label: "TL", align: "left" }, { key: "agents", label: "Agents", fmt: "int" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "wait30", label: "≤30s %", fmt: "pct" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }, { key: "repeatPct", label: "Repeat %", fmt: "pct" }, { key: "ratings", label: "Ratings", fmt: "int" }], rows: tlRows,
    },
    { key: "chat_star_t", title: "Rating distribution", tab: "feedback", drillKind: "star", keyField: "_key", columns: [{ key: "label", label: "Rating", align: "left" }, { key: "count", label: "Chats", fmt: "int" }], rows: starRows },
  ];

  const qs = qualitySection(b.q, "quality", "chat_q");
  kpis.push(...qs.kpis); charts.push(...qs.charts); tables.push(...qs.tables);
  const ds = dispoSection(b.d, "tickets", "chat_tk");
  kpis.push(...dispoKpis(b.d, "tickets")); charts.push(...ds.charts); tables.push(...ds.tables);

  // ── insights ──
  const insights: Insight[] = [];
  if (b.rows.length) {
    const peak = [...hourRows].sort((a, z) => z.chats - a.chats)[0];
    const slow = [...hourRows].filter((h) => h.chats >= 20).sort((a, z) => z.avgWait - a.avgWait)[0];
    insights.push({ tone: "info", text: `${nf(v.chats as number)} chats in the range; the peak hour is ${peak.label} with ${peak.share}% of volume (${peak.avgPerDay}/day).` });
    insights.push({ tone: (v.wait30 as number) >= 80 ? "good" : "warn", text: `${v.wait30}% of chats were accepted within 30s (${v.wait60}% within 60s); average wait ${fmtSec(v.avgWait as number)}, p90 ${fmtSec(v.p90Wait as number)}, longest ${fmtSec(v.maxWait as number)}.` });
    if (slow && slow.avgWait > (v.avgWait as number) * 1.3) insights.push({ tone: "warn", text: `Waits are longest at ${slow.label} (avg ${fmtSec(slow.avgWait)}, ${slow.chats} chats) -- ${round1(slow.avgWait / Math.max(v.avgWait as number, 1))}x the overall average.` });
    insights.push({ tone: (v.repeatPct as number) >= 25 ? "warn" : "info", text: `${v.repeatPct}% of chats from identified numbers were repeat contacts (${nf(v.rep24 as number)} within 24h, ${nf(v.rep48 as number)} within 48h).` });
    if (agents.length > 1 && agents[0].share >= 40) insights.push({ tone: "warn", text: `${agents[0].agent} handled ${agents[0].share}% of all chats (${nf(agents[0].chats)}) -- workload is concentrated on one agent.` });
    if ((v.zeroDur as number) > 0) insights.push({ tone: "warn", text: `${nf(v.zeroDur as number)} accepted chats have a 0-second duration (${pct(v.zeroDur as number, v.chats as number)}%) and ${v.shortPct}% ended within a minute -- possible accidental accepts or instant closures.` });
    if ((v.responded as number) > 0) insights.push({ tone: (v.resolvedPct as number) >= 50 ? "good" : "bad", text: `Only ${v.responseRate}% of chats returned feedback; of ${(v.resolvedYes as number) + (v.resolvedNo as number)} who answered, ${v.resolvedPct}% said the issue was resolved.`, tab: "feedback" });
    const web = deptRows.find((d) => d.label === "WEB");
    if (web && web.share >= 10) insights.push({ tone: "info", text: `The web widget (dept WEB) supplies ${web.share}% of chats and none of them carry a phone number, so they cannot be matched for repeat analysis.` });
  }
  if (b.d.length) insights.push({ tone: (v.ticketEsc as number) >= 40 ? "bad" : "info", text: `${nf(b.d.length)} chat-skill CRM tickets: ${v.ticketEsc}% escalated, ${v.ticketCmp}% complaints, order-linked FTR ${v.ticketFtr}%.`, tab: "tickets" });
  if (b.q.length) insights.push({ tone: (v.avgQuality as number) >= 90 ? "good" : "warn", text: `Chat quality averages ${v.avgQuality}% over ${b.q.length} audits (${pct(b.q.length, v.chats as number)}% of chats).`, tab: "quality" });

  const notes: string[] = [
    `${L.duplicatesRemoved} chat row(s) repeated an existing chat_id and were removed (latest upload kept); the Channels slide counts them.`,
    ...(L.naTotal ? [`${L.naTotal} chat(s) have mas_id = NA; ${L.naResolved} were attributed to an agent because the first name matches exactly one identified agent, the rest are shown by name.`] : []),
    `Repeat chats look back ${LOOKBACK_DAYS} days, but the chat log starts on ${L.earliest ? fmtDdMmYyyy(L.earliest) : "an unknown date"}: chats in the first days after that cannot see earlier contacts, so repeat counts there are understated.`,
    "Omitted because the source has no data for them: first-response time (wait_time is queue wait before accept, shown as 'wait to accept'), chats abandoned or missed in queue (the log lists accepted chats only), concurrency / occupancy, and transfer counts.",
    "Only ~1% of chats carry a customer rating or resolved-yes/no answer; those KPIs are a small sample and are labelled as such.",
    ...(dept ? [`Department filter '${dept}' applies to chat metrics only; quality audits and CRM tickets have no department and are shown unfiltered.`] : []),
    ...(L.unparseable ? [`${L.unparseable} row(s) across the sources have an unreadable date and are excluded from every date range.`] : []),
    ...qs.notes,
  ];
  const definitions = [
    { term: "Wait to accept", meaning: "accepted_time - chat start (the wait_time column). Chat equivalent of ASA; not first-response time." },
    { term: "Repeat chat", meaning: "Chat from a phone number (last 10 digits) that chatted earlier within the previous 90 days of data; no-phone web chats count as unique and are outside the Repeat % base." },
    { term: "Agent", meaning: "mas_id of the agent who took the chat. 'Jagjeet' / 'Manalisa' in the name column are the two shared tool logins." },
    { term: "Weeks", meaning: "W-1 = 1st-7th of the month, W-2 = 8th-14th, W-3 = 15th-21st, W-4 = 22nd-28th, W-5 = 29th onward." },
  ];
  return {
    lob: "chat", label: "Chat", from, to, filters: { dept: dept ?? "all" }, options: { dept: L.depts },
    tabs: [{ key: "overview", label: "Overview" }, { key: "time", label: "Hour, weekday & wait" }, { key: "repeat", label: "Repeat" }, { key: "people", label: "Agents & TL" }, { key: "feedback", label: "Feedback" }, { key: "quality", label: "Quality" }, { key: "tickets", label: "Tickets" }],
    coverage: L.coverage, kpis, charts, tables, insights, notes, definitions, metrics: v, empty: b.rows.length === 0, latestDate: L.coverage[0]?.maxDate ?? null,
  };
}

/* ───────────────────────────── week / date columns ───────────────────────────── */

export async function getChatPeriods(fromIn: string, toIn: string, deptIn?: string): Promise<PeriodBreakdown> {
  const { from, to } = resolveRange(fromIn, toIn);
  const dept = deptIn && deptIn !== "all" ? deptIn : null;
  const L = await load(from, to, dept);
  const { columns, dailyColumnsOmitted } = buildPeriodColumns(from, to);
  const b: ChatBundle = { rows: L.rows, q: L.q, d: L.d };
  const seen = new Set<string>();
  const defs = [...DEFS.map((d) => ({ key: d.key, label: d.label, fmt: d.fmt })), ...PERIOD_EXTRA].filter((d) => (seen.has(d.key) ? false : (seen.add(d.key), true)));
  const tables: PeriodTable[] = [
    { title: "Chat metrics", rowsLabel: "Metric", rows: kpiPeriodRows(defs, computeChat, (f, t) => slice(b, f, t), from, to, columns) },
    { title: "Chats by department", rowsLabel: "Department", rows: categoryPeriodRows(b.rows, (r) => r.dept, columns) },
    { title: "Chats by hour", rowsLabel: "Hour", rows: categoryPeriodRows(b.rows, (r) => `${String(r.hour).padStart(2, "0")}:00`, columns, 24).sort((a, z) => a.label.localeCompare(z.label)) },
    { title: "Ticket reasons (chat skill)", rowsLabel: "Reason", rows: categoryPeriodRows(b.d, (r) => r.reason, columns) },
  ];
  return { from, to, columns, tables, dailyColumnsOmitted };
}

/* ───────────────────────────── drill-down ───────────────────────────── */

const CHAT_COLS: Column[] = [
  { key: "date", label: "Date", align: "left" }, { key: "time", label: "Time", align: "left" }, { key: "chatId", label: "Chat", align: "left" }, { key: "agent", label: "Agent", align: "left" },
  { key: "dept", label: "Dept", align: "left" }, { key: "wait", label: "Wait", fmt: "sec" }, { key: "dur", label: "Duration", fmt: "sec" }, { key: "star", label: "★", fmt: "int" }, { key: "repeat", label: "Repeat", align: "left" },
];

export async function getChatDetail(kind: string, key: string, fromIn: string, toIn: string, deptIn?: string): Promise<DetailPayload | null> {
  const { from, to } = resolveRange(fromIn, toIn);
  const dept = deptIn && deptIn !== "all" ? deptIn : null;
  const L = await load(from, to, dept);
  if (kind.startsWith("dispo_")) return dispoDetail(kind, key, L.d);
  if (kind.startsWith("quality_")) return qualityDetail(kind, key, L.q);
  const all = L.rows;
  let rows: ChatRow[]; let title: string; let subtitle = ""; let audits: QualRow[] = [];
  switch (kind) {
    case "agent": rows = all.filter((r) => r.agentKey === key); title = rows[0]?.agent ?? key; subtitle = `${key.startsWith("name:") ? "No MAS ID" : key} · TL ${rows[0]?.tl ?? "—"}`; audits = L.q.filter((x) => x.empId === key); break;
    case "day": rows = all.filter((r) => r.date === key); title = `Chats — ${fmtDdMmYyyy(key)}`; subtitle = WEEKDAYS[weekdayOf(key)]; break;
    case "hour": rows = all.filter((r) => r.hour === Number(key)); title = `Chats — ${String(key).padStart(2, "0")}:00 hour`; subtitle = "All days in the range"; break;
    case "weekday": { const w = WEEKDAYS.indexOf(key); if (w < 0) return null; rows = all.filter((r) => weekdayOf(r.date) === w); title = `Chats — ${key}s`; break; }
    case "dept": rows = all.filter((r) => r.dept === key); title = `Chats — department ${key}`; break;
    case "tl": rows = all.filter((r) => r.tl === key); title = `TL — ${key}`; audits = L.q.filter((x) => x.tl === key); break;
    case "wait": rows = all.filter((r) => bucketOf(r.wait, WAIT_BUCKETS) === key); title = `Chats — wait ${key}`; break;
    case "dur": rows = all.filter((r) => bucketOf(r.dur, DUR_BUCKETS) === key); title = `Chats — duration ${key}`; break;
    case "gap": rows = all.filter((r) => r.isRepeat && (r.gapHours ?? 0) <= (key === GAP_BUCKETS[0] ? 24 : key === GAP_BUCKETS[1] ? 48 : key === GAP_BUCKETS[2] ? 72 : Infinity) && (r.gapHours ?? 0) > (key === GAP_BUCKETS[0] ? -1 : key === GAP_BUCKETS[1] ? 24 : key === GAP_BUCKETS[2] ? 48 : 72)); title = `Repeat chats — ${key}`; break;
    case "heat": { const [d, h] = key.split("|"); rows = all.filter((r) => r.date === d && r.hour === Number(h)); title = `Chats — ${fmtDdMmYyyy(d)} ${String(h).padStart(2, "0")}:00`; break; }
    case "star": rows = all.filter((r) => r.star === Number(key)); title = `Chats rated ${key} star`; break;
    case "resolved": rows = all.filter((r) => (key.endsWith("yes") ? r.yes : r.no)); title = `Chats — ${key}`; break;
    case "customer": { const pk = [...new Set(all.filter((r) => r.phoneKey).map((r) => r.phoneKey))].find((p) => custKey(p) === key); if (!pk) return null; rows = all.filter((r) => r.phoneKey === pk); title = `Customer ${maskPhone(rows[0].phoneRaw)}`; subtitle = "All chats from this number in the range"; break; }
    default: return null;
  }
  const s: ChatBundle = { rows, q: audits, d: [] };
  const k = computeChat(s);
  const kp = (key2: string, label: string, fmt: Fmt, tone: Tone, icon: string, sub?: string): Kpi => ({ key: key2, label, value: k[key2] ?? 0, fmt, tone, icon, sub });
  const byDate = groupRows(rows, (r) => r.date);
  const byHour = groupRows(rows, (r) => String(r.hour));
  const sections: DetailPayload["sections"] = [
    { title: "Summary", type: "kpis", kpis: [kp("chats", "Chats", "int", "sky", "MessageSquare"), kp("repeatPct", "Repeat %", "pct", "rose", "Repeat"), kp("avgWait", "Avg wait", "sec", "amber", "Hourglass"), kp("wait30", "Accepted ≤30s", "pct", "emerald", "Timer"), kp("avgDur", "Avg duration", "sec", "violet", "Clock3"), kp("ratings", "Ratings", "int", "cyan", "Star")] },
    { title: "Trend by day", type: "chart", chart: { key: "d", title: "Chats and avg wait", tab: "", kind: "combo", xKey: "date", xFmt: "date", series: [{ key: "chats", label: "Chats", color: "#6366f1", type: "bar" }, { key: "avgWait", label: "Avg wait (s)", color: "#f59e0b", type: "line", axis: "right" }], data: [...byDate.entries()].sort((a, z) => a[0].localeCompare(z[0])).map(([date, rs]) => ({ date, chats: rs.length, avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)) })) } },
    { title: "Trend by hour", type: "chart", chart: { key: "h", title: "Chats by start hour", tab: "", kind: "combo", xKey: "label", xFmt: "text", series: [{ key: "chats", label: "Chats", color: "#0ea5e9", type: "bar" }], data: [...byHour.entries()].sort((a, z) => Number(a[0]) - Number(z[0])).map(([h, rs]) => ({ label: `${h.padStart(2, "0")}:00`, chats: rs.length })) } },
  ];
  if (kind !== "agent") {
    sections.push({ title: "Agents", type: "table", table: { columns: [{ key: "agent", label: "Agent", align: "left" }, { key: "chats", label: "Chats", fmt: "int" }, { key: "avgWait", label: "Avg wait", fmt: "sec" }, { key: "avgDur", label: "Avg duration", fmt: "sec" }], rows: [...groupRows(rows, (r) => r.agentKey).entries()].map(([, rs]) => ({ agent: rs[0].agent, chats: rs.length, avgWait: round1(avg(sum(rs.map((r) => r.wait)), rs.length)), avgDur: round1(avg(sum(rs.map((r) => r.dur)), rs.length)) })).sort((a, z) => z.chats - a.chats) }, empty: "No agents." });
  }
  sections.push({
    title: `Chats (latest ${Math.min(rows.length, 200)} of ${nf(rows.length)})`, type: "table",
    table: { columns: CHAT_COLS, rows: [...rows].sort((a, z) => z.ts - a.ts).slice(0, 200).map((r) => ({ id: r.id, date: fmtDdMmYyyy(r.date), time: r.time.slice(0, 5), chatId: r.chatId, agent: r.agent, dept: r.dept, wait: r.wait, dur: r.dur, star: r.star, repeat: r.isRepeat ? `Yes (${round1((r.gapHours ?? 0))}h)` : "No" })), recordType: "chat", keyField: "id" },
    empty: "No chats.",
  });
  if (audits.length) {
    sections.push({ title: `Quality audits (${audits.length})`, type: "table", table: { columns: [{ key: "date", label: "Audited", align: "left" }, { key: "agent", label: "Agent", align: "left" }, { key: "query", label: "Query", align: "left" }, { key: "score", label: "Score", fmt: "pct" }, { key: "acpt", label: "Owner", align: "left" }], rows: audits.map((a) => ({ id: a.id, date: fmtDdMmYyyy(a.date), agent: a.empName, query: a.cxQuery, score: a.score, acpt: a.acpt })), recordType: "audit", keyField: "id" } });
  }
  return { title, subtitle: subtitle || `${nf(rows.length)} chats in the selected range`, badge: { label: `${nf(rows.length)} chats`, tone: "blue" }, sections };
}
