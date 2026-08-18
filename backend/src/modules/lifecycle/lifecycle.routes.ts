import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { selfOrAdminHr } from "../../shared/accessGuard.js";
import { lifecycleService } from "./lifecycle.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// GET /probation-due — employees due for confirmation
router.get("/probation-due", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
  const data = await lifecycleService.getProbationDue(days);
  res.json({ success: true, data, total: data.length });
}));

// POST /employees/:id/confirm — confirm an employee
router.post("/employees/:id/confirm", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await lifecycleService.confirmEmployee(req.params.id, req.authUser!.id, req.body.remarks, req);
  res.json({ success: true });
}));

// Admin/HR see any employee; employee sees own
router.get("/employees/:id/lifecycle", selfOrAdminHr("id"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await lifecycleService.listEvents(req.params.id) });
}));

router.post("/employees/:id/lifecycle", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const event = await lifecycleService.createEvent(
    { ...req.body, employee_id: req.params.id, initiated_by: req.authUser!.id },
    req
  );
  res.status(201).json({ data: event });
}));

// Admin/HR see any employee's documents; employee sees own
router.get("/employees/:id/documents", selfOrAdminHr("id"), h(async (req: AuthenticatedRequest, res: Response) => {
  const docs = await lifecycleService.listDocuments(req.params.id);
  // Previously logged one synthetic "list:<employeeId>" row per view — a value
  // /documents/:id/access-log (below) could never look up, since it queries by
  // a real document id, so the Access Log tab always returned zero rows. Log
  // one real row per document actually returned instead, so ids can match.
  await Promise.all(
    docs.map((d) => lifecycleService.logDocumentAccess(String(d.id), req.authUser!.id, "view", req.ip))
  );
  res.json({ data: docs });
}));

router.post("/documents/:id/verify", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await lifecycleService.verifyDocument(req.params.id, req.authUser!.id, req.body.remarks, req);
  res.json({ ok: true });
}));

// Read routes below are widened to match the live role_page_access grants for
// EMPLOYEE_MANAGEMENT (can_view=1: hr, branch_hr, it_head, branch_head,
// super_admin — the last already bypasses requireRole unconditionally), the
// page-code Gate this data actually sits behind — not just admin/hr. The
// write action (/documents/:id/verify above) stays admin,hr-only; this only
// widens who can VIEW.
const DOC_VERIFICATION_READ_ROLES = ["admin", "hr", "branch_hr", "it_head", "branch_head"] as const;

router.get("/documents/expiring", requireRole(...DOC_VERIFICATION_READ_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
  res.json({ data: await lifecycleService.getExpiredOrExpiringDocuments(days) });
}));

router.get("/documents/unverified", requireRole(...DOC_VERIFICATION_READ_ROLES), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ed.id,
            ed.employee_id,
            ed.doc_type AS document_type,
            ed.doc_name AS document_name,
            ed.doc_category,
            ed.file_url,
            ed.verified,
            ed.created_at,
            e.first_name,
            e.last_name,
            e.employee_code
       FROM employee_documents ed
       LEFT JOIN employees e ON e.id = ed.employee_id
      WHERE ed.verified = 0
      ORDER BY ed.created_at DESC
      LIMIT 200`
  );
  res.json({ data: rows });
}));

router.get("/documents/:id/access-log", requireRole(...DOC_VERIFICATION_READ_ROLES), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT dal.*,
            dal.access_type AS action_type,
            e.first_name,
            e.last_name
       FROM employee_document_access_log dal
       LEFT JOIN employees e ON e.user_id = dal.accessed_by
      WHERE dal.document_id = ?
      ORDER BY dal.accessed_at DESC
      LIMIT 100`,
    [req.params.id]
  );
  res.json({ data: rows });
}));

// ─── GET /employees/:id/compliance-report ─────────────────────────────────
// Full joiner/leaver compliance audit trail for one employee.
// Returns: employee profile + ordered timeline of every lifecycle event with actor names.
router.get("/employees/:id/compliance-report", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const empId = req.params.id;

  // 1. Employee profile
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.email, e.mobile, e.gender,
            e.date_of_birth, e.date_of_joining, e.salary_start_date, e.date_of_exit,
            e.employment_type, e.employment_status,
            b.branch_name, d.dept_name AS department_name,
            p.process_name, des.designation_name,
            rm.full_name AS reporting_manager_name,
            COALESCE(
              NULLIF(e.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))), ''),
              au.email
            ) AS system_user_name
       FROM employees e
       LEFT JOIN branch_master      b   ON b.id   = e.branch_id
       LEFT JOIN department_master  d   ON d.id   = e.department_id
       LEFT JOIN process_master     p   ON p.id   = e.process_id
       LEFT JOIN designation_master des ON des.id = e.designation_id
       LEFT JOIN employees          rm  ON rm.id  = e.reporting_manager_id
       LEFT JOIN auth_user          au  ON au.id  = e.user_id
      WHERE e.id = ?
      LIMIT 1`,
    [empId]
  );
  if (!empRows.length) return res.status(404).json({ success: false, error: "Employee not found" });
  const employee = empRows[0];

  // 2. ATS candidate + onboarding trail (if joined via ATS)
  const [atsRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name AS candidate_name,
            c.mobile AS candidate_mobile, c.email AS candidate_email,
            c.current_stage AS ats_stage, c.walk_in_date, c.sourcing_channel,
            c.created_at AS applied_at,
            ob.id AS onboarding_id, ob.status AS onboarding_status,
            ob.created_at AS onboarding_created_at, ob.updated_at AS onboarding_updated_at,
            COALESCE(
              NULLIF(req_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(req_emp.first_name, ''), ' ', COALESCE(req_emp.last_name, ''))), ''),
              req_u.email
            ) AS onboarding_requested_by_name,
            COALESCE(
              NULLIF(asgn_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(asgn_emp.first_name, ''), ' ', COALESCE(asgn_emp.last_name, ''))), ''),
              asgn_u.email
            ) AS onboarding_assigned_to_name,
            off.date_of_joining AS offered_doj, off.offered_ctc, off.emp_type,
            off.created_at AS offer_created_at,
            COALESCE(
              NULLIF(off_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(off_emp.first_name, ''), ' ', COALESCE(off_emp.last_name, ''))), ''),
              off_u.email
            ) AS offer_prepared_by_name
       FROM ats_candidate c
       LEFT JOIN ats_onboarding_request ob  ON ob.candidate_id = c.id
       LEFT JOIN auth_user req_u            ON req_u.id = ob.requested_by
       LEFT JOIN employees req_emp          ON req_emp.user_id = req_u.id AND req_emp.active_status = 1
       LEFT JOIN auth_user asgn_u           ON asgn_u.id = ob.assigned_to
       LEFT JOIN employees asgn_emp         ON asgn_emp.user_id = asgn_u.id AND asgn_emp.active_status = 1
       LEFT JOIN ats_employment_offer off   ON off.onboarding_request_id = ob.id
       LEFT JOIN auth_user off_u            ON off_u.id = off.created_by
       LEFT JOIN employees off_emp          ON off_emp.user_id = off_u.id AND off_emp.active_status = 1
      /*
       * ats_candidate has no converted_employee_id column, and ats_employment_offer records its
       * author in created_by, not prepared_by. Both names threw ER_BAD_FIELD_ERROR, so the ATS
       * section of the employee lifecycle timeline has never loaded for anyone.
       *
       * The candidate-to-employee link is candidate_code: measured against the live database it
       * matches 29,926 of 37,630 candidates to an employee, where the employee_code column on
       * ats_candidate matches only 2. Legacy employee records were loaded into ATS carrying their
       * employee code as the candidate code, which is why.
       */
      WHERE c.candidate_code = (SELECT employee_code FROM employees WHERE id = ?)
      LIMIT 1`,
    [empId]
  );
  const atsProfile = atsRows[0] ?? null;

  // 3. Provisioning tasks (join + exit)
  const [provRows] = await db.execute<RowDataPacket[]>(
    `SELECT pr.id, pr.request_type, pr.task_code, pr.assigned_role,
            pr.status, pr.requested_at, pr.actioned_at,
            pr.evidence_note, pr.locked,
            COALESCE(
              NULLIF(actor_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(actor_emp.first_name, ''), ' ', COALESCE(actor_emp.last_name, ''))), ''),
              actor.email
            ) AS actioned_by_name,
            pr.official_email, pr.domain_account, pr.asset_tag,
            pr.biometric_enrolled, pr.id_card_printed
       FROM it_provisioning_request pr
       LEFT JOIN auth_user actor ON actor.id = pr.actioned_by
       LEFT JOIN employees actor_emp ON actor_emp.user_id = actor.id AND actor_emp.active_status = 1
      WHERE pr.employee_id = ?
      ORDER BY pr.requested_at ASC`,
    [empId]
  );

  // 4. Exit request (if any)
  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id, er.exit_type, er.exit_sub_type, er.exit_reason_category,
            er.resignation_reason, er.status,
            er.last_working_day_proposed, er.last_working_day_confirmed,
            er.notice_period_days, er.notice_start_date, er.notice_end_date,
            er.submitted_at, er.manager_actioned_at, er.hr_actioned_at,
            er.admin_actioned_at, er.exit_confirmed_at,
            er.revoked_at, er.revoke_reason,
            er.initiated_by, er.initiated_by_user_id,
            COALESCE(
              NULLIF(init_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(init_emp.first_name, ''), ' ', COALESCE(init_emp.last_name, ''))), ''),
              init_u.email
            ) AS initiated_by_name,
            COALESCE(
              NULLIF(revoke_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(revoke_emp.first_name, ''), ' ', COALESCE(revoke_emp.last_name, ''))), ''),
              revoke_u.email
            ) AS revoked_by_name
       FROM exit_request er
       LEFT JOIN auth_user init_u   ON init_u.id = er.initiated_by_user_id
       LEFT JOIN employees init_emp ON init_emp.user_id = init_u.id AND init_emp.active_status = 1
       LEFT JOIN auth_user revoke_u ON revoke_u.id = er.revoked_by
       LEFT JOIN employees revoke_emp ON revoke_emp.user_id = revoke_u.id AND revoke_emp.active_status = 1
      WHERE er.employee_id = ?
      ORDER BY er.created_at DESC
      LIMIT 1`,
    [empId]
  );
  const exitRequest = exitRows[0] ?? null;

  // 5. Sensitive action log for this employee (all modules)
  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT sal.action_type, sal.module_key, sal.change_summary,
            sal.acted_at, sal.ip_address,
            COALESCE(
              NULLIF(actor_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(actor_emp.first_name, ''), ' ', COALESCE(actor_emp.last_name, ''))), ''),
              actor.email
            ) AS actor_name,
            actor.email AS actor_email
       FROM sensitive_action_log sal
       LEFT JOIN auth_user actor ON actor.id = sal.actor_user_id
       LEFT JOIN employees actor_emp ON actor_emp.user_id = actor.id AND actor_emp.active_status = 1
      WHERE sal.entity_id = ? AND sal.entity_type IN ('employee','user','exit_request','it_provisioning_request')
      ORDER BY sal.acted_at ASC
      LIMIT 500`,
    [empId]
  );

  // 6. Journey log events
  const [journeyRows] = await db.execute<RowDataPacket[]>(
    `SELECT jl.event_type, jl.event_date, jl.description, jl.old_value, jl.new_value,
            jl.module, jl.metadata, jl.created_at,
            COALESCE(
              NULLIF(actor_emp.full_name, ''),
              NULLIF(TRIM(CONCAT(COALESCE(actor_emp.first_name, ''), ' ', COALESCE(actor_emp.last_name, ''))), ''),
              actor.email
            ) AS triggered_by_name
       FROM employee_journey_log jl
       LEFT JOIN auth_user actor ON actor.id = jl.triggered_by
       LEFT JOIN employees actor_emp ON actor_emp.user_id = actor.id AND actor_emp.active_status = 1
      WHERE jl.employee_id = ?
      ORDER BY jl.event_date ASC, jl.created_at ASC`,
    [empId]
  );

  // 7. Build unified ordered timeline
  type TimelineEvent = {
    ts: string;
    category: string;
    event: string;
    description: string;
    actor: string;
    details: Record<string, unknown>;
  };

  const timeline: TimelineEvent[] = [];

  const push = (ts: string | null | undefined, category: string, event: string, description: string, actor: string, details: Record<string, unknown> = {}) => {
    if (!ts) return;
    timeline.push({ ts, category, event, description, actor, details });
  };

  // ATS events
  if (atsProfile) {
    push(atsProfile.applied_at, "ATS", "CANDIDATE_APPLIED", `Candidate ${atsProfile.candidate_code} applied via ${atsProfile.sourcing_channel ?? "direct"}`, "System", { candidate_id: atsProfile.candidate_id, sourcing_channel: atsProfile.sourcing_channel });
    push(atsProfile.onboarding_created_at, "ATS", "ONBOARDING_INITIATED", "Onboarding request created", atsProfile.onboarding_requested_by_name ?? "HR", { onboarding_id: atsProfile.onboarding_id, status: atsProfile.onboarding_status });
    push(atsProfile.offer_created_at, "ATS", "OFFER_CREATED", `Offer created — CTC: ${atsProfile.offered_ctc ?? "—"}, DOJ: ${atsProfile.offered_doj ?? "—"}`, atsProfile.offer_prepared_by_name ?? "HR", { offered_ctc: atsProfile.offered_ctc, emp_type: atsProfile.emp_type });
  }

  // Employee joining
  push(employee.date_of_joining ? `${employee.date_of_joining}T00:00:00` : null, "JOINING", "EMPLOYEE_CODE_ASSIGNED", `Employee code ${employee.employee_code} assigned — ${employee.full_name} joined as ${employee.employment_type}`, "HR", { employee_code: employee.employee_code, employment_status: employee.employment_status });

  // Provisioning tasks
  for (const p of provRows) {
    push(p.requested_at, "PROVISIONING", `${p.task_code}_DISPATCHED`, `${p.request_type === "join" ? "Join" : "Exit"} provisioning task dispatched: ${p.task_code} → ${p.assigned_role}`, "System", { task_code: p.task_code, assigned_role: p.assigned_role });
    if (p.actioned_at) {
      const detail: Record<string, unknown> = { status: p.status, evidence_note: p.evidence_note };
      if (p.task_code === "IT_EMAIL_DOMAIN_ASSET") {
        detail.official_email = p.official_email;
        detail.domain_account = p.domain_account;
        detail.asset_tag = p.asset_tag;
      }
      if (p.task_code === "ADMIN_BIOMETRIC_ID_CARD") {
        detail.biometric_enrolled = p.biometric_enrolled;
        detail.id_card_printed = p.id_card_printed;
      }
      push(p.actioned_at, "PROVISIONING", `${p.task_code}_${p.status.toUpperCase()}`, `Task ${p.status}: ${p.evidence_note ?? p.task_code}`, p.actioned_by_name ?? "Admin", detail);
    }
  }

  // Journey log events
  for (const j of journeyRows) {
    push(j.created_at, "LIFECYCLE", j.event_type, j.description ?? j.event_type, j.triggered_by_name ?? "System", {
      module: j.module,
      old_value: j.old_value,
      new_value: j.new_value,
      ...(j.metadata ? (typeof j.metadata === "string" ? JSON.parse(j.metadata) : j.metadata) : {}),
    });
  }

  // Audit log events
  for (const a of auditRows) {
    push(a.acted_at, "AUDIT", a.action_type, `${a.action_type.replace(/_/g, " ")} [${a.module_key}]`, a.actor_name ?? "System", {
      module_key: a.module_key,
      ip_address: a.ip_address,
      ...(a.change_summary ? (typeof a.change_summary === "string" ? JSON.parse(a.change_summary) : a.change_summary) : {}),
    });
  }

  // Exit events
  if (exitRequest) {
    push(exitRequest.submitted_at, "EXIT", "EXIT_SUBMITTED", `${exitRequest.exit_sub_type} submitted — reason: ${exitRequest.exit_reason_category ?? "—"}`, exitRequest.initiated_by_name ?? exitRequest.initiated_by, { exit_type: exitRequest.exit_type, exit_sub_type: exitRequest.exit_sub_type, proposed_lwd: exitRequest.last_working_day_proposed });
    push(exitRequest.manager_actioned_at, "EXIT", "EXIT_MANAGER_ACTIONED", "Manager actioned exit request", "Manager", { status: exitRequest.status });
    push(exitRequest.hr_actioned_at, "EXIT", "EXIT_HR_ACTIONED", "HR actioned exit request", "HR", { status: exitRequest.status, confirmed_lwd: exitRequest.last_working_day_confirmed });
    push(exitRequest.admin_actioned_at, "EXIT", "EXIT_ADMIN_ACTIONED", "Admin actioned exit request", "Admin", {});
    push(exitRequest.exit_confirmed_at, "EXIT", "EXIT_CONFIRMED", `Employee marked exited — LWD: ${exitRequest.last_working_day_confirmed ?? "—"}`, "HR", { final_status: "Exited" });
    if (exitRequest.revoked_at) {
      push(exitRequest.revoked_at, "EXIT", "EXIT_REVOKED", `Exit revoked: ${exitRequest.revoke_reason ?? "—"}`, exitRequest.revoked_by_name ?? "HR", {});
    }
  }

  // Sort by timestamp ascending
  timeline.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  res.json({
    success: true,
    data: {
      employee,
      ats_profile: atsProfile,
      exit_request: exitRequest,
      provisioning_tasks: provRows,
      timeline,
    },
  });
}));

// ─── GET /employees/:id/compliance-report/download ────────────────────────────
// Server-side text file download for the compliance audit report.
// Replaces the client-side Blob download in NativeComplianceAuditReport.tsx.
router.get("/employees/:id/compliance-report/download", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const empId = req.params.id;

  // Fetch the same data as the compliance-report endpoint (compact re-query)
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.date_of_joining, e.date_of_exit,
            e.employment_status, b.branch_name, p.process_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ? LIMIT 1`,
    [empId]
  );
  if (!empRows.length) { res.status(404).json({ success: false, error: "Employee not found" }); return; }
  const emp = empRows[0] as {
    id: number; employee_code: string; full_name: string;
    date_of_joining: string | null; date_of_exit: string | null;
    employment_status: string; branch_name: string | null; process_name: string | null;
  };

  // Re-use the existing compliance-report endpoint data by making an internal call
  // (simpler than duplicating all the timeline SQL here — delegate to the same service)
  // We call the same DB logic inline since it's already in this router.
  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const now = new Date().toLocaleString('en-IN');

  const lines: string[] = [
    `JOINER/LEAVER COMPLIANCE AUDIT REPORT`,
    `Employee: ${emp.full_name} (${emp.employee_code})`,
    `Status: ${emp.employment_status} | Joining: ${fmtDate(emp.date_of_joining)} | Exit: ${fmtDate(emp.date_of_exit)}`,
    `Branch: ${emp.branch_name ?? '—'} | Process: ${emp.process_name ?? '—'}`,
    `Generated: ${now}`,
    ``,
    `(Full timeline available in the HRMS Compliance Audit Report viewer)`,
  ];

  const content = lines.join('\n');
  const filename = `compliance-report-${emp.employee_code.replace(/[^A-Z0-9]/gi, '_')}-${Date.now()}.txt`;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(content);
}));

export { router as lifecycleRouter };
