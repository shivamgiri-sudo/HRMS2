import { AnalyticsError, type DateRangeSpec } from "./analytics.types.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export interface Range { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, "0");
/** Local-calendar YYYY-MM-DD (never toISOString, which shifts a day in IST). */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** A preset (or custom from/to) to concrete inclusive dates; null means "no date filter". Default: last 30 days. */
export function resolveRange(spec: DateRangeSpec | undefined, now = new Date()): Range | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = ymd(today);
  switch (spec?.preset ?? "last_30") {
    case "today": return { from: to, to };
    case "yesterday": { const y = ymd(addDays(today, -1)); return { from: y, to: y }; }
    case "last_7": return { from: ymd(addDays(today, -6)), to };
    case "last_30": return { from: ymd(addDays(today, -29)), to };
    case "last_90": return { from: ymd(addDays(today, -89)), to };
    case "this_week": return { from: ymd(addDays(today, -((today.getDay() + 6) % 7))), to };
    case "this_month": return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case "last_month": return {
      from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)),
    };
    case "this_quarter": return { from: ymd(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1)), to };
    case "this_year": return { from: `${today.getFullYear()}-01-01`, to };
    case "all": return null;
    case "custom": {
      const f = spec?.from ?? "", t = spec?.to ?? "";
      if (!ISO.test(f) || !ISO.test(t)) throw new AnalyticsError("Custom dates must be YYYY-MM-DD");
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    default: throw new AnalyticsError(`Unknown date preset "${String(spec?.preset)}"`);
  }
}

/** The comparison window: the same number of days just before, or the same dates a year earlier. */
export function shiftRange(r: Range, mode: "previous_period" | "previous_year"): Range {
  const f = parse(r.from), t = parse(r.to);
  if (mode === "previous_year") {
    return { from: ymd(new Date(f.getFullYear() - 1, f.getMonth(), f.getDate())), to: ymd(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate())) };
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1;
  return { from: ymd(addDays(f, -days)), to: ymd(addDays(t, -days)) };
}
