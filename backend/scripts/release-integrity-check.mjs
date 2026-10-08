#!/usr/bin/env node
/**
 * Release integrity gate — proves that what is RUNNING is what was APPROVED.
 *
 * WHY THIS EXISTS
 *   deploy-preflight.mjs validates `src/`. Production executes `dist/`. Nothing compared them,
 *   so a green preflight against a stale artifact was not merely possible, it happened:
 *
 *     2026-08-13, production. dist built 16:31, HEAD pulled 20:53 — 35 commits pulled and never
 *     compiled. `npm run preflight` printed "pending: 7 ... OK — safe to restart" while
 *     dist/src/db/runPendingMigrations.js did not contain 1141 or 1142 at all. A restart at that
 *     moment would have applied a different, older set than preflight had just listed, and the
 *     two new migrations would have stayed pending with every check green.
 *
 *     The runtime agreed with itself and disagreed with the source: /api/health/version reported
 *     schema.pending = 0 (true for dist's 497-entry manifest) while preflight reported 7 (true
 *     for src's 505). Neither was lying. They were answering about different manifests.
 *
 *   Three states have to line up and only two were ever checked: PULLED, BUILT, RESTARTED.
 *   `git merge-base --is-ancestor <sha> HEAD` answers only the first and reads like all three.
 *
 * WHAT IT PROVES
 *   A. One SHA end to end:
 *        EXPECTED_GIT_SHA = BACKEND_BUILD_SHA = BACKEND_RUNTIME_SHA
 *                         = WORKER_BUILD_SHA  = WORKER_RUNTIME_SHA
 *   B. One migration manifest end to end:
 *        source manifest == dist manifest   (set equality, not counts — a swap of two entries
 *                                            keeps the count identical)
 *   C. The runtime's own pending-migration resolver agrees, and in --post mode is empty.
 *
 * USAGE
 *   node scripts/release-integrity-check.mjs                    # pre-restart gate
 *   node scripts/release-integrity-check.mjs --post             # post-restart certificate
 *   node scripts/release-integrity-check.mjs --expected-sha <sha>
 *   node scripts/release-integrity-check.mjs --api http://localhost:5055
 *
 *   Exits non-zero on ANY failure. Intended to be non-bypassable in the deploy script: a
 *   release that cannot state one SHA is not a release, it is a guess.
 *
 * READ-ONLY. Reads files, runs `git rev-parse`, and GETs the health endpoint. Writes nothing.
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, "..");
const REPO = resolve(BACKEND, "..");

const argv = process.argv.slice(2);
const POST = argv.includes("--post");
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const API = arg("--api", process.env.RELEASE_CHECK_API || "http://localhost:5055");

const SRC_RUNNER = resolve(BACKEND, "src/db/runPendingMigrations.ts");
const DIST_RUNNER = resolve(BACKEND, "dist/src/db/runPendingMigrations.js");
const BUILD_INFO = resolve(BACKEND, "dist/build-info.json");
const DIST_SERVER = resolve(BACKEND, "dist/src/server.js");
const DIST_WORKERS = resolve(BACKEND, "dist/src/workers/all-workers.js");

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);

/** Manifest entries as a SET. Same regex against .ts and compiled .js — the array survives tsc. */
function manifestOf(file) {
  if (!existsSync(file)) return null;
  const txt = readFileSync(file, "utf8");
  const start = txt.indexOf("MIGRATION_MANIFEST");
  if (start < 0) return null;
  // Stop at the export that follows the array in both forms, else fall back to whole file.
  const endMarkers = ["export type MigrationHealth", "MigrationHealth"];
  let end = -1;
  for (const m of endMarkers) { const i = txt.indexOf(m, start); if (i > 0) { end = i; break; } }
  const body = txt.slice(start, end > 0 ? end : undefined);
  return new Set([...body.matchAll(/["']([0-9]+_[A-Za-z0-9_.-]+\.sql)["']/g)].map((m) => m[1]));
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch { return null; }
}

async function fetchJson(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { __error: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) { return { __error: e?.name === "AbortError" ? "timeout" : String(e?.message || e) }; }
}

/**
 * A process is only proven to be running an artifact if it STARTED AFTER that artifact was
 * written. The worker exposes no endpoint (it only logs its stamp at boot), so this is the
 * available proof for it — and it is a real one: a worker left running while dist was rebuilt
 * under it fails here, which is precisely the case a "we restarted them together" inference
 * waves through.
 */
function processStartedAfter(pmName, artifactPath) {
  if (!existsSync(artifactPath)) return { ok: false, why: `${artifactPath} missing` };
  let pid;
  try { pid = execFileSync("pm2", ["pid", pmName], { encoding: "utf8" }).trim(); }
  catch { return { ok: null, why: "pm2 not available (skipped)" }; }
  if (!pid || pid === "0") return { ok: false, why: `${pmName} not running` };
  let started;
  try { started = execFileSync("ps", ["-o", "lstart=", "-p", pid], { encoding: "utf8" }).trim(); }
  catch { return { ok: null, why: "ps unavailable (skipped)" }; }
  const startMs = Date.parse(started);
  const builtMs = statSync(artifactPath).mtimeMs;
  if (!Number.isFinite(startMs)) return { ok: null, why: `unparsable start time '${started}'` };
  return {
    ok: startMs >= builtMs,
    why: `started ${new Date(startMs).toISOString()} vs artifact ${new Date(builtMs).toISOString()}`,
  };
}

(async () => {
  console.log(`\n=== RELEASE INTEGRITY CHECK ${POST ? "(post-restart certificate)" : "(pre-restart gate)"} ===\n`);

  // ── A. one SHA end to end ────────────────────────────────────────────────
  console.log("A. SHA parity");
  const expected = arg("--expected-sha", gitHead());
  if (!expected) fail("cannot determine EXPECTED_GIT_SHA (no --expected-sha and git unavailable)");
  line("EXPECTED_GIT_SHA", expected ?? "(unknown)");

  let buildSha = null;
  if (!existsSync(BUILD_INFO)) {
    fail(`dist/build-info.json missing — the artifact cannot state which commit it is. Run \`npm run build\`.`);
    line("BACKEND_BUILD_SHA", "(no build-info.json)");
  } else {
    try {
      const bi = JSON.parse(readFileSync(BUILD_INFO, "utf8"));
      buildSha = bi.commit;
      line("BACKEND_BUILD_SHA", `${buildSha}  (builtAt ${bi.builtAt})`);
      // "unknown" is what buildInfo resolves to when the stamp could not be produced. It is a
      // truthful answer and an unacceptable one for a release.
      if (!buildSha || buildSha === "unknown") fail("build-info.json commit is 'unknown' — the build did not capture a SHA");
    } catch (e) { fail(`dist/build-info.json unreadable: ${e.message}`); }
  }

  const ver = await fetchJson(`${API}/api/health/version`);
  let runtimeSha = null;
  if (ver.__error) {
    fail(`cannot read runtime version from ${API}/api/health/version: ${ver.__error}`);
    line("BACKEND_RUNTIME_SHA", "(unreachable)");
  } else {
    runtimeSha = ver.commit;
    line("BACKEND_RUNTIME_SHA", `${runtimeSha}  (startedAt ${ver.startedAt})`);
    if (!runtimeSha || runtimeSha === "unknown") fail("runtime reports commit 'unknown'");
  }

  // Workers share dist/build-info.json, so their BUILD sha is the artifact's by construction;
  // what needs proving is that the worker PROCESS actually loaded it.
  const wStart = processStartedAfter("hrms2-workers", DIST_WORKERS);
  const bStart = processStartedAfter("hrms2-backend", DIST_SERVER);
  line("WORKER_BUILD_SHA", buildSha ? `${buildSha}  (shared dist/build-info.json)` : "(unknown)");
  line("WORKER_RUNTIME_SHA", wStart.ok === null ? `unverified — ${wStart.why}`
    : wStart.ok ? `${buildSha}  (${wStart.why})` : `** STALE ** ${wStart.why}`);
  // PRE vs POST matters here and getting it wrong makes the gate unusable.
  //
  // The pre-restart gate runs immediately after `npm run build`, so the processes are BY
  // DEFINITION older than the artifact just written and still serving the previous commit.
  // Failing on that would fail every deploy at the exact moment it is behaving correctly.
  // What the pre gate must catch is a build that does not match the SOURCE, or a compiled
  // manifest that does not match src/ — neither of which a restart would fix.
  //
  // After the restart, the same two conditions become the actual certificate: a process still
  // older than the artifact means it did not come back on the new code.
  const staleProc = (name, r) =>
    POST ? fail(`${name} is older than the built artifact — it did not restart onto the new code (${r.why})`)
         : notes.push(`${name} still on the previous build — expected before the restart (${r.why})`);
  if (wStart.ok === false) staleProc("hrms2-workers", wStart);
  if (bStart.ok === false) staleProc("hrms2-backend", bStart);
  if (wStart.ok === null) notes.push(`worker runtime SHA unverified: ${wStart.why}`);

  if (expected && buildSha && buildSha !== "unknown" && expected !== buildSha)
    fail(`SOURCE != ARTIFACT — repo HEAD ${expected.slice(0, 12)} but dist was built from ${String(buildSha).slice(0, 12)}. Rebuild.`);
  if (buildSha && runtimeSha && buildSha !== "unknown" && runtimeSha !== "unknown" && buildSha !== runtimeSha) {
    const msg = `ARTIFACT != RUNTIME — dist is ${String(buildSha).slice(0, 12)} but the process is serving ${String(runtimeSha).slice(0, 12)}`;
    // Pre-restart this is the normal state and says nothing is wrong. Post-restart it is the
    // headline failure: built, but never actually loaded.
    if (POST) fail(`${msg}. The restart did not take.`);
    else notes.push(`${msg} — expected before the restart.`);
  }

  // ── B. one migration manifest end to end ─────────────────────────────────
  console.log("\nB. Migration manifest parity (source vs built artifact)");
  const srcSet = manifestOf(SRC_RUNNER);
  const distSet = manifestOf(DIST_RUNNER);
  if (!srcSet) fail(`could not parse MIGRATION_MANIFEST from ${SRC_RUNNER}`);
  if (!distSet) fail(`could not parse MIGRATION_MANIFEST from ${DIST_RUNNER} — is the backend built?`);
  if (srcSet && distSet) {
    line("source entries", srcSet.size);
    line("dist entries", distSet.size);
    const missingInDist = [...srcSet].filter((x) => !distSet.has(x));
    const extraInDist = [...distSet].filter((x) => !srcSet.has(x));
    if (missingInDist.length) {
      fail(`${missingInDist.length} migration(s) in source but NOT in the built artifact — they will NOT run on restart`);
      for (const m of missingInDist.slice(0, 20)) console.log(`      only in source: ${m}`);
    }
    if (extraInDist.length) {
      fail(`${extraInDist.length} migration(s) in the built artifact but NOT in source — the artifact is stale or hand-edited`);
      for (const m of extraInDist.slice(0, 20)) console.log(`      only in dist  : ${m}`);
    }
    if (!missingInDist.length && !extraInDist.length) line("parity", "IDENTICAL");
  }

  // ── C. the runtime's own resolver ────────────────────────────────────────
  console.log("\nC. Runtime pending-migration resolver");
  if (ver.__error || !ver.schema) {
    line("runtime schema", "(unavailable)");
  } else {
    line("applied / pending", `${ver.schema.applied} / ${ver.schema.pending}`);
    line("schema.valid", ver.schema.valid);
    if (POST && ver.schema.pending !== 0) fail(`post-deploy: schema.pending = ${ver.schema.pending}, expected 0`);
    if (POST && ver.schema.valid !== true) fail("post-deploy: runtime reports schema.valid = false");
    // Pre-restart, pending > 0 is expected and fine — but only meaningful once B passes, which
    // is exactly the relationship that was missing before.
    if (!POST && ver.schema.pending > 0 && distSet && srcSet && distSet.size !== srcSet.size)
      notes.push("pending count comes from the DIST manifest; with B failing it does not describe what will actually apply");
  }

  // ── verdict ──────────────────────────────────────────────────────────────
  console.log("");
  for (const n of notes) console.log(`  NOTE: ${n}`);
  if (failures.length) {
    console.error(`\nRELEASE INTEGRITY: FAIL (${failures.length})`);
    for (const f of failures) console.error(`  ! ${f}`);
    console.error("\nA release must be able to state ONE commit. Do not deploy or restart until these agree.\n");
    process.exit(1);
  }
  console.log(`RELEASE INTEGRITY: PASS — source, artifact and runtime all agree${POST ? ", schema fully applied" : ""}.\n`);
})();
