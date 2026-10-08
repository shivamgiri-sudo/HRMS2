/**
 * Requisition sources read model: per source (live Meta campaign, old-data re-run, Hiring Engine pool) of ONE requisition,
 * how many people reached each stage from lead to joined, plus each source's share of leads and of joined.
 *
 * Stage definitions (per `qualified_followup` row `qf` of the requisition, grouped by `source_type, origin_id`; one row per person and
 * requisition, so first touch holds):
 * - qualified: the row exists (every mode tag).
 * - emailed: qf.email_status = 'sent' or an he_message with lead_id = qf.he_lead_id, requisition_id = qf.requisition_id,
 *   channel = 'email', direction = 'out', delivery_status <> 'failed'.
 * - whatsapped: same with wa_status = 'sent' / channel = 'whatsapp'.
 * - replied: qf.stopped_reason = 'replied', or an he_message direction = 'in' for qf.he_lead_id after qualified_at, or a
 *   meta_lead_messages row direction = 'inbound' for qf.meta_lead_id after qualified_at.
 * - called: qf.call_state = 'called' or an he_call whose match_id is the person's he_match for this requisition.
 * - confirmed / arrived: the person's he_match (lead_id = qf.he_lead_id, same requisition; unique, so no duplication) in
 *   ('confirmed','arrived','selected') / ('arrived','selected').
 * - joined / selected: the drive credit rule of he-drive-credit.ts over the person's he_match and its drive (he_drive by
 *   he_match.drive_id): the match is 'arrived' / 'selected' (arrival proven) AND the joining / selection event is on or after the
 *   drive_date: he_lead.status 'joined' by status_at; ATS stage joined / payroll_validated by a stage log row or the onboarding
 *   joining_date; he_match 'selected' by its updated_at; ATS stage selected / offered / offer / offer_approved / onboarded / converted
 *   by a stage log row. A stage label with no such time is not counted. ATS id COALESCE(qf.ats_candidate_id, he_lead.ats_candidate_id).
 *   (The Plan 2 stop check keeps its own stage-only joined rule: it stops follow-ups, it does not credit a source.)
 * - type of every row (qualified..joined included): the person rule of he-source-attribution.ts (qfTypeKeysSql + PersonFacts for follow-up rows), never
 *   qualified_followup.source_type, so a person sits in exactly one of Live Meta / Old Meta data / Hiring Engine, as in the funnel.
 * - leads: sourcesLeadsSql, one person once per requisition: campaign form fills (origin = campaign; meta_lead_raw with that campaign_id and
 *   requisition_id NULL or this requisition) and people lined up on its drives (origin = stream credit, else the drive for Meta, else the
 *   pool); finally leads = max(leads, qualified) per origin.
 * Origins listed: every origin above, every qualified_followup origin and every stream of the requisition (stream rows carry
 * streamId / streamStatus; an origin with no data shows zeros). Labels: campaign name, run_label, "Pool: ATS history", or the stream's
 * origin_label ("Re-run <drive date>" for a Meta drive with no run_label). Shares: shareOfLeads = leads / sum(leads), shareOfJoined = joined / sum(joined), leadToJoinRate = joined / leads, each 0
 * when the denominator is 0, unrounded fractions.
 *
 * Every query starts from qualified_followup / he_drive / requisition_stream / meta_campaign filtered by requisition (or from
 * meta_lead_raw filtered by campaign_id IN the requisition's campaigns); he_lead is only ever reached by primary key through a JOIN,
 * never scanned. Credit rows can carry an old drive_id, so drives are reached through he_match.drive_id, never requisition_stream_match.
 * No candidate data leaves this module: counts, labels and ids only. A failing sub-query flags its section instead of throwing.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { driveCreditSql } from "./he-drive-credit.js";
import { creditJoinsSql, fillPhoneSql, fillTypeSql, liveFirstFillSql } from "./he-source-attribution.js";
import { PersonFacts, typeKeyColsSql } from "./he-person-facts.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { followupMode } from "./qualified-followup.schedule.js";
import type { FollowupMode, SourceType } from "./qualified-followup.types.js";
import type { StreamStatus } from "./requisition-stream.service.js";

export interface SourceCounts { leads: number; qualified: number; emailed: number; whatsapped: number; replied: number; confirmed: number; called: number; arrived: number; selected: number; joined: number }
export interface SourceRow extends SourceCounts {
  sourceType: SourceType; originId: string; originLabel: string; streamId: string | null; streamStatus: StreamStatus | null;
  shareOfLeads: number; shareOfJoined: number; leadToJoinRate: number;
}
export interface RequisitionSources {
  requisitionId: string; code: string; branch: string; role: string; generatedAt: string; followupMode: FollowupMode;
  rows: SourceRow[]; totals: SourceCounts & { leadToJoinRate: number };
  /** True when a section failed to load: its numbers are zeros and the section name is listed. Never cached. */
  partial: boolean; failedSections: string[];
}

export type RawRow = Omit<SourceRow, "shareOfLeads" | "shareOfJoined" | "leadToJoinRate">;
const COUNT_KEYS: ReadonlyArray<keyof SourceCounts> = ["leads", "qualified", "emailed", "whatsapped", "replied", "confirmed", "called", "arrived", "selected", "joined"];
const TYPE_ORDER: Record<SourceType, number> = { meta_live: 0, meta_old: 1, he: 2 };
const POOL_LABEL = "Pool: ATS history";
const CACHE_MS = 60_000;
const CACHE_MAX = 200;
const ratio = (n: number, d: number): number => (d > 0 ? n / d : 0);
const zero = (): SourceCounts => ({ leads: 0, qualified: 0, emailed: 0, whatsapped: 0, replied: 0, confirmed: 0, called: 0, arrived: 0, selected: 0, joined: 0 });

/** Shares of the whole requisition: each is an unrounded fraction, 0 when its denominator is 0. */
export function computeShares(rows: RawRow[]): SourceRow[] {
  const sumLeads = rows.reduce((a, r) => a + r.leads, 0);
  const sumJoined = rows.reduce((a, r) => a + r.joined, 0);
  return rows.map((r) => ({ ...r, shareOfLeads: ratio(r.leads, sumLeads), shareOfJoined: ratio(r.joined, sumJoined), leadToJoinRate: ratio(r.joined, r.leads) }));
}

// Per qualified_followup row of the requisition: one 0/1 flag per stage, then summed per origin.
// he_lead / ats_candidate / he_match / he_drive are reached by their keys through LEFT JOINs (never scanned; the non-HE tables are compared under an
// explicit utf8mb4_unicode_ci so a table on another collation cannot fail the read); he_message is keyed by
// (requisition_id, lead_id) or lead_id and he_call by lead_id, both indexed.
const CREDIT = driveCreditSql({ m: "m", d: "md", hl: "hl", ac: "ac" });
/** Per-row stage flags of a qualified_followup row `qf` (select-list text, no leading/trailing newline). Shared with the window read model. */
export const STAGE_FLAGS_SQL = `CASE WHEN qf.email_status = 'sent' OR EXISTS (SELECT 1 FROM he_message hm WHERE hm.requisition_id = qf.requisition_id AND hm.lead_id = qf.he_lead_id
                  AND hm.channel = 'email' AND hm.direction = 'out' AND hm.delivery_status <> 'failed') THEN 1 ELSE 0 END AS emailed,
           CASE WHEN qf.wa_status = 'sent' OR EXISTS (SELECT 1 FROM he_message hm WHERE hm.requisition_id = qf.requisition_id AND hm.lead_id = qf.he_lead_id
                  AND hm.channel = 'whatsapp' AND hm.direction = 'out' AND hm.delivery_status <> 'failed') THEN 1 ELSE 0 END AS whatsapped,
           CASE WHEN qf.stopped_reason = 'replied'
                  OR EXISTS (SELECT 1 FROM he_message hi WHERE hi.lead_id = qf.he_lead_id AND hi.direction = 'in' AND hi.created_at > qf.qualified_at)
                  OR EXISTS (SELECT 1 FROM meta_lead_messages mm WHERE mm.lead_id = qf.meta_lead_id COLLATE utf8mb4_unicode_ci AND mm.direction = 'inbound' AND mm.created_at > qf.qualified_at)
                THEN 1 ELSE 0 END AS replied,
           CASE WHEN qf.call_state = 'called' OR (m.id IS NOT NULL AND EXISTS (SELECT 1 FROM he_call c WHERE c.lead_id = m.lead_id AND c.match_id = m.id)) THEN 1 ELSE 0 END AS called,
           CASE WHEN m.state IN ('confirmed','arrived','selected') THEN 1 ELSE 0 END AS confirmed,
           CASE WHEN m.state IN ('arrived','selected') THEN 1 ELSE 0 END AS arrived,
           CASE WHEN ${CREDIT.joined} THEN 1 ELSE 0 END AS joined,
           CASE WHEN ${CREDIT.selected} THEN 1 ELSE 0 END AS selected`;
/** FROM / JOIN part that goes with STAGE_FLAGS_SQL (the caller adds the WHERE). */
export const STAGE_FROM_SQL = `      FROM qualified_followup qf
      LEFT JOIN he_match m ON m.lead_id = qf.he_lead_id AND m.requisition_id = qf.requisition_id
      LEFT JOIN he_drive md ON md.id = m.drive_id AND md.requisition_id = m.requisition_id
      LEFT JOIN he_lead hl ON hl.id = qf.he_lead_id
      LEFT JOIN ats_candidate ac ON ac.id = COALESCE(qf.ats_candidate_id, hl.ats_candidate_id) COLLATE utf8mb4_unicode_ci
      LEFT JOIN he_drive qd ON qd.id = COALESCE(qf.drive_id, m.drive_id)
      LEFT JOIN meta_lead_raw hlf ON hlf.id = COALESCE(hl.meta_lead_id, qf.meta_lead_id) COLLATE utf8mb4_unicode_ci`;
/** The joins qfTypeKeysSql needs on a qualified_followup row `qf` (the stops read); STAGE_FROM_SQL has the same aliases. */
export const QF_TYPE_FROM_SQL = `FROM qualified_followup qf
  LEFT JOIN he_match m ON m.lead_id = qf.he_lead_id AND m.requisition_id = qf.requisition_id
  LEFT JOIN he_lead hl ON hl.id = qf.he_lead_id
  LEFT JOIN he_drive qd ON qd.id = COALESCE(qf.drive_id, m.drive_id)
  LEFT JOIN meta_lead_raw hlf ON hlf.id = COALESCE(hl.meta_lead_id, qf.meta_lead_id) COLLATE utf8mb4_unicode_ci`;
/**
 * A follow-up row typed by the person rule (never by qualified_followup.source_type, the pipeline's enqueue-time type), as row signals for
 * PersonFacts (he-person-facts.service.ts): the person is the he_lead, or the row's own meta_lead_id when not bridged; its drive; at its
 * qualified_at. No stream credit (the follow-up read must not depend on the stream tables); a Meta stream's people are Meta-origin through
 * their form fill anyway. Columns: the lead id, the row's Meta signals, activity on or after the cutoff,
 * and tx: the first-fill verdict of the fill this row stands on when it is not the lead's own first fill (no lead, or a lead without
 * meta_lead_id: then the row's own meta_lead_id fill counts), else NULL (the lead's facts decide).
 */
export const qfTypeKeysSql = (liveFrom: string): string =>
  `${typeKeyColsSql({ streams: false, d: "qd", leadId: "hl.id", ref: "qf.qualified_at", liveFrom, extraMeta: "qf.meta_lead_id IS NOT NULL" })}, `
  + `IF(hl.meta_lead_id IS NULL, ${liveFirstFillSql("hl", "hlf", liveFrom)}, NULL) AS tx`;

const stagesOneSql = (liveFrom: string): string => `
SELECT f.tl, f.tm, f.tr, f.tx, f.origin_id, MAX(f.origin_label) AS origin_label,
       COUNT(*) AS qualified, SUM(f.emailed) AS emailed, SUM(f.whatsapped) AS whatsapped, SUM(f.replied) AS replied, SUM(f.called) AS called,
       SUM(f.confirmed) AS confirmed, SUM(f.arrived) AS arrived, SUM(f.selected) AS selected, SUM(f.joined) AS joined
  FROM (
    SELECT ${qfTypeKeysSql(liveFrom)}, qf.origin_id, qf.origin_label,
           ${STAGE_FLAGS_SQL}
${STAGE_FROM_SQL}
     WHERE qf.requisition_id = ?
  ) f
 GROUP BY f.tl, f.tm, f.tr, f.tx, f.origin_id`;

const SEP = "CHAR(31)";
/**
 * Leads per origin with ONE origin and ONE type per person and requisition (the same person rule as the funnel, he-source-attribution.ts):
 * campaign form fills (origin = campaign) and people lined up on drives (origin = stream credit, else the drive for Meta, else the pool).
 * A person counted under a campaign and on a re-run drive is counted once: the most-Meta type wins, then stream > campaign > drive > pool.
 * The statement returns per person (pkey: a hash of the mobile, never the mobile) the best campaign key of their fills (typed in SQL, as the
 * key `<4 - type rank><priority> SEP campaign SEP id SEP label`) and one row per line-up with its person signals; sourcesLeadsRows types the
 * line-ups with PersonFacts and picks the same key in JS.
 * `bounded`: fills imported and drives dated in the window (params: ids, bounds, ids, dates; fills by idx_ml_created, forced: the
 * campaign index would read every fill of the campaign, with its payload); otherwise all time (params: ids, ids).
 */
export const sourcesLeadsSql = (n: number, liveFrom: string, bounded: boolean): string => {
  const ids = Array(n).fill("?").join(",");
  const CI = "COLLATE utf8mb4_unicode_ci";
  return `
SELECT 'f' AS src, MD5(f.person) AS pkey, f.requisition_id, MAX(CONCAT(4 - f.ft, 3, ${SEP}, 'campaign', ${SEP}, f.campaign_id, ${SEP}, COALESCE(f.campaign_name, ''))) ${CI} AS fkey,
       NULL AS tl, NULL AS tm, NULL AS tr, NULL AS sid, NULL AS so_id, NULL AS so_label, NULL AS drive_id, NULL AS dlabel
  FROM (SELECT ${fillPhoneSql("r")} ${CI} AS person, mc.requisition_id ${CI} AS requisition_id, FIELD(${fillTypeSql("r", liveFrom)}, 'meta_live', 'meta_old', 'he') AS ft,
               mc.id AS campaign_id, mc.campaign_name
          FROM ${bounded ? `meta_lead_raw r FORCE INDEX (idx_ml_created) STRAIGHT_JOIN meta_campaign mc ON mc.id = r.campaign_id ${CI}` : `meta_campaign mc JOIN meta_lead_raw r ON r.campaign_id = mc.id ${CI}`}
         WHERE mc.requisition_id IN (${ids}) AND (r.requisition_id IS NULL OR r.requisition_id = mc.requisition_id) AND r.parsed_phone IS NOT NULL${bounded ? `
           AND r.created_at >= ? AND r.created_at < ?` : ""}) f
 WHERE f.person IS NOT NULL AND f.person <> ''
 GROUP BY pkey, f.requisition_id
UNION ALL
SELECT 'l', MD5(al.mobile10 ${CI}), d.requisition_id ${CI}, NULL,
       ${typeKeyColsSql({ streams: true, d: "d", leadId: "m.lead_id", ref: "d.drive_date", liveFrom })},
       rs.id, rs.origin_id, COALESCE(rs.origin_label, ''), d.id, COALESCE(d.run_label, CONCAT('Re-run ', DATE_FORMAT(d.drive_date, '%Y-%m-%d')))
  FROM he_drive d JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  ${creditJoinsSql({ streams: true, match: "m", requisition: "d.requisition_id" })}
  JOIN he_lead al ON al.id = m.lead_id
 WHERE d.requisition_id IN (${ids})${bounded ? " AND d.drive_date BETWEEN ? AND ?" : ""} AND al.mobile10 IS NOT NULL AND al.mobile10 <> ''`;
};

const KEY_SEP = String.fromCharCode(31);
/**
 * The rows of sourcesLeadsSql typed and counted: per person and requisition the greatest key among their campaign fills and their typed
 * line-ups (exactly the key the SQL MAX picked when it typed each row), its origin, and the most-Meta type; then leads per requisition,
 * type and origin (label: the greatest). Rows that are already counts (no `src`) pass through.
 */
export function sourcesLeadsRows(rows: RowDataPacket[], facts: PersonFacts): Array<Record<string, unknown>> {
  if (!rows.length || rows[0].src === undefined) return rows;
  const best = new Map<string, { req: string; key: string; rank: number }>();
  const offer = (pkey: string, req: string, key: string): void => {
    const k = `${pkey}|${req}`;
    const rank = 4 - Number(key[0]);
    const b = best.get(k);
    if (!b) { best.set(k, { req, key, rank }); return; }
    if (key > b.key) b.key = key;
    if (rank < b.rank) b.rank = rank;
  };
  for (const r of rows) {
    const pkey = String(r.pkey), req = String(r.requisition_id);
    if (r.src === "f") { if (r.fkey != null) offer(pkey, req, String(r.fkey)); continue; }
    const t = facts.typeOf(r);
    const rank = t === "meta_live" ? 1 : t === "meta_old" ? 2 : 3;
    const stream = r.sid != null;
    const [prio, kind, id, label] = stream ? [4, "stream", String(r.so_id), String(r.so_label ?? "")]
      : t === "he" ? [1, "pool", "pool", POOL_LABEL] : [2, "drive", String(r.drive_id), String(r.dlabel ?? "")];
    offer(pkey, req, `${4 - rank}${prio}${KEY_SEP}${kind}${KEY_SEP}${id}${KEY_SEP}${label}`);
  }
  const out = new Map<string, { requisition_id: string; source_type: SourceType; origin_kind: string; origin_id: string; origin_label: string; leads: number }>();
  const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
  for (const b of best.values()) {
    const [, kind, id, label] = b.key.split(KEY_SEP);
    const t = TYPES[b.rank - 1];
    const k = `${b.req}|${t}|${kind}|${id}`;
    const o = out.get(k);
    if (o) { o.leads += 1; if (label > o.origin_label) o.origin_label = label; }
    else out.set(k, { requisition_id: b.req, source_type: t, origin_kind: kind, origin_id: id, origin_label: label, leads: 1 });
  }
  return [...out.values()];
}

const STREAMS_SQL = "SELECT id, source_type, origin_id, origin_label, status FROM requisition_stream WHERE requisition_id = ?";
const CAMPAIGNS_SQL = "SELECT id, campaign_name FROM meta_campaign WHERE requisition_id = ?";
const HEADER_SQL = "SELECT requisition_code, branch_name, designation_name FROM job_requisition WHERE id = ? LIMIT 1";

interface Cell extends RawRow { _labelRank: number }
const keyOf = (t: string, o: string): string => `${t}|${o}`;

export async function readSection<T>(name: string, failed: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err) {
    failed.push(name);
    // Never the driver message (it can echo SQL and values): only the section and the error code.
    logger.error({ section: name, code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-sources] section failed");
    return fallback;
  }
}

async function build(requisitionId: string, head: { code: string; branch: string; role: string }): Promise<RequisitionSources> {
  const failed: string[] = [];
  const liveFrom = await loadLiveFrom();
  const personFacts = new PersonFacts(liveFrom);
  const cells = new Map<string, Cell>();
  const cell = (t: SourceType, o: string, label: string, rank: number): Cell => {
    const k = keyOf(t, o);
    let c = cells.get(k);
    if (!c) { c = { sourceType: t, originId: o, originLabel: label, streamId: null, streamStatus: null, ...zero(), _labelRank: rank }; cells.set(k, c); }
    if (rank > c._labelRank && label) { c.originLabel = label; c._labelRank = rank; }
    return c;
  };

  const [streams, stages, matchLeads, campaigns] = await Promise.all([
    readSection("streams", failed, async () => (await db.execute<RowDataPacket[]>(STREAMS_SQL, [requisitionId]))[0], [] as RowDataPacket[]),
    readSection("stages", failed, async () => (await db.execute<RowDataPacket[]>(stagesOneSql(liveFrom), [requisitionId]))[0], [] as RowDataPacket[]),
    readSection("driveLeads", failed, async () => {
      const rows = (await db.execute<RowDataPacket[]>(sourcesLeadsSql(1, liveFrom, false), [requisitionId, requisitionId]))[0];
      await personFacts.loadRows(rows);
      return sourcesLeadsRows(rows, personFacts) as RowDataPacket[];
    }, [] as RowDataPacket[]),
    readSection("campaigns", failed, async () => (await db.execute<RowDataPacket[]>(CAMPAIGNS_SQL, [requisitionId]))[0], [] as RowDataPacket[]),
  ]);
  // Label precedence: qualified_followup text (1) < stream label (2) < campaign name / run_label / pool label (3).
  for (const s of streams) {
    const c = cell(String(s.source_type) as SourceType, String(s.origin_id), String(s.origin_label ?? ""), 2);
    c.streamId = String(s.id); c.streamStatus = String(s.status) as StreamStatus;
  }
  await readSection("stages", failed, () => personFacts.loadRows(stages), undefined);
  // Rows come per person signal group, so one origin can get several: counts add and the label is the greatest of them (what
  // MAX(origin_label) gave when the SQL grouped by type).
  for (const r of stages) {
    const label = String(r.origin_label ?? "");
    const c = cell(personFacts.typeOf(r), String(r.origin_id), label, 1);
    if (c._labelRank === 1 && label > c.originLabel) c.originLabel = label;
    for (const k of COUNT_KEYS) if (k !== "leads") c[k] += Number(r[k] ?? 0); // += : a second row for one origin adds, never overwrites
  }
  for (const c of campaigns) cell("meta_live", String(c.id), String(c.campaign_name ?? ""), 3);
  // One origin and one type per person (sourcesLeadsSql): a campaign fill and a re-run line-up of the same person count once.
  for (const r of matchLeads) {
    const c = cell(String(r.source_type) as SourceType, String(r.origin_id), String(r.origin_label ?? ""), 3);
    c.leads += Number(r.leads ?? 0);
  }

  const raw: RawRow[] = [...cells.values()].map(({ _labelRank, ...c }) => {
    void _labelRank;
    return { ...c, leads: Math.max(c.leads, c.qualified) };
  });
  raw.sort((a, b) => TYPE_ORDER[a.sourceType] - TYPE_ORDER[b.sourceType] || b.leads - a.leads || a.originLabel.localeCompare(b.originLabel) || a.originId.localeCompare(b.originId));
  const rows = computeShares(raw);
  const totals = { ...zero(), leadToJoinRate: 0 };
  for (const r of rows) for (const k of COUNT_KEYS) totals[k] += r[k];
  totals.leadToJoinRate = ratio(totals.joined, totals.leads);
  let mode: FollowupMode = "off";
  try { mode = followupMode(); } catch { failed.push("mode"); }
  return { requisitionId, ...head, generatedAt: new Date().toISOString(), followupMode: mode, rows, totals, partial: failed.length > 0, failedSections: failed };
}

const cache = new Map<string, { at: number; data: RequisitionSources }>();
const scopeKey = (s: BranchScope): string => (s.all ? "all" : `b:${s.branchName ?? ""}`);
/** Test hook. */
export function clearRequisitionSourcesCache(): void { cache.clear(); }

/** Null when the requisition does not exist or is outside the caller's scope. The scope check runs before the cache is read. */
export async function getRequisitionSources(requisitionId: string, scope: BranchScope): Promise<RequisitionSources | null> {
  const [h] = await db.execute<RowDataPacket[]>(HEADER_SQL, [requisitionId]);
  const row = h[0];
  if (!row) return null;
  const branch = String(row.branch_name ?? "");
  if (!scope.all && !(scope.branchName != null && scope.branchName === branch)) return null;
  const key = `${requisitionId}|${scopeKey(scope)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  if (hit) cache.delete(key);
  const data = await build(requisitionId, { code: String(row.requisition_code ?? ""), branch, role: String(row.designation_name ?? "") });
  if (!data.partial) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), data });
  }
  return data;
}
