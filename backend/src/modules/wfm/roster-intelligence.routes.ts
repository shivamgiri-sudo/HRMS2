/**
 * Roster Intelligence Routes
 *
 * APIs for manager digest, branch dashboard, and unplanned absence alerts.
 */
import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  generateManagerDailyDigests,
  generateBranchDashboard,
  detectUnplannedAbsences,
  generateWeeklyShrinkageReport,
  type ManagerDailyDigest,
} from './roster-intelligence.service.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

const ADMIN_ROLES = ['super_admin', 'admin', 'hr', 'wfm'];
const MANAGER_ROLES = ['super_admin', 'admin', 'hr', 'wfm', 'branch_head', 'manager', 'operations_manager', 'process_manager'];

/**
 * GET /api/roster-intelligence/manager-digest
 * Get digest for the logged-in manager (or specify managerId for admins)
 */
router.get('/manager-digest', requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.authUser?.id;
    const role = authReq.authUser?.role;
    const date = req.query.date ? String(req.query.date) : undefined;

    let managerId = req.query.managerId ? String(req.query.managerId) : null;

    // Non-admins can only see their own digest
    if (!ADMIN_ROLES.includes(role ?? '')) {
      // Get employee record for this user to find their employee ID
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE user_id = ? LIMIT 1`,
        [userId]
      );
      if (empRows.length === 0) {
        res.status(404).json({ error: 'Employee record not found for user' });
        return;
      }
      managerId = String(empRows[0].id);
    }

    if (!managerId) {
      res.status(400).json({ error: 'managerId is required for admin view' });
      return;
    }

    // Get manager info
    const [mgrRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, full_name, official_email FROM employees WHERE id = ?`,
      [managerId]
    );
    if (mgrRows.length === 0) {
      res.status(404).json({ error: 'Manager not found' });
      return;
    }

    // Generate digests and find the one for this manager
    const digests = await generateManagerDailyDigests(date);
    const digest = digests.find(d => d.managerId === managerId);

    if (!digest) {
      res.json({
        managerId,
        managerName: String(mgrRows[0].full_name),
        date: date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        teamSize: 0,
        planned: 0,
        present: 0,
        shrinkagePct: 0,
        unplannedAbsences: [],
        lateArrivals: [],
        incompleteShifts: [],
        onTime: [],
        qualityAvg: null,
        aprPending: 0,
        message: 'No roster data found for this date',
      });
      return;
    }

    res.json(digest);
  } catch (err: any) {
    console.error('[roster-intelligence] manager-digest error:', err);
    res.status(500).json({ error: `Failed to generate digest: ${err.message}` });
  }
});

/**
 * GET /api/roster-intelligence/manager-digests
 * Get digests for ALL managers (admin only) - for batch email sending
 */
router.get('/manager-digests', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const digests = await generateManagerDailyDigests(date);
    res.json({ digests, count: digests.length });
  } catch (err: any) {
    console.error('[roster-intelligence] manager-digests error:', err);
    res.status(500).json({ error: `Failed to generate digests: ${err.message}` });
  }
});

/**
 * GET /api/roster-intelligence/branch-dashboard/:branchId
 * Get branch-level dashboard
 */
router.get('/branch-dashboard/:branchId', requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { branchId } = req.params;
    const date = req.query.date ? String(req.query.date) : undefined;
    const dashboard = await generateBranchDashboard(branchId, date);
    res.json(dashboard);
  } catch (err: any) {
    console.error('[roster-intelligence] branch-dashboard error:', err);
    res.status(500).json({ error: `Failed to generate dashboard: ${err.message}` });
  }
});

/**
 * GET /api/roster-intelligence/branch-dashboards
 * Get dashboards for ALL branches (admin only)
 */
router.get('/branch-dashboards', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;

    // Get all active branches
    const [branches] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM branch_master WHERE active_status = 1`
    );

    const dashboards = await Promise.all(
      branches.map((b) => generateBranchDashboard(String(b.id), date))
    );

    res.json({ dashboards, count: dashboards.length });
  } catch (err: any) {
    console.error('[roster-intelligence] branch-dashboards error:', err);
    res.status(500).json({ error: `Failed to generate dashboards: ${err.message}` });
  }
});

/**
 * GET /api/roster-intelligence/unplanned-absences
 * Detect current unplanned absences (for real-time alerts)
 */
router.get('/unplanned-absences', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const date = req.query.date ? String(req.query.date) : undefined;
    const gracePeriod = req.query.gracePeriod ? parseInt(String(req.query.gracePeriod), 10) : 30;
    const alerts = await detectUnplannedAbsences(date, gracePeriod);

    // Group by manager for easier processing
    const byManager = new Map<string, typeof alerts>();
    for (const alert of alerts) {
      const mgrId = alert.managerId ?? 'unassigned';
      if (!byManager.has(mgrId)) byManager.set(mgrId, []);
      byManager.get(mgrId)!.push(alert);
    }

    res.json({
      total: alerts.length,
      alerts,
      byManager: Object.fromEntries(byManager),
    });
  } catch (err: any) {
    console.error('[roster-intelligence] unplanned-absences error:', err);
    res.status(500).json({ error: `Failed to detect absences: ${err.message}` });
  }
});

/**
 * GET /api/roster-intelligence/weekly-shrinkage/:branchId
 * Get weekly shrinkage report for a branch
 */
router.get('/weekly-shrinkage/:branchId', requireRole(...MANAGER_ROLES), async (req, res) => {
  try {
    const { branchId } = req.params;

    // Default to start of current week (Monday)
    let weekStart = req.query.weekStart ? String(req.query.weekStart) : undefined;
    if (!weekStart) {
      const d = new Date();
      const day = (d.getDay() + 6) % 7; // Monday = 0
      d.setDate(d.getDate() - day);
      weekStart = d.toISOString().slice(0, 10);
    }

    const report = await generateWeeklyShrinkageReport(branchId, weekStart);
    res.json(report);
  } catch (err: any) {
    console.error('[roster-intelligence] weekly-shrinkage error:', err);
    res.status(500).json({ error: `Failed to generate report: ${err.message}` });
  }
});

/**
 * POST /api/roster-intelligence/send-manager-digests
 * Trigger sending of manager daily digests (called by cron or manually)
 */
router.post('/send-manager-digests', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const date = req.body.date ? String(req.body.date) : undefined;
    const dryRun = req.body.dryRun === true;

    const digests = await generateManagerDailyDigests(date);

    if (dryRun) {
      res.json({
        dryRun: true,
        wouldSend: digests.length,
        digests: digests.map(d => ({
          managerId: d.managerId,
          managerName: d.managerName,
          managerEmail: d.managerEmail,
          teamSize: d.teamSize,
          unplannedCount: d.unplannedAbsences.length,
          lateCount: d.lateArrivals.length,
        })),
      });
      return;
    }

    // Actually send emails
    const { emailService } = await import('../communication/email.service.js');

    let sent = 0;
    let skipped = 0;

    for (const digest of digests) {
      if (!digest.managerEmail) {
        skipped++;
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
      } catch (emailErr: any) {
        console.error(`[roster-intelligence] Failed to send to ${digest.managerEmail}:`, emailErr.message);
        skipped++;
      }
    }

    res.json({ sent, skipped, total: digests.length });
  } catch (err: any) {
    console.error('[roster-intelligence] send-manager-digests error:', err);
    res.status(500).json({ error: `Failed to send digests: ${err.message}` });
  }
});

/**
 * POST /api/roster-intelligence/send-unplanned-alerts
 * Send real-time alerts to managers for unplanned absences
 */
router.post('/send-unplanned-alerts', requireRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const gracePeriod = req.body.gracePeriod ? parseInt(String(req.body.gracePeriod), 10) : 30;
    const dryRun = req.body.dryRun === true;

    const alerts = await detectUnplannedAbsences(undefined, gracePeriod);

    // Group by manager
    const byManager = new Map<string, { email: string | null; name: string | null; alerts: typeof alerts }>();
    for (const alert of alerts) {
      const mgrId = alert.managerId ?? 'unassigned';
      if (!byManager.has(mgrId)) {
        byManager.set(mgrId, { email: alert.managerEmail, name: alert.managerName, alerts: [] });
      }
      byManager.get(mgrId)!.alerts.push(alert);
    }

    if (dryRun) {
      res.json({
        dryRun: true,
        totalAlerts: alerts.length,
        managers: [...byManager.entries()].map(([id, m]) => ({
          managerId: id,
          managerName: m.name,
          managerEmail: m.email,
          alertCount: m.alerts.length,
        })),
      });
      return;
    }

    // Send alerts
    const { emailService } = await import('../communication/email.service.js');
    let sent = 0;
    let skipped = 0;

    for (const [managerId, data] of byManager.entries()) {
      if (!data.email || managerId === 'unassigned') {
        skipped++;
        continue;
      }

      try {
        const html = formatUnplannedAlertEmail(data.name ?? 'Manager', data.alerts);
        await emailService.send({
          to: data.email,
          subject: `Alert: ${data.alerts.length} Team Member(s) Not Punched In`,
          html,
        });
        sent++;
      } catch (emailErr: any) {
        console.error(`[roster-intelligence] Failed to send alert to ${data.email}:`, emailErr.message);
        skipped++;
      }
    }

    res.json({ sent, skipped, totalAlerts: alerts.length });
  } catch (err: any) {
    console.error('[roster-intelligence] send-unplanned-alerts error:', err);
    res.status(500).json({ error: `Failed to send alerts: ${err.message}` });
  }
});

// ── Email Formatters ─────────────────────────────────────────────────────────

function formatManagerDigestEmail(digest: ManagerDailyDigest): string {
  const lines: string[] = [];

  lines.push(`<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`);
  lines.push(`<h2 style="color: #1e3a5f; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">Yesterday's Team Summary — ${digest.managerName}</h2>`);

  // Summary stats
  lines.push(`<div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">`);
  lines.push(`<p style="margin: 0; font-size: 14px;"><strong>Team Size:</strong> ${digest.teamSize} | <strong>Planned:</strong> ${digest.planned} | <strong>Present:</strong> ${digest.present} | <strong>Shrinkage:</strong> ${digest.shrinkagePct}%</p>`);
  lines.push(`</div>`);

  // Unplanned absences
  if (digest.unplannedAbsences.length > 0) {
    lines.push(`<h3 style="color: #dc2626; margin-top: 20px;">Unplanned Absences (${digest.unplannedAbsences.length})</h3>`);
    lines.push(`<ul style="margin: 0; padding-left: 20px;">`);
    for (const emp of digest.unplannedAbsences) {
      lines.push(`<li><strong>${emp.employeeName}</strong> (${emp.employeeCode}) — No punch, no leave</li>`);
    }
    lines.push(`</ul>`);
  }

  // Late arrivals
  if (digest.lateArrivals.length > 0) {
    lines.push(`<h3 style="color: #d97706; margin-top: 20px;">Late Arrivals (${digest.lateArrivals.length})</h3>`);
    lines.push(`<ul style="margin: 0; padding-left: 20px;">`);
    for (const emp of digest.lateArrivals) {
      lines.push(`<li><strong>${emp.employeeName}</strong> — ${emp.lateMinutes} min late</li>`);
    }
    lines.push(`</ul>`);
  }

  // Incomplete shifts
  if (digest.incompleteShifts.length > 0) {
    lines.push(`<h3 style="color: #9a3412; margin-top: 20px;">Incomplete Shifts (${digest.incompleteShifts.length})</h3>`);
    lines.push(`<ul style="margin: 0; padding-left: 20px;">`);
    for (const emp of digest.incompleteShifts) {
      lines.push(`<li><strong>${emp.employeeName}</strong> — Worked ${emp.workedPct}%</li>`);
    }
    lines.push(`</ul>`);
  }

  // APR pending
  if (digest.aprPending > 0) {
    lines.push(`<p style="margin-top: 20px; padding: 12px; background: #fef3c7; border-radius: 6px;"><strong>APR Pending:</strong> ${digest.aprPending} cases need your approval</p>`);
  }

  lines.push(`<p style="margin-top: 24px; font-size: 12px; color: #6b7280;">This is an automated report from MAS Callnet HRMS.</p>`);
  lines.push(`</div>`);

  return lines.join('\n');
}

function formatUnplannedAlertEmail(
  managerName: string,
  alerts: Awaited<ReturnType<typeof detectUnplannedAbsences>>
): string {
  const lines: string[] = [];

  lines.push(`<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`);
  lines.push(`<h2 style="color: #dc2626;">Alert: Team Members Not Punched In</h2>`);
  lines.push(`<p>Hi ${managerName},</p>`);
  lines.push(`<p>The following team members were rostered for a shift but have not punched in:</p>`);

  lines.push(`<table style="width: 100%; border-collapse: collapse; margin: 16px 0;">`);
  lines.push(`<tr style="background: #fee2e2;"><th style="padding: 8px; text-align: left; border: 1px solid #fca5a5;">Employee</th><th style="padding: 8px; text-align: left; border: 1px solid #fca5a5;">Shift</th><th style="padding: 8px; text-align: left; border: 1px solid #fca5a5;">Minutes Late</th></tr>`);

  for (const a of alerts) {
    lines.push(`<tr><td style="padding: 8px; border: 1px solid #fecaca;">${a.employeeName} (${a.employeeCode})</td><td style="padding: 8px; border: 1px solid #fecaca;">${a.shiftTime}</td><td style="padding: 8px; border: 1px solid #fecaca;">${a.minutesSinceShiftStart}</td></tr>`);
  }

  lines.push(`</table>`);
  lines.push(`<p>Please follow up with your team members or mark regularization if needed.</p>`);
  lines.push(`<p style="font-size: 12px; color: #6b7280;">This is an automated alert from MAS Callnet HRMS.</p>`);
  lines.push(`</div>`);

  return lines.join('\n');
}

export const rosterIntelligenceRouter = router;
