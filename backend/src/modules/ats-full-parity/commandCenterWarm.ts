import { sharedInFlight } from "../dashboards/metrics-in-flight.js";
import { atsFullParityService as svc } from "./atsFullParity.service.js";
import { DEFAULT_WIDE_VIEW_KEY, commandCenterCache, pruneCommandCenterCache } from "./commandCenterCache.js";

/**
 * Fills the Command Center's default view once after boot, so the first visit by an admin, hr or ceo is served from cache
 * instead of paying the 10-43 s cold computation. It shares in-flight work with real requests, so it never doubles up,
 * and a failure is logged and not cached. Not repeated on a timer: later refreshes are triggered by real requests
 * (stale-while-revalidate in the route), so an unused dashboard puts no recurring load on the database.
 */
export async function warmCommandCenter(): Promise<void> {
  try {
    await sharedInFlight(DEFAULT_WIDE_VIEW_KEY, async () => {
      const value = (await svc.commandCenterData({ period: "ALL", bypassScope: true })) as Record<string, unknown>;
      commandCenterCache.set(DEFAULT_WIDE_VIEW_KEY, { at: Date.now(), value });
      pruneCommandCenterCache();
      return value;
    });
  } catch (e) {
    console.error("[command-center] warm-up failed:", (e as Error).message);
  }
}
