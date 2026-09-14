import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveFinanceBranchScopeSet } from "./finance-access-scope.js";
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

const VOUCHER_ROLES = ["finance_head", "payroll_hr", "super_admin"] as const;

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
function parseSerial(raw: unknown): number | undefined {
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) return undefined;
  return value;
}

salaryVoucherRouter.use(requireAuth);

/** Filters vouchers to the caller's branch entitlement. */
async function scopeVouchers(req: AuthenticatedRequest, vouchers: Voucher[]): Promise<Voucher[]> {
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
      res.json({
        success: true,
        data: {
          ...generated,
          vouchers: await scopeVouchers(req, generated.vouchers),
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
    try {
      const generated = await salaryVoucherService.generate(req.params.runId, {
        companyCode: req.query.companyCode ? String(req.query.companyCode) : undefined,
        serialFrom: parseSerial(req.query.serialFrom),
      });
      const vouchers = await scopeVouchers(req, generated.vouchers);

      // Split columns are per company, and an export spanning two companies with different
      // cohort counts would have a ragged header. The widest wins; narrower rows pad with blanks.
      const splitCount = vouchers.reduce(
        (max, v) => Math.max(max, v.cohort_labels.length > 1 ? v.cohort_labels.length : 0), 0);

      const header = [
        "Vch No", "Date", "Details", "Amount",
        ...Array.from({ length: splitCount }, () => ""),
        "DebitCredit", "Cost Category", "Cost Centre",
        "Narration for Each Entry", "Narration", "VchType",
      ];

      const rows: unknown[][] = [];
      for (const voucher of vouchers) {
        for (const line of voucher.lines) {
          // The reference prints the cohort column FIRST and the remainder second, which is the
          // reverse of how they are held internally.
          const split = splitCount
            ? [...line.columns.slice(1), line.columns[0], ...Array.from({ length: Math.max(0, splitCount - line.columns.length) }, () => "")]
            : [];
          rows.push([
            voucher.voucher_no,
            voucher.date,
            line.ledger_name,
            line.amount,
            ...split,
            line.debit_credit,
            voucher.cost_category,
            voucher.cost_centre,
            voucher.narration,
            `${voucher.narration} Vch No:${voucher.voucher_no}`,
            voucher.voucher_type,
          ]);
        }
      }

      const escape = (value: unknown) => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="salary-voucher-${generated.period}.csv"`,
      );
      res.send(csv);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to export the salary voucher",
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
