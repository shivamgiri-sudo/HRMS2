/**
 * One pass of the DigiLocker reconciler, on demand: asks Luckpay about recent DigiLocker sessions
 * still open on our side and records the ones that finished (bridge -> documents_received, so the
 * joiner leaves the Ops Control Tower's DigiLocker pending list). Dry run lists how many would be
 * checked; --apply makes the provider calls (one status check per candidate).
 *
 *   npx tsx scripts/digilocker-sync-pending.ts [--apply]
 */
import "dotenv/config";
import { findOpenDigilockerSessions, runDigilockerReconciliationOnce } from "../src/workers/digilocker-reconciliation.worker.js";

const APPLY = process.argv.includes("--apply");

(async () => {
  if (!APPLY) {
    const ids = await findOpenDigilockerSessions(200);
    console.log(`DRY RUN: ${ids.length} open DigiLocker session(s) would be checked with Luckpay`);
    process.exit(0);
  }
  const result = await runDigilockerReconciliationOnce(200);
  console.log("APPLIED:", JSON.stringify(result));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
