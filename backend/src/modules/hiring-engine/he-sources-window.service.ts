/**
 * Sources read model over MANY requisitions and a day window (Plan 4 command center). Same stage definitions as the header of
 * he-requisition-sources.service.ts, with the window applied to the populations that carry a date:
 * - qualified .. joined: qualified_followup rows with qualified_at in [from 00:00:00, to+1 00:00:00) (IST wall clock); selected /
 *   joined additionally follow the drive credit rule (arrived at the drive, selected / joined on or after its drive date);
 * - leads of meta_old / he: people lined up on drives with drive_date BETWEEN from AND to;
 * - leads of meta_live: form fills of the requisitions' campaigns with created_at in the same bounds.
 * Streams add zero rows (origin with no data). Shares are per requisition. leads = max(leads, qualified) per row.
 *
 * One statement per section and batch of 200 requisitions (never one per requisition). Every statement starts from
 * qualified_followup / he_drive / requisition_stream / meta_campaign filtered by requisition_id IN (...), or from meta_lead_raw filtered by
 * campaign_id IN (...); he_lead / ats_candidate / he_match / he_drive are reached through key joins only. A failing statement flags its section
 * (logged as section + code only) and the other rows survive; a missing qualified_followup / requisition_stream table reads as empty.
 * A form fill of a campaign counts when its requisition_id is NULL or one of the requisitions that own a campaign of the same batch
 * (a campaign belongs to one requisition, so this equals the single-requisition rule except for a lead tagged with another requisition
 * of the same batch). No candidate data leaves this module: counts, labels and ids only.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { STAGE_FLAGS_SQL, STAGE_FROM_SQL, computeShares, readSection, type SourceCounts, type SourceRow } from "./he-requisition-sources.service.js";
import type { SourceType } from "./qualified-followup.types.js";
import type { StreamStatus } from "./requisition-stream.service.js";
import { addDays } from "./requisition-stream.window.js";

export interface DayWindow { from: string; to: string }
export interface RequisitionSourceRows { requisitionId: string; rows: SourceRow[] }
export interface SourcesSlice { byRequisition: RequisitionSourceRows[]; partial: boolean; failedSections: string[] }

const BATCH = 200;
const COUNT_KEYS: ReadonlyArray<keyof SourceCounts> = ["leads", "qualified", "emailed", "whatsapped", "replied", "confirmed", "called", "arrived", "selected", "joined"];
const TYPE_ORDER: Record<SourceType, number> = { meta_live: 0, meta_old: 1, he: 2 };
const POOL_LABEL = "Pool: ATS history";
const isRealDay = (x: unknown): x is string => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const t = Date.parse(`${x}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x;
};
const ph = (n: number): string => Array(n).fill("?").join(",");

const stagesSql = (n: number): string => `
SELECT f.requisition_id, f.source_type, f.origin_id, MAX(f.origin_label) AS origin_label,
       COUNT(*) AS qualified, SUM(f.emailed) AS emailed, SUM(f.whatsapped) AS whatsapped, SUM(f.replied) AS replied, SUM(f.called) AS called,
       SUM(f.confirmed) AS confirmed, SUM(f.arrived) AS arrived, SUM(f.selected) AS selected, SUM(f.joined) AS joined
  FROM (
    SELECT qf.requisition_id, qf.source_type, qf.origin_id, qf.origin_label,
           ${STAGE_FLAGS_SQL}
${STAGE_FROM_SQL}
     WHERE qf.requisition_id IN (${ph(n)}) AND qf.qualified_at >= ? AND qf.qualified_at < ?
  ) f
 GROUP BY f.requisition_id, f.source_type, f.origin_id`;

// Credit goes through he_match.id; the credit's own drive_id is ignored. A meta_live credit is skipped (that source counts form fills).
const matchLeadsSql = (n: number): string => `
SELECT d.requisition_id AS requisition_id,
       COALESCE(rs.source_type, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, 'meta_old', 'he')) AS source_type,
       COALESCE(rs.origin_id, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, d.id, 'pool')) AS origin_id,
       MAX(COALESCE(rs.origin_label, IF(d.source_kind <> 'pool' AND d.run_label IS NOT NULL, d.run_label, '${POOL_LABEL}'))) AS origin_label,
       COUNT(DISTINCT m.lead_id) AS leads
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ? AND (rs.source_type IS NULL OR rs.source_type <> 'meta_live')
 GROUP BY d.requisition_id, 2, 3`;

const streamsSql = (n: number): string => `SELECT requisition_id, id, source_type, origin_id, origin_label, status FROM requisition_stream WHERE requisition_id IN (${ph(n)})`;
const campaignsSql = (n: number): string => `SELECT id, requisition_id, campaign_name FROM meta_campaign WHERE requisition_id IN (${ph(n)})`;
// campaign_id IN (...) uses idx_ml_campaign; the phone digits are computed per campaign only.
const campaignLeadsSql = (n: number, owners: number): string =>
  `SELECT campaign_id, COUNT(DISTINCT RIGHT(REGEXP_REPLACE(parsed_phone, '[^0-9]', ''), 10)) AS leads
     FROM meta_lead_raw
    WHERE campaign_id IN (${ph(n)}) AND (requisition_id IS NULL OR requisition_id IN (${ph(owners)}))
      AND parsed_phone IS NOT NULL AND created_at >= ? AND created_at < ?
    GROUP BY campaign_id`;

const noTable = (err: unknown): boolean => (err as { code?: unknown })?.code === "ER_NO_SUCH_TABLE";
const zero = (): SourceCounts => ({ leads: 0, qualified: 0, emailed: 0, whatsapped: 0, replied: 0, confirmed: 0, called: 0, arrived: 0, selected: 0, joined: 0 });
type Rows = RowDataPacket[];
type Cell = Omit<SourceRow, "shareOfLeads" | "shareOfJoined" | "leadToJoinRate"> & { _rank: number };

export async function getSourcesForRequisitions(ids: string[], w: DayWindow): Promise<SourcesSlice> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { byRequisition: [], partial: false, failedSections: [] };
  const failed: string[] = [];
  // Bounds first and inside a try: a malformed date must flag the window, never throw (addDays raises RangeError on an invalid date).
  let dt: string[];
  try {
    if (!isRealDay(w.from) || !isRealDay(w.to)) throw new RangeError("window");
    dt = [`${w.from} 00:00:00`, `${addDays(w.to, 1)} 00:00:00`];
  } catch {
    logger.error({ section: "window", code: "invalid_window" }, "[he-sources] section failed");
    return { byRequisition: unique.map((requisitionId) => ({ requisitionId, rows: [] })), partial: true, failedSections: ["window"] };
  }
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += BATCH) batches.push(unique.slice(i, i + BATCH));

  // `tolerant`: a table that is not deployed yet reads as empty instead of failing the section.
  const run = async (name: string, sql: (n: number) => string, extra: unknown[], tolerant: boolean, list: string[][] = batches): Promise<Rows> => {
    const parts = await Promise.all(list.map((b) => readSection<Rows>(name, failed, async () => {
      try { return (await db.execute<Rows>(sql(b.length), [...b, ...extra]))[0]; } catch (err) { if (tolerant && noTable(err)) return []; throw err; }
    }, [])));
    return parts.flat();
  };

  const [streams, stages, matchLeads, campaigns] = await Promise.all([
    run("streams", streamsSql, [], true),
    run("stages", stagesSql, dt, true),
    run("driveLeads", matchLeadsSql, [w.from, w.to], true),
    run("campaigns", campaignsSql, [], false),
  ]);
  const owner = new Map<string, string>(); // campaign id -> requisition id
  for (const c of campaigns) owner.set(String(c.id), String(c.requisition_id));
  const campaignIds = [...owner.keys()];
  const campaignBatches: string[][] = [];
  for (let i = 0; i < campaignIds.length; i += BATCH) campaignBatches.push(campaignIds.slice(i, i + BATCH));
  const fills = (await Promise.all(campaignBatches.map((b) => {
    const owners = [...new Set(b.map((c) => owner.get(c)!))];
    return readSection<Rows>("campaignLeads", failed, async () => (await db.execute<Rows>(campaignLeadsSql(b.length, owners.length), [...b, ...owners, ...dt]))[0], []);
  }))).flat();

  const per = new Map<string, Map<string, Cell>>(unique.map((id) => [id, new Map()]));
  const cell = (req: string, t: SourceType, o: string, label: string, rank: number): Cell | null => {
    const m = per.get(req);
    if (!m) return null;
    const k = `${t}|${o}`;
    let c = m.get(k);
    if (!c) { c = { sourceType: t, originId: o, originLabel: label, streamId: null, streamStatus: null, ...zero(), _rank: rank }; m.set(k, c); }
    if (rank > c._rank && label) { c.originLabel = label; c._rank = rank; }
    return c;
  };
  // Label precedence as in the single-requisition read: follow-up text (1) < stream label (2) < campaign / run label / pool label (3).
  for (const s of streams) {
    const c = cell(String(s.requisition_id), String(s.source_type) as SourceType, String(s.origin_id), String(s.origin_label ?? ""), 2);
    if (c) { c.streamId = String(s.id); c.streamStatus = String(s.status) as StreamStatus; }
  }
  for (const r of stages) {
    const c = cell(String(r.requisition_id), String(r.source_type) as SourceType, String(r.origin_id), String(r.origin_label ?? ""), 1);
    if (c) for (const k of COUNT_KEYS) if (k !== "leads") c[k] += Number(r[k] ?? 0);
  }
  for (const r of matchLeads) {
    const c = cell(String(r.requisition_id), String(r.source_type) as SourceType, String(r.origin_id), String(r.origin_label ?? ""), 3);
    if (c) c.leads = Number(r.leads ?? 0);
  }
  for (const c of campaigns) cell(String(c.requisition_id), "meta_live", String(c.id), String(c.campaign_name ?? ""), 3);
  for (const r of fills) {
    const req = owner.get(String(r.campaign_id));
    const c = req ? cell(req, "meta_live", String(r.campaign_id), "", 0) : null;
    if (c) c.leads = Number(r.leads ?? 0);
  }

  const byRequisition = unique.map((requisitionId) => {
    const raw = [...per.get(requisitionId)!.values()].map(({ _rank, ...c }) => { void _rank; return { ...c, leads: Math.max(c.leads, c.qualified) }; });
    raw.sort((a, b) => TYPE_ORDER[a.sourceType] - TYPE_ORDER[b.sourceType] || b.leads - a.leads || a.originLabel.localeCompare(b.originLabel) || a.originId.localeCompare(b.originId));
    return { requisitionId, rows: computeShares(raw) };
  });
  const failedSections = [...new Set(failed)];
  return { byRequisition, partial: failedSections.length > 0, failedSections };
}
