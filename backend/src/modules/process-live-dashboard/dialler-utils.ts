/**
 * Shared helpers for dialler_db queries.
 * Mirrors the GAS finalMetric_() computation logic exactly.
 */

export function n(v: unknown): number {
  const x = Number(v ?? 0);
  return isFinite(x) ? x : 0;
}

export function pct(num: number, den: number, digits = 2): number {
  if (den <= 0) return 0;
  const factor = Math.pow(10, digits);
  return Math.round((num / den) * 100 * factor) / factor;
}

export function round(v: number, digits = 2): number {
  const factor = Math.pow(10, digits);
  return Math.round(v * factor) / factor;
}

/** Format seconds as H:MM:SS or M:SS */
/**
 * Always H:MM:SS ("0:47:36", "1:40:53"). For APR time columns: fmtSec drops the
 * hour below sixty minutes, so a column mixed "47:36" (47 min) with "1:40:53"
 * and read as 47 hours. Kept separate so fmtSec's M:SS stays for AHT-style values.
 */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A dialler DATETIME as "DD/MM/YYYY HH:mm". The dialler pool sets no
 * `dateStrings`, so these arrive as JS Dates, and String(date) produced
 * "Tue Sep 01 2026 09:59:49 GMT+0530 (India Standard Time)". Local getters
 * recover the stored wall-clock time; plain "YYYY-MM-DD HH:MM:SS" strings are
 * handled too. Empty or unparseable input returns ''.
 */
export function fmtDateTime(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtSec(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${m}:${String(rem).padStart(2, '0')}`;
}

/**
 * Compute finalMetric_ result given raw aggregate sums.
 * Matches GAS finalMetric_() exactly.
 */
export function finalMetric(raw: {
  offered: number;
  handled: number;
  calls20: number;
  abndWithin: number;
  handledTalkSec: number;
  handledAcwSec: number;
  holdSec: number;
  holdCount?: number;
  loginCount: number;
}) {
  const { offered, handled, calls20, abndWithin, handledTalkSec, handledAcwSec, holdSec, loginCount } = raw;
  const holdCount = raw.holdCount ?? 0;
  const abandoned = offered - handled;
  const abndAfter = Math.max(0, abandoned - abndWithin);
  const denominator = offered - abndWithin;
  const sl = pct(calls20, denominator);
  const al = pct(handled, offered);
  const ahtSec = handled > 0 ? round((handledTalkSec + holdSec + handledAcwSec) / handled, 0) : 0;
  const cpa = loginCount > 0 ? round(handled / loginCount, 2) : 0;
  const avgWrapSec = handled > 0 ? round(handledAcwSec / handled, 0) : 0;
  // holdTimeSec = average hold per hold-event (GAS: holdTimeTotalSec / holdCount)
  const holdTimeSec = holdCount > 0 ? round(holdSec / holdCount, 0) : 0;
  return {
    offered,
    handled,
    abandoned,
    abndWithin,
    abndAfter,
    calls20,
    sl,
    al,
    ahtSec,
    aht: fmtSec(ahtSec),
    avgWrapSec,
    avgWrap: fmtSec(avgWrapSec),
    handledTalkSec: Math.round(handledTalkSec),
    handledAcwSec: Math.round(handledAcwSec),
    holdSec: Math.round(holdSec),
    holdCount,
    holdTimeSec,
    loginCount,
    cpa,
  };
}

export type MetricResult = ReturnType<typeof finalMetric>;

/** ISO date string YYYY-MM-DD */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Default date range: 1st of current month to today */
export function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: isoDate(from), to: isoDate(today) };
}

/** Validate and parse from/to query params */
export function parseRange(raw: { from?: string; to?: string }): { from: string; to: string } {
  const def = defaultRange();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: raw.from && dateRe.test(raw.from) ? raw.from : def.from,
    to: raw.to && dateRe.test(raw.to) ? raw.to : def.to,
  };
}
