/**
 * The one display rule for Live Meta / Old Meta data / Hiring Engine, used by every analytics reader (drive analytics, trend, campaign
 * dashboard groups, sources read models, cost, insight facts, outcome reasons, persons read, per-campaign progress). The three are exclusive:
 *   - Meta-origin: a Meta stream credit (requisition_stream_match -> requisition_stream.source_type meta_live / meta_old), a Meta-sourced
 *     drive (source_kind 'meta' or 'campaign', or 'batch' whose upload batch has he_import_batch.source = 'meta'; other upload batches such
 *     as Naukri / WorkIndia / apna / walk-in / referral are NOT Meta), he_lead.meta_lead_id, or a he_lead_campaign link;
 *   - a Meta-origin person is meta_live for an activity when their FIRST Meta form fill is on or after the cutoff and the activity itself
 *     is on or after the cutoff; otherwise meta_old (also with no fill time). A later re-fill never turns earlier activity Live, and
 *     nothing before the cutoff is ever Live. The cutoff ROLLS (owner, 2026-10-09: "Old Meta = today minus 7 days, always"): 00:00 IST of
 *     the IST day (today - N), N = he_model_param meta.live_days (default 7), so Live Meta is the last N days plus today and a person
 *     moves to Old Meta data the day their first fill leaves that window, even when they filled again later (the first-fill rule). A
 *     fixed day ('meta.live_from.YYYY-MM-DD' = 1) applies only while meta.live_mode = 1 (he-source-attribution.service.ts);
 *   - everyone else is 'he'.
 * A person's form fills are their bridged fills (he_lead.meta_lead_id and he_lead_campaign); a fill with no he_lead is judged with the other
 * raw fills of the same parsed_phone. Fill time: Meta's created_time from raw_payload in IST, never later than our import time (created_at),
 * else created_at (he-pipeline-health effectiveLeadTime, with the import time as "now").
 * The follow-up pipeline keeps its own enqueue-time type (classifySource, unchanged). sourceTypeSql is the whole rule as one SQL expression
 * (the specification the prod parity check runs against attributeSource); the analytics reads do not embed it: they return the row signals
 * (typeKeyColsSql) and he-person-facts.service.ts reads each person's facts once per build (liveFirstFillSql, metaOriginSql) and types in JS.
 */
import { effectiveLeadTime } from "./he-pipeline-health.js";
import type { SourceType } from "./qualified-followup.types.js";

/** Live Meta = a first form fill on or after 00:00 IST of (today - LIVE_DAYS_DEFAULT days), IST day; he_model_param meta.live_days overrides. */
export const LIVE_DAYS_DEFAULT = 7;
export const LIVE_DAYS_MAX = 365;
export const LIVE_DAYS_PARAM = "meta.live_days";
/** value 1 = 'fixed': the latest 'meta.live_from.YYYY-MM-DD' = 1 row is the cutoff; absent or 0 = rolling. */
export const LIVE_MODE_PARAM = "meta.live_mode";
export const LIVE_FROM_PARAM = "meta.live_from";
const IST_OFFSET_MIN = 330; // IST is a fixed +05:30 with no DST; the SQL uses '+05:30'
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real 'YYYY-MM-DD' day, else null (also the guard that keeps the cutoff safe to inline in SQL). */
export function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v.trim())) return null;
  const d = v.trim();
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
}

/** The IST calendar day of an instant. */
export function istDayOf(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** meta.live_days as a whole number of days 0..LIVE_DAYS_MAX (a DECIMAL 7.0000 is 7, a fraction rounds down); anything else is the default. */
export function liveDaysOf(v: unknown): number {
  if (v === null || v === undefined || v === "") return LIVE_DAYS_DEFAULT;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= LIVE_DAYS_MAX ? n : LIVE_DAYS_DEFAULT;
}

/** The rolling cutoff day: the IST day of `now` minus `days` (its 00:00 IST is the boundary; a fill at exactly that moment is Live). */
export function rollingLiveFrom(now: Date = new Date(), days: number = LIVE_DAYS_DEFAULT): string {
  return new Date(Date.parse(`${istDayOf(now)}T00:00:00Z`) - liveDaysOf(days) * 86_400_000).toISOString().slice(0, 10);
}

export interface LiveWindow { liveFrom: string; mode: "rolling" | "fixed"; days: number }
/** The cutoff from the he_model_param values (meta.live_days, meta.live_mode, the days of the 'meta.live_from.<day>' = 1 rows) at `now`. */
export function resolveLiveWindow(p: { liveDays?: unknown; liveMode?: unknown; fixedDays?: readonly unknown[] }, now: Date = new Date()): LiveWindow {
  const days = liveDaysOf(p.liveDays);
  if (Number(p.liveMode) === 1) {
    const fixed = (p.fixedDays ?? []).map(validDay).filter((d): d is string => !!d).sort();
    if (fixed.length) return { liveFrom: fixed[fixed.length - 1], mode: "fixed", days };
  }
  return { liveFrom: rollingLiveFrom(now, days), mode: "rolling", days };
}

export interface AttributionFacts {
  streamType?: SourceType | null;
  driveSourceKind?: string | null;
  /** For a 'batch' drive: one of its upload batches has source 'meta'. */
  driveBatchMeta?: boolean;
  metaOrigin?: boolean;
  /** The person's FIRST Meta form fill, IST wall clock 'YYYY-MM-DD HH:MM:SS'. */
  firstFillAt?: string | null;
  /** When the activity happened (drive date or event time, IST); without it the activity reads as Old Meta (the SQL's NULL rule). */
  activityAt?: string | null;
  /** Cutoff day 'YYYY-MM-DD'; the rolling cutoff of `now` when not given or invalid. */
  liveFrom?: string | null;
  /** The clock for the rolling cutoff when liveFrom is not given (default: the real clock). */
  now?: Date;
}

export function isLiveFill(fill: string | null | undefined, liveFrom: string = rollingLiveFrom()): boolean {
  return !!fill && fill >= `${liveFrom} 00:00:00`;
}

export function isMetaDrive(kind: string | null | undefined, batchMeta = false): boolean {
  return kind === "meta" || kind === "campaign" || (kind === "batch" && batchMeta);
}

export function attributeSource(f: AttributionFacts): SourceType {
  const metaStream = f.streamType === "meta_live" || f.streamType === "meta_old";
  if (!(metaStream || isMetaDrive(f.driveSourceKind, f.driveBatchMeta) || f.metaOrigin)) return "he";
  const cutoff = validDay(f.liveFrom) ?? rollingLiveFrom(f.now ?? new Date());
  // E7: no activity time reads as before the cutoff (meta_old), exactly as the SQL's NULL comparison does.
  const afterCutoff = !!f.activityAt && f.activityAt.slice(0, 10) >= cutoff;
  return isLiveFill(f.firstFillAt, cutoff) && afterCutoff ? "meta_live" : "meta_old";
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
const CI = "COLLATE utf8mb4_unicode_ci";
// A DATETIME literal (not a string): LEAST / GREATEST over mixed DATETIME / string operands return a value CAST cannot read back.
const NONE = "TIMESTAMP '9999-12-31 00:00:00'";
/** Meta created_time ('YYYY-MM-DDTHH:MM:SS+HHMM') as IST wall clock, NULL when absent or another format (numeric offsets need no tz tables). */
const metaTimeSql = (r: string): string => {
  const t = `${r}.raw_payload->>'$.created_time'`;
  return `IF(${t} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{4}$', `
    + `CONVERT_TZ(STR_TO_DATE(LEFT(${t}, 19), '%Y-%m-%dT%H:%i:%s'), CONCAT(SUBSTRING(${t}, 20, 3), ':', SUBSTRING(${t}, 23, 2)), '+05:30'), NULL)`;
};
/** One meta_lead_raw row's fill time (alias `r`), the SQL of formFillTime. */
export const rawFillSql = (r: string): string => `LEAST(${r}.created_at, COALESCE(${metaTimeSql(r)}, ${r}.created_at))`;

/** The cutoff as a SQL DATETIME literal (validated day only; anything else is the rolling cutoff of the real clock). */
export const cutoffSql = (liveFrom: string): string => `TIMESTAMP '${validDay(liveFrom) ?? rollingLiveFrom()} 00:00:00'`;

/** The person's first fill (he_lead `lead`, first fill row `first`), NULL when none: the specification liveFirstFillSql is tested against. */
export function personFirstFillSql(lead: string, first = `${lead}f`): string {
  return `NULLIF(LEAST(COALESCE(IF(${first}.id IS NULL, NULL, ${rawFillSql(first)}), ${NONE}), `
    + `COALESCE((SELECT MIN(${rawFillSql("afr")}) FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id ${CI} WHERE alc.lead_id = ${lead}.id), ${NONE})), ${NONE})`;
}

/**
 * "The person has a form fill and none before the cutoff" (their first fill is Live). A fill is never later than its import time
 * (created_at, copied to he_lead_campaign.form_filled_at by the bridge), so an import before the cutoff decides "not Live" with no payload
 * read and no subquery; the payload is parsed only for imports on or after the cutoff. `first` is the person's first-fill row (joined).
 */
export function liveFirstFillSql(lead: string, first: string, liveFrom: string): string {
  const c = cutoffSql(liveFrom);
  return `((${first}.id IS NULL OR (${first}.created_at >= ${c} AND ${rawFillSql(first)} >= ${c}))`
    + ` AND (${first}.id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign aly WHERE aly.lead_id = ${lead}.id))`
    + ` AND NOT EXISTS (SELECT 1 FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id ${CI} WHERE alc.lead_id = ${lead}.id`
    + ` AND (alc.form_filled_at < ${c} OR afr.created_at < ${c} OR ${rawFillSql("afr")} < ${c})))`;
}

export function metaOriginSql(lead: string, extra?: string): string {
  return `(${lead}.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = ${lead}.id)${extra ? ` OR ${extra}` : ""})`;
}

/** A Meta-sourced drive: 'meta' / 'campaign', or 'batch' with a Meta upload batch among its source_ids. Only a batch drive reaches the
 *  subquery, which reads the small he_import_batch upload log (JSON_TABLE over an outer column is rejected inside these expressions). */
export function metaDriveSql(d: string): string {
  return `(${d}.source_kind IN ('meta','campaign') OR (${d}.source_kind = 'batch' AND EXISTS (SELECT 1 FROM he_import_batch hib WHERE hib.source = 'meta'`
    + ` AND JSON_CONTAINS(${d}.source_ids, JSON_QUOTE(hib.id)))))`;
}

export interface TypeSqlOpts {
  /** Whether the stream tables exist (the credit joins of attributionJoinsSql are present). */
  streams: boolean;
  /** he_drive alias (LEFT JOIN is fine: no drive is not Meta by itself). */
  d: string;
  /** he_lead alias joined by attributionJoinsSql. */
  lead: string;
  /** The person's first-fill meta_lead_raw alias; defaults to `<lead>f` of attributionJoinsSql. */
  first?: string;
  /** Activity time / date expression (drive date, message or event time). */
  ref: string;
  /** Cutoff day 'YYYY-MM-DD' (loadLiveFrom). */
  liveFrom: string;
  /** requisition_stream alias; defaults to rs. */
  stream?: string;
  /** One more Meta-origin condition (a follow-up row's own meta_lead_id). */
  extraMeta?: string;
}

/** The rule as a SQL expression yielding 'meta_live' | 'meta_old' | 'he'. The cheap signals come first; subqueries run last. */
export function sourceTypeSql(o: TypeSqlOpts): string {
  // E7: a stream credit is Meta only for the two Meta stream types (the JS rule), never "anything but he".
  const credit = o.streams ? `${o.stream ?? "rs"}.source_type IN ('meta_live','meta_old') OR ` : "";
  return `CASE WHEN ${credit}${metaDriveSql(o.d)} OR ${metaOriginSql(o.lead, o.extraMeta)} `
    + `THEN IF(${o.ref} >= ${cutoffSql(o.liveFrom)} AND ${liveFirstFillSql(o.lead, o.first ?? `${o.lead}f`, o.liveFrom)}, 'meta_live', 'meta_old') ELSE 'he' END`;
}

/**
 * Type of a raw form fill row `r` (always Meta): Live when the fill is on or after the cutoff and it is the person's first. The person is
 * the he_lead of the same mobile (uq_he_lead_mobile) with their first fill; with no he_lead, the other raw fills of the same parsed_phone
 * (idx_ml_phone). The person lookups are correlated subqueries that run only for fills imported on or after the cutoff, so the bulk of old
 * fills costs no lookup at all.
 */
export function fillTypeSql(r: string, liveFrom: string): string {
  const c = cutoffSql(liveFrom);
  const phone = `${fillPhoneSql(r)} ${CI}`;
  return `IF(${r}.created_at >= ${c} AND ${rawFillSql(r)} >= ${c} AND IF(EXISTS (SELECT 1 FROM he_lead pl WHERE pl.mobile10 = ${phone}), `
    + `EXISTS (SELECT 1 FROM he_lead pl LEFT JOIN meta_lead_raw plf ON plf.id = pl.meta_lead_id ${CI} WHERE pl.mobile10 = ${phone} AND ${liveFirstFillSql("pl", "plf", liveFrom)}), `
    + `NOT EXISTS (SELECT 1 FROM meta_lead_raw afx WHERE afx.parsed_phone = ${r}.parsed_phone AND (afx.created_at < ${c} OR ${rawFillSql("afx")} < ${c}))), 'meta_live', 'meta_old')`;
}
/**
 * E7: the shared rule for an activity row that has a person (he_lead `lead`, possibly NULL, with first-fill row `first`) and maybe a raw
 * form fill `fill`: Meta when the person is Meta-origin or a fill is present; Live when the activity (`ref`) is on or after the cutoff and
 * the person's first fill is Live (judged by the fill's raw rows when the person has no he_lead); otherwise Old Meta; else he.
 */
export function activityTypeSql(o: { lead: string; first: string; fill: string; ref: string; liveFrom: string }): string {
  return `CASE WHEN ${metaOriginSql(o.lead, `${o.fill}.id IS NOT NULL`)} THEN IF(${o.ref} >= ${cutoffSql(o.liveFrom)} AND `
    + `IF(${o.lead}.id IS NOT NULL, ${liveFirstFillSql(o.lead, o.first, o.liveFrom)}, ${fillTypeSql(o.fill, o.liveFrom)} = 'meta_live'), 'meta_live', 'meta_old') ELSE 'he' END`;
}
export const fillPhoneSql = (r: string): string => `RIGHT(REGEXP_REPLACE(${r}.parsed_phone, '[^0-9]', ''), 10)`;
/** Campaign of the first fill of the person behind raw fill `r` (their he_lead's meta_lead_id row), else the fill's own campaign. */
export const fillFirstCampaignSql = (r: string): string =>
  `COALESCE((SELECT plf.campaign_id FROM he_lead pl JOIN meta_lead_raw plf ON plf.id = pl.meta_lead_id ${CI} WHERE pl.mobile10 = ${fillPhoneSql(r)} ${CI}), ${r}.campaign_id)`;

/** Sort key over already computed columns, for picking ONE type per person: Live, Old, he. SUBSTRING(MIN(key), 2) is the type. */
export function typeKeySql(type: string): string {
  return `CONCAT(FIELD(${type}, 'meta_live', 'meta_old', 'he'), ${type})`;
}

/** Only the stream credit joins (by match id); with person facts resolved once per build (he-person-facts.service.ts) a statement needs no more. */
export function creditJoinsSql(o: { streams: boolean; match: string; requisition: string; stream?: string }): string {
  const s = o.stream ?? "rs";
  return o.streams ? `LEFT JOIN requisition_stream_match sm ON sm.match_id = ${o.match}.id
  LEFT JOIN requisition_stream ${s} ON ${s}.id = sm.stream_id AND ${s}.requisition_id = ${o.requisition}` : "";
}

/** Joins the rule needs after the match and drive are in scope: the stream credit by match id, the person and their first form fill
 *  (`<lead>f`) by primary key; all 1:1, so no row is repeated. */
export function attributionJoinsSql(o: { streams: boolean; match: string; requisition: string; lead: string; leadId: string; stream?: string }): string {
  const s = o.stream ?? "rs";
  return `${o.streams ? `LEFT JOIN requisition_stream_match sm ON sm.match_id = ${o.match}.id
  LEFT JOIN requisition_stream ${s} ON ${s}.id = sm.stream_id AND ${s}.requisition_id = ${o.requisition}
  ` : ""}LEFT JOIN he_lead ${o.lead} ON ${o.lead}.id = ${o.leadId}
  LEFT JOIN meta_lead_raw ${o.lead}f ON ${o.lead}f.id = ${o.lead}.meta_lead_id ${CI}`;
}
