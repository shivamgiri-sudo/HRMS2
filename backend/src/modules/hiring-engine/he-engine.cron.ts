// Hiring Engine scheduler: every 5 minutes runs the engine tick (slots, invites, reminders, arrivals, no-shows)
// and the branch HR arrival alert. It is ON when the owner switches "Automatic follow-ups" on in the Hiring Engine screen, or via the environment:
//   HE_ENGINE_ENABLED=true + HE_ENGINE_LIVE=true -> live;  HE_ENGINE_ENABLED=true alone -> a DRY RUN that only logs what it would do
// HE_SENDS_PAUSED=true additionally stops every outbound message immediately (state hygiene still runs).
import { logger } from "../../logger.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { runEngineTick } from "./he-engine.service.js";
import { engineAutoOn, engineMode, recordEngineTick } from "./he-policy.service.js";
import { runHrArrivalAlerts } from "./he-alert.service.js";
import { listPrefixes, refreshHistoryChunk } from "./he-master.service.js";
import { refreshProfilesChunk } from "./he-profile.service.js";
import { refreshAllExEmployees } from "./he-ex-employee.service.js";
import { learnMatchWeights, learnShowUp } from "./he-showup.service.js";

const INTERVAL_MS = 5 * 60 * 1000;
let _timer: NodeJS.Timeout | null = null;
let _running = false;

export async function runHiringEngineTick(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (_running) return; // a slow tick must never overlap the next one
  _running = true;
  let lock: Awaited<ReturnType<typeof db.getConnection>> | null = null;
  try {
    const mode = engineMode(env, await engineAutoOn());
    if (mode === "off") return;
    // The scheduler runs in the API process and in the worker process: one MySQL advisory lock makes sure only one of them ticks at a time.
    lock = await db.getConnection();
    const [got] = await lock.execute<RowDataPacket[]>("SELECT GET_LOCK('he_engine_tick', 0) AS ok");
    if (Number(got[0]?.ok) !== 1) return;
    const dryRun = mode !== "live";
    const tick = await runEngineTick({ dryRun });
    const alerts = await runHrArrivalAlerts({ dryRun });
    if (!dryRun) await recordEngineTick();
    logger.info({ dryRun, tick, alerts }, "[he-engine] tick finished");
    await runNightlyMasterRefresh();
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-engine] tick failed");
  } finally {
    if (lock) { try { await lock.execute("SELECT RELEASE_LOCK('he_engine_tick')"); } catch { /* connection closing releases it */ } lock.release(); }
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
    await refreshAllExEmployees();
    for (const p of await listPrefixes()) { await refreshHistoryChunk({ prefix: p }); await refreshProfilesChunk(p); }
    await learnShowUp();
    await learnMatchWeights();
    logger.info({ ms: Date.now() - started }, "[he-engine] nightly master refresh finished");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[he-engine] nightly master refresh failed");
  }
}

export function startHiringEngineScheduler(env: NodeJS.ProcessEnv = process.env): void {
  // Always started: each run first asks whether the engine is on (the screen switch or the HE_ENGINE_* flags) and does nothing when it is off.
  if (_timer) return;
  _timer = setInterval(() => void runHiringEngineTick(env), INTERVAL_MS);
}

export function stopHiringEngineScheduler(): void {
  if (_timer) clearInterval(_timer);
  _timer = null;
}
