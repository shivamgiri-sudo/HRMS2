// Read models for the selection screens (S15-S20): requisition lists with completeness, a campaign's requisitions, and the
// approve-bar state. Batched reads (one statement per family, never per row). Reads only.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { approvalBlocker } from "./approval.service.js";
import { compileCriteria } from "./compile-criteria.js";
import { LOAD_ROW_SQL, toCriteriaRow } from "./criteria-row.js";
import { istText } from "./facts-loader.service.js";
import { permissionsFor, type SelectionPermissions } from "./selection-roles.js";
import type { Completeness, RuleKey, SourceKind } from "./selection-types.js";
import { maskMobile } from "./preview.service.js";
import { openRequisitionsInScope } from "./why-not.service.js";
import { linkedRequisitionIds } from "../meta-campaign/campaign-requisition.service.js";

export { permissionsFor };
type User = NonNullable<AuthenticatedRequest["authUser"]>;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

export interface RequisitionCriteriaItem {
  id: string; code: string; branch: string; process: string | null; designation: string | null; approvalStatus: string | null;
  completeness: Completeness; legacy: boolean; undecided: RuleKey[];
  /** Rules acting as MUST only because HR has not decided them (unknown -> review). */
  defaultedMust: RuleKey[];
  version: { versionNo: number; at: string; by: string | null; source: string } | null;
}

async function summaries(ids: string[]): Promise<RequisitionCriteriaItem[]> {
  if (!ids.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(LOAD_ROW_SQL.replace("WHERE jr.id = ? LIMIT 1", `WHERE jr.id IN (${ph(ids.length)})`), ids);
  let versions: RowDataPacket[] = [];
  try {
    [versions] = await db.execute<RowDataPacket[]>(
      `SELECT v.requisition_id, v.version_no, v.created_at, v.created_by, v.source FROM job_requisition_criteria_version v
         JOIN (SELECT requisition_id, MAX(version_no) AS m FROM job_requisition_criteria_version WHERE requisition_id IN (${ph(ids.length)}) GROUP BY requisition_id) x
           ON x.requisition_id = v.requisition_id AND x.m = v.version_no`, ids);
  } catch { versions = []; }
  const vBy = new Map(versions.map((v) => [String(v.requisition_id), v]));
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  return ids.filter((id) => byId.has(id)).map((id) => {
    const d = byId.get(id)!;
    const c = compileCriteria(toCriteriaRow(d));
    const v = vBy.get(id);
    return {
      id, code: String(d.requisition_code ?? ""), branch: String(d.branch_name ?? ""), process: d.process_name ?? null, designation: d.designation_name ?? null,
      approvalStatus: d.approval_status ?? null, completeness: c.completeness, legacy: c.legacy, undecided: c.undecided,
      defaultedMust: [...new Set(c.rules.filter((r) => r.defaulted && r.mode === "must").map((r) => r.key))],
      version: v ? { versionNo: Number(v.version_no), at: String(v.created_at), by: v.created_by ? String(v.created_by) : null, source: String(v.source) } : null,
    };
  });
}

/** Open requisitions in the caller's scope (the Command Center "Selection criteria" section). */
export async function listCriteriaRequisitions(user: User, o: { onlyIncomplete?: boolean }): Promise<{ items: RequisitionCriteriaItem[]; permissions: SelectionPermissions }> {
  const items = await summaries(await openRequisitionsInScope(user));
  return { items: o.onlyIncomplete ? items.filter((i) => i.completeness.label !== "complete") : items, permissions: permissionsFor(String(user.role ?? "")) };
}

/** Every requisition a campaign points at: its own row and the sibling rows of the same Meta campaign (multi-requisition campaigns). */
export async function campaignRequisitions(user: User, campaignId: string): Promise<{ items: RequisitionCriteriaItem[]; permissions: SelectionPermissions }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT mc.requisition_id FROM meta_campaign mc
      WHERE mc.requisition_id IS NOT NULL AND (mc.id = ? OR (mc.meta_campaign_id IS NOT NULL AND mc.meta_campaign_id = (SELECT x.meta_campaign_id FROM meta_campaign x WHERE x.id = ? LIMIT 1)))`,
    [campaignId, campaignId]);
  // WS3 A2: plus the campaign's own links (many requisitions per campaign); absent before migration 2142.
  const linked = await linkedRequisitionIds(campaignId).catch(() => [] as string[]);
  const all = [...new Set([...linked, ...rows.map((r) => String(r.requisition_id)).filter(Boolean)])];
  const ids: string[] = [];
  for (const id of all) if (await jobRequisitionService.isRequisitionVisible(user, { id })) ids.push(id);
  return { items: await summaries(ids), permissions: permissionsFor(String(user.role ?? "")) };
}

/** What the approve bar shows: the last run and its counts, the current version, why approval is blocked, standing approvals. */
export async function approvalState(user: User, requisitionId: string, sourceKind: SourceKind, now = new Date()) {
  if (!(await jobRequisitionService.isRequisitionVisible(user, { id: requisitionId }))) throw fail(404, "Requisition not found");
  const read = async (sql: string, p: unknown[]) => { try { return (await db.execute<RowDataPacket[]>(sql, p))[0]; } catch { return [] as RowDataPacket[]; } };
  const [cur] = await read("SELECT id, version_no FROM job_requisition_criteria_version WHERE requisition_id = ? ORDER BY version_no DESC LIMIT 1", [requisitionId]);
  const [run] = await read("SELECT id, criteria_version_id, created_at, created_by FROM shortlist_run WHERE requisition_id = ? AND source_kind = ? ORDER BY created_at DESC LIMIT 1", [requisitionId, sourceKind]);
  const counts: Record<string, number> = {};
  if (run) for (const r of await read("SELECT status, COUNT(*) AS n FROM shortlist_candidate WHERE run_id = ? GROUP BY status", [run.id])) counts[String(r.status)] = Number(r.n);
  const standing = await read(
    "SELECT id, valid_until, criteria_version_id, approved_by, approved_at FROM shortlist_approval WHERE requisition_id = ? AND mode = 'standing' AND revoked_at IS NULL AND valid_until > ?",
    [requisitionId, istText(now)]);
  const drift = !!run && (run.criteria_version_id ?? null) !== (cur?.id ?? null);
  const gate = await approvalBlocker(requisitionId, now);
  return {
    lastRun: run ? { runId: String(run.id), at: String(run.created_at), versionId: run.criteria_version_id ?? null, counts } : null,
    currentVersion: cur ? { id: String(cur.id), versionNo: Number(cur.version_no) } : null,
    drift, blocker: gate ?? (drift ? "criteria changed since the last run; run the shortlist again" : null),
    standing: standing.map((s) => ({ id: String(s.id), validUntil: String(s.valid_until), versionId: s.criteria_version_id ?? null, approvedBy: String(s.approved_by), approvedAt: String(s.approved_at) })),
    permissions: permissionsFor(String(user.role ?? "")),
  };
}

/** The people of one shortlist run for the approve bar's untick list: masked mobile and an opaque row id (never the full mobile). */
export async function runCandidates(user: User, runId: string) {
  const [runs] = await db.execute<RowDataPacket[]>("SELECT requisition_id, source_kind FROM shortlist_run WHERE id = ? LIMIT 1", [runId]);
  const run = runs[0];
  if (!run || !(await jobRequisitionService.isRequisitionVisible(user, { id: String(run.requisition_id) }))) throw fail(404, "Shortlist run not found");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, mobile10, sub_source, verdict, score, status, review_json FROM shortlist_candidate
      WHERE run_id = ? AND status IN ('picked', 'review', 'unticked', 'approved') ORDER BY FIELD(status, 'picked', 'review', 'unticked', 'approved'), score DESC LIMIT 500`, [runId]);
  const list = (v: unknown): string[] => { const x = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v; return Array.isArray(x) ? x.map(String).slice(0, 3) : []; };
  return {
    requisitionId: String(run.requisition_id),
    items: rows.map((r) => ({ id: String(r.id), maskedMobile: maskMobile(String(r.mobile10)), subSource: String(r.sub_source), verdict: String(r.verdict), score: Number(r.score), status: String(r.status), reasons: list(r.review_json) })),
  };
}

/** Row ids of one run to mobiles (server side only), for untick / approve-review by id. */
export async function candidateMobiles(runId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT id, mobile10 FROM shortlist_candidate WHERE run_id = ? AND id IN (${ph(ids.length)})`, [runId, ...ids]);
  return rows.map((r) => String(r.mobile10));
}
