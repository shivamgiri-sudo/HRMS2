import {
  syncAprMetrics,
  syncConversionMetrics,
  syncQualityMetrics,
  syncSalesBrandMisMetrics,
  syncSalesOrderMetrics,
} from "./kpi-data-connector.service.js";
import { previewPerformanceSources } from "./performance-source-preview.service.js";

export type SafeSyncSource = "apr" | "quality" | "conversion" | "salesBrandMis" | "salesOrders";

export type SafeSyncResult = {
  date: string;
  yearMonth: string;
  mode: "dry-run" | "apply";
  sources: SafeSyncSource[];
  results: Record<string, unknown>;
  note: string;
};

export type SafeSyncRangeResult = {
  from: string;
  to: string;
  yearMonth: string;
  mode: "dry-run" | "apply";
  sources: SafeSyncSource[];
  dates: string[];
  results: Record<string, unknown>;
  note: string;
};

const DEFAULT_SOURCES: SafeSyncSource[] = ["quality", "conversion", "salesBrandMis", "salesOrders"];
const ALL_SOURCES: SafeSyncSource[] = ["apr", ...DEFAULT_SOURCES];
const SAFE_SOURCE_SET = new Set<SafeSyncSource>(ALL_SOURCES);

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function yesterday(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid --date value "${value}". Expected YYYY-MM-DD.`);
  }
  return value;
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function enumerateDates(from: string, to: string): string[] {
  const start = validateDate(from);
  const end = validateDate(to);
  if (start > end) throw new Error("--from must be before or equal to --to");

  const dates: string[] = [];
  for (let current = start; current <= end; current = nextDate(current)) {
    dates.push(current);
    if (dates.length > 31) throw new Error("Date range is limited to 31 days per safe sync run.");
  }
  return dates;
}

export function parseSafeSyncSources(input?: string): SafeSyncSource[] {
  if (!input || input.trim() === "") return [...DEFAULT_SOURCES];
  const values = input.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length) return [...DEFAULT_SOURCES];

  const invalid = values.filter((value): value is string => !SAFE_SOURCE_SET.has(value as SafeSyncSource));
  if (invalid.length) {
    throw new Error(`Invalid source(s): ${invalid.join(", ")}. Allowed: ${ALL_SOURCES.join(", ")}`);
  }

  return [...new Set(values as SafeSyncSource[])];
}

export function resolveSafeSyncInput(input: {
  date?: string;
  yearMonth?: string;
  sources?: string;
  apply?: boolean;
}): { date: string; yearMonth: string; sources: SafeSyncSource[]; apply: boolean } {
  const date = validateDate(input.date ?? yesterday(todayInIndia()));
  return {
    date,
    yearMonth: input.yearMonth ?? date.slice(0, 7),
    sources: parseSafeSyncSources(input.sources),
    apply: Boolean(input.apply),
  };
}

export async function runSafePerformanceSync(input: {
  date?: string;
  yearMonth?: string;
  sources?: string;
  apply?: boolean;
}): Promise<SafeSyncResult> {
  const resolved = resolveSafeSyncInput(input);

  if (!resolved.apply) {
    const preview = await previewPerformanceSources({ date: resolved.date, yearMonth: resolved.yearMonth });
    return {
      date: resolved.date,
      yearMonth: resolved.yearMonth,
      mode: "dry-run",
      sources: resolved.sources,
      results: Object.fromEntries(resolved.sources.map((source) => [source, preview.sources[source]])),
      note: "Dry run only. No KPI facts were written.",
    };
  }

  const results: Record<string, unknown> = {};
  for (const source of resolved.sources) {
    if (source === "apr") results[source] = await syncAprMetrics(resolved.date);
    if (source === "quality") results[source] = await syncQualityMetrics(resolved.yearMonth);
    if (source === "conversion") results[source] = await syncConversionMetrics(resolved.date);
    if (source === "salesBrandMis") results[source] = await syncSalesBrandMisMetrics(resolved.date);
    if (source === "salesOrders") results[source] = await syncSalesOrderMetrics(resolved.date);
  }

  return {
    date: resolved.date,
    yearMonth: resolved.yearMonth,
    mode: "apply",
    sources: resolved.sources,
    results,
    note: "Selected KPI source syncs executed. Review per-source synced/skipped/errors before expanding date range.",
  };
}

export async function runSafePerformanceSyncRange(input: {
  from: string;
  to: string;
  yearMonth?: string;
  sources?: string;
  apply?: boolean;
}): Promise<SafeSyncRangeResult> {
  const dates = enumerateDates(input.from, input.to);
  const sources = parseSafeSyncSources(input.sources);
  const yearMonth = input.yearMonth ?? dates[0].slice(0, 7);
  const apply = Boolean(input.apply);
  const results: Record<string, unknown> = {};

  if (sources.includes("quality")) {
    if (apply) {
      results.quality = await syncQualityMetrics(yearMonth);
    } else {
      const preview = await previewPerformanceSources({ date: dates[0], yearMonth });
      results.quality = preview.sources.quality;
    }
  }

  const dailySources = sources.filter((source) => source !== "quality");
  for (const date of dates) {
    const dailyResult = await runSafePerformanceSync({
      date,
      yearMonth,
      sources: dailySources.join(","),
      apply,
    });
    results[date] = dailyResult.results;
  }

  return {
    from: dates[0],
    to: dates[dates.length - 1],
    yearMonth,
    mode: apply ? "apply" : "dry-run",
    sources,
    dates,
    results,
    note: apply
      ? "Selected KPI source syncs executed for the date range. Monthly quality ran once."
      : "Dry run only. No KPI facts were written. Monthly quality preview ran once.",
  };
}
