// Hourly sweep that escalates DPDP withdrawal requests past their decision deadline to the DPO.
// Wired from server.ts next to the breach SLA cron; a failed run is logged and retried next hour.
import { logger } from "../../logger.js";
import { escalateOverdueWithdrawals } from "./dpdp-withdrawal.service.js";

const HOUR_MS = 60 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export async function runWithdrawalSlaSweep(): Promise<number> {
  try {
    const n = await escalateOverdueWithdrawals();
    if (n > 0) logger.warn({ escalated: n }, "[dpdp-withdrawal-sla] escalated overdue withdrawals");
    return n;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[dpdp-withdrawal-sla] sweep failed");
    return 0;
  }
}

export function startWithdrawalSlaCron(): void {
  if (timer) return;
  timer = setInterval(() => { void runWithdrawalSlaSweep(); }, HOUR_MS);
  timer.unref?.();
  void runWithdrawalSlaSweep();
}

export function stopWithdrawalSlaCron(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
