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
  return `<span style="display:inline-block;padding:2px 7px;border-radius:4px;background:${s.bg};color:${s.text};${FONT}font-size:11px;font-weight:600;">${s.label}</span>`;
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
  return `<tr><td colspan="99" style="padding:18px 0 6px 0;">
    <p style="margin:0;${FONT}font-size:11px;font-weight:700;letter-spacing:1.2px;color:${C.muted};text-transform:uppercase;">${esc(title)}</p>
  </td></tr>`;
}

function card(body: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;background:${C.card};margin-bottom:0;">
    <tr><td style="padding:16px 20px;">${body}</td></tr>
  </table>`;
}

function kpiCell(
  label: string,
  value: string,
  color?: string,
  subtext?: string,
): string {
  return `<td style="padding:10px 18px;text-align:center;border-right:1px solid ${C.border};">
    <div style="${FONT}font-size:24px;font-weight:700;color:${color ?? C.primary};line-height:1;">${esc(value)}</div>
    <div style="${FONT}font-size:11px;color:${C.muted};margin-top:4px;">${esc(label)}</div>
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

function dataTable(
  headers: string[],
  rows: (string | { raw: string })[][],
  compact = false,
): string {
  if (!rows.length)
    return `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">None</p>`;
  const pad = compact ? "6px 8px" : "8px 12px";
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
            return `<td style="padding:${pad};border-bottom:1px solid ${C.border};${FONT}font-size:12px;color:${C.primary};">${content}</td>`;
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
          color:
            raw.budget.utilizationPct >= 95
              ? C.danger
              : raw.budget.utilizationPct >= 80
                ? C.warn
                : C.success,
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
          color:
            raw.budget.utilizationPct >= 95
              ? C.danger
              : raw.budget.utilizationPct >= 80
                ? C.warn
                : C.success,
        },
      ])
    : `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">No budget found for ${raw.budget.periodCode ?? reportDate.slice(0, 7)}</p>`;

  // ── 2. GRN Stats ──
  const grnStatsBody = kpiStrip([
    {
      label: "Raised (MTD)",
      value: String(raw.grnStats.raised),
      color: C.primary,
    },
    {
      label: "Approved",
      value: String(raw.grnStats.approved),
      color: C.success,
    },
    {
      label: "Pending Approval (all open)",
      value: String(raw.grnStats.pending),
      color:
        raw.grnStats.pending >= 5
          ? C.warn
          : raw.grnStats.pending > 0
            ? C.accent
            : C.primary,
    },
    {
      label: "Total Value (MTD)",
      value: inr(raw.grnStats.totalRaisedAmount),
      color: C.primary,
    },
  ]);

  // ── 3. GRN Table ──
  const grnTableBody = dataTable(
    ["GRN #", "Vendor", "Head", "Sub-Head", "Amount", "Raised On", "Status"],
    raw.recentGrns.map((g) => [
      g.grnNumber ?? "—",
      g.vendorName ?? "—",
      g.head ?? "—",
      g.subHead ?? "—",
      inr(g.amount),
      g.raisedOn,
      { raw: statusBadge(g.status) },
    ]),
    true,
  );

  // ── 4. ATS ──
  const slaPct =
    raw.ats.slaTotal > 0
      ? `${Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)}%`
      : "—";
  const selectionPct =
    raw.ats.walkins > 0
      ? `${Math.round((raw.ats.selected / raw.ats.walkins) * 100)}%`
      : "—";
  const atsBody = kpiStrip([
    { label: "Walk-ins", value: String(raw.ats.walkins), color: C.primary },
    { label: "Tokens Created", value: String(raw.ats.tokens), color: C.accent },
    {
      label: "Tokens Closed",
      value: String(raw.ats.tokensClosed),
      color: C.muted,
    },
    {
      label: "Selected",
      value: String(raw.ats.selected),
      color: C.success,
      subtext: selectionPct,
    },
    { label: "Rejected", value: String(raw.ats.rejected), color: C.danger },
    { label: "No Show", value: String(raw.ats.noShow), color: C.muted },
    {
      label: "SLA Breach %",
      value: slaPct,
      color: raw.ats.slaBreaches > 0 ? C.warn : C.success,
    },
  ]);

  // ── 5. Late comers ──
  const lateColor =
    raw.lateStats.totalLate >= 15
      ? C.danger
      : raw.lateStats.totalLate >= 5
        ? C.warn
        : C.primary;
  const lateRows = raw.lateStats.byManager.map((r) => [
    r.process,
    r.manager,
    String(r.count),
  ]);
  const lateBody = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="200" valign="top" style="padding-right:20px;">
          <div style="${FONT}font-size:42px;font-weight:700;color:${lateColor};line-height:1;">${raw.lateStats.totalLate}</div>
          <div style="${FONT}font-size:12px;color:${C.muted};margin-top:4px;">Employees arrived late today</div>
        </td>
        <td valign="top">
          ${
            lateRows.length
              ? dataTable(
                  ["Process", "Reporting Manager", "Late Count"],
                  lateRows,
                  true,
                )
              : `<p style="${FONT}font-size:13px;color:${C.success};margin:0;">No late arrivals today</p>`
          }
        </td>
      </tr>
    </table>`;

  // ── 6. Shrinkage ──
  const shrinkageColor =
    raw.shrinkage.shrinkagePct >= 20
      ? C.danger
      : raw.shrinkage.shrinkagePct >= 10
        ? C.warn
        : C.success;
  const shrinkageSourceNote = raw.shrinkage.rosterBased
    ? `<p style="${FONT}font-size:10px;color:${C.muted};margin:6px 0 0 0;">Source: today's uploaded roster (shift timings) vs first punch. Shrinkage = no punch ÷ planned, counting only shifts already started; week-offs, leave and yet-to-start shifts are excluded.</p>`
    : `<p style="${FONT}font-size:10px;color:${C.warn};margin:6px 0 0 0;">⚠ No roster uploaded for this branch today — shrinkage cannot be calculated</p>`;
  const shrinkageBody =
    kpiStrip([
      {
        label: "Scheduled",
        value: String(raw.shrinkage.scheduled),
        color: C.primary,
      },
      {
        label: "Present",
        value: String(raw.shrinkage.present),
        color: C.success,
      },
      {
        label: "Absent",
        value: String(raw.shrinkage.absent),
        color: raw.shrinkage.absent > 0 ? C.warn : C.success,
      },
      {
        label: "On Leave",
        value: String(raw.shrinkage.onLeave),
        color: C.muted,
      },
      {
        label: "Yet to Start",
        value: String(raw.shrinkage.yetToStart),
        color: C.muted,
      },
      {
        label: "Shrinkage %",
        value: `${raw.shrinkage.shrinkagePct}%`,
        color: shrinkageColor,
      },
    ]) +
    (raw.shrinkage.bySlot.length
      ? dataTable(
          ["Process", "Shift Slot", "Planned", "Present", "Absent", "Late"],
          raw.shrinkage.bySlot.map((b) => [
            b.process,
            b.shift,
            String(b.planned),
            String(b.present),
            String(b.absent),
            String(b.late),
          ]),
          true,
        )
      : "") +
    shrinkageSourceNote;

  // ── Open hiring (Job Requisition page) ──
  const hiring = raw.openHiring;
  const priorityColor = (p: string) =>
    p === "urgent" ? C.danger : p === "high" ? C.warn : C.muted;
  const hiringBody =
    hiring.openRequisitions > 0
      ? kpiStrip([
          { label: "Open Requisitions", value: String(hiring.openRequisitions), color: C.primary },
          { label: "Open Positions", value: String(hiring.openPositions), color: C.warn, subtext: `${hiring.fulfilled} of ${hiring.requested} filled` },
          { label: "In Pipeline", value: String(hiring.inPipeline), color: C.accent },
          { label: "Selected", value: String(hiring.selected), color: C.success },
          { label: "Past Fill-by Date", value: String(hiring.overdue), color: hiring.overdue > 0 ? C.danger : C.muted },
        ]) +
        dataTable(
          ["Requisition", "Designation", "Process", "Priority", "Req.", "Filled", "Open", "Pipeline", "Selected", "Fill-by"],
          hiring.rows.map((r) => [
            r.code,
            r.designation,
            r.process,
            { raw: `<span style="color:${priorityColor(r.priority)};font-weight:700;">${esc(r.priority)}</span>` },
            String(r.requested),
            String(r.fulfilled),
            String(r.openPositions),
            String(r.inPipeline),
            String(r.selected),
            { raw: `<span style="color:${r.overdue ? C.danger : C.primary};">${esc(r.deadline ?? "—")}${r.overdue ? " ⚠" : ""}</span>` },
          ]),
          true,
        ) +
        `<p style="${FONT}font-size:10px;color:${C.muted};margin:6px 0 0 0;">Source: Job Requisition page — approved requisitions still short of the requested headcount (${hiring.pendingApproval} more awaiting approval). Open = requested − filled; pipeline / selected from the requisition's linked candidates.</p>`
      : `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">No approved open requisitions for this branch${hiring.pendingApproval ? ` (${hiring.pendingApproval} awaiting approval)` : ""}</p>`;

  // ── 8. Running P&L Snapshot ──
  const pnl = raw.runningPnl;
  const opColor = pnl.operatingProfit < 0 ? C.danger : C.success;
  const coverageWarn =
    pnl.peopleCostCoveragePct != null && pnl.peopleCostCoveragePct < 99.5
      ? `<p style="${FONT}font-size:10px;color:${C.warn};margin:6px 0 0 0;">⚠ Salary snapshot covers ${pnl.peopleCostCoveragePct}% of active headcount — operating profit is overstated by the uncovered staff.</p>`
      : "";
  const pnlBody = pnl.dataAvailable
    ? kpiStrip([
        { label: "Running Revenue", value: inr(pnl.revenueRunning), color: C.primary, subtext: `${pnl.elapsedDays}/${pnl.daysInMonth} days of ${inr(pnl.revenueMonth)}` },
        { label: "Running Salary", value: inr(pnl.salaryRunning), color: C.accent, subtext: pnl.asOfDate ? `as of ${pnl.asOfDate}` : "no snapshot" },
        { label: "GRN Consumed", value: inr(pnl.grnConsumed), color: C.warn, subtext: "ex-GST" },
        { label: "GRN Reserved", value: inr(pnl.grnReserved), color: C.muted, subtext: "ex-GST, in approval" },
      ]) +
      kpiStrip([
        { label: "Total Running Cost", value: inr(pnl.totalCostRunning), color: C.warn },
        { label: "Running Operating Profit", value: inr(pnl.operatingProfit), color: opColor },
        { label: "OP %", value: pnl.opPct != null ? `${pnl.opPct.toFixed(1)}%` : "—", color: opColor },
      ]) +
      `<p style="${FONT}font-size:10px;color:${C.muted};margin:6px 0 0 0;">OP = running revenue − running salary − GRN (consumed + reserved, ex-GST). Revenue is the P&amp;L statement's ${esc(pnl.revenueBasis || "recognised")} revenue for the month, spread evenly over the days covered by the salary snapshot.</p>` +
      coverageWarn
    : `<p style="${FONT}font-size:13px;color:${C.muted};margin:0;">No P&amp;L data available for ${pnl.periodCode || reportDate.slice(0, 7)}</p>`;

  // ── 9. Headcount ──
  const hcBody = `
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${kpiCell("Total Active Headcount", String(raw.headcount.totalActive), C.primary)}
        ${kpiCell("Joined Today", String(raw.headcount.joinedToday), C.success)}
        ${kpiCell("Left Today", String(raw.headcount.leftToday), raw.headcount.leftToday > 0 ? C.warn : C.muted)}
        <td style="padding:10px 18px;vertical-align:top;">
          ${
            raw.headcount.joinedNames.length
              ? `<div style="${FONT}font-size:11px;color:${C.success};font-weight:700;margin-bottom:2px;">NEW JOINERS</div><div style="${FONT}font-size:12px;color:${C.primary};">${raw.headcount.joinedNames.slice(0, 5).map(esc).join(", ")}${raw.headcount.joinedNames.length > 5 ? ` +${raw.headcount.joinedNames.length - 5} more` : ""}</div>`
              : ""
          }
          ${
            raw.headcount.leftNames.length
              ? `<div style="${FONT}font-size:11px;color:${C.warn};font-weight:700;margin-top:6px;margin-bottom:2px;">SEPARATIONS</div><div style="${FONT}font-size:12px;color:${C.primary};">${raw.headcount.leftNames.slice(0, 5).map(esc).join(", ")}${raw.headcount.leftNames.length > 5 ? ` +${raw.headcount.leftNames.length - 5} more` : ""}</div>`
              : ""
          }
          ${
            !raw.headcount.joinedNames.length && !raw.headcount.leftNames.length
              ? `<div style="${FONT}font-size:12px;color:${C.muted};">No movement today</div>`
              : ""
          }
        </td>
      </tr>
    </table>` +
    (raw.headcount.byProcess.length
      ? dataTable(
          ["Process", "Joined", "Left"],
          raw.headcount.byProcess.map((p) => [
            p.process,
            String(p.joined),
            String(p.left),
          ]),
          true,
        )
      : "");

  // ── 9. Pending actions ──
  const actionsBody = raw.pendingActions.length
    ? dataTable(
        ["Pending Action", "Count"],
        raw.pendingActions.map((a) => [a.label, String(a.count)]),
      )
    : `<p style="${FONT}font-size:13px;color:${C.success};margin:0;">✓ No pending actions</p>`;

  // ── 10. Critical Points ──
  const criticalHtml = criticalPoints.length
    ? criticalPoints
        .map(
          (c) => `
        <tr>
          <td style="padding:10px 14px;background:${c.severity === "critical" ? "#fff1f2" : "#fffbeb"};border-left:4px solid ${c.severity === "critical" ? C.danger : C.warn};border-bottom:1px solid ${C.border};">
            <span style="${FONT}font-size:13px;font-weight:700;color:${c.severity === "critical" ? C.danger : C.warn};">${c.severity === "critical" ? "🔴" : "⚠️"} ${esc(c.label)}</span><br>
            <span style="${FONT}font-size:12px;color:${C.muted};">${esc(c.detail)}</span>
          </td>
        </tr>`,
        )
        .join("")
    : `<tr><td style="padding:12px 14px;background:#f0fdf4;border-left:4px solid ${C.success};">
        <span style="${FONT}font-size:13px;color:${C.success};font-weight:600;">✓ No critical points identified today</span>
      </td></tr>`;

  // ── 11. Positive Achievements ──
  const positiveHtml = positiveAchievements.length
    ? positiveAchievements
        .map(
          (a) => `
        <tr>
          <td style="padding:10px 14px;background:#f0fdf4;border-left:4px solid ${C.success};border-bottom:1px solid ${C.border};">
            <span style="${FONT}font-size:13px;font-weight:700;color:${C.success};">✓ ${esc(a.label)}</span><br>
            <span style="${FONT}font-size:12px;color:${C.muted};">${esc(a.detail)}</span>
          </td>
        </tr>`,
        )
        .join("")
    : `<tr><td style="padding:12px 14px;"><span style="${FONT}font-size:13px;color:${C.muted};">No highlights today</span></td></tr>`;

  const rows = [
    // Budget
    sectionHeader(
      `1. Budget vs Consumption — ${raw.budget.periodCode ?? reportDate.slice(0, 7)}`,
    ),
    `<tr><td>${card(budgetBody)}</td></tr>`,
    // GRN
    sectionHeader("2. GRN Summary — Month-to-Date"),
    `<tr><td>${card(grnStatsBody)}</td></tr>`,
    sectionHeader("3. Recent GRNs (Latest 15)"),
    `<tr><td>${card(grnTableBody)}</td></tr>`,
    // ATS
    sectionHeader("4. ATS — Today's Recruitment Activity"),
    `<tr><td>${card(atsBody)}</td></tr>`,
    // Attendance
    sectionHeader("5. Late Arrivals — Today (by Reporting Manager)"),
    `<tr><td>${card(lateBody)}</td></tr>`,
    sectionHeader("6. Shrinkage — Today"),
    `<tr><td>${card(shrinkageBody)}</td></tr>`,
    // Headcount
    sectionHeader("7. Headcount Movement — Today"),
    `<tr><td>${card(hcBody)}</td></tr>`,
    // Pending actions
    sectionHeader("8. Pending Actions"),
    `<tr><td>${card(actionsBody)}</td></tr>`,
    // Open Hiring
    sectionHeader("9. Open Hiring — Job Requisitions"),
    `<tr><td>${card(hiringBody)}</td></tr>`,
    // Running P&L
    sectionHeader("10. Running P&L — Month-to-Date"),
    `<tr><td>${card(pnlBody)}</td></tr>`,
    // Signals
    sectionHeader("11. Critical Intervention Points"),
    `<tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden;">${criticalHtml}</table></td></tr>`,
    sectionHeader("12. Positive Achievements"),
    `<tr><td style="padding-bottom:8px;"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.border};border-radius:8px;overflow:hidden;">${positiveHtml}</table></td></tr>`,
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
