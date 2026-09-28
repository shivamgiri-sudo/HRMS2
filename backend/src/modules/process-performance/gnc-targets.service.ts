import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Editable monthly revenue targets for GNC's three LOBs, stored in mas_hrms.gnc_lob_target
 * (sql/1899). Every GNC dashboard reads them through resolveGncTargets(), so a target is
 * defined once and shows everywhere -- headline, LOB-wise summary and agent-wise.
 *
 * Model
 *  - Measured on revenue (gnc_sale.gross_amount), the same figure the dashboards show as
 *    Amount / Turnover.
 *  - Effective-dated by month: a row applies from its effective_month until a later row for
 *    the same LOB supersedes it.  Months before the first row have NO target (never guessed).
 *  - basis = per_agent : monthly target = per_agent_target x agent_count  (Inbound 1,30,000 x 7).
 *    basis = fixed     : monthly target = fixed_target                     (Abandon Cart 53,76,000).
 *  - A dashboard range is prorated by days: a range covering 1-15 Sep of a 30-day month gets
 *    15/30 of that month's target, a full month gets exactly the monthly target.
 *  - Agent-wise target = per_agent_target (prorated) for per_agent LOBs; for a fixed LOB it is
 *    fixed_target / agent_count when an agent count is configured, otherwise unavailable.
 */

export const GNC_TARGET_LOBS = ["Inbound", "Chat", "Abandon Cart"] as const;
export type GncTargetLob = (typeof GNC_TARGET_LOBS)[number];
export type TargetBasis = "per_agent" | "fixed";

export interface GncTargetRow {
  id: number;
  lob: GncTargetLob;
  effectiveMonth: string;
  basis: TargetBasis;
  perAgentTarget: number | null;
  agentCount: number | null;
  fixedTarget: number | null;
  monthlyTarget: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface GncLobTarget {
  lob: GncTargetLob;
  configured: boolean;
  basis: TargetBasis | null;
  /** Monthly target of the month the range ends in (null when none applies). */
  monthlyTarget: number | null;
  /** Target for exactly the requested range (monthly targets prorated by days). */
  rangeTarget: number | null;
  /** Per-agent target for the range (null when not derivable). */
  perAgentRangeTarget: number | null;
  perAgentMonthlyTarget: number | null;
  agentCount: number | null;
  /** Months of the range that have no configured target (partial coverage warning). */
  uncoveredMonths: string[];
}

export interface GncTargetsResolved {
  from: string;
  to: string;
  /** false until sql/1899 has been applied -- dashboards then show "no target configured". */
  tableAvailable: boolean;
  byLob: Record<GncTargetLob, GncLobTarget>;
}

interface DbRow extends RowDataPacket {
  id: number; lob: string; effective_month: string; target_basis: TargetBasis;
  per_agent_target: string | null; agent_count: number | null; fixed_target: string | null;
  updated_by: string | null; updated_at: Date | string | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n: number): string => String(n).padStart(2, "0");
const round2 = (v: number): number => Math.round(v * 100) / 100;
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function monthlyTargetOf(basis: TargetBasis, perAgent: number | null, agentCount: number | null, fixed: number | null): number {
  return basis === "per_agent" ? round2((perAgent ?? 0) * (agentCount ?? 0)) : round2(fixed ?? 0);
}

function toRow(r: DbRow): GncTargetRow {
  const perAgent = numOrNull(r.per_agent_target), fixed = numOrNull(r.fixed_target);
  return {
    id: Number(r.id), lob: r.lob as GncTargetLob, effectiveMonth: r.effective_month, basis: r.target_basis,
    perAgentTarget: perAgent, agentCount: r.agent_count === null ? null : Number(r.agent_count), fixedTarget: fixed,
    monthlyTarget: monthlyTargetOf(r.target_basis, perAgent, r.agent_count === null ? null : Number(r.agent_count), fixed),
    updatedBy: r.updated_by, updatedAt: r.updated_at ? String(r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at) : null,
  };
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
}

/** auth_user.id -> email, for showing who edited a target (separate query: the id columns use different collations). */
export async function actorEmails(ids: Array<string | null>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, string>();
  if (!uniq.length) return out;
  try {
    const [rs] = await db.execute<RowDataPacket[]>(`SELECT id, email FROM auth_user WHERE id IN (${uniq.map(() => "?").join(",")})`, uniq);
    for (const r of rs) out.set(String(r.id), String(r.email ?? ""));
  } catch { /* names are cosmetic -- fall back to the raw id */ }
  return out;
}

export interface GncTargetAuditEntry { at: string; action: string; actor: string; reason: string | null; oldValue: unknown; newValue: unknown }
export interface GncTargetDetail { row: GncTargetRow; updatedByLabel: string | null; createdBy: string | null; createdAt: string | null; audit: GncTargetAuditEntry[] }

/** One target row with every stored field and its last audit entries (audit_action_log). */
export async function getGncTargetDetail(id: number): Promise<GncTargetDetail | null> {
  const [rs] = await db.execute<(DbRow & { created_by: string | null; created_at: Date | string | null })[]>(
    `SELECT id, lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, updated_by, updated_at, created_by, created_at FROM gnc_lob_target WHERE id = ?`, [id]);
  if (!rs[0]) return null;
  const row = toRow(rs[0]);
  const [au] = await db.execute<RowDataPacket[]>(
    `SELECT actor_user_id, action_type, metadata_json, created_at FROM audit_action_log
      WHERE entity_type = 'gnc_lob_target' AND entity_id = ? ORDER BY created_at DESC LIMIT 25`, [`${row.lob}:${row.effectiveMonth}`]);
  const emails = await actorEmails([rs[0].updated_by, rs[0].created_by, ...au.map((a) => String(a.actor_user_id))]);
  const label = (id: string | null) => (id ? emails.get(id) ?? id : null);
  return {
    row, updatedByLabel: label(rs[0].updated_by), createdBy: label(rs[0].created_by),
    createdAt: rs[0].created_at ? String(rs[0].created_at instanceof Date ? rs[0].created_at.toISOString() : rs[0].created_at) : null,
    audit: au.map((a) => {
      const meta = (typeof a.metadata_json === "string" ? JSON.parse(a.metadata_json) : a.metadata_json ?? {}) as { reason?: string; oldValue?: unknown; newValue?: unknown };
      return {
        at: String(a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at), action: String(a.action_type),
        actor: label(String(a.actor_user_id)) ?? "", reason: meta.reason ?? null, oldValue: meta.oldValue ?? null, newValue: meta.newValue ?? null,
      };
    }),
  };
}

/** Every configured row (all months), newest month first within a LOB. */
export async function listGncTargets(): Promise<{ tableAvailable: boolean; rows: GncTargetRow[] }> {
  try {
    const [rs] = await db.execute<DbRow[]>(
      `SELECT id, lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, updated_by, updated_at
         FROM gnc_lob_target ORDER BY lob, effective_month DESC`,
    );
    return { tableAvailable: true, rows: rs.map(toRow) };
  } catch (err) {
    if (isMissingTable(err)) return { tableAvailable: false, rows: [] };
    throw err;
  }
}

/* ------------------------------ pure calculation ------------------------------ */

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** The month-by-month overlap of [from, to]: [{ ym, days }] */
export function monthOverlaps(from: string, to: string): Array<{ ym: string; days: number }> {
  const out: Array<{ ym: string; days: number }> = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const ym = `${y}-${p2(m)}`;
    const start = y === fy && m === fm ? fd : 1;
    const end = y === ty && m === tm ? td : daysInMonth(ym);
    out.push({ ym, days: Math.max(0, end - start + 1) });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Row in force for `ym`: the latest effective_month <= ym for that LOB. */
export function effectiveRow(rows: GncTargetRow[], lob: GncTargetLob, ym: string): GncTargetRow | null {
  let best: GncTargetRow | null = null;
  for (const r of rows) if (r.lob === lob && r.effectiveMonth <= ym && (!best || r.effectiveMonth > best.effectiveMonth)) best = r;
  return best;
}

export function resolveFromRows(rows: GncTargetRow[], from: string, to: string, tableAvailable: boolean): GncTargetsResolved {
  const overlaps = monthOverlaps(from, to);
  const lastYm = overlaps[overlaps.length - 1]?.ym ?? from.slice(0, 7);
  const byLob = {} as Record<GncTargetLob, GncLobTarget>;
  for (const lob of GNC_TARGET_LOBS) {
    let rangeTarget = 0, perAgentRange = 0, covered = false, perAgentDerivable = true;
    const uncovered: string[] = [];
    for (const o of overlaps) {
      const row = effectiveRow(rows, lob, o.ym);
      if (!row) { uncovered.push(o.ym); continue; }
      covered = true;
      const frac = o.days / daysInMonth(o.ym);
      rangeTarget += row.monthlyTarget * frac;
      if (row.basis === "per_agent" && row.perAgentTarget !== null) perAgentRange += row.perAgentTarget * frac;
      else if (row.basis === "fixed" && row.agentCount && row.agentCount > 0 && row.fixedTarget !== null) perAgentRange += (row.fixedTarget / row.agentCount) * frac;
      else perAgentDerivable = false;
    }
    const last = effectiveRow(rows, lob, lastYm);
    byLob[lob] = {
      lob, configured: covered, basis: last?.basis ?? null,
      monthlyTarget: last ? last.monthlyTarget : null,
      rangeTarget: covered ? round2(rangeTarget) : null,
      perAgentRangeTarget: covered && perAgentDerivable ? round2(perAgentRange) : null,
      perAgentMonthlyTarget: last ? (last.basis === "per_agent" ? last.perAgentTarget : last.agentCount && last.fixedTarget !== null ? round2(last.fixedTarget / last.agentCount) : null) : null,
      agentCount: last?.agentCount ?? null,
      uncoveredMonths: uncovered,
    };
  }
  return { from, to, tableAvailable, byLob };
}

/** Targets that apply to a dashboard range. */
export async function resolveGncTargets(from: string, to: string): Promise<GncTargetsResolved> {
  const f = DATE_RE.test(from) ? from : `${new Date().getFullYear()}-${p2(new Date().getMonth() + 1)}-01`;
  const t = DATE_RE.test(to) ? to : f;
  const { tableAvailable, rows } = await listGncTargets();
  return resolveFromRows(rows, f <= t ? f : t, f <= t ? t : f, tableAvailable);
}

/** Achievement % of revenue against a target (null when no target). */
export const achPct = (revenue: number, target: number | null): number | null =>
  target !== null && target > 0 ? Math.round((revenue / target) * 10000) / 100 : null;

/* ------------------------------------ writes ------------------------------------ */

export interface GncTargetInput {
  lob: string; effectiveMonth: string; basis: string;
  perAgentTarget?: number | string | null; agentCount?: number | string | null; fixedTarget?: number | string | null;
}
export interface GncTargetChange { oldValue: GncTargetRow | null; newValue: GncTargetRow }

function validate(input: GncTargetInput): { lob: GncTargetLob; ym: string; basis: TargetBasis; perAgent: number | null; agents: number | null; fixed: number | null } {
  const lob = GNC_TARGET_LOBS.find((l) => l.toLowerCase() === String(input.lob ?? "").trim().toLowerCase());
  if (!lob) throw new Error(`LOB must be one of: ${GNC_TARGET_LOBS.join(", ")}`);
  const ym = String(input.effectiveMonth ?? "").trim();
  if (!MONTH_RE.test(ym)) throw new Error("Effective month must look like 2026-09");
  const basis = String(input.basis ?? "") as TargetBasis;
  if (basis !== "per_agent" && basis !== "fixed") throw new Error("Basis must be per_agent or fixed");
  const perAgent = numOrNull(input.perAgentTarget), fixed = numOrNull(input.fixedTarget), agentsRaw = numOrNull(input.agentCount);
  if (agentsRaw !== null && (!Number.isInteger(agentsRaw) || agentsRaw < 0 || agentsRaw > 10000)) throw new Error("Agent count must be a whole number");
  if (basis === "per_agent") {
    if (perAgent === null || perAgent <= 0 || perAgent > 100000000) throw new Error("Per-agent target must be a positive amount");
    if (agentsRaw === null || agentsRaw < 1) throw new Error("Agent count must be at least 1 for a per-agent target");
    return { lob, ym, basis, perAgent: round2(perAgent), agents: agentsRaw, fixed: null };
  }
  if (fixed === null || fixed <= 0 || fixed > 10000000000) throw new Error("Monthly target must be a positive amount");
  return { lob, ym, basis, perAgent: null, agents: agentsRaw !== null && agentsRaw > 0 ? agentsRaw : null, fixed: round2(fixed) };
}

async function rowFor(lob: string, ym: string): Promise<GncTargetRow | null> {
  const [rs] = await db.execute<DbRow[]>(
    `SELECT id, lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, updated_by, updated_at
       FROM gnc_lob_target WHERE lob = ? AND effective_month = ?`, [lob, ym]);
  return rs[0] ? toRow(rs[0]) : null;
}

/** Create or replace the target of one LOB for one effective month. */
export async function setGncTarget(input: GncTargetInput, actorId: string): Promise<GncTargetChange> {
  const v = validate(input);
  const oldValue = await rowFor(v.lob, v.ym);
  await db.execute<ResultSetHeader>(
    `INSERT INTO gnc_lob_target (lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE target_basis = VALUES(target_basis), per_agent_target = VALUES(per_agent_target),
       agent_count = VALUES(agent_count), fixed_target = VALUES(fixed_target), updated_by = VALUES(updated_by)`,
    [v.lob, v.ym, v.basis, v.perAgent, v.agents, v.fixed, actorId, actorId],
  );
  const newValue = await rowFor(v.lob, v.ym);
  if (!newValue) throw new Error("Target was not saved");
  return { oldValue, newValue };
}

/** Remove one effective-month row (the previous row then applies again). */
export async function deleteGncTarget(id: number): Promise<GncTargetRow | null> {
  const [rs] = await db.execute<DbRow[]>(
    `SELECT id, lob, effective_month, target_basis, per_agent_target, agent_count, fixed_target, updated_by, updated_at FROM gnc_lob_target WHERE id = ?`, [id]);
  if (!rs[0]) return null;
  await db.execute<ResultSetHeader>(`DELETE FROM gnc_lob_target WHERE id = ?`, [id]);
  return toRow(rs[0]);
}

/* ------------------------- attaching targets to dashboards ------------------------- */

/** What a dashboard shows for one LOB: the target for its range and revenue against it. */
export interface LobTargetBlock {
  lob: GncTargetLob;
  tableAvailable: boolean;
  configured: boolean;
  basis: TargetBasis | null;
  monthlyTarget: number | null;
  rangeTarget: number | null;
  perAgentMonthlyTarget: number | null;
  agentCount: number | null;
  uncoveredMonths: string[];
  revenue: number;
  achPct: number | null;
}
export function lobTargetBlock(t: GncTargetsResolved, lob: GncTargetLob, revenue: number): LobTargetBlock {
  const b = t.byLob[lob];
  return {
    lob, tableAvailable: t.tableAvailable, configured: b.configured, basis: b.basis, monthlyTarget: b.monthlyTarget, rangeTarget: b.rangeTarget,
    perAgentMonthlyTarget: b.perAgentMonthlyTarget, agentCount: b.agentCount, uncoveredMonths: b.uncoveredMonths, revenue, achPct: achPct(revenue, b.rangeTarget),
  };
}
const asLob = (name: string): GncTargetLob | null => GNC_TARGET_LOBS.find((l) => l.toLowerCase() === String(name ?? "").trim().toLowerCase()) ?? null;

/** Overall dashboard: LOB rows, agent rows and a like-for-like total (only LOBs that have a target). */
export function decorateSaleWithTargets<D extends {
  campaignRevenue: Array<{ campaign: string; turnover: number }>;
  agentPerformance: Array<{ lob: string; revenue: number }>;
}>(data: D, t: GncTargetsResolved) {
  const campaignRevenue = data.campaignRevenue.map((c) => {
    const lob = asLob(c.campaign);
    const target = lob ? t.byLob[lob].rangeTarget : null;
    return { ...c, target, achPct: achPct(c.turnover, target) };
  });
  const agentPerformance = data.agentPerformance.map((a) => {
    const lob = asLob(a.lob);
    const target = lob ? t.byLob[lob].perAgentRangeTarget : null;
    return { ...a, target, achPct: achPct(a.revenue, target) };
  });
  let target = 0, revenue = 0;
  const covered: string[] = [];
  const blocks = GNC_TARGET_LOBS.map((lob) => {
    const rev = data.campaignRevenue.filter((c) => asLob(c.campaign) === lob).reduce((s, c) => s + c.turnover, 0);
    const b = lobTargetBlock(t, lob, rev);
    if (b.rangeTarget !== null) { target += b.rangeTarget; revenue += rev; covered.push(lob); }
    return b;
  });
  return {
    ...data, campaignRevenue, agentPerformance,
    targets: {
      tableAvailable: t.tableAvailable, blocks, coveredLobs: covered,
      total: covered.length ? { target: round2(target), revenue: round2(revenue), achPct: achPct(revenue, target) } : null,
    },
  };
}

export function decorateChatWithTargets<D extends {
  headline: { grossRevenue: number };
  saleLinkage: { matched: Array<{ agent: string; revenue: number }> };
}>(data: D, t: GncTargetsResolved) {
  const perAgent = t.byLob.Chat.perAgentRangeTarget;
  return {
    ...data,
    saleLinkage: { ...data.saleLinkage, matched: data.saleLinkage.matched.map((m) => ({ ...m, target: perAgent, achPct: achPct(m.revenue, perAgent) })) },
    target: lobTargetBlock(t, "Chat", data.headline.grossRevenue),
  };
}

export function decorateAbandonCartWithTargets<D extends { headline: { revenue: number } }>(data: D, t: GncTargetsResolved) {
  return { ...data, target: lobTargetBlock(t, "Abandon Cart", data.headline.revenue) };
}
