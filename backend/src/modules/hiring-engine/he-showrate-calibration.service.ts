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

export interface RateBucket { byWeekday: Map<number, RateSample>; overall: RateSample }
export interface RateBook { byStream: Map<string, RateBucket>; byRequisition: Map<string, RateBucket> }

const BATCH = 200;
const ph = (n: number): string => Array(n).fill("?").join(",");
// Same state buckets as ratesSql of he-drive-plan.service.ts (and BUCKETS_SQL of he-drive-trend.service.ts). WEEKDAY: 0 = Monday.
const sampleSql = (n: number) => (streams: boolean): string => `SELECT STRAIGHT_JOIN d.requisition_id, ${streams ? "rs.id" : "NULL"} AS stream_id, WEEKDAY(d.drive_date) AS wd,
       SUM(m.state IN ('invited','confirmed','slot_released','arrived','no_show','selected')) AS invited, SUM(m.state IN ('arrived','selected')) AS arrived
  FROM he_drive d
  JOIN he_match m ON m.drive_id = d.id AND m.requisition_id = d.requisition_id${streams ? `
  LEFT JOIN requisition_stream_match sm ON sm.match_id = m.id
  LEFT JOIN requisition_stream rs ON rs.id = sm.stream_id AND rs.requisition_id = d.requisition_id` : ""}
 WHERE d.requisition_id IN (${ph(n)}) AND d.drive_date BETWEEN ? AND ?
 GROUP BY 1, 2, 3`;

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
  try {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const rows: RowDataPacket[] = await readAgg(sampleSql(batch.length), [...batch, from, to]);
      for (const r of rows) {
        const req = String(r.requisition_id);
        const wdRaw = Number(r.wd);
        const wd = r.wd != null && Number.isInteger(wdRaw) && wdRaw >= 0 && wdRaw <= 6 ? wdRaw : null;
        const invited = count(r.invited), arrived = count(r.arrived);
        add(book.byRequisition, req, wd, invited, arrived);
        // an uncredited match counts for the requisition's Hiring Engine stream
        const sid = r.stream_id == null ? o.heStreamOf.get(req) : String(r.stream_id);
        if (sid) add(book.byStream, sid, wd, invited, arrived);
      }
    }
  } catch (err) {
    logger.warn({ code: (err as { code?: string })?.code ?? "unknown" }, "[he-calibration] show-rate sample read failed; using the plan default");
    return null;
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
