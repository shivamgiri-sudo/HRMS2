import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { SYNTHETIC_RUN_CREATORS } from "../payroll/payroll.service.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveFinanceBranchScopeSet } from "./finance-access-scope.js";
import { buildCsv, buildTallyXml, buildXlsx, parseFormat } from "./salary-voucher-formats.js";
import { salaryVoucherTallyPush } from "./salary-voucher-tally-push.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { splitByLock, tallyExportLock, type LockItem } from "./tally-export-lock.service.js";
import { salaryVoucherService, type Voucher } from "./salary-voucher.service.js";
import { billSalaryVoucherService } from "./salary-voucher-bill.service.js";

/**
 * Payroll → Tally salary voucher API.
 *
 * Read-only. Nothing here writes to payroll, and nothing recalculates it — the voucher is a
 * VIEW of a run that already exists, and the moment it becomes a thing that can alter payroll
 * it stops being safe to run casually.
 *
 * ROLES ARE NARROW ON PURPOSE. A salary voucher exposes the whole payroll of a branch in one
 * response, including what individual advances were recovered. That is the most sensitive
 * payload in Finance, so it is finance_head / payroll / super_admin only — deliberately not the
 * broad GRN read set, and never branch_admin.
 *
 * Branch scope is applied ON TOP of the role: a finance user entitled to two branches gets two
 * branches' vouchers, not the whole company's.
 */

const VOUCHER_ROLES = ["finance_head", "accounts_head", "payroll_head", "payroll_hr", "super_admin"] as const;

export const salaryVoucherRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

/**
 * The starting voucher serial, or undefined.
 *
 * Validated rather than coerced: `Number("abc")` is NaN, and an unguarded NaN reaches the
 * voucher number as "HEAD OFFICE/MAS/06/26/NaN" — printed on a document that posts money, and
 * accepted by a CSV import without complaint. A bad value is treated as absent, which falls
 * back to the provisional numbering the UI already warns about.
 */
export function parseSerial(raw: unknown): number | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

salaryVoucherRouter.use(requireAuth);

/** One voucher per company and branch per run, so this is its stable identity (the voucher NUMBER is not: it depends on the serial typed in). */
const voucherKey = (v: Voucher) => `${v.company_code}|${v.branch_id}`;
const lockItems = (vs: Voucher[]): LockItem[] => vs.map((v) => ({ key: voucherKey(v), label: `${v.branch_name} (${v.company_code})` }));

class TallyLockError extends Error {
  constructor(message: string, readonly code: string, readonly locked: { label?: string; exported_at: string; exported_by_name: string | null; status: string }[]) { super(message); }
}

/**
 * The vouchers a Tally-bound export may take: never pulled before, numbered consecutively from
 * `serialFrom`. With `reexport` the person has said (and been audited for) taking them again.
 */
async function claimVouchers(req: AuthenticatedRequest, runId: string, companyCode: string | undefined, serialFrom: number, reexport: boolean, reason: unknown, format: string) {
  const generate = (skip?: Set<string>) => salaryVoucherService.generate(runId, { companyCode, serialFrom, skipBuckets: skip });
  const userId = String(req.authUser?.id ?? "");
  const role = String(req.authUser?.role ?? "");
  const first = await generate();
  const all = await scopeVouchers(req, first.vouchers);
  if (!all.length) throw new Error("There is no voucher to export for this run.");
  const { fresh, locked } = await splitByLock("salary_voucher", runId, lockItems(all));

  if (reexport) {
    const why = tallyExportLock.assertReexport(reason, req.userRoles as string[] | undefined, role);
    await tallyExportLock.recordReexport("salary_voucher", runId, locked.map((l) => ({ key: l.key, label: l.label })), userId, role, why, format);
    const claimed = await tallyExportLock.lock("salary_voucher", runId, fresh, userId, format);
    if (claimed.length !== fresh.length) throw new TallyLockError("Another export took some of these vouchers at the same moment. Try again.", "RACE", []);
    return { period: first.period, vouchers: all, reexported: locked.length, claimedKeys: claimed };
  }

  if (!fresh.length) {
    throw new TallyLockError(
      `All ${all.length} voucher(s) of this run were already pulled out for Tally. Importing them again would duplicate them. A finance head can re-export with a reason, or release the lock if the import failed.`,
      "ALL_LOCKED", locked.map((l) => ({ label: l.label, exported_at: l.lock.exported_at, exported_by_name: l.lock.exported_by_name, status: l.lock.status })));
  }
  // Lock FIRST, then build: if two people press export together, only one of them gets the keys.
  const claimed = await tallyExportLock.lock("salary_voucher", runId, fresh, userId, format);
  if (claimed.length !== fresh.length) {
    await tallyExportLock.release("salary_voucher", runId, claimed, userId, role, "Export aborted: another export took some vouchers at the same moment").catch(() => undefined);
    throw new TallyLockError("Another export took some of these vouchers at the same moment. Try again.", "RACE", []);
  }
  const lockedKeys = new Set(locked.map((l) => l.key));
  const numbered = lockedKeys.size ? await generate(lockedKeys) : first;
  const vouchers = (await scopeVouchers(req, numbered.vouchers)).filter((v) => !lockedKeys.has(voucherKey(v)));
  return { period: first.period, vouchers, reexported: 0, skipped: locked.length, claimedKeys: claimed };
}

const lockStatus = (error: unknown) => (error instanceof TallyLockError ? 409 : (error as { statusCode?: number })?.statusCode ?? 400);

/**
 * Run picker for the Salary Voucher page. /api/payroll/runs is gated to the payroll read roles
 * and branch-scopes the list, so accounts_head got an empty picker; the voucher itself is
 * already role-gated and branch-scoped by scopeVouchers, so the picker only needs the run list.
 */
salaryVoucherRouter.get(
  "/runs",
  requireRole(...VOUCHER_ROLES),
  h(async (_req, res) => {
    const [rows] = await db.execute(
      `SELECT id, run_month, status, total_employees FROM salary_prep_run
        WHERE (created_by IS NULL OR created_by NOT IN (${SYNTHETIC_RUN_CREATORS.map(() => "?").join(", ")}))
        ORDER BY run_month DESC LIMIT 24`,
      [...SYNTHETIC_RUN_CREATORS],
    );
    res.json({ success: true, data: rows });
  }),
);

/** Filters vouchers to the caller's branch entitlement. */
export async function scopeVouchers(req: AuthenticatedRequest, vouchers: Voucher[]): Promise<Voucher[]> {
  const scope = await resolveFinanceBranchScopeSet({
    userId: String(req.authUser?.id ?? ""),
    primaryRole: String(req.authUser?.role ?? ""),
    userRoles: req.userRoles ?? [],
    requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
  });
  if (scope.mode === "all") return vouchers;
  const allowed = new Set(scope.branchIds);
  return vouchers.filter((v) => allowed.has(v.branch_id));
}

salaryVoucherRouter.get(
  "/runs/:runId/vouchers",
  requireRole(...VOUCHER_ROLES),
  h(async (req, res) => {
    try {
      const generated = await salaryVoucherService.generate(req.params.runId, {
        companyCode: req.query.companyCode ? String(req.query.companyCode) : undefined,
        serialFrom: parseSerial(req.query.serialFrom),
      });
      const scoped = await scopeVouchers(req, generated.vouchers);
      const locks = await tallyExportLock.locks("salary_voucher", req.params.runId, scoped.map(voucherKey));
      res.json({
        success: true,
        data: {
          ...generated,
          vouchers: scoped.map((v) => ({ ...v, tally_lock: locks.get(voucherKey(v)) ?? null })),
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to generate the salary voucher",
      });
    }
  }),
);

/**
 * Tally import CSV, in the reference file's exact column order.
 *
 * THE HEADER IS A FORMAT CONTRACT. These are the columns of the supplied
 * `MAS SALARY VCH JUNE - 2026.xls`, including the two unnamed ones between Amount and
 * DebitCredit that carry the cohort split. Tally's import maps by position, so renaming a
 * column or inserting a "helpful" one silently maps every value to the wrong field.
 *
 * A company with no cohort rules emits no split columns at all — which is exactly what the IDC
 * reference file looks like, and why the header is built rather than hardcoded.
 */
salaryVoucherRouter.get(
  "/runs/:runId/vouchers/export",
  requireRole(...VOUCHER_ROLES),
  h(async (req, res) => {
    const format = parseFormat(req.query.format);
    const serialFrom = parseSerial(req.query.serialFrom);
    const companyCode = req.query.companyCode ? String(req.query.companyCode) : undefined;
    const send = async (vouchers: Voucher[], period: string, suffix: string, headers: Record<string, string>) => {
      const base = `salary-voucher-${period}${suffix}`;
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      if (format === "xlsx") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.xlsx"`);
        return res.send(await buildXlsx(vouchers));
      }
      if (format === "xml") {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${base}.xml"`);
        return res.send(buildTallyXml(vouchers));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${base}.csv"`);
      return res.send(buildCsv(vouchers));
    };
    try {
      // No serial: the numbers are provisional ("…/1"), so this is a PREVIEW. It is never locked and
      // is named so it cannot be mistaken for an import file. The Tally XML needs real numbers.
      if (!serialFrom) {
        if (format === "xml") {
          return res.status(400).json({ success: false, error: "Enter the next voucher number from Tally (serial) before exporting the Tally XML." });
        }
        const generated = await salaryVoucherService.generate(req.params.runId, { companyCode });
        const vouchers = await scopeVouchers(req, generated.vouchers);
        return await send(vouchers, generated.period, "-PREVIEW", { "X-Tally-Preview": "true" });
      }

      const reexport = String(req.query.reexport ?? "") === "true";
      const claim = await claimVouchers(req, req.params.runId, companyCode, serialFrom, reexport, req.query.reason, format);
      try {
        await send(claim.vouchers, claim.period, reexport && claim.reexported ? "-REEXPORT" : "", {
          "X-Tally-Locked": String(claim.vouchers.length),
          "X-Tally-Skipped-Already-Exported": String(claim.skipped ?? 0),
          "X-Tally-Reexported": String(claim.reexported),
        });
      } catch (error) {
        // The file could not be produced, so nothing was handed over: undo the lock.
        await tallyExportLock.release("salary_voucher", req.params.runId, claim.claimedKeys, String(req.authUser?.id ?? ""), String(req.authUser?.role ?? ""), "Export failed before the file was produced").catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (res.headersSent) return;
      res.status(lockStatus(error)).json({
        success: false,
        code: error instanceof TallyLockError ? error.code : undefined,
        locked: error instanceof TallyLockError ? error.locked : undefined,
        error: error instanceof Error ? error.message : "Unable to export the salary voucher",
      });
    }
  }),
);

/** Locked / posted state of a run's vouchers, for the page. */
salaryVoucherRouter.get(
  "/runs/:runId/vouchers/locks",
  requireRole(...VOUCHER_ROLES),
  h(async (req, res) => {
    const locks = await tallyExportLock.locks("salary_voucher", req.params.runId);
    res.json({ success: true, data: [...locks.values()] });
  }),
);

/**
 * Release the lock on vouchers — for when the import into Tally failed and the file has to be
 * pulled again. Finance head / super admin, with a reason, audited. Releases all of a run's locks
 * when no keys are given.
 */
salaryVoucherRouter.post(
  "/runs/:runId/vouchers/locks/release",
  requireRole("finance_head", "super_admin"),
  h(async (req, res) => {
    try {
      const reason = tallyExportLock.assertReexport(req.body?.reason, req.userRoles as string[] | undefined, String(req.authUser?.role ?? ""));
      const keys: string[] = Array.isArray(req.body?.keys) && req.body.keys.length
        ? req.body.keys.map(String)
        : [...(await tallyExportLock.locks("salary_voucher", req.params.runId)).keys()];
      const released = await tallyExportLock.release("salary_voucher", req.params.runId, keys, String(req.authUser?.id ?? ""), String(req.authUser?.role ?? ""), reason);
      res.json({ success: true, data: { released } });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Unable to release the lock" });
    }
  }),
);

/** Whether the Tally HTTP gateway is configured and answering. */
salaryVoucherRouter.get(
  "/tally/status",
  requireRole(...VOUCHER_ROLES),
  h(async (_req, res) => {
    res.json({ success: true, data: await salaryVoucherTallyPush.status() });
  }),
);

/**
 * Post a run's vouchers straight into Tally over its HTTP gateway.
 *
 * The only route here that sends data out. It writes nothing to payroll, and it needs an explicit
 * `serialFrom`: Tally owns the voucher-number sequence, and posting the provisional "…/1" numbers
 * would put wrongly numbered vouchers into the books. Narrower role list than viewing — finance
 * and super_admin only. Vouchers already posted from the same run are skipped, not re-sent.
 */
salaryVoucherRouter.post(
  "/runs/:runId/vouchers/push-to-tally",
  requireRole("finance_head", "accounts_head", "super_admin"),
  h(async (req, res) => {
    try {
      const serialFrom = parseSerial(req.body?.serialFrom);
      if (!serialFrom) {
        return res.status(400).json({ success: false, error: "Enter the next voucher number from Tally (serial) before posting." });
      }
      const companyCode = req.body?.companyCode ? String(req.body.companyCode) : undefined;
      // Same lock as the file exports: a voucher already pulled out as a file or posted is not sent
      // again (it would be imported twice), unless a finance head re-posts it with a reason.
      const claim = await claimVouchers(req, req.params.runId, companyCode, serialFrom, req.body?.reexport === true, req.body?.reason, "push");
      if (!claim.vouchers.length) return res.status(400).json({ success: false, error: "There is no voucher to post for this run." });
      const result = await salaryVoucherTallyPush.push(req.params.runId, claim.vouchers, String(req.authUser?.id ?? ""), { ignorePosted: req.body?.reexport === true });
      const keyOf = new Map(claim.vouchers.map((v) => [v.voucher_no, voucherKey(v)]));
      const posted = result.results.filter((r) => r.outcome === "posted").map((r) => keyOf.get(r.voucher_no)!).filter(Boolean);
      await tallyExportLock.markPosted("salary_voucher", req.params.runId, posted);
      // Everything this call locked that Tally did not take — rejected, skipped, or never reached
      // because the gateway went away — is unlocked again so it can be sent once the cause is fixed.
      const notPosted = claim.claimedKeys.filter((k) => !posted.includes(k));
      await tallyExportLock.release("salary_voucher", req.params.runId, notPosted, String(req.authUser?.id ?? ""), String(req.authUser?.role ?? ""), "Not accepted by Tally; unlocked for retry").catch(() => undefined);
      await logSensitiveAction({
        actor_user_id: String(req.authUser?.id ?? ""),
        actor_role: String(req.authUser?.role ?? ""),
        action_type: "SALARY_VOUCHER_TALLY_PUSH",
        module_key: "FINANCE",
        entity_type: "salary_prep_run",
        entity_id: req.params.runId,
        change_summary: { period: claim.period, posted: result.posted, failed: result.failed, skipped: result.skipped },
      }).catch(() => undefined);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(lockStatus(error)).json({
        success: false,
        code: error instanceof TallyLockError ? error.code : undefined,
        locked: error instanceof TallyLockError ? error.locked : undefined,
        error: error instanceof Error ? error.message : "Unable to post to Tally",
      });
    }
  }),
);

/**
 * The salary voucher for a company whose payroll is NOT in mas_hrms — IDC, sourced from
 * db_bill.salary_data.
 *
 * A SEPARATE endpoint on purpose. The default `/vouchers` route reads mas_hrms only; this one
 * reads an upstream database, which the charter treats as a gated boundary. Keeping them
 * distinct means the mas_hrms path can never accidentally reach for db_bill, and this one is
 * inert — a clean 400, not a crash — in any environment where `BILL_DB_HOST` is unset. Enabling
 * it in production is the deliberate act of configuring BILL_DB, nothing here.
 *
 * Same roles and the same branch scope as the mas_hrms voucher: a whole branch payroll is a
 * whole branch payroll wherever it is stored.
 */
salaryVoucherRouter.get(
  "/runs/bill/:period/vouchers",
  requireRole(...VOUCHER_ROLES),
  h(async (req, res) => {
    try {
      const generated = await billSalaryVoucherService.generateForPeriod(req.params.period, {
        companyCode: String(req.query.companyCode ?? "IDC"),
        entityPrefix: String(req.query.entityPrefix ?? req.query.companyCode ?? "IDC"),
        serialFrom: parseSerial(req.query.serialFrom),
      });
      res.json({
        success: true,
        data: { ...generated, vouchers: await scopeVouchers(req, generated.vouchers) },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to generate the db_bill salary voucher",
      });
    }
  }),
);

export default salaryVoucherRouter;
