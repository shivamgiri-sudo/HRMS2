/**
 * Extra READ-ONLY audit modes for the role dashboards.
 *
 * Every query here is a SELECT against information_schema or application tables.
 * No INSERT/UPDATE/DELETE/ALTER/DROP is issued, so this is safe to run against the
 * shared production database.
 */
import type { RowDataPacket } from "mysql2";
import { resolve } from "node:path";
import { db } from "../src/db/mysql.js";
import { getUserRoleContext } from "../src/shared/roleResolver.js";
import {
  resolveDashboardScope,
  DashboardScopeConfigurationError,
  type DashboardScope,
} from "../src/shared/dashboardScope.js";
import { DASHBOARD_SQL_MANIFEST } from "../src/shared/dashboardSqlManifest.js";
import { buildSqlSchemaSnapshot, columnSource } from "../src/shared/sqlSchemaSnapshot.js";
import { DASHBOARD_ACCESS_REGISTRY } from "../src/shared/dashboardAccessRegistry.js";
import {
  getDashboardMetricKeys,
  executeDashboardMetrics,
} from "../src/modules/dashboards/dashboard-definition.service.js";
import {
  validateAttendance,
  validateBgv,
  validateEmptySourceMetric,
  validateHeadcount,
  validateOnboarding,
  validatePayrollReadiness,
  validateResignation,
  summarise,
  rowCount,
  latestAttendanceDate,
  type DatapointCheck,
} from "./dashboard-validation.js";

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

// ── --schema : manifest vs LIVE information_schema ──────────────────────────

export async function runSchemaMode(): Promise<number> {
  console.log("\n══ SCHEMA CONTRACT (manifest vs live information_schema) ══");
  const snapshot = buildSqlSchemaSnapshot(resolve(import.meta.dirname, "../sql"));

  const live = new Map<string, Set<string>>();
  const rows = await q(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  for (const r of rows) {
    const t = String((r as any).TABLE_NAME).toLowerCase();
    if (!live.has(t)) live.set(t, new Set());
    live.get(t)!.add(String((r as any).COLUMN_NAME).toLowerCase());
  }

  const problems: Array<Record<string, string>> = [];
  for (const dep of DASHBOARD_SQL_MANIFEST) {
    const table = dep.table.toLowerCase();
    const liveCols = live.get(table);
    if (!liveCols) {
      problems.push({
        table: dep.table, column: "*",
        issue: dep.optional ? "table absent (declared optional)" : "TABLE MISSING IN PRODUCTION",
        usedBy: dep.usedBy,
      });
      continue;
    }
    for (const col of dep.columns) {
      const inLive = liveCols.has(col.toLowerCase());
      const inMigrations = Boolean(columnSource(snapshot, dep.table, col));
      if (!inLive) {
        problems.push({ table: dep.table, column: col, issue: "MISSING IN PRODUCTION", usedBy: dep.usedBy });
      } else if (!inMigrations) {
        problems.push({
          table: dep.table, column: col,
          issue: "present in production but in NO migration (schema drift)",
          usedBy: dep.usedBy,
        });
      } else {
        const origin = columnSource(snapshot, dep.table, col)!;
        if (!snapshot.sourcedFiles.has(origin)) {
          problems.push({
            table: dep.table, column: col,
            issue: `applied, but ${origin} is not sourced by 000_run_all.sql`,
            usedBy: dep.usedBy,
          });
        }
      }
    }
  }

  if (problems.length === 0) console.log("  All manifest columns present in production and in a sourced migration.");
  else console.table(problems);

  const blocking = problems.filter((p) => p.issue.startsWith("MISSING") || p.issue.startsWith("TABLE MISSING"));
  console.log(`  ${blocking.length} blocking, ${problems.length - blocking.length} advisory.`);
  return blocking.length;
}

// ── --data-availability : is a blank tile empty-by-data or broken-by-code? ───

const DATA_SOURCES: Array<{ table: string; dateColumn?: string; feeds: string }> = [
  { table: "employees", feeds: "HEADCOUNT, PAYROLL_READINESS" },
  { table: "attendance_daily_record", dateColumn: "record_date", feeds: "ATTENDANCE" },
  { table: "wfm_attendance_session", dateColumn: "session_date", feeds: "ATTENDANCE (live)" },
  { table: "wfm_slot_requirement", dateColumn: "requirement_date", feeds: "HEADCOUNT (required)" },
  { table: "ats_onboarding_bridge", feeds: "ONBOARDING" },
  { table: "candidate_bgv_check", feeds: "BGV" },
  { table: "candidate_name_match_summary", feeds: "NAME_MISMATCH" },
  { table: "dpdp_consent_withdrawal", feeds: "DPDP" },
  { table: "exit_request", feeds: "RESIGNATION" },
  { table: "appointment_letter_request", feeds: "APPOINTMENT_ESIGN" },
  { table: "employee_joining_document_checklist", feeds: "JOINING_DOC_ESIGN" },
  { table: "incentive_upload_batch", feeds: "INCENTIVE" },
  { table: "task_tat_instance", feeds: "TAT" },
  { table: "work_item", feeds: "Work Inbox (all 12 dashboards)" },
  { table: "salary_prep_run", feeds: "Payroll dashboard" },
  { table: "salary_prep_line", feeds: "Payroll dashboard" },
  { table: "kpi_daily_actual", dateColumn: "score_date", feeds: "KPI org-summary" },
  { table: "kpi_score_summary", feeds: "KPI (unused — empty)" },
  { table: "it_provisioning_request", feeds: "IT dashboard" },
  { table: "helpdesk_ticket", feeds: "IT dashboard" },
  { table: "dashboard_metric_catalog", feeds: "metric targets & trends" },
  { table: "dashboard_metric_snapshot", feeds: "metric trends" },
];

export async function runDataAvailabilityMode(): Promise<void> {
  console.log("\n══ DATA AVAILABILITY (a blank tile is only a bug if the source has rows) ══");
  const out: Array<Record<string, unknown>> = [];
  for (const src of DATA_SOURCES) {
    const rows = await rowCount(src.table);
    let latest: string | null = null;
    if (rows !== null && rows > 0 && src.dateColumn) {
      try {
        const r = await q(`SELECT MAX(\`${src.dateColumn}\`) AS d FROM \`${src.table}\``);
        latest = (r[0] as any)?.d ? String((r[0] as any).d) : null;
      } catch { /* column may not exist */ }
    }
    out.push({
      table: src.table,
      rows: rows === null ? "TABLE MISSING" : rows,
      latest: latest ?? "—",
      verdict: rows === null ? "MISSING" : rows === 0 ? "EMPTY — widget must say so" : "ok",
      feeds: src.feeds,
    });
  }
  console.table(out);
}

// ── --scope-report : who cannot resolve a dashboard scope, and why ──────────

export async function runScopeReportMode(): Promise<void> {
  console.log("\n══ SCOPE RESOLUTION (a user with no resolvable scope gets a 409 + blank page) ══");
  const users = await q(
    `SELECT DISTINCT ur.user_id, au.email
       FROM user_roles ur
       JOIN auth_user au ON au.id = ur.user_id
      WHERE ur.active_status = 1 AND ur.role_key <> 'employee'`,
  );

  const results: Array<Record<string, unknown>> = [];
  let failures = 0;
  for (const u of users) {
    const userId = String((u as any).user_id);
    try {
      const ctx = await getUserRoleContext(userId);
      const scope = await resolveDashboardScope(userId, ctx.primaryRole);
      results.push({
        email: (u as any).email, role: ctx.primaryRole, level: scope.level,
        branches: scope.branchIds.length, processes: scope.processIds.length,
        employees: scope.employeeIds.length, status: "ok",
      });
    } catch (err) {
      failures++;
      const isScope = err instanceof DashboardScopeConfigurationError;
      results.push({
        email: (u as any).email, role: "—", level: "—",
        branches: 0, processes: 0, employees: 0,
        status: isScope ? "409 DASHBOARD_SCOPE_NOT_CONFIGURED" : `ERROR: ${(err as Error).message}`,
      });
    }
  }

  const byStatus = new Map<string, number>();
  for (const r of results) byStatus.set(String(r.status), (byStatus.get(String(r.status)) ?? 0) + 1);
  console.table([...byStatus].map(([status, count]) => ({ status, users: count })));
  const broken = results.filter((r) => String(r.status) !== "ok");
  if (broken.length) {
    console.log(`\n  ${broken.length} of ${users.length} privileged users cannot load a dashboard:`);
    console.table(broken.slice(0, 40));
  }
  console.log(`  ${failures} failure(s) across ${users.length} privileged users.`);
}

// ── --dashboards : every dashboard code x metric for one user ───────────────

export async function runDashboardsMode(employeeCode: string): Promise<void> {
  console.log(`\n══ DASHBOARD x METRIC MATRIX for ${employeeCode} ══`);
  const rows = await q(
    `SELECT id, user_id FROM employees WHERE UPPER(employee_code) = UPPER(?) AND user_id IS NOT NULL
      ORDER BY active_status DESC LIMIT 1`,
    [employeeCode],
  );
  const userId = (rows[0] as any)?.user_id;
  if (!userId) { console.error(`  ${employeeCode} has no linked auth user.`); return; }

  const ctx = await getUserRoleContext(String(userId));
  let scope: DashboardScope;
  try {
    scope = await resolveDashboardScope(String(userId), ctx.primaryRole);
  } catch (err) {
    console.error(`  scope resolution failed: ${(err as Error).message}`);
    return;
  }
  console.log(`  role=${ctx.primaryRole}  scope=${scope.level}`);

  const table: Array<Record<string, unknown>> = [];
  for (const code of Object.keys(DASHBOARD_ACCESS_REGISTRY)) {
    const keys = getDashboardMetricKeys(code as any);
    if (keys.length === 0) {
      table.push({ dashboard: code, metric: "(none configured)", value: "—", status: "EMPTY BUNDLE" });
      continue;
    }
    const metrics = await executeDashboardMetrics(code as any, scope);
    for (const [key, m] of Object.entries(metrics)) {
      table.push({
        dashboard: code, metric: key,
        value: m.value === null ? "null" : m.value,
        status: m.status,
        detail: JSON.stringify(m.detail).slice(0, 70),
      });
    }
  }
  console.table(table);
}

// ── --validate : per-widget, per-datapoint comparison against live SQL ──────

export async function runValidateMode(employeeCode: string): Promise<number> {
  console.log(`\n══ PER-DATAPOINT VALIDATION (service value vs independent query) — as ${employeeCode} ══`);
  const day = await latestAttendanceDate();
  console.log(`  attendance anchor day with real data: ${day ?? "none"}`);

  const rows = await q(
    `SELECT user_id FROM employees WHERE UPPER(employee_code) = UPPER(?) AND user_id IS NOT NULL
      ORDER BY active_status DESC LIMIT 1`,
    [employeeCode],
  );
  const userId = (rows[0] as any)?.user_id;
  if (!userId) { console.error(`  ${employeeCode} has no linked auth user.`); return 0; }

  const ctx = await getUserRoleContext(String(userId));
  const scope = await resolveDashboardScope(String(userId), ctx.primaryRole);

  const {
    getHeadcountMetrics, getOnboardingMetrics, getAttendanceMetrics,
    getPayrollReadinessMetrics, getTatMetrics, getNameMismatchMetrics,
    getDpdpWithdrawalMetrics, getIncentiveMetrics, getBgvMetrics,
    getResignationMetrics,
  } = await import("../src/modules/dashboards/dashboard-metric.service.js");

  const checks: DatapointCheck[] = [];
  checks.push(...await validateHeadcount(scope, await getHeadcountMetrics(scope)));
  checks.push(...await validateOnboarding(scope, await getOnboardingMetrics(scope)));
  checks.push(...await validateAttendance(scope, await getAttendanceMetrics(scope)));
  checks.push(...await validatePayrollReadiness(scope, await getPayrollReadinessMetrics(scope)));
  checks.push(...await validateBgv(scope, await getBgvMetrics(scope)));
  checks.push(...await validateResignation(scope, await getResignationMetrics(scope)));
  checks.push(...await validateEmptySourceMetric("TAT", await getTatMetrics(scope)));
  checks.push(...await validateEmptySourceMetric("NAME_MISMATCH", await getNameMismatchMetrics(scope)));
  checks.push(...await validateEmptySourceMetric("DPDP_WITHDRAWAL", await getDpdpWithdrawalMetrics(scope)));
  checks.push(...await validateEmptySourceMetric("INCENTIVE", await getIncentiveMetrics(scope)));

  console.table(checks.map((c) => ({
    metric: c.metric, datapoint: c.datapoint,
    service: c.serviceValue ?? "null", expected: c.expectedValue ?? "null",
    outcome: c.outcome, note: c.note ? c.note.slice(0, 60) : "",
  })));

  const summary = summarise(checks);
  console.log(`  ${JSON.stringify(summary)}`);
  return summary.MISMATCH + summary.QUERY_FAILED;
}

// ── --drilldown : which metric drilldowns actually return records ───────────

export async function runDrilldownMode(employeeCode: string): Promise<number> {
  console.log(`\n══ DRILLDOWN COVERAGE ══`);
  const rows = await q(
    `SELECT user_id FROM employees WHERE UPPER(employee_code) = UPPER(?) AND user_id IS NOT NULL
      ORDER BY active_status DESC LIMIT 1`,
    [employeeCode],
  );
  const userId = (rows[0] as any)?.user_id;
  if (!userId) { console.error(`  ${employeeCode} has no linked auth user.`); return 0; }
  const ctx = await getUserRoleContext(String(userId));
  const scope = await resolveDashboardScope(String(userId), ctx.primaryRole);

  const { getDrilldown } = await import("../src/modules/dashboards/dashboard-drilldown.service.js");
  const { getAllMetricCodes } = await import("../src/modules/dashboards/dashboard-definition.service.js");

  const out: Array<Record<string, unknown>> = [];
  let unimplemented = 0;
  for (const code of getAllMetricCodes()) {
    try {
      const result: any = await getDrilldown(code, scope);
      const note = String(result?.note ?? "");
      const isStub = /not yet implemented/i.test(note);
      if (isStub) unimplemented++;
      out.push({
        metricCode: code,
        records: Array.isArray(result?.records) ? result.records.length : "—",
        verdict: isStub ? "NOT IMPLEMENTED" : "ok",
        note: note.slice(0, 60),
      });
    } catch (err) {
      unimplemented++;
      out.push({ metricCode: code, records: "—", verdict: "THREW", note: (err as Error).message.slice(0, 60) });
    }
  }
  console.table(out);
  console.log(`  ${unimplemented} of ${out.length} metric drilldowns are unusable.`);
  return unimplemented;
}
