/**
 * Measured show-up rates for the live planner (HE_SHOWRATE_CALIBRATION). One bounded read per 200 requisitions: from he_drive (by
 * requisition and the trailing window) to he_match by drive id, never a scan of he_lead / he_message. A failed read gives null, and the
 * planner then keeps today's numbers. Logs carry the error code only.
 */
import type { RowDataPacket } from "mysql2";
import { logger } from "../../logger.js";
import { readAgg } from "./he-drive-trend.service.js";
import { calibrateShowRate, weekdayOf, type CalibratedRate, type RateSample } from "./he-showrate-calibration.js";
import { addDays } from "./requisition-stream.window.js";
import { RATE_ARRIVED_SQL, RATE_INVITED_SQL } from "./he-rate-buckets.js";

export interface RateBucket { byWeekday: Map<number, RateSample>; overall: RateSample }
export interface RateBook { byStream: Map<string, RateBucket>; byRequisition: Map<string, RateBucket> }

const BATCH = 200;
const ph = (n: number): string => Array(n).fill("?").join(",");
// Same state buckets as ratesSql of he-drive-plan.service.ts (and BUCKETS_SQL of he-drive-trend.service.ts). WEEKDAY: 0 = Monday.
const sampleSql = (n: number) => (streams: boolean): string => `SELECT STRAIGHT_JOIN d.requisition_id, ${streams ? "rs.id" : "NULL"} AS stream_id, WEEKDAY(d.drive_date) AS wd,
       ${RATE_INVITED_SQL}, ${RATE_ARRIVED_SQL}
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id` : ""}
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1, 2, 3`;

interface SampleRow { requisition_id: string; stream_id: string | null; wd: number | null; invited: number; arrived: number }
// The rows (not the book: the stream mapping is applied per call) cached in-process for 10 minutes per (ids, IST day, window). The
// 5-minute top-up and /drive-plan reuse them; a failed read is never cached.
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, { at: number; rows: SampleRow[] }>();
export function clearRateBookCache(): void { cache.clear(); }

const count = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

function add(book: Map<string, RateBucket>, key: string, wd: number | null, invited: number, arrived: number): void {
  const b = book.get(key) ?? { byWeekday: new Map<number, RateSample>(), overall: { invited: 0, arrived: 0 } };
  b.overall.invited += invited; b.overall.arrived += arrived;
  if (wd != null) {
    const w = b.byWeekday.get(wd) ?? { invited: 0, arrived: 0 };
    w.invited += invited; w.arrived += arrived;
    b.byWeekday.set(wd, w);
  }
  book.set(key, b);
}

/** Samples of the `trailingDays` days ending yesterday. No query for no ids; null on a read error. */
export async function loadRateBook(o: { requisitionIds: string[]; today: string; trailingDays: number; heStreamOf: Map<string, string> }): Promise<RateBook | null> {
  const book: RateBook = { byStream: new Map(), byRequisition: new Map() };
  const ids = [...new Set(o.requisitionIds.filter((x) => typeof x === "string" && x))];
  if (!ids.length) return book;
  const days = Math.max(1, Math.floor(Number(o.trailingDays) || 0));
  const from = addDays(o.today, -days), to = addDays(o.today, -1);
  const key = `${[...ids].sort().join(",")}|${o.today}|${days}`;
  const hit = cache.get(key);
  let rows: SampleRow[];
  if (hit && Date.now() - hit.at < CACHE_MS) rows = structuredClone(hit.rows);
  else {
    if (hit) cache.delete(key);
    rows = [];
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const got: RowDataPacket[] = await readAgg(sampleSql(batch.length), [...batch, from, to]);
        for (const r of got) {
          const wdRaw = Number(r.wd);
          rows.push({
            requisition_id: String(r.requisition_id), stream_id: r.stream_id == null ? null : String(r.stream_id),
            wd: r.wd != null && Number.isInteger(wdRaw) && wdRaw >= 0 && wdRaw <= 6 ? wdRaw : null, invited: count(r.invited), arrived: count(r.arrived),
          });
        }
      }
    } catch (err) {
      logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[he-calibration] show-rate sample read failed; using the plan default");
      return null;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: Date.now(), rows: structuredClone(rows) });
  }
  for (const r of rows) {
    add(book.byRequisition, r.requisition_id, r.wd, r.invited, r.arrived);
    // an uncredited match counts for the requisition's Hiring Engine stream
    const sid = r.stream_id ?? o.heStreamOf.get(r.requisition_id);
    if (sid) add(book.byStream, sid, r.wd, r.invited, r.arrived);
  }
  return book;
}

function rateOf(bucket: RateBucket | undefined, date: string, planDefault: number, minSample: number): CalibratedRate {
  const weekday = weekdayOf(date);
  return calibrateShowRate({
    weekday, byWeekday: bucket ? Object.fromEntries(bucket.byWeekday) : {}, overall: bucket?.overall ?? { invited: 0, arrived: 0 }, planDefault, minSample,
  });
}

export function rateForStream(book: RateBook | null, streamId: string, date: string, planDefault: number, minSample: number): CalibratedRate {
  return rateOf(book?.byStream.get(streamId), date, planDefault, minSample);
}

export function rateForRequisition(book: RateBook | null, requisitionId: string, date: string, planDefault: number, minSample: number): CalibratedRate {
  return rateOf(book?.byRequisition.get(requisitionId), date, planDefault, minSample);
}
