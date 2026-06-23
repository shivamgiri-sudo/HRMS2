import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import crypto, { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { authService } from "./auth.service.js";
import { emailService } from "../communication/email.service.js";
import { tableExists } from "../../shared/dbHelpers.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => fn(req, res).catch(next);

router.use(requireAuth);
router.use(requireRole("admin"));

type EmployeeRow = RowDataPacket & {
  id: string;
  employee_code?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  user_id?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  reporting_manager_id?: string | null;
  designation_name?: string | null;
  department_name?: string | null;
};

type InviteRow = RowDataPacket & {
  id: string;
  employee_id: string;
  user_id: string;
  email: string;
  employee_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

function tempPassword(): string {
  return crypto.randomBytes(12).toString("base64url") + "A1!";
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function employeeName(row: Partial<EmployeeRow | InviteRow>): string {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name || "Team Member";
}

function resetUrl(token: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

function inviteEmailHtml(input: { name: string; employeeCode?: string | null; link: string }) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
        <h2 style="margin:0;font-size:22px">Welcome to MAS Callnet HRMS</h2>
        <p style="margin:6px 0 0;color:#cbd5e1;font-size:13px">Your HRMS portal account is ready.</p>
      </div>
      <div style="padding:26px">
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Dear ${input.name},</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Your MAS Callnet HRMS login has been created. Please set your password using the secure link below.</p>
        ${input.employeeCode ? `<p style="font-size:14px;margin:0 0 18px"><b>Employee Code:</b> ${input.employeeCode}</p>` : ""}
        <p style="margin:24px 0"><a href="${input.link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;display:inline-block">Set HRMS Password</a></p>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">This link is valid for 24 hours. After setting your password, you can login using your Employee Code or official email ID.</p>
      </div>
    </div>
  </div>`;
}

function inviteEmailText(input: { name: string; employeeCode?: string | null; link: string }) {
  return `Dear ${input.name},\n\nYour MAS Callnet HRMS login has been created.\n${input.employeeCode ? `Employee Code: ${input.employeeCode}\n` : ""}\nSet your password here: ${input.link}\n\nThis link is valid for 24 hours. After setting your password, you can login using your Employee Code or official email ID.\n\nMAS Callnet HRMS`;
}


async function assignRole(userId: string, roleKey: string, _actorUserId: string) {
  const [roleRows] = await db.execute<RowDataPacket[]>("SELECT role_key FROM workforce_role_catalog WHERE role_key=? AND active_status=1 LIMIT 1", [roleKey]);
  if (!roleRows[0]) return;
  await db.execute(
    "INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE active_status=1",
    [randomUUID(), userId, roleKey]
  );
}

function inferRoles(row: EmployeeRow): string[] {
  const text = `${row.designation_name ?? ""} ${row.department_name ?? ""}`.toLowerCase();
  const roles = new Set<string>(["employee"]);
  if (text.includes("payroll")) roles.add("payroll");
  if (text.includes("finance")) roles.add("finance");
  if (text.includes("wfm")) roles.add("wfm");
  if (text.includes("trainer") || text.includes("training")) roles.add("trainer");
  if (text.includes("quality") || text.includes("qa")) roles.add("qa");
  if (text.includes("recruit")) roles.add("recruiter");
  if (text.includes("hr")) roles.add("hr");
  if (text.includes("branch head")) roles.add("branch_head");
  if (text.includes("manager")) roles.add("process_manager");
  if (text.includes("tl") || text.includes("team leader")) roles.add("team_leader");
  return Array.from(roles);
}

async function createInboxForRole(roleKey: string, title: string, description: string, priority = "normal") {
  try {
    const [users] = await db.execute<RowDataPacket[]>("SELECT DISTINCT user_id FROM user_roles WHERE role_key=? AND active_status=1 LIMIT 25", [roleKey]);
    for (const user of users) {
      await db.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, action_url, priority)
         VALUES (?, ?, 'LAUNCH_READINESS', ?, ?, 'auth_user', '/settings/access-control', ?)`,
        [randomUUID(), user.user_id, title, description, priority]
      );
    }
  } catch {
    // Non-fatal: launch bootstrap must not fail only because inbox table/routing is unavailable.
  }
}

async function addJourney(employeeId: string, eventType: string, description: string, userId?: string) {
  try {
    await db.execute(
      `INSERT INTO employee_journey_log (id, employee_id, event_type, event_date, description, module, triggered_by, metadata)
       VALUES (?, ?, ?, CURDATE(), ?, 'AUTH', ?, ?)`,
      [randomUUID(), employeeId, eventType, description, userId ?? null, JSON.stringify({ source: "launch_bootstrap" })]
    );
  } catch {
    // Non-fatal: journey table may not exist in older deployments.
  }
}

router.get("/email-config", h(async (_req, res) => {
  res.json({ success: true, data: emailService.safeConfig() });
}));

router.post("/email-config/test", h(async (req, res) => {
  const to = normalizeEmail(req.body?.to);
  if (!to) return res.status(400).json({ success: false, error: "Valid test email is required" });

  const link = env.FRONTEND_URL;
  const result = await emailService.send({
    to,
    subject: "MAS HRMS email configuration test",
    html: inviteEmailHtml({ name: "Admin", employeeCode: "TEST", link }),
    text: inviteEmailText({ name: "Admin", employeeCode: "TEST", link }),
  });
  res.json({ success: true, data: result });
}));

router.get("/launch-readiness", h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS active_employees,
       SUM(CASE WHEN e.user_id IS NULL THEN 1 ELSE 0 END) AS employees_without_user,
       SUM(CASE WHEN COALESCE(e.email, '') = '' THEN 1 ELSE 0 END) AS employees_without_email,
       SUM(CASE WHEN e.reporting_manager_id IS NULL THEN 1 ELSE 0 END) AS missing_manager,
       SUM(CASE WHEN e.branch_id IS NULL THEN 1 ELSE 0 END) AS missing_branch,
       SUM(CASE WHEN e.process_id IS NULL THEN 1 ELSE 0 END) AS missing_process
     FROM employees e
     WHERE e.active_status = 1`
  );
  res.json({ success: true, data: rows[0] });
}));

router.post("/bootstrap-existing-users", h(async (req, res) => {
  const dryRun = req.body?.dryRun === true;
  const runId = randomUUID();
  const [employees] = await db.execute<EmployeeRow[]>(
    `SELECT e.*, d.designation_name, dep.dept_name AS department_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dep ON dep.id = e.department_id
      WHERE e.active_status = 1
      ORDER BY e.employee_code`
  );

  const result = { runId, created: 0, updated: 0, skipped: 0, failed: 0, kpiAssigned: 0, kpiMissing: 0, invitesQueued: 0 };
  const hasKpiTables = await tableExists("kpi_employee_assignment") && await tableExists("kpi_role_template");

  for (const emp of employees) {
    const email = normalizeEmail(emp.email);
    const employeeId = String(emp.id);
    const employeeCode = String(emp.employee_code ?? "");
    try {
      if (!email || !employeeCode) {
        result.skipped++;
        if (!dryRun) await db.execute("INSERT INTO hrms_launch_bootstrap_log (id, run_id, employee_id, employee_code, status, message) VALUES (?, ?, ?, ?, 'skipped', ?)", [randomUUID(), runId, employeeId, employeeCode, "Missing official email or employee code"]);
        continue;
      }

      const [existing] = await db.execute<RowDataPacket[]>("SELECT id FROM auth_user WHERE email=? LIMIT 1", [email]);
      let userId = emp.user_id ? String(emp.user_id) : null;
      let status: "created" | "updated" = "updated";
      if (!userId && existing[0]?.id) userId = String(existing[0].id);

      if (!userId) {
        status = "created";
        userId = randomUUID();
        const hash = await bcrypt.hash(tempPassword(), 10);
        if (!dryRun) await db.execute("INSERT INTO auth_user (id, email, password_hash, must_change_password) VALUES (?, ?, ?, 1)", [userId, email, hash]);
      } else if (!dryRun) {
        await db.execute("UPDATE auth_user SET must_change_password=1 WHERE id=?", [userId]);
      }

      if (!dryRun) {
        await db.execute("UPDATE employees SET user_id=? WHERE id=?", [userId, employeeId]);
        for (const role of inferRoles(emp)) await assignRole(userId, role, req.authUser!.id);
        await db.execute("INSERT INTO hrms_launch_invite_log (id, employee_id, user_id, email, invite_status, message) VALUES (?, ?, ?, ?, 'pending', ?)", [randomUUID(), employeeId, userId, email, "Account prepared. Invite email pending."]);
        result.invitesQueued++;
        await addJourney(employeeId, "login_account_prepared", "HRMS login account prepared", req.authUser!.id);

        if (hasKpiTables && emp.process_id) {
          const roleCodes = inferRoles(emp);
          const placeholders = roleCodes.map(() => "?").join(",");
          const [templates] = await db.execute<RowDataPacket[]>(
            `SELECT rt.id FROM kpi_role_template rt JOIN kpi_process_template pt ON pt.id=rt.process_template_id
             WHERE pt.process_id=? AND pt.status='active' AND rt.status='active' AND rt.role_code IN (${placeholders})
             ORDER BY FIELD(rt.role_code, ${placeholders}), pt.effective_from DESC LIMIT 1`,
            [emp.process_id, ...roleCodes, ...roleCodes]
          );
          if (templates[0]) {
            await db.execute("INSERT INTO kpi_employee_assignment (id, employee_id, process_id, role_template_id, effective_from, assignment_type, created_by) VALUES (UUID(), ?, ?, ?, CURDATE(), 'auto', ?) ON DUPLICATE KEY UPDATE effective_to=NULL", [employeeId, emp.process_id, templates[0].id, req.authUser!.id]);
            result.kpiAssigned++;
          } else {
            result.kpiMissing++;
            await createInboxForRole("hr", "KPI template missing during launch", `Employee ${employeeCode} has no active process-role KPI template.`, "high");
          }
        }

        await db.execute("INSERT INTO hrms_launch_bootstrap_log (id, run_id, employee_id, employee_code, status, message) VALUES (?, ?, ?, ?, ?, ?)", [randomUUID(), runId, employeeId, employeeCode, status, "Employee login account prepared"]);
      }
      if (status === "created") result.created++; else result.updated++;
    } catch (error) {
      result.failed++;
      if (!dryRun) await db.execute("INSERT INTO hrms_launch_bootstrap_log (id, run_id, employee_id, employee_code, status, message) VALUES (?, ?, ?, ?, 'failed', ?)", [randomUUID(), runId, employeeId, employeeCode, error instanceof Error ? error.message : String(error)]);
    }
  }

  res.json({ success: true, data: result, dryRun });
}));

router.post("/send-invites", h(async (req, res) => {
  if (!emailService.isConfigured()) {
    return res.status(400).json({ success: false, error: "SMTP is not configured", data: emailService.safeConfig() });
  }

  const limit = Math.min(Number(req.body?.limit ?? 100), 500);
  const resend = req.body?.resend === true;
  const whereStatus = resend ? "invite_status IN ('pending','failed','sent')" : "invite_status IN ('pending','failed')";

  const [pendingRows] = await db.execute<InviteRow[]>(
    `SELECT il.id, il.employee_id, il.user_id, il.email, e.employee_code, e.first_name, e.last_name
       FROM hrms_launch_invite_log il
       LEFT JOIN employees e ON e.id = il.employee_id
      WHERE ${whereStatus}
      ORDER BY il.created_at ASC
      LIMIT ?`,
    [limit]
  );

  const result = { attempted: pendingRows.length, sent: 0, failed: 0, skipped: 0 };

  for (const invite of pendingRows) {
    try {
      const email = normalizeEmail(invite.email);
      if (!email || !invite.user_id) {
        result.skipped++;
        await db.execute("UPDATE hrms_launch_invite_log SET invite_status='skipped', message=? WHERE id=?", ["Missing email or user_id", invite.id]);
        continue;
      }

      const token = await authService.createPasswordResetTokenByUserId(invite.user_id, 24);
      const link = resetUrl(token);
      const name = employeeName(invite);
      await emailService.send({
        to: email,
        subject: "Set your MAS Callnet HRMS password",
        html: inviteEmailHtml({ name, employeeCode: invite.employee_code, link }),
        text: inviteEmailText({ name, employeeCode: invite.employee_code, link }),
      });

      await db.execute("UPDATE hrms_launch_invite_log SET invite_status='sent', message=? WHERE id=?", ["Invite email sent with 24-hour reset link", invite.id]);
      await addJourney(invite.employee_id, "login_invite_sent", "HRMS login invite email sent", req.authUser!.id);
      result.sent++;
    } catch (error) {
      result.failed++;
      await db.execute("UPDATE hrms_launch_invite_log SET invite_status='failed', message=? WHERE id=?", [error instanceof Error ? error.message : String(error), invite.id]);
    }
  }

  res.json({ success: true, data: result });
}));

export { router as authLaunchRouter };
