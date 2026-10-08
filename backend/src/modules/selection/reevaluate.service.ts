// Criteria change after enrolment (plan 2026-10-09, S14; S-O7). No recall of anything sent. On a new criteria version the
// requisition's enrolled people are re-checked and qualified_followup carries the verdict (criteria_version_id / _verdict /
// _checked_at). The follow-up stop checks then stop first contacts for people who now fail (criteria_failed) and hold people now
// in review (criteria_review) until HR releases them; anyone booked for a walk-in continues and is listed for HR to keep or cancel.
// Everything here runs only with SELECTION_FOLLOWUP_GUARD on.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { compileCriteria } from "./compile-criteria.js";
import { loadDbRow, toCriteriaRow } from "./criteria-row.js";
import { evaluate } from "./evaluate.js";
import { loadHePeopleByMobiles } from "./facts-loader.service.js";
import { normaliseFacts } from "./facts-normalise.js";
import { finalVerdict } from "./funnel.js";
import { loadOverrides, withOverride, type OverrideActor } from "./override.service.js";
import { maskMobile } from "./preview.service.js";
import type { CandidateFacts, SourceKind } from "./selection-types.js";

const CHUNK = 500;
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

/** Being in this requisition's own follow-up (or booked for it) is not a reason to fail its criteria. */
function ownJourneyIgnored(f: CandidateFacts, requisitionId: string): CandidateFacts {
  const s = f.system;
  return { ...f, system: { ...s, inOtherJourney: s.inOtherJourney === requisitionId ? null : s.inOtherJourney, bookedFor: s.bookedFor === requisitionId ? null : s.bookedFor } };
}

async function factsByMobile(mobiles: string[], now: Date): Promise<Map<string, CandidateFacts[]>> {
  const out = new Map<string, CandidateFacts[]>();
  if (!mobiles.length) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mobile10, source_kind, facts_json FROM selection_person_fact WHERE mobile10 IN (${mobiles.map(() => "?").join(",")})`, mobiles);
  for (const r of rows) {
    const f = (typeof r.facts_json === "string" ? JSON.parse(r.facts_json) : r.facts_json) as CandidateFacts;
    out.set(String(r.mobile10), [...(out.get(String(r.mobile10)) ?? []), f]);
  }
  const missing = mobiles.filter((m) => !out.has(m));
  for (const p of await loadHePeopleByMobiles(missing, now)) out.set(p.person.mobile, [normaliseFacts(p.person, now)]);
  return out;
}

/**
 * Re-checks every enrolled (not stopped, or held for review) person of the requisition against its current criteria.
 * Serialised per requisition with GET_LOCK; rows already checked against this version are skipped.
 */
export async function reevaluateEnrolled(requisitionId: string, versionId: string, now = new Date()): Promise<{ checked: number; fail: number; review: number; pass: number; noFacts: number } | { skipped: "locked" | "not_found" }> {
  const conn = await db.getConnection();
  const lock = `selection_reeval:${requisitionId}`.slice(0, 64);
  try {
    const [l] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [lock]);
    if (Number(l[0]?.got) !== 1) return { skipped: "locked" };
    const d = await loadDbRow((sql, p) => conn.execute(sql, p as never) as never, requisitionId);
    if (!d) return { skipped: "not_found" };
    const c = compileCriteria(toCriteriaRow(d));
    const counts = { checked: 0, fail: 0, review: 0, pass: 0, noFacts: 0 };
    let after = "";
    for (;;) {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT id, mobile10, source_type, criteria_version_id FROM qualified_followup
          WHERE requisition_id = ? AND (stopped_reason IS NULL OR stopped_reason = 'criteria_review') AND id > ? ORDER BY id LIMIT ${CHUNK}`, [requisitionId, after]);
      if (!rows.length) break;
      const todo = rows.filter((r) => r.criteria_version_id !== versionId);
      const facts = await factsByMobile([...new Set(todo.map((r) => String(r.mobile10)))], now);
      const overrides = await loadOverrides(requisitionId, [...facts.keys()]);
      for (const r of todo) {
        const fs = facts.get(String(r.mobile10)) ?? [];
        if (!fs.length) { counts.noFacts++; continue; }
        const own = fs.find((f) => f.sourceKind === (r.source_type as SourceKind)) ?? fs[0];
        const v = finalVerdict(withOverride(evaluate(ownJourneyIgnored(own, requisitionId), c, now), overrides.get(String(r.mobile10))));
        await conn.execute("UPDATE qualified_followup SET criteria_version_id = ?, criteria_verdict = ?, criteria_checked_at = NOW() WHERE id = ?", [versionId, v, r.id]);
        counts.checked++; counts[v]++;
      }
      if (rows.length < CHUNK) break;
      after = String(rows[rows.length - 1].id);
    }
    return counts;
  } finally {
    await conn.execute("SELECT RELEASE_LOCK(?)", [lock]).catch(() => {});
    conn.release();
  }
}

/** Fire-and-forget after a criteria version with a different hash (never blocks or fails the save). */
export function queueReevaluation(requisitionId: string, versionId: string): void {
  void reevaluateEnrolled(requisitionId, versionId).then((r) => logger.info({ requisitionId, versionId, r }, "[selection] enrolled people re-checked"))
    .catch((e) => logger.warn({ requisitionId, err: String((e as Error).message).slice(0, 200) }, "[selection] re-check after a criteria change failed"));
}

/** HR releases someone held for review: back into the follow-up, due now (unified: releaseHeldManual). */
export async function releaseCriteriaHold(a: { followupId: string; reason: string; actor: OverrideActor }): Promise<boolean> {
  const reason = String(a.reason ?? "").trim();
  if (!reason || reason.length > 300) throw fail(400, "A reason (1-300 characters) is required");
  const [r] = await db.execute<RowDataPacket[]>("SELECT requisition_id FROM qualified_followup WHERE id = ? AND stopped_reason = 'criteria_review' LIMIT 1", [a.followupId]);
  if (!r[0]) throw fail(404, "No follow-up held for criteria review with that id");
  if (!(await jobRequisitionService.isRequisitionVisible(a.actor.user, { id: String(r[0].requisition_id) }))) throw fail(404, "Requisition not found");
  const [u] = await db.execute<RowDataPacket[]>(
    `UPDATE qualified_followup SET stopped_reason = NULL, stopped_at = NULL, criteria_verdict = 'released',
            call_state = IF(call_state = 'skipped', 'pending', call_state),
            email_due_at = IF(email_status IS NULL AND email_due_at IS NOT NULL, NOW(), email_due_at), wa_due_at = IF(wa_status IS NULL, NOW(), wa_due_at)
      WHERE id = ? AND stopped_reason = 'criteria_review'`, [a.followupId]);
  logger.info({ followupId: a.followupId, actor: a.actor.id, reason }, "[selection] criteria hold released by HR");
  return Number((u as unknown as { affectedRows?: number }).affectedRows ?? 0) === 1;
}

/** Booked for a walk-in but no longer meeting the criteria: HR keeps or cancels them by hand. Masked. */
export async function bookedMismatch(a: { requisitionId: string; actor: OverrideActor }) {
  if (!(await jobRequisitionService.isRequisitionVisible(a.actor.user, { id: a.requisitionId }))) throw fail(404, "Requisition not found");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT qf.id, qf.mobile10, qf.full_name, qf.criteria_verdict, qf.criteria_checked_at, m.state, m.slot_at
       FROM qualified_followup qf JOIN he_lead l ON l.mobile10 = qf.mobile10 JOIN he_match m ON m.lead_id = l.id AND m.requisition_id = qf.requisition_id
      WHERE qf.requisition_id = ? AND qf.criteria_verdict IN ('fail', 'review') AND m.state IN ('invited', 'confirmed') AND m.slot_at >= NOW()
      ORDER BY m.slot_at LIMIT 500`, [a.requisitionId]);
  return rows.map((r) => ({ followupId: String(r.id), maskedMobile: maskMobile(String(r.mobile10)), firstName: String(r.full_name ?? "").split(/\s+/)[0] ?? "",
    verdict: String(r.criteria_verdict), checkedAt: r.criteria_checked_at, matchState: String(r.state), slotAt: r.slot_at }));
}
