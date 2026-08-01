#!/usr/bin/env node
/**
 * Runs the whole backend suite and fails on any test that is newly broken.
 *
 * Why this exists: 297 backend test files live in this repo and 19 were named in
 * ci.yml, so 278 could rot without anyone noticing. One of them did. The ATS
 * assessment catalog test had never been listed in CI, and it sat red long
 * enough to hide a real regression — a `manualReview: true` line deleted as
 * collateral in an unrelated commit, which silently downgraded every free-text
 * hiring-assessment answer from human review to keyword matching.
 *
 * The recorded objection to a blanket `vitest run` is correct: the pre-existing
 * backlog would make CI permanently red and therefore ignored. So the suite runs
 * in full and is compared against a baseline of known failures. That draws the
 * line at today — everything already broken is written down, and anything newly
 * broken fails the build.
 *
 * Two directions are enforced, and both matter:
 *   - a failing test NOT in the baseline  -> you broke something
 *   - a baseline entry that now PASSES    -> you fixed something; delete the
 *     entry, so this file shrinks instead of becoming a list of stale excuses
 *
 * Usage:
 *   node scripts/check-test-baseline.mjs            # verify (CI)
 *   node scripts/check-test-baseline.mjs --update   # re-record the baseline
 *
 * Re-recording is deliberate: it should accompany an explanation of why a newly
 * failing test is acceptable, never be used to turn a red build green.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { tmpdir } from "node:os";

const BASELINE = resolve(process.cwd(), "test-failure-baseline.json");
const UPDATE = process.argv.includes("--update");
const ROOT = process.cwd();

function runSuite(only = []) {
  const dir = mkdtempSync(join(tmpdir(), "vitest-baseline-"));
  // Forward slashes: vitest writes this path itself, and a Windows backslash
  // path survives argv but not its own normalisation.
  const out = join(dir, "results.json").replace(/\\/g, "/");
  try {
    let spawnError = null;
    try {
      // Invoke vitest's entry directly rather than through npx: npx.cmd needs a
      // shell on Windows, and without one the spawn fails silently, which would
      // otherwise be indistinguishable from "everything passed".
      execFileSync(
        process.execPath,
        [
          resolve(ROOT, "node_modules/vitest/vitest.mjs"),
          "run",
          ...only,
          "--reporter=json",
          `--outputFile=${out}`,
        ],
        { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"], timeout: 45 * 60 * 1000 },
      );
    } catch (error) {
      // A non-zero exit is expected whenever a test fails; the JSON is what
      // matters. Keep the error only to explain an absent report.
      spawnError = error;
    }
    if (!existsSync(out)) {
      console.error("vitest produced no JSON report — the run itself failed to start.");
      if (spawnError) console.error(String(spawnError.message ?? spawnError));
      process.exit(2);
    }
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Stable id for one test: repo-relative file plus its full name. */
function idsOfFailures(report) {
  const ids = [];
  for (const suite of report.testResults ?? []) {
    const file = relative(ROOT, suite.name).replace(/\\/g, "/");

    // A suite that fails to import reports no assertions at all. Record the file
    // itself, otherwise a module-level crash would slip through unrecorded.
    const assertions = suite.assertionResults ?? [];
    if (suite.status === "failed" && assertions.length === 0) {
      ids.push(`${file} :: <suite failed to run>`);
      continue;
    }

    for (const test of assertions) {
      if (test.status !== "failed") continue;
      const name = test.fullName || [...(test.ancestorTitles ?? []), test.title].join(" > ");
      ids.push(`${file} :: ${name}`);
    }
  }
  return ids.sort();
}

const report = runSuite();
const failing = idsOfFailures(report);

if (UPDATE) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({
      note:
        "Tests known to be failing. Anything not listed here fails CI. When you fix one, delete its line — the checker also fails if a listed test starts passing, so this file cannot rot.",
      recorded: failing.length,
      failures: failing,
    }, null, 2)}\n`,
  );
  console.log(`Recorded ${failing.length} known failures to ${relative(ROOT, BASELINE)}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`Missing ${relative(ROOT, BASELINE)}. Run with --update to create it.`);
  process.exit(2);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE, "utf8")).failures ?? []);
const nowFailing = new Set(failing);

let newlyBroken = failing.filter((id) => !baseline.has(id));
let nowFixed = [...baseline].filter((id) => !nowFailing.has(id)).sort();

// Confirm before accusing. This suite has timeout-prone tests, and a gate that
// cries wolf on flake is a gate someone switches off. Re-run only the files that
// look newly broken and keep just the ones that fail twice.
if (newlyBroken.length) {
  const files = [...new Set(newlyBroken.map((id) => id.split(" :: ")[0]))];
  console.log(`\nRe-running ${files.length} file(s) to rule out flake...`);
  const confirmed = new Set(idsOfFailures(runSuite(files)));
  const flaky = newlyBroken.filter((id) => !confirmed.has(id));
  newlyBroken = newlyBroken.filter((id) => confirmed.has(id));
  if (flaky.length) {
    console.log(`  ${flaky.length} passed on retry — treating as flake, not a regression:`);
    for (const id of flaky) console.log(`    ${id}`);
  }
}

// Same treatment in the other direction. A baseline entry that "now passes"
// only because the suite was lucky this run is not fixed, and demanding its
// removal makes the next run fail for the opposite reason — three consecutive
// full runs here produced 135, 137 and 131 failures. Re-run the files involved
// and keep only the entries that pass twice.
let flakyFixed = [];
if (nowFixed.length) {
  const files = [...new Set(nowFixed.map((id) => id.split(" :: ")[0]))];
  console.log(`\nRe-running ${files.length} file(s) to confirm ${nowFixed.length} fix(es)...`);
  const stillFailing = new Set(idsOfFailures(runSuite(files)));
  flakyFixed = nowFixed.filter((id) => stillFailing.has(id));
  nowFixed = nowFixed.filter((id) => !stillFailing.has(id));
  if (flakyFixed.length) {
    console.log(`  ${flakyFixed.length} failed on retry — flaky, keeping in the baseline:`);
    for (const id of flakyFixed) console.log(`    ${id}`);
  }
}

console.log(
  `suite: ${report.numPassedTests ?? 0} passed, ${report.numFailedTests ?? 0} failed; ` +
  `baseline: ${baseline.size} known`,
);

if (newlyBroken.length) {
  console.error(`\n${newlyBroken.length} test(s) newly failing — not in the baseline:\n`);
  for (const id of newlyBroken) console.error(`  ${id}`);
  console.error("\nFix them, or justify the regression and re-record with --update.\n");
}

if (nowFixed.length) {
  console.error(`\n${nowFixed.length} baseline entr(y/ies) now pass — remove them:\n`);
  for (const id of nowFixed) console.error(`  ${id}`);
  console.error("\nRun: npm run test:baseline:update\n");
}

process.exit(newlyBroken.length || nowFixed.length ? 1 : 0);
