/**
 * Guards for Team Roster lines: shift-template validity, and the warnings / hard blocks computed at
 * submit time (and re-run at apply time by team-roster-apply.ts).
 *
 * Hard blocks (line cannot be submitted / is skipped at apply):
 *   - attendance for that employee/date is locked for payroll (attendance_daily_record.is_locked);
 *   - approved FULL leave and a working shift (SHIFT / TRAINING) - roster-leave-guard.service.ts.
 * Warnings (shown to approvers, never blocking):
 *   - Phase-3 off-day policy (a working shift on a FIXED_DAY off day, a week-off on a non-off day of a
 *     FIXED_DAY LOB, too many floating offs) - computeImportPolicyWarnings, reused as-is;
 *   - HALF-day approved leave;
 *   - a minimum-rest shortfall (validateMinimumRest). At apply time a rest BLOCK policy or a missing
 *     policy does refuse the line, exactly as roster import does; that is enforced in the apply file.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { checkLeaveConflict, loadApprovedLeave } from "./roster-leave-guard.service.js";
import { computeImportPolicyWarnings, type ImportRowLike } from "./roster-offday-apply.js";
import { loadActivePolicies } from "./roster-offday-policy.loader.js";
import type { EmployeeOffScope } from "./roster-offday-resolver.js";
import { isRestPolicyFeatureActive, validateMinimumRest } from "./rest-policy.service.js";
import {
  cellKey, placeholders, rowsOf, type NewAssignmentType, type SqlExecutor,
} from "./team-roster-types.js";

export interface TemplateInfo {
  id: string;
  shiftCode: string;
  shiftName: string;
  processId: string | null;
  start: string | null;
  end: string | null;
  night: boolean;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface EmployeeGuardInfo {
  processId: string | null;
  lobId: string | null;
  branchId: string | null;
}

export interface GuardLine {
  employeeId: string;
  date: string;
  newType: NewAssignmentType;
  templateId: string | null;
  oldAssignmentId: string | null;
}

export interface GuardVerdict {
  warnings: string[];
  block: string | null;
}

/** Max SHIFT lines whose rest gap is pre-checked at submit; apply re-checks every line regardless. */
export const REST_PRECHECK_LIMIT = 1000;

export async function loadTemplatesByIds(ids: string[], exec: SqlExecutor = db): Promise<Map<string, TemplateInfo>> {
  const map = new Map<string, TemplateInfo>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const result = await exec.execute(
      `SELECT id, shift_code, shift_name, process_id, start_time, end_time, night_shift, active_status,
              DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
              DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
         FROM wfm_shift_template WHERE id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const r of rowsOf<RowDataPacket>(result)) {
      const start = r.start_time != null ? String(r.start_time) : null;
      const end = r.end_time != null ? String(r.end_time) : null;
      map.set(String(r.id), {
        id: String(r.id),
        shiftCode: String(r.shift_code ?? ""),
        shiftName: String(r.shift_name ?? r.shift_code ?? ""),
        processId: r.process_id ? String(r.process_id) : null,
        start,
        end,
        night: Boolean(start && end && end <= start) || Number(r.night_shift) === 1,
        active: Number(r.active_status) === 1,
        effectiveFrom: r.effective_from ? String(r.effective_from) : null,
        effectiveTo: r.effective_to ? String(r.effective_to) : null,
      });
    }
  }
  return map;
}

/** Why this template cannot be used for this employee's process on this date; null when it can. */
export function templateProblem(t: TemplateInfo | undefined, employeeProcessId: string | null, date: string): string | null {
  if (!t) return "Shift template not found.";
  if (!t.active) return `Shift ${t.shiftCode || t.shiftName} is not active.`;
  if (!t.start || !t.end) return `Shift ${t.shiftCode || t.shiftName} has no start/end time.`;
  if (!employeeProcessId || !t.processId || t.processId !== employeeProcessId) {
    return `Shift ${t.shiftCode || t.shiftName} does not belong to this employee's process.`;
  }
  if (t.effectiveFrom && date < t.effectiveFrom) return `Shift ${t.shiftCode || t.shiftName} is not effective until ${t.effectiveFrom}.`;
  if (t.effectiveTo && date > t.effectiveTo) return `Shift ${t.shiftCode || t.shiftName} expired on ${t.effectiveTo}.`;
  return null;
}

export async function loadEmployeeGuardInfo(ids: string[], exec: SqlExecutor = db): Promise<Map<string, EmployeeGuardInfo>> {
  const map = new Map<string, EmployeeGuardInfo>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const result = await exec.execute(
      `SELECT id, process_id, lob_id, branch_id FROM employees WHERE id IN (${placeholders(chunk.length)})`,
      chunk,
    );
    for (const r of rowsOf<RowDataPacket>(result)) {
      map.set(String(r.id), {
        processId: r.process_id ? String(r.process_id) : null,
        lobId: r.lob_id ? String(r.lob_id) : null,
        branchId: r.branch_id ? String(r.branch_id) : null,
      });
    }
  }
  return map;
}

async function loadLockedCells(ids: string[], from: string, to: string, exec: SqlExecutor): Promise<Set<string>> {
  const locked = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const result = await exec.execute(
      `SELECT employee_id, DATE_FORMAT(record_date, '%Y-%m-%d') AS d FROM attendance_daily_record
        WHERE is_locked = 1 AND employee_id IN (${placeholders(chunk.length)}) AND record_date BETWEEN ? AND ?`,
      [...chunk, from, to],
    );
    for (const r of rowsOf<RowDataPacket>(result)) locked.add(cellKey(String(r.employee_id), String(r.d)));
  }
  return locked;
}

async function offdayWarnings(lines: GuardLine[], info: Map<string, EmployeeGuardInfo>, exec: SqlExecutor): Promise<Map<number, string>> {
  try {
    const scopes = new Map<string, EmployeeOffScope>();
    for (const [id, i] of info) scopes.set(id, { processId: i.processId, lobId: i.lobId, branchId: i.branchId });
    const processIds = [...new Set([...scopes.values()].map((s) => s.processId).filter((p): p is string => !!p))];
    if (!processIds.length) return new Map();
    const policies = await loadActivePolicies(processIds, exec as any);
    if (!policies.length) return new Map();
    const rows: ImportRowLike[] = lines.map((l) => ({
      employeeIdRaw: l.employeeId, rosterDate: l.date, normalizedType: l.newType, messages: [], extraMetadata: {},
    }));
    return computeImportPolicyWarnings(rows, { get: (id: string) => scopes.get(id) }, policies);
  } catch (err) {
    console.error("[team-roster] off-day policy check skipped:", (err as Error)?.message);
    return new Map();
  }
}

/**
 * Warnings and hard blocks for a set of lines, keyed by employee|date. The caller has already
 * validated templates; a line whose template is missing simply gets no shift-dependent checks.
 */
export async function evaluateGuards(
  lines: GuardLine[],
  templates: Map<string, TemplateInfo>,
  exec: SqlExecutor = db,
): Promise<Map<string, GuardVerdict>> {
  const verdicts = new Map<string, GuardVerdict>();
  if (!lines.length) return verdicts;
  const verdictOf = (l: GuardLine) => {
    const key = cellKey(l.employeeId, l.date);
    let v = verdicts.get(key);
    if (!v) { v = { warnings: [], block: null }; verdicts.set(key, v); }
    return v;
  };

  const ids = lines.map((l) => l.employeeId);
  const dates = lines.map((l) => l.date).sort();
  const from = dates[0];
  const to = dates[dates.length - 1];
  const info = await loadEmployeeGuardInfo(ids, exec);

  const locked = await loadLockedCells(ids, from, to, exec);
  const leave = await loadApprovedLeave([...new Set(ids)], from, to);

  lines.forEach((l) => {
    const v = verdictOf(l);
    if (locked.has(cellKey(l.employeeId, l.date))) {
      v.block = "Attendance for this date is already locked for payroll; it can no longer be rostered.";
      return;
    }
    const tpl = l.templateId ? templates.get(l.templateId) : undefined;
    const verdict = checkLeaveConflict(leave, l.employeeId, l.date, {
      isNightShift: Boolean(tpl?.night),
      assignmentType: l.newType === "SHIFT" || l.newType === "TRAINING" ? "SHIFT" : "UNASSIGNED",
    });
    if (verdict.blocked) v.block = verdict.reason ?? "Employee is on approved leave.";
    else if (verdict.warning && verdict.reason) v.warnings.push(verdict.reason);
  });

  const policyWarnings = await offdayWarnings(lines, info, exec);
  policyWarnings.forEach((message, index) => verdictOf(lines[index]).warnings.push(message));

  await restWarnings(lines, templates, info, verdicts, exec);
  return verdicts;
}

async function restWarnings(
  lines: GuardLine[], templates: Map<string, TemplateInfo>, info: Map<string, EmployeeGuardInfo>,
  verdicts: Map<string, GuardVerdict>, exec: SqlExecutor,
): Promise<void> {
  try {
    if (!(await isRestPolicyFeatureActive(exec as any))) return;
    let checked = 0;
    for (const l of lines) {
      const tpl = l.templateId ? templates.get(l.templateId) : undefined;
      const v = verdicts.get(cellKey(l.employeeId, l.date));
      if (l.newType !== "SHIFT" || !tpl?.start || !tpl.end || !v || v.block) continue;
      if (checked >= REST_PRECHECK_LIMIT) break;
      checked += 1;
      const emp = info.get(l.employeeId);
      const rest = await validateMinimumRest(
        { employeeId: l.employeeId, processId: emp?.processId ?? null, branchId: emp?.branchId ?? null, forDate: l.date },
        { startTime: tpl.start, endTime: tpl.end }, l.oldAssignmentId, exec as any,
      );
      if (rest.ok) continue;
      v.warnings.push(
        rest.reason === "REST_POLICY_MISSING"
          ? "No minimum-rest policy is configured for this process/branch; WFM will not be able to apply this shift until one is."
          : `Rest gap ${rest.actualRestMinutes ?? "?"} min is below the required ${rest.requiredRestMinutes ?? "?"} min (${rest.policy?.enforcementMode === "block" ? "blocking policy" : "warn-only policy"}).`,
      );
    }
  } catch (err) {
    console.error("[team-roster] rest pre-check skipped:", (err as Error)?.message);
  }
}

