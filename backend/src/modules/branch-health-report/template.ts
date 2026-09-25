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
        { label: "Total Budget", value: inr(raw.budget.totalBudget), color: C.primary, subtext: raw.budget.periodCode ?? undefined },
        { label: "Consumed", value: inr(raw.budget.consumed), color: budgetPctColor },
        { label: "Reserved", value: inr(raw.budget.reserved), color: C.muted },
        { label: "Available", value: inr(raw.budget.available), color: raw.budget.available === 0 ? C.danger : C.success },
        { label: "Utilization", value: `${raw.budget.utilizationPct}%`, color: budgetPctColor },
      ]) + note("Budget basis: P&amp;L cost (ex-GST on input-credit lines), approved branch budget for the month.")
    : `<p style="${FONT}font-size:12px;color:${C.muted};margin:0;">No budget found for ${raw.budget.periodCode ?? reportDate.slice(0, 7)}</p>`;

  // ── 2. GRN summary + tie-out to the budget ──
  const g = raw.grnStats;
  const br = g.bridge;
  const tieRow = (label: string, value: number, strong = false, hint = ""): (string | { raw: string })[] => [
    { raw: `${strong ? "<strong>" : ""}${esc(label)}${strong ? "</strong>" : ""}${hint ? ` <span style="color:${C.muted};">${esc(hint)}</span>` : ""}` },
    { raw: `<div style="text-align:right;">${strong ? "<strong>" : ""}${inr(value)}${strong ? "</strong>" : ""}</div>` },
  ];
  const tieRows = [
    tieRow("GRNs raised this month, ex-GST", br.raisedExGst, true, `(₹ incl. GST: ${inr(g.totalRaisedAmount)})`),
    tieRow("− awaiting approval, not reserved yet", br.awaitingApproval),
    tieRow("− charged to an earlier month's budget", br.earlierBudget),
    tieRow("− no budget line (e.g. paid reimbursements)", br.noBudgetLine),
    tieRow("= charged to this month's budget", br.chargedThisMonth, true),
    tieRow("+ raised in earlier months, charged to this month", br.fromEarlierMonths),
    tieRow("= Consumed + Reserved in Section 1", br.budgetChargeTotal, true, "✓ ties"),
  ];
  const staleNote =
    g.pending > 0
      ? `Open GRNs: ${g.pending} awaiting approval, oldest ${g.oldestPendingDays} day${g.oldestPendingDays === 1 ? "" : "s"}${g.pendingOver3Days > 0 ? `, ${g.pendingOver3Days} older than 3 days` : ""}.`
      : "No GRNs awaiting approval.";
  const grnStatsBody =
    kpiStrip([
      { label: "Raised (MTD)", value: String(g.raised), color: C.primary },
      { label: "Approved", value: String(g.approved), color: C.success },
      { label: "Open — Pending Approval", value: String(g.pending), color: g.pending >= 5 ? C.warn : g.pending > 0 ? C.accent : C.primary, subtext: g.pending > 0 ? `oldest ${g.oldestPendingDays}d` : undefined },
      { label: "Value incl. GST (MTD)", value: inr(g.totalRaisedAmount), color: C.primary },
      { label: "Value ex-GST (MTD)", value: inr(br.raisedExGst), color: C.primary },
    ]) +
    dataTable(["Tie-out to Section 1 (ex-GST)", "Amount"], tieRows, true) +
    note(`${staleNote} Excludes draft, cancelled and rejected GRNs; HRMS-raised only.`);

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

  // ── 4. ATS ──
  const slaPct = raw.ats.slaTotal > 0 ? `${Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)}%` : "—";
  const selectionPct = raw.ats.walkins > 0 ? `${Math.round((raw.ats.selected / raw.ats.walkins) * 100)}%` : "—";
  const atsBody = kpiStrip([
    { label: "Walk-ins", value: String(raw.ats.walkins), color: C.primary },
    { label: "Tokens Created", value: String(raw.ats.tokens), color: C.accent },
    { label: "Tokens Closed", value: String(raw.ats.tokensClosed), color: C.muted },
    { label: "Selected", value: String(raw.ats.selected), color: C.success, subtext: selectionPct },
    { label: "Rejected", value: String(raw.ats.rejected), color: C.danger },
    { label: "No Show", value: String(raw.ats.noShow), color: C.muted },
    { label: "SLA Breach %", value: slaPct, color: raw.ats.slaBreaches > 0 ? C.warn : C.success },
  ]);

  // ── 5. Attendance: shrinkage + late arrivals, one row per process ──
  const sh = raw.shrinkage;
  const shrinkageColor = sh.shrinkagePct >= 20 ? C.danger : sh.shrinkagePct >= 10 ? C.warn : C.success;
  const lateColor = raw.lateStats.totalLate >= 15 ? C.danger : raw.lateStats.totalLate >= 5 ? C.warn : C.primary;
  const prev = raw.prevShrinkage && raw.prevShrinkage.scheduled > 0 ? raw.prevShrinkage : null;
  const processNames = [
    ...new Set([...sh.bySlot.map((s) => s.process), ...raw.lateStats.byManager.map((m) => m.process)]),
  ].sort((a, b) => a.localeCompare(b));
  const attendanceRows = processNames.map((name) => {
    const slots = sh.bySlot.filter((s) => s.process === name);
    const planned = slots.reduce((n, s) => n + s.planned, 0);
    const present = slots.reduce((n, s) => n + s.present, 0);
    const absent = slots.reduce((n, s) => n + s.absent, 0);
    const late = raw.lateStats.byManager.filter((m) => m.process === name).reduce((n, m) => n + m.count, 0);
    const slotText = slots
      .map((s) => `${esc(s.shift)}: ${s.planned}/${s.absent}${s.late ? `/<span style="color:${C.danger};">${s.late}L</span>` : ""}`)
      .join(" · ");
    const managers = raw.lateStats.byManager
      .filter((m) => m.process === name)
      .map((m) => `${esc(m.manager)} ${m.count}`)
      .join(", ");
    return [
      { raw: `<strong>${esc(name)}</strong>` },
      String(planned),
      String(present),
      { raw: absent > 0 ? `<span style="color:${C.warn};font-weight:700;">${absent}</span>` : "0" },
      planned > 0 ? `${Math.round((absent / planned) * 100)}%` : "—",
      { raw: late > 0 ? `<span style="color:${C.danger};font-weight:700;">${late}</span>` : "0" },
      { raw: `<span style="color:${C.muted};">${slotText || "—"}</span>` },
      { raw: managers ? managers : `<span style="color:${C.muted};">—</span>` },
    ];
  });
  const attendanceBody =
    kpiStrip([
      { label: "Scheduled", value: String(sh.scheduled), color: C.primary },
      { label: "Present", value: String(sh.present), color: C.success },
      { label: "Absent", value: String(sh.absent), color: sh.absent > 0 ? C.warn : C.success },
      { label: "On Leave", value: String(sh.onLeave), color: C.muted },
      { label: "Yet to Start", value: String(sh.yetToStart), color: C.muted },
      { label: "Shrinkage %", value: `${sh.shrinkagePct}%`, color: shrinkageColor, subtext: prev ? `yesterday ${prev.shrinkagePct}%` : undefined },
      { label: "Late Arrivals", value: String(raw.lateStats.totalLate), color: lateColor },
    ]) +
    (attendanceRows.length
      ? dataTable(
          ["Process", "Planned", "Present", "Absent", "Shrink", "Late", "Shift slots (planned/absent/late)", "Late by reporting manager"],
          attendanceRows,
          true,
        )
      : "") +
    (sh.rosterBased
      ? note("Shrinkage = no punch ÷ planned on today's uploaded roster, counting only shifts already started; week-offs, leave and yet-to-start shifts are excluded. Late = punched in after the shift grace period.")
      : note("⚠ No roster uploaded for this branch today — shrinkage cannot be calculated.", true));

  // ── 6. Headcount | Pending actions (side by side) ──
  const hc = raw.headcount;
  const namesLine = (label: string, names: string[], color: string) =>
    names.length
      ? `<div style="${FONT}font-size:11px;color:${C.primary};margin-top:3px;"><strong style="color:${color};">${label}</strong> ${names.slice(0, 5).map(esc).join(", ")}${names.length > 5 ? ` +${names.length - 5} more` : ""}</div>`
      : "";
  const hcBody =
    kpiStrip([
      { label: "Active Headcount", value: String(hc.totalActive), color: C.primary },
      { label: "Joined Today", value: String(hc.joinedToday), color: C.success, subtext: `MTD ${hc.joinedMtd}` },
      { label: "Left Today", value: String(hc.leftToday), color: hc.leftToday > 0 ? C.warn : C.muted, subtext: `MTD ${hc.leftMtd}` },
    ]) +
    (hc.byProcess.length
      ? dataTable(["Process", "Joined", "Left"], hc.byProcess.map((r) => [r.process, String(r.joined), String(r.left)]), true)
      : note("No movement today.")) +
    namesLine("Joined:", hc.joinedNames, C.success) +
    namesLine("Left:", hc.leftNames, C.warn);
  const actionsBody = raw.pendingActions.length
    ? dataTable(["Pending Action", "Count"], raw.pendingActions.map((a) => [a.label, String(a.count)]), true)
    : `<p style="${FONT}font-size:12px;color:${C.success};margin:0;">✓ No pending actions</p>`;
  const movementBody = sideBySide(
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">HEADCOUNT MOVEMENT</p>${hcBody}`,
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">PENDING ACTIONS</p>${actionsBody}`,
  );

  // ── 7. Open hiring: batches whose delivery date is still ahead ──
  const hiring = raw.openHiring;
  const priorityColor = (pr: string) => (pr === "urgent" ? C.danger : pr === "high" ? C.warn : C.muted);
  const hiringBody =
    hiring.upcomingRequisitions > 0
      ? kpiStrip([
          { label: "Upcoming Batches", value: String(hiring.upcomingRequisitions), color: C.primary },
          { label: "Open Positions", value: String(hiring.openPositions), color: C.warn, subtext: `${hiring.fulfilled} of ${hiring.requested} filled` },
          { label: "In Pipeline", value: String(hiring.inPipeline), color: C.accent },
          { label: "Selected", value: String(hiring.selected), color: C.success },
        ]) +
        dataTable(
          ["Requisition", "Designation / Process", "Priority", "Req.", "Filled", "Open", "Pipeline", "Selected", "Delivery date"],
          hiring.rows.map((r) => [
            r.code,
            `${r.designation} · ${r.process}`,
            { raw: `<span style="color:${priorityColor(r.priority)};font-weight:700;">${esc(r.priority)}</span>` },
            String(r.requested),
            String(r.fulfilled),
            String(r.openPositions),
            String(r.inPipeline),
            String(r.selected),
            { raw: `${esc(r.deliveryDate)} <span style="color:${r.daysToDelivery <= 3 ? C.danger : C.muted};">(${r.daysToDelivery === 0 ? "today" : `in ${r.daysToDelivery}d`})</span>` },
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
        { label: "Running Revenue", value: inr(pnl.revenueRunning), color: C.primary, subtext: `${pnl.daysElapsed}/${pnl.daysInMonth} days` },
        { label: "Running Salary", value: inr(pnl.salaryRunning), color: C.accent, subtext: `${pnl.staffPaid} of ${raw.headcount.totalActive} staff` },
        { label: "GRN Consumed", value: inr(pnl.grnConsumed), color: C.warn, subtext: "ex-GST" },
        { label: "GRN Reserved", value: inr(pnl.grnReserved), color: C.muted, subtext: "ex-GST" },
        { label: "Operating Profit", value: inr(pnl.operatingProfit), color: opColor },
        { label: "OP %", value: pnl.opPct != null ? `${pnl.opPct.toFixed(1)}%` : "—", color: opColor },
      ]) +
      dataTable(
        ["Revenue build-up", "Amount", "Cost build-up", "Amount"],
        [[
          "Invoiced",
          inr(pnl.revenueInvoice),
          "Salary (payroll to date)",
          inr(pnl.salaryRunning),
        ], [
          "Accrued / provisioned",
          inr(pnl.revenueAccrual),
          "GRN consumed + reserved (ex-GST)",
          inr(pnlGrn),
        ], [
          `Seat-rate estimate to date (${pnl.estimatedCostCentres} of ${pnl.costCentres} cost centres)`,
          inr(pnl.revenueEstimated),
          "Total running cost",
          inr(pnl.totalCostRunning),
        ], [
          "− Credit notes",
          inr(pnl.creditNote),
          "Running operating profit",
          inr(pnl.operatingProfit),
        ]],
        true,
      ) +
      note(`OP = running revenue − running salary − GRN (consumed + reserved, ex-GST) — the P&amp;L page's Live view (${esc(pnl.mode || "live")}). Revenue uses invoice or accrual where it exists, otherwise seat rate × seats to date. GRN here is booked by accounting period and includes bills held in the legacy billing system, so it is ${grnOutsideBudget >= 0 ? "higher" : "lower"} than the budget charge of ${inr(br.budgetChargeTotal)} in Section 1 by ${inr(Math.abs(grnOutsideBudget))}.`) +
      (pnl.staffPaid < raw.headcount.totalActive
        ? note(`⚠ Salary covers ${pnl.staffPaid} of ${raw.headcount.totalActive} active staff — operating profit is overstated by the rest.`, true)
        : "")
    : `<p style="${FONT}font-size:12px;color:${C.muted};margin:0;">No P&amp;L data available for ${pnl.periodCode || reportDate.slice(0, 7)}</p>`;

  // ── 9. Signals, side by side ──
  const signalRow = (label: string, detail: string, tone: "critical" | "warning" | "good"): string => {
    const color = tone === "critical" ? C.danger : tone === "warning" ? C.warn : C.success;
    const bg = tone === "critical" ? "#fff1f2" : tone === "warning" ? "#fffbeb" : "#f0fdf4";
    const mark = tone === "critical" ? "🔴" : tone === "warning" ? "⚠️" : "✓";
    return `<tr><td style="padding:6px 10px;background:${bg};border-left:4px solid ${color};border-bottom:1px solid ${C.border};">
      <span style="${FONT}font-size:12px;font-weight:700;color:${color};">${mark} ${esc(label)}</span><br>
      <span style="${FONT}font-size:11px;color:${C.muted};">${esc(detail)}</span></td></tr>`;
  };
  const criticalHtml = criticalPoints.length
    ? criticalPoints.map((c) => signalRow(c.label, c.detail, c.severity === "critical" ? "critical" : "warning")).join("")
    : `<tr><td style="padding:8px 10px;background:#f0fdf4;border-left:4px solid ${C.success};${FONT}font-size:12px;color:${C.success};font-weight:600;">✓ No critical points identified today</td></tr>`;
  const positiveHtml = positiveAchievements.length
    ? positiveAchievements.map((a) => signalRow(a.label, a.detail, "good")).join("")
    : `<tr><td style="padding:8px 10px;${FONT}font-size:12px;color:${C.muted};">No highlights today</td></tr>`;
  const signalsBody = sideBySide(
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">CRITICAL INTERVENTION POINTS</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};">${criticalHtml}</table>`,
    `<p style="${FONT}font-size:10px;font-weight:700;color:${C.muted};margin:0 0 3px 0;letter-spacing:1px;">POSITIVE ACHIEVEMENTS</p><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};">${positiveHtml}</table>`,
  );

  const rows = [
    sectionHeader(`1. Budget vs Consumption — ${raw.budget.periodCode ?? reportDate.slice(0, 7)}`),
    `<tr><td>${card(budgetBody)}</td></tr>`,
    sectionHeader("2. GRN Summary — Month-to-Date, tied to the budget"),
    `<tr><td>${card(grnStatsBody)}</td></tr>`,
    sectionHeader("3. Recent GRNs (Latest 15)"),
    `<tr><td>${card(grnTableBody)}</td></tr>`,
    sectionHeader("4. ATS — Today's Recruitment Activity"),
    `<tr><td>${card(atsBody)}</td></tr>`,
    sectionHeader("5. Attendance Today — Shrinkage & Late Arrivals by Process"),
    `<tr><td>${card(attendanceBody)}</td></tr>`,
    sectionHeader("6. Headcount Movement & Pending Actions"),
    `<tr><td>${card(movementBody)}</td></tr>`,
    sectionHeader("7. Open Hiring — Upcoming Batches (Job Requisitions)"),
    `<tr><td>${card(hiringBody + hiringNote)}</td></tr>`,
    sectionHeader("8. Running P&L — Month-to-Date"),
    `<tr><td>${card(pnlBody)}</td></tr>`,
    sectionHeader("9. Critical Intervention Points & Positive Achievements"),
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
