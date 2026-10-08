/**
 * Sends the address-BGV link to recently approved / profile-submitted candidates who never got
 * one. The approval-time trigger fires once and skips silently when the address is not on file
 * yet; this closes that gap. Opt out with ADDRESS_BGV_AUTO_SWEEP_ENABLED=false.
 */
const TICK_MS = 15 * 60 * 1000;
const BATCH_SIZE = 5;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startAddressBgvLinkSweepWorker(): void {
  if (process.env.ADDRESS_BGV_AUTO_SWEEP_ENABLED === "false") {
    console.log("[address-bgv-sweep] disabled (ADDRESS_BGV_AUTO_SWEEP_ENABLED=false)");
    return;
  }
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    if (running) return;
    running = true;
    void import("../modules/ats/bgv-address-verification.routes.js")
      .then(({ sweepMissingAddressBgvLinks }) => sweepMissingAddressBgvLinks(BATCH_SIZE))
      .then((n) => { if (n) console.log(`[address-bgv-sweep] tick processed ${n} candidate(s)`); })
      .catch((error) => console.warn("[address-bgv-sweep] tick failed:", error))
      .finally(() => { running = false; });
  }, TICK_MS);
  console.log(`[address-bgv-sweep] started (every ${TICK_MS / 60000}m, batch ${BATCH_SIZE})`);
}

export function stopAddressBgvLinkSweepWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
