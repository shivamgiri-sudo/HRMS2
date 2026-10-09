/**
 * Reads behind the Responses UI: the response list (keyset paged), the HR review queue, the per-channel summary and the "confirmed to
 * attend" list of a drive (also the arrival checklist). Read-only, branch-scoped (a branch user sees rows of requisitions in their branch;
 * outside scope reads as nothing / null), people masked: first name + initial and the last four digits. Message text is returned only as a
 * short preview with digit runs and e-mail addresses removed. Statements are keyed: candidate_response by (occurred_at), (requisition_id,
 * occurred_at), (status, occurred_at), (match_id); he_match by (drive_id, ...); everything else by primary key.
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import type { BranchScope } from "../meta-campaign/meta-access.js";
import { PersonFacts } from "./he-person-facts.service.js";
import { loadLiveFrom } from "./he-source-attribution.service.js";
import { RATE_CHANNELS, readResponseStats, type RateChannel } from "./he-response-stats.service.js";
import { maskMobile } from "./qualified-followup.rules.js";
import type { SourceType } from "./qualified-followup.types.js";
import type { ResponseAnswer, ResponseChannel, ResponseMode, ResponseStatus } from "./response-normalise.js";

export const CHANNELS: readonly ResponseChannel[] = ["email", "whatsapp", "voice_bot", "call_file", "hr", "web"];
const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
export const MAX_LIMIT = 100;

export interface ListQuery {
  from: string; to: string; campaignId?: string | null; requisitionId?: string | null; driveId?: string | null; driveType?: SourceType | null;
  channel?: ResponseChannel | null; answer?: ResponseAnswer | null; status?: ResponseStatus | null; mobile10?: string | null; cursor?: string | null; limit?: number;
}
export interface ResponseListRow {
  id: number; occurredAt: string; channel: ResponseChannel; mode: ResponseMode; answer: ResponseAnswer; status: ResponseStatus;
  suggested: ResponseAnswer | null; confidence: number | null; person: { name: string; mobileMasked: string };
  leadId: string | null; matchId: string | null; requisitionId: string | null; requisitionCode: string | null; campaignName: string | null;
  driveType: SourceType | null; driveId: string | null; driveDate: string | null; slotAt: string | null; handledBy: "system" | "hr"; handledAt: string | null;
  conflict: boolean; dedupeOf: number | null; textPreview: string;
  /** How an email reply was tied to the person: an answer token, the email thread, or only the sender address (not verified). */
  matchedBy: "token" | "thread" | "sender" | null;
}

const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const missing = (err: unknown): boolean => ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(String((err as { code?: unknown })?.code));
const read = async (sql: string, params: unknown[]): Promise<RowDataPacket[]> => (await limitedDb.execute<RowDataPacket[]>(sql, params))[0];
const istStamp = (d: Date): string => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");
const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** "Asha Kumari Verma" -> "Asha V."; no name -> "Unknown". */
export function shortName(full: unknown): string {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Unknown";
  return parts.length === 1 ? parts[0].slice(0, 40) : `${parts[0].slice(0, 40)} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
/** Free text for display: e-mail addresses and digit runs of 6+ removed, whitespace folded, at most `max` characters. */
export function preview(text: unknown, max = 140): string {
  const t = String(text ?? "").replace(/[^\s@]+@[^\s@]+/g, "[email]").replace(/\d[\d\s-]{4,}\d/g, "#").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function encodeCursor(at: string, id: number): string { return Buffer.from(`${at}|${id}`).toString("base64url"); }
export function decodeCursor(c: string | null | undefined): { at: string; id: number } | null {
  if (!c || c.length > 80) return null;
  const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|(\d{1,18})$/.exec(Buffer.from(c, "base64url").toString("utf8"));
  return m ? { at: m[1], id: Number(m[2]) } : null;
}

const BASE = `SELECT cr.id, cr.occurred_at, cr.channel, cr.mode, cr.answer, cr.status, cr.suggested_answer, cr.confidence, cr.mobile10, cr.lead_id, cr.match_id,
       cr.requisition_id, cr.drive_type, cr.drive_id, cr.slot_at, cr.handled_by, cr.handled_at, cr.conflict, cr.dedupe_of, cr.source_kind, LEFT(cr.raw_text, 400) AS raw_text,
       jr.requisition_code, mc.campaign_name, d.drive_date, COALESCE(l.full_name, ml.parsed_name) AS full_name
  FROM candidate_response cr
  LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id
  LEFT JOIN meta_campaign mc ON mc.id = cr.campaign_id
  LEFT JOIN he_drive d ON d.id = cr.drive_id
  LEFT JOIN he_lead l ON l.id = cr.lead_id
  LEFT JOIN meta_lead_raw ml ON ml.id = cr.meta_lead_id`;

const MATCHED_BY: Record<string, ResponseListRow["matchedBy"]> = { inbound_email: "token", email_thread: "thread", email_sender: "sender" };

function toRow(r: RowDataPacket): ResponseListRow {
  return {
    id: Number(r.id), occurredAt: String(r.occurred_at), channel: r.channel, mode: r.mode, answer: r.answer, status: r.status,
    suggested: (str(r.suggested_answer) as ResponseAnswer | null), confidence: r.confidence == null ? null : Number(r.confidence),
    person: { name: shortName(r.full_name), mobileMasked: maskMobile(r.mobile10) },
    leadId: str(r.lead_id), matchId: str(r.match_id), requisitionId: str(r.requisition_id), requisitionCode: str(r.requisition_code), campaignName: str(r.campaign_name),
    driveType: (str(r.drive_type) as SourceType | null), driveId: str(r.drive_id), driveDate: str(r.drive_date), slotAt: str(r.slot_at),
    handledBy: r.handled_by && r.handled_by !== "system" ? "hr" : "system", handledAt: str(r.handled_at),
    conflict: Number(r.conflict) === 1, dedupeOf: r.dedupe_of == null ? null : Number(r.dedupe_of), textPreview: preview(r.raw_text),
    matchedBy: MATCHED_BY[String(r.source_kind ?? "")] ?? null,
  };
}

/** WHERE parts for the filters and the scope (the branch filter last). */
function where(q: Omit<ListQuery, "cursor" | "limit">, scope: BranchScope): { sql: string[]; params: unknown[] } {
  const sql = ["cr.occurred_at >= ? AND cr.occurred_at < ?"], params: unknown[] = [`${q.from} 00:00:00`, `${nextDay(q.to)} 00:00:00`];
  const eq: Array<[string, unknown]> = [["cr.campaign_id", q.campaignId], ["cr.requisition_id", q.requisitionId], ["cr.drive_id", q.driveId], ["cr.drive_type", q.driveType],
    ["cr.channel", q.channel], ["cr.answer", q.answer], ["cr.status", q.status], ["cr.mobile10", q.mobile10]];
  for (const [col, v] of eq) if (v != null && v !== "") { sql.push(`${col} = ?`); params.push(v); }
  if (!scope.all) { sql.push("jr.branch_name = ?"); params.push(scope.branchName); }
  return { sql, params };
}

export async function listResponses(q: ListQuery, scope: BranchScope): Promise<{ rows: ResponseListRow[]; nextCursor: string | null }> {
  if (!scope.all && !scope.branchName) return { rows: [], nextCursor: null };
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? 50)));
  const w = where(q, scope);
  const cur = decodeCursor(q.cursor);
  if (cur) { w.sql.push("(cr.occurred_at < ? OR (cr.occurred_at = ? AND cr.id < ?))"); w.params.push(cur.at, cur.at, cur.id); }
  let rows: RowDataPacket[];
  try { rows = await read(`${BASE}\n WHERE ${w.sql.join(" AND ")}\n ORDER BY cr.occurred_at DESC, cr.id DESC LIMIT ${limit + 1}`, w.params); }
  catch (err) { if (missing(err)) return { rows: [], nextCursor: null }; throw err; }
  const page = rows.slice(0, limit).map(toRow);
  const last = page[page.length - 1];
  return { rows: page, nextCursor: rows.length > limit && last ? encodeCursor(last.occurredAt, last.id) : null };
}

export interface QueueCounts { total: number; under1h: number; h1to4: number; h4to24: number; over24h: number }
/** Free-text replies waiting for HR, oldest first (up to 100), with counts by age. */
export async function responseQueue(scope: BranchScope, now: Date = new Date()): Promise<{ rows: ResponseListRow[]; counts: QueueCounts; oldestAt: string | null }> {
  const none = { rows: [], counts: { total: 0, under1h: 0, h1to4: 0, h4to24: 0, over24h: 0 }, oldestAt: null };
  if (!scope.all && !scope.branchName) return none;
  const scoped = scope.all ? "" : " AND jr.branch_name = ?";
  const sp = scope.all ? [] : [scope.branchName];
  const ago = (h: number) => istStamp(new Date(now.getTime() - h * 3600_000));
  try {
    const [rows, counts] = await Promise.all([
      read(`${BASE}\n WHERE cr.status = 'needs_review'${scoped}\n ORDER BY cr.occurred_at ASC, cr.id ASC LIMIT 100`, sp),
      read(`SELECT COUNT(*) AS total, SUM(x.b = 0) AS under1h, SUM(x.b = 1) AS h1to4, SUM(x.b = 2) AS h4to24, SUM(x.b = 3) AS over24h, MIN(x.occurred_at) AS oldest
              FROM (SELECT cr.occurred_at, CASE WHEN cr.occurred_at >= ? THEN 0 WHEN cr.occurred_at >= ? THEN 1 WHEN cr.occurred_at >= ? THEN 2 ELSE 3 END AS b
                      FROM candidate_response cr LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id
                     WHERE cr.status = 'needs_review'${scoped}) x`, [ago(1), ago(4), ago(24), ...sp]),
    ]);
    const c = counts[0] ?? {};
    const n = (k: string) => Number(c[k] ?? 0);
    return { rows: rows.map(toRow), counts: { total: n("total"), under1h: n("under1h"), h1to4: n("h1to4"), h4to24: n("h4to24"), over24h: n("over24h") }, oldestAt: str(c.oldest) };
  } catch (err) { if (missing(err)) return none; throw err; }
}

export interface Rate { contacted: number; responded: number; rate: number | null }
export interface ResponseSummary {
  byChannel: Record<ResponseChannel, { responses: number; confirms: number; people: number }>;
  rateByChannel: Record<RateChannel, Rate>;
  rateByType: Record<SourceType, Record<RateChannel, Rate>>;
  byDrive: Array<{ driveId: string; driveDate: string | null; branch: string | null; requisitionCode: string | null; responses: number; confirms: number }>;
}
const rate = (contacted: number, responded: number): Rate => ({ contacted, responded, rate: contacted > 0 ? responded / contacted : null });

/** Per channel: responses, confirms and people in the window (all filters); response rate per channel and drive type for the requisitions
 *  in scope that had responses or drives in the window (only the requisition filter narrows the rate). */
export async function responseSummary(q: Omit<ListQuery, "cursor" | "limit">, scope: BranchScope): Promise<ResponseSummary> {
  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, { responses: 0, confirms: 0, people: 0 }])) as ResponseSummary["byChannel"];
  const zeroRates = (): Record<RateChannel, Rate> => Object.fromEntries(RATE_CHANNELS.map((c) => [c, rate(0, 0)])) as Record<RateChannel, Rate>;
  const out: ResponseSummary = { byChannel, rateByChannel: zeroRates(), rateByType: { meta_live: zeroRates(), meta_old: zeroRates(), he: zeroRates() }, byDrive: [] };
  if (!scope.all && !scope.branchName) return out;
  const w = where(q, scope);
  const filt = w.sql.join(" AND ");
  const JR = "FROM candidate_response cr LEFT JOIN job_requisition jr ON jr.id = cr.requisition_id";
  let ids: string[] = [];
  try {
    const [ch, drives, reqs] = await Promise.all([
      read(`SELECT cr.channel, COUNT(*) AS responses, SUM(cr.answer = 'confirm') AS confirms, COUNT(DISTINCT cr.mobile10) AS people ${JR} WHERE ${filt} GROUP BY cr.channel`, w.params),
      read(`SELECT cr.drive_id, MAX(d.drive_date) AS drive_date, MAX(d.branch_name) AS branch_name, MAX(jr.requisition_code) AS requisition_code, COUNT(*) AS responses,
                   SUM(cr.answer = 'confirm') AS confirms ${JR} LEFT JOIN he_drive d ON d.id = cr.drive_id
             WHERE ${filt} AND cr.drive_id IS NOT NULL GROUP BY cr.drive_id ORDER BY responses DESC LIMIT 50`, w.params),
      q.requisitionId ? Promise.resolve([{ requisition_id: q.requisitionId }] as RowDataPacket[])
        : read(`SELECT DISTINCT cr.requisition_id ${JR} WHERE ${filt} AND cr.requisition_id IS NOT NULL LIMIT 200`, w.params),
    ]);
    for (const r of ch) if (r.channel in byChannel) byChannel[r.channel as ResponseChannel] = { responses: Number(r.responses ?? 0), confirms: Number(r.confirms ?? 0), people: Number(r.people ?? 0) };
    out.byDrive = drives.map((r) => ({ driveId: String(r.drive_id), driveDate: str(r.drive_date), branch: str(r.branch_name), requisitionCode: str(r.requisition_code), responses: Number(r.responses ?? 0), confirms: Number(r.confirms ?? 0) }));
    ids = reqs.map((r) => String(r.requisition_id));
  } catch (err) { if (!missing(err)) throw err; }
  if (!q.requisitionId) {
    const scoped = scope.all ? "" : " AND jr.branch_name = ?";
    const drv = await read(`SELECT DISTINCT d.requisition_id FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.drive_date BETWEEN ? AND ?${scoped} LIMIT 200`,
      [q.from, q.to, ...(scope.all ? [] : [scope.branchName])]);
    ids = [...new Set([...ids, ...drv.map((r) => String(r.requisition_id))])].slice(0, 200);
  }
  const stats = ids.length ? await readResponseStats(ids, { from: q.from, to: q.to }, new PersonFacts(await loadLiveFrom())) : null;
  if (stats) {
    for (const c of RATE_CHANNELS) {
      let contacted = 0, responded = 0;
      for (const t of TYPES) {
        const x = stats.responseRate[t]?.[c] ?? { contacted: 0, responded: 0 };
        out.rateByType[t][c] = rate(x.contacted, x.responded);
        contacted += x.contacted; responded += x.responded;
      }
      out.rateByChannel[c] = rate(contacted, responded);
    }
  }
  return out;
}

export interface ConfirmedRow {
  matchId: string; leadId: string; name: string; mobileMasked: string; slotAt: string | null; confirmedVia: ResponseChannel | null; confirmedAt: string | null;
  otherChannels: ResponseChannel[]; conflict: boolean; state: string; arrivedAt: string | null;
}
export interface DriveConfirmed {
  drive: { id: string; requisitionId: string; date: string; branch: string; status: string; requisitionCode: string; role: string; slotStart: string | null; slotEnd: string | null };
  rows: ConfirmedRow[]; counts: { total: number; confirmed: number; arrived: number; noShow: number; conflicts: number };
}

const confirmedListSql = (stamped: boolean): string => `SELECT m.id, m.lead_id, m.state, m.slot_at, ${stamped ? "m.confirmed_at, m.confirmed_via, m.confirmed_response_id" : "NULL AS confirmed_at, NULL AS confirmed_via, NULL AS confirmed_response_id"},
       l.full_name, l.mobile10,
       (SELECT MIN(ev.created_at) FROM he_lead_event ev WHERE ev.drive_id = m.drive_id AND ev.event_type = 'arrived' AND ev.lead_id = m.lead_id) AS arrived_at
  FROM he_match m JOIN he_lead l ON l.id = m.lead_id
 WHERE m.drive_id = ? AND (${stamped ? "m.confirmed_at IS NOT NULL OR " : ""}m.state IN ('confirmed','arrived','no_show','selected'))
 ORDER BY m.slot_at IS NULL, m.slot_at, l.full_name LIMIT 500`;

/** People confirmed to attend a drive (also its arrival checklist). Null when the drive is unknown or outside the caller's branch. */
export async function driveConfirmed(driveId: string, scope: BranchScope): Promise<DriveConfirmed | null> {
  const [d] = await read(`SELECT d.id, d.requisition_id, d.drive_date, d.branch_name, d.status, d.slot_start, d.slot_end, jr.requisition_code, jr.designation_name, jr.branch_name AS req_branch
                            FROM he_drive d JOIN job_requisition jr ON jr.id = d.requisition_id WHERE d.id = ? LIMIT 1`, [driveId]);
  if (!d) return null;
  if (!scope.all && (!scope.branchName || String(d.req_branch ?? d.branch_name) !== scope.branchName)) return null;
  let matches: RowDataPacket[];
  try { matches = await read(confirmedListSql(true), [driveId]); }
  catch (err) { if (!missing(err)) throw err; matches = await read(confirmedListSql(false), [driveId]); }
  const ids = matches.map((m) => String(m.id));
  let resp: RowDataPacket[] = [];
  if (ids.length) {
    try { resp = await read(`SELECT cr.match_id, cr.channel, cr.answer, cr.conflict FROM candidate_response cr WHERE cr.match_id IN (${ids.map(() => "?").join(",")})`, ids); }
    catch (err) { if (!missing(err)) throw err; }
  }
  const rows: ConfirmedRow[] = matches.map((m) => {
    const mine = resp.filter((r) => String(r.match_id) === String(m.id));
    const via = str(m.confirmed_via) as ResponseChannel | null;
    const other = [...new Set(mine.filter((r) => r.answer === "confirm" && r.channel !== via).map((r) => r.channel as ResponseChannel))];
    const conflict = mine.some((r) => Number(r.conflict) === 1) || (m.confirmed_at != null && (m.state === "declined" || m.state === "slot_released"));
    return { matchId: String(m.id), leadId: String(m.lead_id), name: shortName(m.full_name), mobileMasked: maskMobile(m.mobile10), slotAt: str(m.slot_at),
      confirmedVia: via, confirmedAt: str(m.confirmed_at), otherChannels: other, conflict, state: String(m.state), arrivedAt: str(m.arrived_at) };
  });
  return {
    drive: { id: String(d.id), requisitionId: String(d.requisition_id ?? ""), date: String(d.drive_date), branch: String(d.branch_name ?? ""), status: String(d.status), requisitionCode: String(d.requisition_code ?? ""),
      role: String(d.designation_name ?? ""), slotStart: str(d.slot_start), slotEnd: str(d.slot_end) },
    rows,
    counts: { total: rows.length, confirmed: rows.filter((r) => r.state === "confirmed").length, arrived: rows.filter((r) => r.state === "arrived" || r.state === "selected").length,
      noShow: rows.filter((r) => r.state === "no_show").length, conflicts: rows.filter((r) => r.conflict).length },
  };
}
