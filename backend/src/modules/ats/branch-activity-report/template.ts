/**
 * Branch Recruitment Activity Report — HTML email.
 *
 * Built for mail clients, not browsers: one fluid column (max 960px), nested tables, inline styles only, no flexbox,
 * no horizontal scrolling and no border-radius/overflow tricks. Gmail ignores `background` in inline styles
 * on table cells, so every filled cell (bars, headers, cards) carries a `bgcolor` attribute. Wide data is
 * condensed (two values per cell) rather than scrolled. Every dynamic string goes through esc().
 */
import {
  SLA,
  fmtMin,
  type BranchBlock,
  type Escalation,
  type RecruiterRow,
  type ReportData,
  type SlaStat,
  type Summary,
} from "./metrics.js";

/** Fluid: fills the reading pane up to this ceiling. Outlook desktop ignores max-width and simply uses the pane width. */
const MAX_W = 960;
const C = {
  navy: "#0B1F3A",
  navy2: "#16335C",
  gold: "#C9A24B",
  ink: "#1E293B",
  muted: "#64748B",
  line: "#E2E8F0",
  soft: "#F8FAFC",
  page: "#EEF2F7",
  green: "#15803D",
  greenBg: "#DCFCE7",
  amber: "#B45309",
  amberBg: "#FEF3C7",
  red: "#B91C1C",
  redBg: "#FEE2E2",
  orange: "#EA580C",
  blue: "#1D4ED8",
  teal: "#0F766E",
} as const;
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const n = (v: number) => v.toLocaleString("en-IN");
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const muted = (t: string) =>
  `<span style="color:${C.muted};font-size:10.5px;font-weight:400">${esc(t)}</span>`;

function slaColor(p: number | null): { fg: string; bg: string } {
  if (p == null) return { fg: C.muted, bg: C.soft };
  if (p >= 90) return { fg: C.green, bg: C.greenBg };
  if (p >= 70) return { fg: C.amber, bg: C.amberBg };
  return { fg: C.red, bg: C.redBg };
}

const pill = (text: string, fg: string, bg: string) =>
  `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:${fg};font-size:11px;font-weight:700;white-space:nowrap">${esc(text)}</span>`;
const slaPill = (s: SlaStat) =>
  s.reliable
    ? pill(pct(s.pct), slaColor(s.pct).fg, slaColor(s.pct).bg)
    : pill("n/a", C.muted, C.soft);
const slaTone = (s: SlaStat) => (s.reliable ? slaColor(s.pct).fg : C.muted);

type Align = "left" | "right" | "center";
const th = (t: string, align: Align = "right") =>
  `<td align="${align}" bgcolor="${C.soft}" style="padding:8px 6px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${C.muted};font-weight:700;border-bottom:2px solid ${C.line}">${esc(t)}</td>`;
const td = (
  t: string,
  o: {
    align?: Align;
    bold?: boolean;
    color?: string;
    raw?: boolean;
    bg?: string;
    size?: number;
  } = {},
) =>
  `<td align="${o.align ?? "right"}" valign="middle" ${o.bg ? `bgcolor="${o.bg}"` : ""} style="padding:8px 6px;font-size:${o.size ?? 12}px;color:${o.color ?? C.ink};${o.bold ? "font-weight:700;" : ""}border-bottom:1px solid ${C.line}">${o.raw ? t : esc(t)}</td>`;

/** A bordered data table. Borders live on the wrapper so no corner-radius/overflow tricks are needed. */
const dataTable = (rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-collapse:collapse">${rows}</table>`;

const zebra = (i: number) => (i % 2 ? C.soft : "#FFFFFF");

const section = (
  title: string,
  sub: string,
  body: string,
  accent: string = C.gold,
) => `
<tr><td style="padding:26px 24px 0 24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="4" bgcolor="${accent}" style="font-size:1px;line-height:1px">&nbsp;</td>
    <td style="padding-left:10px">
      <div style="font-size:16px;font-weight:800;color:${C.navy};line-height:1.25">${esc(title)}</div>
      <div style="font-size:11.5px;color:${C.muted};margin-top:2px;line-height:1.4">${esc(sub)}</div>
    </td></tr></table>
  <div style="height:12px;line-height:12px;font-size:1px">&nbsp;</div>${body}
</td></tr>`;

// ── KPI grid (3 × 2) ─────────────────────────────────────────────────────────────────────

function kpiCard(
  label: string,
  ftd: string,
  mtd: string,
  tone: string,
): string {
  return `<td width="33%" valign="top" bgcolor="${C.soft}" style="padding:12px;border:1px solid ${C.line};border-top:3px solid ${tone}">
    <div style="font-size:10px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted};font-weight:700">${esc(label)}</div>
    <div style="font-size:28px;font-weight:800;color:${tone};line-height:1.15;margin-top:4px">${esc(ftd)}</div>
    <div style="font-size:11px;color:${C.muted};margin-top:2px">Month <b style="color:${C.ink}">${esc(mtd)}</b></div></td>`;
}

function kpiStrip(d: ReportData): string {
  const { ftd, mtd } = d.overall;
  const pending = d.escalations.length + d.onTrackOpen;
  const cards = [
    kpiCard("Walk-ins today", n(ftd.walkins), n(mtd.walkins), C.navy),
    kpiCard("Tokens", n(ftd.tokens), n(mtd.tokens), C.navy2),
    kpiCard("Tokens closed", n(ftd.closed), n(mtd.closed), C.blue),
    kpiCard("Selected", n(ftd.selected), n(mtd.selected), C.green),
    kpiCard(
      "Closure pending",
      n(pending),
      n(mtd.open),
      pending > 0 ? C.red : C.green,
    ),
    kpiCard(
      "SLA-2 met",
      ftd.sla2.reliable ? pct(ftd.sla2.pct) : "n/a",
      mtd.sla2.reliable ? pct(mtd.sla2.pct) : "n/a",
      slaTone(ftd.sla2),
    ),
  ];
  return `<tr><td style="padding:18px 16px 0 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="8">
    <tr>${cards.slice(0, 3).join("")}</tr><tr>${cards.slice(3).join("")}</tr></table></td></tr>`;
}

// ── Escalations ──────────────────────────────────────────────────────────────────────────

const LEVEL = {
  3: { label: "L3 · HR Head", fg: "#fff", bg: C.red },
  2: { label: "L2 · Branch Head", fg: "#fff", bg: C.orange },
  1: { label: "L1 · Recruiter", fg: C.amber, bg: C.amberBg },
} as const;
const MAX_ESCALATION_ROWS = 25;

function escalationRow(e: Escalation, i: number, showBranch: boolean): string {
  const lv = LEVEL[e.level];
  const who = `${e.candidateName}${showBranch ? ` · ${e.branch}` : ""}`;
  const arrived = `${e.arrivalHhmm}${e.level === 3 ? ` (${e.arrivalDate})` : ""}`;
  const bg = zebra(i);
  return `<tr>
    ${td(pill(lv.label, lv.fg, lv.bg), { align: "left", raw: true, bg })}
    ${td(`<b>${esc(e.tokenNumber)}</b><br>${muted(who)}`, { align: "left", raw: true, bg })}
    ${td(esc(e.recruiter), { align: "left", raw: true, bg })}
    ${td(`${esc(e.stage)}<br>${muted(`arrived ${arrived}`)}`, { align: "left", raw: true, bg })}
    ${td(`<span style="color:${C.red};font-weight:800">${fmtMin(e.runningMin)}</span><br>${muted(`+${fmtMin(e.overSlaMin)} over ${fmtMin(e.stageSlaMin)}`)}`, { raw: true, bg })}
  </tr>`;
}

function escalationSection(d: ReportData, showBranch: boolean): string {
  const count = (l: number) =>
    d.escalations.filter((e) => e.level === l).length;
  const chips = [
    pill(`L3 HR Head · ${count(3)}`, "#fff", C.red),
    pill(`L2 Branch Head · ${count(2)}`, "#fff", C.orange),
    pill(`L1 Recruiter · ${count(1)}`, C.amber, C.amberBg),
    pill(`Open, inside SLA · ${d.onTrackOpen}`, C.green, C.greenBg),
  ].join(" &nbsp;");
  const shown = d.escalations.slice(0, MAX_ESCALATION_ROWS);
  const more = d.escalations.length - shown.length;
  const head = `<tr>${th("Escalate", "left")}${th("Token", "left")}${th("Recruiter", "left")}${th("Stage", "left")}${th("Clock running")}</tr>`;
  const body =
    d.escalations.length === 0
      ? `<div style="padding:14px;background:${C.greenBg};color:${C.green};font-size:13px;font-weight:600">All open tokens are inside their SLA — nothing to escalate.</div>`
      : `<div style="margin-bottom:10px;line-height:26px">${chips}</div>
       ${dataTable(head + shown.map((e, i) => escalationRow(e, i, showBranch)).join(""))}
       ${more > 0 ? `<div style="font-size:12px;color:${C.muted};margin-top:6px">+ ${more} more open tokens past SLA.</div>` : ""}
       <div style="font-size:11px;color:${C.muted};margin-top:8px;line-height:1.5">Clock = time since arrival while waiting for the call, then time since the interview call until the recruiter closes the token. It is still running at the time of this report.</div>`;
  return section(
    "Escalations — token closure pending",
    `Recruiter has not closed the token · SLA: call ≤ ${SLA.waitToCallMin}m, closure ≤ ${fmtMin(SLA.callToClosureMin)}`,
    body,
    C.red,
  );
}

// ── Performance table (Today / Week / Month) ─────────────────────────────────────────────

interface MetricLine {
  label: string;
  get: (s: Summary) => string;
  strong?: boolean;
  tone?: (s: Summary) => string;
}

const METRIC_LINES: MetricLine[] = [
  { label: "Walk-ins", get: (s) => n(s.walkins), strong: true },
  { label: "Tokens generated", get: (s) => n(s.tokens), strong: true },
  { label: "Interview called", get: (s) => n(s.called) },
  { label: "Token closed", get: (s) => n(s.closed) },
  {
    label: "Interview updates filed (any token day)",
    get: (s) =>
      `${n(s.formsSubmitted)}${s.formsFromEarlier ? ` (${n(s.formsFromEarlier)} old)` : ""}`,
  },
  { label: "Interviewed", get: (s) => n(s.interviewed) },
  {
    label: "Selected",
    get: (s) => n(s.selected),
    strong: true,
    tone: () => C.green,
  },
  {
    label: "   of which onboarding profile submitted",
    get: (s) => n(s.profileSubmitted),
  },
  { label: "Rejected", get: (s) => n(s.rejected) },
  { label: "No-show", get: (s) => n(s.noShow) },
  { label: "Walk-out", get: (s) => n(s.walkout) },
  { label: "Client round pending", get: (s) => n(s.clientRound) },
  { label: "Hold", get: (s) => n(s.hold) },
  {
    label: "Other closed (form filed, other status)",
    get: (s) => n(s.otherClosed),
  },
  {
    label: "Closure pending (open)",
    get: (s) => n(s.open),
    strong: true,
    tone: (s) => (s.open > 0 ? C.red : C.green),
  },
  { label: "   waiting for call", get: (s) => n(s.openWaiting) },
  { label: "   called — interview pending", get: (s) => n(s.openCalled) },
  { label: "   in interview", get: (s) => n(s.openInInterview) },
  {
    label: "   queue marked completed, no interview outcome",
    get: (s) => n(s.openQueueCompleted),
    tone: (s) => (s.openQueueCompleted > 0 ? C.red : C.green),
  },
  {
    label: "All outcomes together (= tokens generated)",
    get: (s) =>
      n(
        s.selected +
          s.rejected +
          s.noShow +
          s.walkout +
          s.clientRound +
          s.hold +
          s.otherClosed +
          s.open,
      ),
    strong: true,
  },
  { label: "Token closure %", get: (s) => pct(s.closurePct) },
  {
    label: "Selection % (of interviewed)",
    get: (s) => pct(s.selectionPct),
    strong: true,
  },
  { label: "Yield % (selected ÷ walk-ins)", get: (s) => pct(s.yieldPct) },
];

const BRANCH_LABELS = [
  "Walk-ins",
  "Tokens generated",
  "Token closed",
  "Interview updates filed (any token day)",
  "Selected",
  "Rejected",
  "No-show",
  "Closure pending (open)",
  "Selection % (of interviewed)",
];
const BRANCH_LINES: MetricLine[] = [
  ...METRIC_LINES.filter((m) => BRANCH_LABELS.includes(m.label)),
  {
    label: "SLA-1 met (token → call)",
    get: (s) => (s.sla1.reliable ? pct(s.sla1.pct) : "n/a"),
  },
  {
    label: "SLA-2 met (call → closure)",
    get: (s) => (s.sla2.reliable ? pct(s.sla2.pct) : "n/a"),
  },
];

function periodTable(
  ftd: Summary,
  wtd: Summary,
  mtd: Summary,
  d: ReportData,
  lines: MetricLine[] = METRIC_LINES,
): string {
  const rows = lines
    .map(
      (m, i) => `<tr>
    ${td(m.label, { align: "left", bold: m.strong, bg: zebra(i) })}
    ${[ftd, wtd, mtd].map((s) => td(m.get(s), { bold: m.strong, color: m.tone?.(s), bg: zebra(i) })).join("")}</tr>`,
    )
    .join("");
  return dataTable(
    `<tr>${th("Metric", "left")}${th("Today")}${th(`Week · from ${d.weekStart.slice(5)}`)}${th(`Month · from ${d.monthStart.slice(5)}`)}</tr>${rows}`,
  );
}

// ── Funnel (stacked: today, then month) ──────────────────────────────────────────────────

/** [label, count, index of the step its % is measured against]. Closed is a share of tokens: no-shows close without a call. */
function funnelStages(s: Summary): Array<[string, number, number]> {
  return [
    ["Walk-in", s.walkins, -1],
    ["Token generated", s.tokens, 0],
    ["Interview called", s.called, 1],
    ["Token closed", s.closed, 1],
    ["Interviewed", s.interviewed, 3],
    ["Selected", s.selected, 4],
    ["Joined", s.joined, 5],
  ];
}

function funnelRow(
  [label, v, parent]: [string, number, number],
  i: number,
  stages: Array<[string, number, number]>,
): string {
  const top = Math.max(1, stages[0][1]);
  const w = Math.min(100, Math.max(v > 0 ? 3 : 0, Math.round((v / top) * 100)));
  const prev = parent < 0 ? null : stages[parent][1];
  const conv = prev ? `${Math.round((v / prev) * 100)}%` : "";
  const shade = i === 5 ? C.green : i === 6 ? C.teal : C.navy2;
  const bar =
    w > 0
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="${w}%" bgcolor="${shade}" height="16" style="font-size:1px;line-height:16px">&nbsp;</td><td style="font-size:1px">&nbsp;</td></tr></table>`
      : "&nbsp;";
  return `<tr>
    <td width="120" style="padding:4px 0;font-size:12px;color:${C.ink}">${esc(label)}</td>
    <td style="padding:4px 8px">${bar}</td>
    <td width="42" align="right" style="padding:4px 0;font-size:12.5px;font-weight:700;color:${C.ink}">${n(v)}</td>
    <td width="40" align="right" style="padding:4px 0 4px 6px;font-size:11px;color:${C.muted}">${conv}</td></tr>`;
}

function funnelBlock(title: string, s: Summary): string {
  const stages = funnelStages(s);
  const side = `Rejected ${n(s.rejected)} · No-show ${n(s.noShow)} · Walk-out ${n(s.walkout)} · Hold/Client ${n(s.hold + s.clientRound)} · Open ${n(s.open)}`;
  return `<div style="font-size:12.5px;font-weight:800;color:${C.navy};margin:0 0 4px">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${stages.map((st, i) => funnelRow(st, i, stages)).join("")}</table>
    <div style="font-size:11px;color:${C.muted};margin:4px 0 16px">${esc(side)}</div>`;
}

// ── SLA scorecard ────────────────────────────────────────────────────────────────────────

function slaBlock(
  title: string,
  target: string,
  get: (s: Summary) => SlaStat,
  d: ReportData,
): string {
  const periods = [d.overall.ftd, d.overall.wtd, d.overall.mtd];
  const row = (label: string, cell: (x: SlaStat) => string, i: number) =>
    `<tr>${td(label, { align: "left", bg: zebra(i) })}${periods.map((s) => td(cell(get(s)), { raw: true, bg: zebra(i) })).join("")}</tr>`;
  const head = `<tr><td colspan="4" bgcolor="${C.navy}" style="padding:8px 8px;font-size:12px;font-weight:700;color:#FFFFFF">${esc(title)} <span style="color:#CBD5E1;font-weight:400">· target ${esc(target)}</span></td></tr>
    <tr>${th("", "left")}${th("Today")}${th("Week")}${th("Month")}</tr>`;
  return dataTable(
    head +
      row("Met", (x) => slaPill(x), 0) +
      row("Average", (x) => fmtMin(x.avgMin), 1) +
      row("Slowest 10% (P90)", (x) => fmtMin(x.p90Min), 2) +
      row(
        "Breaches",
        (x) =>
          `<b style="color:${x.breached ? C.red : C.green}">${n(x.breached)}</b>`,
        3,
      ) +
      row(
        "Data coverage",
        (x) =>
          `<span style="color:${x.reliable ? C.muted : C.amber}">${x.measured}/${x.population} · ${x.coveragePct}%</span>`,
        4,
      ),
  );
}

function slaSection(d: ReportData): string {
  const gap = `<div style="height:12px;line-height:12px;font-size:1px">&nbsp;</div>`;
  const body = `${slaBlock("SLA 1 · Waiting → Interview call", `≤ ${SLA.waitToCallMin}m from token`, (s) => s.sla1, d)}${gap}
    ${slaBlock("SLA 2 · Interview call → Token closure", `≤ ${fmtMin(SLA.callToClosureMin)} from call`, (s) => s.sla2, d)}
    <div style="font-size:11px;color:${C.muted};margin-top:8px;line-height:1.5">Met = met ÷ (met + breached). Open tokens already past their SLA count as breached; open tokens still inside SLA are left out until they resolve. Data coverage = tokens carrying the timestamps the SLA needs, out of those that could; below ${SLA.minCoveragePct}% the figure shows n/a rather than describing a small, self-selected slice.</div>`;
  return section(
    "SLA scorecard",
    "Two service levels across the walk-in journey",
    body,
  );
}

// ── Recruiter table ──────────────────────────────────────────────────────────────────────

function recruiterRow(r: RecruiterRow, i: number): string {
  const bg = zebra(i);
  const open =
    r.openNow > 0
      ? `<b style="color:${C.red}">${r.openNow}</b><br>${muted(fmtMin(r.worstOpenMin))}`
      : `<span style="color:${C.green}">0</span>`;
  const filed = r.ftd.formsFromEarlier
    ? `${n(r.ftd.formsSubmitted)}<br>${muted(`${n(r.ftd.formsFromEarlier)} old`)}`
    : n(r.ftd.formsSubmitted);
  const times = `${fmtMin(r.ftd.sla1.avgMin)}<br>${muted(fmtMin(r.ftd.sla2.avgMin))}`;
  const c = (
    t: string,
    o: { bold?: boolean; color?: string; raw?: boolean } = {},
  ) => td(t, { ...o, bg, size: 11.5 });
  return `<tr>
    ${td(esc(r.recruiter), { align: "left", bold: true, raw: true, bg, size: 11.5 })}
    ${c(n(r.ftd.tokens))}${c(n(r.ftd.closed))}${c(filed, { raw: true })}
    ${c(n(r.ftd.selected), { bold: true, color: C.green })}${c(n(r.ftd.rejected))}${c(n(r.ftd.noShow))}
    ${c(open, { raw: true })}${c(times, { raw: true })}
    ${c(slaPill(r.ftd.sla1), { raw: true })}${c(slaPill(r.ftd.sla2), { raw: true })}
    ${c(n(r.mtd.tokens))}${c(pct(r.mtd.selectionPct))}</tr>`;
}

function recruiterTable(b: BranchBlock): string {
  if (!b.recruiters.length) return "";
  const active = b.recruiters.filter(
    (r) => r.ftd.tokens > 0 || r.openNow > 0 || r.ftd.formsSubmitted > 0,
  );
  const idle = b.recruiters.length - active.length;
  const heads = [
    "Tkn",
    "Closed",
    "Filed",
    "Sel",
    "Rej",
    "NS",
    "Open",
    "Wait / Handle",
    "SLA-1",
    "SLA-2",
    "Mth Tkn",
    "Mth Sel%",
  ]
    .map((h) => th(h))
    .join("");
  const note = `Today's figures except the last two columns. Tkn = tokens issued · Filed = interview update forms filed today (old = for earlier days' tokens) · NS = no-show · Open = closure pending (oldest) · Wait / Handle = average token→call, then call→closure · Mth = month to date.${idle > 0 ? ` ${idle} recruiter${idle > 1 ? "s" : ""} with no activity today not shown.` : ""}`;
  return `${dataTable(`<tr>${th("Recruiter", "left")}${heads}</tr>${active.map(recruiterRow).join("")}`)}
  <div style="font-size:10.5px;color:${C.muted};margin-top:6px;line-height:1.5">${esc(note)}</div>`;
}

function branchPanel(b: BranchBlock, d: ReportData): string {
  const quiet = b.ftd.walkins === 0 && b.ftd.tokens === 0;
  const stat = quiet
    ? "No walk-ins today"
    : `Today · ${n(b.ftd.walkins)} walk-ins · ${n(b.ftd.selected)} selected · ${n(b.ftd.open)} open`;
  const oldest = b.escalations[0];
  const alert = oldest
    ? `<div style="margin-top:12px;padding:10px 12px;background:${C.redBg};font-size:12px;color:${C.red}"><b>${b.escalations.length} token${b.escalations.length > 1 ? "s" : ""} past SLA</b> — oldest: ${esc(oldest.tokenNumber)} · ${esc(oldest.recruiter)} · ${fmtMin(oldest.runningMin)}</div>`
    : "";
  return `<tr><td style="padding:22px 24px 0 24px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td bgcolor="${C.navy}" style="padding:10px 14px;font-size:14px;font-weight:800;color:#FFFFFF">${esc(b.branch)}</td>
      <td bgcolor="${C.navy}" align="right" style="padding:10px 14px;font-size:11px;color:#CBD5E1">${esc(stat)}</td></tr></table>
    <div style="border:1px solid ${C.line};border-top:0;padding:14px">${periodTable(b.ftd, b.wtd, b.mtd, d, BRANCH_LINES)}${alert}
      <div style="font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:${C.muted};font-weight:700;margin:16px 0 6px">Recruiter-wise activity</div>${recruiterTable(b)}</div></td></tr>`;
}

// ── Footer ───────────────────────────────────────────────────────────────────────────────

function notesFooter(d: ReportData): string {
  const q = d.dataQuality;
  const flags = [
    q.closedWithoutCallTime
      ? `${q.closedWithoutCallTime} MTD token(s) closed with no interview-call time recorded (excluded from SLA-1/2)`
      : "",
    q.negativeDurations
      ? `${q.negativeDurations} token(s) had a call/closure time earlier than arrival (excluded from SLA averages)`
      : "",
    q.measuredHandle >= 20 && q.instantClosures / q.measuredHandle > 0.5
      ? `${q.instantClosures} of ${q.measuredHandle} MTD closures were stamped within 1 minute of the call — SLA-2 here likely reflects bulk closure, not interview time`
      : "",
    q.completedWithoutOutcome
      ? `${q.completedWithoutOutcome} MTD token(s) were marked completed in the queue with no interview form while the candidate is still Arrived / Waiting — counted as OPEN, not closed`
      : "",
    q.staleOpenTokens
      ? `${q.staleOpenTokens} open token(s) older than 7 days are excluded from escalations — close or mark them no-show`
      : "",
  ].filter(Boolean);
  const li = (t: string) => `<li style="margin:3px 0">${esc(t)}</li>`;
  return `<tr><td style="padding:26px 24px 8px 24px">
    <div style="border-top:1px solid ${C.line};padding-top:14px;font-size:11px;color:${C.muted};line-height:1.55">
      <b style="color:${C.ink}">How the numbers are calculated</b>
      <ul style="margin:6px 0 10px 16px;padding:0">
        ${li("Walk-in = distinct candidate issued a queue token in the period (candidate interview registration → token). Token = queue token issued. Called = a call time exists. Closed = recruiter submitted the interview form (or the token was completed / no-show).")}
        ${li("Interviewed = Closed − No-show − Walk-out. Selection % = Selected ÷ Interviewed. Yield % = Selected ÷ Walk-ins. Closure % = Closed ÷ Tokens. Walk-in to Closed follow the day the token was issued; “Interview updates filed” follows the day the form was filed, so a recruiter who closes earlier days’ tokens today is credited today.")}
        ${li("Selected = cleared selection, including the post-selection statuses HR approved, Offer approved and Profile submitted (the selected candidate has filled the online onboarding profile: personal details, bank, documents).")}
        ${li("Rejected = not selected in a round. No-show = token issued, candidate never came for the interview. Walk-out = left before the interview finished.")}
        ${li("Client round pending = cleared the internal rounds, waiting for the client's interview. Hold = kept on hold / callback / follow-up. Other closed = interview form filed with a status that is none of these.")}
        ${li("Closure pending (open) = token with no interview form and no final status. A queue token marked Completed while the candidate is still Arrived / Waiting is counted here, not as closed.")}
        ${li(`SLA-1 = token → interview call (target ${SLA.waitToCallMin}m). SLA-2 = interview call → token closure (target ${fmtMin(SLA.callToClosureMin)}). Escalation: L1 stage SLA breached → recruiter + reporting manager; L2 open ≥ ${fmtMin(SLA.sameDayEscalateMin)} since arrival → branch head; L3 still open after the day of arrival → HR head.`)}
        ${li(`Today = ${d.reportDate}. Week = Mon ${d.weekStart} → ${d.reportDate}. Month = ${d.monthStart} → ${d.reportDate}. MAS candidates only (legacy employee rows and IDC records excluded).`)}
      </ul>
      ${flags.length ? `<b style="color:${C.amber}">Data notes</b><ul style="margin:6px 0 0 16px;padding:0">${flags.map(li).join("")}</ul>` : ""}
    </div></td></tr>`;
}

// ── Public ───────────────────────────────────────────────────────────────────────────────

export interface RenderMeta {
  generatedAt: string;
  dashboardUrl?: string;
  dateLabel: string;
  /** Set for a single-branch email. */ branchLabel?: string;
}

export function subjectLine(d: ReportData, branchLabel?: string): string {
  const { ftd } = d.overall;
  return `[Recruitment Activity${branchLabel ? ` · ${branchLabel}` : ""}] ${d.reportDate} | ${ftd.walkins} walk-ins · ${ftd.selected} selected · ${d.escalations.length} escalation${d.escalations.length === 1 ? "" : "s"}`;
}

function header(meta: RenderMeta): string {
  const title = meta.branchLabel
    ? `${esc(meta.branchLabel)} — Daily Recruitment Activity`
    : "Branch Activity — Daily Report";
  return `<tr><td bgcolor="${C.navy}" style="background:${C.navy};background-image:linear-gradient(135deg,${C.navy} 0%,${C.navy2} 100%);padding:28px 24px 24px 24px">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};font-weight:700">MAS Callnet · PeopleOS · Recruitment</div>
    <div style="font-size:24px;font-weight:800;color:#FFFFFF;margin-top:6px;line-height:1.25">${title}</div>
    <div style="font-size:12.5px;color:#CBD5E1;margin-top:6px;line-height:1.5">${esc(meta.dateLabel)} &nbsp;·&nbsp; Today · Week · Month &nbsp;·&nbsp; Generated ${esc(meta.generatedAt)}</div>
    <div style="height:3px;width:64px;background:${C.gold};margin-top:16px;line-height:3px;font-size:1px">&nbsp;</div></td></tr>`;
}

function branchSections(d: ReportData, single: boolean): string {
  if (single)
    return d.branches
      .map((b) =>
        section(
          "Recruiter-wise activity",
          "Today, with month-to-date tokens and selection %",
          recruiterTable(b),
          C.navy2,
        ),
      )
      .join("");
  return (
    section(
      "Branch-wise activity",
      "Each branch with its recruiter-wise breakdown",
      "",
      C.navy2,
    ) + d.branches.map((b) => branchPanel(b, d)).join("")
  );
}

export function renderEmail(d: ReportData, meta: RenderMeta): string {
  const { ftd, wtd, mtd } = d.overall;
  const single = !!meta.branchLabel;
  const funnel = `${funnelBlock("Today", ftd)}${funnelBlock("Month to date", mtd)}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subjectLine(d, meta.branchLabel))}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}"><tr><td align="center" style="padding:20px 8px">
<table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="width:100%;max-width:${MAX_W}px;background:#FFFFFF;border:1px solid ${C.line}">
  ${header(meta)}
  ${kpiStrip(d)}
  ${escalationSection(d, !single)}
  ${section("Performance summary", single ? "Today, week-to-date and month-to-date" : "All branches · today, week-to-date and month-to-date", periodTable(ftd, wtd, mtd, d))}
  ${section("Recruitment funnel", "Walk-in to joining · bar = share of walk-ins · % = share of its parent step (Called and Closed are shares of tokens)", funnel)}
  ${slaSection(d)}
  ${branchSections(d, single)}
  ${notesFooter(d)}
  <tr><td align="center" style="padding:14px 24px 22px 24px;font-size:11px;color:${C.muted}">
    ${meta.dashboardUrl ? `<a href="${esc(meta.dashboardUrl)}" style="color:${C.blue};text-decoration:none;font-weight:700">Open ATS Command Centre →</a><br>` : ""}
    MAS Callnet PeopleOS — automated report. Do not reply.</td></tr>
</table></td></tr></table></body></html>`;
}
