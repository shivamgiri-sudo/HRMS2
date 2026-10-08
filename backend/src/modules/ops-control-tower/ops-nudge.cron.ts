// 24h auto nudge for joiners still pending an Ops Control Tower item. Outward-facing, so — like the
// other ATS schedulers in server.ts — it is a no-op unless OPS_AUTO_NUDGE_ENABLED=true. It is also a
// no-op per run while WhatsApp is unconfigured/paused (runAutoNudgeSweep checks), so the flag can be
// turned on before the provider is configured without sending anything.
import { logger } from "../../logger.js";
import { runAutoNudgeSweep } from "./ops-nudge.service.js";

const HOUR_MS = 60 * 60 * 1000;
const RUN_HOUR = 10; // 10:00 server-local (IST on the app host), after the morning roster/attendance jobs

let _timer: NodeJS.Timeout | null = null;

export function msUntilNextRun(now: Date, hour = RUN_HOUR): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runOpsNudgeTick(): Promise<void> {
  try {
    const s = await runAutoNudgeSweep();
    logger.info(s, "[ops-nudge] auto sweep finished");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[ops-nudge] auto sweep failed");
  }
}

export function startOpsNudgeScheduler(env: NodeJS.ProcessEnv = process.env): void {
  if (_timer || env.OPS_AUTO_NUDGE_ENABLED !== "true") return;
  const loop = () => {
    void runOpsNudgeTick();
    _timer = setTimeout(loop, 24 * HOUR_MS);
  };
  _timer = setTimeout(loop, msUntilNextRun(new Date()));
}

export function stopOpsNudgeScheduler(): void {
  if (_timer) clearTimeout(_timer);
  _timer = null;
}
