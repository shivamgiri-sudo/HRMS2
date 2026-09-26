/**
 * Branch Health Report — mail-safe HTML email renderer.
 *
 * Layout: nested tables, inline styles, bgcolor attributes. No flexbox or CSS Grid.
 * Width: 900px (max-width) for maximum data density.
 */
import type { BranchHealthReport } from "./metrics.js";

const C = {
  primary: "#1e3a5f",
  accent: "#2563eb",
  success: "#16a34a",
  warn: "#d97706",
  danger: "#dc2626",
  bg: "#f1f5f9",
  card: "#ffffff",
  muted: "#64748b",
  border: "#e2e8f0",
  headerBg: "#0f2744",
  headerText: "#ffffff",
  tHead: "#f8fafc",
};

const FONT = "font-family:Arial,Helvetica,sans-serif;";

export function esc(s: string | number | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function statusBadge(status: string): string {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    submitted: { bg: "#dbeafe", text: "#1d4ed8", label: "Submitted" },
    branch_head_approved: {
      bg: "#fef9c3",
      text: "#854d0e",
      label: "Br. Approved",
    },
    accounts_head_approved: {
      bg: "#fef9c3",
      text: "#854d0e",
      label: "Accts. Approved",
    },
    approved: { bg: "#dcfce7", text: "#166534", label: "Approved" },
    finance_head_approved: {
      bg: "#dcfce7",
      text: "#166534",
      label: "Fin. Approved",
    },
    pending_accounts_payment: {
      bg: "#ede9fe",
      text: "#5b21b6",
      label: "Pending Payment",
    },
    payment_scheduled: { bg: "#dbeafe", text: "#1d4ed8", label: "Scheduled" },
    partially_paid: { bg: "#dcfce7", text: "#166534", label: "Part Paid" },
    paid: { bg: "#d1fae5", text: "#064e3b", label: "Paid" },
    returned_to_raiser: { bg: "#fee2e2", text: "#991b1b", label: "Returned" },
    returned_to_branch_head: {
      bg: "#fee2e2",
      text: "#991b1b",
      label: "Returned",
    },
  };
  const s = map[status] ?? {
    bg: "#f1f5f9",
    text: "#475569",
    label: esc(status),
  };
  return `<span style="display:inline-block;padding:1px 5px;border-radius:4px;background:${s.bg};color:${s.text};${FONT}font-size:10px;font-weight:600;white-space:nowrap;">${s.label}</span>`;
}

function overallBadge(status: BranchHealthReport["overallStatus"]): string {
  const map = {
    healthy: { bg: C.success, label: "● HEALTHY" },
    watch: { bg: C.warn, label: "● WATCH" },
    critical: { bg: C.danger, label: "● CRITICAL" },
  };
  const s = map[status];
  return `<span style="display:inline-block;padding:4px 14px;border-radius:14px;background:${s.bg};color:#fff;${FONT}font-size:13px;font-weight:700;letter-spacing:0.5px;">${s.label}</span>`;
}

function sectionHeader(title: string): string {
  return `<tr><td colspan="99" style="padding:10px 0 4px 0;">
    <p style="margin:0;${FONT}font-size:11px;font-weight:700;letter-spacing:1.2px;color:${C.muted};text-transform:uppercase;">${esc(title)}</p>
  </td></tr>`;
}

function card(body: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;background:${C.card};margin-bottom:0;">
    <tr><td style="padding:8px 12px;">${body}</td></tr>
  </table>`;
}

function kpiCell(
  label: string,
  value: string,
  color?: string,
  subtext?: string,
): string {
  return `<td style="padding:6px 10px;text-align:center;border-right:1px solid ${C.border};">
    <div style="${FONT}font-size:19px;font-weight:700;color:${color ?? C.primary};line-height:1;">${esc(value)}</div>
    <div style="${FONT}font-size:10px;color:${C.muted};margin-top:3px;">${esc(label)}</div>
    ${subtext ? `<div style="${FONT}font-size:10px;color:${C.muted};margin-top:2px;">${esc(subtext)}</div>` : ""}
  </td>`;
}

function kpiStrip(
  cells: { label: string; value: string; color?: string; subtext?: string }[],
): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr>${cells.map((c) => kpiCell(c.label, c.value, c.color, c.subtext)).join("")}</tr>
  </table>`;
}

const CONSECUTIVE_ABSENCE_DAYS_LABEL = 3;

function note(text: string, warn = false): string {
  return `<p style="${FONT}font-size:10px;color:${warn ? C.warn : C.muted};margin:4px 0 0 0;">${text}</p>`;
}

/** Two cards next to each other (stacks are not needed: the report is a fixed 900px table). */
function sideBySide(left: string, right: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="50%" valign="top" style="padding-right:6px;">${left}</td>
    <td width="50%" valign="top" style="padding-left:6px;">${right}</td>
  </tr></table>`;
}

function dataTable(
  headers: string[],
  rows: (string | { raw: string })[][],
  compact = false,
): string {
  if (!rows.length)
    return `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">None</p>`;
  const pad = compact ? "3px 6px" : "6px 10px";
  const th = headers
    .map(
      (h) =>
        `<th style="padding:${pad};background:${C.tHead};${FONT}font-size:11px;font-weight:700;color:${C.muted};text-align:left;border-bottom:2px solid ${C.border};white-space:nowrap;">${esc(h)}</th>`,
    )
    .join("");
  const body = rows
    .map(
      (row, ri) =>
        `<tr style="background:${ri % 2 === 0 ? C.card : "#f8fafc"};">${row
          .map((cell) => {
            const isRaw = typeof cell === "object" && "raw" in cell;
            const content = isRaw ? cell.raw : esc(cell as string);
            return `<td style="padding:${pad};border-bottom:1px solid ${C.border};${FONT}font-size:11px;color:${C.primary};">${content}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${th}${body}</table>`;
}

export function renderEmail(
  report: BranchHealthReport,
  opts: { generatedAt: string; dashboardUrl?: string },
): string {
  const {
    branch,
    reportDate,
    raw,
    criticalPoints,
    positiveAchievements,
    overallStatus,
  } = report;

  const dateLabel = (() => {
    const d = new Date(`${reportDate}T00:00:00Z`);
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  })();

  // ── 1. Budget ──
  const budgetPctColor =
    raw.budget.utilizationPct >= 95
      ? C.danger
      : raw.budget.utilizationPct >= 80
        ? C.warn
        : C.success;
  const hasBudget = raw.budget.totalBudget > 0;
  const budgetBody = hasBudget
    ? kpiStrip([
        {
          label: "Total Budget",
          value: inr(raw.budget.totalBudget),
          color: C.primary,
          subtext: raw.budget.periodCode ?? undefined,
        },
        {
          label: "Consumed",
          value: inr(raw.budget.consumed),
          color: budgetPctColor,
        },
        { label: "Reserved", value: inr(raw.budget.reserved), color: C.muted },
        {
          label: "Available",
          value: inr(raw.budget.available),
          color: raw.budget.available === 0 ? C.danger : C.success,
        },
        {
          label: "Utilization",
          value: `${raw.budget.utilizationPct}%`,
          color: budgetPctColor,
        },
      ]) +
      note(
        "Budget basis: P&amp;L cost (ex-GST on input-credit lines), approved branch budget for the month.",
      )
    : `<p style="${FONT}font-size:12px;color:${C.muted};margin:0;">No budget found for ${raw.budget.periodCode ?? reportDate.slice(0, 7)}</p>`;

  // ── 1b. Budget by head ──
  const bh = raw.budgetByHead;
  const budgetHeadBody =
    bh.top.length > 0
      ? dataTable(
          ["Top heads by spend", "Budget", "Consumed + Reserved", "Used"],
          bh.top.map((h) => [
            h.head,
            inr(h.budget),
            inr(h.charged),
            {
              raw: `<span style="color:${h.pct >= 100 ? C.danger : h.pct >= 80 ? C.warn : C.success};font-weight:700;">${h.pct}%</span>`,
            },
          ]),
          true,
        ) +
        (bh.overBudget.length > 0
          ? note(
              `⚠ Over budget: ${bh.overBudget.map((h) => `${esc(h.head)} (${h.pct}%)`).join(", ")}`,
              true,
            )
          : "")
      : "";

  // ── 2. GRN summary + tie-out to the budget ──
  const g = raw.grnStats;
  const br = g.bridge;
  const tieRow = (
    label: string,
    value: number,
    strong = false,
    hint = "",
  ): (string | { raw: string })[] => [
    {
      raw: `${strong ? "<strong>" : ""}${esc(label)}${strong ? "</strong>" : ""}${hint ? ` <span style="color:${C.muted};">${esc(hint)}</span>` : ""}`,
    },
    {
      raw: `<div style="text-align:right;">${strong ? "<strong>" : ""}${inr(value)}${strong ? "</strong>" : ""}</div>`,
    },
  ];
  const tieRows = [
    tieRow(
      "GRNs raised this month, ex-GST",
      br.raisedExGst,
      true,
      `(₹ incl. GST: ${inr(g.totalRaisedAmount)})`,
    ),
    tieRow("− awaiting approval, not reserved yet", br.awaitingApproval),
    tieRow("− charged to an earlier month's budget", br.earlierBudget),
    tieRow("− unbudgeted: raised without a budget line", br.noBudgetLine),
    tieRow("= charged to this month's budget", br.chargedThisMonth, true),
    tieRow(
      "+ raised in earlier months, charged to this month",
      br.fromEarlierMonths,
    ),
    tieRow(
      "= Consumed + Reserved in Section 1",
      br.budgetChargeTotal,
      true,
      "✓ ties",
    ),
  ];
  const staleNote =
    g.pending > 0
      ? `Open GRNs: ${g.pending} awaiting approval, oldest ${g.oldestPendingDays} day${g.oldestPendingDays === 1 ? "" : "s"}${g.pendingOver3Days > 0 ? `, ${g.pendingOver3Days} older than 3 days` : ""}.`
      : "No GRNs awaiting approval.";
  const typeTotals = g.byType.reduce(
    (x, r) => ({
      raised: x.raised + r.raised,
      incl: x.incl + r.raisedInclGst,
      ex: x.ex + r.raisedExGst,
      approved: x.approved + r.approved,
      pending: x.pending + r.pending,
      pendingInclGst: x.pendingInclGst + r.pendingInclGst,
    }),
    { raised: 0, incl: 0, ex: 0, approved: 0, pending: 0, pendingInclGst: 0 },
  );
  const typeTable =
    g.byType.length > 0
      ? dataTable(
          ["GRN type", "Raised (MTD)", "Value incl. GST", "Value ex-GST", "Approved (MTD)", "Open pending (all-time)", "Pending value incl. GST"],
          [
            ...g.byType.map((r) => [r.label, String(r.raised), inr(r.raisedInclGst), inr(r.raisedExGst), String(r.approved), String(r.pending), inr(r.pendingInclGst)]),
            [
              { raw: "<strong>Total</strong>" },
              { raw: `<strong>${typeTotals.raised}</strong>` },
              { raw: `<strong>${inr(typeTotals.incl)}</strong>` },
              { raw: `<strong>${inr(typeTotals.ex)}</strong>` },
              { raw: `<strong>${typeTotals.approved}</strong>` },
              { raw: `<strong>${typeTotals.pending}</strong>` },
              { raw: `<strong>${inr(typeTotals.pendingInclGst)}</strong>` },
            ],
          ],
          true,
        )
      : "";
  const stageTotals = g.pendingByStage.reduce(
    (x, r) => ({ count: x.count + r.count, amt: x.amt + r.amountInclGst }),
    { count: 0, amt: 0 },
  );
  const stageTable =
    g.pendingByStage.length > 0
      ? dataTable(
          ["Pending GRNs — by stage (who acts next)", "GRNs", "Value incl. GST", "Oldest"],
          [
            ...g.pendingByStage.map((r) => [r.stage, String(r.count), inr(r.amountInclGst), `${r.oldestDays}d`]),
            [
              { raw: "<strong>Total open pending</strong>" },
              { raw: `<strong>${stageTotals.count}</strong>` },
              { raw: `<strong>${inr(stageTotals.amt)}</strong>` },
              "",
            ],
          ],
          true,
        )
      : "";

  const grnStatsBody =
    kpiStrip([
      { label: "Raised (MTD)", value: String(g.raised), color: C.primary },
      { label: "Approved", value: String(g.approved), color: C.success },
      {
        label: "Open — Pending Approval",
        value: String(g.pending),
        color: g.pending >= 5 ? C.warn : g.pending > 0 ? C.accent : C.primary,
        subtext: g.pending > 0 ? `oldest ${g.oldestPendingDays}d` : undefined,
      },
      {
        label: "Value incl. GST (MTD)",
        value: inr(g.totalRaisedAmount),
        color: C.primary,
      },
      {
        label: "Value ex-GST (MTD)",
        value: inr(br.raisedExGst),
        color: C.primary,
      },
    ]) +
    dataTable(["Tie-out to Section 1 (ex-GST)", "Amount"], tieRows, true) +
    `<div style="height:8px;line-height:8px;font-size:1px">&nbsp;</div>` +
    typeTable +
    `<div style="height:8px;line-height:8px;font-size:1px">&nbsp;</div>` +
    stageTable +
    note(
      `${staleNote} Excludes draft, cancelled and rejected GRNs; HRMS-raised only.`,
    );

  // ── 2b. Unbudgeted GRNs ──
  const ub = raw.grnStats.unbudgeted;
  const unbudgetedBody =
    ub.count > 0
      ? dataTable(
          [
            `Unbudgeted GRNs — ${ub.count} raised without a budget line (${inr(ub.amountExGst)} ex-GST)`,
            "Head › Sub-head",
            "Ex-GST",
            "Status",
            "Raised",
          ],
          ub.rows.map((r) => [
            r.grnNumber ?? "—",
            r.head,
            inr(r.amountExGst),
            { raw: statusBadge(r.status) },
            r.raisedOn,
          ]),
          true,
        ) +
        note(
          "A Head/Sub-head with no approved budget line can be raised against the cost centre, and Finance Head can approve it without linking a budget line (linking is optional). The cost still lands in the P&L in full, but no budget line covers it — this list is how such spend is spotted.",
        )
      : note(
          "✓ No unbudgeted GRNs: every HRMS-raised GRN sits on a budget line.",
        );

  // ── 3. Recent GRNs ──
  const grnTableBody = dataTable(
    ["GRN # / Vendor", "Head › Sub-Head", "Amount", "Raised", "Status"],
    raw.recentGrns.map((r) => [
      [r.grnNumber, r.vendorName].filter(Boolean).join(" · ") || "—",
      [r.head, r.subHead].filter(Boolean).join(" › ") || "—",
      inr(r.amount),
      r.raisedOn,
      { raw: statusBadge(r.status) },
    ]),
    true,
  );

  // ── 4. ATS (same definitions as the Recruitment Activity email) ──
  const slaPct =
    raw.ats.slaTotal > 0
      ? `${Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)}%`
      : "—";
  const selectionPct =
    raw.ats.walkins > 0
      ? `${Math.round((raw.ats.selected / raw.ats.walkins) * 100)}%`
      : "—";
  const atsBody =
    kpiStrip([
      { label: "Walk-ins", value: String(raw.ats.walkins), color: C.primary },
      { label: "Tokens", value: String(raw.ats.tokens), color: C.accent },
      { label: "Closed", value: String(raw.ats.tokensClosed), color: C.muted },
      {
        label: "Selected",
        value: String(raw.ats.selected),
        color: C.success,
        subtext: selectionPct,
      },
      { label: "Rejected", value: String(raw.ats.rejected), color: C.danger },
      { label: "No-show", value: String(raw.ats.noShow), color: C.muted },
      {
        label: "No interview feedback",
        value: String(raw.ats.noFeedback),
        color: raw.ats.noFeedback > 0 ? C.danger : C.success,
        subtext: "no form filed",
      },
      {
        label: "Client round / Hold",
        value: `${raw.ats.clientRound} / ${raw.ats.hold}`,
        color: C.accent,
      },
      {
        label: "Closure pending",
        value: String(raw.ats.open),
        color: raw.ats.open > 0 ? C.danger : C.success,
        subtext:
          raw.ats.openQueueCompleted > 0
            ? `${raw.ats.openQueueCompleted} queue-done, no outcome`
            : undefined,
      },
      {
        label: "SLA-1 breach %",
        value: slaPct,
        color: raw.ats.slaBreaches > 0 ? C.warn : C.success,
        subtext: "call within 20 min",
      },
    ]) +
    note(
      "Same token definitions as the Recruitment Activity email. A token marked completed in the queue with no interview form while the candidate is still Waiting counts as closure pending, not closed.",
    );

  // ── 5. Attendance: shrinkage + late arrivals, one row per process, shifts grouped in bands ──
  const sh = raw.shrinkage;
  const shrinkageColor =
    sh.shrinkagePct >= 20
      ? C.danger
      : sh.shrinkagePct >= 10
        ? C.warn
        : C.success;
  const lateColor =
    raw.lateStats.totalLate >= 15
      ? C.danger
      : raw.lateStats.totalLate >= 5
        ? C.warn
        : C.primary;
  const prev =
    raw.prevShrinkage && raw.prevShrinkage.scheduled > 0
      ? raw.prevShrinkage
      : null;
  const BANDS = ["Morning", "Afternoon", "Evening", "Night"] as const;
  const BAND_HINT: Record<(typeof BANDS)[number], string> = {
    Morning: "starts before 12:00",
    Afternoon: "12:00–16:59",
    Evening: "17:00–20:59",
    Night: "21:00 onward",
  };
  const bandOf = (shift: string): (typeof BANDS)[number] => {
    const hour = Number.parseInt(shift.slice(0, 2), 10);
    if (!Number.isFinite(hour)) return "Morning";
    return hour < 12
      ? "Morning"
      : hour < 17
        ? "Afternoon"
        : hour < 21
          ? "Evening"
          : "Night";
  };
  const processNames = [
    ...new Set([
      ...sh.bySlot.map((x) => x.process),
      ...raw.lateStats.byManager.map((m) => m.process),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const bandCell = (slots: typeof sh.bySlot, band: (typeof BANDS)[number]) => {
    const inBand = slots.filter((x) => bandOf(x.shift) === band);
    if (inBand.length === 0)
      return { raw: `<span style="color:${C.muted};">—</span>` };
    const planned = inBand.reduce((n, x) => n + x.planned, 0);
    const absent = inBand.reduce((n, x) => n + x.absent, 0);
    const late = inBand.reduce((n, x) => n + x.late, 0);
    const detail = [
      absent > 0
        ? `<span style="color:${C.warn};">${absent} absent</span>`
        : "",
      late > 0 ? `<span style="color:${C.danger};">${late} late</span>` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      raw: `<strong>${planned}</strong>${detail ? `<br><span style="font-size:10px;">${detail}</span>` : ""}`,
    };
  };
  const attendanceRows = processNames.map((name) => {
    const slots = sh.bySlot.filter((x) => x.process === name);
    const planned = slots.reduce((n, x) => n + x.planned, 0);
    const present = slots.reduce((n, x) => n + x.present, 0);
    const absent = slots.reduce((n, x) => n + x.absent, 0);
    const late = raw.lateStats.byManager
      .filter((m) => m.process === name)
      .reduce((n, m) => n + m.count, 0);
    // Late-marked people who have no planned shift today (no roster row, week-off worked, on leave)
    // still count in the late headline, so they get their own column instead of vanishing.
    const noRosterLate = Math.max(
      0,
      late - slots.reduce((n, x) => n + x.late, 0),
    );
    const managers = raw.lateStats.byManager
      .filter((m) => m.process === name)
      .map((m) => `${esc(m.manager)} (${m.count})`)
      .join(", ");
    return [
      { raw: `<strong>${esc(name)}</strong>` },
      String(planned),
      String(present),
      {
        raw:
          absent > 0
            ? `<span style="color:${C.warn};font-weight:700;">${absent}</span>`
            : "0",
      },
      planned > 0 ? `${Math.round((absent / planned) * 100)}%` : "—",
      {
        raw:
          late > 0
            ? `<span style="color:${C.danger};font-weight:700;">${late}</span>`
            : "0",
      },
      ...BANDS.map((b) => bandCell(slots, b)),
      {
        raw:
          noRosterLate > 0
            ? `<span style="color:${C.danger};font-size:10px;">${noRosterLate} late</span>`
            : `<span style="color:${C.muted};">—</span>`,
      },
      { raw: managers || `<span style="color:${C.muted};">—</span>` },
    ];
  });
  // Exact shift timings, all processes together, split into two columns to keep it short.
  const slotTotals = new Map<
    string,
    { planned: number; absent: number; late: number }
  >();
  for (const x of sh.bySlot) {
    const cur = slotTotals.get(x.shift) ?? { planned: 0, absent: 0, late: 0 };
    slotTotals.set(x.shift, {
      planned: cur.planned + x.planned,
      absent: cur.absent + x.absent,
      late: cur.late + x.late,
    });
  }
  const slotRows = [...slotTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([shift, v]) => [
      shift,
      String(v.planned),
      String(v.absent),
      String(v.late),
    ]);
  const lateOffRoster = Math.max(
    0,
    raw.lateStats.totalLate - sh.bySlot.reduce((n, x) => n + x.late, 0),
  );
  if (lateOffRoster > 0)
    slotRows.push(["Not on today's roster", "0", "0", String(lateOffRoster)]);
  const half = Math.ceil(slotRows.length / 2);
  const slotHeaders = ["Shift", "Planned", "Absent", "Late"];
  const slotTable =
    slotRows.length > 0
      ? sideBySide(
          dataTable(slotHeaders, slotRows.slice(0, half), true),
          slotRows.length > half
            ? dataTable(slotHeaders, slotRows.slice(half), true)
            : "",
        )
      : "";
  const attendanceBody =
    kpiStrip([
      { label: "Scheduled", value: String(sh.scheduled), color: C.primary },
      { label: "Present", value: String(sh.present), color: C.success },
      {
        label: "Absent",
        value: String(sh.absent),
        color: sh.absent > 0 ? C.warn : C.success,
      },
      { label: "On Leave", value: String(sh.onLeave), color: C.muted },
      { label: "Yet to Start", value: String(sh.yetToStart), color: C.muted },
      {
        label: "Shrinkage %",
        value: `${sh.shrinkagePct}%`,
        color: shrinkageColor,
        subtext: prev ? `yesterday ${prev.shrinkagePct}%` : undefined,
      },
      {
        label: "Late Arrivals",
        value: String(raw.lateStats.totalLate),
        color: lateColor,
      },
    ]) +
    (attendanceRows.length
      ? dataTable(
          [
            "Process",
            "Planned",
            "Present",
            "Absent",
            "Shrink",
            "Late",
            ...BANDS,
            "Not on roster",
            "Late by reporting manager (count)",
          ],
          attendanceRows,
          true,
        ) +
        note(
          `Shift bands (by shift start): ${BANDS.map((b) => `${b} ${BAND_HINT[b]}`).join(" · ")}. Each band shows planned, with absent and late underneath; "Not on roster" counts late-marked people with no planned shift today, so late adds up to the headline.`,
        ) +
        `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:8px 0 3px 0;letter-spacing:1px;">SHIFT-WISE, ALL PROCESSES</p>` +
        slotTable
      : "") +
    (sh.rosterBased
      ? note(
          "Shrinkage = no punch ÷ planned on today's uploaded roster, counting only shifts already started; week-offs, leave and yet-to-start shifts are excluded. Late = punched in after the shift grace period.",
        )
      : note(
          "⚠ No roster uploaded for this branch today — shrinkage cannot be calculated.",
          true,
        ));

  // ── 6. Headcount (process-wise) | Pending actions with age ──
  const hc = raw.headcount;
  const netMtd = hc.joinedMtd - hc.leftMtd;
  const openingHc = hc.totalActive + hc.leftMtd - hc.joinedMtd;
  const avgHc = (openingHc + hc.totalActive) / 2;
  const attritionMtd = avgHc > 0 ? (hc.leftMtd / avgHc) * 100 : null;
  const namesLine = (label: string, names: string[], color: string) =>
    names.length
      ? `<div style="${FONT}font-size:11px;color:${C.primary};margin-top:3px;"><strong style="color:${color};">${label}</strong> ${names.slice(0, 8).map(esc).join(", ")}${names.length > 8 ? ` +${names.length - 8} more` : ""}</div>`
      : "";
  const hcTotals = hc.byProcess.reduce(
    (a, r) => ({
      active: a.active + r.active,
      joinedToday: a.joinedToday + r.joinedToday,
      joinedMtd: a.joinedMtd + r.joinedMtd,
      leftToday: a.leftToday + r.leftToday,
      leftMtd: a.leftMtd + r.leftMtd,
    }),
    { active: 0, joinedToday: 0, joinedMtd: 0, leftToday: 0, leftMtd: 0 },
  );
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const mandatedActive = hc.byProcess
    .filter((r) => r.mandateSeats != null)
    .reduce((n, r) => n + r.active, 0);
  const mandateGapCell = (gap: number, hasMandate: boolean, strong: boolean): string => {
    if (!hasMandate) return "—";
    const text = `${gap > 0 ? "+" : ""}${gap}`;
    const html = `<span style="color:${gap < 0 ? C.danger : C.success};font-weight:700;">${text}</span>`;
    return strong ? `<strong>${html}</strong>` : html;
  };
  const hcProcessRows = [
    ...hc.byProcess.map((r) => [
      r.process,
      String(r.active),
      String(r.joinedToday),
      String(r.joinedMtd),
      String(r.leftToday),
      String(r.leftMtd),
      {
        raw: `<span style="color:${r.joinedMtd - r.leftMtd < 0 ? C.danger : C.success};font-weight:700;">${signed(r.joinedMtd - r.leftMtd)}</span>`,
      },
      r.mandateSeats == null ? "—" : String(r.mandateSeats),
      { raw: mandateGapCell(r.active - (r.mandateSeats ?? 0), r.mandateSeats != null, false) },
    ]),
    [
      { raw: "<strong>Total</strong>" },
      { raw: `<strong>${hcTotals.active}</strong>` },
      { raw: `<strong>${hcTotals.joinedToday}</strong>` },
      { raw: `<strong>${hcTotals.joinedMtd}</strong>` },
      { raw: `<strong>${hcTotals.leftToday}</strong>` },
      { raw: `<strong>${hcTotals.leftMtd}</strong>` },
      {
        raw: `<strong>${signed(hcTotals.joinedMtd - hcTotals.leftMtd)}</strong>`,
      },
      { raw: `<strong>${hc.mandateSeatsTotal ?? "—"}</strong>` },
      {
        raw: mandateGapCell(mandatedActive - (hc.mandateSeatsTotal ?? 0), hc.mandateSeatsTotal != null, true),
      },
    ],
  ];
  const hcBody =
    kpiStrip([
      {
        label: "Active Headcount",
        value: String(hc.totalActive),
        color: C.primary,
      },
      {
        label: "Joined Today",
        value: String(hc.joinedToday),
        color: C.success,
        subtext: `MTD ${hc.joinedMtd}`,
      },
      {
        label: "Left Today",
        value: String(hc.leftToday),
        color: hc.leftToday > 0 ? C.warn : C.muted,
        subtext: `MTD ${hc.leftMtd}`,
      },
      {
        label: "Net MTD",
        value: signed(netMtd),
        color: netMtd < 0 ? C.danger : C.success,
      },
      {
        label: "Exits past LWD, still active",
        value: String(hc.exitsNotClosed),
        color: hc.exitsNotClosed > 0 ? C.warn : C.muted,
        subtext: "record not closed",
      },
      {
        label: "Attrition MTD",
        value: attritionMtd != null ? `${attritionMtd.toFixed(1)}%` : "—",
        color: attritionMtd != null && attritionMtd >= 5 ? C.danger : C.primary,
        subtext: `${hc.upcomingExits} exit${hc.upcomingExits === 1 ? "" : "s"} due in 30d`,
      },
    ]) +
    dataTable(
      [
        "Process",
        "Active",
        "Joined today",
        "Joined MTD",
        "Left today",
        "Left MTD",
        "Net MTD",
        "Mandate seats",
        "Active vs mandate",
      ],
      hcProcessRows,
      true,
    ) +
    note(
      "Mandate seats = the process's mandated headcount at this branch (workforce mandate in force today). Active vs mandate = active headcount minus mandate; negative = short of the mandate. The total covers only processes that have a mandate.",
    ) +
    namesLine("Joined today:", hc.joinedNames, C.success) +
    namesLine("Left today:", hc.leftNames, C.warn) +
    note(
      "Joined = date of joining; left = last working day on the employee record or a running exit request. Attrition MTD = left ÷ average of opening and closing headcount.",
    );

  const ageText = (b: {
    oldestDays: number;
    over3Days: number;
    over7Days: number;
  }) =>
    b.over7Days > 0
      ? `oldest ${b.oldestDays}d · ${b.over7Days} over 7d`
      : b.over3Days > 0
        ? `oldest ${b.oldestDays}d · ${b.over3Days} over 3d`
        : `oldest ${b.oldestDays}d`;
  const pendingRows: (string | { raw: string })[][] = [];
  if (raw.grnStats.pending > 0)
    pendingRows.push([
      "GRNs awaiting approval",
      String(raw.grnStats.pending),
      `oldest ${raw.grnStats.oldestPendingDays}d · ${raw.grnStats.pendingOver3Days} over 3d`,
    ]);
  if (raw.leaveAging.pending > 0 || raw.leaveAging.staleOlderThanWindow > 0)
    pendingRows.push([
      "Leave requests pending",
      String(raw.leaveAging.pending),
      `${ageText(raw.leaveAging)}${raw.leaveAging.staleOlderThanWindow > 0 ? ` · +${raw.leaveAging.staleOlderThanWindow} stale (>90d)` : ""}`,
    ]);
  if (raw.regularization.pending > 0)
    pendingRows.push([
      "Attendance regularizations pending",
      String(raw.regularization.pending),
      `${ageText(raw.regularization)}${raw.regularization.escalated > 0 ? ` · ${raw.regularization.escalated} escalated` : ""}`,
    ]);
  for (const a of raw.pendingActions.filter((x) => x.type === "exit_pending"))
    pendingRows.push([a.label, String(a.count), "—"]);
  const actionsBody =
    pendingRows.length > 0
      ? dataTable(["Pending action", "Count", "Age"], pendingRows, true)
      : `<p style="${FONT}font-size:12px;color:${C.success};margin:0;">✓ No pending actions</p>`;
  const movementBody = sideBySide(
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">HEADCOUNT MOVEMENT — PROCESS-WISE</p>${hcBody}`,
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">PENDING ACTIONS</p>${actionsBody}`,
  );

  // ── 6b. People follow-ups: consecutive absence, offer-to-join ──
  const off = raw.offers;
  const abs = raw.absence;
  const followUpBody =
    kpiStrip([
      {
        label: "Offers due to join (30d)",
        value: String(off.offered),
        color: C.primary,
      },
      { label: "Joined (30d)", value: String(off.joined), color: C.success },
      {
        label: "Not joined (30d)",
        value: String(off.notJoined),
        color: off.notJoined > 0 ? C.warn : C.muted,
      },
      {
        label: "Offer → Join (30d)",
        value: off.conversionPct != null ? `${off.conversionPct}%` : "—",
        color:
          off.conversionPct != null && off.conversionPct < 70
            ? C.danger
            : C.success,
      },
      {
        label: "Joining next 7 days",
        value: String(off.joiningNext7Days),
        color: C.accent,
      },
    ]) +
    kpiStrip([
      {
        label: "Offers due to join (MTD)",
        value: String(off.mtd.offered),
        color: C.primary,
      },
      { label: "Joined (MTD)", value: String(off.mtd.joined), color: C.success },
      {
        label: "Not joined (MTD)",
        value: String(off.mtd.notJoined),
        color: off.mtd.notJoined > 0 ? C.warn : C.muted,
      },
      {
        label: "Offer → Join (MTD)",
        value: off.mtd.conversionPct != null ? `${off.mtd.conversionPct}%` : "—",
        color:
          off.mtd.conversionPct != null && off.mtd.conversionPct < 70
            ? C.danger
            : C.success,
      },
      {
        label: `Absent ${CONSECUTIVE_ABSENCE_DAYS_LABEL}+ days running`,
        value: String(abs.total),
        color: abs.total > 0 ? C.danger : C.success,
      },
    ]) +
    (abs.rows.length > 0
      ? dataTable(
          ["Employee", "Process", "Reporting manager"],
          abs.rows.map((r) => [
            `${r.name}${r.code ? ` (${r.code})` : ""}`,
            r.process,
            r.manager,
          ]),
          true,
        ) +
        (abs.total > abs.rows.length
          ? note(`+ ${abs.total - abs.rows.length} more employees not listed.`)
          : "")
      : note(
          `✓ Nobody has been absent for ${CONSECUTIVE_ABSENCE_DAYS_LABEL} rostered working days in a row.`,
        )) +
    note(
      "Offer → Join: approved offers whose joining date fell in the last 30 days (top strip) or in the month so far (second strip), and how many of those candidates now exist as employees. Absence = rostered working day with no punch and no approved leave, on the last 3 completed days.",
    );

  // ── 7. Open hiring: batches whose delivery date is still ahead ──
  const hiring = raw.openHiring;
  const priorityColor = (pr: string) =>
    pr === "urgent" ? C.danger : pr === "high" ? C.warn : C.muted;
  const hiringBody =
    hiring.upcomingRequisitions > 0
      ? kpiStrip([
          {
            label: "Upcoming Batches",
            value: String(hiring.upcomingRequisitions),
            color: C.primary,
          },
          {
            label: "Open Positions",
            value: String(hiring.openPositions),
            color: C.warn,
            subtext: `${hiring.fulfilled} of ${hiring.requested} filled`,
          },
          {
            label: "In Pipeline",
            value: String(hiring.inPipeline),
            color: C.accent,
          },
          {
            label: "Selected",
            value: String(hiring.selected),
            color: C.success,
          },
        ]) +
        dataTable(
          [
            "Requisition",
            "Designation / Process",
            "Priority",
            "Req.",
            "Filled",
            "Open",
            "Pipeline",
            "Selected",
            "Delivery date",
          ],
          hiring.rows.map((r) => [
            r.code,
            `${r.designation} · ${r.process}`,
            {
              raw: `<span style="color:${priorityColor(r.priority)};font-weight:700;">${esc(r.priority)}</span>`,
            },
            String(r.requested),
            String(r.fulfilled),
            String(r.openPositions),
            String(r.inPipeline),
            String(r.selected),
            {
              raw: `${esc(r.deliveryDate)} <span style="color:${r.daysToDelivery <= 3 ? C.danger : C.muted};">(${r.daysToDelivery === 0 ? "today" : `in ${r.daysToDelivery}d`})</span>`,
            },
          ]),
          true,
        )
      : `<p style="${FONT}font-size:12px;color:${C.muted};margin:0;">No batches with an upcoming delivery date.</p>`;
  const hiringNote = note(
    `Source: Job Requisition page — approved requisitions still short of headcount whose delivery (target joining) date is ahead. Open = requested − filled.${
      hiring.pastDeliveryRequisitions > 0
        ? ` Not listed: ${hiring.pastDeliveryRequisitions} older requisition${hiring.pastDeliveryRequisitions > 1 ? "s" : ""} past their delivery date with ${hiring.pastDeliveryOpenPositions} positions still open.`
        : ""
    }${hiring.pendingApproval > 0 ? ` ${hiring.pendingApproval} awaiting approval.` : ""}`,
  );

  // ── 8. Running P&L — the Live P&L engine ──
  const pnl = raw.runningPnl;
  const opColor = pnl.operatingProfit < 0 ? C.danger : C.success;
  const pnlGrn = pnl.grnConsumed + pnl.grnReserved;
  const grnOutsideBudget = pnlGrn - br.budgetChargeTotal;
  const pnlBody = pnl.dataAvailable
    ? kpiStrip([
        {
          label: "Running Revenue",
          value: inr(pnl.revenueRunning),
          color: C.primary,
          subtext: `${pnl.daysElapsed}/${pnl.daysInMonth} days`,
        },
        {
          label: "Running Salary",
          value: inr(pnl.salaryRunning),
          color: C.accent,
          subtext: `${pnl.staffPaid} of ${raw.headcount.totalActive} staff`,
        },
        {
          label: "GRN Consumed",
          value: inr(pnl.grnConsumed),
          color: C.warn,
          subtext: "ex-GST",
        },
        {
          label: "GRN Reserved",
          value: inr(pnl.grnReserved),
          color: C.muted,
          subtext: "ex-GST",
        },
        {
          label: "Operating Profit",
          value: inr(pnl.operatingProfit),
          color: opColor,
        },
        {
          label: "OP %",
          value: pnl.opPct != null ? `${pnl.opPct.toFixed(1)}%` : "—",
          color: opColor,
        },
      ]) +
      dataTable(
        ["Revenue build-up", "Amount", "Cost build-up", "Amount"],
        [
          [
            "Invoiced",
            inr(pnl.revenueInvoice),
            "Salary (payroll to date)",
            inr(pnl.salaryRunning),
          ],
          [
            "Accrued / provisioned",
            inr(pnl.revenueAccrual),
            "GRN consumed + reserved (ex-GST)",
            inr(pnlGrn),
          ],
          [
            `Seat-rate estimate to date (${pnl.estimatedCostCentres} of ${pnl.costCentres} cost centres)`,
            inr(pnl.revenueEstimated),
            "Total running cost",
            inr(pnl.totalCostRunning),
          ],
          [
            "− Credit notes",
            inr(pnl.creditNote),
            "Running operating profit",
            inr(pnl.operatingProfit),
          ],
        ],
        true,
      ) +
      note(
        `OP = running revenue − running salary − GRN (consumed + reserved, ex-GST) — the P&amp;L page's Live view (${esc(pnl.mode || "live")}). Revenue uses invoice or accrual where it exists, otherwise seat rate × seats to date. GRN here is booked by accounting period and includes bills held in the legacy billing system, so it is ${grnOutsideBudget >= 0 ? "higher" : "lower"} than the budget charge of ${inr(br.budgetChargeTotal)} in Section 1 by ${inr(Math.abs(grnOutsideBudget))}.`,
      ) +
      (pnl.staffPaid < raw.headcount.totalActive
        ? note(
            `⚠ Salary covers ${pnl.staffPaid} of ${raw.headcount.totalActive} active staff — operating profit is overstated by the rest.`,
            true,
          )
        : "")
    : `<p style="${FONT}font-size:12px;color:${C.muted};margin:0;">No P&amp;L data available for ${pnl.periodCode || reportDate.slice(0, 7)}</p>`;

  // ── 8b. Why the P&L GRN differs from the budget ──
  const tie = raw.pnlGrnTieOut;
  const consumedParts =
    tie.budgetConsumed +
    tie.hrmsNoBudgetLine +
    tie.hrmsOrdinary +
    tie.legacyBilling;
  const consumedGap = pnl.grnConsumed - consumedParts;
  const reservedGap =
    pnl.grnReserved - (tie.budgetReserved - tie.imprestReservedNoCostCentre);
  const right = (n: number) => ({
    raw: `<div style="text-align:right;">${inr(n)}</div>`,
  });
  const pnlTieBody = pnl.dataAvailable
    ? dataTable(
        ["GRN in the P&L vs the budget (ex-GST)", "Amount"],
        [
          [
            { raw: "<strong>GRN consumed in P&amp;L</strong>" },
            {
              raw: `<div style="text-align:right;"><strong>${inr(pnl.grnConsumed)}</strong></div>`,
            },
          ],
          [
            "   HRMS GRNs on a budget line = Consumed in Section 1",
            right(tie.budgetConsumed),
          ],
          [
            "   + HRMS GRNs booked with no budget line (system backfill)",
            right(tie.hrmsNoBudgetLine),
          ],
          ["   + HRMS GRNs without allocation rows", right(tie.hrmsOrdinary)],
          [
            "   + bills held in the legacy billing system (db_bill)",
            right(tie.legacyBilling),
          ],
          ...(Math.abs(consumedGap) >= 1
            ? [["   + other / rounding", right(consumedGap)]]
            : []),
          [
            { raw: "<strong>GRN reserved in P&amp;L</strong>" },
            {
              raw: `<div style="text-align:right;"><strong>${inr(pnl.grnReserved)}</strong></div>`,
            },
          ],
          ["   Reserved in Section 1", right(tie.budgetReserved)],
          [
            "   − imprest reservations (no cost centre, so the P&L cannot read them)",
            right(-tie.imprestReservedNoCostCentre),
          ],
          ...(Math.abs(reservedGap) >= 1
            ? [["   + other / rounding", right(reservedGap)]]
            : []),
        ],
        true,
      )
    : "";

  // ── 9. Signals, side by side ──
  const signalRow = (
    label: string,
    detail: string,
    tone: "critical" | "warning" | "good",
  ): string => {
    const color =
      tone === "critical" ? C.danger : tone === "warning" ? C.warn : C.success;
    const bg =
      tone === "critical"
        ? "#fff1f2"
        : tone === "warning"
          ? "#fffbeb"
          : "#f0fdf4";
    const mark = tone === "critical" ? "🔴" : tone === "warning" ? "⚠️" : "✓";
    return `<tr><td style="padding:6px 10px;background:${bg};border-left:4px solid ${color};border-bottom:1px solid ${C.border};">
      <span style="${FONT}font-size:12px;font-weight:700;color:${color};">${mark} ${esc(label)}</span><br>
      <span style="${FONT}font-size:11px;color:${C.muted};">${esc(detail)}</span></td></tr>`;
  };
  const criticalHtml = criticalPoints.length
    ? criticalPoints
        .map((c) =>
          signalRow(
            c.label,
            c.detail,
            c.severity === "critical" ? "critical" : "warning",
          ),
        )
        .join("")
    : `<tr><td style="padding:8px 10px;background:#f0fdf4;border-left:4px solid ${C.success};${FONT}font-size:12px;color:${C.success};font-weight:600;">✓ No critical points identified today</td></tr>`;
  const positiveHtml = positiveAchievements.length
    ? positiveAchievements
        .map((a) => signalRow(a.label, a.detail, "good"))
        .join("")
    : `<tr><td style="padding:8px 10px;${FONT}font-size:12px;color:${C.muted};">No highlights today</td></tr>`;
  const signalsBody = sideBySide(
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">CRITICAL INTERVENTION POINTS</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};">${criticalHtml}</table>`,
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">POSITIVE ACHIEVEMENTS</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};">${positiveHtml}</table>`,
  );

  const rows = [
    sectionHeader(
      `1. Budget vs Consumption — ${raw.budget.periodCode ?? reportDate.slice(0, 7)}`,
    ),
    `<tr><td>${card(budgetBody + budgetHeadBody)}</td></tr>`,
    sectionHeader("2. GRN Summary — Month-to-Date, tied to the budget"),
    `<tr><td>${card(grnStatsBody + unbudgetedBody)}</td></tr>`,
    sectionHeader("3. Recent GRNs (Latest 15, excluding drafts)"),
    `<tr><td>${card(grnTableBody)}</td></tr>`,
    sectionHeader("4. ATS — Today's Recruitment Activity"),
    `<tr><td>${card(atsBody)}</td></tr>`,
    sectionHeader("5. Attendance Today — Shrinkage & Late Arrivals by Process"),
    `<tr><td>${card(attendanceBody)}</td></tr>`,
    sectionHeader("6. Headcount by Process & Pending Actions"),
    `<tr><td>${card(movementBody)}</td></tr>`,
    sectionHeader("7. People Follow-ups — Offer-to-Join & Consecutive Absence"),
    `<tr><td>${card(followUpBody)}</td></tr>`,
    sectionHeader("8. Open Hiring — Upcoming Batches (Job Requisitions)"),
    `<tr><td>${card(hiringBody + hiringNote)}</td></tr>`,
    sectionHeader("9. Running P&L — Month-to-Date"),
    `<tr><td>${card(pnlBody + pnlTieBody)}</td></tr>`,
    sectionHeader("10. Critical Intervention Points & Positive Achievements"),
    `<tr><td>${signalsBody}</td></tr>`,
  ].join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.bg};${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.bg}">
<tr><td align="center" style="padding:20px 12px;">
<table width="900" cellpadding="0" cellspacing="0" style="max-width:900px;width:100%;">

  <!-- Header -->
  <tr><td bgcolor="${C.headerBg}" style="padding:24px 28px;border-radius:10px 10px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="${FONT}font-size:22px;font-weight:700;color:${C.headerText};margin:0 0 2px 0;">MAS Callnet PeopleOS</p>
          <p style="${FONT}font-size:16px;font-weight:600;color:#93c5fd;margin:0 0 4px 0;">Branch Health Report — ${esc(branch)}</p>
          <p style="${FONT}font-size:12px;color:#64748b;margin:0;">${esc(dateLabel)}</p>
        </td>
        <td align="right" valign="top" style="padding-top:4px;">
          ${overallBadge(overallStatus)}
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td bgcolor="${C.card}" style="padding:20px 28px;border:1px solid ${C.border};border-top:none;">
    <table width="100%" cellpadding="0" cellspacing="0">
      ${rows}
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td bgcolor="${C.bg}" style="padding:12px 28px;border-radius:0 0 10px 10px;border:1px solid ${C.border};border-top:none;">
    <p style="${FONT}font-size:11px;color:${C.muted};margin:0;">
      Generated ${esc(opts.generatedAt)} IST${opts.dashboardUrl ? ` &nbsp;·&nbsp; <a href="${esc(opts.dashboardUrl)}" style="color:${C.accent};text-decoration:none;">Open Dashboard →</a>` : ""}
      &nbsp;·&nbsp; MAS Callnet PeopleOS &nbsp;·&nbsp; This report is auto-generated and confidential.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function subjectLine(report: BranchHealthReport): string {
  const statusTag = {
    healthy: "✅ Healthy",
    watch: "⚠️ Watch",
    critical: "🔴 Critical",
  }[report.overallStatus];
  const d = new Date(`${report.reportDate}T00:00:00Z`);
  const label = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `[${statusTag}] Branch Health Report — ${report.branch} — ${label}`;
}
