import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { excludeEmployeeShapedCandidatesSql } from "../ats/ats-reporting-scope.js";
import { buildIdentityMappingExceptionsSql } from "./identity-mapping-report.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";
import { buildIdentitySourceSnapshotReportSql, runIdentitySourceSnapshotSync } from "./identity-source-snapshot.js";
import {
  addScopedEmployeeFilters,
  addScopedBranchOnlyFilters,
  addFullScopedEmployeeFilters,
  reportCatalogAccessMiddleware,
  reportScopeMiddleware,
} from "./reporting-access.js";
import { REPORT_CATALOG } from "./report-catalog.js";
import type { SensitivityLevel } from "./report-catalog.js";
import { resolveFullScope } from "./reporting.scope.js";
import { executeReport, ReportExecutorNotFoundError } from "./executors/index.js";
import { resolvePayrollMonth } from "./payroll-month.js";
import type { ExecFilters, ExecOptions } from "./executors/types.js";
import {
  buildSecureXlsxBuffer,
  buildSecureFilename,
  stripCursorField,
  XlsxFileSizeError,
} from "./xlsx-secure-builder.js";
import {
  buildLeaveBalanceWorkbook,
  leaveBalanceFileName,
  businessMonth,
} from "./leave-balance-format.js";
import { buildCatalogWorkbook } from "./catalog-workbook.js";
import { recordReportAuditEvent, REPORT_AUDIT_EVENTS } from "./report-audit.service.js";

/** Report codes that render through the business-mandated Leave Balance workbook. */
const LEAVE_BALANCE_CODES = new Set(["leave-balance", "leave-balance-export"]);

/**
 * Report codes exported through the catalog-driven workbook, so the header row
 * carries the catalog's exact labels ("SR#", "LEAVE TYPE", "LEAVE REQUST DATE")
 * instead of the generic builder's uppercased row keys.
 */
const CATALOG_FORMAT_CODES = new Set(["leave-utilization"]);

export const reportSuiteRouter = Router();
reportSuiteRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const CATALOG = [
  { code: "employee-master", module: "HR", title: "Employee Master Report" },
  { code: "headcount", module: "HR", title: "Active Headcount Report" },
  { code: "employee-movement", module: "HR", title: "Joining / Exit Movement Report" },
  { code: "manager-mapping", module: "HR", title: "Reporting Manager Mapping Report" },
  { code: "attendance-daily", module: "Attendance", title: "Daily Attendance Report" },
  { code: "attendance-summary", module: "Attendance", title: "Monthly Attendance Summary" },
  { code: "biometric-reconciliation", module: "Attendance", title: "Biometric Reconciliation Report" },
  { code: "leave-balance", module: "Leave", title: "Leave Balance Report" },
  { code: "leave-utilization", module: "Leave", title: "Leave Utilization Report" },
  { code: "payroll-register", module: "Payroll", title: "Payroll Register" },
  { code: "payroll-variance", module: "Payroll", title: "Payroll Variance Report" },
  { code: "payslip-status", module: "Payroll", title: "Payslip Release/Acknowledgement Report" },
  { code: "statutory-missing", module: "Compliance", title: "Missing Statutory Details Report" },
  { code: "bank-missing", module: "Payroll", title: "Missing/Unverified Bank Details Report" },
  { code: "increment-requests", module: "Payroll", title: "Salary Increment Request Report" },
  { code: "cosec-unmapped", module: "Integration", title: "Unmapped COSEC Users Report" },
  { code: "identity-mapping-exceptions", module: "Integration", title: "Cross-System Identity Mapping Exceptions" },
  { code: "identity-source-snapshot", module: "Integration", title: "Identity Source Snapshot" },
];

function dateParam(value: unknown, fallback: string) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

/**
 * Upper bound for a `created_at BETWEEN ? AND ?` range over a DATETIME column.
 *
 * dateParam returns a bare 'YYYY-MM-DD', which MySQL coerces to midnight when compared
 * against a DATETIME — so `BETWEEN '2026-01-01' AND '2026-08-11'` excludes everything
 * recorded during 11 August. With the `to` bound defaulting to today, that means every one of
 * these reports silently drops the current day: 15 candidate rows as of 2026-08-11, and a
 * full day's worth by any evening.
 *
 * Returned as an explicit end-of-day timestamp rather than switching the SQL to
 * `< DATE_ADD(?, INTERVAL 1 DAY)`, because these are BETWEEN clauses written inline at a
 * dozen call sites and a value change is far less invasive than rewriting each predicate.
 */
function endOfDayParam(date: string): string {
  return `${date} 23:59:59`;
}

function monthParam(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 7);
}

function limitParam(value: unknown, isExport = false) {
  if (isExport) {
    return 0; // 0 means no limit for exports
  }
  const n = Number(value ?? 500);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5000) : 500;
}

function isExportRequest(query: any): boolean {
  const exportParam = String(query.export ?? query.fullExport ?? "").toLowerCase();
  return exportParam === "true" || exportParam === "1" || exportParam === "yes";
}


async function queryRows(sql: string, params: unknown[], limit: number, offset = 0) {
  let finalSql = sql;
  if (limit > 0) {
    finalSql = `${sql} LIMIT ${limit} OFFSET ${offset}`;
  }
  const [rows] = await db.execute<RowDataPacket[]>(finalSql, params);
  return rows;
}

/**
 * Runs a report query and reports how many rows it has in total.
 *
 * The count used to be unconditional, and it is not cheap: it wraps the WHOLE report query,
 * so every request executed the report twice. Measured on overtime-summary — 3,941ms for the
 * COUNT wrapper against 2,957ms for the page itself, 6,898ms for the pair. The count was the
 * larger half of the request, on a query that is expensive precisely because it aggregates.
 *
 * It is also frequently unnecessary. When a page comes back short, the total is already known
 * from arithmetic: a first page holding fewer rows than its limit IS the whole result, and a
 * later short page ends at offset + what it returned. Of the 74 reports returning rows, 21
 * fit inside a single 50-row page, so for those the second query answered a question the
 * first had already settled.
 *
 * The count still runs whenever the page comes back full, because then the total genuinely is
 * unknown. Deriving it is never an estimate — the two branches below are exact.
 */
async function queryRowsWithCount(sql: string, params: unknown[], limit: number, offset = 0): Promise<{ rows: RowDataPacket[]; totalCount: number }> {
  const dataSql = limit > 0 ? `${sql} LIMIT ${limit} OFFSET ${offset}` : sql;
  const [rows] = await db.execute<RowDataPacket[]>(dataSql, params);

  // Unlimited: the result set is entirely in hand.
  if (limit <= 0) return { rows, totalCount: rows.length };

  // Short page: this is the last one, so the total is everything skipped plus what came back.
  if (rows.length < limit) return { rows, totalCount: offset + rows.length };

  // Full page — there may be more, and only the database can say how many.
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) AS count_query`;
  const [countResult] = await db.execute<RowDataPacket[]>(countSql, params);
  return { rows, totalCount: countResult[0]?.total ?? 0 };
}

function humanizeCode(code: string) {
  return code
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackReport(code: string) {
  return {
    sql: `SELECT
            ? AS report_code,
            ? AS report_name,
            'PENDING_DATA_BUILDER' AS report_status,
            'This report tile is available in HRMS, but its dedicated backend data builder is not configured yet.' AS note,
            NOW() AS generated_at`,
    params: [code, humanizeCode(code)],
  };
}

/**
 * The curated list, minus anything that would 404 when clicked.
 *
 * CATALOG above is a hand-picked "featured reports" list; REPORT_CATALOG is what
 * reportCatalogAccessMiddleware actually admits. Nothing kept the two in step, so three codes
 * were advertised here that have no REPORT_CATALOG entry — `statutory-missing`,
 * `cosec-unmapped` and `identity-mapping-exceptions`. All three returned 404 the moment a user
 * clicked them, because the access middleware rejects an unknown code before the handler runs.
 * The report list was lying to the user.
 *
 * Filtered rather than "fixed" by adding the three to REPORT_CATALOG on purpose. Those blocks
 * apply no row scope, so admitting them would ship an org-wide data leak in the same commit
 * that made them reachable. Making them work is a separate piece of work with its own scoping;
 * until then, not offering them is the honest state.
 *
 * Computed once at module load — the inputs are both static.
 */
const SERVED_CATALOG = CATALOG.filter((entry) => REPORT_CATALOG.some((r) => r.code === entry.code));

const UNSERVABLE = CATALOG.filter((entry) => !SERVED_CATALOG.includes(entry));
if (UNSERVABLE.length > 0) {
  // Say it out loud at boot. A silently shorter list is how the drift went unnoticed.
  console.warn(
    `[report-suite] ${UNSERVABLE.length} curated report(s) omitted from /catalog — no REPORT_CATALOG entry, so they would 404: ` +
    UNSERVABLE.map((e) => e.code).join(", "),
  );
}

reportSuiteRouter.get("/catalog", h(async (_req, res) => res.json({ success: true, data: SERVED_CATALOG })));

// ── GET /api/reports/suite/:code/export ──────────────────────────────────────
// Immediate XLSX download.
// super_admin: allowed for ALL reports regardless of sensitivity.
// All other roles: only internal/confidential reports with ≤5000 rows.
// Returns 403 if not allowed, 422 if row count > cap or file > 20 MB.
const EXPORT_ROW_CAP = Number(process.env.REPORT_IMMEDIATE_EXPORT_ROWS ?? 5000);
const EXPORT_BYTE_CAP = Number(process.env.REPORT_ATTACHMENT_MAX_BYTES ?? 20_971_520);
const IMMEDIATE_LEVELS = new Set<SensitivityLevel>(['internal', 'confidential']);

reportSuiteRouter.get("/:code/export", requireAuth, h(async (req, res) => {
  const code  = String(req.params.code);
  const userId = (req as any).authUser?.id as string;

  // Look up catalog entry
  const catalogEntry = REPORT_CATALOG.find(r => r.code === code);
  if (!catalogEntry) { res.status(404).json({ error: 'REPORT_NOT_FOUND' }); return; }

  const level = (catalogEntry.sensitivityLevel ?? 'confidential') as SensitivityLevel;
  const scope = await resolveFullScope(userId);
  const userRoles = new Set(scope.roles);
  const isSuperAdmin = userRoles.has('super_admin');

  // Verify export permission
  const exportAllowed = isSuperAdmin || catalogEntry.exportRoles.length === 0 ||
    catalogEntry.exportRoles.some(r => userRoles.has(r));
  // super_admin bypasses sensitivity restriction; others need internal/confidential
  const immediateAllowed = isSuperAdmin ? exportAllowed : IMMEDIATE_LEVELS.has(level) && exportAllowed;

  if (!immediateAllowed) {
    res.status(403).json({
      error: 'FORBIDDEN',
      reason: 'This report requires email delivery. Use the Request by Email flow.',
    });
    return;
  }

  // Build ExecFilters from query string
  const filters: ExecFilters = {
    branchId:       req.query.branchId    as string | undefined,
    processId:      req.query.processId   as string | undefined,
    departmentId:   req.query.departmentId as string | undefined,
    from:           req.query.from        as string | undefined,
    to:             req.query.to          as string | undefined,
    month:          req.query.month       as string | undefined,
    year:           req.query.year        as string | undefined,
    status:         req.query.status      as string | undefined,
  };

  // Fetch at most EXPORT_ROW_CAP + 1 rows to detect overflow
  const options: ExecOptions = {
    limit: EXPORT_ROW_CAP + 1,
    offset: 0,
    cursor: null,
    includeTotal: false,
    mode: 'export',
  };

  let result;
  try {
    result = await executeReport(code, filters, scope, options);
  } catch (err) {
    if (err instanceof ReportExecutorNotFoundError) {
      res.status(404).json({ error: 'EXECUTOR_NOT_FOUND', message: 'This report is not yet available.' });
      return;
    }
    throw err;
  }

  if (result.rows.length > EXPORT_ROW_CAP) {
    res.status(422).json({
      error: 'TOO_LARGE',
      message: 'Result exceeds download limit. Request the full report by email.',
      rowCount: result.rowCount,
      limit: EXPORT_ROW_CAP,
    });
    return;
  }

  const rows = stripCursorField(result.rows);

  // ── Leave Balance: business-mandated exact workbook ─────────────────────────
  // Uses the shared 17-column layout (merged group headers, exact column widths,
  // thin borders, no metadata sheet) rather than the generic report workbook.
  // `rows` here is the complete filtered dataset for the selected filters — it is
  // fetched with the export row cap, never the preview page size.
  if (LEAVE_BALANCE_CODES.has(code)) {
    const month = businessMonth(req.query.month);
    const leaveBuffer = await buildLeaveBalanceWorkbook({ rows, month });

    if (leaveBuffer.length > EXPORT_BYTE_CAP) {
      res.status(422).json({
        error: 'FILE_TOO_LARGE',
        message: 'Generated file exceeds size limit. Request the full report by email.',
      });
      return;
    }

    await recordReportAuditEvent({
      reportRequestId: `export-${userId}-${code}-${Date.now()}`,
      eventType: REPORT_AUDIT_EVENTS.EXPORT_DOWNLOAD ?? 'EXPORT_DOWNLOAD',
      actorType: 'user',
      reportCode: code,
      message: `Immediate XLSX export: ${rows.length} rows, ${leaveBuffer.length} bytes`,
      metadataJson: { userId, rowCount: rows.length, fileSizeBytes: leaveBuffer.length, code, month },
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${leaveBalanceFileName(month)}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Content-Length', leaveBuffer.length);
    res.send(leaveBuffer);
    return;
  }

  // ── Catalog-driven exact-label workbook ─────────────────────────────────────
  if (CATALOG_FORMAT_CODES.has(code)) {
    const catalogBuffer = await buildCatalogWorkbook({
      rows,
      columns: catalogEntry.columns,
      sheetName: catalogEntry.name,
    });

    if (catalogBuffer.length > EXPORT_BYTE_CAP) {
      res.status(422).json({
        error: 'FILE_TOO_LARGE',
        message: 'Generated file exceeds size limit. Request the full report by email.',
      });
      return;
    }

    await recordReportAuditEvent({
      reportRequestId: `export-${userId}-${code}-${Date.now()}`,
      eventType: REPORT_AUDIT_EVENTS.EXPORT_DOWNLOAD ?? 'EXPORT_DOWNLOAD',
      actorType: 'user',
      reportCode: code,
      message: `Immediate XLSX export: ${rows.length} rows, ${catalogBuffer.length} bytes`,
      metadataJson: { userId, rowCount: rows.length, fileSizeBytes: catalogBuffer.length, code },
    }).catch(() => {});

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${buildSecureFilename(code, 'export')}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.setHeader('Content-Length', catalogBuffer.length);
    res.send(catalogBuffer);
    return;
  }

  const scopeSummary = scope.isSuperAdmin
    ? 'ALL BRANCHES'
    : `BRANCHES: ${scope.branchScope.mode === 'all' ? 'ALL' : scope.branchScope.ids.join(', ')}`;

  let buffer: Buffer;
  try {
    buffer = await buildSecureXlsxBuffer({
      reportName:            catalogEntry.name,
      requestReference:      `IMM-${Date.now()}`,
      requesterEmployeeCode: (req as any).authUser?.employeeCode ?? 'UNKNOWN',
      filters:               filters as Record<string, unknown>,
      scopeSummary,
      rows,
      totalRows:             rows.length,
    });
  } catch (err) {
    if (err instanceof XlsxFileSizeError) {
      res.status(422).json({
        error: 'FILE_TOO_LARGE',
        message: 'Generated file exceeds size limit. Request the full report by email.',
      });
      return;
    }
    throw err;
  }

  if (buffer.length > EXPORT_BYTE_CAP) {
    res.status(422).json({
      error: 'FILE_TOO_LARGE',
      message: 'Generated file exceeds size limit. Request the full report by email.',
    });
    return;
  }

  // Audit the export
  await recordReportAuditEvent({
    reportRequestId: `export-${userId}-${code}-${Date.now()}`,
    eventType: REPORT_AUDIT_EVENTS.EXPORT_DOWNLOAD ?? 'EXPORT_DOWNLOAD',
    actorType: 'user',
    reportCode: code,
    message: `Immediate XLSX export: ${rows.length} rows, ${buffer.length} bytes`,
    metadataJson: { userId, rowCount: rows.length, fileSizeBytes: buffer.length, code },
  }).catch(() => {});

  const filename = buildSecureFilename(code, `export`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}));

// ─── Report Metadata Endpoint ─────────────────────────────────────────────────
// Returns column definitions, row grain, RBAC info for UI rendering
reportSuiteRouter.get("/meta/:code", h(async (req, res) => {
  const code = String(req.params.code);
  const meta = getReportMeta(code);
  return res.json({ success: true, data: meta });
}));

// Report metadata registry (source of truth for column definitions)
function getReportMeta(code: string) {
  const metas: Record<string, {
    columns: Array<{ key: string; label: string; format: string; align?: string }>;
    rowGrain: string;
    primaryKey: string[];
  }> = {
    "attendance-daily": {
      columns: [
        { key: "record_date", label: "Date", format: "date" },
        { key: "employee_code", label: "Emp Code", format: "text" },
        { key: "employee_name", label: "Employee Name", format: "text" },
        { key: "branch_name", label: "Branch", format: "text" },
        { key: "process_name", label: "Process", format: "text" },
        { key: "shift_name", label: "Roster Shift", format: "text" },
        { key: "shift_start", label: "Shift Start", format: "time" },
        { key: "shift_end", label: "Shift End", format: "time" },
        { key: "punch_in", label: "Punch In", format: "time" },
        { key: "punch_out", label: "Punch Out", format: "time" },
        { key: "total_login_duration", label: "Total Login Hours", format: "duration" },
        { key: "productive_minutes", label: "Productive Minutes", format: "minutes" },
        { key: "attendance_status", label: "Status", format: "status" },
        { key: "late_by_minutes", label: "Late (mins)", format: "number", align: "right" },
      ],
      rowGrain: "One row per employee per attendance date",
      primaryKey: ["employee_code", "record_date"],
    },
    "payroll-register": {
      columns: [
        { key: "payroll_month", label: "Payroll Month", format: "text" },
        { key: "employee_code", label: "Emp Code", format: "text" },
        { key: "employee_name", label: "Employee Name", format: "text" },
        { key: "branch_name", label: "Branch", format: "text" },
        { key: "process_name", label: "Process", format: "text" },
        { key: "department_name", label: "Department", format: "text" },
        { key: "designation_name", label: "Designation", format: "text" },
        { key: "basic_pay", label: "Basic", format: "currency", align: "right" },
        { key: "hra", label: "HRA", format: "currency", align: "right" },
        { key: "gross_salary", label: "Gross Salary", format: "currency", align: "right" },
        { key: "pf_employee", label: "PF (Employee)", format: "currency", align: "right" },
        { key: "esic_employee", label: "ESIC (Employee)", format: "currency", align: "right" },
        { key: "professional_tax", label: "PT", format: "currency", align: "right" },
        { key: "tds", label: "TDS", format: "currency", align: "right" },
        { key: "lwp_deduction", label: "LWP Deduction", format: "currency", align: "right" },
        { key: "total_deductions", label: "Total Deductions", format: "currency", align: "right" },
        { key: "net_pay", label: "Net Pay", format: "currency", align: "right" },
        { key: "payable_days", label: "Payable Days", format: "number", align: "right" },
        { key: "lwp_days", label: "LWP Days", format: "number", align: "right" },
      ],
      rowGrain: "One row per employee per payroll month",
      primaryKey: ["employee_code", "payroll_month"],
    },
    "biometric-reconciliation": {
      columns: [
        { key: "record_date", label: "Date", format: "date" },
        { key: "employee_code", label: "Emp Code", format: "text" },
        { key: "employee_name", label: "Employee Name", format: "text" },
        { key: "branch_name", label: "Branch", format: "text" },
        { key: "process_name", label: "Process", format: "text" },
        { key: "attendance_status", label: "Attendance Status", format: "status" },
        { key: "processed_biometric_duration", label: "Processed Biometric", format: "duration" },
        { key: "biometric_punch_in", label: "Biometric Punch In", format: "time" },
        { key: "biometric_punch_out", label: "Biometric Punch Out", format: "time" },
        { key: "raw_biometric_duration", label: "Raw Biometric", format: "duration" },
        { key: "reconciliation_status", label: "Reconciliation Status", format: "status" },
        { key: "reconciliation_description", label: "Description", format: "text" },
      ],
      rowGrain: "One row per employee per date",
      primaryKey: ["employee_code", "record_date"],
    },
    "daily-shrinkage-report": {
      columns: [
        { key: "record_date", label: "Date", format: "date" },
        { key: "branch_name", label: "Branch", format: "text" },
        { key: "process_name", label: "Process", format: "text" },
        { key: "total_scheduled", label: "Scheduled HC", format: "number", align: "right" },
        { key: "present_hc", label: "Present HC", format: "number", align: "right" },
        { key: "absent_hc", label: "Absent HC", format: "number", align: "right" },
        { key: "leave_hc", label: "Leave HC", format: "number", align: "right" },
        { key: "total_shrinkage_pct", label: "Total Shrinkage %", format: "percentage", align: "right" },
        { key: "unplanned_shrinkage_pct", label: "Unplanned Shrinkage %", format: "percentage", align: "right" },
      ],
      rowGrain: "One row per date per branch per process",
      primaryKey: ["record_date", "branch_name", "process_name"],
    },
  };
  return metas[code] ?? { columns: [], rowGrain: "Unknown", primaryKey: [] };
}

reportSuiteRouter.post("/identity-source-snapshot/sync", requireRole("admin", "super_admin"), h(async (_req, res) => {
  const result = await runIdentitySourceSnapshotSync();
  return res.json({ success: true, data: result });
}));

reportSuiteRouter.get("/:code", reportScopeMiddleware, reportCatalogAccessMiddleware, h(async (req, res) => {
  const code = String(req.params.code);
  const isExport = isExportRequest(req.query);
  const limit = limitParam(req.query.limit, isExport);
  const params: unknown[] = [];
  const clauses: string[] = [];
  let sql = "";

  switch (code) {
    case "employee-master":
      // Was branch-only (addScopedEmployeeFilters); the export path for this same code calls
      // employeeMaster in executors/employee.executor.ts, which uses the full
      // appendScopeConditions (branch AND process AND department AND cost centre). A
      // process-scoped viewer saw more employees on screen than their own export allowed.
      // See addFullScopedEmployeeFilters in reporting-access.ts.
      await addFullScopedEmployeeFilters(req, clauses, params);
      // Had no active predicate at all, so the "Employee Master" export returned all 58,627
      // employee rows ever created — 57,502 of them inactive. Same 52x overstatement that
      // cc_headcount had, and it is why employee-master and headcount could never be
      // reconciled against each other. active_status = 1 is the agreed definition and brings
      // this to 1,125, matching headcount's population exactly.
      clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.official_email, e.mobile, e.employment_status, e.date_of_joining, e.date_of_exit,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(NULLIF(m.full_name,''), CONCAT(m.first_name,' ',COALESCE(m.last_name,''))) AS reporting_manager
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code`;
      break;
    // "headcount" now falls through to executeReport(). The inline copy kept the
    // superseded definition (active_status AND employment_status) and, because an
    // inline case wins over the executor, it was still serving 1,123 where every other
    // surface reports 1,125. Same output columns either way.
    case "employee-movement": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("(e.date_of_joining BETWEEN ? AND ? OR COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) BETWEEN ? AND ?)");
      params.push(from, to, from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.date_of_joining, COALESCE(e.date_of_exit,e.date_of_leaving,e.resignation_date) AS exit_date,
                    CASE WHEN e.date_of_joining BETWEEN ? AND ? THEN 'joining' ELSE 'exit' END AS movement_type,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY COALESCE(e.date_of_joining,e.date_of_exit,e.date_of_leaving,e.resignation_date) DESC`;
      // These values belong to placeholders that sit BEFORE the WHERE, so they must LEAD the
      // bind array — unshift, not push. Appending them shifted every parameter by one.
      // It looked fine for super_admin, whose array happened to hold the same value twice;
      // a branch-scoped user's extra predicate exposed it, and the branch id landed on the
      // month placeholder. Measured on leave-lwp-reconciliation: a scoped user got 0 rows,
      // against 200 once corrected.
      params.unshift(from, to);
      break;
    }
    // "attendance-daily" falls through to executeReport(), which now carries this SQL.
    //
    // Everything that made this report correct moved with it: it drives from employees with a
    // LEFT JOIN to attendance_daily_record so people with no attendance row still appear (a
    // UAT found 350 rows against a headcount of 1,152 before that was fixed), the date
    // predicate stays in the JOIN rather than the WHERE, and four leading placeholders are
    // unshifted for the attendance join and the session subquery.
    // "attendance-summary" falls through to executeReport(), which now carries this SQL
    // including the sargable half-open month range fixed earlier in this audit. Screen and
    // download returned the same 1,123 rows with almost no shared columns.
    // "biometric-reconciliation" falls through to executeReport(), which now carries this SQL.
    // The reconciliation CASE appears twice — once in the SELECT and once in the WHERE when a
    // status filter is supplied — because MySQL cannot filter on a SELECT alias. The two
    // copies must stay identical or filtering selects a different set from the one shown.
    // "leave-balance" has no case here on purpose. A case in this switch takes
    // precedence over the executor fallback below, and this one returned the old
    // one-row-per-employee-per-leave-type shape, silently overriding the canonical
    // pivoted executor. Leaving it unhandled makes the request fall through to
    // executeReport(), which is the single source of truth for this report.
    // "leave-utilization" has no case here on purpose — a case in this switch takes
    // precedence over the executor fallback below, and this one returned the old
    // 8-column shape. It now falls through to executeReport(), which is the single
    // source of truth for the report's format.
    case "payroll-register": {
      const month = await resolvePayrollMonth(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT spr.run_month AS payroll_month,
                    e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
                    desig.designation_name,
                    e.date_of_joining,
                    e.employment_status,
                    spl.working_days AS payable_days,
                    spl.present_days,
                    spl.leave_days,
                    spl.lwp_days AS unpaid_days,
                    COALESCE(spl.basic, 0) AS basic,
                    COALESCE(spl.hra, 0) AS hra,
                    COALESCE(spl.special_allowance, 0) AS other_earnings,
                    COALESCE(spl.overtime_pay, 0) AS overtime_amount,
                    spl.gross_salary AS gross_earnings,
                    COALESCE(spl.pf_employee, 0) AS pf,
                    COALESCE(spl.esic_employee, 0) AS esi,
                    COALESCE(spl.professional_tax, 0) AS professional_tax,
                    COALESCE(spl.tds_amount, 0) AS tds,
                    COALESCE(spl.advance_recovery, 0) AS loan_deduction,
                    spl.total_deductions,
                    spl.net_salary AS net_pay,
                    spl.status AS payroll_status,
                    CASE
                      WHEN spr.disbursed_at IS NOT NULL THEN 'Disbursed'
                      WHEN spr.status = 'approved' THEN 'Approved'
                      ELSE 'Processing'
                    END AS bank_payment_status
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN designation_master desig ON desig.id = e.designation_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY b.branch_name, p.process_name, employee_name`;
      break;
    }
    case "payroll-variance": {
      const month = await resolvePayrollMonth(req.query.month);
      const minVarianceAmount = Number(req.query.minVarianceAmount ?? 0);
      const minVariancePct = Number(req.query.minVariancePct ?? 0);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(prev.gross_salary, 0) AS previous_month_gross,
                    spl.gross_salary AS current_month_gross,
                    (spl.gross_salary - COALESCE(prev.gross_salary, 0)) AS gross_variance,
                    CASE
                      WHEN prev.gross_salary > 0
                      THEN ROUND((spl.gross_salary - prev.gross_salary) / prev.gross_salary * 100, 2)
                      ELSE NULL
                    END AS gross_variance_pct,
                    COALESCE(prev.net_salary, 0) AS previous_month_net,
                    spl.net_salary AS current_month_net,
                    (spl.net_salary - COALESCE(prev.net_salary, 0)) AS net_variance,
                    CASE
                      WHEN prev.net_salary > 0
                      THEN ROUND((spl.net_salary - prev.net_salary) / prev.net_salary * 100, 2)
                      ELSE NULL
                    END AS net_variance_pct,
                    (spl.gross_salary - spl.total_deductions) - (COALESCE(prev.gross_salary, 0) - COALESCE(prev.total_deductions, 0)) AS earnings_variance,
                    (spl.total_deductions - COALESCE(prev.total_deductions, 0)) AS deduction_variance,
                    (spl.working_days - COALESCE(prev.working_days, 0)) AS payable_day_variance,
                    (spl.present_days - COALESCE(prev.present_days, 0)) AS attendance_variance,
                    COALESCE(spl.lwp_days, 0) AS current_lwp_days,
                    COALESCE(prev.lwp_days, 0) AS previous_lwp_days,
                    CASE
                      WHEN ABS(spl.net_salary - COALESCE(prev.net_salary, 0)) > 5000 AND COALESCE(prev.net_salary, 0) > 0
                           AND ABS((spl.net_salary - prev.net_salary) / prev.net_salary) > 0.1 THEN 'Significant Variance'
                      WHEN spl.net_salary > COALESCE(prev.net_salary, 0) THEN 'Increase'
                      WHEN spl.net_salary < COALESCE(prev.net_salary, 0) THEN 'Decrease'
                      ELSE 'No Change'
                    END AS variance_reason
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN (
                 SELECT MAX(id) AS id, branch_id
                   FROM salary_prep_run
                  WHERE run_month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT('${month}', '-01'),'%Y-%m-%d'), INTERVAL 1 MONTH),'%Y-%m')
                    AND LOWER(COALESCE(status,'')) NOT IN ('draft','cancelled')
                  GROUP BY branch_id
               ) pspr_pick ON pspr_pick.branch_id = COALESCE(e.branch_id, 0)
               LEFT JOIN salary_prep_run pspr ON pspr.id = pspr_pick.id
               LEFT JOIN salary_prep_line prev ON prev.run_id = pspr.id AND prev.employee_id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              ${minVarianceAmount > 0 ? `AND ABS(spl.net_salary - COALESCE(prev.net_salary, 0)) >= ${minVarianceAmount}` : ''}
              ${minVariancePct > 0 ? `AND ABS((spl.net_salary - COALESCE(prev.net_salary, 0)) / NULLIF(prev.net_salary, 0) * 100) >= ${minVariancePct}` : ''}
              ORDER BY ABS(spl.net_salary - COALESCE(prev.net_salary, 0)) DESC`;
      break;
    }
    // "payslip-status" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file.
    case "statutory-missing":
      addScopedEmployeeFilters(req, clauses, params); clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number, eu.uan, e.epf_number, e.esic_number,
                    CONCAT_WS(',', IF(COALESCE(e.pan_number,'')='', 'PAN_MISSING', NULL), IF(eu.uan IS NULL, 'UAN_MISSING', NULL), IF(COALESCE(e.esic_number,'')='', 'ESIC_MISSING', NULL)) AS missing_items
               FROM employees e LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")}
                AND (COALESCE(e.pan_number,'')='' OR eu.uan IS NULL OR COALESCE(e.esic_number,'')='')
              ORDER BY employee_name`;
      break;
    // "bank-missing" is intentionally not handled here — it falls through to executeReport(),
    // which now carries this exact SQL. Without a registered executor its download answered
    // 404 while the screen rendered normally.
    // "increment-requests" is intentionally not handled here — it falls through to
    // executeReport(), which now carries this exact SQL. Its download previously 404'd.
    case "cosec-unmapped":
      sql = `SELECT ibd.employee_code, ibd.activity_date, ibd.first_punch, ibd.last_punch, ibd.biometric_minutes
               FROM integration_biometric_daily ibd
               LEFT JOIN employees e ON e.employee_code = ibd.employee_code
              WHERE e.id IS NULL
              ORDER BY ibd.activity_date DESC, ibd.employee_code`;
      break;

    // ─── A1: HR & Workforce ───────────────────────────────────────────────────
    // "org-structure-snapshot" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL — including the
    // row scope and the active_status = 1 test this block added, and the UNASSIGNED
    // rendering. Screen and download were previously two implementations: same 95 rows, but
    // the file named the manager counts has_manager / missing_manager while the catalogue and
    // the grid expect with_manager / without_manager, so those two columns were unreachable
    // in the workbook.

    case "cost-centre-headcount":
      // Three corrections, all to the predicate rather than the shape.
      //
      // 1. This was the only report of the 65 inline blocks that never called
      //    addScopedEmployeeFilters. Its WHERE was hardcoded, so row scope was not applied at
      //    all and a branch-scoped user saw the headcount of every branch, not just their own.
      //    Scope is enforced at the query, not in the UI, so this was a real leak rather than
      //    an untidy omission.
      //
      // 2. `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` is
      //    the superseded two-flag test. It yields 1,123 where the agreed definition —
      //    active_status alone — yields 1,125, and it is why this report could never be
      //    reconciled against headcount or employee-master. The two employees it drops are
      //    exactly the ones employee-status-conflicts exists to report.
      //
      // 3. Even after (1) was addressed with addScopedEmployeeFilters, branch was the only
      //    dimension it enforced. costCentreHeadcount in executors/employee.executor.ts (the
      //    export path for this same code) calls the full appendScopeConditions — branch AND
      //    process AND department AND cost centre — so a process-scoped viewer still saw
      //    every process's headcount on screen. See addFullScopedEmployeeFilters in
      //    reporting-access.ts.
      //
      // Grouping already carried cost_centre_code, so this report was never subject to the
      // name-collision merge that the executor version had (927 cost centres share only 913
      // names — "Snapdeal" alone is six of them).
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");
      // COALESCE on the SELECT only, never on the GROUP BY. Grouping is left exactly as it was
      // so no row can merge or split and the headcount cannot move — this changes what an
      // unmapped row is labelled, not what is counted. Verified after: still sums to 1,125.
      //
      // 4 of 41 rows here rendered a NULL cost centre. NULL reads as "nothing loaded" or as a
      // rendering fault; UNASSIGNED reads as a fact about those employees, which is what it is —
      // 64 active employees have no cost centre at all.
      sql = `SELECT COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COUNT(e.id) AS active_headcount
               FROM employees e
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.cost_centre_code, cc.cost_centre_name, b.branch_name
              ORDER BY cc.cost_centre_name`;
      break;

    case "confirmation-due-list": {
      const days = Number(req.query.days ?? 30);
      // Was branch-only (addScopedEmployeeFilters); confirmationDueList in
      // executors/employee.executor.ts — the export path for this same code — calls the full
      // appendScopeConditions (branch AND process AND department AND cost centre). A
      // process-scoped viewer saw confirmation-due employees outside their process on screen.
      // Called FIRST so its clauses and params lead the bind list; the report's own
      // conditions are pushed after, in the order their placeholders appear.
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");
      clauses.push("ep.status = 'on_probation'");
      clauses.push("ep.probation_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
      params.push(days);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    e.date_of_joining, ep.probation_end_date,
                    DATEDIFF(ep.probation_end_date, CURDATE()) AS days_remaining,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name
               FROM employees e
               JOIN employee_probation ep ON ep.employee_id = e.id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ep.probation_end_date ASC`;
      break;
    }

    case "contract-expiry-list": {
      const days = Number(req.query.days ?? 60);
      // Was branch-only (addScopedEmployeeFilters); contractExpiryList in
      // executors/employee.executor.ts — the export path for this same code — calls the full
      // appendScopeConditions (branch AND process AND department AND cost centre). A
      // process-scoped viewer saw contract-expiry employees outside their process on screen.
      // Called FIRST so its clauses and params lead the bind list; the report's own
      // conditions are pushed after, in the order their placeholders appear.
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");
      clauses.push("ec.contract_end_date IS NOT NULL");
      clauses.push("ec.contract_end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
      params.push(days);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    e.date_of_joining, ec.contract_end_date, ec.contract_type,
                    DATEDIFF(ec.contract_end_date, CURDATE()) AS days_to_expiry,
                    e.employment_type, b.branch_name, d.dept_name AS department_name
               FROM employees e
               JOIN employee_contract ec ON ec.employee_id = e.id AND ec.status = 'active'
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ec.contract_end_date ASC`;
      break;
    }

    case "lifecycle-events": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // Was branch-only, so a process-restricted viewer saw salary increments for every
      // process in their branch on screen. This report exposes current_ctc and
      // proposed_ctc across 14,467 salary_increment_request rows; NOIDA alone runs 20
      // processes over 351 employees, 26 users hold an explicit scope_type='process'
      // assignment, and any employee with a process_id resolves to a restricted process
      // scope (983 active). lifecycleEvents in executors/employee.executor.ts — the export
      // path for this same code — already calls appendScopeConditions directly; this makes
      // the screen match it exactly instead of duplicating a second, weaker copy.
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("ele.effective_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    ele.event_type, ele.effective_date AS event_date,
                    ele.old_value_json AS old_value, ele.new_value_json AS new_value, ele.remarks,
                    COALESCE(NULLIF(actor.full_name,''), CONCAT(actor.first_name,' ',COALESCE(actor.last_name,''))) AS actor_name
               FROM employee_lifecycle_event ele
               JOIN employees e ON e.id = ele.employee_id
               LEFT JOIN employees actor ON actor.id = ele.initiated_by
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ele.effective_date DESC`;
      break;
    }

    // "increment-promotion-history" falls through to executeReport(), which now carries this
    // SQL. Screen and download previously returned 1,408 and 1,368 rows.

    // "birthday-list" is intentionally not handled here — it falls through to executeReport(),
    // which now carries this exact SQL. The executor used to filter to the current month,
    // so the screen listed every employee by upcoming date and the download listed only
    // this month — a tenth of the rows. The catalogue declares a days-until column, which
    // only means anything across the whole year.

    // "anniversary-list" is intentionally not handled here — it falls through to executeReport(),
    // which now carries this exact SQL. The executor used to filter to the current month,
    // so the screen listed every employee by upcoming date and the download listed only
    // this month — a tenth of the rows. The catalogue declares a days-until column, which
    // only means anything across the whole year.

    // ─── A2: Attendance ───────────────────────────────────────────────────────
    // "daily-hc-shift" falls through to executeReport(), which now carries this SQL.
    // Screen and download returned the same 14 rows with disjoint columns.

    // "shift-adherence-detail" falls through to executeReport(), which now carries this SQL
    // including the pre-aggregated session subquery that stops multi-session days from
    // multiplying every minute figure.

    // attendance-register-grid is REMOVED — superseded by attendance-summary.
    // Any API call to this code returns a redirect hint, not data.

    // "overtime-summary" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL including the
    // pre-aggregated overtime_pay subquery and the sargable month range fixed earlier in this
    // audit. Screen and download previously disagreed on both the columns (hours vs minutes)
    // and on which days count as overtime, giving 787 rows against 789.


    // "daily-shrinkage-report" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL. Screen and
    // download previously returned the same 33 rows with disjoint columns: this block emitted
    // the nine metrics the catalogue declares, the executor emitted three of its own, and the
    // workbook therefore contained none of the columns the grid draws.

    // "monthly-shrinkage-trend" falls through to executeReport(), which now carries this SQL
    // including the derived table the window function requires. Same 430 rows both ways
    // before, with disjoint columns.

    // "punch-raw-export" falls through to executeReport(), which now carries this SQL.
    // Screen and download returned the same 160 rows with disjoint columns.

    // ─── A3: Leave ────────────────────────────────────────────────────────────
    case "leave-allocation-register": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      // Was branch-only (addScopedEmployeeFilters); leaveAllocationRegister in
      // executors/leave.executor.ts — the export path for this same code — calls the full
      // appendScopeConditions (branch AND process AND department AND cost centre). A
      // process-scoped viewer saw leave allocations outside their process on screen.
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("lbl.balance_year = ?"); params.push(year);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                                        COALESCE(zpm.process_name, 'UNASSIGNED') AS process_name,
COALESCE(zcc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(zcc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    lt.leave_code, lt.leave_name, lbl.allocated_days, lbl.adjusted_days,
                    lbl.used_days, (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS remaining_days,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name
               FROM leave_balance_ledger lbl
               JOIN employees e ON e.id = lbl.employee_id
               JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master zcc ON zcc.id = e.cost_centre_id
               LEFT JOIN process_master zpm ON zpm.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY employee_name, lt.leave_code`;
      break;
    }

    case "leave-trend-monthly": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // This block applied NO scope call at all — not even the weak branch-only one every
      // other case here had. Any authenticated report viewer saw leave trends across the
      // entire company regardless of branch, process, department or cost-centre scope.
      // leaveTrendMonthly in executors/leave.executor.ts — the export path for this same
      // code — joins `employees e` purely to scope on, even though no employee column
      // reaches its SELECT, and calls the full appendScopeConditions. The join below exists
      // for the same reason.
      await addFullScopedEmployeeFilters(req, clauses, params);
      clauses.push("lr.from_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(lr.from_date,'%Y-%m') AS month, lt.leave_code, lt.leave_name,
                    COUNT(*) AS applications_count,
                    SUM(CASE WHEN lr.status = 'approved' THEN lr.total_days ELSE 0 END) AS approved_days,
                    SUM(CASE WHEN lr.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
               FROM leave_request lr
               JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY DATE_FORMAT(lr.from_date,'%Y-%m'), lt.leave_code, lt.leave_name
              ORDER BY month DESC, lt.leave_code`;
      break;
    }

    // "leave-lwp-reconciliation" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL including the
    // params.unshift(month) the LEFT JOIN placeholder requires. Screen and download returned
    // 650 and 1,569 rows respectively; the eight columns the catalogue declares are the
    // inline shape.

    case "maternity-paternity-register": {
      addScopedEmployeeFilters(req, clauses, params);
      // Selected by leave NAME, not by a guessed code list.
      //
      // The previous filter was IN ('MAT','PAT','MATERNITY','PATERNITY','ML','PL'). Against
      // live leave_type_master four of those six codes do not exist, 'PL' is unused, and
      // 'ML' is **Medical Leave** — so the Maternity/Paternity Register returned 875 medical
      // leave requests, 648 of them men, and none of the 13 actual maternity/paternity rows.
      // The real codes are MTRL (Maternity Leave) and PTRL/PML/PL (Paternity Leave).
      //
      // Matching on leave_name is what makes this stay correct: the master spells the meaning
      // out in the name, while the codes are per-tenant and have already drifted into four
      // spellings of "paternity". A new code added tomorrow is picked up; a new code would
      // have silently fallen out of a hardcoded list, which is the failure being fixed.
      clauses.push("lt.leave_name REGEXP 'Maternity|Paternity'");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    e.gender, lt.leave_code, lt.leave_name,
                    lr.from_date AS start_date, lr.to_date AS end_date, lr.total_days,
                    lr.status, lr.created_at AS applied_on
               FROM leave_request lr
               JOIN employees e ON e.id = lr.employee_id
               JOIN leave_type_master lt ON lt.id = lr.leave_type_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lr.from_date DESC`;
      break;
    }

    // "leave-lapse-summary" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL. Screen and
    // download returned 3,000 and 2,916 rows; the nine columns the catalogue declares are the
    // inline shape.

    // "holiday-master-list" falls through to executeReport(), which now carries this SQL.

    // ─── A4: Payroll ─────────────────────────────────────────────────────────
    // "ytd-salary-summary" was implemented inline here. It now falls through to the
    // default branch, which calls executeReport() — the single implementation of this
    // report, shared by the screen, the direct XLSX and the emailed file. Behaviour is
    // preserved including both period formats (financialYear=2025-26 and year=2026);
    // see ytdSalarySummary in executors/payroll.executor.ts.

    case "cost-centre-salary-summary": {
      const month = await resolvePayrollMonth(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'Unassigned') AS cost_centre_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COUNT(DISTINCT spl.employee_id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.cost_centre_code, cc.cost_centre_name, b.branch_name
              ORDER BY total_gross DESC`;
      break;
    }

    case "process-lob-salary-cost": {
      const month = await resolvePayrollMonth(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT COALESCE(p.process_name, 'Unassigned') AS process_name,
                    COALESCE(l.lob_name, 'N/A') AS lob_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COUNT(DISTINCT spl.employee_id) AS headcount,
                    SUM(spl.gross_salary) AS total_gross,
                    SUM(spl.net_salary) AS total_net,
                    ROUND(AVG(spl.net_salary), 0) AS avg_net
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN lob_master l ON l.id = e.lob_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, l.lob_name, b.branch_name
              ORDER BY total_gross DESC`;
      break;
    }

    case "salary-advance-register":
      // Columns as originally written (advance_amount, recovery_start_month,
      // total_recovered, outstanding_amount, remarks) don't exist on
      // salary_advance_log — verified live, real columns are amount,
      // recovery_months, recovered_amount, notes, and no stored outstanding
      // balance (computed here). Never caught because this report was
      // unreachable (missing from REPORT_CATALOG) until now.
      addScopedEmployeeFilters(req, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    sal.advance_date, sal.amount AS advance_amount, sal.recovery_months,
                    sal.recovered_amount AS total_recovered,
                    (sal.amount - COALESCE(sal.recovered_amount, 0)) AS outstanding_amount,
                    sal.status, sal.notes AS remarks
               FROM salary_advance_log sal
               JOIN employees e ON e.id = sal.employee_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY sal.advance_date DESC`;
      break;

    // "lwp-deduction-register" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file. See executors/payroll.executor.ts.

    case "bank-change-requests":
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("ebd.verified = 0");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    ebd.bank_name, ebd.account_number_enc, ebd.account_number AS account_number_legacy, ebd.ifsc_code, ebd.account_holder_name,
                    ebd.is_primary, ebd.created_at AS requested_at
               FROM employee_bank_detail ebd
               JOIN employees e ON e.id = ebd.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ebd.created_at DESC`;
      break;

    case "payroll-audit-trail": {
      const month = await resolvePayrollMonth(req.query.month);
      sql = `SELECT spr.id AS run_id, spr.run_month, spr.status AS run_status,
                    spr.created_at, spr.disbursed_at,
                    COALESCE(NULLIF(creator.full_name,''), CONCAT(creator.first_name,' ',COALESCE(creator.last_name,''))) AS created_by,
                    COALESCE(NULLIF(approver.full_name,''), CONCAT(approver.first_name,' ',COALESCE(approver.last_name,''))) AS approved_by,
                    COUNT(spl.id) AS line_count,
                    SUM(spl.net_salary) AS total_net
               FROM salary_prep_run spr
               LEFT JOIN employees creator ON creator.id = spr.created_by
               LEFT JOIN employees approver ON approver.id = spr.approved_by
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
              WHERE spr.run_month = ?
              GROUP BY spr.id, spr.run_month, spr.status, spr.created_at, spr.disbursed_at,
                       creator.full_name, creator.first_name, creator.last_name,
                       approver.full_name, approver.first_name, approver.last_name
              ORDER BY spr.created_at DESC`;
      params.push(month);
      break;
    }

    // "pf-esi-optout-register" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file.

    case "grade-salary-distribution": {
      const month = monthParam(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT COALESCE(CONCAT(gb.grade_code,' - ',gb.grade_name), 'Ungraded') AS grade_band,
                    COUNT(DISTINCT e.id) AS headcount,
                    ROUND(AVG(esa.ctc_annual / 12), 0) AS avg_ctc_monthly,
                    MIN(esa.ctc_annual / 12) AS min_ctc_monthly,
                    MAX(esa.ctc_annual / 12) AS max_ctc_monthly,
                    SUM(COALESCE(spl.net_salary, 0)) AS total_net_paid
               FROM employees e
               LEFT JOIN grade_band_master gb ON gb.id = e.grade_id
               LEFT JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
               JOIN (SELECT id FROM salary_prep_run WHERE run_month = '${month}' AND LOWER(COALESCE(status,'')) NOT IN ('draft','cancelled')) spr_ids
               JOIN salary_prep_line spl ON spl.run_id = spr_ids.id AND spl.employee_id = e.id
              WHERE ${clauses.join(" AND ")}
              GROUP BY gb.grade_code, gb.grade_name
              ORDER BY avg_ctc_monthly DESC`;
      break;
    }

    // "neft-transfer-file" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file. See executors/payroll.executor.ts.

    // ─── A5: Statutory ────────────────────────────────────────────────────────
    case "pf-ecr-export": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const month = await resolvePayrollMonth(req.query.month);
      clauses.push("spr.run_month = ?"); params.push(month);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT eu.uan AS UAN, eu.member_id AS PF_member_id,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS member_name,
                    spl.gross_salary AS gross_wages,
                    LEAST(COALESCE(spl.basic, 0), 15000) AS epf_wages,
                    LEAST(COALESCE(spl.basic, 0), 15000) AS eps_wages,
                    COALESCE(spl.pf_employee, 0) AS ee_pf_share,
                    COALESCE(spl.pf_employer, 0) AS er_pf_share,
                    ROUND(COALESCE(spl.pf_employer,0) * 8.33/12, 0) AS eps_share,
                    e.date_of_joining, e.date_of_birth, e.gender,
                    spr.run_month
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN employee_uan eu ON eu.employee_id = e.id AND eu.is_active = 1
              WHERE ${clauses.join(" AND ")} AND COALESCE(spl.pf_employee,0) > 0
              ORDER BY eu.uan`;
      break;
    }

    case "pf-monthly-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // spl.eps_employer doesn't exist on salary_prep_line — verified live.
      // pf-esic-salary-register (elsewhere in this file) already derives EPS
      // the same way payroll actually computes it: 8.33% of employer PF,
      // capped monthly. Reused here instead of a non-existent stored column.
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(spl.pf_employee) AS total_ee_pf,
                    SUM(spl.pf_employer) AS total_er_pf,
                    SUM(ROUND(COALESCE(spl.pf_employer,0) * 8.33/12, 0)) AS total_eps,
                    SUM(spl.pf_employee) + SUM(spl.pf_employer) AS total_pf_contribution
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spl.pf_employee > 0
                AND LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
                AND STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d') BETWEEN ? AND ?
              GROUP BY spr.run_month
              ORDER BY spr.run_month DESC`;
      params.push(from, to);
      break;
    }

    // "uan-master-register" is intentionally not handled here — it falls through to
    // executeReport(), which now carries this exact SQL. Its download previously 404'd, on a
    // statutory register that exists to be filed.

    case "esic-monthly-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT spr.run_month,
                    COUNT(DISTINCT spl.employee_id) AS total_employees,
                    SUM(spl.esic_employee) AS total_ee_esic,
                    SUM(spl.esic_employer) AS total_er_esic,
                    SUM(spl.esic_employee) + SUM(spl.esic_employer) AS total_esic_contribution
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spl.esic_employee > 0
                AND LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')
                AND STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d') BETWEEN ? AND ?
              GROUP BY spr.run_month
              ORDER BY spr.run_month DESC`;
      params.push(from, to);
      break;
    }

    // "pt-monthly-register" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file.

    // "pf-esic-salary-register" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file.

    case "tds-working-sheet": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("YEAR(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d')) = ?"); params.push(year);
      clauses.push("LOWER(COALESCE(spr.status,'')) NOT IN ('draft','cancelled')");
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number,
                    SUM(spl.gross_salary) AS gross_ytd,
                    SUM(spl.net_salary) AS net_ytd,
                    SUM(spl.tds_amount) AS tds_deducted_ytd,
                    COUNT(DISTINCT spr.run_month) AS months
               FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
               JOIN employees e ON e.id = spl.employee_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.first_name, e.last_name, e.pan_number
              HAVING SUM(spl.tds_amount) > 0
              ORDER BY tds_deducted_ytd DESC`;
      break;
    }

    // "gratuity-liability-register" falls through to executeReport(), which now carries this
    // SQL including the five-year qualifying filter. Screen 175 rows, download 131.

    case "statutory-compliance-calendar": {
      const year = Number(req.query.year ?? new Date().getFullYear());
      // Generate a virtual compliance calendar from known monthly filing obligations
      // using salary_prep_run data as the source of payroll months
      sql = `SELECT spr.run_month AS compliance_month,
                    'PAYROLL_FILING' AS compliance_type,
                    DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m-15') AS pf_due_date,
                    DATE_FORMAT(DATE_ADD(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d'), INTERVAL 1 MONTH), '%Y-%m-15') AS esic_due_date,
                    spr.status AS run_status,
                    spr.total_employees,
                    SUM(spl.pf_employee) + SUM(spl.pf_employer) AS total_pf,
                    SUM(spl.esic_employee) + SUM(spl.esic_employer) AS total_esic,
                    SUM(spl.professional_tax) AS total_pt
               FROM salary_prep_run spr
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
              WHERE YEAR(STR_TO_DATE(CONCAT(spr.run_month,'-01'),'%Y-%m-%d')) = ?
              GROUP BY spr.id, spr.run_month, spr.status, spr.total_employees
              ORDER BY spr.run_month ASC`;
      params.push(year);
      break;
    }

    // ─── A6: ATS / Recruitment ────────────────────────────────────────────────
    case "ats-pipeline-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // ats_candidate has no "stage" column — verified live, the real column
      // is current_stage. Never caught because this report was unreachable
      // (missing from REPORT_CATALOG) until now.
      sql = `SELECT current_stage AS stage, COUNT(*) AS candidate_count,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
                    SUM(CASE WHEN status IN ('withdrawn','rejected','no_show') THEN 1 ELSE 0 END) AS dropped_count
               FROM ats_candidate
              WHERE created_at BETWEEN ? AND ? AND ${excludeEmployeeShapedCandidatesSql("ats_candidate")}
              GROUP BY current_stage
              ORDER BY FIELD(current_stage,'applied','screening','shortlisted','interview_1','interview_2','interview_3','offer','offered','onboarded','joined') , current_stage`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "candidate-source-analysis": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // This is a second, rival source-effectiveness report — recruitment.executor.ts's
      // sourceEffectiveness computes the same idea with a different formula. It had no legacy
      // exclusion, so all 29,926 employee-shaped rows counted as applications that never
      // converted, deflating every channel's joining rate.
      sql = `SELECT COALESCE(ac.sourcing_channel, 'Unknown') AS source_name,
                    COUNT(*) AS total_candidates,
                    SUM(CASE WHEN LOWER(ac.current_stage) IN ('offered','offer','onboarded','joined') THEN 1 ELSE 0 END) AS reached_offer,
                    SUM(CASE WHEN LOWER(ac.current_stage) IN ('onboarded','joined') THEN 1 ELSE 0 END) AS joined,
                    ROUND(SUM(CASE WHEN LOWER(ac.current_stage) IN ('onboarded','joined') THEN 1 ELSE 0 END) / COUNT(*) * 100, 1) AS joining_rate_pct
               FROM ats_candidate ac
              WHERE ac.created_at BETWEEN ? AND ?
                AND ${excludeEmployeeShapedCandidatesSql("ac")}
              GROUP BY ac.sourcing_channel
              ORDER BY total_candidates DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "offer-to-joining-tracker": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile, ac.email,
                    aob.bridge_date AS offer_date, aob.joining_date AS offered_doj,
                    e.date_of_joining AS actual_doj,
                    DATEDIFF(e.date_of_joining, aob.joining_date) AS doj_variance_days,
                    aob.status AS onboarding_status
               FROM ats_onboarding_bridge aob
               JOIN ats_candidate ac ON ac.id = aob.candidate_id
               LEFT JOIN employees e ON e.id = aob.employee_id
              WHERE aob.created_at BETWEEN ? AND ?
              ORDER BY aob.bridge_date DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "bgv-status-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    br.overall_status AS bgv_status, br.bgv_score,
                    br.created_at AS initiated_date,
                    br.completed_at AS completed_date,
                    br.locked AS is_locked
               FROM candidate_bgv_report br
               JOIN ats_candidate ac ON ac.id = br.candidate_id
              WHERE br.created_at BETWEEN ? AND ?
              ORDER BY br.created_at DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "recruiter-performance-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT COALESCE(ac.recruiter_name, 'Unassigned') AS recruiter_name,
                    ac.recruiter_email,
                    COUNT(*) AS total_sourced,
                    SUM(CASE WHEN LOWER(ac.current_stage) NOT IN ('applied','screening') THEN 1 ELSE 0 END) AS shortlisted,
                    SUM(CASE WHEN LOWER(ac.current_stage) IN ('offered','offer','onboarded','joined') THEN 1 ELSE 0 END) AS offered,
                    SUM(CASE WHEN LOWER(ac.current_stage) IN ('onboarded','joined') THEN 1 ELSE 0 END) AS joined,
                    ROUND(SUM(CASE WHEN LOWER(ac.current_stage) IN ('onboarded','joined') THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0) * 100, 1) AS conversion_rate_pct
               FROM ats_candidate ac
              WHERE ac.created_at BETWEEN ? AND ?
              GROUP BY ac.recruiter_name, ac.recruiter_email
              ORDER BY joined DESC, total_sourced DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "interview-slot-utilization": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ais.slot_date, ais.slot_time,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    ais.max_capacity AS total_slots,
                    ais.registered AS booked_slots,
                    ais.max_capacity - ais.registered AS available_slots,
                    ROUND(ais.registered / NULLIF(ais.max_capacity,0) * 100, 1) AS utilization_pct
               FROM ats_interview_slot ais
               LEFT JOIN branch_master b ON b.id = ais.branch_id
               LEFT JOIN process_master p ON p.id = ais.process_id
              WHERE ais.slot_date BETWEEN ? AND ?
              ORDER BY ais.slot_date DESC`;
      params.push(from, to);
      break;
    }

    case "onboarding-doc-checklist": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name,
                    ed.doc_type, ed.doc_name,
                    CASE WHEN ed.file_url IS NOT NULL AND ed.file_url != '' THEN 'Submitted' ELSE 'Missing' END AS submitted_status,
                    CASE WHEN ed.verified = 1 THEN 'Verified' WHEN ed.file_url IS NOT NULL THEN 'Pending Verification' ELSE 'Not Submitted' END AS verification_status
               FROM ats_onboarding_bridge aob
               JOIN ats_candidate ac ON ac.id = aob.candidate_id
               LEFT JOIN employees e ON e.id = aob.employee_id
               LEFT JOIN employee_documents ed ON ed.employee_id = e.id
              WHERE aob.created_at BETWEEN ? AND ?
              ORDER BY ac.full_name, ed.doc_type`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "ats-offer-tat": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    MIN(CASE WHEN csl.to_stage = 'applied' THEN csl.created_at END) AS applied_date,
                    MIN(CASE WHEN csl.to_stage = 'shortlisted' THEN csl.created_at END) AS shortlisted_date,
                    MIN(CASE WHEN csl.to_stage IN ('offered','offer') THEN csl.created_at END) AS offered_date,
                    DATEDIFF(MIN(CASE WHEN csl.to_stage IN ('offered','offer') THEN csl.created_at END),
                             MIN(CASE WHEN csl.to_stage = 'applied' THEN csl.created_at END)) AS tat_days
               FROM ats_candidate ac
               LEFT JOIN ats_candidate_stage_log csl ON csl.candidate_id = ac.id
              WHERE ac.created_at BETWEEN ? AND ?
              GROUP BY ac.id, ac.candidate_code, ac.full_name, ac.mobile
              HAVING offered_date IS NOT NULL
              ORDER BY tat_days DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    // ─── A7: Exit & Attrition ─────────────────────────────────────────────────
    case "exit-movement-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("er.submitted_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    er.submitted_at AS resignation_date,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    er.exit_type, er.exit_reason_category AS exit_reason,
                    er.status AS exit_status, COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name, p.process_name,
                    TIMESTAMPDIFF(MONTH, e.date_of_joining,
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed)) AS tenure_months
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY er.submitted_at DESC`;
      break;
    }

    case "notice-period-adherence": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    er.submitted_at AS resignation_date,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    ffc.notice_period_days AS notice_required,
                    DATEDIFF(COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed), er.submitted_at) AS notice_served,
                    GREATEST(ffc.notice_period_days - DATEDIFF(
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed),
                      er.submitted_at), 0) AS shortfall_days,
                    COALESCE(ffc.notice_recovery, 0) AS recovery_amount
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
              WHERE er.submitted_at BETWEEN ? AND ?
              ORDER BY shortfall_days DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "exit-interview-summary": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT COALESCE(er.exit_reason_category, 'Not Specified') AS exit_reason,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    COUNT(*) AS exit_count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    ROUND(AVG(TIMESTAMPDIFF(MONTH, e.date_of_joining,
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed))), 1) AS avg_tenure_months
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE er.submitted_at BETWEEN ? AND ?
              GROUP BY er.exit_reason_category, b.branch_name, p.process_name
              ORDER BY exit_count DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    // "monthly-attrition-summary" is deliberately NOT handled here.
    //
    // The inline block that used to sit at this line read `attrition_record`, which exists
    // and holds 0 rows. So the Monthly Attrition Summary reported zero attrition — every
    // month, every branch — while 1,666 employees left between January and July 2026, 165 of
    // them in July alone. A headline HR metric reading a confident zero, with no error and no
    // empty state, because the query was valid and the table was simply empty.
    //
    // Falling through reaches monthlyAttritionSummary in executors/exit.executor.ts, which
    // counts from employees.date_of_joining and COALESCE(date_of_exit, resignation_date) —
    // the columns that actually carry this (29,198 employees have an exit date recorded).
    // Its exit counts were reconciled against an independently written control query and
    // match exactly for all seven months.
    //
    // It also applies row scope, which this inline block did not: attrition by branch was
    // readable by anyone who could reach the report, regardless of their branch.

    // "ff-settlement-register" is intentionally not handled here — it falls through to
    // executeReport(), which now carries this exact SQL including the row scope added earlier
    // in this audit. Without that scope, settlement amounts were visible across every branch.

    case "clearance-status-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      // Was branch-only (addScopedEmployeeFilters); clearanceStatusRegister in
      // executors/exit.executor.ts — the export path for this same code — calls the full
      // appendScopeConditions (branch AND process AND department AND cost centre). A
      // process-scoped viewer saw exit-clearance tasks outside their process on screen.
      // This is a separate, still-open issue from the table-name bug in this same report
      // fixed in commit 212a84c7 (exit_clearance_task vs exit_clearance_checklist).
      // Called FIRST so its clauses and params lead the bind list; the report's own
      // conditions are pushed after, in the order their placeholders appear.
      await addFullScopedEmployeeFilters(req, clauses, params);
      // COALESCE, because submitted_at is NULL on 2 of 2 exit_request rows — every one.
      // `submitted_at BETWEEN ? AND ?` on a NULL evaluates to UNKNOWN, so the row is dropped:
      // the report returned nothing even once it was reading the right table. The exit module
      // writes created_at and leaves submitted_at for a submission step that never sets it,
      // so created_at is the date this report can actually filter on. Keeping submitted_at
      // first means the filter starts using it the moment it is populated.
      clauses.push("COALESCE(er.submitted_at, er.created_at) BETWEEN ? AND ?");
      params.push(from, endOfDayParam(to));
      // Reads exit_clearance_task, not exit_clearance_checklist.
      //
      // Both tables exist. exit_clearance_checklist holds 0 rows and is the older, simpler
      // shape (department/assigned_to); exit_clearance_task is what the exit module actually
      // writes — 16 rows on 2026-08-08, all 16 resolving to both an employee and an exit
      // request. So the Clearance Status Register reported "no outstanding clearances" while
      // every real clearance task sat in the other table, unread. Same shape as
      // attendance_exception vs attendance_reconciliation_issue: the dead table is the one
      // with the more obvious name.
      //
      // clearance_area replaces the free-text department, and owner_role replaces assigned_to:
      // the task table names the owning function ('payroll', 'wfm') rather than the user id
      // the checklist held, which is what the report was trying to show anyway. task_title and
      // due_date come along because the task table has them and a clearance register without a
      // due date cannot be chased.
      //
      // cleared_by is deliberately not emitted. It holds a user id, not an employee id, so it
      // cannot be resolved to a name through employees, and a raw uuid in a column labelled
      // "Cleared By" is worse than no column. cleared_at still shows whether it was cleared.
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
                    COALESCE(cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
                    COALESCE(pr.process_name, 'UNASSIGNED') AS process_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    ect.clearance_area AS clearance_department,
                    ect.task_title, ect.due_date,
                    ect.status AS clearance_status,
                    ect.owner_role AS assigned_to, ect.cleared_at, ect.remarks
               FROM exit_clearance_task ect
               JOIN exit_request er ON er.id = ect.exit_request_id
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN process_master pr ON pr.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.employee_code, ect.clearance_area`;
      break;
    }

    // ─── A8: Performance & KPI ────────────────────────────────────────────────
    case "kpi-score-summary": {
      const period = String(req.query.period ?? "");
      addScopedEmployeeFilters(req, clauses, params);
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating,
                    kss.rank_in_team, kss.rank_in_process, kss.rank_in_branch
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY kss.final_score DESC`;
      break;
    }

    case "kpi-leaderboard": {
      const period = String(req.query.period ?? "");
      addScopedEmployeeFilters(req, clauses, params);
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT kss.rank_in_process AS rank_no, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY kss.rank_in_process ASC, kss.final_score DESC`;
      break;
    }

    case "below-target-kpi": {
      const period = String(req.query.period ?? "");
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("LOWER(kss.rating) IN ('below target','needs improvement','poor','unsatisfactory')");
      if (period) { clauses.push("ksp.id = ?"); params.push(period); }
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    CONCAT(ksp.period_type,' ',ksp.period_start,' to ',ksp.period_end) AS period_label,
                    kss.final_score, kss.rating,
                    100 - kss.final_score AS gap_from_target
               FROM kpi_score_summary kss
               JOIN employees e ON e.id = kss.employee_id
               JOIN kpi_score_period ksp ON ksp.id = kss.period_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY kss.final_score ASC`;
      break;
    }

    case "appraisal-rating-summary": {
      const cycle = String(req.query.cycle ?? "");
      if (cycle) { clauses.push("pfr.cycle_id = ?"); params.push(cycle); }
      sql = `SELECT
                    CASE
                      WHEN pfr.overall_score >= 4.5 THEN 'Outstanding'
                      WHEN pfr.overall_score >= 3.5 THEN 'Exceeds Expectations'
                      WHEN pfr.overall_score >= 2.5 THEN 'Meets Expectations'
                      WHEN pfr.overall_score >= 1.5 THEN 'Needs Improvement'
                      ELSE 'Unsatisfactory'
                    END AS rating,
                    COUNT(*) AS employee_count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    ROUND(AVG(pfr.overall_score), 2) AS avg_score
               FROM performance_feedback_report pfr
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY rating
              ORDER BY avg_score DESC`;
      break;
    }

    case "pip-register":
      addScopedEmployeeFilters(req, clauses, params);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    dp.overall_notes AS plan_notes,
                    dp.plan_start_date AS pip_start, dp.plan_end_date AS pip_end,
                    dp.status,
                    COUNT(dpg.goal_id) AS goal_count,
                    SUM(CASE WHEN dpg.status = 'completed' THEN 1 ELSE 0 END) AS completed_goals
               FROM development_plan dp
               JOIN employees e ON e.id = dp.employee_id
               LEFT JOIN development_plan_goal dpg ON dpg.plan_id = dp.plan_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY dp.plan_id, e.employee_code, e.full_name, e.first_name, e.last_name,
                       dp.overall_notes, dp.plan_start_date, dp.plan_end_date, dp.status
              ORDER BY dp.plan_start_date DESC`;
      break;

    // ─── A9: WFM & Roster ─────────────────────────────────────────────────────
    // "roster-adherence" now falls through to the default branch, which calls
    // executeReport() — the single implementation shared by screen, direct XLSX and
    // emailed file.

    case "workforce-mandate-vs-actual": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, p.process_name, b.branch_name,
                    COALESCE(wm.mandated_hc, 0) AS mandated_hc,
                    SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) AS actual_hc,
                    COALESCE(wm.mandated_hc, 0) - SUM(adr.attendance_status IN ('present','half_day','week_off_worked')) AS gap,
                    ROUND((COALESCE(wm.mandated_hc,0) - SUM(adr.attendance_status IN ('present','half_day','week_off_worked')))
                          / NULLIF(wm.mandated_hc,0) * 100, 1) AS gap_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN workforce_mandate wm ON wm.process_id = e.process_id
                 AND wm.effective_from <= adr.record_date
                 AND (wm.effective_to IS NULL OR wm.effective_to >= adr.record_date)
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, p.process_name, b.branch_name, wm.mandated_hc
              ORDER BY adr.record_date DESC, gap DESC`;
      break;
    }

    case "dialer-hours-report": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    adr.dialler_minutes AS net_login_minutes,
                    ROUND(adr.dialler_minutes / 60, 2) AS net_login_hours,
                    adr.attendance_status
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")} AND adr.dialler_minutes > 0
              ORDER BY adr.record_date DESC, employee_name`;
      break;
    }

    case "process-hc-vs-mandate":
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");
      sql = `SELECT p.process_name, b.branch_name,
                    COUNT(e.id) AS current_hc,
                    COALESCE(MAX(wm.mandated_hc), 0) AS mandated_hc,
                    COALESCE(MAX(wm.mandated_hc), 0) - COUNT(e.id) AS gap
               FROM employees e
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN workforce_mandate wm ON wm.process_id = e.process_id
                 AND wm.effective_from <= CURDATE()
                 AND (wm.effective_to IS NULL OR wm.effective_to >= CURDATE())
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name
              ORDER BY gap DESC`;
      break;

    case "roster-change-audit": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT wrp.id AS plan_id, wrp.plan_name, wrp.plan_status AS status,
                    wrp.from_date, wrp.to_date,
                    wrp.required_headcount, wrp.assigned_headcount,
                    p.process_name, b.branch_name,
                    COALESCE(NULLIF(creator.full_name,''), CONCAT(creator.first_name,' ',COALESCE(creator.last_name,''))) AS created_by,
                    wrp.created_at AS changed_at
               FROM wfm_roster_plan wrp
               LEFT JOIN process_master p ON p.id = wrp.process_id
               LEFT JOIN branch_master b ON b.id = wrp.branch_id
               LEFT JOIN employees creator ON creator.id = wrp.created_by
              WHERE wrp.updated_at BETWEEN ? AND ?
              ORDER BY wrp.updated_at DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    // ─── A10: Assets & Documents ──────────────────────────────────────────────
    case "asset-inventory-report":
      // asset_status and asset_condition don't exist on asset_master —
      // verified live; the real status column is just "status", and there is
      // no condition column at all. Never caught because this report was
      // unreachable (missing from REPORT_CATALOG) until now.
      //
      // Row scope, added 2026-08-18: asset_master has its own branch_id (assets are tracked
      // at a branch independent of who they're assigned to), but is not employee-shaped — no
      // department_id/process_id/cost_centre_id/manager columns — so addScopedEmployeeFilters
      // would 500 the moment a caller passed ?departmentId=/?processId=/?costCentreId=.
      // addScopedBranchOnlyFilters applies just the branch predicate this table actually has.
      // asset_master holds 0 rows in production today (verified), so this has no live effect
      // yet — it's here so the report is safe the moment assets are entered.
      addScopedBranchOnlyFilters(req, clauses, params, "am");
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category, am.status AS asset_status,
                    am.purchase_cost, am.purchase_date,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS assigned_to,
                    e.employee_code AS assigned_employee_code,
                    aa.assigned_date
               FROM asset_master am
               LEFT JOIN asset_assignment aa ON aa.asset_id = am.id AND aa.returned_date IS NULL
               LEFT JOIN employees e ON e.id = aa.employee_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY am.asset_category, am.asset_name`;
      break;

    case "asset-assignment-register": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    aa.assigned_date, aa.returned_date, aa.return_condition,
                    CASE WHEN aa.returned_date IS NULL THEN 'assigned' ELSE 'returned' END AS assignment_status,
                    aa.notes AS remarks
               FROM asset_assignment aa
               JOIN asset_master am ON am.id = aa.asset_id
               LEFT JOIN employees e ON e.id = aa.employee_id
              WHERE aa.assigned_date BETWEEN ? AND ?
              ORDER BY aa.assigned_date DESC`;
      params.push(from, to);
      break;
    }

    // "employee-document-compliance" is intentionally not handled here — it falls through to
    // executeReport(), which now carries this exact SQL including the two-source resolution
    // between the ATS joining checklist and employee_documents. Its download previously 404'd.

    case "asset-service-log":
      sql = `SELECT am.asset_code, am.asset_name, am.asset_category,
                    ams.service_date, ams.service_type, ams.performed_by,
                    ams.cost AS service_cost, ams.service_notes AS remarks
               FROM asset_service_log ams
               JOIN asset_master am ON am.id = ams.asset_id
              ORDER BY ams.service_date DESC`;
      break;

    // ─── A11: Productivity / APR ──────────────────────────────────────────────
    // "productivity-individual-scorecard" now falls through to the default branch,
    // which calls executeReport(). The move also fixed a positional-binding bug: the
    // KPI-period JOIN placeholders were bound to scope params, so branch-scoped users
    // silently got NULL KPI scores. See attendance.executor.ts.

    case "productivity-team-rollup": {
      const month = monthParam(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT p.process_name, b.branch_name,
                    COUNT(DISTINCT e.id) AS headcount,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT e.id),0), 2) AS avg_login_hours,
                    ROUND(AVG(kss.final_score), 2) AS avg_kpi_score
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name
              ORDER BY avg_kpi_score DESC`;
      // These values belong to placeholders that sit BEFORE the WHERE, so they must LEAD the
      // bind array — unshift, not push. Appending them shifted every parameter by one.
      // It looked fine for super_admin, whose array happened to hold the same value twice;
      // a branch-scoped user's extra predicate exposed it, and the branch id landed on the
      // month placeholder. Measured on leave-lwp-reconciliation: a scoped user got 0 rows,
      // against 200 once corrected.
      params.unshift(month, month);
      break;
    }

    case "productivity-top-bottom-performers": {
      const month = monthParam(req.query.month);
      const tier = String(req.query.tier ?? "top");
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS login_hours,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct,
                    kss.final_score AS kpi_score,
                    ROUND(
                      ROUND(SUM(adr.dialler_minutes)/60, 2) * 0.4 + COALESCE(kss.final_score, 0) * 0.6,
                    2) AS composite_score
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score
              ORDER BY composite_score ${tier === "bottom" ? "ASC" : "DESC"}`;
      // These values belong to placeholders that sit BEFORE the WHERE, so they must LEAD the
      // bind array — unshift, not push. Appending them shifted every parameter by one.
      // It looked fine for super_admin, whose array happened to hold the same value twice;
      // a branch-scoped user's extra predicate exposed it, and the branch id landed on the
      // month placeholder. Measured on leave-lwp-reconciliation: a scoped user got 0 rows,
      // against 200 once corrected.
      params.unshift(month, month);
      break;
    }

    case "dialer-aht-trend": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month, p.process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / NULLIF(COUNT(CASE WHEN adr.dialler_minutes > 0 THEN 1 END), 0), 1) AS avg_daily_login_minutes,
                    COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END) AS present_days
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), p.process_name
              ORDER BY month DESC, process_name`;
      break;
    }

    case "schedule-adherence-vs-kpi": {
      const month = monthParam(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct,
                    kss.final_score AS kpi_score, kss.rating,
                    CASE WHEN COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                              / NULLIF(COUNT(*),0) < 0.85 AND kss.final_score < 70
                         THEN 'HIGH_RISK' ELSE 'OK' END AS correlation_flag
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score, kss.rating
              ORDER BY attendance_pct ASC`;
      // These values belong to placeholders that sit BEFORE the WHERE, so they must LEAD the
      // bind array — unshift, not push. Appending them shifted every parameter by one.
      // It looked fine for super_admin, whose array happened to hold the same value twice;
      // a branch-scoped user's extra predicate exposed it, and the branch id landed on the
      // month placeholder. Measured on leave-lwp-reconciliation: a scoped user got 0 rows,
      // against 200 once corrected.
      params.unshift(month, month);
      break;
    }

    // ─── Missing Attendance ───────────────────────────────────────────────────
    // "late-arrival-summary" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL, so the screen
    // and the downloaded XLSX are one implementation. They were two: this block returned one
    // row per late arrival (2,199 live) while the executor grouped by employee and returned
    // totals (577), and which one a user got depended on whether they looked or downloaded.
    // The catalogue's 16 declared columns match the detail shape, so the detail is the report.

    // "regularization-summary" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL. Screen and
    // download were two implementations of two different reports: this block returned one row
    // per request (2 live) and the executor grouped by employee into counts (4), sharing no
    // column. The catalogue's 19 declared columns match the detail.

    // "attendance-dispute-summary" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL — including the
    // `dispute_type IS NOT NULL` predicate the executor lacked entirely, without which every
    // regularization in the shared table counted as a dispute.

    // ─── Missing Leave ────────────────────────────────────────────────────────
    // "leave-encashment-register" is deliberately NOT handled here.
    //
    // The inline block that used to sit at this line queried a table named `leave_encashment`,
    // which does not exist in mas_hrms — verified 2026-08-08, ER_NO_SUCH_TABLE. Because this
    // router is consulted before the executor map, the report could only ever return a 500.
    // It is deliberately absent from the frontend catalogue, so this is a deep-link and API
    // path rather than a visible tile — but the executors stay registered precisely so old
    // deep links resolve, and resolving to a 500 is not resolving.
    //
    // Falling through hands the code to leaveEncashmentRegister in executors/leave.executor.ts,
    // which targets leave_encashment_request and, when that table is absent, raises
    // ReportSourceUnavailableError — the report reads as "blocked, no source" instead of
    // failing. That distinction matters here: an empty encashment register reads as a settled
    // zero liability, which is a different and worse claim than "not recorded in this system".
    //
    // Restoring an inline handler for this code means restoring the shadow. If encashment
    // data ever lands, give the executor the real table.

    // ─── Missing Payroll ──────────────────────────────────────────────────────
    case "payroll-readiness-status": {
      // Defaults to the latest month that actually HAS a payroll run, not to today. Payroll is
      // closed in arrears, so for most of any month there is no run yet and monthParam's
      // calendar default drew an empty grid — indistinguishable from "payroll ran and produced
      // nothing". This block evaded the guard that catches exactly this until now: the old
      // process filter contained a `FROM process_master` subquery, which appeared before the
      // real FROM, so the check read the driving table as process_master and exempted it.
      const month = await resolvePayrollMonth(req.query.month);
      const prsClauses = ["spr.run_month = ?"];
      const prsParams: unknown[] = [month];

      // The branch dimension used to be sourced from spr.branch_id, which is NULL on ALL 66
      // runs — verified live 2026-08-10. That is not missing data: a payroll run is org-wide and
      // covers 4 to 13 branches at once, so the column has nothing to hold. Three defects
      // followed from reading it anyway, none of which announced itself:
      //   - the Branch column rendered blank on every row;
      //   - the branch filter (spr.branch_id = ?) could never match, so choosing a branch
      //     silently returned an empty grid rather than an error;
      //   - the process filter had the same defect, and additionally looked branch up from
      //     process_master, conflating two different dimensions.
      // A row-scope predicate on spr.branch_id would have been worse still — it would have
      // dropped all 66 runs for every scoped user while looking like a security fix.
      //
      // The branch a run touches is carried by its LINES, via the employee on each line. Joining
      // that way makes the grain the catalogue already declared — one row per run per branch —
      // true for the first time, and lets the declared branch filter and branch scoping work.
      // addScopedEmployeeFilters handles both: an explicit ?branchId, and the caller's own
      // entitlement when they do not pass one. No catalogue change was needed; the entry has
      // described this shape all along and only the SQL failed to implement it.
      //
      // Verified on 2026-07: 11 branch rows summing to 1,464 lines, which reconciles exactly
      // with an independent count of that run's lines. The run touches 13 distinct branch_ids
      // but yields 11 rows because three ids share one branch_name — grouping by name is
      // deliberate and consistent with the rest of the suite, and loses no lines.
      addScopedEmployeeFilters(req, prsClauses, prsParams);

      // spr.finalized_at doesn't exist — verified live. salary_prep_run has no
      // "finalized" timestamp column at all; disbursed_at is the closest real
      // analog (the run reaching its final, paid state). Never caught because
      // this report was unreachable (missing from REPORT_CATALOG) until now.
      //
      // LEFT JOIN to the lines, not JOIN: a run that has produced no lines yet is precisely the
      // "not ready" state this report exists to show, and an inner join would hide it.
      sql = `SELECT spr.run_month AS payroll_month,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    spr.status AS run_status,
                    COUNT(spl.id) AS total_lines,
                    spr.disbursed_at AS finalized_at,
                    COALESCE(NULLIF(fin.full_name,''), CONCAT(fin.first_name,' ',COALESCE(fin.last_name,''))) AS finalized_by
               FROM salary_prep_run spr
               LEFT JOIN salary_prep_line spl ON spl.run_id = spr.id
               LEFT JOIN employees e ON e.id = spl.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN employees fin ON fin.id = spr.approved_by
              WHERE ${prsClauses.join(" AND ")}
              GROUP BY spr.id, spr.run_month, b.branch_name, spr.status, spr.disbursed_at, fin.full_name, fin.first_name, fin.last_name
              ORDER BY spr.run_month DESC, branch_name`;
      params.length = 0; params.push(...prsParams);
      break;
    }

    // ─── Missing Statutory ────────────────────────────────────────────────────
    case "esic-challan-data": {
      const month = monthParam(req.query.month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.esic_number, b.branch_name,
                    COALESCE(gross_comp.amount, 0) AS gross_wages,
                    COALESCE(esic_ee.amount, 0) AS employee_esic,
                    COALESCE(esic_er.amount, 0) AS employer_esic
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN (
                 SELECT spl.employee_id, SUM(splc.amount) AS amount
                   FROM salary_prep_line spl
                   JOIN salary_prep_line_component splc ON splc.line_id = spl.id
                   JOIN salary_prep_run spr ON spr.id = spl.run_id
                  WHERE spr.payroll_month = ? AND LOWER(splc.component_code) LIKE '%gross%'
                  GROUP BY spl.employee_id
               ) gross_comp ON gross_comp.employee_id = e.id
               LEFT JOIN (
                 SELECT spl.employee_id, SUM(splc.amount) AS amount
                   FROM salary_prep_line spl
                   JOIN salary_prep_line_component splc ON splc.line_id = spl.id
                   JOIN salary_prep_run spr ON spr.id = spl.run_id
                  WHERE spr.payroll_month = ? AND LOWER(splc.component_code) IN ('esic_ee','esic_employee','esic')
                  GROUP BY spl.employee_id
               ) esic_ee ON esic_ee.employee_id = e.id
               LEFT JOIN (
                 SELECT spl.employee_id, SUM(splc.amount) AS amount
                   FROM salary_prep_line spl
                   JOIN salary_prep_line_component splc ON splc.line_id = spl.id
                   JOIN salary_prep_run spr ON spr.id = spl.run_id
                  WHERE spr.payroll_month = ? AND LOWER(splc.component_code) IN ('esic_er','esic_employer')
                  GROUP BY spl.employee_id
               ) esic_er ON esic_er.employee_id = e.id
              WHERE e.active_status = 1 AND e.esic_number IS NOT NULL AND e.esic_number != ''
              ORDER BY e.employee_code`;
      params.push(month, month, month);
      break;
    }

    case "pt-slab-master": {
      const state = String(req.query.state ?? "");
      if (state) { clauses.push("psc.state_code = ?"); params.push(state); }
      sql = `SELECT psc.state_code, psc.state_name,
                    psc.salary_from, psc.salary_to, psc.pt_amount,
                    psc.frequency, psc.effective_from, psc.effective_to,
                    psc.is_active
               FROM pt_slab_config psc
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY psc.state_code, psc.salary_from`;
      break;
    }

    case "form16-data": {
      const financialYear = String(req.query.financialYear ?? `${new Date().getFullYear() - 1}-${String(new Date().getFullYear()).slice(2)}`);
      addScopedEmployeeFilters(req, clauses, params);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    e.pan_number, b.branch_name,
                    td.gross_salary, td.total_deductions, td.taxable_income,
                    td.tds_deducted, td.tds_deposited,
                    td.financial_year, td.status
               FROM tax_declaration td
               JOIN employees e ON e.id = td.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE td.financial_year = ?
                AND ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY e.employee_code`;
      params.unshift(financialYear);
      break;
    }

    case "gratuity-monthly-accrual": {
      const month = monthParam(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("DATE_FORMAT(gal.accrual_month,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    gal.accrual_month, gal.eligible_wage, gal.accrual_amount,
                    gal.cumulative_accrual, gal.years_of_service,
                    gal.calculation_basis
               FROM gratuity_accrual_ledger gal
               JOIN employees e ON e.id = gal.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY e.employee_code`;
      break;
    }

    case "posh-compliance-register": {
      const year = String(req.query.year ?? new Date().getFullYear());
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("YEAR(pc.complaint_date) = ?"); params.push(year);
      sql = `SELECT pc.complaint_id, pc.complaint_date,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    pc.complainant_designation, pc.respondent_designation,
                    pc.complaint_type, pc.status, pc.ic_formed,
                    pc.inquiry_completed_at, pc.resolution_date,
                    DATEDIFF(COALESCE(pc.resolution_date, CURDATE()), pc.complaint_date) AS days_open
               FROM posh_complaint pc
               LEFT JOIN branch_master b ON b.id = pc.branch_id
               LEFT JOIN process_master p ON p.id = pc.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY pc.complaint_date DESC`;
      break;
    }

    case "labour-compliance-register": {
      const year = String(req.query.year ?? new Date().getFullYear());
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("YEAR(lce.due_date) = ?"); params.push(year);
      sql = `SELECT lce.compliance_type, lce.act_name, lce.form_number,
                    b.branch_name, lce.state_code,
                    lce.due_date, lce.filed_date, lce.status,
                    lce.filing_reference, lce.remarks
               FROM labour_compliance_event lce
               LEFT JOIN branch_master b ON b.id = lce.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY lce.due_date DESC`;
      break;
    }

    // ─── Missing ATS / Onboarding ─────────────────────────────────────────────
    case "bgv-vendor-dispatch-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      sql = `SELECT ac.candidate_code, ac.full_name,
                    abc.vendor_name, abc.check_type,
                    abc.dispatched_at, abc.received_at,
                    DATEDIFF(COALESCE(abc.received_at, NOW()), abc.dispatched_at) AS tat_days,
                    abc.status, abc.result, abc.remarks
               FROM ats_bgv_check abc
               JOIN ats_candidate ac ON ac.id = abc.candidate_id
              WHERE abc.dispatched_at BETWEEN ? AND ?
              ORDER BY abc.dispatched_at DESC`;
      params.push(from, endOfDayParam(to));
      break;
    }

    case "onboarding-request-status": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId) { clauses.push("aor.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status) { clauses.push("aor.status = ?"); params.push(String(req.query.status)); }
      clauses.push("aor.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT ac.candidate_code, ac.full_name, ac.mobile,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    aor.status, aor.joining_date, aor.created_at AS request_date,
                    DATEDIFF(COALESCE(aor.completed_at, CURDATE()), aor.created_at) AS days_in_progress
               FROM ats_onboarding_request aor
               JOIN ats_candidate ac ON ac.id = aor.candidate_id
               LEFT JOIN branch_master b ON b.id = aor.branch_id
               LEFT JOIN process_master p ON p.id = aor.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aor.created_at DESC`;
      break;
    }

    case "offer-letter-tat-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId) { clauses.push("aol.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("aol.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT ac.candidate_code, ac.full_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    aol.created_at AS offer_generated_at,
                    aol.sent_at AS offer_sent_at,
                    aol.signed_at AS offer_accepted_at,
                    DATEDIFF(aol.sent_at, aol.created_at) AS generation_to_send_days,
                    DATEDIFF(aol.signed_at, aol.sent_at) AS send_to_accept_days,
                    aol.status AS offer_status
               FROM ats_offer_letter aol
               JOIN ats_candidate ac ON ac.id = aol.candidate_id
               LEFT JOIN branch_master b ON b.id = aol.branch_id
               LEFT JOIN process_master p ON p.id = aol.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY aol.created_at DESC`;
      break;
    }

    case "cheque-name-mismatch-report": {
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status) { clauses.push("ebd.verification_status = ?"); params.push(String(req.query.status)); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    ebd.account_holder_name AS bank_name,
                    ebd.penny_drop_name AS verified_name,
                    ebd.bank_name AS bank,
                    ebd.account_number, ebd.ifsc_code,
                    ebd.verification_status, ebd.mismatch_reason,
                    ebd.updated_at
               FROM employee_bank_detail ebd
               JOIN employees e ON e.id = ebd.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ebd.penny_drop_name IS NOT NULL
                AND LOWER(TRIM(ebd.account_holder_name)) != LOWER(TRIM(ebd.penny_drop_name))
                AND ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY ebd.updated_at DESC`;
      break;
    }

    case "bgv-completion-rate": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId) { clauses.push("aob.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("aob.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("ac.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT b.branch_name, p.process_name,
                    COUNT(DISTINCT ac.id) AS total_candidates,
                    SUM(CASE WHEN abc.status = 'clear' THEN 1 ELSE 0 END) AS bgv_cleared,
                    SUM(CASE WHEN abc.status = 'discrepancy' THEN 1 ELSE 0 END) AS bgv_discrepancy,
                    SUM(CASE WHEN abc.id IS NULL THEN 1 ELSE 0 END) AS bgv_pending,
                    ROUND(SUM(CASE WHEN abc.status = 'clear' THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(DISTINCT ac.id),0) * 100, 1) AS completion_rate_pct
               FROM ats_candidate ac
               LEFT JOIN ats_onboarding_bridge aob ON aob.candidate_id = ac.id
               LEFT JOIN branch_master b ON b.id = aob.branch_id
               LEFT JOIN process_master p ON p.id = aob.process_id
               LEFT JOIN ats_bgv_check abc ON abc.candidate_id = ac.id
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name, p.process_name
              ORDER BY completion_rate_pct DESC`;
      break;
    }

    case "esign-digilocker-status": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.status) { clauses.push("ejdc.status = ?"); params.push(String(req.query.status)); }
      clauses.push("ejdc.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    ejdc.doc_type, ejdc.status,
                    ejdc.esign_requested_at, ejdc.esign_completed_at,
                    ejdc.digilocker_linked,
                    DATEDIFF(COALESCE(ejdc.esign_completed_at, CURDATE()), ejdc.esign_requested_at) AS tat_days
               FROM employee_joining_document_checklist ejdc
               JOIN employees e ON e.id = ejdc.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ejdc.doc_type IN ('appointment_letter','offer_letter','esign','digilocker')
                AND ${clauses.join(" AND ")}
              ORDER BY ejdc.esign_requested_at DESC`;
      break;
    }

    // ─── Missing Exit ─────────────────────────────────────────────────────────
    case "rehire-eligibility-register": {
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(d.dept_name, 'UNASSIGNED') AS department_name, p.process_name,
                    er.exit_type, er.exit_reason_category,
                    COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
                    TIMESTAMPDIFF(MONTH, e.date_of_joining,
                      COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed)) AS tenure_months,
                    CASE WHEN er.exit_type NOT IN ('termination','dismissal','absconding')
                          AND COALESCE(ffc.is_ff_provisional, 0) = 0
                         THEN 'Eligible' ELSE 'Not Eligible' END AS rehire_eligible,
                    er.rehire_flag, er.exit_notes
               FROM exit_request er
               JOIN employees e ON e.id = er.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN department_master d ON d.id = e.department_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN full_final_calculation ffc ON ffc.exit_request_id = er.id
              WHERE er.status = 'completed'
                AND ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) DESC`;
      break;
    }

    case "attrition-by-exit-reason": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const year = String(req.query.year ?? new Date().getFullYear());
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      // Drives off employees, not attrition_record. attrition_record exists with 0 rows, so
      // this report returned nothing at all — the same empty-table fault that made
      // monthly-attrition-summary report zero attrition. The exit date lives on the employee
      // row: 29,198 employees carry COALESCE(date_of_exit, resignation_date).
      //
      // Nearly every row will read 'Not Specified'. exit_request holds 2 rows against ~29k
      // exited employees, so the reason is genuinely unrecorded for almost everyone — that is
      // a fact about the data and the report should show it rather than hide the exits.
      clauses.push("YEAR(COALESCE(e.date_of_exit, e.resignation_date)) = ?"); params.push(year);
      sql = `SELECT COALESCE(er.exit_reason_category, 'Not Specified') AS exit_reason,
                    er.exit_type,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COUNT(*) AS exit_count,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    ROUND(AVG(TIMESTAMPDIFF(MONTH, e.date_of_joining,
                          COALESCE(e.date_of_exit, e.resignation_date))), 1) AS avg_tenure_months
               FROM employees e
               LEFT JOIN exit_request er ON er.employee_id = e.id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY er.exit_reason_category, er.exit_type, b.branch_name
              ORDER BY exit_count DESC`;
      break;
    }

    // ─── Missing Performance ──────────────────────────────────────────────────
    case "feedback-360-summary": {
      const cycle = String(req.query.cycle ?? "");
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (cycle) { clauses.push("pfr.cycle_id = ?"); params.push(cycle); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name, b.branch_name,
                    COUNT(pfr.id) AS total_feedback_responses,
                    ROUND(AVG(pfr.overall_score), 2) AS avg_overall_score,
                    ROUND(AVG(pfr.self_score), 2) AS avg_self_score,
                    ROUND(AVG(pfr.manager_score), 2) AS avg_manager_score,
                    ROUND(AVG(pfr.peer_score), 2) AS avg_peer_score,
                    MAX(pfr.submitted_at) AS last_feedback_at
               FROM performance_feedback_report pfr
               JOIN employees e ON e.id = pfr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, b.branch_name
              ORDER BY avg_overall_score DESC`;
      break;
    }

    case "goal-completion-summary": {
      const period = String(req.query.period ?? "");
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (period) { clauses.push("dp.plan_start_date <= ? AND dp.plan_end_date >= ?"); params.push(period, period); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name, b.branch_name,
                    dp.plan_start_date, dp.plan_end_date,
                    COUNT(dpg.goal_id) AS total_goals,
                    SUM(CASE WHEN dpg.status = 'completed' THEN 1 ELSE 0 END) AS completed_goals,
                    SUM(CASE WHEN dpg.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_goals,
                    ROUND(SUM(CASE WHEN dpg.status = 'completed' THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(dpg.goal_id),0) * 100, 1) AS completion_pct
               FROM development_plan dp
               JOIN employees e ON e.id = dp.employee_id
               LEFT JOIN development_plan_goal dpg ON dpg.plan_id = dp.plan_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name,
                       p.process_name, b.branch_name, dp.plan_start_date, dp.plan_end_date
              ORDER BY completion_pct DESC`;
      break;
    }

    case "training-needs-summary": {
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.priority) { clauses.push("tna.priority = ?"); params.push(String(req.query.priority)); }
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    tna.skill_gap, tna.training_topic, tna.priority,
                    tna.identified_by, tna.identified_at,
                    tna.status, tna.target_completion_date
               FROM training_need_assessment tna
               JOIN employees e ON e.id = tna.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.length ? clauses.join(" AND ") : "1=1"}
              ORDER BY FIELD(tna.priority,'high','medium','low'), e.employee_code`;
      break;
    }

    // ─── Missing WFM ──────────────────────────────────────────────────────────
    case "coverage-gap-actions": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      if (req.query.processId) { clauses.push("cga.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.status) { clauses.push("cga.status = ?"); params.push(String(req.query.status)); }
      clauses.push("cga.gap_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT cga.gap_date, p.process_name, b.branch_name,
                    cga.required_hc, cga.available_hc,
                    cga.required_hc - cga.available_hc AS gap_count,
                    cga.action_type, cga.action_details,
                    cga.status, cga.resolved_by, cga.resolved_at
               FROM wfm_coverage_gap_action cga
               LEFT JOIN process_master p ON p.id = cga.process_id
               LEFT JOIN branch_master b ON b.id = cga.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY cga.gap_date DESC, gap_count DESC`;
      break;
    }

    case "roster-cycle-status": {
      const month = monthParam(req.query.month);
      if (req.query.branchId) { clauses.push("wrp.branch_id = ?"); params.push(String(req.query.branchId)); }
      if (req.query.processId) { clauses.push("wrp.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(wrp.from_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT wrp.plan_name, p.process_name, b.branch_name,
                    wrp.from_date, wrp.to_date,
                    wrp.plan_status,
                    wrp.required_headcount, wrp.assigned_headcount,
                    ROUND(wrp.assigned_headcount / NULLIF(wrp.required_headcount,0) * 100, 1) AS fill_rate_pct,
                    wrp.published_at, wrp.published_by,
                    wrp.ack_required, wrp.ack_completed_count
               FROM wfm_roster_plan wrp
               LEFT JOIN process_master p ON p.id = wrp.process_id
               LEFT JOIN branch_master b ON b.id = wrp.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY wrp.from_date DESC, p.process_name`;
      break;
    }

    // ─── Missing Integration & Audit ─────────────────────────────────────────
    case "integration-run-history": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      const integrationKey = String(req.query.integrationKey ?? "");
      const status = String(req.query.status ?? "");
      if (integrationKey) { clauses.push("icr.connector_key = ?"); params.push(integrationKey); }
      if (status) { clauses.push("icr.run_status = ?"); params.push(status); }
      clauses.push("icr.started_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT icr.connector_key, icr.run_type, icr.run_status,
                    icr.started_at, icr.completed_at,
                    TIMESTAMPDIFF(SECOND, icr.started_at, icr.completed_at) AS duration_sec,
                    icr.records_fetched, icr.records_inserted, icr.records_updated, icr.records_errored,
                    icr.error_message, icr.triggered_by
               FROM integration_connector_run icr
              WHERE ${clauses.join(" AND ")}
              ORDER BY icr.started_at DESC`;
      break;
    }

    case "tat-escalation-breach": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      const taskType = String(req.query.taskType ?? "");
      if (taskType) { clauses.push("wi.workflow_type = ?"); params.push(taskType); }
      if (req.query.branchId) { clauses.push("wi.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("wi.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      clauses.push("wi.escalated = 1");
      sql = `SELECT wi.workflow_type, wi.reference_id, wi.reference_type,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    wi.created_at AS opened_at, wi.due_at, wi.escalated_at,
                    DATEDIFF(wi.escalated_at, wi.due_at) AS overdue_days,
                    wi.status, wi.assigned_to, wi.escalated_to
               FROM workflow_instance wi
               LEFT JOIN employees e ON e.id = wi.employee_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY overdue_days DESC`;
      break;
    }

    case "sensitive-action-audit": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      const module = String(req.query.module ?? "");
      const actionType = String(req.query.actionType ?? "");
      if (module) { clauses.push("sal.module_key = ?"); params.push(module); }
      if (actionType) { clauses.push("sal.action_type = ?"); params.push(actionType); }
      clauses.push("sal.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT sal.module_key, sal.action_type, sal.reference_id, sal.reference_type,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS actor_name,
                    e.employee_code AS actor_code,
                    sal.ip_address, sal.user_agent,
                    sal.before_value, sal.after_value,
                    sal.reason, sal.created_at AS action_at
               FROM sensitive_action_log sal
               LEFT JOIN employees e ON e.id = sal.actor_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY sal.created_at DESC`;
      break;
    }

    case "communication-dispatch-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      const channel = String(req.query.channel ?? "");
      const status = String(req.query.status ?? "");
      if (channel) { clauses.push("ndl.channel = ?"); params.push(channel); }
      if (status) { clauses.push("ndl.status = ?"); params.push(status); }
      clauses.push("ndl.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT ndl.channel, ndl.template_code, ndl.recipient_type,
                    ndl.recipient_identifier, ndl.status,
                    ndl.sent_at, ndl.delivered_at, ndl.failed_reason,
                    ndl.reference_type, ndl.reference_id,
                    ndl.created_at AS queued_at
               FROM notification_dispatch_log ndl
              WHERE ${clauses.join(" AND ")}
              ORDER BY ndl.created_at DESC`;
      break;
    }

    // ─── Missing Helpdesk & Grievance ─────────────────────────────────────────
    case "helpdesk-ticket-summary": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.ticketCategory) { clauses.push("ht.category = ?"); params.push(String(req.query.ticketCategory)); }
      if (req.query.status) { clauses.push("ht.status = ?"); params.push(String(req.query.status)); }
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("ht.created_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT ht.ticket_number, ht.category, ht.subject,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    ht.priority, ht.status,
                    ht.created_at, ht.resolved_at,
                    DATEDIFF(COALESCE(ht.resolved_at, NOW()), ht.created_at) AS tat_days,
                    ht.assigned_to
               FROM helpdesk_ticket ht
               LEFT JOIN employees e ON e.id = ht.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ht.created_at DESC`;
      break;
    }

    case "grievance-register": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.status) { clauses.push("gc.status = ?"); params.push(String(req.query.status)); }
      clauses.push("gc.filed_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT gc.grievance_number, gc.category, gc.sub_category,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    gc.filed_at, gc.status,
                    gc.assigned_to, gc.resolved_at,
                    DATEDIFF(COALESCE(gc.resolved_at, CURDATE()), gc.filed_at) AS days_open,
                    gc.resolution_summary
               FROM grievance_case gc
               LEFT JOIN employees e ON e.id = gc.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY gc.filed_at DESC`;
      break;
    }

    case "grievance-tat-report": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      if (req.query.status) { clauses.push("gc.status = ?"); params.push(String(req.query.status)); }
      clauses.push("gc.filed_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT gc.category,
                    COUNT(*) AS total_cases,
                    SUM(CASE WHEN gc.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
                    SUM(CASE WHEN gc.resolved_at IS NULL THEN 1 ELSE 0 END) AS pending,
                    ROUND(AVG(DATEDIFF(gc.resolved_at, gc.filed_at)), 1) AS avg_resolution_days,
                    MAX(DATEDIFF(COALESCE(gc.resolved_at, CURDATE()), gc.filed_at)) AS max_days_open,
                    SUM(CASE WHEN DATEDIFF(COALESCE(gc.resolved_at, CURDATE()), gc.filed_at) > 7 THEN 1 ELSE 0 END) AS breached_sla
               FROM grievance_case gc
              WHERE ${clauses.join(" AND ")}
              GROUP BY gc.category
              ORDER BY avg_resolution_days DESC`;
      break;
    }

    case "grievance-category-analysis": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      clauses.push("gc.filed_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT gc.category, gc.sub_category,
                    COUNT(*) AS total_cases,
                    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct_of_total,
                    SUM(CASE WHEN gc.status = 'closed' THEN 1 ELSE 0 END) AS closed_cases,
                    ROUND(AVG(DATEDIFF(gc.resolved_at, gc.filed_at)), 1) AS avg_resolution_days
               FROM grievance_case gc
              WHERE ${clauses.join(" AND ")}
              GROUP BY gc.category, gc.sub_category
              ORDER BY total_cases DESC`;
      break;
    }

    case "dpdp-consent-status": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("e.active_status = 1");
      sql = `SELECT e.employee_code,
                    COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
                    ecr.consent_type, ecr.status AS consent_status,
                    ecr.consented_at, ecr.expires_at,
                    ecr.revoked_at,
                    CASE WHEN ecr.id IS NULL THEN 'Not Collected'
                         WHEN ecr.revoked_at IS NOT NULL THEN 'Revoked'
                         WHEN ecr.status = 'active' THEN 'Active'
                         ELSE ecr.status END AS consent_state
               FROM employees e
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN employee_consent_record ecr ON ecr.employee_id = e.id
              WHERE ${clauses.join(" AND ")}
              ORDER BY consent_state, e.employee_code`;
      break;
    }

    // ─── Missing Client Portal ────────────────────────────────────────────────
    case "portal-kpi-commitment-vs-actual": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("pkc.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("pkc.kpi_month = ?"); params.push(month);
      sql = `SELECT p.process_name, pkc.kpi_name, pkc.kpi_unit,
                    pkc.committed_value, pkc.actual_value,
                    ROUND(pkc.actual_value / NULLIF(pkc.committed_value,0) * 100, 1) AS achievement_pct,
                    CASE WHEN pkc.actual_value >= pkc.committed_value THEN 'Met'
                         WHEN pkc.actual_value >= pkc.committed_value * 0.9 THEN 'Near Miss'
                         ELSE 'Missed' END AS status,
                    pkc.kpi_month
               FROM portal_kpi_commitment pkc
               LEFT JOIN process_master p ON p.id = pkc.process_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY status, p.process_name, pkc.kpi_name`;
      break;
    }

    case "action-plan-status": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("ap.process_id = ?"); params.push(String(req.query.processId)); }
      if (req.query.status) { clauses.push("ap.status = ?"); params.push(String(req.query.status)); }
      clauses.push("DATE_FORMAT(ap.created_at,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT ap.action_plan_number, ap.title, ap.action_type,
                    p.process_name, b.branch_name,
                    ap.owner, ap.status, ap.priority,
                    ap.due_date, ap.completed_at,
                    DATEDIFF(ap.due_date, CURDATE()) AS days_to_due,
                    ap.created_at, ap.root_cause
               FROM action_plan ap
               LEFT JOIN process_master p ON p.id = ap.process_id
               LEFT JOIN branch_master b ON b.id = ap.branch_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY ap.due_date ASC, ap.priority DESC`;
      break;
    }

    case "governance-checklist-completion": {
      const month = monthParam(req.query.month);
      if (req.query.processId) { clauses.push("gci.process_id = ?"); params.push(String(req.query.processId)); }
      clauses.push("DATE_FORMAT(gci.checklist_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT p.process_name, b.branch_name,
                    gci.checklist_type, gci.checklist_date,
                    COUNT(gci.id) AS total_items,
                    SUM(CASE WHEN gci.status = 'completed' THEN 1 ELSE 0 END) AS completed_items,
                    ROUND(SUM(CASE WHEN gci.status='completed' THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(gci.id),0) * 100, 1) AS completion_pct,
                    MAX(gci.updated_at) AS last_updated
               FROM governance_checklist_item gci
               LEFT JOIN process_master p ON p.id = gci.process_id
               LEFT JOIN branch_master b ON b.id = gci.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name, gci.checklist_type, gci.checklist_date
              ORDER BY completion_pct ASC, gci.checklist_date DESC`;
      break;
    }

    case "portal-access-log": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      const clientId = String(req.query.clientId ?? "");
      if (clientId) { clauses.push("pal.client_id = ?"); params.push(clientId); }
      clauses.push("pal.accessed_at BETWEEN ? AND ?"); params.push(from, endOfDayParam(to));
      sql = `SELECT pal.client_id, cm.client_name,
                    pal.user_identifier, pal.action,
                    pal.page_accessed, pal.ip_address,
                    pal.accessed_at,
                    pal.data_export_flag
               FROM portal_access_log pal
               LEFT JOIN client_master cm ON cm.id = pal.client_id
              WHERE ${clauses.join(" AND ")}
              ORDER BY pal.accessed_at DESC`;
      break;
    }

    // ─── Missing Productivity ─────────────────────────────────────────────────
    case "productivity-daily-heatmap": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date,
                    e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    p.process_name, b.branch_name,
                    adr.attendance_status,
                    ROUND(adr.dialler_minutes / 60, 2) AS login_hours,
                    ROUND(adr.biometric_minutes / 60, 2) AS biometric_hours,
                    COALESCE(kda.actual_value, 0) AS kpi_daily_score,
                    adr.late_mark,
                    CASE
                      WHEN adr.dialler_minutes >= 480 AND adr.late_mark = 0 THEN 'HIGH'
                      WHEN adr.dialler_minutes >= 360 THEN 'MEDIUM'
                      WHEN adr.dialler_minutes > 0 THEN 'LOW'
                      ELSE 'ABSENT'
                    END AS productivity_band
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_daily_actual kda ON kda.employee_id = adr.employee_id
                 AND kda.record_date = adr.record_date AND kda.source = 'apr'
              WHERE ${clauses.join(" AND ")}
              ORDER BY adr.record_date, p.process_name, employee_name`;
      break;
    }

    case "productivity-process-summary": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT p.process_name, b.branch_name,
                    COUNT(DISTINCT e.id) AS active_agents,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT e.id),0), 2) AS avg_login_hours_per_agent,
                    ROUND(AVG(kda.actual_value), 2) AS avg_kpi_score,
                    SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS present_days,
                    ROUND(SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_daily_actual kda ON kda.employee_id = adr.employee_id
                 AND kda.record_date = adr.record_date AND kda.source = 'apr'
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name
              ORDER BY avg_login_hours_per_agent DESC`;
      break;
    }

    case "productivity-aht-trend": {
      const from = dateParam(req.query.from, `${new Date().getFullYear()}-01-01`);
      const to = dateParam(req.query.to, new Date().toISOString().slice(0, 10));
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m') AS month, p.process_name,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / NULLIF(COUNT(CASE WHEN adr.dialler_minutes > 0 THEN 1 END), 0), 1) AS avg_daily_login_minutes,
                    COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END) AS present_days
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m'), p.process_name
              ORDER BY month DESC, process_name`;
      break;
    }

    case "productivity-branch-summary": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT b.branch_name,
                    COUNT(DISTINCT e.id) AS active_agents,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT e.id),0), 2) AS avg_login_hours_per_agent,
                    ROUND(AVG(kda.actual_value), 2) AS avg_kpi_score,
                    ROUND(SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_daily_actual kda ON kda.employee_id = adr.employee_id
                 AND kda.record_date = adr.record_date AND kda.source = 'apr'
              WHERE ${clauses.join(" AND ")}
              GROUP BY b.branch_name
              ORDER BY avg_login_hours_per_agent DESC`;
      break;
    }

    case "productivity-cost-centre-summary": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT cc.cost_centre_name, b.branch_name,
                    COUNT(DISTINCT e.id) AS active_agents,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT e.id),0), 2) AS avg_login_hours_per_agent,
                    ROUND(AVG(kda.actual_value), 2) AS avg_kpi_score
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
               LEFT JOIN kpi_daily_actual kda ON kda.employee_id = adr.employee_id
                 AND kda.record_date = adr.record_date AND kda.source = 'apr'
              WHERE ${clauses.join(" AND ")}
              GROUP BY cc.cost_centre_name, b.branch_name
              ORDER BY avg_login_hours_per_agent DESC`;
      break;
    }

    case "productivity-org-summary": {
      // Row scope was absent: this block read employee data with no branch/process
      // restriction, so a scoped user received every branch's rows. Scope is enforced in
      // the query and nowhere else. For an all-scope user this adds no predicate, which is
      // why super_admin output is unchanged.
      addScopedEmployeeFilters(req, clauses, params);
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      if (req.query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT DATE_FORMAT(adr.record_date,'%Y-%m-%d') AS report_date,
                    COUNT(DISTINCT e.id) AS active_agents,
                    SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS present_count,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS total_login_hours,
                    ROUND(SUM(adr.dialler_minutes) / 60 / NULLIF(COUNT(DISTINCT CASE WHEN adr.dialler_minutes > 0 THEN e.id END),0), 2) AS avg_login_hours_per_agent,
                    ROUND(AVG(kda.actual_value), 2) AS avg_kpi_score,
                    ROUND(SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN kpi_daily_actual kda ON kda.employee_id = adr.employee_id
                 AND kda.record_date = adr.record_date AND kda.source = 'apr'
              WHERE ${clauses.join(" AND ")}
              GROUP BY DATE_FORMAT(adr.record_date,'%Y-%m-%d')
              ORDER BY report_date DESC`;
      break;
    }

    case "productivity-occupancy-utilization": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT p.process_name, b.branch_name,
                    adr.record_date,
                    COUNT(DISTINCT e.id) AS scheduled_hc,
                    SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS present_hc,
                    ROUND(SUM(adr.dialler_minutes) / NULLIF(
                      SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 480 ELSE 0 END), 0) * 100, 1) AS occupancy_pct,
                    ROUND(SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS utilization_pct
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY p.process_name, b.branch_name, adr.record_date
              ORDER BY adr.record_date DESC, occupancy_pct ASC`;
      break;
    }

    case "productivity-adherence-vs-kpi": {
      const month = monthParam(req.query.month);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("DATE_FORMAT(adr.record_date,'%Y-%m') = ?"); params.push(month);
      sql = `SELECT e.employee_code, COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
                    COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
                    ROUND(COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                          / NULLIF(COUNT(*),0) * 100, 1) AS attendance_pct,
                    kss.final_score AS kpi_score, kss.rating,
                    CASE WHEN COUNT(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 END)
                              / NULLIF(COUNT(*),0) < 0.85 AND kss.final_score < 70
                         THEN 'HIGH_RISK' ELSE 'OK' END AS correlation_flag
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN kpi_score_summary kss ON kss.employee_id = e.id
               LEFT JOIN kpi_score_period ksp ON ksp.id = kss.period_id
                 AND ksp.period_start <= LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d'))
                 AND ksp.period_end >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')
              WHERE ${clauses.join(" AND ")}
              GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, p.process_name, kss.final_score, kss.rating
              ORDER BY attendance_pct ASC`;
      // These values belong to placeholders that sit BEFORE the WHERE, so they must LEAD the
      // bind array — unshift, not push. Appending them shifted every parameter by one.
      // It looked fine for super_admin, whose array happened to hold the same value twice;
      // a branch-scoped user's extra predicate exposed it, and the branch id landed on the
      // month placeholder. Measured on leave-lwp-reconciliation: a scoped user got 0 rows,
      // against 200 once corrected.
      params.unshift(month, month);
      break;
    }

    case "productivity-shrinkage-impact": {
      const from = dateParam(req.query.from, new Date().toISOString().slice(0, 10));
      const to = dateParam(req.query.to, from);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("adr.record_date BETWEEN ? AND ?"); params.push(from, to);
      sql = `SELECT adr.record_date, p.process_name, b.branch_name,
                    COUNT(DISTINCT e.id) AS total_scheduled,
                    SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS present_count,
                    COUNT(DISTINCT e.id) - SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END) AS shrinkage_count,
                    ROUND((COUNT(DISTINCT e.id) - SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 1 ELSE 0 END))
                          / NULLIF(COUNT(DISTINCT e.id),0) * 100, 1) AS shrinkage_pct,
                    ROUND(SUM(adr.dialler_minutes) / 60, 2) AS actual_login_hours,
                    ROUND(SUM(CASE WHEN adr.attendance_status IN ('present','half_day','week_off_worked') THEN 480 ELSE 0 END) / 60, 2) AS expected_login_hours
               FROM attendance_daily_record adr
               JOIN employees e ON e.id = adr.employee_id
               LEFT JOIN process_master p ON p.id = e.process_id
               LEFT JOIN branch_master b ON b.id = e.branch_id
              WHERE ${clauses.join(" AND ")}
              GROUP BY adr.record_date, p.process_name, b.branch_name
              ORDER BY adr.record_date DESC, shrinkage_pct DESC`;
      break;
    }

    case "identity-mapping-exceptions": {
      const report = buildIdentityMappingExceptionsSql(req.query);
      sql = report.sql;
      params.push(...report.params);
      break;
    }

    case "identity-source-snapshot": {
      const report = buildIdentitySourceSnapshotReportSql(req.query);
      sql = report.sql;
      params.push(...report.params);
      break;
    }

    case "it-ad-account-audit": {
      // AD Account Provisioning Compliance Report
      // Shows every IT_EMAIL_DOMAIN_ASSET task with parsed AD log fields for audit.
      const dateFrom = req.query.date_from ? String(req.query.date_from) : null;
      const dateTo   = req.query.date_to   ? String(req.query.date_to)   : null;
      const branch   = req.query.branch    ? String(req.query.branch)    : null;
      const reqType  = req.query.request_type ? String(req.query.request_type) : null;
      const evStatus = req.query.evidence_status ? String(req.query.evidence_status) : null;

      sql = `
        SELECT
          e.employee_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
          DATE_FORMAT(e.date_of_joining,  '%Y-%m-%d') AS date_of_joining,
          DATE_FORMAT(e.date_of_leaving,  '%Y-%m-%d') AS date_of_leaving,
          COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
          COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
          ipr.request_type,
          ipr.status,
          ipr.locked,
          ipr.domain_account,
          ipr.official_email,
          COALESCE(ipr.ad_log_type, 'missing')         AS ad_log_type,
          ipr.ad_account_name,
          ipr.ad_event_id,
          ipr.ad_actioned_by_it,
          DATE_FORMAT(ipr.ad_event_time, '%Y-%m-%d %H:%i:%s') AS ad_event_time,
          ipr.evidence_file_url,
          DATE_FORMAT(ipr.requested_at, '%Y-%m-%d %H:%i:%s') AS requested_at,
          DATE_FORMAT(ipr.actioned_at,  '%Y-%m-%d %H:%i:%s') AS actioned_at,
          DATE_FORMAT(ipr.sla_due_at,   '%Y-%m-%d %H:%i:%s') AS sla_due_at,
          CASE
            WHEN ipr.sla_due_at IS NOT NULL
             AND ipr.actioned_at IS NOT NULL
             AND ipr.actioned_at > ipr.sla_due_at
            THEN 'SLA Breach'
            WHEN ipr.sla_due_at IS NOT NULL
             AND ipr.actioned_at IS NULL
             AND ipr.sla_due_at < NOW()
             AND ipr.status NOT IN ('waived','confirmed')
            THEN 'Overdue'
            ELSE 'On Time'
          END AS sla_status,
          CASE WHEN ipr.evidence_file_url IS NOT NULL THEN 'Evidence Attached'
               ELSE 'No Evidence' END AS evidence_status
        FROM it_provisioning_request ipr
        JOIN employees e ON e.id = ipr.employee_id
        LEFT JOIN branch_master b ON b.id = e.branch_id
        LEFT JOIN process_master p ON p.id = e.process_id
        WHERE ipr.task_code = 'IT_EMAIL_DOMAIN_ASSET'
          ${dateFrom ? 'AND ipr.requested_at >= ?' : ''}
          ${dateTo   ? 'AND ipr.requested_at <= ?' : ''}
          ${branch   ? 'AND b.branch_name = ?' : ''}
          ${reqType  ? 'AND ipr.request_type = ?' : ''}
          ${evStatus === 'with_evidence'    ? 'AND ipr.evidence_file_url IS NOT NULL' : ''}
          ${evStatus === 'without_evidence' ? 'AND ipr.evidence_file_url IS NULL' : ''}
        ORDER BY ipr.requested_at DESC
      `;
      if (dateFrom) params.push(dateFrom);
      if (dateTo)   params.push(dateTo);
      if (branch)   params.push(branch);
      if (reqType)  params.push(reqType);
      break;
    }

    // ─── Attendance Register Monthly (Day-wise Pivot Grid) ────────────────────
    // "attendance-register-monthly" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries both the SQL and the JavaScript
    // pivot into day_1..day_31. This block never set sql and returned its own response, so
    // there was nothing for the export handler to call and the download answered 404.
    //
    // The move drops two report-specific meta fields, daysInMonth and month, which the shared
    // envelope has no channel for. No frontend component reads either — the calendars compute
    // daysInMonth locally from the selected month.

    // ─── Leave Balance Export (Wide Pivot Format) ─────────────────────────────
    case "leave-balance-export": {
      const month = monthParam(req.query.month);
      const balYear = month.slice(0, 4);
      addScopedEmployeeFilters(req, clauses, params);
      clauses.push("e.active_status = 1");

      sql = `
        SELECT
          e.employee_code AS emp_code,
          CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
          COALESCE(b.branch_name, '') AS branch_name,
          COALESCE(cc.cost_centre_name, e.cost_center_code, '') AS cost_center,
          COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('CL','CAS') THEN lbl.allocated_days END), 0) AS cl_current,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('ML','SL','MED') THEN lbl.allocated_days END), 0) AS ml_current,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('EL','PL_E') THEN lbl.allocated_days END), 0) AS el_current,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('PL','PTL','MTL','ML_M') THEN lbl.allocated_days END), 0) AS ptl_current,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('CL','CAS') THEN lbl.used_days END), 0) AS cl_taken,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('ML','SL','MED') THEN lbl.used_days END), 0) AS ml_taken,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('EL','PL_E') THEN lbl.used_days END), 0) AS el_taken,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('PL','PTL','MTL','ML_M') THEN lbl.used_days END), 0) AS ptl_taken,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('CL','CAS') THEN (lbl.allocated_days - lbl.used_days) END), 0) AS cl_remain,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('ML','SL','MED') THEN (lbl.allocated_days - lbl.used_days) END), 0) AS ml_remain,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('EL','PL_E') THEN (lbl.allocated_days - lbl.used_days) END), 0) AS el_remain,
          COALESCE(SUM(CASE WHEN lt.leave_code IN ('PL','PTL','MTL','ML_M') THEN (lbl.allocated_days - lbl.used_days) END), 0) AS ptl_remain
        FROM employees e
        LEFT JOIN branch_master b ON b.id = e.branch_id
        LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        LEFT JOIN process_master p ON p.id = e.process_id
        LEFT JOIN leave_balance_ledger lbl ON lbl.employee_id = e.id AND lbl.balance_year = ?
        LEFT JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
        WHERE ${clauses.join(" AND ")}
        GROUP BY e.id, e.employee_code, e.first_name, e.last_name, b.branch_name, cc.cost_centre_name, e.cost_center_code, p.process_name
        ORDER BY e.employee_code
      `;
      params.unshift(balYear);
      break;
    }

    // ─── Left Employee Export ──────────────────────────────────────────────────
    // "left-employee-export" is intentionally not handled here.
    //
    // It falls through to executeReport(), which now carries this exact SQL. With no executor
    // registered the download answered 404 on a report named export, because the export
    // handler calls executeReport() directly and never reaches this switch.
    //
    // The parenthesised OR moved with it and must stay parenthesised: unwrapped, that clause
    // re-associated the whole WHERE and produced 57,501 rows for super_admin against 1,574
    // correct, and a full row-scope bypass for anyone scoped to a branch.

    // ─── New Join Employee Export ──────────────────────────────────────────────
    // "new-join-export" is intentionally not handled here.
    //
    // It now falls through to the default branch and executeReport(), so the screen and the
    // downloaded XLSX run the SAME SQL. While this block existed the two paths differed by
    // construction: the preview handler reaches this switch first, and the export handler
    // calls executeReport() directly and never sees it. With no executor registered, the
    // download simply 404'd "This report is not yet available" — on a report named export.
    //
    // Verified before removal: executor and inline block both return 1,647 rows with
    // identical columns and an identical first row for super_admin.

    // ─── Salary Sheet Export (90-column full payroll) ─────────────────────────
    // "salary-sheet-export" now falls through to the default branch, which calls
    // executeReport(). It was the last inline block, and the only one that ran two
    // queries and assembled its payload in JS; that logic moved intact to
    // salarySheetExport in executors/payroll.executor.ts. It now honours limit and
    // offset like every other report instead of always returning the whole run.

    default: {
      // Attempt executor layer for codes not yet in the switch above.
      const userId = (req as any).authUser?.id as string;
      const execScope = await resolveFullScope(userId);
      const execFilters: ExecFilters = {
        branchId:     req.query.branchId     as string | undefined,
        processId:    req.query.processId    as string | undefined,
        departmentId: req.query.departmentId as string | undefined,
        costCentreId: req.query.costCentreId as string | undefined,
        managerId:    req.query.managerId    as string | undefined,
        employeeCode: req.query.employeeCode as string | undefined,
        from:         req.query.from         as string | undefined,
        to:           req.query.to           as string | undefined,
        month:        req.query.month        as string | undefined,
        year:         req.query.year         as string | undefined,
        status:       req.query.status       as string | undefined,
        includeInactive: req.query.includeInactive === 'true',
        financialYear: req.query.financialYear as string | undefined,
        metric:       req.query.metric       as string | undefined,
        aonBucket:    req.query.aonBucket    as string | undefined,
        cohortMonth:  req.query.cohortMonth  as string | undefined,
      };
      const execOffset = Number(req.query.offset ?? 0);
      const execLimit  = limit > 0 ? limit : 100;
      const execOptions: ExecOptions = {
        limit: execLimit,
        offset: execOffset,
        cursor: null,
        includeTotal: true,
        mode: 'preview',
      };
      try {
        const result = await executeReport(code, execFilters, execScope, execOptions);
        const execData = stripCursorField(result.rows);
        return res.json({
          success: true,
          code,
          data: execData,
          totalCount: result.rowCount,
          meta: {
            count: execData.length,
            totalCount: result.rowCount,
            limit: execLimit,
            offset: execOffset,
            page: Math.floor(execOffset / execLimit) + 1,
            totalPages: Math.ceil(result.rowCount / execLimit),
            isFullExport: isExport,
            fallback: false,
          },
        });
      } catch (err) {
        if (err instanceof ReportExecutorNotFoundError) {
          // Genuine gap — return the placeholder so the frontend shows a "not yet available" state
          const fallback = fallbackReport(code);
          sql = fallback.sql;
          params.push(...fallback.params);
          break;
        }
        throw err;
      }
    }
  }

  const offset = Number(req.query.offset ?? 0);
  // Split rather than `let { rows: data, totalCount }`: totalCount is never reassigned, and
  // prefer-const defaults to destructuring:"any", so it reports the whole declaration even
  // though `data` genuinely is reassigned below when account numbers are masked.
  const { rows: initialRows, totalCount } = await queryRowsWithCount(sql, params, limit, offset);
  let data = initialRows;

  // Post-query account number resolution for the bank-change-requests report.
  // account_number_enc / account_number_legacy are selected raw; surface a single
  // resolved string before the rows leave this handler.
  if (code === "bank-change-requests") {
    data = (data as any[]).map((r: any) => {
      const resolved = resolveAccountNumber({ account_number_enc: r.account_number_enc, account_number: r.account_number_legacy });
      const { account_number_enc: _e, account_number_legacy: _l, ...rest } = r;
      return { ...rest, account_number: resolved ? `****${resolved.slice(-4)}` : null };
    });
  }

  return res.json({
    success: true,
    code,
    data,
    totalCount,
    meta: {
      count: data.length,
      totalCount,
      limit: limit || "unlimited",
      offset,
      page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
      totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 1,
      isFullExport: isExport,
      fallback: data[0]?.report_status === "PENDING_DATA_BUILDER"
    }
  });
}));
