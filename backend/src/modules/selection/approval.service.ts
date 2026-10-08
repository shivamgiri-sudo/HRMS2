// HR approves shortlists; only approved people are enrolled (plan 2026-10-09, S13; S-O5, S-O6).
// A run stores who was picked / in review / overridden for one requisition x source and criteria version. HR approves a run
// (untick removes people; review rows only when named). Live Meta may then get a standing approval (max 7 days) for that same
// criteria version: a pass on arrival enrols at once, a review always waits, and any new criteria version ends it.
// Nothing is enrolled unless policy.shortlist.enrol = 1, the requisition is open, its enrolment mode is hr_approves and its
// criteria are complete enough (S-O6: location, education, shift and age decided).
import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requisitionClosedReason } from "../meta-campaign/lead-screener.service.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { compileCriteria } from "./compile-criteria.js";
import { loadDbRow, toCriteriaRow } from "./criteria-row.js";
import type { EnrolmentPort } from "./enrolment-port.js";
import { evaluate } from "./evaluate.js";
import { istText } from "./facts-loader.service.js";
import { buildFunnel, finalVerdict } from "./funnel.js";
import { loadOverrides, withOverride, type OverrideActor } from "./override.service.js";
import { evaluatePopulation, forRequisition, latestVersionId } from "./preview.service.js";
import { shortlistEnrolOn } from "./selection-switches.js";
import type { CandidateFacts, SourceKind } from "./selection-types.js";

export const APPROVAL_ROLES = ["super_admin", "hr", "recruitment_hr"] as const;
export const STANDING_MAX_DAYS = 7;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
type Ex = (sql: string, p?: unknown[]) => Promise<[unknown, unknown]>;
const ex0: Ex = (sql, p) => db.execute(sql, p as never) as never;
const ph = (n: number) => Array.from({ length: n }, () => "?").join(",");

async function inScope(actor: OverrideActor, requisitionId: string) {
  if (!(await jobRequisitionService.isRequisitionVisible(actor.user, { id: requisitionId }))) throw fail(404, "Requisition not found");
}

/** Open = approved, active, not closed, seats left, and not past its hiring deadline (IST day). */
export async function requisitionState(requisitionId: string, now: Date) {
  const [r] = await db.execute<RowDataPacket[]>(
    "SELECT approval_status, active_status, closed_at, requested_headcount, fulfilled_headcount, requisition_validity, branch_name, designation_name FROM job_requisition WHERE id = ? LIMIT 1", [requisitionId]);
  const s = r[0];
  if (!s) throw fail(404, "Requisition not found");
  const closed = requisitionClosedReason({ approvalStatus: s.approval_status ?? null, activeStatus: s.active_status ?? null, closedAt: s.closed_at ?? null,
    requestedHeadcount: s.requested_headcount == null ? null : Number(s.requested_headcount), fulfilledHeadcount: s.fulfilled_headcount == null ? null : Number(s.fulfilled_headcount) });
  const today = istText(now).slice(0, 10);
  const validity = s.requisition_validity ? String(s.requisition_validity instanceof Date ? istText(s.requisition_validity) : s.requisition_validity).slice(0, 10) : null;
  const notOpen = closed ?? (s.approval_status !== "approved" ? "requisition is not approved" : validity && validity < today ? "requisition is past its hiring deadline" : null);
  return { notOpen, branchName: String(s.branch_name ?? ""), roleName: String(s.designation_name ?? "") };
}

/** The gates every approval and enrolment passes: open, criteria complete (S-O6), enrolment mode on. */
async function gates(requisitionId: string, now: Date) {
  const st = await requisitionState(requisitionId, now);
  if (st.notOpen) throw fail(409, `Not open: ${st.notOpen}`);
  const d = await loadDbRow(ex0, requisitionId);
  if (!d) throw fail(404, "Requisition not found");
  const row = toCriteriaRow(d);
  const c = compileCriteria(row);
  if (!c.completeness.enrolmentReady) throw fail(409, "criteria_incomplete: decide location, education, shift and age (a value or No requirement) before approving");
  if ((row.selectionRules?.enrolment?.mode ?? "off") !== "hr_approves") throw fail(409, "Enrolment is off for this requisition (selection rules: enrolment mode hr_approves)");
  return { ...st, compiled: c };
}

export async function createShortlistRun(a: { requisitionId: string; sourceKind: SourceKind; actor: OverrideActor; now?: Date }) {
  const now = a.now ?? new Date();
  await inScope(a.actor, a.requisitionId);
  const pop = await evaluatePopulation({ requisitionId: a.requisitionId, sourceKind: a.sourceKind, now });
  const fun = buildFunnel(pop.people, pop.compiled);
  const runId = randomUUID();
  await db.execute(`INSERT INTO shortlist_run (id, requisition_id, source_kind, criteria_version_id, criteria_hash, engine_version, counts_json, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [runId, a.requisitionId, a.sourceKind, pop.versionId, pop.compiled.hash, pop.compiled.engineVersion,
      JSON.stringify({ start: pop.people.length, steps: fun.steps.map((s) => [s.key, s.failedHere, s.reviewHere]), outcome: fun.outcome, partial: pop.partial }), a.actor.id]);
  // decision log rule: picked, review and overridden people get a row; plain fails stay counts
  const keep = pop.people.filter(({ e }) => !e.systemBlock && (finalVerdict(e) !== "fail" || e.override));
  const rows = keep.map(({ facts, e }) => {
    const v = finalVerdict(e);
    const status = e.override?.kind === "exclude" ? "excluded" : v === "pass" ? "picked" : "review";
    const review = [...(e.override?.kind === "include" ? [`HR included: ${e.override.reason}`] : []), ...(e.override?.kind === "exclude" ? [`HR excluded: ${e.override.reason}`] : []),
      ...(e.override?.kind === "include" ? [] : e.reviewReasons)];
    const results = [...e.passed, ...e.failed, ...e.unknown].filter((r) => r.mode !== "prefer").map((r) => ({ k: r.key, o: r.outcome, a: r.actualText.slice(0, 120), r: r.requiredText.slice(0, 120) }));
    return [runId, a.requisitionId, facts.personKey, a.sourceKind, facts.subSource, v, e.score, status, pop.versionId, e.engineVersion, JSON.stringify(results),
      review.length ? JSON.stringify(review) : null, e.override?.kind ?? null, e.factsHash];
  });
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await db.execute(`INSERT INTO shortlist_candidate (run_id, requisition_id, mobile10, source_kind, sub_source, verdict, score, status, criteria_version_id, engine_version,
                        rule_results_json, review_json, override_kind, facts_hash) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`, part.flat());
  }
  return { runId, versionId: pop.versionId, outcome: fun.outcome, stored: rows.length, partial: pop.partial };
}

export async function approveBatch(a: { requisitionId: string; sourceKind: SourceKind; runId: string; untick?: string[]; approveReview?: string[]; note?: string | null; actor: OverrideActor; now?: Date }) {
  const now = a.now ?? new Date();
  await inScope(a.actor, a.requisitionId);
  const [runs] = await db.execute<RowDataPacket[]>("SELECT id, requisition_id, source_kind, criteria_version_id FROM shortlist_run WHERE id = ? LIMIT 1", [a.runId]);
  const run = runs[0];
  if (!run || run.requisition_id !== a.requisitionId || run.source_kind !== a.sourceKind) throw fail(404, "Shortlist run not found for this requisition and source");
  await gates(a.requisitionId, now);
  const current = await latestVersionId(a.requisitionId);
  if ((run.criteria_version_id ?? null) !== current) throw fail(409, "criteria changed since this preview; re-run the shortlist");
  const untick = [...new Set(a.untick ?? [])], review = [...new Set(a.approveReview ?? [])];
  const id = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (untick.length) await conn.execute(`UPDATE shortlist_candidate SET status = 'unticked' WHERE run_id = ? AND status = 'picked' AND mobile10 IN (${ph(untick.length)})`, [a.runId, ...untick]);
    const [u] = await conn.execute<ResultSetHeader>(
      `UPDATE shortlist_candidate SET status = 'approved', approval_id = ? WHERE run_id = ? AND (status = 'picked'${review.length ? ` OR (status = 'review' AND mobile10 IN (${ph(review.length)}))` : ""})`,
      [id, a.runId, ...review]);
    const approved = Number(u.affectedRows ?? 0);
    await conn.execute(`INSERT INTO shortlist_approval (id, run_id, requisition_id, source_kind, criteria_version_id, mode, approved_by, approved_count, unticked_json, note)
                        VALUES (?, ?, ?, ?, ?, 'batch', ?, ?, ?, ?)`,
      [id, a.runId, a.requisitionId, a.sourceKind, current, a.actor.id, approved, JSON.stringify(untick), a.note?.slice(0, 300) ?? null]);
    await conn.commit();
    return { approvalId: id, approved, unticked: untick.length };
  } catch (e) { await conn.rollback().catch(() => {}); throw e; } finally { conn.release(); }
}

export async function approveStanding(a: { requisitionId: string; versionId: string; days?: number; actor: OverrideActor; now?: Date }) {
  const now = a.now ?? new Date();
  const days = a.days ?? STANDING_MAX_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > STANDING_MAX_DAYS) throw fail(400, `days must be 1-${STANDING_MAX_DAYS}`);
  await inScope(a.actor, a.requisitionId);
  await gates(a.requisitionId, now);
  if ((await latestVersionId(a.requisitionId)) !== a.versionId) throw fail(409, "criteria changed: a standing approval is only for the current criteria version");
  const [b] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM shortlist_approval WHERE requisition_id = ? AND source_kind = 'meta_live' AND mode = 'batch' AND criteria_version_id = ? AND revoked_at IS NULL LIMIT 1", [a.requisitionId, a.versionId]);
  if (!b[0]) throw fail(409, "Approve a first Live Meta batch for this criteria version before a standing approval");
  const id = randomUUID();
  const until = istText(new Date(now.getTime() + days * 86_400_000));
  await db.execute(`INSERT INTO shortlist_approval (id, run_id, requisition_id, source_kind, criteria_version_id, mode, approved_by, valid_until, approved_count, note)
                    VALUES (?, NULL, ?, 'meta_live', ?, 'standing', ?, ?, 0, ?)`, [id, a.requisitionId, a.versionId, a.actor.id, until, `standing ${days} days`]);
  return { approvalId: id, validUntil: until };
}

export async function revokeStanding(a: { approvalId: string; actor: OverrideActor }) {
  const [r] = await db.execute<RowDataPacket[]>("SELECT requisition_id FROM shortlist_approval WHERE id = ? AND mode = 'standing' LIMIT 1", [a.approvalId]);
  if (!r[0]) throw fail(404, "Standing approval not found");
  await inScope(a.actor, String(r[0].requisition_id));
  await db.execute("UPDATE shortlist_approval SET revoked_at = NOW(), revoked_by = ? WHERE id = ? AND revoked_at IS NULL", [a.actor.id, a.approvalId]);
}

/** A standing approval counts only for the current criteria version: a new version ends it with no write needed. */
export async function standingApprovalFor(requisitionId: string, now: Date): Promise<{ id: string; versionId: string } | null> {
  const v = await latestVersionId(requisitionId);
  if (!v) return null;
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM shortlist_approval WHERE requisition_id = ? AND source_kind = 'meta_live' AND mode = 'standing' AND revoked_at IS NULL
        AND valid_until > ? AND criteria_version_id = ? ORDER BY approved_at DESC LIMIT 1`, [requisitionId, istText(now), v]);
  return r[0] ? { id: String(r[0].id), versionId: v } : null;
}

export async function rejectPeople(a: { requisitionId: string; mobiles: string[]; reason: string; actor: OverrideActor }) {
  const reason = String(a.reason ?? "").trim();
  if (!reason || reason.length > 300) throw fail(400, "A reason (1-300 characters) is required");
  const mobiles = [...new Set(a.mobiles)].filter((m) => /^[6-9]\d{9}$/.test(m));
  if (!mobiles.length || mobiles.length > 500) throw fail(400, "mobiles (1-500 valid mobiles) are required");
  await inScope(a.actor, a.requisitionId);
  const [u] = await db.execute<ResultSetHeader>(
    `UPDATE shortlist_candidate SET status = 'hr_rejected', review_json = JSON_ARRAY(?) WHERE requisition_id = ? AND mobile10 IN (${ph(mobiles.length)})
        AND status IN ('picked', 'review', 'approved', 'unticked')`, [`HR rejected: ${reason}`, a.requisitionId, ...mobiles]);
  return { rejected: Number(u.affectedRows ?? 0) };
}

const SOURCE: Record<SourceKind, "meta_live" | "meta_old" | "he"> = { meta_live: "meta_live", meta_old: "meta_old", he: "he" };
async function cachedFacts(mobile10: string, sourceKind: SourceKind): Promise<CandidateFacts | null> {
  const [r] = await db.execute<RowDataPacket[]>("SELECT facts_json FROM selection_person_fact WHERE mobile10 = ? AND source_kind = ? LIMIT 1", [mobile10, sourceKind]);
  return r[0] ? ((typeof r[0].facts_json === "string" ? JSON.parse(r[0].facts_json) : r[0].facts_json) as CandidateFacts) : null;
}

/** The enrol step: approved rows only, and only with policy.shortlist.enrol = 1 (otherwise approved stays approved, nothing is sent). */
export async function enrolApproved(a: { requisitionId: string; sourceKind: SourceKind; port: EnrolmentPort; now?: Date }) {
  const now = a.now ?? new Date();
  if (!(await shortlistEnrolOn())) return { status: "enrol_switch_off" as const, enrolled: 0 };
  const g = await gates(a.requisitionId, now);
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_id, mobile10, criteria_version_id FROM shortlist_candidate WHERE requisition_id = ? AND source_kind = ? AND status = 'approved' ORDER BY id LIMIT 2000", [a.requisitionId, a.sourceKind]);
  let enrolled = 0;
  for (const r of rows) {
    const f = await cachedFacts(String(r.mobile10), a.sourceKind);
    const out = await a.port.enqueue({ sourceType: SOURCE[a.sourceKind], requisitionId: a.requisitionId, mobile10: String(r.mobile10), fullName: f?.firstName ?? null,
      email: f?.email.quality === "ok" ? String(f.email.value) : null, branchName: g.branchName, roleName: g.roleName,
      originId: String(r.run_id), originLabel: "Approved shortlist", shortlistId: String(r.id), criteriaVersionId: r.criteria_version_id ? String(r.criteria_version_id) : null });
    if (["enqueued", "exists", "promoted", "held"].includes(out.status)) {
      await db.execute("UPDATE shortlist_candidate SET status = 'enrolled' WHERE id = ? AND status = 'approved'", [r.id]);
      enrolled++;
    }
  }
  return { status: "done" as const, enrolled };
}

/** A Live Meta arrival under a standing approval: a pass enrols at once; a review always waits for HR. */
export async function enrolLiveArrival(a: { requisitionId: string; facts: CandidateFacts; port: EnrolmentPort; now?: Date }) {
  const now = a.now ?? new Date();
  if (!(await shortlistEnrolOn())) return { decision: "enrol_switch_off" as const };
  const standing = await standingApprovalFor(a.requisitionId, now);
  if (!standing) return { decision: "no_standing_approval" as const };
  const g = await gates(a.requisitionId, now);
  const f = forRequisition(a.facts, a.requisitionId);
  const e = withOverride(evaluate(f, g.compiled, now), (await loadOverrides(a.requisitionId, [f.personKey])).get(f.personKey));
  const v = finalVerdict(e);
  if (v === "review") return { decision: "review_waits" as const };
  if (v === "fail") return { decision: "not_eligible" as const };
  await db.execute(`INSERT INTO shortlist_candidate (run_id, requisition_id, mobile10, source_kind, sub_source, verdict, score, status, criteria_version_id, engine_version,
                      rule_results_json, review_json, override_kind, facts_hash, approval_id) VALUES (?, ?, ?, 'meta_live', ?, 'pass', ?, 'approved', ?, ?, '[]', NULL, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE id = id`,
    [standing.id, a.requisitionId, f.personKey, f.subSource, e.score, standing.versionId, e.engineVersion, e.override?.kind ?? null, e.factsHash, standing.id]);
  const [r] = await db.execute<RowDataPacket[]>("SELECT id, status FROM shortlist_candidate WHERE run_id = ? AND mobile10 = ? LIMIT 1", [standing.id, f.personKey]);
  if (!r[0] || r[0].status !== "approved") return { decision: "already_enrolled" as const };
  const out = await a.port.enqueue({ sourceType: "meta_live", requisitionId: a.requisitionId, mobile10: f.personKey, fullName: f.firstName ?? null,
    email: f.email.quality === "ok" ? String(f.email.value) : null, branchName: g.branchName, roleName: g.roleName, originId: standing.id, originLabel: "Standing approval",
    shortlistId: String(r[0].id), criteriaVersionId: standing.versionId });
  if (["enqueued", "exists", "promoted", "held"].includes(out.status)) await db.execute("UPDATE shortlist_candidate SET status = 'enrolled' WHERE id = ?", [r[0].id]);
  return { decision: "enrolled" as const, status: out.status };
}
