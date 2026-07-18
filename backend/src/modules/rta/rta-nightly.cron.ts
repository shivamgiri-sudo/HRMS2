import { reconciliationService, shrinkageService, alertService } from "./rta.service.js";
import { nowIST } from "../../shared/timezone.js";
import { logger } from "../../lib/logger.js";

const RUN_HOUR   = 23;
const RUN_MINUTE = 15; // 15 min after attendance-engine sweep (23:00)
const SYSTEM_USER = "system-rta-nightly";

let nextRun: NodeJS.Timeout | undefined;

function yesterdayIST(): string {
  const today = nowIST().split("T")[0]!;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
}

export async function runRtaNightly(): Promise<{ date: string; reconciled: number; alerts: number }> {
  const date = yesterdayIST();
  logger.info({ date }, "[RTA Nightly] Starting reconciliation + shrinkage + alerts");

  const reconResult = await reconciliationService.reconcileDate(date, { userId: SYSTEM_USER });
  logger.info({ date, ...reconResult }, "[RTA Nightly] Reconciliation complete");

  await shrinkageService.calculateSnapshot(date, { userId: SYSTEM_USER });
  logger.info({ date }, "[RTA Nightly] Shrinkage snapshot written");

  const alertsFired = await alertService.fireAlertsForDate(date, { userId: SYSTEM_USER });
  logger.info({ date, alertsFired }, "[RTA Nightly] Alerts fired");

  return { date, reconciled: reconResult.reconciled, alerts: alertsFired };
}

export function msUntilNextRtaRun(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, RUN_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startRtaNightlyCron(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runRtaNightly();
    } catch (err) {
      logger.error({ err }, "[RTA Nightly] Pipeline failed");
    } finally {
      nextRun = undefined;
      startRtaNightlyCron();
    }
  }, msUntilNextRtaRun());
  nextRun.unref();
}

export function stopRtaNightlyCron(): void {
  if (nextRun) { clearTimeout(nextRun); nextRun = undefined; }
}
