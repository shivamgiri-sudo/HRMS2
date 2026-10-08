/**
 * The one source-type rule (Live Meta / Old Meta data / Hiring Engine) for every place that types a match or a person: the drive analytics
 * (leads, invited / confirmed / arrived, selected / joined, replies, arrivals, cost, insight facts, outcome reasons), the drive trend and
 * campaign dashboard groups, the sources read models and classifySource of the follow-up pipeline. Precedence:
 *   1. a stream credit (requisition_stream_match -> requisition_stream.source_type) decides;
 *   2. a drive with source_kind other than 'pool' (meta / campaign / batch) is Meta;
 *   3. a person with Meta origin (he_lead.meta_lead_id, or a he_lead_campaign link) is Meta;
 *   4. everything else is 'he'.
 * Meta is meta_live when the person's latest form fill is on or after 00:00 of the day LIVE_FILL_DAYS before the reference date (the
 * drive date; a row with no drive uses its own event date), else meta_old (also when there is no fill time). Without a drive and without
 * a person, an active / draft campaign fill is meta_live (classifySource's ingest case).
 * Form fill time: Meta's created_time from raw_payload, converted to IST wall clock and never later than our import time (created_at),
 * else created_at (he-pipeline-health effectiveLeadTime, with the import time as "now").
 * The SQL below is the same rule; attributeSource / isLiveFill / formFillTime are its specification and the tests hold them together.
 */
import { effectiveLeadTime } from "./he-pipeline-health.js";
import type { SourceType } from "./qualified-followup.types.js";
import { addDays } from "./requisition-stream.window.js";

/** A Meta-origin person is Live Meta when they filled a form at most this many days before the drive date (or any time after it). */
export const LIVE_FILL_DAYS = 14;
const IST_OFFSET_MIN = 330;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/;

export interface AttributionFacts {
  streamType?: SourceType | null;
  driveSourceKind?: string | null;
  metaOrigin?: boolean;
  /** Latest form fill, IST wall clock 'YYYY-MM-DD HH:MM:SS'. */
  formFilledAt?: string | null;
  /** Drive date (or the event date of a row without a drive), 'YYYY-MM-DD'. */
  refDate?: string | null;
  /** Only for a fill without a drive or person facts (classifySource's ingest case). */
  campaignStatus?: string | null;
}

export function isLiveFill(fill: string | null | undefined, refDate: string | null | undefined): boolean {
  if (!fill || !refDate) return false;
  return fill.slice(0, 10) >= addDays(refDate, -LIVE_FILL_DAYS);
}

export function attributeSource(f: AttributionFacts): SourceType {
  if (f.streamType) return f.streamType;
  const metaDrive = !!f.driveSourceKind && f.driveSourceKind !== "pool";
  if (metaDrive || f.metaOrigin) return isLiveFill(f.formFilledAt, f.refDate) ? "meta_live" : "meta_old";
  if (!f.driveSourceKind && (f.campaignStatus === "active" || f.campaignStatus === "draft")) return "meta_live";
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
/** Meta created_time ('YYYY-MM-DDTHH:MM:SS+HHMM') as IST wall clock, NULL when absent or another format. */
const metaTimeSql = (r: string): string => {
  const t = `JSON_UNQUOTE(JSON_EXTRACT(${r}.raw_payload, '$.created_time'))`;
  return `IF(${t} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{4}$', `
    + `DATE_ADD(STR_TO_DATE(LEFT(${t}, 19), '%Y-%m-%dT%H:%i:%s'), INTERVAL ${IST_OFFSET_MIN} - (IF(SUBSTRING(${t}, 20, 1) = '-', -1, 1) * (CAST(SUBSTRING(${t}, 21, 2) AS SIGNED) * 60 + CAST(SUBSTRING(${t}, 23, 2) AS SIGNED))) MINUTE), NULL)`;
};
const rawFillSql = (r: string): string => `LEAST(${r}.created_at, COALESCE(${metaTimeSql(r)}, ${r}.created_at))`;

/** The person's latest form fill (all campaign links plus the first fill on he_lead), NULL when none. `lead` is a he_lead alias. */
export function personFillSql(lead: string): string {
  return `NULLIF(GREATEST(`
    + `COALESCE((SELECT MAX(${rawFillSql("afr")}) FROM he_lead_campaign alc JOIN meta_lead_raw afr ON afr.id = alc.meta_lead_id WHERE alc.lead_id = ${lead}.id), ${NONE}), `
    + `COALESCE((SELECT ${rawFillSql("afm")} FROM meta_lead_raw afm WHERE afm.id = ${lead}.meta_lead_id), ${NONE})), ${NONE})`;
}

export function metaOriginSql(lead: string): string {
  return `(${lead}.meta_lead_id IS NOT NULL OR EXISTS (SELECT 1 FROM he_lead_campaign alx WHERE alx.lead_id = ${lead}.id))`;
}

export interface TypeSqlOpts {
  streams: boolean;
  /** he_drive alias (LEFT JOIN is fine: no drive reads as 'pool'). */
  d: string;
  /** he_lead alias joined by attributionJoinsSql. */
  lead: string;
  /** Reference date expression; defaults to `<d>.drive_date`. */
  refDate?: string;
  /** requisition_stream alias; defaults to rs. */
  stream?: string;
}

/** The rule without the stream credit (steps 2-4). */
export function ruleSql(o: Omit<TypeSqlOpts, "streams" | "stream">): string {
  const ref = o.refDate ? `(${o.refDate})` : `${o.d}.drive_date`;
  return `CASE WHEN COALESCE(${o.d}.source_kind, 'pool') <> 'pool' OR ${metaOriginSql(o.lead)} `
    + `THEN IF(${personFillSql(o.lead)} >= ${ref} - INTERVAL ${LIVE_FILL_DAYS} DAY, 'meta_live', 'meta_old') ELSE 'he' END`;
}

/** The full rule as a SQL expression yielding 'meta_live' | 'meta_old' | 'he'. */
export function sourceTypeSql(o: TypeSqlOpts): string {
  const body = ruleSql(o);
  return o.streams ? `COALESCE(${o.stream ?? "rs"}.source_type, ${body})` : body;
}

/** Sort key over already computed columns, for picking ONE type per person: a stream credit first, then Live, Old, he.
 *  SUBSTRING(MIN(key), 3) is the type. Computed outside the row's own SELECT so the rule runs once per row. */
export function typeKeySql(credited: string, type: string): string {
  return `CONCAT(IF(${credited}, 0, 1), FIELD(${type}, 'meta_live', 'meta_old', 'he'), ${type})`;
}

/** Joins the rule needs after the match and drive are in scope: the stream credit by match id and the person by primary key. */
export function attributionJoinsSql(o: { streams: boolean; match: string; requisition: string; lead: string; leadId: string; stream?: string }): string {
  const s = o.stream ?? "rs";
  return `${o.streams ? `LEFT JOIN requisition_stream_match sm ON sm.match_id = ${o.match}.id
  LEFT JOIN requisition_stream ${s} ON ${s}.id = sm.stream_id AND ${s}.requisition_id = ${o.requisition}
  ` : ""}LEFT JOIN he_lead ${o.lead} ON ${o.lead}.id = ${o.leadId}`;
}
