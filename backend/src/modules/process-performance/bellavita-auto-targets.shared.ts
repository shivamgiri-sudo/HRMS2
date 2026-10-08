import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Bellavita targets -- fully automatic, nothing to key in.
 *
 * The business's rules (supplied by the user, 2026-09-25):
 *  - Repeat LOB / Chat / Inbound each have one FIXED monthly revenue target. The target
 *    "till today" (MTD) is that figure spread evenly over the days in its month and summed
 *    over the selected days, e.g. Chat 5,400,000 / 30 x 25 days elapsed.
 *  - Abandon Cart has a DATE-WISE target instead:
 *        Conv Tgt %      a fixed per-date default (CART_CONV_TARGET_PCT below)
 *        Allocation      the number of cart rows allocated that date (db_masmis.bb_cart, one
 *                        distinct cart_id per call_date -- one cart is allocated once a day)
 *        Sale Target     = Allocation x Conv Tgt %
 *        Revenue Target  = Sale Target x 500
 *    e.g. 1-Sep: 1,680 x 9.48% = 159.264 sales x 500 = 79,632. A date with no allocation yet
 *    (future / not uploaded) has allocation 0 and so a 0 target, exactly as in the sheet.
 *  - Abandon Cart's target over a range is the sum of its dates' Revenue Targets.
 *
 * Nothing here is stored or editable: the manual monthly-target editors were removed on
 * purpose so a target can never drift from these rules.
 */

/** Fixed monthly revenue target per bb_sale.lob (Repeat customer LOB, Chat, Inbound). */
export const MONTHLY_LOB_TARGETS: Record<string, number> = {
  Repeat: 4_200_000,
  Chat: 5_400_000,
  Inbound: 239_400,
};

/** The assumed revenue per sale the target sheet uses (its own fixed figure, "=Sale Target*500"). */
export const REVENUE_PER_SALE = 500;

export const ABANDON_CART_LOB = "Abandon Cart";

/**
 * Abandon Cart "Conv Tgt %" per date -- the fixed default supplied in the target sheet.
 * A date not listed here has no conversion target yet, so it gets no Abandon Cart target
 * (never a guessed one) -- add the next month's rows here when the business sets them.
 */
export const CART_CONV_TARGET_PCT: Record<string, number> = {
  "2026-09-01": 9.48, "2026-09-02": 9.51, "2026-09-03": 9.51, "2026-09-04": 8.65,
  "2026-09-05": 8.77, "2026-09-06": 8.77, "2026-09-07": 8.77, "2026-09-08": 8.77,
  "2026-09-09": 9.21, "2026-09-10": 9.21,
  "2026-09-11": 10.52, "2026-09-12": 10.52, "2026-09-13": 10.52, "2026-09-14": 10.52, "2026-09-15": 10.52,
  "2026-09-16": 10.08, "2026-09-17": 10.08,
  "2026-09-18": 11.11,
  "2026-09-19": 11.07, "2026-09-20": 11.07, "2026-09-21": 11.07, "2026-09-22": 11.07,
  "2026-09-23": 11.67, "2026-09-24": 11.67, "2026-09-25": 11.67,
  "2026-09-26": 11.97, "2026-09-27": 11.97, "2026-09-28": 11.97, "2026-09-29": 11.97,
  "2026-09-30": 12.44, "2026-10-01": 12.44,
};

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Local YYYY-MM-DD (not via toISOString, which shifts the date for a viewer ahead of UTC). */
export function localDateISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function daysInMonthOf(iso: string): number {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0).getDate();
}

/** Every YYYY-MM-DD from `from` to `to` inclusive. */
export function eachDayISO(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const end = new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  while (cur <= end && out.length < 800) {
    out.push(localDateISO(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** "Till today": a range that runs past today is cut off at today for MTD targets. */
export function clampToToday(to: string): string {
  const today = localDateISO(new Date());
  return to > today ? today : to;
}

/** One day's share of a fixed monthly target (monthly / days in that date's month). */
export function monthlyDailyTarget(monthly: number, date: string): number {
  return monthly / daysInMonthOf(date);
}

const CART_DATE_EXPR = "STR_TO_DATE(call_date, '%e-%b-%y')";

/** Allocation per date = DISTINCT cart_id in bb_cart by call_date. One cart is allocated once a day; the
 * raw table can hold a re-uploaded row or two (1-Sep has 1,688 rows for 1,680 carts), and the target sheet
 * counts the 1,680. */
export async function loadCartAllocationByDate(from: string, to: string): Promise<Map<string, number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(${CART_DATE_EXPR}, '%Y-%m-%d') AS d, COUNT(DISTINCT NULLIF(cart_id, '')) AS n
     FROM db_masmis.bb_cart
     WHERE ${CART_DATE_EXPR} >= ? AND ${CART_DATE_EXPR} < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY d`,
    [from, to],
  );
  const m = new Map<string, number>();
  for (const r of rows) m.set(String(r.d), Number(r.n) || 0);
  return m;
}

export interface CartTargetRow {
  date: string;
  /** null = no conversion target has been set for this date. */
  convTgtPct: number | null;
  allocation: number;
  saleTarget: number;
  revenueTarget: number;
}

/** Date-wise Abandon Cart target rows for [from, to] (the whole range -- not cut off at today). */
export async function getCartTargetRows(from: string, to: string): Promise<CartTargetRow[]> {
  const allocation = await loadCartAllocationByDate(from, to);
  return eachDayISO(from, to).map((date) => {
    const conv = CART_CONV_TARGET_PCT[date] ?? null;
    const alloc = allocation.get(date) ?? 0;
    const saleTarget = conv === null ? 0 : round3(alloc * (conv / 100));
    return { date, convTgtPct: conv, allocation: alloc, saleTarget, revenueTarget: conv === null ? 0 : round2(saleTarget * REVENUE_PER_SALE) };
  });
}

export interface DailyTarget { date: string; target: number }

/**
 * Per-LOB daily revenue targets for [from, to] cut off at today ("MTD till today"):
 * fixed-monthly LOBs get monthly/days-in-month per day, Abandon Cart gets its date-wise
 * Revenue Target, and a LOB with no rule (e.g. "Unknown") gets no entry -- so it has no target.
 */
export async function getAutoLobDailyTargets(lobs: string[], from: string, to: string): Promise<Record<string, DailyTarget[]>> {
  const end = clampToToday(to);
  const out: Record<string, DailyTarget[]> = {};
  if (end < from) return out;
  const days = eachDayISO(from, end);
  const needsCart = lobs.includes(ABANDON_CART_LOB);
  const cartRows = needsCart ? new Map((await getCartTargetRows(from, end)).map((r) => [r.date, r.revenueTarget])) : null;
  for (const lob of lobs) {
    if (lob === ABANDON_CART_LOB && cartRows) {
      out[lob] = days.map((date) => ({ date, target: cartRows.get(date) ?? 0 }));
    } else if (MONTHLY_LOB_TARGETS[lob] !== undefined) {
      out[lob] = days.map((date) => ({ date, target: round2(monthlyDailyTarget(MONTHLY_LOB_TARGETS[lob], date)) }));
    }
  }
  return out;
}

export const sumTargets = (rows: DailyTarget[] | undefined): number => Math.round((rows ?? []).reduce((n, r) => n + r.target, 0));
