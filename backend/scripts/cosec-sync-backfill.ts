// Restores the missing 2026-08-05 biometric attendance by running the same
// service POST /api/cosec-sync/run invokes. Snapshots before and after.
import { db } from "../src/db/mysql.js";
import { cosecSyncService } from "../src/modules/wfm/cosec-sync.service.js";

const FROM = process.argv[2] ?? "2026-08-05";
const TO = process.argv[3] ?? FROM;

async function snapshot(label: string) {
  const [bio] = await db.execute<any[]>(
    `SELECT activity_date d, COUNT(*) n FROM integration_biometric_daily
      WHERE activity_date BETWEEN ? AND ? GROUP BY d ORDER BY d`, [FROM, TO]);
  const [adr] = await db.execute<any[]>(
    `SELECT record_date d, attendance_status st, COUNT(*) n, SUM(lwp_value) lwp
       FROM attendance_daily_record WHERE record_date BETWEEN ? AND ?
      GROUP BY d, st ORDER BY d, n DESC`, [FROM, TO]);
  console.log(`\n──── ${label} ────`);
  console.log("integration_biometric_daily:", JSON.stringify(bio));
  console.log("attendance_daily_record:");
  console.table(adr);
}

(async () => {
  console.log(`COSEC sync window: ${FROM} .. ${TO}`);
  await snapshot("BEFORE");

  const t = Date.now();
  const result = await cosecSyncService.sync({ from: FROM, to: TO });
  console.log(`\nsync finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log(`  migratedDays = ${result.migratedDays}`);
  console.log(`  pulledEvents = ${result.pulledEvents}`);
  console.log(`  unmapped     = ${result.unmappedUsers.length}`);
  console.log(`  failed       = ${result.failed.length}`);
  if (result.failed.length) console.log("  first failures:", JSON.stringify(result.failed.slice(0, 5)));

  await snapshot("AFTER");
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
