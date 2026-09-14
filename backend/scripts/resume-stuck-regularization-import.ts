/**
 * Resume a bulk regularization import that died part-way through.
 *
 * BATCH-1788604867017 was created 2026-09-05 16:11:20 and last touched at 16:11:42 — twenty-two
 * seconds later — with batch_status still 'importing'. It had staged 2,475 rows and left 1,246
 * sitting at row_status 'valid', never processed. The process did not fail, it stopped: nothing
 * marked the batch failed, so nothing retried it and nothing told anyone.
 *
 * WHY RESUMING IS SAFE. loadStagedRows() selects `row_status IN ('valid','pending')` and so picks
 * up exactly the unprocessed rows — 'imported' and 'error' rows are invisible to it. Re-running
 * the import therefore continues where it stopped rather than duplicating what already landed.
 * The same property makes this re-runnable if it stops again.
 *
 * WHAT THIS DOES NOT DO. The import stages regularizations in `pending`; it does not approve
 * them, and approval is what moves attendance and therefore pay. That decision stays with a
 * reviewer. This only finishes the mechanical half that was interrupted.
 *
 * Dry-run by default. Set APPLY=1 to run the import.
 *
 * Run: ./node_modules/.bin/tsx scripts/resume-stuck-regularization-import.ts
 */
import "dotenv/config";

const BATCH_NO = process.env.BATCH_NO ?? "BATCH-1788604867017";
const APPLY = process.env.APPLY === "1";

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const { importRegularizationBatch } = await import(
    "../src/modules/bulk-upload/attendance-regularization-bulk.service.js"
  );

  const [batchRows]: any = await db.query(
    `SELECT id, upload_batch_no, batch_status, total_rows, imported_rows, error_rows, uploaded_by,
            created_at, updated_at
       FROM upload_batch WHERE upload_batch_no = ?`,
    [BATCH_NO],
  );
  const batch = batchRows[0];
  if (!batch) throw new Error(`Batch ${BATCH_NO} not found`);

  const [counts]: any = await db.query(
    `SELECT row_status, COUNT(*) n FROM upload_batch_row WHERE upload_batch_id = ? GROUP BY 1`,
    [batch.id],
  );
  const pendingRows = counts
    .filter((r: any) => r.row_status === "valid" || r.row_status === "pending")
    .reduce((a: number, r: any) => a + Number(r.n), 0);

  console.log(`${BATCH_NO}: status=${batch.batch_status} total=${batch.total_rows}`);
  console.log(`  created ${batch.created_at}  last touched ${batch.updated_at}`);
  console.table(counts);
  console.log(`rows still to import: ${pendingRows}`);

  if (pendingRows === 0) {
    console.log("Nothing left to import.");
    await (db as any).end?.();
    return;
  }
  if (!APPLY) {
    console.log("\nDRY RUN — no import performed. Re-run with APPLY=1.");
    await (db as any).end?.();
    return;
  }

  // Attributed to whoever uploaded the file, not to whoever is running the recovery — the rows
  // are theirs and the audit trail should say so.
  console.log(`\nImporting as uploader ${batch.uploaded_by} …`);
  const outcome = await importRegularizationBatch(batch.id, batch.uploaded_by);
  console.log("outcome:", JSON.stringify(outcome, null, 2));

  const [after]: any = await db.query(
    `SELECT row_status, COUNT(*) n FROM upload_batch_row WHERE upload_batch_id = ? GROUP BY 1`,
    [batch.id],
  );
  console.log("\nrows after:");
  console.table(after);
  const [[b2]]: any = await db.query(
    `SELECT batch_status, imported_rows, error_rows FROM upload_batch WHERE id = ?`, [batch.id]);
  console.log("batch after:", b2);

  await (db as any).end?.();
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
