// Hiring Engine scheduler: every 5 minutes runs the engine tick (slots, invites, reminders, arrivals, no-shows)
// and the branch HR arrival alert. Two independent switches, both OFF by default:
//   HE_ENGINE_ENABLED=true  -> the scheduler runs at all (otherwise a no-op)
//   HE_ENGINE_LIVE=true     -> it actually sends/writes; anything else is a DRY RUN that only logs what it would do
// HE_SENDS_PAUSED=true additionally stops every outbound message immediately (state hygiene still runs).
import { logger } from "../../logger.js";
import { runEngineTick } from "./he-engine.service.js";
import { runHrArrivalAlerts } from "./he-alert.service.js";
import { listPrefixes, refreshHistoryChunk } from "./he-master.service.js";
import { refreshProfilesChunk } from "./he-profile.service.js";
import { refreshExEmployees } from "./he-ex-employee.service.js";

const INTERVAL_MS = 5 * 60 * 1000;
let _timer: NodeJS.Timeout | null = null;
let _running = false;

export async function runHiringEngineTick(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (_running) return; // a slow tick must never overlap the next one
  _running = true;
  try {
    const dryRun = env.HE_ENGINE_LIVE !== "true";
    const tick = await runEngineTick({ dryRun });
    const alerts = await runHrArrivalAlerts({ dryRun });
    logger.info({ dryRun, tick, alerts }, "[he-engine] tick finished");
    await runNightlyMasterRefresh();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-engine] tick failed");
  } finally {
    _running = false;
  }
}

// Nightly master refresh (02:00-02:59 IST, once per day): history, effort tiers, profiles and former employees, one mobile
// prefix at a time so no single query is heavy. Writes rollup columns only, never sends; runs whenever the scheduler is on.
let _lastMasterDay = "";
const istNow = () => new Date(Date.now() + 5.5 * 3600_000);
export async function runNightlyMasterRefresh(force = false): Promise<void> {
  const ist = istNow();
  const day = ist.toISOString().slice(0, 10);
  if (!force && (ist.getUTCHours() !== 2 || _lastMasterDay === day)) return;
  _lastMasterDay = day;
  const started = Date.now();
  try {
    await refreshExEmployees();
    for (const p of await listPrefixes()) { await refreshHistoryChunk({ prefix: p }); await refreshProfilesChunk(p); }
    logger.info({ ms: Date.now() - started }, "[he-engine] nightly master refresh finished");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-engine] nightly master refresh failed");
  }
}

export function startHiringEngineScheduler(env: NodeJS.ProcessEnv = process.env): void {
  if (_timer || env.HE_ENGINE_ENABLED !== "true") return;
  _timer = setInterval(() => void runHiringEngineTick(env), INTERVAL_MS);
}

export function stopHiringEngineScheduler(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
