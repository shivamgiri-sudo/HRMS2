/**
 * Drill-down detail for the Compliance tab (Drill-Down Mandate): employee, rule and branch.
 * All incident data comes from the same cached computation as summary/violations/trend.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  RULE_IDS,
  RULE_META,
  evaluateRules,
  monthBounds,
  monthOf,
  previousMonth,
  summarizeMonth,
  type RuleId,
} from "./wfm-compliance.calc.js";
import {
  computeCompliance,
  loadRosterDays,
  loadTemplates,
  monthsEndingAt,
  type ScopeFilter,
} from "./wfm-compliance-console.service.js";

const none = <T>(v: T[]) => v;

export function isRuleId(v: unknown): v is RuleId {
  return typeof v === "string" && (RULE_IDS as string[]).includes(v);
}

export async function getEmployeeDetail(employeeId: string, month: string) {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.employment_type, e.employment_status, e.active_status,
            DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS doj, DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') AS doe,
            b.branch_name, p.process_name, d.designation_name, mgr.full_name AS manager_name, mgr.employee_code AS manager_code
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const e = empRows[0];
  if (!e) return null;

  const months = monthsEndingAt(month, 6);
  const [days, templates] = await Promise.all([
    loadRosterDays(
      monthBounds(months[0]).start,
      monthBounds(month).end,
      {},
      employeeId,
    ),
    loadTemplates(),
  ]);
  const incidents = evaluateRules(days, templates);
  const monthly = months.map((m) => {
    const s = summarizeMonth(incidents, days, m);
    return {
      month: m,
      violations: s.totalViolations,
      compliant: s.rostered > 0 && s.totalViolations === 0,
    };
  });

  const { start, end } = monthBounds(month);
  const [rosterRows, auditRows] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, ra.is_week_off AS wo, sm.shift_name,
              TIME_FORMAT(sm.start_time,'%H:%i') AS st, TIME_FORMAT(sm.end_time,'%H:%i') AS et,
              adr.attendance_status AS att, COALESCE(adr.late_mark,0) AS late
         FROM wfm_roster_assignment ra
         LEFT JOIN wfm_shift_template sm ON sm.id = ra.shift_template_id
         LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
        WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ?
        ORDER BY ra.roster_date`,
      [employeeId, start, end],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT rda.id, DATE_FORMAT(rda.roster_date,'%Y-%m-%d') AS d, rda.decision_type, rda.rule_applied,
              rda.override_reason, rda.override_at, rda.created_at, actor.full_name AS actor_name
         FROM roster_decision_audit rda
         LEFT JOIN employees actor ON actor.id = rda.override_by
        WHERE rda.employee_id = ? ORDER BY rda.created_at DESC LIMIT 15`,
      [employeeId],
    ),
  ]);

  const inMonth = incidents
    .filter((i) => monthOf(i.date) === month)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    period: month,
    employee: {
      id: String(e.id),
      code: e.employee_code,
      name: String(e.full_name ?? "").trim(),
      branchName: e.branch_name ?? null,
      processName: e.process_name ?? null,
      designation: e.designation_name ?? null,
      employmentType: e.employment_type ?? null,
      employmentStatus: e.employment_status ?? null,
      active: Number(e.active_status) === 1,
      dateOfJoining: e.doj ?? null,
      dateOfExit: e.doe ?? null,
      managerName: e.manager_name ?? null,
      managerCode: e.manager_code ?? null,
    },
    incidents: inMonth.map((i) => ({
      id: i.id,
      ruleId: i.ruleId,
      ruleName: RULE_META[i.ruleId].name,
      severity: i.severity,
      date: i.date,
      detail: i.detail,
      dates: i.dates,
    })),
    monthly,
    rosterDays: rosterRows[0].map((r) => ({
      date: r.d,
      weekOff: Number(r.wo) === 1,
      shiftName: r.shift_name ?? null,
      shiftTime: r.st && r.et ? `${r.st}-${r.et}` : null,
      attendanceStatus: r.att ?? null,
      late: Number(r.late) === 1,
    })),
    timeline: none(
      auditRows[0].map((r) => ({
        id: String(r.id),
        at: r.override_at ?? r.created_at,
        actor: r.actor_name ?? "System (roster engine)",
        decision: String(r.decision_type ?? "").replace(/_/g, " "),
        rosterDate: r.d,
        remarks: r.override_reason ?? r.rule_applied ?? null,
      })),
    ),
  };
}

export async function getRuleDetail(
  ruleId: RuleId,
  scope: ScopeFilter,
  month: string,
) {
  const c = await computeCompliance(scope, month);
  const meta = RULE_META[ruleId];
  const all = c.incidents.filter((i) => i.ruleId === ruleId);
  const cur = all
    .filter((i) => monthOf(i.date) === month)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const byBranch = new Map<
    string,
    { branchName: string; incidents: number; employees: Set<string> }
  >();
  const byEmp = new Map<string, number>();
  for (const i of cur) {
    const e = c.meta.get(i.employeeId);
    const key = e?.branchId ?? "none";
    const b = byBranch.get(key) ?? {
      branchName: e?.branchName ?? "Unassigned",
      incidents: 0,
      employees: new Set<string>(),
    };
    b.incidents += 1;
    b.employees.add(i.employeeId);
    byBranch.set(key, b);
    byEmp.set(i.employeeId, (byEmp.get(i.employeeId) ?? 0) + 1);
  }
  return {
    period: month,
    ruleId,
    ...{
      ruleName: meta.name,
      description: meta.description,
      threshold: meta.threshold,
      severity: meta.severity,
    },
    totalIncidents: cur.length,
    employeesAffected: byEmp.size,
    monthly: c.months.map((m) => ({
      month: m,
      violations: all.filter((i) => monthOf(i.date) === m).length,
    })),
    byBranch: [...byBranch.entries()]
      .map(([branchId, v]) => ({
        branchId,
        branchName: v.branchName,
        incidents: v.incidents,
        employees: v.employees.size,
      }))
      .sort((a, b) => b.incidents - a.incidents),
    incidents: cur.slice(0, 200).map((i) => {
      const e = c.meta.get(i.employeeId);
      return {
        id: i.id,
        date: i.date,
        employeeId: i.employeeId,
        employeeCode: e?.code ?? "",
        employeeName: e?.name ?? "Unknown",
        branchName: e?.branchName ?? null,
        severity: i.severity,
        detail: i.detail,
      };
    }),
    truncated: cur.length > 200,
  };
}

export async function getBranchDetail(
  branchId: string,
  scope: ScopeFilter,
  month: string,
) {
  const c = await computeCompliance({ ...scope, branchId: undefined }, month);
  const row = (m: string) =>
    c.branchMonthly[m]?.find((b) => b.branchId === branchId);
  const cur = row(month);
  if (!cur) return null;
  const empIds = new Set(
    [...c.meta.values()]
      .filter((e) => e.branchId === branchId)
      .map((e) => e.id),
  );
  const inMonth = c.incidents.filter(
    (i) => monthOf(i.date) === month && empIds.has(i.employeeId),
  );
  const rules = RULE_IDS.map((r) => {
    const list = inMonth.filter((i) => i.ruleId === r);
    return {
      ruleId: r,
      ruleName: RULE_META[r].name,
      violationCount: list.length,
      employeesAffected: new Set(list.map((i) => i.employeeId)).size,
    };
  });
  const perEmp = new Map<string, number>();
  for (const i of inMonth)
    perEmp.set(i.employeeId, (perEmp.get(i.employeeId) ?? 0) + 1);
  const prev = row(previousMonth(month));
  return {
    period: month,
    branchId,
    branchName: cur.branchName,
    compliancePct: cur.compliancePct,
    rostered: cur.rostered,
    employeesWithViolations: cur.breaching,
    totalViolations: cur.violations,
    previousCompliancePct: prev?.compliancePct ?? null,
    rules,
    monthly: c.months.map((m) => ({
      month: m,
      compliancePct: row(m)?.compliancePct ?? null,
      violations: row(m)?.violations ?? 0,
    })),
    topEmployees: [...perEmp.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .map(([id, n]) => {
        const e = c.meta.get(id);
        return {
          employeeId: id,
          employeeCode: e?.code ?? "",
          employeeName: e?.name ?? "Unknown",
          processName: e?.processName ?? null,
          violations: n,
        };
      }),
  };
}
