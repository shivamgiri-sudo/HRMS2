/**
 * One-off: write one baseline criteria version per requisition (source "backfill"). Idempotent: does nothing once
 * job_requisition_criteria_version has rows. The API also runs it at boot; this script is for a manual run.
 * Usage: npx tsx scripts/selection/backfill-criteria-versions.ts
 */
import { backfillCriteriaVersions } from "../../src/modules/selection/criteria.service.js";
import { db } from "../../src/db/mysql.js";

const n = await backfillCriteriaVersions();
console.log(`[criteria] backfilled ${n} versions`);
await db.end();
