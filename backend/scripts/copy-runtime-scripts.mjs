/**
 * Copy the plain-.mjs scripts that compiled workers spawn at runtime into dist/scripts.
 *
 * Runs as part of `npm run build`. tsc emits only what it compiles, so a worker that spawns a
 * .mjs script from backend/dist/src/workers finds nothing at backend/dist/scripts — and
 * deploy.yml ships only backend/dist and backend/sql, never backend/scripts. Found 2026-09-15:
 * db-bill-finance-sync had been failing every night with MODULE_NOT_FOUND since it was added,
 * which froze the billing mirror at 2026-08-19 and left Live P&L showing August revenue as Rs 0.
 *
 * Only scripts a worker actually spawns belong in RUNTIME_SCRIPTS.
 *
 * sync-all-tables-from-dbbill.mjs (db-bill-hr-sync.worker.ts) shipped 2026-09-16, owner-approved
 * ("approved for mas_hrms" / "go ahead") — after review it is nightly, always with
 * --skip-leave-gap --skip-loan-gap (see that worker's docblock: those two write into live
 * leave-balance/payroll-deduction tables, not pure snapshots, and need their own sign-off).
 *
 * sync-salary-gap-from-dbbill.mjs is deliberately NOT listed. It inserts new salary_prep_line
 * rows into FINALIZED historical payroll runs — a materially different, higher-risk write than
 * every other HR sync table — and is excluded from db-bill-hr-sync.worker.ts's spawn call too.
 * Shipping it here would do nothing on its own (nothing spawns it), but keeping it out is the
 * belt-and-suspenders: this file is the one place that decides what nightly automation can touch.
 *
 * Like write-build-info.mjs this never fails the build: a missing file is reported loudly and
 * the worker then logs "sync script not found" at runtime instead of a silent MODULE_NOT_FOUND.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNTIME_SCRIPTS = ["sync-db-bill-snapshot.mjs", "sync-all-tables-from-dbbill.mjs"];

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "dist", "scripts");

try {
  mkdirSync(outDir, { recursive: true });
  for (const name of RUNTIME_SCRIPTS) {
    const from = join(here, name);
    if (!existsSync(from)) {
      console.warn(`[copy-runtime-scripts] MISSING ${from} — the worker that spawns it will not run`);
      continue;
    }
    copyFileSync(from, join(outDir, name));
    console.log(`[copy-runtime-scripts] dist/scripts/${name}`);
  }
} catch (error) {
  console.warn(`[copy-runtime-scripts] could not copy runtime scripts: ${error instanceof Error ? error.message : error}`);
}
