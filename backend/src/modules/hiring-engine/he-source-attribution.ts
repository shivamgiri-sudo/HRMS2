/**
 * The one source-type rule (Live Meta / Old Meta data / Hiring Engine) for every place analytics types a match or a person: the drive
 * analytics (leads, invited / confirmed / arrived, selected / joined, replies, arrivals, cost, insight facts, outcome reasons, per-campaign
 * progress), the drive trend and campaign dashboard groups, the sources read models, and classifySource of the follow-up pipeline.
 * The three types are exclusive:
 *   - a person is Meta-origin when any of these holds: a Meta stream credit (requisition_stream_match -> requisition_stream.source_type
 *     meta_live / meta_old), a Meta-sourced drive (he_drive.source_kind other than 'pool'), he_lead.meta_lead_id, or a he_lead_campaign link;
 *   - a Meta-origin person is meta_live when their latest form fill is on or after the cutoff (LIVE_FROM_DEFAULT 00:00 IST, he_model_param
 *     'meta.live_from'), else meta_old (also with no fill time). The drive they came through does not change the label;
 *   - everyone else is 'he' (pool / ATS history, imports, walk-ins, a 'he' stream credit).
 * Without any drive or person facts, an active / draft campaign fill is meta_live (classifySource's ingest case, unchanged).
 * Form fill time: Meta's created_time from raw_payload, converted to IST wall clock and never later than our import time (created_at),
 * else created_at (he-pipeline-health effectiveLeadTime, with the import time as "now").
 * The SQL below is the same rule; attributeSource / isLiveFill / formFillTime are its specification and the tests hold them together.
 */
import { effectiveLeadTime } from "./he-pipeline-health.js";
import type { SourceType } from "./qualified-followup.types.js";

/** Meta leads received on or after this IST day are Live Meta; earlier ones are Old Meta data. Overridable by he_model_param LIVE_FROM_PARAM. */
export const LIVE_FROM_DEFAULT = "2026-10-08";
export const LIVE_FROM_PARAM = "meta.live_from";
const IST_OFFSET_MIN = 330; // the SQL uses '+05:30'
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real 'YYYY-MM-DD' day, else null (also the guard that keeps the cutoff safe to inline in SQL). */
export function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v.trim())) return null;
  const d = v.trim();
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}

export interface AttributionFacts {
  streamType?: SourceType | null;
  driveSourceKind?: string | null;
  metaOrigin?: boolean;
  /** Latest form fill, IST wall clock 'YYYY-MM-DD HH:MM:SS'. */
  formFilledAt?: string | null;
  /** Cutoff day 'YYYY-MM-DD'; LIVE_FROM_DEFAULT when not given. */
  liveFrom?: string | null;
  /** Only for a fill without a drive, a stream or person facts (classifySource's ingest case). */
  campaignStatus?: string | null;
}

export function isLiveFill(fill: string | null | undefined, liveFrom: string = LIVE_FROM_DEFAULT): boolean {
  return !!fill && fill >= `${liveFrom} 00:00:00`;
}

export function attributeSource(f: AttributionFacts): SourceType {
  const metaStream = f.streamType === "meta_live" || f.streamType === "meta_old";
  const metaDrive = !!f.driveSourceKind && f.driveSourceKind !== "pool";
  if (metaStream || metaDrive || f.metaOrigin) return isLiveFill(f.formFilledAt, validDay(f.liveFrom) ?? LIVE_FROM_DEFAULT) ? "meta_live" : "meta_old";
  if (!f.streamType && !f.driveSourceKind && (f.campaignStatus === "active" || f.campaignStatus === "draft")) return "meta_live";
  return "he";
}

const istWall = (d: Date): string => new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 19).replace("T", " ");

/** One form fill's time, IST wall clock. `createdAt` is meta_lead_raw.created_at (IST wall clock). */
export function formFillTime(createdAt: string, metaCreatedTime: string | null | undefined): string {
  if (!metaCreatedTime || !ISO_WITH_OFFSET.test(metaCreatedTime)) return createdAt;
  const imported = new Date(Date.parse(`${createdAt.replace(" ", "T")}+05:30`));
  const t = effectiveLeadTime({ createdAt: imported, metaCreatedTime }, imported);
  return t ? istWall(t) : createdAt;
}

// ---- SQL ---------------------------------------------------------------------------------------------------------------------------------
// A DATETIME literal (not a string): GREATEST over mixed DATETIME / string operands returns a value CAST cannot read back.
const NONE = "TIMESTAMP '1000-01-01 00:00:00'";
/** Meta created_time ('YYYY-MM-DDTHH:MM:SS+HHMM') as IST wall clock, NULL when absent or another format (numeric offsets need no tz tables). */
const metaTimeSql = (r: string): string => {
  const t = `${r}.raw_payload->>'$.created_time'`;
  return `IF(${t} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{4}$', `
    + `CONVERT_TZ(STR_TO_DATE(LEFT(${t}, 19), '%Y-%m-%dT%H:%i:%s'), CONCAT(SUBSTRING(${t}, 20, 3), ':', SUBSTRING(${t}, 23, 2)), '+05:30'), NULL)`;
};
/** One meta_lead_raw row's fill time (alias `r`), the SQL of formFillTime. */
export const rawFillSql = (r: string): string => `LEAST(${r}.created_at, COALESCE(${metaTimeSql(r)}, ${r}.created_at))`;

/** The person's latest form fill (all campaign links plus the first fill on he_lead), NULL when none. `lead` is a he_lead alias.
 *  The specification of liveFillSql (and what the prod parity check compares with formFillTime); the rule itself uses liveFillSql. */
export function personFillSql(lead: string): string {
  return `NULLIF(GREATEST(`
    + `COALESCE((SELECT MAX(${rawFillSql("afr")}) FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id COLLATE utf8mb4_unicode_ci WHERE alc.lead_id = ${lead}.id), ${NONE}), `
    + `COALESCE((SELECT ${rawFillSql("afm")} FROM meta_lead_raw afm WHERE afm.id = ${lead}.meta_lead_id COLLATE utf8mb4_unicode_ci), ${NONE})), ${NONE})`;
}

/** The cutoff as a SQL DATETIME literal (validated day only). */
export const cutoffSql = (liveFrom: string): string => `TIMESTAMP '${validDay(liveFrom) ?? LIVE_FROM_DEFAULT} 00:00:00'`;

/**
 * "The person's latest form fill is on or after the cutoff" over the same fills as personFillSql (any fill qualifies exactly when the latest
 * does): the first fill on he_lead through the `<lead>f` join of attributionJoinsSql, then the campaign links. A fill is never later than its
 * import time (created_at, copied to he_lead_campaign.form_filled_at by the bridge), so that time is tested first and the payload is parsed
 * only for imports on or after the cutoff; one dependent subquery per row at most.
 */
export function liveFillSql(lead: string, liveFrom: string): string {
  const c = cutoffSql(liveFrom);
  const first = `${lead}f`;
  return `((${first}.created_at >= ${c} AND ${rawFillSql(first)} >= ${c})`
    + ` OR EXISTS (SELECT 1 FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id COLLATE utf8mb4_unicode_ci WHERE alc.lead_id = ${lead}.id`
    + ` AND (alc.form_filled_at IS NULL OR alc.form_filled_at >= ${c}) AND ${rawFillSql("afr")} >= ${c}))`;
}

export function metaOriginSql(lead: string): string {
  return `(${lead}.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = ${lead}.id))`;
}

export interface TypeSqlOpts {
  /** Whether the stream tables exist (the credit joins of attributionJoinsSql are present). */
  streams: boolean;
  /** he_drive alias (LEFT JOIN is fine: no drive reads as 'pool'). */
  d: string;
  /** he_lead alias joined by attributionJoinsSql. */
  lead: string;
  /** Cutoff day 'YYYY-MM-DD' (loadLiveFrom). */
  liveFrom: string;
  /** requisition_stream alias; defaults to rs. */
  stream?: string;
}

/** The rule as a SQL expression yielding 'meta_live' | 'meta_old' | 'he'. The cheap signals come first; the subqueries run last. */
export function sourceTypeSql(o: TypeSqlOpts): string {
  const credit = o.streams ? `COALESCE(${o.stream ?? "rs"}.source_type, 'he') <> 'he' OR ` : "";
  return `CASE WHEN ${credit}COALESCE(${o.d}.source_kind, 'pool') <> 'pool' OR ${metaOriginSql(o.lead)} `
    + `THEN IF(${liveFillSql(o.lead, o.liveFrom)}, 'meta_live', 'meta_old') ELSE 'he' END`;
}

/** Sort key over already computed columns, for picking ONE type per person: Live, Old, he. SUBSTRING(MIN(key), 2) is the type. */
export function typeKeySql(type: string): string {
  return `CONCAT(FIELD(${type}, 'meta_live', 'meta_old', 'he'), ${type})`;
}

/** Joins the rule needs after the match and drive are in scope: the stream credit by match id, the person and their first form fill
 *  (`<lead>f`) by primary key; all 1:1, so no row is repeated. */
export function attributionJoinsSql(o: { streams: boolean; match: string; requisition: string; lead: string; leadId: string; stream?: string }): string {
  const s = o.stream ?? "rs";
  return `${o.streams ? `LEFT JOIN requisition_stream_match sm ON sm.match_id = ${o.match}.id
  LEFT JOIN requisition_stream ${s} ON ${s}.id = sm.stream_id AND ${s}.requisition_id = ${o.requisition}
  ` : ""}LEFT JOIN he_lead ${o.lead} ON ${o.lead}.id = ${o.leadId}
  LEFT JOIN meta_lead_raw ${o.lead}f ON ${o.lead}f.id = ${o.lead}.meta_lead_id COLLATE utf8mb4_unicode_ci`;
}
