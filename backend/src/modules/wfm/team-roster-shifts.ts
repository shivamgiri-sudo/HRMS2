/**
 * Shift options a manager may pick for an employee of a given process.
 *
 * Live rosters do not use wfm_shift_template: imported and hand-built rows carry raw times
 * (wfm_roster_assignment.shift_start_time / shift_end_time, shift_template_id NULL). So the options
 * are the merge of three sources, de-duplicated by (start, end):
 *   1. template    - active wfm_shift_template rows of the process (newest version per shift_code);
 *   2. in_use      - DISTINCT times actually rostered for employees of that process (last 60 days
 *                    onward) with a real working shift, most used first, at most 12 per process;
 *   3. shift_master- active wfm_shift_master rows whose process_name matches the process.
 * A line stores the chosen shift AS TIMES (plus the template / master id when the option has one).
 * The server recomputes the allowed options and never trusts client-supplied times: a forged
 * start/end that is not an allowed option for that employee's process is refused.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { placeholders, rowsOf, ymdOf, TeamRosterError, type SqlExecutor } from "./team-roster-types.js";

export const IN_USE_WINDOW_DAYS = 60;
export const IN_USE_LIMIT_PER_PROCESS = 12;

export type ShiftSource = "template" | "in_use" | "shift_master";
export type ShiftGroup = "Templates" | "In use" | "Shift master";

export interface ShiftOption {
  /** 'HH:MM-HH:MM': the identity of an option (options are de-duplicated on it). */
  key: string;
  start: string;
  end: string;
  night: boolean;
  label: string;
  code: string | null;
  name: string | null;
  group: ShiftGroup;
  sources: ShiftSource[];
  useCount: number;
  templateId: string | null;
  shiftMasterId: string | null;
  /** Only set for a template-only option: the window in which it may be used. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface ShiftChoiceInput {
  shiftTemplateId?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  shiftMasterId?: string | null;
}

const hhmm = (v: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : `${String(h).padStart(2, "0")}:${m[2]}`;
};
export const normalizeTime = hhmm;

export const timeKey = (start: string, end: string) => `${start}-${end}`;
export const isNightShift = (start: string, end: string) => end < start;

export function optionLabel(start: string, end: string, code: string | null, name: string | null): string {
  const times = `${start}–${end}`;
  const tag = name || code;
  return tag ? `${times} - ${tag}` : times;
}

function addOption(
  bag: Map<string, ShiftOption>, src: ShiftSource, start: string | null, end: string | null,
  extra: { code?: string | null; name?: string | null; templateId?: string | null; shiftMasterId?: string | null; useCount?: number; effectiveFrom?: string | null; effectiveTo?: string | null } = {},
) {
  if (!start || !end || start === end) return; // an empty or zero-length shift is not a shift
  const key = timeKey(start, end);
  const existing = bag.get(key);
  if (existing) {
    if (!existing.sources.includes(src)) existing.sources.push(src);
    existing.useCount += extra.useCount ?? 0;
    existing.code ??= extra.code ?? null;
    existing.name ??= extra.name ?? null;
    existing.templateId ??= extra.templateId ?? null;
    existing.shiftMasterId ??= extra.shiftMasterId ?? null;
    if (existing.sources.some((s) => s !== "template")) { existing.effectiveFrom = null; existing.effectiveTo = null; }
    existing.label = optionLabel(start, end, existing.code, existing.name);
    return;
  }
  bag.set(key, {
    key, start, end, night: isNightShift(start, end), label: optionLabel(start, end, extra.code ?? null, extra.name ?? null),
    code: extra.code ?? null, name: extra.name ?? null, group: "In use", sources: [src], useCount: extra.useCount ?? 0,
    templateId: extra.templateId ?? null, shiftMasterId: extra.shiftMasterId ?? null,
    effectiveFrom: src === "template" ? extra.effectiveFrom ?? null : null, effectiveTo: src === "template" ? extra.effectiveTo ?? null : null,
  });
}

const groupOf = (o: ShiftOption): ShiftGroup => (o.sources.includes("template") ? "Templates" : o.sources.includes("shift_master") ? "Shift master" : "In use");
const GROUP_ORDER: Record<ShiftGroup, number> = { Templates: 0, "In use": 1, "Shift master": 2 };

/** Pure merge of the three raw sources for ONE process. */
export function mergeShiftOptions(input: {
  templates: Array<{ id: string; shiftCode: string; shiftName: string; start: unknown; end: unknown; effectiveFrom?: string | null; effectiveTo?: string | null }>;
  inUse: Array<{ start: unknown; end: unknown; count: number }>;
  masters: Array<{ id: string; shiftCode: string; shiftName: string; start: unknown; end: unknown }>;
}): ShiftOption[] {
  const bag = new Map<string, ShiftOption>();
  for (const t of input.templates) {
    addOption(bag, "template", hhmm(t.start), hhmm(t.end), { code: t.shiftCode, name: t.shiftName, templateId: t.id, effectiveFrom: t.effectiveFrom, effectiveTo: t.effectiveTo });
  }
  for (const m of input.masters) {
    addOption(bag, "shift_master", hhmm(m.start), hhmm(m.end), { code: m.shiftCode, name: m.shiftName, shiftMasterId: m.id });
  }
  // In-use times: aggregate raw variants ('10:00' vs '10:00:00'), most used first, capped.
  const usage = new Map<string, { start: string; end: string; count: number }>();
  for (const u of input.inUse) {
    const s = hhmm(u.start);
    const e = hhmm(u.end);
    if (!s || !e || s === e) continue;
    const k = timeKey(s, e);
    const cur = usage.get(k) ?? { start: s, end: e, count: 0 };
    cur.count += Number(u.count) || 0;
    usage.set(k, cur);
  }
  [...usage.values()].sort((a, b) => b.count - a.count || a.start.localeCompare(b.start))
    .slice(0, IN_USE_LIMIT_PER_PROCESS)
    .forEach((u) => addOption(bag, "in_use", u.start, u.end, { useCount: u.count }));
  // Counts also enrich template / master options that are in use but fell outside the cap.
  usage.forEach((u, k) => { const o = bag.get(k); if (o && !o.sources.includes("in_use")) o.useCount += u.count; });
  const out = [...bag.values()];
  out.forEach((o) => { o.group = groupOf(o); });
  return out.sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || b.useCount - a.useCount || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

/** Options for each process id. Three queries in total, whatever the number of processes. */
export async function loadShiftOptions(processIds: string[], today: string, exec: SqlExecutor = db): Promise<Map<string, ShiftOption[]>> {
  const result = new Map<string, ShiftOption[]>();
  const ids = [...new Set(processIds.filter(Boolean))];
  if (!ids.length) return result;
  const marks = placeholders(ids.length);

  const names = new Map<string, string>(); // process_name -> process_id, for the shift-master match
  rowsOf<RowDataPacket>(await exec.execute(`SELECT id, process_name FROM process_master WHERE id IN (${marks})`, ids))
    .forEach((r) => { if (r.process_name) names.set(String(r.process_name), String(r.id)); });

  const templates = rowsOf<RowDataPacket>(await exec.execute(
    `SELECT id, shift_code, shift_name, process_id, start_time, end_time,
            DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from, DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
       FROM wfm_shift_template
      WHERE process_id IN (${marks}) AND active_status = 1 AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY process_id, shift_code, version DESC`,
    [...ids, today],
  ));
  const inUse = rowsOf<RowDataPacket>(await exec.execute(
    `SELECT e.process_id, wra.shift_start_time, wra.shift_end_time, COUNT(*) AS uses
       FROM wfm_roster_assignment wra JOIN employees e ON e.id = wra.employee_id
      WHERE e.process_id IN (${marks}) AND wra.roster_date >= DATE_SUB(?, INTERVAL ${IN_USE_WINDOW_DAYS} DAY)
        AND wra.is_week_off = 0 AND (wra.assignment_type IS NULL OR wra.assignment_type IN ('SHIFT', 'REGULAR'))
        AND wra.shift_start_time IS NOT NULL AND wra.shift_end_time IS NOT NULL
      GROUP BY e.process_id, wra.shift_start_time, wra.shift_end_time`,
    [...ids, today],
  ));
  const masterNames = [...names.keys()];
  const masters = masterNames.length ? rowsOf<RowDataPacket>(await exec.execute(
    `SELECT id, shift_code, shift_name, process_name, start_time, end_time FROM wfm_shift_master
      WHERE process_name IN (${placeholders(masterNames.length)}) AND active_status = 1 AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY process_name, shift_code, version DESC`,
    [...masterNames, today],
  )) : [];

  for (const pid of ids) {
    const seenCode = new Set<string>();
    const tpl = templates.filter((t) => String(t.process_id) === pid && !seenCode.has(String(t.shift_code)) && seenCode.add(String(t.shift_code)))
      .map((t) => ({ id: String(t.id), shiftCode: String(t.shift_code ?? ""), shiftName: String(t.shift_name ?? ""), start: t.start_time, end: t.end_time, effectiveFrom: t.effective_from ? ymdOf(t.effective_from) : null, effectiveTo: t.effective_to ? ymdOf(t.effective_to) : null }));
    const seenMaster = new Set<string>();
    const mas = masters.filter((m) => names.get(String(m.process_name)) === pid && !seenMaster.has(String(m.shift_code)) && seenMaster.add(String(m.shift_code)))
      .map((m) => ({ id: String(m.id), shiftCode: String(m.shift_code ?? ""), shiftName: String(m.shift_name ?? ""), start: m.start_time, end: m.end_time }));
    const use = inUse.filter((u) => String(u.process_id) === pid).map((u) => ({ start: u.shift_start_time, end: u.shift_end_time, count: Number(u.uses) }));
    result.set(pid, mergeShiftOptions({ templates: tpl, inUse: use, masters: mas }));
  }
  return result;
}

/**
 * The option a line's shift refers to, or a TeamRosterError. Times (or a template id, resolved to its
 * times here) must match an allowed option of the employee's process; the returned option is the
 * server's own record, so the template / master ids and the times that get stored are never the client's.
 */
export function resolveShiftChoice(input: ShiftChoiceInput, options: ShiftOption[], date: string): ShiftOption {
  let start = hhmm(input.shiftStart);
  let end = hhmm(input.shiftEnd);
  if ((!start || !end) && input.shiftTemplateId) {
    const byTemplate = options.find((o) => o.templateId === input.shiftTemplateId);
    if (byTemplate) { start = byTemplate.start; end = byTemplate.end; }
  }
  if (!start || !end) throw new TeamRosterError(400, "Pick a shift.", "SHIFT_REQUIRED");
  if (start === end) throw new TeamRosterError(400, "A shift's start and end times must differ.", "SHIFT_ZERO_LENGTH");
  const option = options.find((o) => o.key === timeKey(start!, end!));
  if (!option) throw new TeamRosterError(400, `${start}–${end} is not one of the shifts available for this employee's process.`, "SHIFT_NOT_ALLOWED");
  if (option.effectiveFrom && date < option.effectiveFrom) throw new TeamRosterError(400, `${option.label} is not effective until ${option.effectiveFrom}.`, "SHIFT_NOT_EFFECTIVE");
  if (option.effectiveTo && date > option.effectiveTo) throw new TeamRosterError(400, `${option.label} expired on ${option.effectiveTo}.`, "SHIFT_NOT_EFFECTIVE");
  return option;
}

/** Message form of resolveShiftChoice, for per-line problem lists. */
export function shiftProblem(input: ShiftChoiceInput, options: ShiftOption[], date: string): string | null {
  try { resolveShiftChoice(input, options, date); return null; } catch (e) { return (e as Error).message; }
}
