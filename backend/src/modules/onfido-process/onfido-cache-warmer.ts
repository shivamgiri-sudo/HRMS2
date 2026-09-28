import { getAnalystReport } from "./onfido-analyst-report.service.js";
import { getOverviewReport } from "./onfido-overview-report.service.js";
import { primeOnfidoResponseCache } from "./onfido-response-cache.js";

/**
 * Keeps the two reports the dashboard asks for first -- the Overview (its default tab) and the
 * Analyst report -- warm in the response cache. Computed cold they take 20-26 s against the
 * multi-GB Onfido tables, longer than the page waits, so whoever opened the dashboard after a
 * restart, an upload or a cache expiry saw "temporarily unavailable" instead of data.
 *
 * The cache is keyed by the request URL, so the keys here reproduce byte for byte what the page
 * sends on first load (Overview: last 90 days, monthly; Analyst: last 30 days) and the body is the
 * same `{ success, data }` the routes send. Other tabs vary too much (TL/AM filters, granularity,
 * dimension) to warm by exact key, and are far cheaper to compute.
 */

const REFRESH_MS = 25 * 60_000; // the cache keeps an entry for 30 minutes
const OVERVIEW_DAYS = 90;
const ANALYST_DAYS = 29;

const pad = (n: number): string => String(n).padStart(2, "0");
const localIso = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function shiftLocal(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** The cache keys (request URLs) the dashboard uses on first load, for the given moment. */
export function onfidoWarmKeys(now: Date = new Date()): {
  overview: string;
  analyst: string;
} {
  const to = localIso(now);
  return {
    overview: `/api/onfido-process/overview-report?from=${localIso(shiftLocal(now, -OVERVIEW_DAYS))}&to=${to}&granularity=monthly`,
    analyst: `/api/onfido-process/analyst-report?from=${localIso(shiftLocal(now, -ANALYST_DAYS))}&to=${to}`,
  };
}

/** Computes both reports one after the other (never in parallel) and primes the cache. */
export async function warmOnfidoCacheOnce(
  now: Date = new Date(),
): Promise<{ warmed: number; failed: number }> {
  const keys = onfidoWarmKeys(now);
  const to = localIso(now);
  const jobs: { name: string; key: string; run: () => Promise<unknown> }[] = [
    {
      name: "overview-report",
      key: keys.overview,
      run: () =>
        getOverviewReport(
          {
            from: localIso(shiftLocal(now, -OVERVIEW_DAYS)),
            to,
            tlName: undefined,
            amName: undefined,
          },
          "monthly",
        ),
    },
    {
      name: "analyst-report",
      key: keys.analyst,
      run: () =>
        getAnalystReport({
          from: localIso(shiftLocal(now, -ANALYST_DAYS)),
          to,
          tlName: undefined,
          amName: undefined,
        }),
    },
  ];

  let warmed = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const data = await job.run();
      primeOnfidoResponseCache(job.key, { success: true, data });
      warmed++;
    } catch (err) {
      failed++;
      console.warn(
        `[onfido-cache-warmer] ${job.name} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { warmed, failed };
}

let timer: ReturnType<typeof setInterval> | undefined;

export function startOnfidoCacheWarmer(): void {
  if (timer) return;
  const run = (): void => {
    warmOnfidoCacheOnce().catch((err: unknown) => {
      console.warn(
        "[onfido-cache-warmer] warm-up failed:",
        err instanceof Error ? err.message : err,
      );
    });
  };
  run();
  timer = setInterval(run, REFRESH_MS);
  timer.unref();
}

export function stopOnfidoCacheWarmer(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
