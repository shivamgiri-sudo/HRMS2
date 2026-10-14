/**
 * From–To date range for month-driven reports.
 *
 * Month-driven reports (attendance summaries, payroll, PF/ESIC, performance scorecards) take a
 * single `month`. The report library now offers From/To on every report; for these the range is
 * expanded to the calendar months it touches, the report is run once per month, and the rows are
 * concatenated with a `report_month` column so rows from different months can be told apart.
 *
 * Months are whole: a monthly aggregate cannot be cut at an arbitrary day, so 10 Jul – 5 Aug
 * returns July and August in full. The UI says so next to the picker.
 *
 * Reports whose output is a month-specific file or a month-shaped grid (ECR, NEFT, bank advice,
 * the day-column registers, leave balance) cannot be stacked across months; for those a range is
 * accepted only when it sits inside one calendar month and is then run as that month.
 */

export const MONTH_RANGE_MAX_MONTHS = 12;

/** Month-driven reports that can be stacked across months. */
export const MONTH_STACKABLE_CODES = new Set<string>([
  // The two registers stack month by month like the other attendance reports: each month keeps
  // its own day columns (Day 1..Day 31) and a Month column tells the blocks apart.
  "attendance-register-monthly",
  "attendance-register-grid",
  "attendance-summary",
  "late-arrival-summary",
  "overtime-summary",
  "regularization-summary",
  "attendance-dispute-summary",
  "habitual-absentee-list",
  "payroll-register",
  "payroll-variance",
  "payroll-cost-summary",
  "salary-sheet-onfido",
  "payroll-reconciliation",
  "arrear-payment-register",
  "cost-centre-salary-summary",
  "process-lob-salary-cost",
  "grade-salary-distribution",
  "payslip-status",
  "lwp-deduction-register",
  "payroll-readiness-status",
  "pf-esic-salary-register",
  "pf-contribution-register",
  "pf-monthly-summary",
  "esic-contribution-register",
  "esic-monthly-summary",
  "agent-performance-summary",
  "productivity-individual-scorecard",
  "team-performance-summary",
]);

/** Month-driven reports whose layout is bound to exactly one month. */
export const MONTH_SINGLE_ONLY_CODES = new Set<string>([
  "attendance-source-sheet",
  "leave-balance",
  "leave-balance-export",
  "bank-advice",
  "neft-transfer-file",
  "pf-ecr-format",
]);

/**
 * Row-dated reports: masters, registers and worklists with no period of their own. A From–To
 * range filters the rows on the report's natural date column, named here (it must be a key the
 * report emits). Rows with no value in that column are excluded while a range is active.
 */
export const ROW_DATE_COLUMN: Record<string, string> = {
  "confirmation-due-list": "probation_end_date",
  "contract-expiry-list": "contract_end_date",
  "holiday-master-list": "holiday_date",
  "salary-advance-register": "advance_date",
  "increment-requests": "effective_from",
  "pf-esi-optout-register": "approved_at",
  "investment-declaration-status": "submitted_at",
  "fnf-pending-register": "last_working_day",
  "clearance-status-register": "last_working_day",
  "joining-pending": "expected_joining",
  "asset-inventory": "purchase_date",
  "asset-inventory-report": "purchase_date",
  "asset-allocation-register": "allocation_date",
  "training-completion-status": "last_activity_date",
  "certification-status": "certified_date",
  "document-expiry-tracker": "expiry_date",
  "document-verification-status": "submitted_date",
  "missing-documents-report": "date_of_joining",
  "org-mapping-gaps": "date_of_joining",
  "gratuity-liability-register": "date_of_joining",
  "uan-master-register": "pf_joining_date",
  "employee-status-conflicts": "date_of_joining",
};

const IST_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

/** Row value to YYYY-MM-DD in IST, or null when absent/unparseable. */
export function rowDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : IST_DAY.format(d);
}

export function planRowRange(code: string, query: { from?: unknown; to?: unknown }): { column: string; from: string; to: string } | null {
  const column = ROW_DATE_COLUMN[code];
  if (!column) return null;
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  if (!from && !to) return null;
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) throw new MonthRangeError("Select both a From date and a To date.");
  if (from > to) throw new MonthRangeError("From date must not be after To date.");
  return { column, from, to };
}

export function filterRowsByDate<T extends Record<string, unknown>>(rows: T[], column: string, from: string, to: string): T[] {
  return rows.filter(r => { const d = rowDay(r[column]); return d !== null && d >= from && d <= to; });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MonthRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MonthRangeError";
  }
}

export type MonthRangePlan = { months: string[]; stacked: boolean };

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Decide whether a request needs month expansion.
 * Returns null when the report is not month-driven, no range was given, or a month was
 * explicitly chosen (an explicit Month wins; the UI also clears the other control).
 * Throws MonthRangeError for a range that cannot be honoured.
 */
export function planMonthRange(
  code: string,
  query: { from?: unknown; to?: unknown; month?: unknown },
): MonthRangePlan | null {
  const stackable = MONTH_STACKABLE_CODES.has(code);
  const singleOnly = MONTH_SINGLE_ONLY_CODES.has(code);
  if (!stackable && !singleOnly) return null;

  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  const month = typeof query.month === "string" ? query.month : "";
  if (month || (!from && !to)) return null;

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    throw new MonthRangeError("Select both a From date and a To date.");
  }
  if (from > to) throw new MonthRangeError("From date must not be after To date.");

  const months: string[] = [];
  let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const last = monthOf(to);
  for (;;) {
    const label = `${y}-${String(m).padStart(2, "0")}`;
    months.push(label);
    if (label >= last) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (months.length > MONTH_RANGE_MAX_MONTHS) {
      throw new MonthRangeError(`Date range covers more than ${MONTH_RANGE_MAX_MONTHS} months. Narrow it.`);
    }
  }
  if (months.length > MONTH_RANGE_MAX_MONTHS) {
    throw new MonthRangeError(`Date range covers more than ${MONTH_RANGE_MAX_MONTHS} months. Narrow it.`);
  }
  if (singleOnly && months.length > 1) {
    throw new MonthRangeError("This report is produced one month at a time. Choose dates within a single month.");
  }
  return { months, stacked: stackable };
}

/** Re-point a query at one month: month set, range removed. */
export function queryForMonth(query: Record<string, unknown>, month: string): Record<string, unknown> {
  const { from: _f, to: _t, ...rest } = query;
  return { ...rest, month };
}

export function tagMonth<T extends Record<string, unknown>>(rows: T[], month: string): (T & { report_month: string })[] {
  return rows.map(r => ({ ...r, report_month: month }));
}

type Captured = { statusCode: number; body: any; error: unknown };

const ROW_RANGE_SCAN_CAP = 100000;

function captureRes(cap: Captured, real: any): any {
  const r: any = {
    status(n: number) { cap.statusCode = n; return r; },
    json(b: unknown) { cap.body = b; return r; },
    send(b: unknown) { cap.body = b; return r; },
    setHeader() { return r; },
    set() { return r; },
    end() { return r; },
    locals: real.locals,
  };
  return r;
}

/**
 * Wrap the preview handler: expand the range into per-month runs of the unchanged handler and
 * merge the JSON. Non-month-driven reports and plain requests pass straight through.
 */
export function withMonthRange(
  handler: (req: any, res: any, next: any) => unknown,
) {
  return async (req: any, res: any, next: any) => {
    let plan: MonthRangePlan | null;
    try {
      plan = planMonthRange(String(req.params.code), req.query);
    } catch (err) {
      if (err instanceof MonthRangeError) {
        res.status(400).json({ success: false, error: "INVALID_DATE_RANGE", message: err.message });
        return;
      }
      next(err);
      return;
    }
    if (!plan) {
      let rowPlan;
      try { rowPlan = planRowRange(String(req.params.code), req.query); } catch (err) {
        if (err instanceof MonthRangeError) { res.status(400).json({ success: false, error: "INVALID_DATE_RANGE", message: err.message }); return; }
        next(err); return;
      }
      if (!rowPlan) return handler(req, res, next);
      const pOffset = Math.max(0, Number(req.query.offset ?? 0) || 0);
      const pRaw = Number(req.query.limit ?? 500);
      const pLimit = Number.isFinite(pRaw) && pRaw > 0 ? Math.min(Math.floor(pRaw), 5000) : 500;
      const matched: Record<string, unknown>[] = [];
      let firstBody: any; let fetched = 0; let total = Infinity;
      const { from: _f, to: _t, ...baseQuery } = req.query;
      while (fetched < total && fetched < ROW_RANGE_SCAN_CAP) {
        const cap: Captured = { statusCode: 200, body: undefined, error: undefined };
        const q = { ...baseQuery, offset: String(fetched), limit: "5000" };
        const subReq = Object.create(req, { query: { value: q, enumerable: true } });
        await handler(subReq, captureRes(cap, res), (e: unknown) => { if (e) cap.error = e; });
        if (cap.error) { next(cap.error); return; }
        if (cap.statusCode >= 400) { res.status(cap.statusCode).json(cap.body); return; }
        firstBody ??= cap.body;
        const pageRows = (cap.body?.data ?? []) as Record<string, unknown>[];
        total = Number(cap.body?.totalCount ?? pageRows.length);
        matched.push(...filterRowsByDate(pageRows, rowPlan.column, rowPlan.from, rowPlan.to));
        fetched += pageRows.length;
        if (pageRows.length === 0) break;
      }
      const pageData = matched.slice(pOffset, pOffset + pLimit);
      res.json({
        ...firstBody,
        data: pageData,
        totalCount: matched.length,
        meta: {
          ...(firstBody?.meta ?? {}),
          count: pageData.length,
          totalCount: matched.length,
          limit: pLimit,
          offset: pOffset,
          page: Math.floor(pOffset / pLimit) + 1,
          totalPages: Math.ceil(matched.length / pLimit),
          rangeColumn: rowPlan.column,
          rangeExpanded: true,
          rangeTruncated: fetched < total,
        },
      });
      return;
    }
    if (!plan.stacked) {
      // One-month-only layout: run the unchanged handler for that single month.
      const one = Object.create(req, { query: { value: queryForMonth(req.query, plan.months[0]), enumerable: true } });
      return handler(one, res, next);
    }

    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const rawLimit = Number(req.query.limit ?? 500);
    const exportMode = ["true", "1", "yes"].includes(String(req.query.export ?? req.query.fullExport ?? "").toLowerCase());
    const limit = exportMode ? 0 : (Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 5000) : 500);

    const results: { month: string; cap: Captured }[] = [];
    for (const month of plan.months) {
      const cap: Captured = { statusCode: 200, body: undefined, error: undefined };
      const q: Record<string, unknown> = queryForMonth(req.query, month);
      // Each month must supply enough rows to fill the requested page after concatenation.
      if (!exportMode) { q.offset = "0"; q.limit = String(Math.min(offset + limit, 5000)); }
      const subReq = Object.create(req, { query: { value: q, enumerable: true } });
      const subRes = captureRes(cap, res);
      await handler(subReq, subRes, (e: unknown) => { if (e) cap.error = e; });
      results.push({ month, cap });
      if (cap.error || cap.statusCode >= 400) break;
    }

    const failed = results.find(r => r.cap.error || r.cap.statusCode >= 400);
    if (failed) {
      if (failed.cap.error) { next(failed.cap.error); return; }
      res.status(failed.cap.statusCode).json(failed.cap.body);
      return;
    }

    const all = results.flatMap(r => tagMonth(((r.cap.body?.data ?? []) as Record<string, unknown>[]), r.month));
    const totalCount = results.reduce((s, r) => s + Number(r.cap.body?.totalCount ?? r.cap.body?.data?.length ?? 0), 0);
    const data = limit > 0 ? all.slice(offset, offset + limit) : all;
    const first = results[0]?.cap.body ?? {};
    res.json({
      ...first,
      data,
      totalCount,
      meta: {
        ...(first.meta ?? {}),
        count: data.length,
        totalCount,
        limit: limit || "unlimited",
        offset,
        page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
        totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
        months: plan.months,
        rangeExpanded: true,
      },
    });
  };
}
