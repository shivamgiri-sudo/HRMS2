/**
 * Bank Payment Readiness Routes — mounted at /api/payroll/bank-readiness
 *
 *   GET   /summary                        — class totals, as-of, verification source
 *   GET   /exceptions?class=&branch_id=&q= — masked exception rows with owner + workflow state
 *   GET   /remediation-list               — MISSING employees who cannot be emailed (HR/manager list)
 *   GET   /payment-source-divergence?run_id= — the reported-not-fixed divergence, measured
 *   PATCH /exceptions/:employeeId         — assign owner / set workflow status / add a note
 *   GET   /payment-file?run_id=           — THE payment export. Full account numbers.
 *
 * TWO DIFFERENT GATES, DELIBERATELY
 *   Every read here is masked to XXXX+last4 and gated on role alone, because an exception queue
 *   is useless if the people who must clear it cannot open it.
 *
 *   /payment-file is the only endpoint that emits a full account number, and it carries the same
 *   hasOrgWideScope gate the NEFT export endpoints already use (bank-export-gating.contract.test.ts
 *   pins that rule). A branch payroll user can see that MAS12345 is unpayable; only an org-wide
 *   payroll/finance user can obtain the digits.
 *
 * ROW SCOPE
 *   Non-org-wide callers see only their own branches, resolved from user_assignment_scope. A
 *   caller with no scope rows at all keeps today's unrestricted read — same deliberate
 *   non-regression as payroll-branch-readiness.routes.ts, so introducing this page cannot take
 *   away access someone already has. The full-number export is NOT covered by that leniency: it
 *   requires an explicit scope_type = 'all'.
 */
import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { hasOrgWideScope, getUserAssignmentScopes, hasAnyRole } from "../../shared/scopeAccess.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";
import {
  buildBankReadinessReport,
  getPaymentSourceDivergence,
  BANK_READINESS_CLASSES,
  maskAccount,
  type BankReadinessClass,
} from "./bank-payment-readiness.service.js";

export const bankPaymentReadinessRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

/** Read roles: everyone who has to clear an exception or answer for one. */
const READ_ROLES = [
  "super_admin", "admin", "payroll_head", "payroll", "payroll_admin", "payroll_branch",
  "finance", "finance_head", "hr", "branch_head", "branch_admin",
];

/** Same list the existing NEFT/bank-file endpoints gate on. */
const PAYROLL_EXPORT_ROLES = ["finance", "payroll", "finance_head", "payroll_head", "payroll_admin"];

const ORG_WIDE_REQUIRED_MSG =
  "Organisation-wide payroll scope is required to read full bank account numbers. " +
  "Your access is limited to a subset of branches.";

/**
 * The full-number export's own org-wide test — deliberately NOT hasOrgWideScope().
 *
 * hasOrgWideScope() short-circuits to true for anyone holding `admin`
 * (scopeAccess.ts:193) before it ever looks at a scope row. That is fine for the endpoints
 * it already guards, but it silently defeats the rule stated at the top of this file: "The
 * full-number export is NOT covered by that leniency: it requires an explicit
 * scope_type = 'all'."
 *
 * It is not hypothetical. Measured against production on 2026-08-14, one active account holds
 * `admin` + `branch_admin` with ZERO scope_type='all' rows. Routed through hasOrgWideScope, a
 * branch administrator could download every employee's full bank account number for the whole
 * organisation — the exact outcome the two-gate design above exists to prevent.
 *
 * So this asks the question the header promises: super_admin is org-wide by definition;
 * everyone else needs a real scope_type='all' row against a payroll export role. Holding
 * `admin` is not, by itself, org-wide payroll scope.
 *
 * Tightening here cannot regress anyone: bankPaymentReadinessRouter has never been mounted, so
 * this endpoint has never served a request and nobody holds access it could take away. If a
 * legitimate payroll operator gets ORG_WIDE_REQUIRED_MSG, the fix is to grant them the scope
 * row — an auditable grant — not to widen this check.
 */
async function hasExportScope(userId: string): Promise<boolean> {
  if (await hasAnyRole(userId, "super_admin")) return true;
  if (!(await hasAnyRole(userId, ...PAYROLL_EXPORT_ROLES))) return false;
  const scopes = await getUserAssignmentScopes(userId, PAYROLL_EXPORT_ROLES);
  return scopes.some((s) => s.scope_type === "all");
}

/** Who may change an exception's owner or status. */
const MANAGE_ROLES = ["super_admin", "admin", "payroll_head", "payroll", "payroll_admin", "finance_head", "hr"];

const WORKFLOW_STATUSES = ["open", "in_progress", "awaiting_employee", "resolved", "waived"] as const;
type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

bankPaymentReadinessRouter.use(requireAuth);

// ─── Row scope ───────────────────────────────────────────────────────────────

/**
 * Branch ids this caller may see, or null for "no restriction".
 *
 * null is returned in two very different situations and that is intentional: an org-wide caller
 * (scope_type = 'all') and a caller with no scope rows at all. The second is the non-regression
 * described in the header. Callers that must distinguish them — only /payment-file does — call
 * hasOrgWideScope directly instead of relying on this.
 */
async function resolveVisibleBranchIds(userId: string): Promise<Set<string> | null> {
  if (await hasAnyRole(userId, "super_admin", "admin")) return null;
  const scopes = await getUserAssignmentScopes(userId);
  if (scopes.length === 0) return null;
  if (scopes.some((s) => s.scope_type === "all")) return null;
  const ids = scopes.map((s) => s.branch_id).filter((b): b is string => !!b);
  // Scoped, but by something other than branch (process/department). Falling through to "see
  // everything" would silently widen access, so an empty set is returned and the caller sees
  // nothing rather than everything.
  return new Set(ids);
}

// ─── Exception workflow overlay ──────────────────────────────────────────────

interface ExceptionOverlayRow extends RowDataPacket {
  employee_id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  workflow_status: string | null;
  notes: string | null;
  updated_at: string | null;
}

/**
 * The workflow overlay is stored; the CLASSIFICATION is not.
 *
 * payroll_bank_exception holds only who owns an exception, its workflow status and notes. The
 * readiness class itself is recomputed on every request from live data. Storing a snapshot of
 * "MISSING" would let the table keep asserting it after HR fixed the record — the same failure
 * shape as salary_prep_run.total_employees, which is wrong in both directions and has misled
 * this codebase before.
 */
async function loadOverlay(): Promise<Map<string, ExceptionOverlayRow>> {
  // The login table is auth_user, NOT users — there is no `users` table in this schema, and it
  // carries no display name either, so the owner's name comes from the employee record linked by
  // employees.user_id, falling back to the login email.
  const [rows] = await db.query<ExceptionOverlayRow[]>(
    `SELECT x.employee_id, x.owner_user_id, x.workflow_status, x.notes, x.updated_at,
            COALESCE(NULLIF(TRIM(oe.full_name), ''), u.email) AS owner_name
       FROM payroll_bank_exception x
       LEFT JOIN auth_user u ON u.id = x.owner_user_id
       LEFT JOIN employees oe ON oe.user_id = u.id`,
  );
  return new Map(rows.map((r) => [r.employee_id, r]));
}

interface LastActionRow extends RowDataPacket {
  employee_id: string;
  status: string;
  requested_at: string | null;
  reviewed_at: string | null;
}

/**
 * The employee's own most recent bank action, derived rather than stored.
 *
 * "Last employee action" must never be something this page writes for them. It is read from
 * profile_update_approval — the only record of an employee actually doing something about their
 * bank details — so an employee who has done nothing shows as having done nothing. Marking
 * someone "contacted" because a page rendered their row is the exact falsehood the brief forbids.
 */
async function loadLastEmployeeActions(): Promise<Map<string, LastActionRow>> {
  const [rows] = await db.query<LastActionRow[]>(
    `SELECT p.employee_id, p.status, p.requested_at, p.reviewed_at
       FROM profile_update_approval p
       JOIN (SELECT employee_id, MAX(requested_at) AS mx
               FROM profile_update_approval
              WHERE request_type = 'bank_details'
              GROUP BY employee_id) latest
         ON latest.employee_id = p.employee_id AND latest.mx = p.requested_at
      WHERE p.request_type = 'bank_details'`,
  );
  return new Map(rows.map((r) => [r.employee_id, r]));
}

// ─── GET /summary ────────────────────────────────────────────────────────────

bankPaymentReadinessRouter.get(
  "/summary",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    // Optional run_id. Supplied, this reports on exactly the population the payment file for
    // that run would contain; omitted, it stays the org-wide bank-exceptions queue, which is
    // still the right view for standing remediation work.
    const summaryRunId = String(req.query.run_id ?? "").trim() || null;
    const report = await buildBankReadinessReport(summaryRunId);
    const visible = await resolveVisibleBranchIds(req.authUser!.id);
    const rows = visible ? report.rows.filter((r) => r.branch_id && visible.has(r.branch_id)) : report.rows;

    const totals = Object.fromEntries(BANK_READINESS_CLASSES.map((c) => [c, 0])) as Record<BankReadinessClass, number>;
    for (const r of rows) totals[r.readiness_class]++;

    const recoverable = rows.filter((r) => r.recoverable_from_db_bill).length;
    const beneficiaryUnconfirmed = rows.filter((r) => r.beneficiary_unconfirmed).length;

    return res.json({
      success: true,
      as_of: report.as_of,
      scope: visible ? { restricted: true, branch_count: visible.size } : { restricted: false },
      verification_source: report.verification_source,
      totals,
      total_employees: rows.length,
      payable_count: totals.READY,
      unresolved_count: rows.length - totals.READY,
      gate_clear: rows.length > 0 && rows.length === totals.READY,
      recoverable_from_db_bill: recoverable,
      beneficiary_unconfirmed: beneficiaryUnconfirmed,
      message: report.verification_source.available
        ? `Verified against db_bill salary credits for ${report.verification_source.month} ` +
          `(${report.verification_source.confirmed_credits} confirmed receipts).`
        : `Bank payment history is UNAVAILABLE (${report.verification_source.error}). No account can be ` +
          `confirmed, so every otherwise-clean record is reported BLOCKED rather than READY.`,
    });
  }),
);

// ─── GET /exceptions ─────────────────────────────────────────────────────────

bankPaymentReadinessRouter.get(
  "/exceptions",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const wanted = String(req.query.class ?? "").trim().toUpperCase();
    const branchFilter = String(req.query.branch_id ?? "").trim();
    const search = String(req.query.q ?? "").trim().toLowerCase();
    const includeReady = String(req.query.include_ready ?? "") === "1";

    if (wanted && !(BANK_READINESS_CLASSES as readonly string[]).includes(wanted)) {
      return res.status(400).json({
        success: false,
        message: `class must be one of ${BANK_READINESS_CLASSES.join(", ")}`,
      });
    }

    const [report, overlay, lastActions] = await Promise.all([
      buildBankReadinessReport(),
      loadOverlay(),
      loadLastEmployeeActions(),
    ]);
    const visible = await resolveVisibleBranchIds(req.authUser!.id);

    const rows = report.rows
      .filter((r) => (visible ? r.branch_id && visible.has(r.branch_id) : true))
      .filter((r) => (wanted ? r.readiness_class === wanted : includeReady || r.readiness_class !== "READY"))
      .filter((r) => (branchFilter ? r.branch_id === branchFilter : true))
      .filter((r) =>
        search
          ? r.employee_code.toLowerCase().includes(search) || r.employee_name.toLowerCase().includes(search)
          : true,
      )
      .map((r) => {
        const o = overlay.get(r.employee_id);
        const a = lastActions.get(r.employee_id);
        return {
          employee_id: r.employee_id,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          branch_id: r.branch_id,
          branch_name: r.branch_name,
          status: r.readiness_class,
          reasons: r.reasons,
          reason: r.reason_detail,
          // Masked on every general screen. The full value exists only in /payment-file.
          account_masked: r.account_masked,
          ifsc_code: r.ifsc_code,
          bank_name: r.bank_name,
          beneficiary_name: r.beneficiary_name,
          beneficiary_source: r.beneficiary_source,
          beneficiary_unconfirmed: r.beneficiary_unconfirmed,
          recoverable_from_db_bill: r.recoverable_from_db_bill,
          contactable: r.has_email,
          exception_owner: o?.owner_name ?? null,
          exception_owner_user_id: o?.owner_user_id ?? null,
          workflow_status: o?.workflow_status ?? "open",
          notes: o?.notes ?? null,
          owner_updated_at: o?.updated_at ?? null,
          // Derived, never asserted. Null means the employee has genuinely done nothing.
          last_employee_action: a ? `bank change request ${a.status}` : null,
          last_employee_action_at: a?.reviewed_at ?? a?.requested_at ?? null,
          approval_status: a?.status ?? "none",
        };
      });

    return res.json({
      success: true,
      as_of: report.as_of,
      verification_source: report.verification_source,
      count: rows.length,
      data: rows,
    });
  }),
);

// ─── GET /remediation-list ───────────────────────────────────────────────────

/**
 * Employees who need a bank account and CANNOT be reached by email.
 *
 * These people are why this endpoint is separate rather than a filter on /exceptions: the
 * self-service flow (employee submits -> payroll approves -> record activated -> readiness
 * refreshes) cannot start for them, because there is no address to send the request to. They
 * need a named human to walk it in. Nothing here marks them as contacted — the page can only
 * report that they have not been.
 */
bankPaymentReadinessRouter.get(
  "/remediation-list",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const [report, overlay] = await Promise.all([buildBankReadinessReport(), loadOverlay()]);
    const visible = await resolveVisibleBranchIds(req.authUser!.id);

    const rows = report.rows
      .filter((r) => (visible ? r.branch_id && visible.has(r.branch_id) : true))
      .filter((r) => r.readiness_class === "MISSING" && !r.has_email)
      .map((r) => {
        const o = overlay.get(r.employee_id);
        return {
          employee_id: r.employee_id,
          employee_code: r.employee_code,
          employee_name: r.employee_name,
          branch_id: r.branch_id,
          branch_name: r.branch_name,
          reason: r.reason_detail,
          recoverable_from_db_bill: r.recoverable_from_db_bill,
          exception_owner: o?.owner_name ?? null,
          workflow_status: o?.workflow_status ?? "open",
          contact_channel: "in_person_required",
          contacted: false,
        };
      });

    return res.json({
      success: true,
      as_of: report.as_of,
      count: rows.length,
      data: rows,
      message:
        "These employees have no bank record and no email address of any kind, so the self-service " +
        "request cannot reach them. They require an HR or reporting-manager handover in person. " +
        "No entry here has been contacted — this system has no way to contact them.",
    });
  }),
);

// ─── GET /payment-source-divergence ──────────────────────────────────────────

bankPaymentReadinessRouter.get(
  "/payment-source-divergence",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const runId = String(req.query.run_id ?? "").trim();
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    if (!(runRows as unknown[])[0]) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }
    return res.json({ success: true, data: await getPaymentSourceDivergence(runId) });
  }),
);

// ─── PATCH /exceptions/:employeeId ───────────────────────────────────────────

bankPaymentReadinessRouter.patch(
  "/exceptions/:employeeId",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { employeeId } = req.params;
    const { owner_user_id, workflow_status, notes } = req.body as {
      owner_user_id?: string | null;
      workflow_status?: string;
      notes?: string | null;
    };

    if (workflow_status && !(WORKFLOW_STATUSES as readonly string[]).includes(workflow_status)) {
      return res.status(400).json({
        success: false,
        message: `workflow_status must be one of ${WORKFLOW_STATUSES.join(", ")}`,
      });
    }

    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    if (!(empRows as unknown[])[0]) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    if (owner_user_id) {
      const [ownerRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM auth_user WHERE id = ? LIMIT 1`,
        [owner_user_id],
      );
      if (!(ownerRows as unknown[])[0]) {
        return res.status(400).json({ success: false, message: "owner_user_id is not a known user" });
      }
    }

    // COALESCE on the update side so a PATCH carrying only one field does not blank the others.
    await db.execute(
      `INSERT INTO payroll_bank_exception
         (id, employee_id, owner_user_id, workflow_status, notes, created_by, updated_by)
       VALUES (UUID(), ?, ?, COALESCE(?, 'open'), ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         owner_user_id   = COALESCE(VALUES(owner_user_id), owner_user_id),
         workflow_status = COALESCE(VALUES(workflow_status), workflow_status),
         notes           = COALESCE(VALUES(notes), notes),
         updated_by      = VALUES(updated_by),
         updated_at      = CURRENT_TIMESTAMP`,
      [
        employeeId,
        owner_user_id ?? null,
        workflow_status ?? null,
        notes ?? null,
        req.authUser!.id,
        req.authUser!.id,
      ],
    );

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "BANK_EXCEPTION_UPDATED",
      module_key: "payroll",
      entity_type: "employee",
      entity_id: employeeId,
      change_summary: { owner_user_id: owner_user_id ?? null, workflow_status: workflow_status ?? null },
      req: req as never,
    });

    return res.json({ success: true, message: "Exception updated" });
  }),
);

// ─── GET /assignable-owners ──────────────────────────────────────────────────

/**
 * The Assign dialog's owner picker was unwired to anything — PATCH /exceptions/:employeeId
 * has always accepted and validated owner_user_id, but the frontend only ever sent
 * workflow_status/notes, so payroll_bank_exception.owner_user_id was 0 rows, always.
 *
 * Returns the realistic pool of people an exception could be assigned to: auth_user rows
 * holding one of the roles that can manage exceptions at all (same list as MANAGE_ROLES,
 * so nobody is offered as an assignee who couldn't act on the exception themselves).
 * Same name resolution as loadOverlay() above — auth_user carries no display name, so it
 * comes from the linked employees row, falling back to the login email.
 */
bankPaymentReadinessRouter.get(
  "/assignable-owners",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const search = String(req.query.search ?? "").trim();
    const params: unknown[] = [];
    let searchClause = "";
    if (search) {
      searchClause = `AND (oe.full_name LIKE ? OR u.email LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT DISTINCT u.id,
              COALESCE(NULLIF(TRIM(oe.full_name), ''), u.email) AS name
         FROM auth_user u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.active_status = 1
         LEFT JOIN employees oe ON oe.user_id = u.id
        WHERE ur.role_key IN (${MANAGE_ROLES.map(() => "?").join(",")})
          ${searchClause}
        ORDER BY name
        LIMIT 50`,
      [...MANAGE_ROLES, ...params],
    );
    return res.json({ success: true, data: rows });
  }),
);

// ─── GET /payment-file ───────────────────────────────────────────────────────

/**
 * THE payment export.
 *
 * Its population is exactly the READY set intersected with the run's payable lines. Nothing
 * else can enter the file: an employee who is MISSING, INVALID, CONFLICT, PENDING_APPROVAL or
 * BLOCKED is excluded by construction rather than by a filter someone can forget to apply,
 * because the row list is built FROM the classification.
 *
 * Every excluded employee is enumerated in the response headers and in a trailing comment block,
 * so a file that is short of the payable population says why on its face. A payment file that
 * silently omits people is how someone does not get paid and nobody notices.
 */
bankPaymentReadinessRouter.get(
  "/payment-file",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  h(async (req, res) => {
    const runId = String(req.query.run_id ?? "").trim();
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });

    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as any[])[0];
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });

    // A payment file from an uncommitted run is a fully formed instruction to move money.
    // neft-transfer-file already refuses draft/cancelled; this refuses the same states rather
    // than inventing a different rule.
    if (["draft", "cancelled"].includes(String(run.status ?? "").toLowerCase())) {
      return res.status(409).json({
        success: false,
        message: `Run is '${run.status}'. A payment file cannot be generated from an uncommitted run.`,
      });
    }

    // Scoped to THIS run — the same population the file below is built from.
    //
    // This previously judged every active employee while the file contained the run's payable
    // lines, so the two disagreed by construction. On the live 2026-07 run that meant 161
    // payable employees (Rs 1,49,692.69) were never classified at all, and 215 employees with
    // no payable line could hold the gate red over money nobody was paying them.
    const report = await buildBankReadinessReport(runId);
    if (!report.verification_source.available) {
      return res.status(503).json({
        success: false,
        message:
          "Bank payment history (db_bill) is unavailable, so no account can be confirmed. " +
          "Refusing to generate a payment file that cannot be verified.",
        detail: report.verification_source.error,
      });
    }

    // Payable lines for this run, with the account resolved the same way the classification did.
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.employee_id, spl.employee_code, spl.net_salary,
              ebd.account_number_enc, CAST(ebd.account_number AS CHAR) AS account_number_legacy,
              ebd.ifsc_code, ebd.bank_name
         FROM salary_prep_line spl
         LEFT JOIN employee_bank_detail ebd
                ON ebd.employee_id = spl.employee_id AND ebd.is_primary = 1 AND ebd.active_status = 1
        WHERE spl.run_id = ?
          AND COALESCE(spl.net_salary, 0) > 0
        ORDER BY spl.employee_code`,
      [runId],
    );

    const readyById = new Map(report.rows.filter((r) => r.payable).map((r) => [r.employee_id, r]));
    const included: string[] = [];
    const excluded: Array<{ code: string; status: string; reason: string }> = [];
    const csv: string[] = [
      "Serial,Employee Code,Beneficiary Name,Account Number,IFSC Code,Bank Name,Amount,Narration",
    ];
    const monthLabel = String(run.run_month);
    let serial = 0;

    for (const line of lineRows as any[]) {
      const ready = readyById.get(line.employee_id);
      if (!ready) {
        const known = report.rows.find((r) => r.employee_id === line.employee_id);
        excluded.push({
          code: String(line.employee_code ?? ""),
          status: known?.readiness_class ?? "NOT_ACTIVE",
          reason: known?.reason_detail ?? "employee is not in the active payable population",
        });
        continue;
      }
      const account = resolveAccountNumber({
        account_number_enc: line.account_number_enc,
        account_number: line.account_number_legacy,
      });
      // Defence in depth: classification already proved this resolves, but the file is the last
      // place a blank could reach a bank. If it is empty here the classification and the export
      // disagree, which is a bug, and the row is excluded rather than emitted blank.
      if (!account) {
        excluded.push({
          code: String(line.employee_code ?? ""),
          status: "CONFLICT",
          reason: "account resolved during classification but not during export — do not pay, raise this",
        });
        continue;
      }
      serial++;
      included.push(String(line.employee_code ?? ""));
      const clean = (v: unknown) => String(v ?? "").replace(/[",\r\n]/g, " ").trim();
      csv.push(
        [
          serial,
          clean(line.employee_code),
          `"${clean(ready.beneficiary_name).toUpperCase()}"`,
          account,
          clean(ready.ifsc_code),
          `"${clean(ready.bank_name)}"`,
          Number(line.net_salary).toFixed(2),
          `"Salary ${monthLabel} - ${clean(line.employee_code)}"`,
        ].join(","),
      );
    }

    if (excluded.length) {
      csv.push("");
      csv.push(`# ${excluded.length} payable employee(s) EXCLUDED — not payment-ready:`);
      for (const e of excluded) csv.push(`# ${e.code},${e.status},${e.reason.replace(/,/g, ";")}`);
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "BANK_PAYMENT_FILE_DOWNLOAD",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: runId,
      change_summary: {
        run_month: run.run_month,
        included: included.length,
        excluded: excluded.length,
        excluded_employee_codes: excluded.map((e) => e.code),
        verification_month: report.verification_source.month,
      },
      req: req as never,
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="PaymentFile_${String(run.run_month).replace("-", "")}_${runId.slice(0, 8)}.csv"`,
    );
    res.setHeader("X-Payment-Rows", String(included.length));
    res.setHeader("X-Payment-Excluded", String(excluded.length));
    res.setHeader("X-Readiness-As-Of", report.as_of);
    // BOM so Excel reads it as UTF-8, matching the existing bank-export.
    return res.send("﻿" + csv.join("\r\n"));
  }),
);

/** Exposed for the contract test that pins the mask shape. */
export const __maskForTest = maskAccount;
