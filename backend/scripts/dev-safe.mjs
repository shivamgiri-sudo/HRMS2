#!/usr/bin/env node
/**
 * Dev server that cannot touch the database schema.
 *
 * `backend/.env` points at the live `mas_hrms`, and migrations run at boot, so
 * simply starting `npm run dev` applies any pending migration to production.
 * That has happened: four migrations were applied to the live database purely
 * as a side effect of starting a dev server to look at a page.
 *
 * This sets SKIP_MIGRATIONS for one run only. It is deliberately NOT put in
 * `backend/.env`, for two reasons:
 *
 *   - dotenv loads that file with `override: true`, so a value there wins over
 *     the shell and nobody could turn migrations back on without editing it;
 *   - the whole machine shares one `.env`, and runPendingMigrations() returns
 *     status "ok" with an empty applied list when skipped. A migration author
 *     would see green and reasonably believe their migration ran. That is how
 *     employee_geofence_alerts logged 167 errors — see schema-presence-check.ts.
 *
 * To apply migrations, do it deliberately: `npm run migrate`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run tsx's JS entry on the current node binary rather than the `tsx` shim:
// Node refuses to spawn a .cmd without `shell: true` (EINVAL on Windows), and
// a shell would mean quoting arguments per-platform. The path is built by hand
// because tsx does not list ./dist/cli.mjs in its package exports, so
// require.resolve cannot reach it.
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..");
const candidates = [
  path.join(backendRoot, "node_modules/tsx/dist/cli.mjs"),
  path.join(backendRoot, "../node_modules/tsx/dist/cli.mjs"), // hoisted
];
const tsxCli = candidates.find(existsSync);
if (!tsxCli) {
  console.error(`Could not find tsx. Looked in:\n  ${candidates.join("\n  ")}`);
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, "watch", "src/server.ts"], {
  stdio: "inherit",
  env: { ...process.env, SKIP_MIGRATIONS: "true" },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
