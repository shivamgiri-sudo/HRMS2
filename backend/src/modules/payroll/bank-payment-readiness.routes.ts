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
import multer from "multer";
import { createHash } from "crypto";
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
import {
  buildValidatedBankAccountMisSummary,
  buildValidatedBankAccountMisDetail,
  MIS_BUCKETS,
  MIS_BUCKET_LABELS,
  MIS_DETAIL_COLUMNS,
  type MisBucket,
} from "./validated-bank-account-mis.service.js";
import {
  getDebitAccountConfig,
  setDebitAccountConfig,
} from "./payroll-debit-account-config.service.js";
import {
  getManualReviewBankGaps,
  approveManualReviewBankDetail,
} from "./bank-manual-review.service.js";
import {
  generateSalaryTransferBatch,
  getFilteredEligibleTransferRowsWithNocExclusions,
  rejectTransferItems,
  markItemCorrectedReady,
  rejectionReasonLabel,
  REJECTION_REASONS,
  parseTransferNumberCsv,
  previewTransferNumberImport,
  commitTransferNumberImport,
  type TransferImportPreviewRow,
} from "./salary-transfer.service.js";
import { autoAssignBankExceptionsToPayrollHr } from "./bank-exception-auto-assign.service.js";

export const bankPaymentReadinessRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

/**
 * Read roles: everyone who has to clear an exception or answer for one.
 *
 * payroll_hr added for the Validated Bank Account MIS. Branch Payroll HR is the role that actually
 * collects a missing account from the employee, and the PAYROLL_BANK_READINESS page code that gates
 * both the Payment Center and the MIS page already admits them. Omitting them here meant the one
 * role expected to clear the exceptions could open the page and have every request 403.
 */
const READ_ROLES = [
  "super_admin", "admin", "payroll_head", "payroll", "payroll_admin", "payroll_branch",
  "payroll_hr", "finance", "finance_head", "hr", "branch_head", "branch_admin",
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
 *
 * STATUS 2026-08-26 — the shortcut this helper was written to avoid is GONE.
 * hasOrgWideScope() no longer short-circuits on `admin`; it now reads
 *   super_admin -> true; else require an allowed role; else require a
 *   scope_type='all' row against those roles
 * which is character-for-character the logic below when called as
 * hasOrgWideScope(userId, PAYROLL_EXPORT_ROLES). This helper is therefore a
 * duplicate rather than a divergence, and the paragraphs above are kept as the
 * record of WHY it exists, not as a live warning about the shared function.
 *
 * It is deliberately NOT collapsed into hasOrgWideScope(). Doing so would edit the
 * gate on a live full-account-number/payment export for zero behavioural gain, and
 * this file's own history is the argument against that trade. Anyone consolidating
 * later must diff both implementations again first — do not assume this note is
 * still true.
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

    // Fire-and-forget: assign any newly-unowned INVALID/MISSING/CONFLICT row to its branch
    // payroll HR and email employee+manager+payroll HR. Runs over the FULL unfiltered report,
    // not the current viewer's visible slice — a branch-scoped payroll user opening their own
    // Exceptions view must not be the only thing that ever triggers assignment for other
    // branches. Idempotent (see bank-exception-auto-assign.service.ts), so this is cheap on
    // every request after the first time each exception is seen.
    void autoAssignBankExceptionsToPayrollHr(report.rows).catch((err) =>
      console.error("[bank-exceptions] auto-assign pass failed:", err),
    );

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

// ─── Validated Bank Account MIS ──────────────────────────────────────────────
//
// The branch-wise status board and its drill-down, backed by validated-bank-account-mis.service.ts.
//
// READS mas_hrms ONLY — no db_bill, per the payroll owner's instruction. Verified here is the HRMS
// bank verification flag, which is a weaker claim than the READY class the endpoints above compute
// (that one proves a confirmed salary credit). The two can disagree about an individual on purpose;
// the /mis/summary response carries a note saying so.
//
// Masked throughout: account numbers are XXXX+last4 on every row and there is no full-number path
// here. /payment-file remains the only endpoint in this router that emits digits.

/** GET /mis/summary — one row per branch, plus a totals row. */
bankPaymentReadinessRouter.get(
  "/mis/summary",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const branchId = String(req.query.branch_id ?? "").trim() || null;
    const visible = await resolveVisibleBranchIds(req.authUser!.id);

    const summary = await buildValidatedBankAccountMisSummary({
      visibleBranchIds: visible,
      branchId,
    });

    return res.json({
      success: true,
      as_of: summary.as_of,
      scope: visible ? { restricted: true, branch_count: visible.size } : { restricted: false },
      data: summary.rows,
      totals: summary.totals,
      // Says what Verified means on this screen, so it is not mistaken for the stronger claim the
      // Bank Payment Readiness page makes. Sent from here rather than hardcoded in the UI so the
      // definition has one home.
      message:
        "Verified reflects the bank account verification flag held in HRMS. " +
        "Accounts that cannot be paid — invalid IFSC, unusable or duplicated account number — are " +
        "reported under Rejected even when flagged verified.",
    });
  }),
);

/** GET /mis/detail — the employees behind one count, in the legacy column set. */
bankPaymentReadinessRouter.get(
  "/mis/detail",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const branchId = String(req.query.branch_id ?? "").trim() || null;
    const search = String(req.query.q ?? "").trim() || null;
    const rawBucket = String(req.query.bucket ?? "").trim().toLowerCase();

    if (rawBucket && !(MIS_BUCKETS as readonly string[]).includes(rawBucket)) {
      return res.status(400).json({
        success: false,
        message: `bucket must be one of ${MIS_BUCKETS.join(", ")}`,
      });
    }

    const visible = await resolveVisibleBranchIds(req.authUser!.id);
    const detail = await buildValidatedBankAccountMisDetail({
      visibleBranchIds: visible,
      branchId,
      bucket: (rawBucket || null) as MisBucket | null,
      search,
    });

    return res.json({
      success: true,
      as_of: detail.as_of,
      bucket: rawBucket || null,
      columns: MIS_DETAIL_COLUMNS,
      data: detail.rows,
      totalCount: detail.rows.length,
    });
  }),
);

/**
 * GET /mis/export — the same rows as /mis/detail, as CSV.
 *
 * Server-side rather than built in the browser, so the file and the screen come from one query and
 * one classification. Account numbers stay masked: this is a status report, not a payment
 * instruction, so it is gated on READ_ROLES rather than on org-wide export scope.
 */
bankPaymentReadinessRouter.get(
  "/mis/export",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const branchId = String(req.query.branch_id ?? "").trim() || null;
    const rawBucket = String(req.query.bucket ?? "").trim().toLowerCase();

    if (rawBucket && !(MIS_BUCKETS as readonly string[]).includes(rawBucket)) {
      return res.status(400).json({
        success: false,
        message: `bucket must be one of ${MIS_BUCKETS.join(", ")}`,
      });
    }

    const visible = await resolveVisibleBranchIds(req.authUser!.id);
    const detail = await buildValidatedBankAccountMisDetail({
      visibleBranchIds: visible,
      branchId,
      bucket: (rawBucket || null) as MisBucket | null,
    });

    // Quote every field and double any embedded quote. Cost centre values carry slashes and
    // commas (e.g. "BSS/BO/AHMH-JD/560") and Remarks carries free text, so an unquoted join would
    // shift columns.
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
    const lines = [
      MIS_DETAIL_COLUMNS.map((c) => esc(c.label)).join(","),
      ...detail.rows.map((r) => MIS_DETAIL_COLUMNS.map((c) => esc(r[c.key])).join(",")),
    ];

    const label = rawBucket ? MIS_BUCKET_LABELS[rawBucket as MisBucket].replace(/\s+/g, "") : "All";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ValidatedBankAccountMIS_${label}_${detail.as_of.slice(0, 10)}.csv"`,
    );
    res.setHeader("X-Report-Rows", String(detail.rows.length));
    // BOM so Excel reads it as UTF-8, matching /payment-file and the existing bank-export.
    return res.send("\ufeff" + lines.join("\r\n"));
  }),
);

// ─── Debit account config ─────────────────────────────────────────────────────
//
// The company account bank-advice/neft-transfer-file debit from. Used to be a raw string
// literal duplicated in payroll.executor.ts — see payroll-debit-account-config.service.ts.
// Read is available to the same roles that can already see the exception queue; write is
// restricted further, since an incorrect value here silently redirects every future
// outbound payroll payment.

const DEBIT_ACCOUNT_WRITE_ROLES = ["super_admin", "finance_head", "payroll_head"];

/** GET /debit-account-config */
bankPaymentReadinessRouter.get(
  "/debit-account-config",
  requireRole(...READ_ROLES),
  h(async (_req, res) => {
    return res.json({ success: true, data: await getDebitAccountConfig() });
  }),
);

/** PATCH /debit-account-config */
bankPaymentReadinessRouter.patch(
  "/debit-account-config",
  requireRole(...DEBIT_ACCOUNT_WRITE_ROLES),
  h(async (req, res) => {
    const { debit_account_number, bank_name } = req.body as {
      debit_account_number?: string;
      bank_name?: string | null;
    };
    const value = String(debit_account_number ?? "").trim();
    if (!/^[0-9]{6,34}$/.test(value)) {
      return res.status(400).json({
        success: false,
        message: "debit_account_number must be a 6-34 digit account number",
      });
    }
    const before = await getDebitAccountConfig();
    await setDebitAccountConfig({
      debit_account_number: value,
      bank_name: bank_name?.trim() || null,
      updated_by: req.authUser!.id,
    });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "PAYROLL_DEBIT_ACCOUNT_CONFIG_UPDATED",
      module_key: "payroll",
      entity_type: "payroll_debit_account_config",
      entity_id: "1",
      change_summary: {
        before: { debit_account_number: before.debit_account_number, bank_name: before.bank_name },
        after: { debit_account_number: value, bank_name: bank_name?.trim() || null },
      },
      req: req as never,
    });

    return res.json({ success: true, message: "Debit account updated", data: await getDebitAccountConfig() });
  }),
);

// ─── Salary Transfer & Reconciliation ─────────────────────────────────────────
//
// Generates the exact-format bank file (see salary-transfer.service.ts header for the
// reference-file inspection this is built from), tracks rejection/correction/re-export, and
// imports the Transfer Number Update File that unlocks payslips. Reuses hasExportScope — the
// same org-wide-payroll gate /payment-file already requires — since this endpoint emits full
// account numbers in the generated file exactly as that one does.

const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * GET /salary-transfer/eligible?run_id=&branch_id=&process_id=&cost_centre_id=&status=
 *
 * The employee-selection grid: everyone eligible for a NEW export from this run (READY, not
 * already open), narrowed by branch/process/cost-centre and active/inactive/both. Read-only —
 * generation still happens through /export with an explicit employee_ids list built from
 * whatever the caller selected here.
 */
bankPaymentReadinessRouter.get(
  "/salary-transfer/eligible",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  h(async (req, res) => {
    const runId = String(req.query.run_id ?? "").trim();
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });
    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }
    const status = String(req.query.status ?? "active").trim().toLowerCase();
    if (!["active", "inactive", "both"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be active, inactive or both" });
    }
    const { rows, excludedByNoc } = await getFilteredEligibleTransferRowsWithNocExclusions(runId, {
      branchId: String(req.query.branch_id ?? "").trim() || null,
      processId: String(req.query.process_id ?? "").trim() || null,
      costCentreId: String(req.query.cost_centre_id ?? "").trim() || null,
      status: status as "active" | "inactive" | "both",
    });
    return res.json({
      success: true,
      count: rows.length,
      total_amount: rows.reduce((s, r) => s + r.amount, 0),
      data: rows.map((r) => ({
        employee_id: r.employee_id,
        employee_code: r.employee_code,
        employee_name: r.employee_name,
        amount: r.amount,
        account_masked: r.account_masked,
        ifsc: r.ifsc,
        bank_name: r.bank_name,
        branch_id: r.branch_id,
        branch_name: r.branch_name,
        process_id: r.process_id,
        process_name: r.process_name,
        cost_centre_id: r.cost_centre_id,
        cost_centre_name: r.cost_centre_name,
        employee_status: r.active_status === 1 ? "active" : "inactive",
      })),
      // Owner ruling 2026-09-12: a leaver without a signed NOC must not appear in the bank
      // file. Reported here rather than silently dropped — the whole point of
      // nocBlockedEmployeesForRuns (noc-release-gate.service.ts) is that a payable employee
      // absent from the file is visible, not assumed. Empty when the kill switch is off.
      excluded_by_noc: excludedByNoc,
    });
  }),
);

/**
 * run_id/employee_ids from either a GET query string or a POST JSON body.
 *
 * A GET with a long employee_ids CSV is what this replaced part of — real 414 caught live,
 * 2026-09-11: 797 employee ids in a query string exceeds the URL length limit. GET stays
 * supported (small selections, and matches the existing /payment-file anchor-tag download
 * convention), but the frontend now uses POST once a selection is large.
 */
function readExportParams(req: any): { runId: string; employeeIds: string[] | null } {
  const runId = String(req.query.run_id ?? req.body?.run_id ?? "").trim();
  const rawIds = req.query.employee_ids ?? req.body?.employee_ids;
  let employeeIds: string[] | null = null;
  if (Array.isArray(rawIds)) {
    employeeIds = rawIds.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof rawIds === "string" && rawIds.trim()) {
    employeeIds = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return { runId, employeeIds: employeeIds && employeeIds.length ? employeeIds : null };
}

/**
 * GET|POST /salary-transfer/export and /salary-transfer/reexport — generate + download a batch.
 *
 * GET remains supported for small selections (and matches the /payment-file anchor-tag download
 * convention); POST exists because a GET query string has a hard length limit a large real
 * selection can exceed (see readExportParams above). Shared handler so the two transports and
 * the export/re-export pair don't drift from each other.
 */
function handleSalaryTransferExport(reexport: boolean) {
  return h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId, employeeIds } = readExportParams(req);
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });
    if (!(await hasExportScope(req.authUser!.id))) {
      return res.status(403).json({ success: false, message: ORG_WIDE_REQUIRED_MSG });
    }

    let result;
    try {
      result = await generateSalaryTransferBatch({ runId, userId: req.authUser!.id, employeeIds, reexport });
    } catch (err: any) {
      if (err?.code === "NO_ELIGIBLE_ROWS") {
        return res.status(409).json({
          success: false,
          message: reexport
            ? "No corrected employees are ready for re-export."
            : "No eligible employees to export for this run.",
        });
      }
      throw err;
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: reexport ? "SALARY_TRANSFER_FILE_REEXPORTED" : "SALARY_TRANSFER_FILE_GENERATED",
      module_key: "payroll",
      entity_type: "salary_transfer_batch",
      entity_id: result.batch_id,
      change_summary: { run_id: runId, row_count: result.row_count, total_amount: result.total_amount, excluded: result.excluded },
      req: req as never,
    });

    res.setHeader("Content-Type", "application/vnd.ms-excel");
    res.setHeader("Content-Disposition", `attachment; filename="${result.file_name}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Batch-Number", result.batch_number);
    res.setHeader("X-Row-Count", String(result.row_count));
    return res.send(result.buffer);
  });
}

bankPaymentReadinessRouter.get(
  "/salary-transfer/export",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  handleSalaryTransferExport(false),
);
bankPaymentReadinessRouter.post(
  "/salary-transfer/export",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  handleSalaryTransferExport(false),
);

bankPaymentReadinessRouter.get(
  "/salary-transfer/reexport",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  handleSalaryTransferExport(true),
);
bankPaymentReadinessRouter.post(
  "/salary-transfer/reexport",
  requireRole(...PAYROLL_EXPORT_ROLES, "super_admin", "admin"),
  handleSalaryTransferExport(true),
);

/** GET /salary-transfer/items?run_id= — the workflow queue: exported / rejected / corrected_ready / confirmed. */
bankPaymentReadinessRouter.get(
  "/salary-transfer/items",
  requireRole(...READ_ROLES),
  h(async (req, res) => {
    const runId = String(req.query.run_id ?? "").trim();
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT i.id, i.batch_id, i.employee_id, i.employee_code, i.amount, i.pay_mod, i.account_masked,
              i.status, i.rejection_reason, i.rejection_note, i.rejected_at,
              i.ecs_number, i.transfer_date, i.confirmed_at, i.payslip_unlocked_at, i.created_at,
              b.batch_number, b.attempt_kind,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name
         FROM salary_transfer_batch_item i
         JOIN salary_transfer_batch b ON b.id = i.batch_id
         LEFT JOIN employees e ON e.id = i.employee_id
        WHERE i.run_id = ?
        ORDER BY i.created_at DESC`,
      [runId],
    );
    // bucket: the plain-language grouping payroll actually thinks in ('Ready for Disbursal' /
    // 'Disbursed' / 'Rejected'), derived server-side from the real status enum so the frontend
    // never re-implements this mapping in two places. corrected_ready groups under
    // ready_for_disbursal -- it is functionally waiting to be picked up by the next transfer
    // number match, same as a fresh export.
    const bucketOf = (status: string): "ready_for_disbursal" | "disbursed" | "rejected" =>
      status === "confirmed" ? "disbursed" : status === "rejected" ? "rejected" : "ready_for_disbursal";

    return res.json({
      success: true,
      data: (rows as any[]).map((r) => ({
        ...r,
        bucket: bucketOf(r.status),
        rejection_reason_label: r.rejection_reason ? rejectionReasonLabel(r.rejection_reason) : null,
      })),
      rejection_reasons: REJECTION_REASONS.map((r) => ({ value: r, label: rejectionReasonLabel(r) })),
    });
  }),
);

/** PATCH /salary-transfer/items/reject — bulk-mark items rejected with a reason. */
bankPaymentReadinessRouter.patch(
  "/salary-transfer/items/reject",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { item_ids, reason, note } = req.body as { item_ids?: string[]; reason?: string; note?: string | null };
    if (!Array.isArray(item_ids) || item_ids.length === 0) {
      return res.status(400).json({ success: false, message: "item_ids must be a non-empty array" });
    }
    if (!REJECTION_REASONS.includes(reason as any)) {
      return res.status(400).json({ success: false, message: `reason must be one of ${REJECTION_REASONS.join(", ")}` });
    }
    let result;
    try {
      result = await rejectTransferItems({ itemIds: item_ids, reason: reason as any, note: note ?? null, userId: req.authUser!.id });
    } catch (err: any) {
      if (err?.code === "NOTE_REQUIRED") {
        return res.status(400).json({ success: false, message: "A note is required when reason is 'other'" });
      }
      throw err;
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "SALARY_TRANSFER_ITEM_REJECTED",
      module_key: "payroll",
      entity_type: "salary_transfer_batch_item",
      entity_id: item_ids.join(","),
      change_summary: { reason, note: note ?? null, updated: result.updated },
      req: req as never,
    });

    return res.json({ success: true, message: `${result.updated} item(s) marked rejected`, data: result });
  }),
);

/**
 * PATCH /salary-transfer/items/:itemId/mark-corrected-ready
 *
 * Deliberately does NOT accept a new account number here. The only path to "corrected" is the
 * existing bank-change-request + penny-drop approval flow (profile-approval.service.ts) —
 * this endpoint just links a rejected transfer item to that outcome once it has already
 * cleared, so an unapproved edit can never silently replace a payment account.
 */
bankPaymentReadinessRouter.patch(
  "/salary-transfer/items/:itemId/mark-corrected-ready",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    await markItemCorrectedReady(req.params.itemId);
    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "SALARY_TRANSFER_ITEM_CORRECTED_READY",
      module_key: "payroll",
      entity_type: "salary_transfer_batch_item",
      entity_id: req.params.itemId,
      change_summary: {},
      req: req as never,
    });
    return res.json({ success: true, message: "Item marked ready for re-export" });
  }),
);

/**
 * POST /salary-transfer/import/preview — multipart file upload, CSV only. Never writes.
 *
 * run_id is required: matching is scoped to the run currently open on screen, not to whichever
 * batch item for that employee happens to be newest across every run (see previewTransferNumberImport
 * for the real incident this fixes).
 */
bankPaymentReadinessRouter.post(
  "/salary-transfer/import/preview",
  requireRole(...MANAGE_ROLES),
  csvUpload.single("file"),
  h(async (req: any, res) => {
    const file = req.file as { buffer: Buffer; originalname: string } | undefined;
    if (!file) return res.status(400).json({ success: false, message: "file is required" });
    const runId = String(req.body?.run_id ?? "").trim();
    if (!runId) return res.status(400).json({ success: false, message: "run_id is required" });
    const text = file.buffer.toString("utf8");
    let rows;
    try {
      rows = parseTransferNumberCsv(text);
    } catch (err: any) {
      return res.status(400).json({ success: false, message: err?.message ?? "Could not parse CSV" });
    }
    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "No data rows found" });
    }
    const preview = await previewTransferNumberImport(rows, runId);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const summary = {
      total: preview.length,
      will_confirm: preview.filter((r) => r.outcome === "will_confirm").length,
      unmatched: preview.filter((r) => r.outcome === "unmatched").length,
      already_confirmed: preview.filter((r) => r.outcome === "already_confirmed").length,
      invalid: preview.filter((r) => r.outcome === "invalid").length,
    };
    return res.json({ success: true, file_name: file.originalname, file_sha256: sha256, summary, data: preview });
  }),
);

/** POST /salary-transfer/import/commit — commits a previously previewed set of rows. */
bankPaymentReadinessRouter.post(
  "/salary-transfer/import/commit",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { file_name, file_sha256, preview } = req.body as {
      file_name?: string;
      file_sha256?: string;
      preview?: TransferImportPreviewRow[];
    };
    if (!file_sha256 || !Array.isArray(preview) || preview.length === 0) {
      return res.status(400).json({ success: false, message: "file_sha256 and preview are required" });
    }
    const result = await commitTransferNumberImport({
      preview,
      fileName: file_name ?? "transfer-numbers.csv",
      fileSha256: file_sha256,
      userId: req.authUser!.id,
    });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "SALARY_TRANSFER_NUMBER_IMPORT_COMMITTED",
      module_key: "payroll",
      entity_type: "salary_transfer_import",
      entity_id: file_sha256,
      change_summary: { ...result },
      req: req as never,
    });

    return res.json({
      success: true,
      message: result.skipped > 0 && result.confirmed === 0
        ? "This file was already imported — no changes made (idempotent re-upload)."
        : `${result.confirmed} transfer number(s) recorded, ${result.payslips_unlocked} payslip(s) unlocked`,
      data: result,
    });
  }),
);

// ─── Manual-review bank gap ────────────────────────────────────────────────────
//
// Employees whose onboarding penny-drop landed on manual_review and were never copied into
// employee_bank_detail (the automatic copy only fires on verification_status = 'verified',
// by design — see bank-manual-review.service.ts). This is the human-clearance surface that
// gap never had: read-only masked list + one explicit, audited approval action per employee.
// Never automatic — approving is a person deciding a manual_review account is good enough.

/** GET /manual-review-queue — masked, read-accessible to the same roles as the exceptions queue. */
bankPaymentReadinessRouter.get(
  "/manual-review-queue",
  requireRole(...READ_ROLES),
  h(async (_req, res) => {
    const rows = await getManualReviewBankGaps();
    return res.json({ success: true, count: rows.length, data: rows });
  }),
);

/**
 * PATCH /manual-review-queue/:employeeId/approve — copies the manual_review account into
 * employee_bank_detail. Restricted to MANAGE_ROLES (the same roles that can act on any other
 * bank exception) rather than the broader READ_ROLES, since this is a real write of payment
 * data, not an annotation.
 */
bankPaymentReadinessRouter.patch(
  "/manual-review-queue/:employeeId/approve",
  requireRole(...MANAGE_ROLES),
  h(async (req, res) => {
    const { employeeId } = req.params;
    const result = await approveManualReviewBankDetail({ employeeId });

    if (result.status === "no_manual_review_row") {
      return res.status(404).json({ success: false, message: "No manual_review bank verification found for this employee." });
    }
    if (result.status === "already_has_primary") {
      return res.status(409).json({ success: false, message: "This employee already has an active primary bank record — nothing to approve." });
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "BANK_MANUAL_REVIEW_APPROVED",
      module_key: "payroll",
      entity_type: "employee_bank_detail",
      entity_id: employeeId,
      change_summary: { source: "candidate_bank_verification.manual_review" },
      req: req as never,
    });

    return res.json({ success: true, message: "Bank account approved and copied to the employee record." });
  }),
);

/** Exposed for the contract test that pins the mask shape. */
export const __maskForTest = maskAccount;
