// The single write path for requisition criteria (plan 2026-10-09, S5): versions, per-field audit, approved-requisition
// rules (S-O2), bulk, copy and templates. Every writer (criteria panel, bulk, copy, template, the requisition form's hook and
// the backfill) ends in one version row + audit rows on job_requisition_criteria_version / _audit.
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { compileCriteria, type RequisitionCriteriaRow } from "./compile-criteria.js";
import { validateCriteria, type CriteriaIssue } from "./criteria-validate.js";
import { patchShapeError } from "./criteria-patch-shape.js";
import {
  bindColumn, CRITERIA_COLUMNS, diffColumns, loadDbRow, PATCH_TO_COLUMN, snapshotColumns, toCriteriaRow, type CriteriaColumn,
} from "./criteria-row.js";
import { parseSelectionRules } from "./selection-rules.schema.js";
import { followupGuardOn } from "./selection-switches.js";
import type { CompiledCriteria, RuleKey, SelectionRules } from "./selection-types.js";
import { applyTemplate, CONFIG_RULE, COLUMN_RULE, type CriteriaPatch } from "./templates.js";

export const CRITERIA_EDIT_ROLES = ["super_admin", "hr", "recruitment_hr", "branch_head"] as const;
export type CriteriaSource = "criteria_panel" | "bulk" | "copy" | "template" | "jd_suggestion";
export interface Actor { id: string; role: string }
export interface SaveResult {
  versionId: string | null; versionNo: number | null; changed: CriteriaColumn[]; diff: Array<{ field: CriteriaColumn; from: unknown; to: unknown }>;
  issues: CriteriaIssue[]; compiled: CompiledCriteria;
}

type Exec = (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>;
const exOf = (c: PoolConnection | null): Exec => (c ? (sql, p) => c.execute(sql, p as never) as never : (sql, p) => db.execute(sql, p as never) as never);
const fail = (statusCode: number, message: string, issues?: CriteriaIssue[]) => Object.assign(new Error(message), { statusCode, ...(issues ? { issues } : {}) });
const PATCH_KEYS = new Set(Object.keys(PATCH_TO_COLUMN));
const LOCKED_HINT: Record<string, string> = { salaryMin: "salary needs re-approval", salaryMax: "salary needs re-approval", salary_min: "salary needs re-approval", salary_max: "salary needs re-approval" };

function cfgObject(c: unknown): Record<string, unknown> {
  if (typeof c === "string") { try { return JSON.parse(c); } catch { return {}; } }
  return c && typeof c === "object" ? { ...(c as Record<string, unknown>) } : {};
}

/** Applies a patch to a row: screening config merged key by key, auto_notify always kept from the stored config. */
export function applyPatch(r: RequisitionCriteriaRow, patch: CriteriaPatch): RequisitionCriteriaRow {
  const out = { ...r } as RequisitionCriteriaRow & Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (k === "screeningConfig") {
      const stored = cfgObject(r.screeningConfig);
      const merged: Record<string, unknown> = { ...stored };
      for (const [ck, cv] of Object.entries((v ?? {}) as Record<string, unknown>)) {
        if (ck === "auto_notify") continue;
        if (cv === null || cv === undefined || (Array.isArray(cv) && cv.length === 0)) delete merged[ck]; else merged[ck] = cv;
      }
      out.screeningConfig = (Object.keys(merged).length ? merged : null) as RequisitionCriteriaRow["screeningConfig"];
    } else {
      out[k] = v === undefined ? null : v;
    }
  }
  return out;
}

async function versionWrite(ex: Exec, a: { row: RequisitionCriteriaRow; compiled: CompiledCriteria; before: Partial<Record<CriteriaColumn, unknown>> | null; actor: Actor | null; source: string; reason: string | null }) {
  const [prev] = await ex("SELECT id, version_no, criteria_hash, columns_json FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [a.row.id]);
  const hashChanged = (prev as RowDataPacket[])[0]?.criteria_hash !== a.compiled.hash;
  const [m] = await ex("SELECT COALESCE(MAX(version_no), 0) AS n FROM job_requisition_criteria_version WHERE requisition_id = ? FOR UPDATE", [a.row.id]);
  const versionNo = Number((m as RowDataPacket[])[0]?.n ?? 0) + 1;
  const id = randomUUID();
  const after = snapshotColumns(a.row);
  await ex(
    `INSERT INTO job_requisition_criteria_version (id, requisition_id, version_no, criteria_hash, compiled_json, columns_json, engine_version, source, created_by, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, a.row.id, versionNo, a.compiled.hash, JSON.stringify(a.compiled), JSON.stringify(after), a.compiled.engineVersion, a.source, a.actor?.id ?? null, a.reason?.slice(0, 300) ?? null]);
  const diff = a.before ? diffColumns(a.before, after) : [];
  if (diff.length) {
    const params = diff.flatMap((d) => [a.row.id, id, d.field, JSON.stringify(d.from), JSON.stringify(d.to), a.actor?.id ?? "system", a.actor?.role ?? null, a.source, a.reason?.slice(0, 300) ?? null, a.row.approvalStatus ?? ""]);
    await ex(`INSERT INTO job_requisition_criteria_audit (requisition_id, version_id, field, old_json, new_json, actor_id, actor_role, source, reason, approval_status_at_change)
     VALUES ${diff.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`, params);
  }
  return { id, versionNo, hashChanged };
}

/**
 * S14: a version whose compiled criteria differ re-checks the requisition's enrolled people (only with SELECTION_FOLLOWUP_GUARD).
 * Never for the boot backfill, and never in legacy mode: until HR saves selection rules the criteria are today's screeners, which
 * already admitted these people (legacy drive rules send unknowns to review, which would hold people for no new reason).
 */
function afterVersion(requisitionId: string, v: { id: string; hashChanged: boolean }, compiled: CompiledCriteria, source: string): void {
  if (!v.hashChanged || compiled.legacy || source === "backfill" || !followupGuardOn()) return;
  void import("./reevaluate.service.js").then((m) => m.queueReevaluation(requisitionId, v.id))
    .catch((e) => logger.warn({ requisitionId, err: String((e as Error).message).slice(0, 200) }, "[criteria] re-check not queued"));
}

async function liveMeta(ex: Exec, id: string): Promise<boolean> {
  try {
    const [r] = await ex("SELECT EXISTS(SELECT 1 FROM meta_campaign WHERE requisition_id = ? AND UPPER(campaign_status) = 'ACTIVE') AS live", [id]);
    return Number((r as RowDataPacket[])[0]?.live ?? 0) === 1;
  } catch { return false; }
}

export async function saveRequisitionCriteria(a: { requisitionId: string; patch: CriteriaPatch; actor: Actor; source: CriteriaSource; reason: string | null; dryRun?: boolean }): Promise<SaveResult> {
  const bad = Object.keys(a.patch ?? {}).filter((k) => !PATCH_KEYS.has(k));
  if (bad.length) throw fail(400, LOCKED_HINT[bad[0]] ? `${bad.join(", ")}: ${LOCKED_HINT[bad[0]]}` : `${bad.join(", ")} cannot be changed here (needs re-approval or the requisition form)`);
  const shape = patchShapeError(a.patch as Record<string, unknown>);
  if (shape) throw fail(400, shape);
  if (a.patch.selectionRules !== undefined && a.patch.selectionRules !== null) {
    const p = parseSelectionRules(a.patch.selectionRules);
    if (!p.ok) throw fail(422, "selection rules are invalid", p.errors.map((text) => ({ level: "error", keys: [], text })));
  }
  const conn = await db.getConnection();
  const ex = exOf(conn);
  try {
    await conn.beginTransaction();
    const d = await loadDbRow(ex, a.requisitionId, true);
    if (!d) throw fail(404, "Requisition not found");
    const row = toCriteriaRow(d);
    if (row.approvalStatus === "closed") throw fail(409, "Requisition is closed: its criteria are read-only");
    if (row.approvalStatus === "approved" && !a.reason?.trim()) throw fail(400, "A reason is required to change the criteria of an approved requisition");
    const next = { ...applyPatch(row, a.patch), hasLiveMetaCampaign: await liveMeta(ex, row.id) };
    const issues = validateCriteria(next);
    if (issues.some((i) => i.level === "error")) throw fail(422, "The criteria contradict each other", issues);
    const compiled = compileCriteria(next);
    const before = snapshotColumns(row);
    const diff = diffColumns(before, snapshotColumns(next));
    const changed = diff.map((x) => x.field);
    if (!changed.length || a.dryRun) {
      await conn.rollback();
      return { versionId: null, versionNo: null, changed, diff, issues, compiled };
    }
    await ex(`UPDATE job_requisition SET ${changed.map((c) => `${c} = ?`).join(", ")}, updated_at = NOW() WHERE id = ?`,
      [...changed.map((c) => bindColumn(c, snapshotColumns(next)[c])), row.id]);
    const v = await versionWrite(ex, { row: next, compiled, before, actor: a.actor, source: a.source, reason: a.reason });
    await conn.commit();
    afterVersion(row.id, v, compiled, a.source);
    return { versionId: v.id, versionNo: v.versionNo, changed, diff, issues, compiled };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** The requisition form (legacy PATCH/POST) and the backfill: a new version only when the compiled criteria changed. */
/** One version row when the compiled criteria changed. A concurrent writer that took the next version number (unique key) makes this
 *  retry once more from the top: the second pass sees the other version (same hash: nothing to write; else the following number). */
export async function recordCriteriaVersion(requisitionId: string, actorId: string | null, source: string, reason: string | null = null): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try { return await recordCriteriaVersionOnce(requisitionId, actorId, source, reason); } catch (e) {
      if ((e as { code?: string }).code !== "ER_DUP_ENTRY" || attempt >= 2) throw e;
    }
  }
}

async function recordCriteriaVersionOnce(requisitionId: string, actorId: string | null, source: string, reason: string | null): Promise<string | null> {
  const conn = await db.getConnection();
  const ex = exOf(conn);
  try {
    await conn.beginTransaction();
    const d = await loadDbRow(ex, requisitionId);
    if (!d) { await conn.rollback(); return null; }
    const row = toCriteriaRow(d);
    const compiled = compileCriteria(row);
    const [l] = await ex("SELECT id, version_no, criteria_hash, columns_json FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [requisitionId]);
    const latest = (l as RowDataPacket[])[0];
    if (latest && latest.criteria_hash === compiled.hash) { await conn.rollback(); return null; }
    const before = latest ? (typeof latest.columns_json === "string" ? JSON.parse(latest.columns_json) : latest.columns_json) : null;
    const v = await versionWrite(ex, { row, compiled, before, actor: actorId ? { id: actorId, role: "" } : null, source, reason });
    await conn.commit();
    afterVersion(requisitionId, v, compiled, source);
    return v.id;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** Never lets versioning break a requisition save (e.g. before migration 2145 ran): logs and moves on. */
export async function recordCriteriaVersionSafe(requisitionId: string, actorId: string | null, source: string): Promise<void> {
  try { await recordCriteriaVersion(requisitionId, actorId, source); } catch (e) {
    logger.warn({ requisitionId, err: String((e as Error).message).slice(0, 200) }, "[criteria] version not recorded");
  }
}

const isFilled = (v: unknown) => !(v === null || v === undefined || v === 0 || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length));

/** Drops what is already filled on the target (unless replaceFilled), reporting each skipped column. */
function onlyEmpty(row: RequisitionCriteriaRow, patch: CriteriaPatch, replaceFilled: boolean): { patch: CriteriaPatch; skipped: Array<{ field: CriteriaColumn; from: unknown; to: unknown; skipped: "filled" }> } {
  if (replaceFilled) return { patch, skipped: [] };
  const out: CriteriaPatch = {};
  const skipped: Array<{ field: CriteriaColumn; from: unknown; to: unknown; skipped: "filled" }> = [];
  const snap = snapshotColumns(row);
  for (const [k, v] of Object.entries(patch) as Array<[keyof CriteriaPatch, unknown]>) {
    const col = PATCH_TO_COLUMN[k];
    if (k === "screeningConfig") {
      const stored = cfgObject(row.screeningConfig);
      const keep = Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([ck]) => !isFilled(stored[ck])));
      if (Object.keys(keep).length) out.screeningConfig = keep as CriteriaPatch["screeningConfig"];
    } else if (k === "selectionRules") {
      const sr = v as SelectionRules;
      const existing = row.selectionRules?.rules ?? {};
      const rules = { ...existing } as Record<string, unknown>;
      for (const [rk, rv] of Object.entries(sr.rules ?? {})) if (!(rk in existing)) rules[rk] = rv;
      out.selectionRules = { ...(row.selectionRules ?? {}), ...sr, rules } as SelectionRules;
    } else if (isFilled(snap[col])) {
      skipped.push({ field: col, from: snap[col], to: v, skipped: "filled" });
    } else (out as Record<string, unknown>)[k] = v;
  }
  return { patch: out, skipped };
}

type BulkOut = Array<{ requisitionId: string; diff: Array<{ field: string; from: unknown; to: unknown; skipped?: "filled" }>; issues: CriteriaIssue[]; versionId: string | null }>;

async function saveEach(ids: string[], patchFor: (row: RequisitionCriteriaRow) => CriteriaPatch, a: { replaceFilled: boolean; actor: Actor; reason: string | null; dryRun: boolean; source: CriteriaSource }): Promise<BulkOut> {
  const out: BulkOut = [];
  for (const id of ids) {
    try {
      const d = await loadDbRow(exOf(null), id);
      if (!d) throw fail(404, "Requisition not found");
      const row = toCriteriaRow(d);
      const { patch, skipped } = onlyEmpty(row, patchFor(row), a.replaceFilled);
      const r = await saveRequisitionCriteria({ requisitionId: id, patch, actor: a.actor, source: a.source, reason: a.reason, dryRun: a.dryRun });
      const diff = [...r.diff, ...skipped].sort((x, y) => CRITERIA_COLUMNS.indexOf(x.field) - CRITERIA_COLUMNS.indexOf(y.field));
      out.push({ requisitionId: id, diff, issues: r.issues, versionId: r.versionId });
    } catch (e) {
      const err = e as Error & { issues?: CriteriaIssue[] };
      out.push({ requisitionId: id, diff: [], issues: err.issues ?? [{ level: "error", keys: [], text: err.message }], versionId: null });
    }
  }
  return out;
}

export async function bulkSaveCriteria(a: { requisitionIds: string[]; patch: CriteriaPatch; replaceFilled: boolean; actor: Actor; reason: string | null; dryRun: boolean }): Promise<BulkOut> {
  return saveEach(a.requisitionIds, () => a.patch, { ...a, source: "bulk" });
}

/** The patch that copies these rule keys (or all) from one requisition. */
export function patchFromRow(src: RequisitionCriteriaRow, keys: RuleKey[] | "all"): CriteriaPatch {
  const want = (k: RuleKey) => keys === "all" || keys.includes(k);
  const patch: CriteriaPatch = {};
  for (const [f, k] of Object.entries(COLUMN_RULE) as Array<[keyof CriteriaPatch, RuleKey]>) if (want(k)) (patch as Record<string, unknown>)[f] = (src as unknown as Record<string, unknown>)[f] ?? null;
  const cfg = cfgObject(src.screeningConfig);
  const cfgPart = Object.fromEntries(Object.entries(CONFIG_RULE).filter(([, k]) => want(k)).filter(([ck]) => cfg[ck] !== undefined).map(([ck]) => [ck, cfg[ck]]));
  if (Object.keys(cfgPart).length) patch.screeningConfig = cfgPart as CriteriaPatch["screeningConfig"];
  const rules = Object.fromEntries(Object.entries(src.selectionRules?.rules ?? {}).filter(([k]) => want(k as RuleKey)));
  if (Object.keys(rules).length) patch.selectionRules = { schema: 1, rules };
  return patch;
}

export async function copyCriteria(a: { fromRequisitionId: string; toRequisitionIds: string[]; keys: RuleKey[] | "all"; replaceFilled: boolean; actor: Actor; reason: string | null; dryRun: boolean }): Promise<BulkOut> {
  const d = await loadDbRow(exOf(null), a.fromRequisitionId);
  if (!d) throw fail(404, "Source requisition not found");
  const patch = patchFromRow(toCriteriaRow(d), a.keys);
  return saveEach(a.toRequisitionIds, (row) => {
    if (!patch.selectionRules) return patch;
    return { ...patch, selectionRules: { ...(row.selectionRules ?? { schema: 1 }), schema: 1, rules: { ...(row.selectionRules?.rules ?? {}), ...patch.selectionRules.rules } } };
  }, { ...a, source: "copy" });
}

/** Template (or a campaign's default template, S-O9) copied into the requisition; empty fields only unless replaceFilled. */
export async function applyTemplateToRequisition(a: { requisitionId: string; templateId: string; replaceFilled: boolean; actor: Actor; reason: string | null; dryRun: boolean }) {
  const d = await loadDbRow(exOf(null), a.requisitionId);
  if (!d) throw fail(404, "Requisition not found");
  let t;
  try { t = applyTemplate(toCriteriaRow(d), a.templateId, { replaceFilled: a.replaceFilled, appliedBy: a.actor.id }); } catch (e) { throw fail(400, (e as Error).message); }
  const r = await saveRequisitionCriteria({ requisitionId: a.requisitionId, patch: t.patch, actor: a.actor, source: "template", reason: a.reason, dryRun: a.dryRun });
  return { ...r, skipped: t.skipped };
}

export async function getRequisitionCriteria(id: string) {
  const d = await loadDbRow(exOf(null), id);
  if (!d) throw fail(404, "Requisition not found");
  const row = toCriteriaRow(d);
  const compiled = compileCriteria(row);
  let versions: Array<Record<string, unknown>> = [];
  try {
    const [v] = await db.execute<RowDataPacket[]>(
      "SELECT id, version_no AS versionNo, created_at AS createdAt, created_by AS createdBy, source, reason FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 50", [id]);
    versions = v;
  } catch { versions = []; }
  return { row, compiled, completeness: compiled.completeness, issues: validateCriteria(row), versions };
}

export async function listCriteriaAudit(id: string, cursor: number | null) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, version_id AS versionId, field, old_json AS oldJson, new_json AS newJson, actor_id AS actorId, actor_role AS actorRole, source, reason,
            approval_status_at_change AS approvalStatus, created_at AS createdAt
       FROM job_requisition_criteria_audit WHERE requisition_id = ? ${cursor ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 50`, cursor ? [id, cursor] : [id]);
  return { items: rows, nextCursor: rows.length === 50 ? Number(rows[rows.length - 1].id) : null };
}

/** One version per requisition, only while the version table is empty (idempotent: a second run does nothing). */
export async function backfillCriteriaVersions(): Promise<number> {
  const [c] = await db.execute<RowDataPacket[]>("SELECT COUNT(*) AS n FROM job_requisition_criteria_version");
  if (Number(c[0]?.n ?? 0) > 0) return 0;
  let written = 0, after = "";
  for (;;) {
    const [ids] = await db.execute<RowDataPacket[]>("SELECT id FROM job_requisition WHERE id > ? ORDER BY id LIMIT 500", [after]);
    if (!ids.length) break;
    for (const r of ids) {
      try { if (await recordCriteriaVersion(String(r.id), null, "backfill")) written++; } catch (e) {
        logger.warn({ requisitionId: String(r.id), err: String((e as Error).message).slice(0, 200) }, "[criteria] backfill skipped one requisition");
      }
    }
    after = String(ids[ids.length - 1].id);
  }
  return written;
}
