#!/usr/bin/env node
/*
 * Sync the Call Master dashboards from github.com/tausifansari-mcn/Mydashboards into HRMS.
 *
 *   node scripts/sync-mydashboards.mjs                 clone upstream main, copy + rewrite, write sync state
 *   node scripts/sync-mydashboards.mjs --src <dir>     use an existing checkout instead of cloning
 *   node scripts/sync-mydashboards.mjs --check         write nothing; exit 1 if HRMS is behind upstream
 *
 * Synced verbatim (imports rewritten only):
 *   frontend/src/features/call-master/*.tsx          -> src/features/call-master-sync/upstream/
 *   backend/src/modules/call-master/*.service.ts     -> backend/src/modules/call-master/upstream/
 * Never overwritten (HRMS owns them): the shims in src/features/call-master-sync/shim/, upstream-shim/, and
 * mydashboards.routes.ts, which wires each upstream service function to an HRMS-authenticated, branch-scoped route.
 *
 * After copying, every route in upstream's call-master routers is compared with the adapter; a route upstream
 * added that HRMS does not serve is reported (exit 3) so the adapter gets a line instead of the page 404ing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/tausifansari-mcn/Mydashboards.git";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const srcArg = args.includes("--src") ? args[args.indexOf("--src") + 1] : null;

const FE_OUT = join(root, "src/features/call-master-sync/upstream");
const BE_OUT = join(root, "backend/src/modules/call-master/upstream");
const STATE = join(root, ".mydashboards-sync.json");
const ADAPTER = join(root, "backend/src/modules/call-master/mydashboards.routes.ts");

let tmp = null;
let src = srcArg ? resolve(srcArg) : null;
if (!src) {
  tmp = mkdtempSync(join(tmpdir(), "mydashboards-"));
  execFileSync("git", ["clone", "--depth", "1", REPO, tmp], { stdio: "inherit" });
  src = tmp;
}
const sha = execFileSync("git", ["-C", src, "rev-parse", "HEAD"]).toString().trim();

const feSrc = join(src, "frontend/src/features/call-master");
const beSrc = join(src, "backend/src/modules/call-master");
const list = (dir, re) => readdirSync(dir).filter((f) => re.test(f)).sort();

const feRewrites = [
  [/from '@\/lib\/axios'/g, `from '../shim/api'`],
  [/from '@\/store\/authStore'/g, `from '../shim/authStore'`],
];
const beRewrites = [
  [/from '\.\.\/\.\.\/lib\/sourceDb'/g, `from '../upstream-shim/sourceDb.js'`],
  [/from '\.\.\/\.\.\/lib\/prismaClient'/g, `from '../upstream-shim/prismaClient.js'`],
  [/from '\.\/([\w.-]+)'/g, `from './$1.js'`],
];
// Upstream is not compiled under HRMS's strictness (implicit `never[]` accumulators, untyped prisma), so its files
// carry @ts-nocheck: they are verbatim vendor code, and the adapter in front of them stays fully type-checked.
const banner = (rel) =>
  `// @ts-nocheck\n// AUTO-SYNCED from tausifansari-mcn/Mydashboards ${rel} @ ${sha.slice(0, 7)} - do not edit; run scripts/sync-mydashboards.mjs\n`;

const rewrite = (text, rules) => rules.reduce((t, [re, to]) => t.replace(re, to), text);
const outputs = new Map();
for (const f of list(feSrc, /\.tsx$/)) {
  outputs.set(join(FE_OUT, f), banner(`frontend/src/features/call-master/${f}`) + rewrite(readFileSync(join(feSrc, f), "utf8"), feRewrites));
}
for (const f of list(beSrc, /\.service\.ts$/)) {
  outputs.set(join(BE_OUT, f), banner(`backend/src/modules/call-master/${f}`) + rewrite(readFileSync(join(beSrc, f), "utf8"), beRewrites));
}
if (outputs.size === 0) throw new Error(`no upstream call-master files found under ${src}`);

const stale = [...outputs].filter(([p, body]) => !existsSync(p) || readFileSync(p, "utf8") !== body).map(([p]) => p.replace(root + "/", ""));
const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null;

if (check) {
  console.log(stale.length ? `HRMS is behind upstream @ ${sha.slice(0, 7)}:\n  ${stale.join("\n  ")}` : `in sync @ ${sha.slice(0, 7)}`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  process.exit(stale.length ? 1 : 0);
}

for (const dir of [FE_OUT, BE_OUT]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
for (const [p, body] of outputs) writeFileSync(p, body);
writeFileSync(STATE, JSON.stringify({ repo: REPO, sha, files: [...outputs.keys()].map((p) => p.replace(root + "/", "")).sort() }, null, 2) + "\n");
console.log(`synced ${outputs.size} files @ ${sha.slice(0, 7)} (${stale.length} changed, previous ${prev?.sha?.slice(0, 7) ?? "none"})`);

// Route parity: upstream router vs the HRMS adapter.
const routeRe = /\w*[rR]outer\.get\(\s*['"`]([^'"`]+)['"`]/g;
const routes = (text) => [...text.matchAll(routeRe)].map((m) => m[1]);
const upstreamRoutes = routes(readFileSync(join(beSrc, "call-master.routes.ts"), "utf8"));
const adapterRoutes = new Set(routes(readFileSync(ADAPTER, "utf8")));
const missing = upstreamRoutes.filter((r) => !adapterRoutes.has(r));
if (tmp) rmSync(tmp, { recursive: true, force: true });
if (missing.length) {
  console.error(`\nupstream routes with no HRMS adapter entry (add to mydashboards.routes.ts):\n  ${missing.join("\n  ")}`);
  process.exit(3);
}
