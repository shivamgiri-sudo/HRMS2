/**
 * Best-offer reads for the follow-up steps (HE_BEST_OFFER). One bounded statement per step run over the selected people's open pipeline
 * rows; nothing is written and no hold is stored. A failed read holds every selected row for this run (never send on uncertainty).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { OFFER_STARTED_SQL, rankOffers, type OfferRow } from "./he-best-offer.js";
import type { FollowupRow } from "./qualified-followup.context.js";
import type { RowTag } from "./qualified-followup.policy.js";

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Open pipeline rows of these people for this tag, keyed by mobile10. Throws on a read error (callers decide how to fail). */
export async function loadOfferRows(mobiles: string[], tag: RowTag): Promise<Map<string, OfferRow[]>> {
  const out = new Map<string, OfferRow[]>();
  const list = [...new Set(mobiles.filter(Boolean))];
  if (!list.length) return out;
  // he_match is unique per (lead, requisition) and he_lead per mobile, so each follow-up row yields one result row.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT qf.id, qf.mobile10, qf.requisition_id, jr.requisition_code, qf.qualified_at,
            ${OFFER_STARTED_SQL} AS started, hm.state = 'declined' AS declined,
            hm.distance_km, hm.score, jr.requested_headcount - jr.fulfilled_headcount AS remaining
       FROM qualified_followup qf
       LEFT JOIN he_lead hl ON hl.mobile10 = qf.mobile10
       LEFT JOIN he_match hm ON hm.lead_id = hl.id AND hm.requisition_id = qf.requisition_id
       LEFT JOIN job_requisition jr ON jr.id = qf.requisition_id COLLATE utf8mb4_unicode_ci
      WHERE qf.mobile10 IN (${list.map(() => "?").join(",")}) AND qf.mode_at_enqueue = ? AND qf.owner = 'pipeline' AND qf.stopped_reason IS NULL`,
    [...list, tag]);
  for (const r of rows) {
    const m = String(r.mobile10);
    const row: OfferRow = {
      rowId: String(r.id),
      requisitionId: String(r.requisition_id),
      requisitionCode: String(r.requisition_code ?? ""),
      qualifiedAt: String(r.qualified_at ?? ""),
      started: Number(r.started) === 1,
      declined: Number(r.declined) === 1,
      distanceKm: n(r.distance_km),
      score: n(r.score),
      headcountRemaining: n(r.remaining),
    };
    const bucket = out.get(m);
    if (bucket) bucket.push(row); else out.set(m, [row]);
  }
  return out;
}

/** Which of the selected rows wait for another offer this run. Never throws: a read error holds them all (`failed: true`). */
export async function offerHolds(rows: FollowupRow[], tag: RowTag): Promise<{ held: Set<string>; failed: boolean }> {
  const held = new Set<string>();
  if (!rows.length) return { held, failed: false };
  try {
    const byMobile = await loadOfferRows(rows.map((r) => r.mobile10), tag);
    for (const list of byMobile.values()) {
      if (list.length < 2) continue;
      for (const d of rankOffers(list)) if (d.held) held.add(d.rowId);
    }
    return { held, failed: false };
  } catch (err) {
    logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[he-best-offer] sibling read failed; selected rows wait for the next run");
    return { held: new Set(rows.map((r) => r.id)), failed: true };
  }
}
