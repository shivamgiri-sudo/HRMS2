/**
 * Recovers eSign signatures that were completed by the employee but never pulled
 * back into HRMS.
 *
 * Every joining-document eSign taken before the identifier fix is stranded: the
 * provider holds a signed PDF, our transaction still reads PENDING, and no
 * file_role='signed' row exists. This walks those transactions and asks the
 * provider what happened.
 *
 * Dry run by default — it will not call the provider without --apply, because
 * checkESignStatus and downloadESignDocument may be billed per call.
 *
 *   npx tsx src/scripts/reconcile-pending-esign.ts
 *   npx tsx src/scripts/reconcile-pending-esign.ts --employee <uuid>
 *   npx tsx src/scripts/reconcile-pending-esign.ts --apply --limit 5
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { syncEsignStatus } from "../modules/integrations/luckpay/luckpay-status.service.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const limit = Number(argv[argv.indexOf("--limit") + 1]) || 25;
const employeeId = argv.includes("--employee") ? argv[argv.indexOf("--employee") + 1] : null;

const TERMINAL = ["signed", "completed", "failed", "expired", "cancelled"];

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT t.id, t.employee_id, t.document_code, t.status,
            t.client_transaction_id, t.provider_reference_id, t.initiated_at,
            e.employee_code, e.full_name,
            c.status AS checklist_status,
            (SELECT COUNT(*) FROM employee_joining_document_file f
              WHERE f.checklist_id = t.checklist_id AND f.file_role = 'signed'
                AND f.deleted_at IS NULL) AS signed_files
       FROM employee_document_esign_transaction t
       JOIN employees e ON e.id = t.employee_id
       LEFT JOIN employee_joining_document_checklist c ON c.id = t.checklist_id
      WHERE t.provider = 'luckpay'
        AND t.status NOT IN (${TERMINAL.map(() => "?").join(",")})
        AND t.client_transaction_id IS NOT NULL
        AND t.provider_reference_id IS NOT NULL
        ${employeeId ? "AND t.employee_id = ?" : ""}
      ORDER BY t.initiated_at DESC
      LIMIT ${limit}`,
    employeeId ? [...TERMINAL, employeeId] : TERMINAL,
  );

  if (!rows.length) {
    console.log("No open eSign transactions to reconcile.");
    await db.end();
    return;
  }

  console.log(`${rows.length} open transaction(s)${apply ? "" : "  [DRY RUN - no provider calls]"}\n`);
  for (const r of rows) {
    console.log(
      `  ${String(r.employee_code).padEnd(10)} ${String(r.document_code).padEnd(24)} ` +
      `status=${String(r.status).padEnd(9)} checklist=${String(r.checklist_status ?? "-").padEnd(18)} ` +
      `signedFiles=${r.signed_files}  ref=${r.provider_reference_id}`,
    );
  }

  if (!apply) {
    console.log("\nRe-run with --apply to query the provider and store any signed artefacts.");
    await db.end();
    return;
  }

  console.log("\nReconciling...\n");
  let recovered = 0;
  let stillPending = 0;
  let failed = 0;

  for (const r of rows) {
    const label = `${r.employee_code} ${r.document_code}`;
    try {
      const outcome = await syncEsignStatus(String(r.client_transaction_id));
      const stored = outcome.storedFiles?.length ?? 0;
      if (outcome.state === "completed") {
        recovered += 1;
        console.log(`  RECOVERED  ${label}  files=${stored}`);
      } else if (outcome.state === "failed") {
        failed += 1;
        console.log(`  FAILED     ${label}  ${outcome.message ?? ""}`);
      } else {
        stillPending += 1;
        console.log(`  PENDING    ${label}  provider=${outcome.providerStatus ?? outcome.state}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`  ERROR      ${label}  ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(`\nrecovered=${recovered} stillPending=${stillPending} failed=${failed}`);
  await db.end();
}

main().catch((error) => {
  console.error("reconcile-pending-esign failed:", error);
  process.exit(1);
});
