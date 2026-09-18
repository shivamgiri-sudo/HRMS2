/**
 * One-off: run the real backend import engine against the reporting-manager
 * batch that was validated but never imported (BATCH-1785574877850, 1 Aug).
 *
 * Calls the EXACT SAME function the "Import" button uses (importReportingManagerBatch)
 * — includes the effective-dated manager-change history and audit logging.
 * This upload type applies immediately (not approval-gated), so this DOES
 * change employees.reporting_manager_id for every valid row.
 *
 * Not meant to be kept — delete after running.
 */
import { importReportingManagerBatch } from "../modules/bulk-upload/reporting-manager-bulk.service.js";

const BATCH_ID = process.argv[2];
const UPLOADER_USER_ID = process.argv[3];

if (!BATCH_ID || !UPLOADER_USER_ID) {
  console.error("Usage: tsx process-stuck-reporting-manager-batch.ts <batchId> <uploaderUserId>");
  process.exit(1);
}

console.log("[start]", new Date().toISOString());

async function main() {
  const outcome = await importReportingManagerBatch(BATCH_ID, UPLOADER_USER_ID);
  console.log("[done]", new Date().toISOString());
  console.log(JSON.stringify(outcome, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[error]", err);
  process.exit(1);
});
