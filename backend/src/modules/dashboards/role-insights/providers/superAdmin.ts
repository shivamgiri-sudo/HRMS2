import { lastDays, num, one, rows, severityFor } from "../helpers.js";
import type { InsightAction, InsightContext, InsightKpi, InsightProvider, InsightSection, InsightSeries, InsightSignal } from "../types.js";
import { PENDENCY_CUTOFF_DATE } from "../../pendency-cutoff.js";
import { audit, branchRisk, dataQuality, errorRates, incidents, integrations, jobs, systems } from "./superAdminSections.js";
import { fillDays, formatAge, isDormant, PRIVILEGED_ROLES } from "./superAdminLogic.js";

/**
 * SUPER_ADMIN_DASHBOARD insights: platform mission control.
 *
 * Platform-wide by design (the dashboard is super_admin only): system tables carry no branch, and
 * the employee-keyed checks still go through empScope so a narrowed scope can never be widened here.
 * Pre-cutoff approvals are held back from the counts (owner ruling, see pendency-cutoff.ts) and the
 * held-back figure is returned in the hint so the number reconciles with a plain status query.
 */

const PRIV_LIST = PRIVILEGED_ROLES.map((r) => `'${r}'`).join(",");

function action(a: Omit<InsightAction, "severity"> & { severity?: InsightAction["severity"] }, high = 1, critical = 1_000_000): InsightAction {
  return { severity: severityFor(a.count, high, critical), ...a };
}

/** HR / workflow items that wait on an admin decision. */
async function approvals(ctx: InsightContext): Promise<InsightSection> {
  const [leave, leaveHeld, reg, stat, req, draft, exitRv, exp, expHeld, portal, inbox] = await Promise.all([
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(COALESCE(lr.applied_at, lr.created_at)), NOW()) AS oldest, COALESCE(SUM(lr.from_date < CURDATE()), 0) AS started
           FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
          WHERE LOWER(lr.status) = 'pending' AND lr.legacy_leave_id IS NULL AND COALESCE(lr.applied_at, lr.created_at) >= ?`, [PENDENCY_CUTOFF_DATE]),
    one(`SELECT COUNT(*) AS n FROM leave_request lr JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
          WHERE LOWER(lr.status) = 'pending' AND (lr.legacy_leave_id IS NOT NULL OR COALESCE(lr.applied_at, lr.created_at) < ?)`, [PENDENCY_CUTOFF_DATE]),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM attendance_regularization
          WHERE status IN ('pending', 'escalated') AND created_at >= ?`, [PENDENCY_CUTOFF_DATE]),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM profile_update_approval
          WHERE status = 'pending' AND request_type = 'statutory_details'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM job_requisition WHERE approval_status = 'pending_approval'`),
    one(`SELECT COUNT(*) AS n FROM job_requisition WHERE approval_status = 'draft'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM exit_request WHERE status = 'manager_review'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(ec.created_at), NOW()) AS oldest FROM expense_claim ec JOIN employees e ON e.id = ec.employee_id
          WHERE ec.status = 'submitted' AND ec.expense_type = 'employee_claim' AND ec.created_at >= ?`, [PENDENCY_CUTOFF_DATE]),
    one(`SELECT COUNT(*) AS n FROM expense_claim ec JOIN employees e ON e.id = ec.employee_id
          WHERE ec.status = 'submitted' AND ec.expense_type = 'employee_claim' AND ec.created_at < ?`, [PENDENCY_CUTOFF_DATE]),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM portal_data_approval_queue WHERE status = 'pending'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest, COALESCE(SUM(priority = 'urgent'), 0) AS urgent
           FROM work_inbox_item WHERE user_id = ? AND is_actioned = 0`, [ctx.userId]),
  ]);
  const held = (n: unknown) => (num(n) ? `${num(n)?.toLocaleString("en-IN")} older item(s) held back (before ${PENDENCY_CUTOFF_DATE})` : undefined);
  const actions: InsightAction[] = [
    action({ id: "leave", label: "Leave requests awaiting approval", count: num(leave?.n), oldestDays: num(leave?.oldest), href: "/leaves", group: "People",
      hint: [num(leave?.started) ? `${num(leave?.started)} already started` : null, held(leaveHeld?.n)].filter(Boolean).join(" · ") || undefined }, 1, 25),
    action({ id: "regularization", label: "Attendance regularizations", count: num(reg?.n), oldestDays: num(reg?.oldest), href: "/attendance-regularization", group: "People" }, 1, 40),
    action({ id: "statutory", label: "Statutory detail changes (PAN / UAN / ESIC)", count: num(stat?.n), oldestDays: num(stat?.oldest), href: "/statutory-change-approvals", group: "People" }, 1, 20),
    action({ id: "requisitions", label: "Job requisitions pending approval", count: num(req?.n), oldestDays: num(req?.oldest), href: "/recruitment/job-requisition", group: "Hiring",
      hint: num(draft?.n) ? `${num(draft?.n)} more still in draft (not submitted)` : undefined }, 1, 10),
    action({ id: "exit_review", label: "Resignations in manager review", count: num(exitRv?.n), oldestDays: num(exitRv?.oldest), href: "/exit/command-center", group: "People", severity: "normal" }),
    action({ id: "expense", label: "Employee expense claims submitted", count: num(exp?.n), oldestDays: num(exp?.oldest), href: "/payroll/reimbursements", group: "Finance", hint: held(expHeld?.n) }, 1, 50),
    action({ id: "portal_data", label: "Client-portal data awaiting approval", count: num(portal?.n), oldestDays: num(portal?.oldest), href: "/portal-data-manager", group: "Platform" }, 1, 10),
    action({ id: "my_inbox", label: "Your work inbox", count: num(inbox?.n), oldestDays: num(inbox?.oldest), href: "/work-inbox", group: "Platform",
      hint: num(inbox?.urgent) ? `${num(inbox?.urgent)} urgent` : undefined, severity: num(inbox?.urgent) ? "high" : (num(inbox?.n) ?? 0) > 0 ? "normal" : "info" }),
  ];
  return { actions };
}

/** Operational queues: payroll-blocking exceptions and integration backlogs. */
async function opsQueues(): Promise<InsightSection> {
  const [att, cosecQ, mapEx, tests, ticket] = await Promise.all([
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(issue_date), NOW()) AS oldest FROM attendance_reconciliation_issue
          WHERE resolved_at IS NULL AND severity = 'blocker' AND issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM cosec_user_sync_queue WHERE status = 'failed'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM integration_mapping_exception WHERE status = 'open'`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(test_at), NOW()) AS oldest FROM integration_config WHERE active_status = 1 AND test_ok = 0`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM helpdesk_ticket
          WHERE sla_breached = 1 AND status NOT IN ('resolved', 'closed', 'cancelled')`),
  ]);
  return {
    actions: [
      action({ id: "att_blockers", label: "Attendance blockers stopping payroll", count: num(att?.n), oldestDays: num(att?.oldest), href: "/wfm/attendance-exceptions", group: "Operations",
        hint: "Open blocker-severity issues, last 30 days" }, 1, 1),
      action({ id: "cosec_sync_failed", label: "COSEC user-provisioning failures", count: num(cosecQ?.n), oldestDays: num(cosecQ?.oldest), href: "/wfm/cosec-monitoring", group: "Operations",
        hint: "Employees whose biometric user could not be created" }, 1, 100),
      action({ id: "mapping_exceptions", label: "Integration mapping exceptions", count: num(mapEx?.n), oldestDays: num(mapEx?.oldest), href: "/integration-hub", group: "Platform" }, 1, 25),
      action({ id: "failing_tests", label: "Integrations failing their connection test", count: num(tests?.n), oldestDays: num(tests?.oldest), href: "/integration-hub", group: "Platform",
        hint: "oldest = days since the oldest failed test" }, 1, 5),
      action({ id: "sla_breached", label: "Helpdesk tickets past SLA", count: num(ticket?.n), oldestDays: num(ticket?.oldest), overdue: num(ticket?.n), href: "/helpdesk", group: "Operations" }, 1, 5),
    ],
  };
}

/** Authentication health: failed-login pressure, token reuse, lockouts, and recent privilege changes. */
async function security(ctx: InsightContext): Promise<InsightSection> {
  const days = lastDays(ctx.today, 14);
  const [daily, win, users, reuse, grants, types] = await Promise.all([
    rows(`SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS d, event_type, COUNT(*) AS n FROM security_audit_event
           WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY) AND event_type IN ('LOGIN_SUCCESS', 'LOGIN_FAILED') GROUP BY d, event_type`),
    one(`SELECT COALESCE(SUM(created_at >= NOW() - INTERVAL 1 DAY), 0) AS cur,
                COALESCE(SUM(created_at < NOW() - INTERVAL 1 DAY), 0) AS prev
           FROM security_audit_event WHERE event_type = 'LOGIN_FAILED' AND created_at >= NOW() - INTERVAL 2 DAY`),
    one(`SELECT COUNT(*) AS total, COALESCE(SUM(is_blocked = 1), 0) AS blocked, COALESCE(SUM(locked_until > NOW()), 0) AS locked,
                COALESCE(SUM(must_change_password = 1), 0) AS must_change FROM auth_user`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM security_audit_event
          WHERE event_type = 'TOKEN_REUSE_DETECTED' AND created_at >= NOW() - INTERVAL 7 DAY`),
    one(`SELECT COUNT(*) AS n FROM user_roles WHERE active_status = 1 AND role_key IN (${PRIV_LIST}) AND granted_at >= NOW() - INTERVAL 30 DAY`),
    rows(`SELECT event_type AS label, COUNT(*) AS value FROM security_audit_event WHERE created_at >= NOW() - INTERVAL 7 DAY GROUP BY event_type ORDER BY value DESC LIMIT 8`),
  ]);
  const byDay = new Map<string, Record<string, number>>();
  for (const r of daily) {
    const d = String(r.d);
    byDay.set(d, { ...(byDay.get(d) ?? {}), [String(r.event_type)]: num(r.n) ?? 0 });
  }
  const failedSpark = days.slice(-7).map((d) => byDay.get(d)?.LOGIN_FAILED ?? 0);
  const cur = num(win?.cur) ?? 0;
  const prev = num(win?.prev) ?? 0;
  const reuseN = num(reuse?.n) ?? 0;
  const kpis: InsightKpi[] = [
    { key: "failed_logins_24h", label: "Failed logins (24h)", value: cur, unit: "count", higherIsBetter: false, delta: cur - prev, deltaLabel: "vs previous 24h", spark: failedSpark,
      tone: cur >= 100 ? "red" : cur >= 30 ? "amber" : "green", href: "/security-center", formula: "security_audit_event rows with event_type LOGIN_FAILED in the last 24 hours." },
    { key: "locked_accounts", label: "Locked accounts now", value: num(users?.locked), unit: "count", higherIsBetter: false, tone: (num(users?.locked) ?? 0) > 0 ? "amber" : "green",
      href: "/settings/access-control", helper: `${num(users?.blocked) ?? 0} blocked by an admin`, formula: "auth_user.locked_until is in the future (5 failures lock for 15 minutes)." },
    { key: "token_reuse_7d", label: "Token-reuse alerts (7d)", value: reuseN, unit: "count", higherIsBetter: false, tone: reuseN > 0 ? "red" : "green", href: "/security-center",
      helper: "A reused refresh token can mean a stolen session", formula: "security_audit_event rows with event_type TOKEN_REUSE_DETECTED in the last 7 days." },
    { key: "privileged_grants_30d", label: "Privileged role grants (30d)", value: num(grants?.n), unit: "count", higherIsBetter: false, tone: (num(grants?.n) ?? 0) > 10 ? "amber" : "blue", href: "/settings/access-control",
      formula: `Active user_roles rows granted in the last 30 days for: ${PRIVILEGED_ROLES.join(", ")}.` },
  ];
  const series: InsightSeries[] = [
    { key: "logins_14d", title: "Sign-in outcomes", subtitle: "Successful vs failed, last 14 days", kind: "stacked", unit: "count", href: "/security-center",
      keys: [{ key: "LOGIN_SUCCESS", label: "Successful", tone: "green" }, { key: "LOGIN_FAILED", label: "Failed", tone: "red" }],
      points: fillDays(days, byDay, ["LOGIN_SUCCESS", "LOGIN_FAILED"]) },
    { key: "security_events_7d", title: "Security events by type", subtitle: "Last 7 days", kind: "donut", unit: "count", href: "/security-center",
      points: types.map((t) => ({ label: String(t.label), value: num(t.value) })) },
  ];
  const actions: InsightAction[] = [
    action({ id: "token_reuse", label: "Refresh-token reuse detections", count: reuseN, oldestDays: num(reuse?.oldest), href: "/security-center", group: "Security",
      hint: "Review the sessions and force re-login where needed" }, 1, 1),
  ];
  const signals: InsightSignal[] = [];
  if (reuseN > 0) signals.push({ tone: "bad", title: "Refresh-token reuse detected", detail: `${reuseN} detection(s) in 7 days. A reused token is the signature of a copied session.`, value: reuseN, href: "/security-center" });
  if (cur >= 30 && cur > prev * 1.5) signals.push({ tone: "watch", title: "Failed logins are climbing", detail: `${cur} in the last 24h against ${prev} the day before.`, value: cur, href: "/security-center" });
  return { kpis, series, actions, signals };
}

/** Accounts and roles: who can get in, who has not, and who has more access than a login record. */
async function users(): Promise<InsightSection> {
  const [priv, noRole, pending, recent] = await Promise.all([
    rows(`SELECT u.id, u.email, u.is_blocked, TIMESTAMPDIFF(DAY, u.last_login_at, NOW()) AS idle_d, u.last_login_at IS NULL AS never,
                 GROUP_CONCAT(DISTINCT r.role_key ORDER BY r.role_key SEPARATOR ', ') AS roles,
                 EXISTS (SELECT 1 FROM employees e WHERE e.user_id = u.id) AS linked
            FROM auth_user u JOIN user_roles r ON r.user_id = u.id AND r.active_status = 1 AND r.role_key IN (${PRIV_LIST})
           GROUP BY u.id, u.email, u.is_blocked, u.last_login_at`),
    one(`SELECT COUNT(*) AS n FROM auth_user u WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.active_status = 1)`),
    one(`SELECT COUNT(*) AS n, TIMESTAMPDIFF(DAY, MIN(created_at), NOW()) AS oldest FROM access_requests WHERE status = 'pending'`),
    rows(`SELECT u.email, r.role_key, DATE_FORMAT(r.granted_at, '%d %b %Y') AS granted, g.email AS granted_by
            FROM user_roles r JOIN auth_user u ON u.id = r.user_id LEFT JOIN auth_user g ON g.id = r.granted_by
           WHERE r.active_status = 1 AND r.role_key IN (${PRIV_LIST}) AND r.granted_at >= NOW() - INTERVAL 30 DAY
           ORDER BY r.granted_at DESC LIMIT 8`),
  ]);
  const live = priv.filter((p) => Number(p.is_blocked) !== 1);
  const dormant = live.filter((p) => isDormant(num(p.idle_d), Number(p.never) === 1));
  const unlinked = live.filter((p) => Number(p.linked) !== 1);
  const supers = priv.filter((p) => String(p.roles).split(", ").includes("super_admin")).length;
  const actions: InsightAction[] = [
    action({ id: "access_requests", label: "Page-access requests awaiting a decision", count: num(pending?.n), oldestDays: num(pending?.oldest), href: "/settings/access-control", group: "Access" }, 1, 10),
    action({ id: "dormant_privileged", label: "Dormant privileged accounts (30+ days or never signed in)", count: dormant.length, href: "/settings/access-control", group: "Access",
      hint: "Disable or re-confirm; an unused admin login is an open door" }, 1, 25),
    action({ id: "no_role", label: "Login accounts with no active role", count: num(noRole?.n), href: "/settings/access-control", group: "Access", severity: (num(noRole?.n) ?? 0) > 0 ? "normal" : "info" }),
  ];
  const kpis: InsightKpi[] = [
    { key: "privileged_accounts", label: "Privileged accounts", value: live.length, unit: "count", higherIsBetter: false, tone: "violet", href: "/settings/access-control",
      helper: `${supers} super admin · ${unlinked.length} not linked to an employee`, formula: `Unblocked accounts holding any of: ${PRIVILEGED_ROLES.join(", ")}.` },
    { key: "dormant_privileged", label: "Dormant admins", value: dormant.length, unit: "count", higherIsBetter: false, tone: dormant.length ? "amber" : "green", href: "/settings/access-control",
      formula: "Privileged accounts never signed in, or idle 30+ days." },
  ];
  const signals: InsightSignal[] = [];
  if (dormant.length) signals.push({ tone: "watch", title: `${dormant.length} privileged account(s) dormant`, detail: "No sign-in for 30+ days (or never). Review whether they still need access.", value: dormant.length, href: "/settings/access-control" });
  if (supers > 4) signals.push({ tone: "watch", title: `${supers} super admins`, detail: "Every super admin can change access for everyone. Keep this list short.", value: supers, href: "/settings/access-control" });
  return {
    actions, kpis, signals,
    tables: [
      {
        key: "dormant_admins", title: "Dormant privileged accounts",
        columns: [{ key: "email", label: "Account" }, { key: "roles", label: "Roles" }, { key: "idle", label: "Last sign-in" }],
        rows: dormant.sort((a, b) => (num(b.idle_d) ?? 99_999) - (num(a.idle_d) ?? 99_999)).slice(0, 8)
          .map((p) => ({ email: String(p.email), roles: String(p.roles), idle: Number(p.never) === 1 ? "never" : formatAge((num(p.idle_d) ?? 0) * 1440), href: "/settings/access-control" })),
        href: "/settings/access-control",
      },
      {
        key: "recent_grants", title: "Recent privileged grants (30d)",
        columns: [{ key: "email", label: "Account" }, { key: "role", label: "Role" }, { key: "granted", label: "Granted" }, { key: "by", label: "By" }],
        rows: recent.map((r) => ({ email: String(r.email), role: String(r.role_key), granted: String(r.granted), by: r.granted_by ? String(r.granted_by) : "—", href: "/settings/access-control" })),
        href: "/settings/access-control",
      },
    ],
  };
}

const provider: InsightProvider = {
  sections: { systems, integrations, jobs, errorRates, incidents, approvals, opsQueues, security, users, dataQuality, audit, branchRisk },
};

export default provider;
