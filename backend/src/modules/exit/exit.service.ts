import { randomUUID } from "crypto";
import { employmentStatusForExit } from "./exitEmploymentStatus.js";
import nodemailer from "nodemailer";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { sendSMS } from "../communication/sms.helper.js";
import type { ExitRequest, ExitStats, PaginatedResult } from "./exit.types.js";
import { createDefaultClearanceTasks, createExitHealthSnapshot } from "./exit-intelligence.service.js";
import { notifyResignationSubmitted, notifyResignationDecision } from "./exit.notifications.js";
import { revokeSessionsForEmployee } from "../../shared/sessionRevocation.js";
import { recordExitFollowUpFailure } from "./exit-followup-recovery.js";
import { deprovisionEmployeeAccess } from "../../shared/employeeDeprovisioning.js";
import { triggerResignationPendingReview } from "../work-inbox/work-inbox.triggers.js";
import { recordManagerChange } from "../management/manager-attribution.service.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";
import { upsertOpenWorkItem } from "../../shared/workItem.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// Singleton transporter — created once at module load, not per-call
const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

async function notifyManagerOfResignation(employeeId: string, exitRequestId: string) {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.first_name, e.last_name, e.email AS emp_email,
              m.first_name AS mgr_first, m.last_name AS mgr_last, m.email AS mgr_email
         FROM employees e
         LEFT JOIN employees m ON m.id = e.reporting_manager_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (rows as RowDataPacket[])[0];
    if (!emp?.mgr_email) return; // no manager email — skip silently

    await mailer.sendMail({
      from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM}>`,
      to: emp.mgr_email,
      subject: `Resignation Notice — ${emp.first_name} ${emp.last_name}`,
      html: `<p>Dear ${emp.mgr_first ?? 'Manager'},</p>
             <p><strong>${emp.first_name} ${emp.last_name}</strong> has submitted a resignation request.</p>
             <p>Please log in to HRMS to review and action this request.</p>
             <p style="color:#888;font-size:12px">Exit Request ID: ${exitRequestId}</p>`,
    });
  } catch (err) {
    logger.error({ err }, '[exit] manager notification email failed');
  }
}

function normalizeStatus(status: string) {
  return status === "exit_confirmed" ? "exited" : status;
}

/**
 * Tell the people who carry the consequences that a notice period was changed from policy.
 *
 * One work item per audience, each with its own item_type. createWorkItemIfNotExists dedupes on
 * (entityType, entityId, itemType) among pending items, so sharing a type across audiences would
 * collapse them into one and only the first would ever be told — the same trap the absconding
 * alert pair documents.
 *
 * Non-throwing by construction: the caller invokes this post-commit and the exit stands whether
 * or not anybody is notified. Failures are logged by the caller.
 */
async function notifyNoticePeriodOverride(
  exitRequestId: string,
  employeeId: string,
  previousDays: number,
  newDays: number,
  actorUserId: string,
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(e.full_name), ''), e.employee_code) AS employee_name,
            e.employee_code, e.branch_id
       FROM employees e WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = rows[0] as { employee_name?: string; employee_code?: string; branch_id?: string } | undefined;
  const who = emp?.employee_name ?? emp?.employee_code ?? employeeId;

  const description =
    `Notice period changed from ${previousDays} to ${newDays} day(s) on the exit for ${who}. ` +
    `The company standard is 30 days. This figure sets the notice window and drives the ` +
    `notice-shortfall recovery deducted from the final settlement, so the change affects what ` +
    `this employee is paid.`;

  // Same event, three audiences, three item types — see the note above on dedup.
  const targets: Array<{ itemType: string; role: string; moduleCode: string }> = [
    { itemType: "NOTICE_PERIOD_OVERRIDE_OPS", role: "process_manager", moduleCode: "exit" },
    { itemType: "NOTICE_PERIOD_OVERRIDE_OPS_HEAD", role: "operations_head", moduleCode: "exit" },
    { itemType: "NOTICE_PERIOD_OVERRIDE_PAYROLL", role: "payroll", moduleCode: "payroll" },
  ];

  for (const t of targets) {
    try {
      await upsertOpenWorkItem({
        itemType: t.itemType,
        title: `Notice period overridden (${previousDays} → ${newDays} days): ${who}`,
        description,
        moduleCode: t.moduleCode,
        entityType: "exit_request",
        entityId: exitRequestId,
        assignedToRole: t.role,
        priority: "high",
      });
    } catch (err) {
      // One unreachable audience must not stop the others being told.
      logger.warn({ err, itemType: t.itemType, exitRequestId }, '[exit] notice-override alert not raised');
    }
  }

  await logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: "EXIT_NOTICE_PERIOD_OVERRIDDEN",
    module_key: "exit",
    entity_type: "exit_request",
    entity_id: exitRequestId,
    change_summary: {
      employee_id: employeeId,
      previous_notice_period_days: previousDays,
      new_notice_period_days: newDays,
      company_standard_days: 30,
    },
  });
}

/**
 * A concurrent actor moved the exit request out from under this request.
 *
 * statusCode is mandatory, not decoration: the production error handler replaces the
 * message of any throw that does not carry one, so a bare Error would reach the user
 * as a generic 500 and the caller would have no way to tell "someone else already
 * actioned this" from "the server broke".
 */
function exitStateChanged(message: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(message), { statusCode: 409, code: "EXIT_STATE_CHANGED" });
}

export const exitService = {
  async listExitRequests(filters: {
    status?: string;
    employeeId?: string;
    branchId?: string;
    processId?: string;
    search?: string;
    page: number;
    limit: number;
  }): Promise<PaginatedResult<ExitRequest>> {
    const { page, limit, status, employeeId, branchId, processId, search } = filters;
    const offset = (page - 1) * limit;
    const conds: string[] = [];
    const params: unknown[] = [];

    if (employeeId) { conds.push("er.employee_id = ?"); params.push(employeeId); }
    if (status)     { conds.push("er.status = ?");      params.push(normalizeStatus(status)); }
    if (branchId)   { conds.push("e.branch_id = ?");    params.push(branchId); }
    if (processId)  { conds.push("e.process_id = ?");   params.push(processId); }
    if (search) {
      conds.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
      const q = `%${search}%`;
      params.push(q, q, q, q);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*,
              e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name,
              p.process_name,
              dept.dept_name AS department_name,
              CONCAT_WS(' ', mgr.first_name, mgr.last_name) AS reporting_manager_name,
              hs.engagement_score,
              hs.regrettable_exit,
              hs.risk_label,
              COALESCE(clearance.total_tasks, 0) AS clearance_total,
              COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared,
              er.initiated_by AS submitted_by,
              er.created_at AS submitted_at,
              CASE WHEN er.status != 'draft' THEN 1 ELSE 0 END AS notification_sent,
              COALESCE(mgr.email, '') AS notification_recipient,
              COALESCE(pending_clearance.owner_role, '') AS pending_with,
              CASE
                WHEN er.status IN ('exited','revoked','rejected') THEN 'closed'
                WHEN DATEDIFF(NOW(), er.created_at) > 7 THEN 'overdue'
                ELSE 'on_track'
              END AS escalation_status
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
         LEFT JOIN department_master dept ON dept.id = e.department_id
         LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
         LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id
         LEFT JOIN (
           SELECT exit_request_id,
                  COUNT(*) AS total_tasks,
                  SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks
             FROM exit_clearance_task GROUP BY exit_request_id
         ) clearance ON clearance.exit_request_id = er.id
         LEFT JOIN (
           SELECT exit_request_id, owner_role
             FROM (
               SELECT exit_request_id, owner_role,
                      ROW_NUMBER() OVER (PARTITION BY exit_request_id ORDER BY created_at ASC) AS rn
                 FROM exit_clearance_task
                WHERE status NOT IN ('cleared','waived')
             ) ranked
            WHERE rn = 1
         ) pending_clearance ON pending_clearance.exit_request_id = er.id
         ${where}
        ORDER BY er.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id ${where}`,
      params
    );

    return {
      data: rows as ExitRequest[],
      total: Number((countRows as { total: number }[])[0]?.total ?? 0),
      page,
      limit,
    };
  },

  async getExitRequest(id: string): Promise<ExitRequest> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT er.*,
              e.employee_code,
              CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
              b.branch_name,
              p.process_name
         FROM exit_request er
         LEFT JOIN employees e ON e.id = er.employee_id
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN process_master p ON p.id = e.process_id
        WHERE er.id = ? LIMIT 1`,
      [id]
    );
    const rec = (rows as ExitRequest[])[0];
    if (!rec) throw new Error("Exit request not found");
    return rec;
  },

  async createExitRequest(
    input: {
      employeeId: string;
      exitDate: string;
      exitType: string;
      exitSubType?: string | null;
      exitReasonCategory?: string | null;
      /**
       * Last date the employee actually worked. Required for absconding/abandonment.
       *
       * This IS their last working day — the 7-day no-show window is how long the company waits
       * before deciding, not time they are paid for (owner ruling 2026-09-12).
       */
      abscondingSince?: string | null;
      reason?: string | null;
      noticePeriodDays?: number;
      /**
       * Who raised this exit: 'employee' | 'manager' | 'hr' — the vocabulary
       * exit_request.initiated_by was declared with (sql/011_exit_management.sql).
       *
       * Supplied by the route, which is the only layer that knows whether the caller is
       * acting on themselves or on someone else. Defaults to 'employee' so no existing
       * caller changes behaviour by omitting it.
       */
      initiatedBy?: "employee" | "manager" | "hr";
    },
    userId: string
  ): Promise<ExitRequest> {
    const [openRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request
        WHERE employee_id = ? AND status NOT IN ('rejected','revoked','exited')
        LIMIT 1`,
      [input.employeeId]
    );
    if (openRows.length) throw new Error("An active exit request already exists for this employee");

    /**
     * Notice period at creation.
     *
     * Company policy (owner ruling 2026-09-12): 30 days for everyone by default, which the
     * reporting manager may change. Before this, notice_period_days was hardcoded to 0 on every
     * exit ever created — no UI collected it and the schema defaulted it — so the notice window,
     * the "days remaining" figures and the F&F notice-shortfall calculation all had nothing to
     * work from.
     *
     * Read through getPolicyValue rather than hardcoded, so the company default is
     * effective-dated and changeable from business_policy_config without a deploy. It carries
     * "30" as its fallback and swallows lookup failures, so an unseeded or unreachable config
     * table yields the policy value rather than dropping back to a silent 0.
     *
     * An explicitly supplied value always wins, INCLUDING 0. That is what makes the involuntary
     * branch below expressible: someone who absconded or was terminated serves no notice, and a
     * 30-day default on those would compute a notice shortfall — and therefore a recovery
     * deducted from their settlement — for notice they were never asked to serve.
     */
    const noticePeriodDays =
      input.noticePeriodDays ??
      (String(input.exitType).trim().toLowerCase() === "voluntary"
        ? Number(await getPolicyValue("exit", "notice", "default_notice_days", "30")) || 30
        : 0);

    /**
     * For an absconding, the last worked date IS the last working day.
     *
     * The form auto-filled the proposed LWD as abscondingSince + 7 days and labelled it "grace
     * period ends". Owner ruling 2026-09-12: those 7 days are the company's decision window, not
     * paid employment. last_working_day_proposed feeds payroll's employment-end-date resolver,
     * which prorates the final month and caps payable days — so the +7 was paying every
     * absconding leaver for a week they did not work, and would later stamp
     * employees.date_of_exit a week late as well.
     *
     * Overriding exitDate here rather than trusting the caller keeps the two in step no matter
     * which client raised the exit: the API and the form cannot disagree about when an absconder
     * stopped being employed.
     */
    const isAbsconding = ["absconding", "abandonment"].includes(
      String(input.exitSubType ?? "").trim().toLowerCase()
    );
    const abscondingSince = input.abscondingSince ?? null;
    const effectiveExitDate = isAbsconding && abscondingSince ? abscondingSince : input.exitDate;

    const id = randomUUID();
    // submitted_at is written here, and NOT left to a stage transition.
    //
    // The row is created already at status='submitted', so it never *transitions* into that
    // state and updateExitStatus's stageMap — which stamps manager_actioned_at,
    // hr_actioned_at, admin_actioned_at and exit_confirmed_at — has no 'submitted' entry and
    // never could fire one. The column was therefore NULL on every exit_request ever created,
    // with three consequences that all read as data rather than as a missing write:
    //
    //   - ff-compute.service.ts derives served notice as
    //     DATEDIFF(last_working_day, er.submitted_at). Against NULL that yields NULL, so
    //     notice shortfall could never be computed from real dates.
    //   - ai-account.service.ts reports "Submitted: Not yet submitted" to an employee asking
    //     about the resignation they had in fact already submitted.
    //   - listExitRequests papers over it with `er.created_at AS submitted_at`, which is why
    //     the list screens looked correct while the column underneath was empty.
    //
    // NOW() rather than the created_at default so the two are independent: created_at is when
    // the row was written, submitted_at is when the employee tendered. They coincide today,
    // but a future draft→submitted path would need them to differ, and back-filling a
    // meaning onto created_at at that point would be worse.
    await db.execute(
      `INSERT INTO exit_request
         (id, employee_id, initiated_by, initiated_by_user_id, exit_type, exit_sub_type,
          exit_reason_category, absconding_since, last_working_day_proposed, resignation_reason,
          notice_period_days, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        input.employeeId,
        // Was the string literal "employee", unconditionally — so an HR-raised termination or
        // absconding exit was recorded as employee-initiated and was indistinguishable from a
        // self-resignation on the record. initiated_by was declared for 'employee, manager, hr'
        // and only ever held one of the three.
        input.initiatedBy ?? "employee",
        userId,
        input.exitType,
        input.exitSubType ?? "resignation",
        input.exitReasonCategory ?? null,
        abscondingSince,
        effectiveExitDate,
        input.reason ?? null,
        noticePeriodDays,
        "submitted",
      ]
    );

    await createExitHealthSnapshot(id).catch((err: unknown) => {
      logger.error({ err, exitRequestId: id }, '[exit] Health snapshot creation failed');
      return null;
    });

    // Fire-and-forget: notify manager of resignation.
    // Strangler: the gateway reports delivered only once resignation_submitted is
    // live; until then the legacy mailer still covers it. Never a double send.
    void notifyResignationSubmitted(id)
      .then((delivered) => (delivered ? null : notifyManagerOfResignation(input.employeeId, id)))
      .catch((err: unknown) => {
        logger.error({ err, exitRequestId: id }, '[exit] Manager notification failed');
        return null;
      });

    // SMS — separation initiated (fire-and-forget)
    try {
      const [empRow] = await db.execute<RowDataPacket[]>(
        `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, mobile, personal_phone
         FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
      );
      const emp = (empRow[0] as any);
      const phone = emp?.mobile ?? emp?.personal_phone ?? null;
      if (phone) sendSMS(phone, 'separation_initiated', { name: emp.name }).catch(() => {});
    } catch { /* non-fatal */ }

    // Registry-backed Action Centre item (RESIGNATION_PENDING_REVIEW). Gated on
    // exitSubType 'resignation' (the schema default — see exit.validation.ts) so
    // involuntary exits (termination, absconding, contract_end, ...) raised through the
    // same createExitRequest path do not surface as a "resignation" queue item.
    // Non-blocking, matching every other side-effect in this function.
    if ((input.exitSubType ?? "resignation") === "resignation") {
      try {
        const [empRow2] = await db.execute<RowDataPacket[]>(
          `SELECT CONCAT(first_name,' ',COALESCE(last_name,'')) AS name, branch_id
           FROM employees WHERE id = ? LIMIT 1`, [input.employeeId]
        );
        const emp2 = (empRow2[0] as any);
        await triggerResignationPendingReview(id, emp2?.name ?? input.employeeId, emp2?.branch_id ?? undefined);
      } catch { /* non-fatal */ }
    }

    return this.getExitRequest(id);
  },

  async updateExitStatus(
    id: string,
    status: string,
    remarks: string,
    userId: string,
    /**
     * The status the caller believed the request was in. The route's FSM check has
     * already read it; passing it here lets the transaction below reject the write
     * if anything moved in between, instead of silently applying a transition the
     * caller never actually validated.
     */
    expectedStatus?: string,
    /**
     * Notice terms agreed at this transition.
     *
     * These used to be collected by the UI and thrown away. NativeExitManagement's "Confirm &
     * Advance" modal asks for a confirmed Last Working Day and a notice period, sends them as
     * lastWorkingDayConfirmed / noticePeriodDays, and the route handler read only `status` and
     * `remarks` — so HR filled the form in, saw "Updated to Accepted", and nothing was stored.
     * exit_request.last_working_day_confirmed, notice_start_date and notice_end_date had no
     * writer anywhere in the backend and were NULL on every row.
     *
     * Optional: omitting them leaves every notice column exactly as it was, so the plain
     * status transitions (Notice, Confirm Exit, Revoke, bulk actions) are unaffected.
     */
    noticeTerms?: {
      lastWorkingDayConfirmed?: string | null;
      noticePeriodDays?: number | null;
    }
  ): Promise<ExitRequest> {
    const existing = await this.getExitRequest(id);
    const nextStatus = normalizeStatus(status);

    const stageMap: Record<string, string> = {
      manager_review: "manager_actioned_at",
      hr_review: "hr_actioned_at",
      admin_review: "admin_actioned_at",
      exited: "exit_confirmed_at",
    };

    const timestampCol = stageMap[nextStatus];
    const tsClause = timestampCol ? `, ${timestampCol} = NOW()` : "";

    const exitRecord = existing as any;
    const employeeIdForExit: string = exitRecord.employee_id;

    // Values needed inside the transaction, computed before it opens so the lock
    // is held for as short a time as possible.
    //
    // employment_status used to be hardcoded 'inactive' here, so an involuntary
    // termination and an ordinary resignation were indistinguishable on the employee
    // record — the reason survived only inside exit_request. Six files already filtered on
    // 'terminated' / 'absconded' / 'offboarded', all dead branches guarding a state nothing
    // could produce. Derived from the exit itself now; see exitEmploymentStatus.ts for why
    // the mapper and the activation guard's exclusion list must stay in one place.
    const nextEmploymentStatus = employmentStatusForExit(exitRecord.exit_type, exitRecord.exit_sub_type);

    // Notice terms supplied on this call, normalised. A blank string is not a date.
    const confirmedLwdInput =
      typeof noticeTerms?.lastWorkingDayConfirmed === "string" && noticeTerms.lastWorkingDayConfirmed.trim()
        ? noticeTerms.lastWorkingDayConfirmed.trim().slice(0, 10)
        : null;
    const noticeDaysInput =
      noticeTerms?.noticePeriodDays === null || noticeTerms?.noticePeriodDays === undefined
        ? null
        : Number(noticeTerms.noticePeriodDays);

    // Confirmed before proposed — the same precedence payroll's employment-end-date resolver
    // applies. Owner ruling 2026-08-16 (decision 1): the LWD written here IS the value payroll
    // reads, so employee master and payroll cannot disagree about when someone stopped being
    // paid. Writing `proposed` here while payroll preferred `confirmed` would put a leaver's
    // final day one value apart in two systems.
    //
    // The LWD being confirmed ON THIS CALL takes precedence over the stored one. Without that
    // first term, confirming an LWD and marking the employee exited in a single request would
    // write the new date into exit_request but stamp employees.date_of_exit from the stale
    // value — reintroducing the exact two-systems-disagree split this precedence exists to
    // prevent, on the one transition where it is unrecoverable.
    const lastWorkingDay =
      confirmedLwdInput ??
      (exitRecord.last_working_day_confirmed as string | null) ??
      (exitRecord.last_working_day_proposed as string | null) ??
      new Date().toISOString().slice(0, 10);

    // Notice columns, folded into the single status UPDATE below so they commit atomically
    // with the transition that agreed them.
    //
    // notice_start_date is a FACT, not a policy choice: the day the resignation was tendered,
    // i.e. DATE(submitted_at), falling back to DATE(created_at) for rows written before
    // submitted_at was populated. COALESCE'd against the existing value so a start date, once
    // recorded, is never moved by a later transition.
    //
    // notice_end_date prefers the confirmed LWD, which IS the last day of notice once HR and
    // the employee have agreed it. Only when there is no confirmed LWD does it fall back to
    // start + notice_period_days — the same arithmetic the readers already perform
    // (manpower-risk.routes.ts computes days_remaining as
    // notice_period_days - DATEDIFF(CURDATE(), notice_start_date), so start + days is the day
    // remaining hits zero). Computed in SQL, never in JS: mysql2 hands a DATE back as a
    // host-timezone JS Date and this codebase has a documented history of that shifting a day,
    // which on a notice boundary is a day of pay.
    //
    // Written only when a positive notice period is known. A zero-day window is not a fact
    // about anyone's notice — it is the absence of one — and inventing
    // notice_start = notice_end would make "no notice recorded" indistinguishable from
    // "notice served and finished today" for every reader downstream.
    const NOTICE_ANCHOR = `COALESCE(notice_start_date, DATE(submitted_at), DATE(created_at))`;
    const noticeSet: string[] = [];
    const noticeParams: unknown[] = [];

    if (confirmedLwdInput) {
      noticeSet.push(`last_working_day_confirmed = ?`);
      noticeParams.push(confirmedLwdInput);
    }
    if (noticeDaysInput !== null && Number.isFinite(noticeDaysInput) && noticeDaysInput > 0) {
      noticeSet.push(`notice_period_days = ?`);
      noticeParams.push(Math.trunc(noticeDaysInput));
      // Both assignments repeat NOTICE_ANCHOR rather than one reading the other's result.
      // MySQL applies SET assignments left to right and a later one sees earlier updates, so
      // referencing the freshly-written notice_start_date here would make the statement
      // order-dependent. Repeating the expression makes it identical either way.
      noticeSet.push(`notice_start_date = ${NOTICE_ANCHOR}`);
      noticeSet.push(
        `notice_end_date = COALESCE(?, DATE_ADD(${NOTICE_ANCHOR}, INTERVAL ? DAY))`
      );
      noticeParams.push(confirmedLwdInput, Math.trunc(noticeDaysInput));
    }
    const noticeClause = noticeSet.length ? `, ${noticeSet.join(", ")}` : "";

    // ONE transaction for the whole core state change.
    //
    // These were three separate autocommit statements: exit_request -> 'exited', then the
    // approval-log INSERT, then employees -> inactive. The employees UPDATE was deliberately
    // left to throw rather than be swallowed, which stopped the deprovisioning below from
    // running against a still-active employee — but it did NOT undo the exit_request UPDATE,
    // which had already committed. So the failure mode it was written to prevent survived:
    // exit_request says 'exited' while the employee is still active_status=1, which is the
    // exact 93-employee mismatch recorded live on 2026-08-06. A loud failure, but the same
    // split state. Now either all three land or none do.
    //
    // The row is locked and re-checked here, not just in the route's FSM check. That check
    // does SELECT-then-UPDATE across two statements with nothing held in between, so two
    // approvers clicking at once both read the same current status, both pass the FSM, and
    // both proceed — writing two approval-log rows and running the employee deactivation
    // twice. SELECT ... FOR UPDATE plus an expected-state predicate on the UPDATE closes it.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [lockedRows] = await conn.execute<RowDataPacket[]>(
        `SELECT status FROM exit_request WHERE id = ? FOR UPDATE`,
        [id]
      );
      const locked = lockedRows[0];
      if (!locked) throw exitStateChanged("Exit request no longer exists");

      const lockedStatus = String(locked.status);
      if (expectedStatus && normalizeStatus(expectedStatus) !== normalizeStatus(lockedStatus)) {
        throw exitStateChanged(
          `Exit request changed to '${normalizeStatus(lockedStatus)}' while this action was in flight`
        );
      }

      const [statusResult] = await conn.execute<ResultSetHeader>(
        `UPDATE exit_request SET status = ?${tsClause}${noticeClause}, updated_at = NOW()
          WHERE id = ? AND status = ?`,
        [nextStatus, ...noticeParams, id, lockedStatus]
      );
      // Never report success on a transition that did not happen.
      if (statusResult.affectedRows !== 1) {
        throw exitStateChanged("Exit request status changed before this update could be applied");
      }

      await conn.execute(
        `INSERT INTO exit_approval_log (id, exit_request_id, stage, action, action_by, discussion_remarks)
         VALUES (UUID(), ?, ?, ?, ?, ?)`,
        [id, nextStatus, "status_update", userId, remarks]
      );

      if (nextStatus === "exited") {
        // active_status is what every headcount/payroll-eligibility query in the app filters
        // on — employment_status alone was previously updated here, leaving an exited employee
        // still counted as active everywhere else.
        const [employeeResult] = await conn.execute<ResultSetHeader>(
          `UPDATE employees SET active_status = 0, employment_status = ?, date_of_exit = ?, updated_at = NOW()
            WHERE id = ?`,
          [nextEmploymentStatus, lastWorkingDay, employeeIdForExit]
        );
        if (employeeResult.affectedRows !== 1) {
          throw exitStateChanged("Employee record could not be deactivated for this exit");
        }
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      // 45 workers share this pool; a connection left unreleased here starves all of them.
      conn.release();
    }

    /**
     * A changed notice period is an override of company policy, so somebody is told.
     *
     * Owner ruling 2026-09-12: 30 days is the standard and the reporting manager may change it —
     * with Process Manager / Operations Manager / Payroll HR alerted. Payroll in particular has a
     * direct stake: this number drives the notice-shortfall recovery deducted from the final
     * settlement, so a quiet change to it is a quiet change to what the employee is paid.
     *
     * Fires only when the value actually MOVED. Re-confirming 30 on an exit already at 30 is not
     * an override, and alerting on it would train the recipients to ignore the alert.
     *
     * Post-commit and non-blocking, like every other side effect in this function: the transition
     * and the notice terms are already durable, and a failed notification must not undo them.
     */
    if (noticeDaysInput !== null && Number.isFinite(noticeDaysInput)) {
      const previousNoticeDays = Number(exitRecord.notice_period_days ?? 0);
      const newNoticeDays = Math.trunc(noticeDaysInput);
      if (newNoticeDays !== previousNoticeDays) {
        void notifyNoticePeriodOverride(id, employeeIdForExit, previousNoticeDays, newNoticeDays, userId)
          .catch((err: unknown) => {
            logger.error(
              { err, exitRequestId: id, previousNoticeDays, newNoticeDays },
              '[exit] Notice-period override alert failed',
            );
            return null;
          });
      }
    }

    // Email only on the outcomes the employee is entitled to hear about. The
    // intermediate review stages are internal queue movements.
    setImmediate(() => {
      const decision =
        nextStatus === "accepted" ? "accepted" :
        nextStatus === "rejected" ? "rejected" :
        nextStatus === "revoked"  ? "revoked"  : null;
      if (decision) void notifyResignationDecision(id, decision);
    });

    if (["accepted", "notice_serving", "exited"].includes(nextStatus)) {
      await createDefaultClearanceTasks(id, (existing as any).employee_id).catch((err: unknown) => {
        logger.error({ err, exitRequestId: id }, '[exit] Clearance task creation failed');
        return null;
      });
    }

    if (nextStatus === "exited") {
      const exitRec = exitRecord;
      const employeeId: string = employeeIdForExit;

      // EVERYTHING BELOW THIS POINT IS POST-COMMIT.
      //
      // exit_request, the approval log and employees.active_status are already durable by
      // now. These steps reach outside the core state — sessions, LMS, IT provisioning,
      // notifications — and must never sit inside the transaction that owns it: a slow or
      // unreachable external system would otherwise hold the exit_request row lock for the
      // length of a network timeout.
      //
      // The trade-off is that a failure here leaves the employee exited with some cleanup
      // undone. Failures are logged loudly, but there is still no durable retry: nothing
      // re-attempts a failed deprovisioning and no work item is raised for a human. That
      // gap is recorded rather than papered over — see the audit note on retryability.

      // Sessions outlive the status change: the access token in the leaver's
      // browser is valid for up to 24h after active_status goes to 0, and
      // requireAuth had no reason to reject it. Revoke here so the exit takes
      // effect at the same moment the record says it did.
      const revoked = await revokeSessionsForEmployee(employeeId, 'employee_exit');
      if (revoked.refreshTokensRevoked > 0 || revoked.deviceSessionsRevoked > 0) {
        logger.info(
          { exitRequestId: id, employeeId, ...revoked },
          '[exit] Live sessions revoked for exited employee'
        );
      }

      // Create a pending F&F record so payroll team is alerted to process settlement
      await db.execute(
        `INSERT IGNORE INTO full_final_calculation
           (id, exit_request_id, employee_id, calculation_date,
            notice_period_days, notice_shortfall_days, notice_recovery,
            earned_leave_encashment, gratuity_amount, salary_hold,
            advances_recovery, net_payable, status, is_ff_provisional, prepared_by)
         VALUES (UUID(), ?, ?, CURDATE(), 0, 0, 0, 0, 0, 0, 0, 0, 'draft', 1, ?)`,
        [id, employeeId, userId]
      ).catch(async (err: unknown) => {
        logger.warn({ err }, '[exit] F&F record creation failed');
        // Post-commit: the exit stands, so this becomes payroll's work rather than a log line.
        await recordExitFollowUpFailure('FF_DRAFT_CREATION', id, employeeId, err);
      });

      // Nullify reporting_manager_id for direct reports so they are not orphaned
      //
      // This is the single most destructive manager change in the platform: when a manager
      // exits, every one of their reports loses the only record of who managed them. 123 of
      // 1,120 active employees currently sit with no manager at all, and 83 exited employees
      // still have people pointing at them (counted 2026-08-27). Without an effective-dated
      // row written FIRST, the departing manager's team history becomes unattributable the
      // moment this UPDATE runs — their attrition and shrinkage record simply disappears.
      const [orphanRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE reporting_manager_id = ? AND active_status = 1`,
        [employeeId]
      ).catch(() => [[]] as unknown as [RowDataPacket[]]);
      for (const row of orphanRows as RowDataPacket[]) {
        await recordManagerChange({
          employeeId: String((row as { id: unknown }).id),
          newManagerId: null,
          changedBy: userId ?? null,
          reason: 'Reporting manager exited — team pending re-parent',
        });
      }

      await db.execute(
        `UPDATE employees
            SET reporting_manager_id = NULL, updated_at = NOW()
          WHERE reporting_manager_id = ? AND active_status = 1`,
        [employeeId]
      ).catch(async (err: unknown) => {
        logger.warn({ err, employeeId }, '[exit] Direct-report RM nullification failed');
        await recordExitFollowUpFailure('DIRECT_REPORT_REPARENT', id, employeeId, err);
      });

      // Withdraw LMS access and future leave, and count kit still out on loan.
      //
      // Replaces three statements that named schema which does not exist
      // (employee_asset_assignment, lms_employee_mapping.active_status,
      // leave_requests), each wrapped in a .catch() that logged a warning and
      // let the exit report success. Every exit silently skipped its own
      // cleanup; 60 people who have left are still active LMS learners because
      // of it. Failures now surface instead of being swallowed.
      const deprovision = await deprovisionEmployeeAccess(employeeId, 'employee_exit');
      logger.info(
        { exitRequestId: id, employeeId, ...deprovision },
        '[exit] Deprovisioning complete'
      );
      if (deprovision.failures.length > 0) {
        logger.error(
          { exitRequestId: id, employeeId, failures: deprovision.failures },
          '[exit] Deprovisioning steps failed — access may persist'
        );
        // "Failures surface" previously meant this log line only. Access persisting after an
        // exit is a security outcome, so it has to become work somebody is holding.
        await recordExitFollowUpFailure('ACCESS_DEPROVISION', id, employeeId, deprovision.failures);
      }

      // Fire IT exit provisioning tasks — fire-and-forget, must not throw
      import('../it-provisioning/it-provisioning.service.js').then(({ dispatchExitProvisioningTasks }) => {
        dispatchExitProvisioningTasks({
          employeeId:     exitRec.employee_id,
          employeeCode:   exitRec.employee_code  ?? '',
          employeeName:   exitRec.employee_name  ?? exitRec.employee_id,
          branchId:       exitRec.branch_id      ?? null,
          lastWorkingDay: exitRec.last_working_day_proposed ?? null,
          exitRequestId:  id,
          actorUserId:    userId,
        }).catch((err: unknown) => {
          logger.error({ err }, '[it-provisioning] exit dispatch failed');
          void recordExitFollowUpFailure('IT_DEPROVISION_DISPATCH', id, employeeId, err);
        });
      }).catch((err: unknown) => {
        logger.error({ err }, '[it-provisioning] module load failed');
        void recordExitFollowUpFailure('IT_DEPROVISION_DISPATCH', id, employeeId, err);
      });
    }

    return this.getExitRequest(id);
  },

  async getExitStats(): Promise<ExitStats & Record<string, number>> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS cnt FROM exit_request GROUP BY status`
    );

    const counts: Record<string, number> = {};
    for (const row of rows as { status: string; cnt: number }[]) {
      counts[row.status] = Number(row.cnt);
    }

    const statuses = [
      "draft", "submitted", "manager_review", "hr_review", "admin_review",
      "accepted", "rejected", "revoked", "notice_serving", "exited",
    ];
    const detailed = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Record<string, number>;
    const total = Object.values(detailed).reduce((a, b) => a + b, 0);
    const pending = (detailed.submitted ?? 0) + (detailed.manager_review ?? 0) + (detailed.hr_review ?? 0) + (detailed.admin_review ?? 0);
    const completed = detailed.exited ?? 0;

    return {
      ...detailed,
      total,
      pending,
      completed,
      active_notice: (detailed.accepted ?? 0) + (detailed.notice_serving ?? 0),
    } as unknown as ExitStats & Record<string, number>;
  },
};
