/**
 * Responses in the funnel: who confirmed through which channel, and the response rate per channel and drive type, for the requisitions
 * of an analytics build (or of the Responses summary). Read-only; counts only.
 *
 * - confirmedByChannel: matches on drives in the window that reached "confirmed" (stamped he_match.confirmed_at, or a confirmed / arrived /
 *   no-show state), by he_match.confirmed_via; matches confirmed before migration 2140 (no stamp) count as "unknown". Typed by the shared
 *   rule through the person facts, like every other drive read.
 * - responseRate: contacted = distinct people sent an email or WhatsApp (he_message out) or called by the voice bot (he_call) for these
 *   requisitions in the window, plus people e-mailed an invite without a match (walkin_invite); responded = those of them with a response
 *   on the same channel in the window (email counts the email buttons' web taps too; voice counts call-file results too). No-answer call
 *   results are not responses. So responded <= contacted always.
 * Statements are keyed: he_message by (requisition_id, created_at), he_call by (requisition_id, created_at), walkin_invite by requisition,
 * candidate_response by (requisition_id, occurred_at), he_match by (drive_id, ...); he_lead / he_drive / meta_lead_raw by primary key.
 */
import type { RowDataPacket } from "mysql2";
import { limitedDb } from "./he-read-limit.js";
import { readAgg } from "./he-drive-trend.service.js";
import { PersonFacts, TYPE_KEY_GROUP, typeKeyColsSql } from "./he-person-facts.service.js";
import { activityTypeSql, creditJoinsSql } from "./he-source-attribution.js";
import type { SourceType } from "./qualified-followup.types.js";

export const CONFIRM_VIA = ["email", "web", "whatsapp", "voice_bot", "call_file", "hr", "unknown"] as const;
export type ConfirmVia = (typeof CONFIRM_VIA)[number];
export const RATE_CHANNELS = ["email", "whatsapp", "voice_bot"] as const;
export type RateChannel = (typeof RATE_CHANNELS)[number];
export interface ResponseStats {
  confirmedByChannel: Record<SourceType, Record<ConfirmVia, number>>;
  responseRate: Record<SourceType, Record<RateChannel, { contacted: number; responded: number }>>;
}

const TYPES: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const CI = "COLLATE utf8mb4_unicode_ci";
const ph = (n: number): string => Array(n).fill("?").join(",");
const code = (err: unknown): unknown => (err as { code?: unknown })?.code;
const batches = (ids: string[]): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; };
const perType = <T>(make: () => T): Record<SourceType, T> => ({ meta_live: make(), meta_old: make(), he: make() });
const zeroVia = (): Record<ConfirmVia, number> => Object.fromEntries(CONFIRM_VIA.map((c) => [c, 0])) as Record<ConfirmVia, number>;
/** Channel of a response on the rate's channels (web = the email buttons' page, call_file = the voice calling file); null = not counted. */
export const rateChannelOf = (ch: unknown): RateChannel | null =>
  ch === "email" || ch === "web" ? "email" : ch === "whatsapp" ? "whatsapp" : ch === "voice_bot" || ch === "call_file" ? "voice_bot" : null;
/** A person key: the 10-digit mobile; anything else is not counted. */
const mobOf = (v: unknown): string | null => (typeof v === "string" && /^\d{10}$/.test(v) ? v : null);
const viaOf = (v: unknown): ConfirmVia => (CONFIRM_VIA as readonly string[]).includes(String(v)) ? (String(v) as ConfirmVia) : "unknown";

const typeKeys = (streams: boolean, liveFrom: string, d: string, ref: string): string => typeKeyColsSql({ streams, d, leadId: "m.lead_id", ref, liveFrom });
const credit = (streams: boolean): string => creditJoinsSql({ streams, match: "m", requisition: "m.requisition_id" });

/** Confirmed matches on window drives by channel (the stamp; no stamp = unknown). `stamped` false is the statement before migration 2140. */
export const confirmedSql = (liveFrom: string, n: number, stamped: boolean) => (streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeKeys(streams, liveFrom, "d", "d.drive_date")},
       ${stamped ? "COALESCE(m.confirmed_via, 'unknown')" : "'unknown'"} AS via, COUNT(DISTINCT m.id) AS n
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id
  ${credit(streams)}
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
   AND (${stamped ? "m.confirmed_at IS NOT NULL OR " : ""}m.state IN ('confirmed','arrived','no_show'))
 GROUP BY ${TYPE_KEY_GROUP}, via`;

/** People sent an email / WhatsApp for these requisitions in the window, typed through their match on the requisition. */
export const contactedSql = (liveFrom: string, n: number) => (streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeKeys(streams, liveFrom, "d", "COALESCE(d.drive_date, DATE(hm.created_at))")},
       hm.channel AS ch, hm.mobile10 AS mob
  FROM he_message hm
  JOIN he_match m ON m.lead_id = hm.lead_id AND m.requisition_id = hm.requisition_id
  LEFT JOIN he_drive d ON d.id = m.drive_id
  ${credit(streams)}
 WHERE hm.requisition_id IN (${ph(n)}) AND hm.created_at >= ? AND hm.created_at < ? AND hm.direction = 'out' AND hm.channel IN ('email','whatsapp')
 GROUP BY ${TYPE_KEY_GROUP}, ch, mob`;

/** People the voice bot called for these requisitions in the window. */
export const calledSql = (liveFrom: string, n: number) => (streams: boolean): string => `SELECT STRAIGHT_JOIN ${typeKeys(streams, liveFrom, "d", "COALESCE(d.drive_date, DATE(hc.created_at))")},
       l.mobile10 AS mob
  FROM he_call hc
  JOIN he_match m ON m.id = hc.match_id
  JOIN he_lead l ON l.id = hc.lead_id
  LEFT JOIN he_drive d ON d.id = m.drive_id
  ${credit(streams)}
 WHERE hc.requisition_id IN (${ph(n)}) AND hc.created_at >= ? AND hc.created_at < ?
 GROUP BY ${TYPE_KEY_GROUP}, mob`;

/** People e-mailed an invite link without a match (legacy Meta / pipeline): typed by the invite's stamp, else their form fill. */
export const invitedSql = (liveFrom: string, n: number): string => `SELECT COALESCE(wi.drive_type, ${activityTypeSql({ lead: "il", first: "ilf", fill: "ml", ref: "wi.last_sent_at", liveFrom })}) AS t, wi.mobile10 AS mob, wi.match_id
  FROM walkin_invite wi LEFT JOIN meta_lead_raw ml ON ml.id = wi.meta_lead_id ${CI}
  LEFT JOIN he_lead il ON il.mobile10 = wi.mobile10 ${CI} LEFT JOIN meta_lead_raw ilf ON ilf.id = il.meta_lead_id ${CI}
 WHERE wi.requisition_id IN (${ph(n)}) AND wi.last_sent_at >= ? AND wi.last_sent_at < ?`; // matched invites are skipped in code, so the read stays on the requisition index

/** People who answered on a channel (no-answer call results excluded). */
export const respondedSql = (n: number): string => `SELECT cr.channel AS ch, cr.mobile10 AS mob
  FROM candidate_response cr
 WHERE cr.requisition_id IN (${ph(n)}) AND cr.occurred_at >= ? AND cr.occurred_at < ? AND cr.answer <> 'no_answer'
   AND cr.channel IN ('email','web','whatsapp','voice_bot','call_file')
 GROUP BY cr.channel, cr.mobile10`;

/** A table or column of migrations 2140 / 2141 that is not deployed yet reads as no rows. */
async function tolerant(fn: () => Promise<RowDataPacket[]>): Promise<RowDataPacket[]> {
  try { return await fn(); } catch (err) { if (code(err) === "ER_NO_SUCH_TABLE" || code(err) === "ER_BAD_FIELD_ERROR") return []; throw err; }
}

export async function readResponseStats(ids: string[], w: { from: string; to: string }, pf: PersonFacts): Promise<ResponseStats> {
  const confirmedByChannel = perType(zeroVia);
  const responseRate = perType(() => Object.fromEntries(RATE_CHANNELS.map((c) => [c, { contacted: 0, responded: 0 }])) as Record<RateChannel, { contacted: number; responded: number }>);
  if (!ids.length) return { confirmedByChannel, responseRate };
  const lf = pf.liveFrom;
  const dt = [`${w.from} 00:00:00`, `${addDay(w.to)} 00:00:00`];
  const each = async (run: (b: string[]) => Promise<RowDataPacket[]>): Promise<RowDataPacket[]> => (await Promise.all(batches(ids).map(run))).flat();
  const confirmedRead = (b: string[], stamped: boolean) => readAgg(confirmedSql(lf, b.length, stamped), [...b, w.from, w.to]);
  const [confirmed, contacted, called, invited, responded] = await Promise.all([
    each(async (b) => { try { return await confirmedRead(b, true); } catch (err) { if (code(err) === "ER_BAD_FIELD_ERROR") return confirmedRead(b, false); throw err; } }),
    each((b) => readAgg(contactedSql(lf, b.length), [...b, ...dt])),
    each((b) => readAgg(calledSql(lf, b.length), [...b, ...dt])),
    each((b) => tolerant(async () => (await limitedDb.execute<RowDataPacket[]>(invitedSql(lf, b.length), [...b, ...dt]))[0])),
    each((b) => tolerant(async () => (await limitedDb.execute<RowDataPacket[]>(respondedSql(b.length), [...b, ...dt]))[0])),
  ]);
  await pf.loadRows([...confirmed, ...contacted, ...called]);

  for (const r of confirmed) confirmedByChannel[pf.typeOf(r)][viaOf(r.via)] += Number(r.n ?? 0);

  // contacted people per type and channel (a person counts once per type and channel)
  const reached = perType(() => ({ email: new Set<string>(), whatsapp: new Set<string>(), voice_bot: new Set<string>() }) as Record<RateChannel, Set<string>>);
  for (const r of contacted) { const ch = rateChannelOf(r.ch), mob = mobOf(r.mob); if (ch && mob) reached[pf.typeOf(r)][ch].add(mob); }
  for (const r of called) { const mob = mobOf(r.mob); if (mob) reached[pf.typeOf(r)].voice_bot.add(mob); }
  for (const r of invited) { const mob = mobOf(r.mob); if (mob && r.match_id == null) reached[TYPES.includes(r.t as SourceType) ? (r.t as SourceType) : "he"].email.add(mob); }
  const answered: Record<RateChannel, Set<string>> = { email: new Set(), whatsapp: new Set(), voice_bot: new Set() };
  for (const r of responded) { const ch = rateChannelOf(r.ch), mob = mobOf(r.mob); if (ch && mob) answered[ch].add(mob); }
  for (const t of TYPES) for (const ch of RATE_CHANNELS) {
    const people = reached[t][ch];
    let n = 0;
    for (const mob of people) if (answered[ch].has(mob)) n += 1;
    responseRate[t][ch] = { contacted: people.size, responded: n };
  }
  return { confirmedByChannel, responseRate };
}

function addDay(day: string): string { return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10); }
