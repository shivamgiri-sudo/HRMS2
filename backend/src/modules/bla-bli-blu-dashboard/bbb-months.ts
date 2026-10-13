/**
 * Month list and trend for the Blabli Blu Sales Dashboard (BB-01). Months come from the stored sales date
 * (report_date, a real DATE), never from a file name or text formatting, so a month appears as soon as one accepted
 * row is dated in it. Pure helpers; the queries live in bbb-sales-quality.service.ts.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YM = /^(\d{4})-(\d{2})$/;

/** "2026-09" -> "Sep-26". */
export function monthLabel(ym: string): string {
  const m = YM.exec(ym);
  if (!m) return ym;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${MONTHS[mo - 1]}-${m[1].slice(2)}` : ym;
}

/** "2026-09" -> first and last day of that month. */
export function monthBounds(ym: string): { from: string; to: string } | null {
  const m = YM.exec(ym);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

export interface MonthSales { month: string; orders: number; realTimeSales: number; revenue: number }
export interface MonthEntry extends MonthSales { label: string; from: string; to: string; hasReceived: boolean }

/**
 * Every month with sales or Received Data, oldest first: Aug, Sep, Oct... A month that has only Received Data is
 * still listed (with zero sales) so it can be selected.
 */
export function buildMonthList(sales: MonthSales[], receivedMonths: string[]): MonthEntry[] {
  const byMonth = new Map<string, MonthSales>();
  for (const s of sales) if (YM.test(s.month)) byMonth.set(s.month, s);
  const received = new Set(receivedMonths.filter((m) => YM.test(m)));
  return [...new Set([...byMonth.keys(), ...received])]
    .sort()
    .map((month) => {
      const s = byMonth.get(month) ?? { month, orders: 0, realTimeSales: 0, revenue: 0 };
      const b = monthBounds(month)!;
      return { ...s, month, label: monthLabel(month), from: b.from, to: b.to, hasReceived: received.has(month) };
    });
}

/** The month to open on: the requested one if it has data, else the newest month with data, else the requested one. */
export function defaultMonth(list: Array<{ month: string }>, requested: string): string {
  if (list.some((m) => m.month === requested)) return requested;
  return list.length ? list[list.length - 1].month : requested;
}

export interface CorrectionUploadRow {
  reportDate: string; batchId: string; batchNo: string; fileName: string | null; uploadedAt: string;
  existingCount: number; uploadCount: number; updatedCount: number; insertedCount: number; afterCount: number;
}
export interface CorrectionStatus extends CorrectionUploadRow {
  variance: number; currentCount: number; distinctOrders: number; duplicateCount: number; uploadsForDate: number;
}

/**
 * Data quality / correction status per date (BB-03): the LATEST upload that touched the date, its existing vs
 * uploaded count and Variance = latest upload count - existing dashboard count, plus the live count now and any
 * duplicate orders (live rows - distinct OrderIDs; must be 0).
 */
export function buildCorrectionStatus(
  uploads: CorrectionUploadRow[],
  live: Map<string, { rows: number; distinctOrders: number }>,
): CorrectionStatus[] {
  const latest = new Map<string, CorrectionUploadRow>();
  const count = new Map<string, number>();
  for (const u of uploads) {
    count.set(u.reportDate, (count.get(u.reportDate) ?? 0) + 1);
    const prev = latest.get(u.reportDate);
    if (!prev || u.uploadedAt > prev.uploadedAt) latest.set(u.reportDate, u);
  }
  return [...latest.values()]
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .map((u) => {
      const now = live.get(u.reportDate) ?? { rows: 0, distinctOrders: 0 };
      return {
        ...u, variance: u.uploadCount - u.existingCount, currentCount: now.rows, distinctOrders: now.distinctOrders,
        duplicateCount: Math.max(0, now.rows - now.distinctOrders), uploadsForDate: count.get(u.reportDate) ?? 1,
      };
    });
}
