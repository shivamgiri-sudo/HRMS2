/**
 * Rig only: refresh the selection facts cache for every source on the he-e2e2 clone before criteria-selection.e2e.mjs.
 * Refuses any database that is not on the rig container (127.0.0.1:3312) or is the shared rig schema itself.
 *   DB_HOST=127.0.0.1 DB_PORT=3312 DB_USER=root DB_PASSWORD=x DB_NAME=crit_rig npx tsx scripts/he-e2e/criteria-rig-prepare.ts
 */
if (process.env.DB_HOST !== "127.0.0.1" || process.env.DB_PORT !== "3312" || !process.env.DB_NAME || process.env.DB_NAME === "mas_hrms") {
  console.error("refusing: not the rig clone");
  process.exit(2);
}
const { refreshFactCache } = await import("../../src/modules/selection/fact-cache.service.js");
const { db } = await import("../../src/db/mysql.js");
for (const k of ["he", "meta_live", "meta_old"] as const) console.log(JSON.stringify(await refreshFactCache({ sourceKind: k, chunk: 500 })));
await db.end();
