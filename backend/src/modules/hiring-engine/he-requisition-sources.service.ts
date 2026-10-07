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
 * - joined: he_lead.status = 'joined' or LOWER(ats_candidate.current_stage) IN ('joined','payroll_validated') (same rule as the Plan 2
 *   stop check), ATS id COALESCE(qf.ats_candidate_id, he_lead.ats_candidate_id).
 * - selected: joined, or he_match.state = 'selected', or LOWER(current_stage) IN
 *   ('selected','offered','offer','offer_approved','onboarded','converted').
 * - leads: meta_live (origin = campaign): distinct RIGHT(REGEXP_REPLACE(parsed_phone,'[^0-9]',''),10) of meta_lead_raw with that
 *   campaign_id and (requisition_id NULL or this requisition), for every meta_campaign with requisition_id = this requisition;
 *   meta_old and he: distinct he_match.lead_id of this requisition's drives attributed to the origin (credited match: its stream's type
 *   and origin; else a drive with source_kind <> 'pool' and a run_label: meta_old / drive id; else he / pool); finally
 *   leads = max(leads, qualified).
 * Origins listed: every origin above, every qualified_followup origin and every stream of the requisition (stream rows carry
 * streamId / streamStatus; an origin with no data shows zeros). Labels: campaign name, run_label, "Pool: ATS history", or the stream's
 * origin_label. Shares: shareOfLeads = leads / sum(leads), shareOfJoined = joined / sum(joined), leadToJoinRate = joined / leads, each 0
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
// he_lead / ats_candidate / he_match are reached by their keys through LEFT JOINs (never scanned; the non-HE tables are compared under an
// explicit utf8mb4_unicode_ci so a table on another collation cannot fail the read); he_message is keyed by
// (requisition_id, lead_id) or lead_id and he_call by lead_id, both indexed.
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
           CASE WHEN hl.status = 'joined' OR LOWER(ac.current_stage) IN ('joined','payroll_validated') THEN 1 ELSE 0 END AS joined,
           CASE WHEN hl.status = 'joined' OR LOWER(ac.current_stage) IN ('joined','payroll_validated')
                  OR m.state = 'selected' OR LOWER(ac.current_stage) IN ('selected','offered','offer','offer_approved','onboarded','converted') THEN 1 ELSE 0 END AS selected`;
/** FROM / JOIN part that goes with STAGE_FLAGS_SQL (the caller adds the WHERE). */
export const STAGE_FROM_SQL = `      FROM qualified_followup qf
      LEFT JOIN he_match m ON m.lead_id = qf.he_lead_id AND m.requisition_id = qf.requisition_id
      LEFT JOIN he_lead hl ON hl.id = qf.he_lead_id
      LEFT JOIN ats_candidate ac ON ac.id = COALESCE(qf.ats_candidate_id, hl.ats_candidate_id) COLLATE utf8mb4_unicode_ci`;
const STAGES_SQL = `
SELECT f.source_type, f.origin_id, MAX(f.origin_label) AS origin_label,
       COUNT(*) AS qualified, SUM(f.emailed) AS emailed, SUM(f.whatsapped) AS whatsapped, SUM(f.replied) AS replied, SUM(f.called) AS called,
       SUM(f.confirmed) AS confirmed, SUM(f.arrived) AS arrived, SUM(f.selected) AS selected, SUM(f.joined) AS joined
  FROM (
    SELECT qf.source_type, qf.origin_id, qf.origin_label,
           ${STAGE_FLAGS_SQL}
${STAGE_FROM_SQL}
     WHERE qf.requisition_id = ?
  ) f
 GROUP BY f.source_type, f.origin_id`;

// People lined up on this requisition's drives, attributed to an origin (credit through he_match.id; the credit's own drive_id is ignored).
// A meta_live credit is skipped: that source counts its form fills instead.
const MATCH_LEADS_SQL = `
SELECT COALESCE(rs.source_type, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, 'meta_old', 'he')) AS source_type,
       COALESCE(rs.origin_id, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, d.id, 'pool')) AS origin_id,
       MAX(COALESCE(rs.origin_label, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, d.run_label, '${POOL_LABEL}'))) AS origin_label,
       COUNT(DISTINCT m.lead_id) AS leads
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id
 WHERE d.requisition_id = ? AND (rs.source_type IS NULL OR rs.source_type <> 'meta_live')
 GROUP BY 1, 2`;

const STREAMS_SQL = "SELECT id, source_type, origin_id, origin_label, status FROM requisition_stream WHERE requisition_id = ?";
const CAMPAIGNS_SQL = "SELECT id, campaign_name FROM meta_campaign WHERE requisition_id = ?";
// campaign_id IN (...) uses idx_ml_campaign; the phone digits are computed per campaign only.
const campaignLeadsSql = (n: number): string =>
  `SELECT campaign_id, COUNT(DISTINCT RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10)) AS leads
     FROM meta_lead_raw
    WHERE campaign_id IN (${Array(n).fill("?").join(",")}) AND (requisition_id IS NULL OR requisition_id = ?) AND parsed_phone IS NOT NULL
    GROUP BY campaign_id`;
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
    readSection("stages", failed, async () => (await db.execute<RowDataPacket[]>(STAGES_SQL, [requisitionId]))[0], [] as RowDataPacket[]),
    readSection("driveLeads", failed, async () => (await db.execute<RowDataPacket[]>(MATCH_LEADS_SQL, [requisitionId]))[0], [] as RowDataPacket[]),
    readSection("campaigns", failed, async () => (await db.execute<RowDataPacket[]>(CAMPAIGNS_SQL, [requisitionId]))[0], [] as RowDataPacket[]),
  ]);
  // Label precedence: qualified_followup text (1) < stream label (2) < campaign name / run_label / pool label (3).
  for (const s of streams) {
    const c = cell(String(s.source_type) as SourceType, String(s.origin_id), String(s.origin_label ?? ""), 2);
    c.streamId = String(s.id); c.streamStatus = String(s.status) as StreamStatus;
  }
  for (const r of stages) {
    const c = cell(String(r.source_type) as SourceType, String(r.origin_id), String(r.origin_label ?? ""), 1);
    for (const k of COUNT_KEYS) if (k !== "leads") c[k] += Number(r[k] ?? 0); // += : a second row for one origin adds, never overwrites
  }
  for (const r of matchLeads) {
    const t = String(r.source_type) as SourceType;
    const c = cell(t, String(r.origin_id), String(r.origin_label ?? ""), 3);
    c.leads = Number(r.leads ?? 0);
  }
  const campaignIds = campaigns.map((c) => String(c.id));
  for (const c of campaigns) cell("meta_live", String(c.id), String(c.campaign_name ?? ""), 3);
  if (campaignIds.length) {
    const rows = await readSection("campaignLeads", failed, async () => (await db.execute<RowDataPacket[]>(campaignLeadsSql(campaignIds.length), [...campaignIds, requisitionId]))[0], [] as RowDataPacket[]);
    for (const r of rows) cell("meta_live", String(r.campaign_id), "", 0).leads = Number(r.leads ?? 0);
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
