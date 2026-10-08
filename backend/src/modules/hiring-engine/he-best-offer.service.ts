/**
 * Best-offer reads for the follow-up steps (HE_BEST_OFFER). One bounded statement per step run over the selected people's open pipeline
 * rows; nothing is written and no hold is stored. A failed read holds every selected row for this run (never send on uncertainty).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { heldOffers, OFFER_STARTED_SQL, rankOffers, type OfferRow, type OfferWhy } from "./he-best-offer.js";
import { readSwitches, rowTag } from "./qualified-followup.policy.js";
import { maskMobile } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";
import { valueAddOn } from "./he-valueadd-switches.js";
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
    `SELECT qf.id, qf.mobile10, qf.requisition_id, qf.source_type, jr.requisition_code, qf.qualified_at,
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
      sourceType: r.source_type == null ? undefined : String(r.source_type),
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

/**
 * Which of the selected rows are skipped this run. Never throws: a read error holds them all (`failed: true`). Siblings from a paused source
 * are ignored (they cannot start, so they must not hold anyone); a selected row whose requisition the candidate declined is skipped too.
 */
export async function offerHolds(rows: FollowupRow[], tag: RowTag, pausedSources: Iterable<string> = []): Promise<{ held: Set<string>; failed: boolean }> {
  const held = new Set<string>();
  if (!rows.length) return { held, failed: false };
  const paused = new Set(pausedSources);
  try {
    const byMobile = await loadOfferRows(rows.map((r) => r.mobile10), tag);
    for (const all of byMobile.values()) {
      for (const r of all) if (r.declined) held.add(r.rowId);
      const list = all.filter((r) => !(r.sourceType && paused.has(r.sourceType)));
      if (list.length < 2) continue;
      for (const d of rankOffers(list)) if (d.held) held.add(d.rowId);
    }
    return { held, failed: false };
  } catch (err) {
    logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[he-best-offer] sibling read failed; selected rows wait for the next run");
    return { held: new Set(rows.map((r) => r.id)), failed: true };
  }
}

/** ` AND qf.id NOT IN (?,?)` for the backfill select (ids are bound parameters). */
export const notInIdsSql = (ids: string[]): string => ` AND qf.id NOT IN (${ids.map(() => "?").join(",")})`;

/**
 * Switch-on selection for a step: holds apply after the step's LIMIT, so each held row would waste a slot. When some are held, ONE backfill
 * select (the step's own predicates and order, excluding every id already selected, LIMIT = slots freed) refills them and the holds are
 * evaluated once more on the merged set. `slots` caps the refill (WhatsApp: the daily budget already bounds the LIMIT, so the merged set
 * never exceeds the original take). A failed read holds everything and backfills nothing.
 */
export async function selectWithOfferHolds(
  rows: FollowupRow[], tag: RowTag, pausedSources: Iterable<string>,
  backfill: (excludeIds: string[], limit: number) => Promise<FollowupRow[]>,
): Promise<{ rows: FollowupRow[]; held: Set<string> }> {
  const first = await offerHolds(rows, tag, pausedSources);
  if (first.failed || first.held.size === 0) return { rows, held: first.held };
  const freed = rows.reduce((n, r) => n + (first.held.has(r.id) ? 1 : 0), 0);
  const more = freed > 0 ? await backfill(rows.map((r) => r.id), freed) : [];
  const fresh = more.filter((m) => !rows.some((r) => r.id === m.id));
  if (!fresh.length) return { rows, held: first.held };
  const merged = [...rows, ...fresh];
  const second = await offerHolds(merged, tag, pausedSources);
  return { rows: merged, held: second.held };
}

// ---- held list (read-only, Follow-up panel) ----------------------------------------------------------------------------------------------
export interface HeldOffer {
  id: string; name: string | null; mobileMasked: string; requisitionId: string; requisitionCode: string; sourceType: SourceType;
  status: "held_other_offer"; heldFor: { requisitionCode: string; why: OfferWhy }; qualifiedAt: string;
}
export interface HeldOffers { enabled: boolean; rows: HeldOffer[]; truncated: boolean; partial: boolean }

const HELD_MAX = 500;
const HELD_CACHE_MS = 60_000;
const heldCache = new Map<string, { at: number; data: HeldOffers }>();
export function clearHeldOffersCache(): void { heldCache.clear(); }
// DATETIME strings are IST wall-clock (pool has dateStrings): give them an explicit offset so the browser reads the right instant.
const iso = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString();
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? `${s.replace(" ", "T")}+05:30` : s;
};

/**
 * Held rows of the current tag: open pipeline rows whose person has another open row, ranked by the same rules as the sends (loadOfferRows +
 * heldOffers). Branch scope applies to the held row. Never throws: a read error gives an empty, partial result (not cached).
 */
export async function listHeldOffers(scope: BranchScope, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<HeldOffers> {
  const off: HeldOffers = { enabled: false, rows: [], truncated: false, partial: false };
  if (!valueAddOn("best_offer", env)) return off;
  const tag = rowTag(readSwitches(env));
  if (!tag) return off;
  const empty: HeldOffers = { enabled: true, rows: [], truncated: false, partial: false };
  if (!scope.all && !scope.branchName) return empty;
  const key = `${tag}|${scope.all ? "all" : `b:${scope.branchName}`}`;
  const hit = heldCache.get(key);
  if (hit && now - hit.at < HELD_CACHE_MS) return structuredClone(hit.data);
  try {
    const [cand] = await db.execute<RowDataPacket[]>(
      `SELECT qf.id, qf.full_name, qf.mobile10, qf.requisition_id, qf.source_type, qf.qualified_at
         FROM qualified_followup qf
        WHERE qf.mode_at_enqueue = ? AND qf.owner = 'pipeline' AND qf.stopped_reason IS NULL${scope.all ? "" : " AND qf.branch_name = ? COLLATE utf8mb4_unicode_ci"}
          AND EXISTS (SELECT 1 FROM qualified_followup o WHERE o.mobile10 = qf.mobile10 AND o.id <> qf.id AND o.mode_at_enqueue = qf.mode_at_enqueue AND o.owner = 'pipeline' AND o.stopped_reason IS NULL)
        ORDER BY qf.qualified_at, qf.id LIMIT ${HELD_MAX + 1}`,
      scope.all ? [tag] : [tag, scope.branchName]);
    const truncated = cand.length > HELD_MAX;
    const shown = truncated ? cand.slice(0, HELD_MAX) : cand;
    const byMobile = await loadOfferRows(shown.map((r) => String(r.mobile10)), tag);
    const held = new Map(heldOffers(byMobile).map((h) => [h.rowId, h]));
    const rows: HeldOffer[] = [];
    for (const r of shown) {
      const h = held.get(String(r.id));
      if (!h) continue;
      rows.push({
        id: String(r.id), name: r.full_name ?? null, mobileMasked: maskMobile(String(r.mobile10 ?? "")), requisitionId: String(r.requisition_id),
        requisitionCode: h.requisitionCode, sourceType: r.source_type as SourceType, status: "held_other_offer",
        heldFor: { requisitionCode: h.bestRequisitionCode, why: h.why }, qualifiedAt: iso(r.qualified_at),
      });
    }
    const data: HeldOffers = { enabled: true, rows, truncated, partial: false };
    for (const [k, v] of heldCache) if (now - v.at >= HELD_CACHE_MS) heldCache.delete(k);
    if (heldCache.size >= 50) heldCache.delete(heldCache.keys().next().value as string);
    heldCache.set(key, { at: now, data: structuredClone(data) });
    return data;
  } catch (err) {
    logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[he-best-offer] held list read failed");
    return { enabled: true, rows: [], truncated: false, partial: true };
  }
}
