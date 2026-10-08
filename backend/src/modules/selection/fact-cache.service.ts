// selection_person_fact: the facts cache the preview reads (plan 2026-10-09, S9). One row per person and source kind;
// refreshed in chunks; facts_json is rewritten only when facts_hash changes. Facts only, never criteria (review focus 1).
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { canonicalJson, sha256 } from "./compile-criteria.js";
import { normaliseFacts } from "./facts-normalise.js";
import { istText, loadMetaLeadFacts, loadRawPeople } from "./facts-loader.service.js";
import type { CandidateFacts, SourceKind, SubSource } from "./selection-types.js";

export const factsHashOf = (f: CandidateFacts) => sha256(canonicalJson(f));

export async function refreshFactCache(o: { sourceKind: SourceKind; chunk?: number; now?: Date; subSources?: SubSource[]; liveFrom?: string; maxChunks?: number }) {
  const now = o.now ?? new Date();
  const runAt = istText(now);
  const chunk = Math.max(1, Math.min(o.chunk ?? 2000, 5000));
  let after: string | undefined, chunks = 0, people = 0, skippedInvalidMobile = 0;
  for (;;) {
    if (o.maxChunks && chunks >= o.maxChunks) break;
    const r = await loadRawPeople({ sourceKind: o.sourceKind, subSources: o.subSources, afterKey: after, limit: chunk, liveFrom: o.liveFrom }, now);
    skippedInvalidMobile += r.skippedInvalidMobile;
    // the newest record wins when one person appears twice in a chunk (Meta: several form fills)
    const byPerson = new Map<string, unknown[]>();
    for (const { person, sourceRef } of r.people) {
      const f = normaliseFacts(person, now);
      byPerson.set(f.personKey, [f.personKey, o.sourceKind, f.subSource, sourceRef, JSON.stringify(f), factsHashOf(f), runAt]);
    }
    if (byPerson.size) {
      const rows = [...byPerson.values()];
      await db.execute(
        `INSERT INTO selection_person_fact (mobile10, source_kind, sub_source, source_ref, facts_json, facts_hash, refreshed_at)
         VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}
         ON DUPLICATE KEY UPDATE sub_source = VALUES(sub_source), source_ref = VALUES(source_ref),
           facts_json = IF(facts_hash = VALUES(facts_hash), facts_json, VALUES(facts_json)), facts_hash = VALUES(facts_hash), refreshed_at = VALUES(refreshed_at)`,
        rows.flat());
      chunks++;
      people += r.people.length;
    }
    if (!r.nextKey) break;
    after = r.nextKey;
  }
  // a complete, unfiltered run: anyone not seen this time has left the source
  let removed = 0;
  if (!o.subSources?.length && !(o.maxChunks && chunks >= o.maxChunks)) {
    for (;;) {
      const [d] = await db.execute<ResultSetHeader>("DELETE FROM selection_person_fact WHERE source_kind = ? AND refreshed_at < ? LIMIT 5000", [o.sourceKind, runAt]);
      const n = Number((d as ResultSetHeader | undefined)?.affectedRows ?? 0);
      removed += n;
      if (n < 5000) break;
    }
  }
  return { sourceKind: o.sourceKind, chunks, people, removed, skippedInvalidMobile };
}

export async function readFactCache(o: { sourceKind: SourceKind; subSources?: SubSource[]; afterKey?: string; limit: number }) {
  const limit = Math.max(1, Math.min(o.limit, 5000));
  const subs = o.subSources ?? [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT mobile10, sub_source, facts_json, facts_hash, refreshed_at FROM selection_person_fact FORCE INDEX (idx_spf_source)
      WHERE source_kind = ? AND mobile10 > ?${subs.length ? ` AND sub_source IN (${subs.map(() => "?").join(",")})` : ""}
      ORDER BY mobile10 LIMIT ?`, [o.sourceKind, o.afterKey ?? "", ...subs, limit]);
  return {
    rows: rows.map((r) => ({ mobile10: String(r.mobile10), subSource: r.sub_source as SubSource, factsHash: String(r.facts_hash), refreshedAt: r.refreshed_at,
      facts: (typeof r.facts_json === "string" ? JSON.parse(r.facts_json) : r.facts_json) as CandidateFacts })),
    nextKey: rows.length === limit ? String(rows[rows.length - 1].mobile10) : null,
  };
}

/** Live Meta arrivals (the D4 worker): each lead's facts into the cache before an arrival preview, newest record winning. Bounded by the caller. */
export async function cacheMetaLeadFacts(ids: string[], now = new Date()): Promise<number> {
  const runAt = istText(now);
  let n = 0;
  for (const id of ids) {
    const f = await loadMetaLeadFacts(id, now);
    if (!f) continue;
    await db.execute(
      `INSERT INTO selection_person_fact (mobile10, source_kind, sub_source, source_ref, facts_json, facts_hash, refreshed_at) VALUES (?, 'meta_live', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE sub_source = VALUES(sub_source), source_ref = VALUES(source_ref),
         facts_json = IF(facts_hash = VALUES(facts_hash), facts_json, VALUES(facts_json)), facts_hash = VALUES(facts_hash), refreshed_at = VALUES(refreshed_at)`,
      [f.personKey, f.subSource, id, JSON.stringify(f), factsHashOf(f), runAt]);
    n++;
  }
  return n;
}
