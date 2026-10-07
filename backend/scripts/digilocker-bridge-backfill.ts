/**
 * One pass of the bridge self-heal (the worker runs the same every 10 minutes): catches
 * ats_onboarding_bridge up with DigiLocker / penny-drop completion recorded elsewhere. Local only.
 * Dry run lists what would change; --apply writes.
 *
 *   npx tsx scripts/digilocker-bridge-backfill.ts [--apply]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { DIGILOCKER_EVIDENCE_SQL, healOnboardingBridge } from "../src/modules/ats/onboarding-bridge-heal.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, COALESCE(b.digilocker_status, 'null') AS bridge
       FROM ats_onboarding_bridge b LEFT JOIN employees e ON e.id = b.employee_id
      WHERE COALESCE(b.digilocker_status, '') <> 'documents_received' AND ${DIGILOCKER_EVIDENCE_SQL}`,
  );
  console.log(`${rows.length} DigiLocker bridge row(s) behind the evidence:`);
  for (const r of rows as RowDataPacket[]) console.log(`  ${r.employee_code ?? "(no employee)"}  bridge=${r.bridge}`);
  if (process.argv.includes("--apply")) console.log("APPLIED:", JSON.stringify(await healOnboardingBridge()));
  else console.log("DRY RUN (pass --apply to write)");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
