import { refreshAhmSnapshot, currentMonthRange, type AhmFilters } from "./ahm-dashboard.service.js";

/**
 * Keeps the AHM dashboard's common ranges warm in mas_hrms.ahm_dashboard_snapshot (sql/1876) so
 * a viewer almost never pays the ~20-45s live-aggregation cost (see ahm-dashboard.service.ts's
 * getAhmDashboard for why that cost exists today). Off unless AHM_SNAPSHOT_SCHEDULER_ENABLED=true
 * -- its own flag, not nested in ENABLE_SCHEDULERS, the same lesson learned from the MIS email
 * scheduler: a broad flag makes it too easy to silently enable/disable unrelated schedulers
 * together.
 *
 * Run it on ONE backend only -- two backends both refreshing just means duplicate work (the
 * upsert is idempotent, so it is not unsafe, just wasteful).
 *
 * Common ranges: "All regions" / "MP" / "MM", current month to date -- the dashboard's own
 * default filters (ahm-dashboard.service.ts's currentMonthRange()). A viewer on a different
 * range still gets served (getAhmDashboard falls back to a live compute + saves its own
 * snapshot), just without the proactive warm-up.
 */
const TICK_MS = 5 * 60_000;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

function commonRanges(): AhmFilters[] {
  const { from, to } = currentMonthRange();
  return [
    { from, to, region: null },
    { from, to, region: "MP" },
    { from, to, region: "MM" },
  ];
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const f of commonRanges()) {
      const t0 = Date.now();
      await refreshAhmSnapshot(f);
      console.log(`[ahm-snapshot] refreshed ${f.from}..${f.to} region=${f.region ?? "ALL"} in ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error("[ahm-snapshot] tick failed:", err instanceof Error ? err.message : err);
  } finally {
    ticking = false;
  }
}

export function startAhmSnapshotScheduler(): void {
  if (timer) return;
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref();
  console.log("[ahm-snapshot] scheduler started (refreshes every 5 min)");
}

export function stopAhmSnapshotScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
