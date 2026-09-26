import { createHash } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Editable monthly targets at agent, TL and top-group level for the process dashboards that keep their targets on an
 * uploaded roster -- Housing Owner (group = AM) and Housing Premium (group = Center). Stored in
 * db_masmis.process_target_override (sql/dba/1872_process_target_override.sql, created by a DBA -- the app user has no CREATE on db_masmis). The uploaded roster (owner_agent_details / pre_agent_details) is the
 * baseline and is never modified.
 *
 * How an override is applied -- the dashboards everywhere sum AGENT targets (a TL's / AM's target is the sum of the
 * agents under them), so an override at any level is pushed DOWN to the agents. That keeps every screen -- headline,
 * group tables, agent tables, TQ/MQ/BQ stages, entity trends -- consistent with no per-screen special case:
 *   - agent override : that agent's target is exactly the value.
 *   - TL override    : the TL's Active agents together carry the value. Agents that have their own override keep it;
 *                      the remainder is shared by the others in proportion to their roster target (equally when
 *                      those are all 0).
 *   - group override : same, one level up: TLs (and agents) with their own override keep it, the remainder is shared
 *                      by the other TLs in proportion to their roster targets.
 *   The more specific level always wins; the level above shows the resulting sum.
 * Only Active agents receive a share (they are the ones every target total counts).
 *
 * Effective-dated by month: for a reference month the latest row with effective_month <= that month applies.
 */

export type ProcessKey = "housing_owner" | "housing_premium";
export type TargetLevel = "agent" | "tl" | "am" | "center";
/** The level names one process uses, and where its roster lives. */
interface ProcessConfig {
  key: ProcessKey; topLevel: "am" | "center"; topLabel: string; groupFallback: string;
  rosterSql: string;
}
export const PROCESSES: Record<ProcessKey, ProcessConfig> = {
  housing_owner: {
    key: "housing_owner", topLevel: "am", topLabel: "AM", groupFallback: "Unassigned",
    rosterSql: "SELECT overall AS name, tl_name AS tl, am AS grp, status, monthly_target AS target FROM db_masmis.owner_agent_details",
  },
  housing_premium: {
    key: "housing_premium", topLevel: "center", topLabel: "Center", groupFallback: "Unknown",
    rosterSql: "SELECT agent_name AS name, tl_name AS tl, center AS grp, status, target AS target FROM db_masmis.pre_agent_details",
  },
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const round2 = (v: number): number => Math.round(v * 100) / 100;
export const normName = (v: unknown): string => String(v ?? "").trim().replace(/\s+/g, " ");
/** audit_action_log.entity_id is CHAR(36): a name can be longer, so key the audit rows by a short stable hash (the name is in the metadata). */
export const auditEntityId = (process: ProcessKey, level: string, name: string): string =>
  `${process === "housing_owner" ? "ho" : "hp"}:${level}:${createHash("sha1").update(normName(name)).digest("hex").slice(0, 20)}`;

export interface OverrideRow {
  id: number; process: ProcessKey; level: TargetLevel; entityName: string; effectiveMonth: string; monthlyTarget: number;
  updatedBy: string | null; updatedAt: string | null;
}
interface DbRow extends RowDataPacket {
  id: number; process_key: ProcessKey; level: TargetLevel; entity_name: string; effective_month: string; monthly_target: string;
  updated_by: string | null; updated_at: Date | string | null;
}
const COLS = "id, process_key, level, entity_name, effective_month, monthly_target, updated_by, updated_at";
const toRow = (r: DbRow): OverrideRow => ({
  id: Number(r.id), process: r.process_key, level: r.level, entityName: r.entity_name, effectiveMonth: r.effective_month, monthlyTarget: Number(r.monthly_target),
  updatedBy: r.updated_by, updatedAt: r.updated_at ? String(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at) : null,
});
const isMissingTable = (err: unknown): boolean => {
  const e = err as { code?: string; errno?: number };
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
};

export async function listOverrides(process: ProcessKey): Promise<{ tableAvailable: boolean; rows: OverrideRow[] }> {
  try {
    const [rs] = await db.execute<DbRow[]>(`SELECT ${COLS} FROM db_masmis.process_target_override WHERE process_key = ? ORDER BY level, entity_name, effective_month DESC`, [process]);
    return { tableAvailable: true, rows: rs.map(toRow) };
  } catch (err) {
    if (isMissingTable(err)) return { tableAvailable: false, rows: [] };
    throw err;
  }
}

/** Overrides in force for a month, keyed by level slot (top = AM / Center): the latest effective_month <= month. */
export type EffectiveOverrides = { agent: Map<string, OverrideRow>; tl: Map<string, OverrideRow>; top: Map<string, OverrideRow> };
export function effectiveOverrides(rows: OverrideRow[], month: string): EffectiveOverrides {
  const out: EffectiveOverrides = { agent: new Map(), tl: new Map(), top: new Map() };
  for (const r of rows) {
    if (r.effectiveMonth > month) continue;
    const slot = r.level === "agent" ? out.agent : r.level === "tl" ? out.tl : out.top;
    const cur = slot.get(r.entityName);
    if (!cur || r.effectiveMonth > cur.effectiveMonth) slot.set(r.entityName, r);
  }
  return out;
}

/* ------------------------------ applying overrides ------------------------------ */

export interface TargetSubject {
  name: string; tl: string; group: string; active: boolean;
  /** roster (baseline) target on the way in; the effective target on the way out. */
  target: number;
}

/** Pure: turns baseline agent targets into effective ones. Mutates `target` on each subject. */
export function applyOverrides(subjects: TargetSubject[], ov: EffectiveOverrides): void {
  if (ov.agent.size === 0 && ov.tl.size === 0 && ov.top.size === 0) return;
  const base = new Map(subjects.map((s) => [s, s.target]));
  const activeOf = (list: TargetSubject[]) => list.filter((s) => s.active);
  const baseSum = (list: TargetSubject[]) => activeOf(list).reduce((t, s) => t + (base.get(s) ?? 0), 0);

  // Build group -> TL -> agents. A TL that appears under several groups gets its override split across those nodes
  // in proportion to their baseline, so the TL total still equals the override.
  interface TlNode { tl: string; agents: TargetSubject[]; forced: number | null }
  interface GroupNode { group: string; tls: TlNode[] }
  const groups = new Map<string, GroupNode>();
  for (const s of subjects) {
    const g = groups.get(s.group) ?? { group: s.group, tls: [] };
    let tl = g.tls.find((t) => t.tl === s.tl);
    if (!tl) { tl = { tl: s.tl, agents: [], forced: null }; g.tls.push(tl); }
    tl.agents.push(s);
    groups.set(s.group, g);
  }
  const tlNodesByName = new Map<string, TlNode[]>();
  for (const g of groups.values()) for (const t of g.tls) tlNodesByName.set(t.tl, [...(tlNodesByName.get(t.tl) ?? []), t]);
  for (const [name, nodes] of tlNodesByName) {
    const o = ov.tl.get(name);
    if (!o) continue;
    const total = nodes.reduce((t, n) => t + baseSum(n.agents), 0);
    for (const n of nodes) n.forced = total > 0 ? round2(o.monthlyTarget * (baseSum(n.agents) / total)) : round2(o.monthlyTarget / nodes.length);
  }

  /** Give `total` to the Active agents of `list`, honouring agents that have their own override. */
  function spreadOverAgents(list: TargetSubject[], total: number): void {
    const act = activeOf(list);
    const fixed = act.filter((s) => ov.agent.has(s.name));
    const free = act.filter((s) => !ov.agent.has(s.name));
    for (const s of fixed) s.target = ov.agent.get(s.name)!.monthlyTarget;
    const rem = Math.max(0, total - fixed.reduce((t, s) => t + s.target, 0));
    const w = free.reduce((t, s) => t + (base.get(s) ?? 0), 0);
    for (const s of free) s.target = round2(w > 0 ? rem * ((base.get(s) ?? 0) / w) : free.length ? rem / free.length : 0);
  }
  function settleTl(n: TlNode, forced: number | null): void {
    const total = forced ?? n.forced;
    if (total !== null) spreadOverAgents(n.agents, total);
    else for (const s of activeOf(n.agents)) if (ov.agent.has(s.name)) s.target = ov.agent.get(s.name)!.monthlyTarget;
  }

  for (const g of groups.values()) {
    const gOv = ov.top.get(g.group);
    if (!gOv) { for (const t of g.tls) settleTl(t, null); continue; }
    // TLs with their own override keep it; the rest of the group's total is shared by the other TLs by baseline.
    const fixedTls = g.tls.filter((t) => t.forced !== null);
    const freeTls = g.tls.filter((t) => t.forced === null);
    const rem = Math.max(0, gOv.monthlyTarget - fixedTls.reduce((t, n) => t + (n.forced ?? 0), 0));
    const w = freeTls.reduce((t, n) => t + baseSum(n.agents), 0);
    for (const t of fixedTls) settleTl(t, null);
    for (const t of freeTls) settleTl(t, round2(w > 0 ? rem * (baseSum(t.agents) / w) : freeTls.length ? rem / freeTls.length : 0));
  }
}

const refMonthOf = (toIso: string): string => toIso.slice(0, 7);

/** Applies overrides to any list of roster-like items, writing the effective target back through `set`. */
export async function applyOverridesToItems<T>(
  process: ProcessKey, items: T[], toIso: string,
  acc: { name: (t: T) => string; tl: (t: T) => string; group: (t: T) => string; active: (t: T) => boolean; get: (t: T) => number; set: (t: T, v: number) => void },
): Promise<void> {
  const { rows } = await listOverrides(process);
  if (rows.length === 0) return;
  const subjects: TargetSubject[] = items.map((t) => ({ name: acc.name(t), tl: acc.tl(t), group: acc.group(t), active: acc.active(t), target: acc.get(t) }));
  applyOverrides(subjects, effectiveOverrides(rows, refMonthOf(toIso)));
  items.forEach((t, i) => acc.set(t, subjects[i].target));
}

/* ------------------------------ writes ------------------------------ */

export interface OverrideInput { level: string; entityName: string; effectiveMonth: string; monthlyTarget: number | string }
export interface OverrideChange { oldValue: OverrideRow | null; newValue: OverrideRow }

function validate(process: ProcessKey, i: OverrideInput): { level: TargetLevel; name: string; ym: string; target: number } {
  const allowed: TargetLevel[] = ["agent", "tl", PROCESSES[process].topLevel];
  const level = allowed.find((l) => l === String(i.level ?? "").toLowerCase());
  if (!level) throw new Error(`Level must be one of: ${allowed.join(", ")}`);
  const name = normName(i.entityName);
  if (!name) throw new Error("A name is required");
  const ym = String(i.effectiveMonth ?? "").trim();
  if (!MONTH_RE.test(ym)) throw new Error("Effective month must look like 2026-09");
  const target = Number(i.monthlyTarget);
  if (!Number.isFinite(target) || target < 0 || target > 100000000000) throw new Error("Target must be zero or a positive amount");
  return { level, name, ym, target: round2(target) };
}

async function rowFor(process: ProcessKey, level: string, name: string, ym: string): Promise<OverrideRow | null> {
  const [rs] = await db.execute<DbRow[]>(`SELECT ${COLS} FROM db_masmis.process_target_override WHERE process_key = ? AND level = ? AND entity_name = ? AND effective_month = ?`, [process, level, name, ym]);
  return rs[0] ? toRow(rs[0]) : null;
}

export async function setOverride(process: ProcessKey, input: OverrideInput, actorId: string): Promise<OverrideChange> {
  const v = validate(process, input);
  const oldValue = await rowFor(process, v.level, v.name, v.ym);
  await db.execute<ResultSetHeader>(
    `INSERT INTO db_masmis.process_target_override (process_key, level, entity_name, effective_month, monthly_target, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE monthly_target = VALUES(monthly_target), updated_by = VALUES(updated_by)`,
    [process, v.level, v.name, v.ym, v.target, actorId, actorId]);
  const newValue = await rowFor(process, v.level, v.name, v.ym);
  if (!newValue) throw new Error("Target was not saved");
  return { oldValue, newValue };
}

export async function deleteOverride(process: ProcessKey, id: number): Promise<OverrideRow | null> {
  const [rs] = await db.execute<DbRow[]>(`SELECT ${COLS} FROM db_masmis.process_target_override WHERE id = ? AND process_key = ?`, [id, process]);
  if (!rs[0]) return null;
  await db.execute<ResultSetHeader>(`DELETE FROM db_masmis.process_target_override WHERE id = ? AND process_key = ?`, [id, process]);
  return toRow(rs[0]);
}

/* ------------------------------ agents added by hand ------------------------------ */

export interface ManualAgent {
  id: number; process: ProcessKey; name: string; empId: string | null; tl: string; group: string; status: "Active" | "InActive";
  doj: string | null; monthlyTarget: number; effectiveFrom: string; updatedBy: string | null; updatedAt: string | null;
}
interface MaRow extends RowDataPacket {
  id: number; process_key: ProcessKey; agent_name: string; emp_id: string | null; tl_name: string; group_name: string; status: string;
  doj: string | null; monthly_target: string; effective_from: string; updated_by: string | null; updated_at: Date | string | null;
}
const MA_COLS = "id, process_key, agent_name, emp_id, tl_name, group_name, status, DATE_FORMAT(doj, '%Y-%m-%d') AS doj, monthly_target, effective_from, updated_by, updated_at";
const toManual = (r: MaRow): ManualAgent => ({
  id: Number(r.id), process: r.process_key, name: r.agent_name, empId: r.emp_id, tl: r.tl_name, group: r.group_name,
  status: r.status === "Active" ? "Active" : "InActive", doj: r.doj, monthlyTarget: Number(r.monthly_target), effectiveFrom: r.effective_from,
  updatedBy: r.updated_by, updatedAt: r.updated_at ? String(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at) : null,
});

export async function listManualAgents(process: ProcessKey): Promise<{ available: boolean; rows: ManualAgent[] }> {
  try {
    const [rs] = await db.execute<MaRow[]>(`SELECT ${MA_COLS} FROM db_masmis.process_manual_agent WHERE process_key = ? ORDER BY agent_name`, [process]);
    return { available: true, rows: rs.map(toManual) };
  } catch (err) {
    if (isMissingTable(err)) return { available: false, rows: [] };
    throw err;
  }
}
/** Manual agents that exist for the dashboard range ending on toIso (effective_from <= that month). [] when the table is absent. */
export async function loadManualAgentsForRange(process: ProcessKey, toIso: string): Promise<ManualAgent[]> {
  const { rows } = await listManualAgents(process);
  const ym = refMonthOf(toIso);
  return rows.filter((m) => m.effectiveFrom <= ym);
}

const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Owner roster writes DOJ as "D-Mon-YY"; Premium as "M/D/YY" -- render the stored ISO date the way each process's own roster does. */
export const dojForOwner = (iso: string | null): string | null => (iso ? `${Number(iso.slice(8, 10))}-${MON3[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}` : null);
export const dojForPremium = (iso: string | null): string | null => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : null);
/** The Owner roster's own vintage ladder (from its uploaded ageing): 0-30 / 31-60 / 61-90 / 91-120 / 121-160 / 161-180 / 180 Above. */
export function ownerBucket(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return null;
  return days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : days <= 120 ? "91-120" : days <= 160 ? "121-160" : days <= 180 ? "161-180" : "180 Above";
}

export interface ManualAgentInput { name: string; empId?: string | null; tl: string; group: string; status: string; doj?: string | null; monthlyTarget: number | string; effectiveFrom: string }
function validateManual(i: ManualAgentInput): { name: string; empId: string | null; tl: string; group: string; status: "Active" | "InActive"; doj: string | null; target: number; from: string } {
  const name = normName(i.name);
  if (!name) throw new Error("Agent name is required");
  if (name.length > 255) throw new Error("Agent name is too long");
  const tl = normName(i.tl); if (!tl) throw new Error("TL is required");
  const group = normName(i.group); if (!group) throw new Error("AM / Center is required");
  const status = i.status === "Active" || i.status === "InActive" ? i.status : null;
  if (!status) throw new Error("Status must be Active or InActive");
  const doj = i.doj ? String(i.doj).trim() : null;
  if (doj && !/^\d{4}-\d{2}-\d{2}$/.test(doj)) throw new Error("Date of joining must be a date");
  const from = String(i.effectiveFrom ?? "").trim();
  if (!MONTH_RE.test(from)) throw new Error("Effective month must look like 2026-09");
  const target = Number(i.monthlyTarget);
  if (!Number.isFinite(target) || target < 0 || target > 100000000000) throw new Error("Target must be zero or a positive amount");
  const empId = normName(i.empId) || null;
  return { name, empId, tl, group, status, doj, target: round2(target), from };
}

export async function saveManualAgent(process: ProcessKey, input: ManualAgentInput, actorId: string, id?: number): Promise<{ oldValue: ManualAgent | null; newValue: ManualAgent }> {
  const v = validateManual(input);
  // An uploaded roster agent always wins, so a name already on the roster cannot be added here.
  const [roster] = await db.execute<RowDataPacket[]>(PROCESSES[process].rosterSql);
  if (roster.some((r) => normName(r.name).toLowerCase() === v.name.toLowerCase())) throw new Error(`"${v.name}" is already on the uploaded roster -- change their target from the Agent-wise tab instead`);
  let oldValue: ManualAgent | null = null;
  if (id !== undefined) {
    const [o] = await db.execute<MaRow[]>(`SELECT ${MA_COLS} FROM db_masmis.process_manual_agent WHERE id = ? AND process_key = ?`, [id, process]);
    if (!o[0]) throw new Error("Agent not found");
    oldValue = toManual(o[0]);
    await db.execute<ResultSetHeader>(
      `UPDATE db_masmis.process_manual_agent SET agent_name = ?, emp_id = ?, tl_name = ?, group_name = ?, status = ?, doj = ?, monthly_target = ?, effective_from = ?, updated_by = ?
        WHERE id = ? AND process_key = ?`,
      [v.name, v.empId, v.tl, v.group, v.status, v.doj, v.target, v.from, actorId, id, process]);
  } else {
    try {
      await db.execute<ResultSetHeader>(
        `INSERT INTO db_masmis.process_manual_agent (process_key, agent_name, emp_id, tl_name, group_name, status, doj, monthly_target, effective_from, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [process, v.name, v.empId, v.tl, v.group, v.status, v.doj, v.target, v.from, actorId, actorId]);
    } catch (err) {
      if ((err as { code?: string }).code === "ER_DUP_ENTRY") throw new Error(`"${v.name}" has already been added`);
      throw err;
    }
  }
  const [n] = await db.execute<MaRow[]>(`SELECT ${MA_COLS} FROM db_masmis.process_manual_agent WHERE process_key = ? AND agent_name = ?`, [process, v.name]);
  if (!n[0]) throw new Error("Agent was not saved");
  return { oldValue, newValue: toManual(n[0]) };
}

export async function deleteManualAgent(process: ProcessKey, id: number): Promise<ManualAgent | null> {
  const [o] = await db.execute<MaRow[]>(`SELECT ${MA_COLS} FROM db_masmis.process_manual_agent WHERE id = ? AND process_key = ?`, [id, process]);
  if (!o[0]) return null;
  await db.execute<ResultSetHeader>(`DELETE FROM db_masmis.process_manual_agent WHERE id = ? AND process_key = ?`, [id, process]);
  return toManual(o[0]);
}

/* ------------------------------ the Process Details page ------------------------------ */

export interface TargetEntityRow {
  level: TargetLevel; name: string; tl: string | null; group: string | null; status: string | null;
  agentCount: number;
  /** As uploaded (sum of Active agents' roster targets). */
  baselineTarget: number;
  /** What every dashboard uses this month. */
  effectiveTarget: number;
  override: { id: number; monthlyTarget: number; effectiveMonth: string; updatedBy: string | null; updatedAt: string | null } | null;
  overridden: boolean;
  /** Set when this agent was added on the Process Details page (not on the uploaded roster). */
  manual: ManualAgent | null;
}
export interface TargetsPageData {
  process: ProcessKey; topLevel: "am" | "center"; topLabel: string; month: string; tableAvailable: boolean; manualAvailable: boolean;
  totals: { baseline: number; effective: number; overrides: number; activeAgents: number };
  groups: TargetEntityRow[]; tls: TargetEntityRow[]; agents: TargetEntityRow[];
}

export async function getTargetsPage(process: ProcessKey, month: string): Promise<TargetsPageData> {
  const cfg = PROCESSES[process];
  const ym = MONTH_RE.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [agentRows] = await db.execute<RowDataPacket[]>(cfg.rosterSql);
  const { tableAvailable, rows } = await listOverrides(process);
  const ov = effectiveOverrides(rows, ym);

  const seen = new Set<string>();
  const subjects: Array<TargetSubject & { status: string }> = [];
  for (const r of agentRows) {
    const name = normName(r.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const target = Number(r.target);
    subjects.push({
      name, tl: normName(r.tl) || "Unassigned", group: normName(r.grp) || cfg.groupFallback, status: String(r.status ?? "Unknown"),
      active: String(r.status ?? "") === "Active", target: Number.isFinite(target) ? target : 0,
    });
  }
  // Agents added on this page join the roster (an uploaded agent with the same name wins).
  const manualList = await listManualAgents(process);
  const manualByName = new Map<string, ManualAgent>();
  for (const m of manualList.rows) {
    if (m.effectiveFrom > ym || seen.has(m.name)) continue;
    seen.add(m.name); manualByName.set(m.name, m);
    subjects.push({ name: m.name, tl: m.tl, group: m.group, status: m.status, active: m.status === "Active", target: m.monthlyTarget });
  }
  const baseline = new Map(subjects.map((s) => [s.name, s.target]));
  applyOverrides(subjects, ov);

  const sum = (list: TargetSubject[], f: (s: TargetSubject) => number) => list.filter((s) => s.active).reduce((t, s) => t + f(s), 0);
  const ovInfo = (slot: Map<string, OverrideRow>, name: string) => {
    const o = slot.get(name);
    return o ? { id: o.id, monthlyTarget: o.monthlyTarget, effectiveMonth: o.effectiveMonth, updatedBy: o.updatedBy, updatedAt: o.updatedAt } : null;
  };

  const group = (which: "top" | "tl"): TargetEntityRow[] => {
    const map = new Map<string, Array<TargetSubject & { status: string }>>();
    for (const s of subjects) { const k = which === "top" ? s.group : s.tl; map.set(k, [...(map.get(k) ?? []), s]); }
    return [...map.entries()].map(([name, list]) => {
      const baseT = sum(list, (s) => baseline.get(s.name) ?? 0), effT = sum(list, (s) => s.target);
      const o = ovInfo(which === "top" ? ov.top : ov.tl, name);
      return {
        level: which === "top" ? cfg.topLevel : ("tl" as TargetLevel), name, tl: null, group: which === "tl" ? (list[0]?.group ?? null) : null, status: null,
        agentCount: list.filter((s) => s.active).length, baselineTarget: round2(baseT), effectiveTarget: round2(effT),
        override: o, overridden: !!o || Math.abs(baseT - effT) > 0.005, manual: null,
      };
    }).sort((a, b) => b.effectiveTarget - a.effectiveTarget || a.name.localeCompare(b.name));
  };
  const agents: TargetEntityRow[] = subjects.map((s) => {
    const o = ovInfo(ov.agent, s.name);
    const b = baseline.get(s.name) ?? 0;
    return {
      level: "agent" as TargetLevel, name: s.name, tl: s.tl, group: s.group, status: s.status, agentCount: s.active ? 1 : 0,
      baselineTarget: round2(b), effectiveTarget: round2(s.target), override: o, overridden: !!o || Math.abs(b - s.target) > 0.005, manual: manualByName.get(s.name) ?? null,
    };
  }).sort((a, b) => b.effectiveTarget - a.effectiveTarget || a.name.localeCompare(b.name));

  return {
    process, topLevel: cfg.topLevel, topLabel: cfg.topLabel, month: ym, tableAvailable, manualAvailable: manualList.available,
    totals: {
      baseline: round2(sum(subjects, (s) => baseline.get(s.name) ?? 0)), effective: round2(sum(subjects, (s) => s.target)),
      overrides: ov.agent.size + ov.tl.size + ov.top.size, activeAgents: subjects.filter((s) => s.active).length,
    },
    groups: group("top"), tls: group("tl"), agents,
  };
}

export interface TargetDetail {
  entity: TargetEntityRow;
  children: Array<{ name: string; kind: "TL" | "Agent"; effectiveTarget: number; baselineTarget: number }>;
  history: Array<OverrideRow & { updatedByLabel: string | null }>;
  audit: Array<{ at: string; action: string; actor: string; reason: string | null; oldValue: unknown; newValue: unknown }>;
}

export async function getTargetDetail(process: ProcessKey, level: TargetLevel, name: string, month: string): Promise<TargetDetail | null> {
  const page = await getTargetsPage(process, month);
  const list = level === page.topLevel ? page.groups : level === "tl" ? page.tls : page.agents;
  const entity = list.find((e) => e.name === normName(name));
  if (!entity) return null;
  const children = level === page.topLevel
    ? page.tls.filter((t) => t.group === entity.name).map((t) => ({ name: t.name, kind: "TL" as const, effectiveTarget: t.effectiveTarget, baselineTarget: t.baselineTarget }))
    : level === "tl"
      ? page.agents.filter((a) => a.tl === entity.name).map((a) => ({ name: a.name, kind: "Agent" as const, effectiveTarget: a.effectiveTarget, baselineTarget: a.baselineTarget }))
      : [];
  const { rows } = await listOverrides(process);
  const mine = rows.filter((r) => r.level === level && r.entityName === entity.name);
  const [au] = await db.execute<RowDataPacket[]>(
    `SELECT actor_user_id, action_type, metadata_json, created_at FROM audit_action_log
      WHERE entity_type = 'process_target' AND entity_id = ? ORDER BY created_at DESC LIMIT 25`, [auditEntityId(process, level, entity.name)]);
  const ids = [...new Set([...mine.map((r) => r.updatedBy), ...au.map((a) => String(a.actor_user_id))].filter((x): x is string => !!x))];
  const emails = new Map<string, string>();
  if (ids.length) {
    try {
      const [us] = await db.execute<RowDataPacket[]>(`SELECT id, email FROM auth_user WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      for (const u of us) emails.set(String(u.id), String(u.email ?? ""));
    } catch { /* cosmetic */ }
  }
  const label = (id: string | null) => (id ? emails.get(id) ?? id : null);
  return {
    entity, children,
    history: mine.map((r) => ({ ...r, updatedByLabel: label(r.updatedBy) })),
    audit: au.map((a) => {
      const meta = (typeof a.metadata_json === "string" ? JSON.parse(a.metadata_json) : a.metadata_json ?? {}) as { reason?: string; oldValue?: unknown; newValue?: unknown };
      return { at: String(a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at), action: String(a.action_type), actor: label(String(a.actor_user_id)) ?? "", reason: meta.reason ?? null, oldValue: meta.oldValue ?? null, newValue: meta.newValue ?? null };
    }),
  };
}
