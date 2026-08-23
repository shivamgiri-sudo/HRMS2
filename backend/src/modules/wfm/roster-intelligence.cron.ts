/**
 * Roster Intelligence Cron Jobs
 *
 * 1. Manager Daily Digest — 7:00 AM IST daily
 * 2. Unplanned Absence Alerts — Every 30 minutes during working hours (8 AM - 8 PM IST)
 * 3. Branch Dashboard Email — 8:00 AM IST daily
 *
 * Uses setTimeout pattern consistent with other HRMS crons (tenure.cron.ts, etc.)
 */
import {
  generateManagerDailyDigests,
  generateBranchDashboard,
  detectUnplannedAbsences,
  type ManagerDailyDigest,
} from './roster-intelligence.service.js';
import { emailService } from '../communication/email.service.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

const ENABLED = process.env.ROSTER_INTELLIGENCE_CRON !== 'false';

// IST offset: UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

let digestTimer: NodeJS.Timeout | undefined;
let branchTimer: NodeJS.Timeout | undefined;
let alertTimer: NodeJS.Timeout | undefined;

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function msUntilISTTime(hour: number, minute: number): number {
  const now = nowIST();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function msUntilNextHalfHour(): number {
  const now = nowIST();
  const mins = now.getMinutes();
  const nextMins = mins < 30 ? 30 : 60;
  const target = new Date(now);
  target.setMinutes(nextMins, 0, 0);
  if (nextMins === 60) target.setHours(target.getHours() + 1, 0, 0, 0);
  return target.getTime() - now.getTime();
}

function isWorkingHoursIST(): boolean {
  const now = nowIST();
  const hour = now.getHours();
  return hour >= 8 && hour < 20; // 8 AM to 8 PM IST
}

// ── Manager Daily Digest (7:00 AM IST) ───────────────────────────────────────

async function runManagerDailyDigest(): Promise<void> {
  console.log('[roster-intelligence-cron] Starting manager daily digest...');

  try {
    const digests = await generateManagerDailyDigests();
    console.log(`[roster-intelligence-cron] Generated ${digests.length} manager digests`);

    if (!emailService.isConfigured()) {
      console.warn('[roster-intelligence-cron] Email not configured, skipping send');
      return;
    }

    let sent = 0;
    let skipped = 0;

    for (const digest of digests) {
      if (!digest.managerEmail) {
        skipped++;
        continue;
      }

      // Skip if no issues to report
      if (
        digest.unplannedAbsences.length === 0 &&
        digest.lateArrivals.length === 0 &&
        digest.incompleteShifts.length === 0 &&
        digest.aprPending === 0
      ) {
        continue;
      }

      try {
        const html = formatManagerDigestEmail(digest);
        await emailService.send({
          to: digest.managerEmail,
          subject: `Team Attendance Summary — ${digest.date}`,
          html,
        });
        sent++;
      } catch (emailErr: unknown) {
        const msg = emailErr instanceof Error ? emailErr.message : 'Unknown error';
        console.error(`[roster-intelligence-cron] Failed to email ${digest.managerEmail}:`, msg);
        skipped++;
      }
    }

    console.log(`[roster-intelligence-cron] Manager digest complete: sent=${sent}, skipped=${skipped}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-intelligence-cron] Manager digest failed:', msg);
  }
}

export function startManagerDigestScheduler(): void {
  if (digestTimer) return;
  const ms = msUntilISTTime(7, 0); // 7:00 AM IST
  console.log(`[roster-intelligence-cron] Manager digest scheduled in ${Math.round(ms / 60000)} minutes`);

  digestTimer = setTimeout(async () => {
    await runManagerDailyDigest();
    digestTimer = undefined;
    startManagerDigestScheduler(); // Reschedule for next day
  }, ms);
  digestTimer.unref();
}

export function stopManagerDigestScheduler(): void {
  if (digestTimer) {
    clearTimeout(digestTimer);
    digestTimer = undefined;
  }
}

// ── Unplanned Absence Alerts (Every 30 min, 8 AM - 8 PM IST) ─────────────────

async function runUnplannedAbsenceAlerts(): Promise<void> {
  if (!isWorkingHoursIST()) {
    return; // Only run during working hours
  }

  console.log('[roster-intelligence-cron] Checking for unplanned absences...');

  try {
    const alerts = await detectUnplannedAbsences(undefined, 30);

    if (alerts.length === 0) {
      console.log('[roster-intelligence-cron] No unplanned absences detected');
      return;
    }

    console.log(`[roster-intelligence-cron] Detected ${alerts.length} unplanned absences`);

    if (!emailService.isConfigured()) {
      console.warn('[roster-intelligence-cron] Email not configured, skipping alerts');
      return;
    }

    // Group by manager
    const byManager = new Map<string, {
      email: string | null;
      name: string | null;
      alerts: typeof alerts;
    }>();

    for (const alert of alerts) {
      const mgrId = alert.managerId ?? 'unassigned';
      if (!byManager.has(mgrId)) {
        byManager.set(mgrId, { email: alert.managerEmail, name: alert.managerName, alerts: [] });
      }
      byManager.get(mgrId)!.alerts.push(alert);
    }

    // Check which managers were already alerted today
    const today = new Date().toISOString().slice(0, 10);
    const alertedManagers = new Set<string>();

    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.managerId')) AS manager_id
         FROM audit_log
         WHERE action_type = 'ROSTER_UNPLANNED_ALERT_SENT'
           AND DATE(created_at) = ?`,
        [today]
      );
      for (const r of rows) {
        if (r.manager_id) alertedManagers.add(String(r.manager_id));
      }
    } catch {
      // audit_log query failed, proceed without dedup
    }

    let sent = 0;

    for (const [managerId, data] of byManager.entries()) {
      if (!data.email || managerId === 'unassigned') continue;
      if (alertedManagers.has(managerId)) continue;

      try {
        const html = formatUnplannedAlertEmail(data.name ?? 'Manager', data.alerts);
        await emailService.send({
          to: data.email,
          subject: `Alert: ${data.alerts.length} Team Member(s) Not Punched In`,
          html,
        });
        sent++;

        // Log the alert
        try {
          await db.execute(
            `INSERT INTO audit_log (id, actor_user_id, action_type, entity_type, entity_id, metadata_json, created_at)
             VALUES (UUID(), NULL, 'ROSTER_UNPLANNED_ALERT_SENT', 'manager', ?, ?, NOW())`,
            [managerId, JSON.stringify({ managerId, alertCount: data.alerts.length, date: today })]
          );
        } catch {
          // Audit log failure is non-fatal
        }
      } catch (emailErr: unknown) {
        const msg = emailErr instanceof Error ? emailErr.message : 'Unknown error';
        console.error(`[roster-intelligence-cron] Failed to alert ${data.email}:`, msg);
      }
    }

    console.log(`[roster-intelligence-cron] Unplanned alerts sent: ${sent}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-intelligence-cron] Unplanned alerts failed:', msg);
  }
}

export function startUnplannedAlertScheduler(): void {
  if (alertTimer) return;
  const ms = msUntilNextHalfHour();

  alertTimer = setTimeout(async () => {
    await runUnplannedAbsenceAlerts();
    alertTimer = undefined;
    startUnplannedAlertScheduler(); // Reschedule for next half hour
  }, ms);
  alertTimer.unref();
}

export function stopUnplannedAlertScheduler(): void {
  if (alertTimer) {
    clearTimeout(alertTimer);
    alertTimer = undefined;
  }
}

// ── Branch Dashboard Email (8:00 AM IST) ─────────────────────────────────────

async function runBranchDashboardEmails(): Promise<void> {
  console.log('[roster-intelligence-cron] Starting branch dashboard emails...');

  try {
    // Get all active branches with branch heads
    const [branches] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT
         bm.id AS branch_id,
         bm.branch_name,
         e.official_email AS head_email,
         e.full_name AS head_name
       FROM branch_master bm
       JOIN employees e ON e.branch_id = bm.id
       WHERE bm.active_status = 1
         AND e.designation_id IN (
           SELECT id FROM designation_master WHERE designation_name LIKE '%Branch Head%'
         )
         AND e.active_status = 1
         AND e.official_email IS NOT NULL`
    );

    if (!emailService.isConfigured()) {
      console.warn('[roster-intelligence-cron] Email not configured, skipping branch dashboards');
      return;
    }

    let sent = 0;

    for (const branch of branches) {
      try {
        const dashboard = await generateBranchDashboard(String(branch.branch_id));

        // Only send if there are issues
        if (dashboard.shrinkagePct < 5 && dashboard.chronicAbsentees.length === 0) {
          continue;
        }

        const html = formatBranchDashboardEmail(dashboard, String(branch.head_name));
        await emailService.send({
          to: String(branch.head_email),
          subject: `Branch Attendance Report — ${dashboard.branchName} — ${dashboard.date}`,
          html,
        });
        sent++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[roster-intelligence-cron] Failed branch dashboard for ${String(branch.branch_name)}:`, msg);
      }
    }

    console.log(`[roster-intelligence-cron] Branch dashboards sent: ${sent}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-intelligence-cron] Branch dashboard failed:', msg);
  }
}

export function startBranchDashboardScheduler(): void {
  if (branchTimer) return;
  const ms = msUntilISTTime(8, 0); // 8:00 AM IST
  console.log(`[roster-intelligence-cron] Branch dashboard scheduled in ${Math.round(ms / 60000)} minutes`);

  branchTimer = setTimeout(async () => {
    await runBranchDashboardEmails();
    branchTimer = undefined;
    startBranchDashboardScheduler(); // Reschedule for next day
  }, ms);
  branchTimer.unref();
}

export function stopBranchDashboardScheduler(): void {
  if (branchTimer) {
    clearTimeout(branchTimer);
    branchTimer = undefined;
  }
}

// ── Email Formatters ─────────────────────────────────────────────────────────

function formatManagerDigestEmail(digest: ManagerDailyDigest): string {
  const lines: string[] = [];

  lines.push(`<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`);
  lines.push(`<h2 style="color: #1e3a5f; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Yesterday's Team Summary</h2>`);

  lines.push(`<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">`);
  lines.push(`<table style="width: 100%;"><tr>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 24px; font-weight: bold; color: #1e3a5f;">${digest.teamSize}</div><div style="font-size: 12px; color: #6b7280;">Team Size</div></td>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 24px; font-weight: bold; color: #059669;">${digest.present}</div><div style="font-size: 12px; color: #6b7280;">Present</div></td>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 24px; font-weight: bold; color: #dc2626;">${digest.shrinkagePct}%</div><div style="font-size: 12px; color: #6b7280;">Shrinkage</div></td>`);
  lines.push(`</tr></table>`);
  lines.push(`</div>`);

  if (digest.unplannedAbsences.length > 0) {
    lines.push(`<div style="background: #fef2f2; padding: 12px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #dc2626;">`);
    lines.push(`<h3 style="color: #dc2626; margin: 0 0 8px 0; font-size: 14px;">Unplanned Absences (${digest.unplannedAbsences.length})</h3>`);
    for (const emp of digest.unplannedAbsences.slice(0, 5)) {
      lines.push(`<div style="font-size: 13px; padding: 4px 0;">${emp.employeeName} <span style="color: #6b7280;">(${emp.employeeCode})</span></div>`);
    }
    if (digest.unplannedAbsences.length > 5) {
      lines.push(`<div style="font-size: 12px; color: #6b7280;">+${digest.unplannedAbsences.length - 5} more</div>`);
    }
    lines.push(`</div>`);
  }

  if (digest.lateArrivals.length > 0) {
    lines.push(`<div style="background: #fffbeb; padding: 12px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #d97706;">`);
    lines.push(`<h3 style="color: #d97706; margin: 0 0 8px 0; font-size: 14px;">Late Arrivals (${digest.lateArrivals.length})</h3>`);
    for (const emp of digest.lateArrivals.slice(0, 5)) {
      lines.push(`<div style="font-size: 13px; padding: 4px 0;">${emp.employeeName} — <strong>${emp.lateMinutes} min</strong> late</div>`);
    }
    if (digest.lateArrivals.length > 5) {
      lines.push(`<div style="font-size: 12px; color: #6b7280;">+${digest.lateArrivals.length - 5} more</div>`);
    }
    lines.push(`</div>`);
  }

  if (digest.aprPending > 0) {
    lines.push(`<div style="background: #fef3c7; padding: 12px; border-radius: 8px; margin-bottom: 12px;">`);
    lines.push(`<strong>APR Pending:</strong> ${digest.aprPending} regularization requests need your approval`);
    lines.push(`</div>`);
  }

  lines.push(`<p style="margin-top: 20px; font-size: 11px; color: #9ca3af;">MAS Callnet HRMS | ${digest.date}</p>`);
  lines.push(`</div>`);

  return lines.join('\n');
}

function formatUnplannedAlertEmail(
  managerName: string,
  alerts: Awaited<ReturnType<typeof detectUnplannedAbsences>>
): string {
  const lines: string[] = [];

  lines.push(`<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`);
  lines.push(`<div style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #dc2626;">`);
  lines.push(`<h2 style="color: #dc2626; margin: 0 0 8px 0;">Team Alert</h2>`);
  lines.push(`<p style="margin: 0;">Hi ${managerName}, ${alerts.length} team member(s) haven't punched in:</p>`);
  lines.push(`</div>`);

  lines.push(`<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">`);
  lines.push(`<tr style="background: #fecaca;"><th style="padding: 8px; text-align: left;">Employee</th><th style="padding: 8px;">Shift</th><th style="padding: 8px;">Delay</th></tr>`);

  for (const a of alerts.slice(0, 10)) {
    lines.push(`<tr style="border-bottom: 1px solid #fee2e2;"><td style="padding: 8px;">${a.employeeName}<br><span style="font-size: 11px; color: #6b7280;">${a.employeeCode}</span></td><td style="padding: 8px; text-align: center;">${a.shiftTime}</td><td style="padding: 8px; text-align: center;">${a.minutesSinceShiftStart}m</td></tr>`);
  }

  if (alerts.length > 10) {
    lines.push(`<tr><td colspan="3" style="padding: 8px; text-align: center; color: #6b7280;">+${alerts.length - 10} more</td></tr>`);
  }

  lines.push(`</table>`);
  lines.push(`<p style="font-size: 12px; color: #6b7280;">Please follow up or mark regularization if needed.</p>`);
  lines.push(`</div>`);

  return lines.join('\n');
}

function formatBranchDashboardEmail(
  dashboard: Awaited<ReturnType<typeof generateBranchDashboard>>,
  headName: string
): string {
  const lines: string[] = [];

  lines.push(`<div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto;">`);
  lines.push(`<h2 style="color: #1e3a5f;">Branch Attendance — ${dashboard.branchName}</h2>`);
  lines.push(`<p>Hi ${headName}, here's yesterday's attendance summary:</p>`);

  lines.push(`<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">`);
  lines.push(`<table style="width: 100%;"><tr>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 28px; font-weight: bold;">${dashboard.totalHC}</div><div style="font-size: 11px; color: #6b7280;">HC</div></td>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 28px; font-weight: bold;">${dashboard.planned}</div><div style="font-size: 11px; color: #6b7280;">Planned</div></td>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 28px; font-weight: bold; color: #059669;">${dashboard.present}</div><div style="font-size: 11px; color: #6b7280;">Present</div></td>`);
  lines.push(`<td style="text-align: center;"><div style="font-size: 28px; font-weight: bold; color: ${dashboard.shrinkagePct > 10 ? '#dc2626' : '#d97706'};">${dashboard.shrinkagePct}%</div><div style="font-size: 11px; color: #6b7280;">Shrinkage</div></td>`);
  lines.push(`</tr></table>`);
  lines.push(`</div>`);

  // Process breakdown
  if (dashboard.byProcess.length > 0) {
    lines.push(`<h3 style="margin-top: 20px;">Process-wise Adherence</h3>`);
    lines.push(`<table style="width: 100%; border-collapse: collapse;">`);
    lines.push(`<tr style="background: #e2e8f0;"><th style="padding: 8px; text-align: left;">Process</th><th style="padding: 8px;">Planned</th><th style="padding: 8px;">On-time</th><th style="padding: 8px;">Adherence</th></tr>`);

    for (const p of dashboard.byProcess.slice(0, 5)) {
      const color = p.adherencePct >= 85 ? '#059669' : p.adherencePct >= 70 ? '#d97706' : '#dc2626';
      lines.push(`<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px;">${p.processName}</td><td style="padding: 8px; text-align: center;">${p.planned}</td><td style="padding: 8px; text-align: center;">${p.onTime}</td><td style="padding: 8px; text-align: center; color: ${color}; font-weight: bold;">${p.adherencePct}%</td></tr>`);
    }

    lines.push(`</table>`);
  }

  // Chronic absentees
  if (dashboard.chronicAbsentees.length > 0) {
    lines.push(`<h3 style="margin-top: 20px; color: #dc2626;">Chronic Absentees (30 days)</h3>`);
    lines.push(`<table style="width: 100%; border-collapse: collapse;">`);
    lines.push(`<tr style="background: #fee2e2;"><th style="padding: 8px; text-align: left;">Employee</th><th style="padding: 8px;">Process</th><th style="padding: 8px;">Absences</th></tr>`);

    for (const emp of dashboard.chronicAbsentees.slice(0, 5)) {
      lines.push(`<tr style="border-bottom: 1px solid #fecaca;"><td style="padding: 8px;">${emp.employeeName}<br><span style="font-size: 11px; color: #6b7280;">${emp.employeeCode}</span></td><td style="padding: 8px;">${emp.processName ?? '—'}</td><td style="padding: 8px; text-align: center; font-weight: bold; color: #dc2626;">${emp.unplannedAbsences30d}</td></tr>`);
    }

    lines.push(`</table>`);
  }

  lines.push(`<p style="margin-top: 20px; font-size: 11px; color: #9ca3af;">MAS Callnet HRMS | ${dashboard.date}</p>`);
  lines.push(`</div>`);

  return lines.join('\n');
}

// ── Main Registration ────────────────────────────────────────────────────────

export function registerRosterIntelligenceCrons(): void {
  if (!ENABLED) {
    console.log('[roster-intelligence-cron] Disabled via ROSTER_INTELLIGENCE_CRON=false');
    return;
  }

  startManagerDigestScheduler();
  startBranchDashboardScheduler();
  startUnplannedAlertScheduler();

  console.log('[roster-intelligence-cron] All schedulers registered');
}

export function stopRosterIntelligenceCrons(): void {
  stopManagerDigestScheduler();
  stopBranchDashboardScheduler();
  stopUnplannedAlertScheduler();
}
