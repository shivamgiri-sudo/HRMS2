#!/usr/bin/env node
/**
 * Fail a push that quietly deletes protected files.
 *
 * On 31 July 2026 five commits removed merged work from main while describing
 * something else entirely. The worst, 9cb198b2, was titled "fix(budget):
 * normalise copy-forward key to match API snake_case vs camelCase" and
 * contained no budget file at all — it was 38 files, 119 insertions and 1,855
 * deletions, removing four test suites, four SQL migrations and an ATS contract
 * test. Another, d2bdc31e ("gate all ungated routes"), reverted an ownership
 * check and re-exposed employees' UAN and PF member ID to each other.
 *
 * None of this was malicious. Several sessions share one working tree; staging
 * a file by explicit path — which the charter correctly requires — commits
 * whatever that file says on disk, so a stale copy silently reverts whoever
 * changed it since. Branch protection does not help: these were ordinary
 * pushes, not force-pushes.
 *
 * What catches it is noticing that a commit deleted things it never mentioned.
 * Deleting a test or a migration is sometimes right, so this does not forbid it
 * — it requires the commit to say so.
 *
 * Usage:
 *   node scripts/guard-mass-deletion.mjs <base>..<head>
 *
 * Override, when a deletion really is intended, by putting this in the commit
 * message (or the newest message in the range):
 *   [allow-deletions]
 */

import { execFileSync } from "node:child_process";

/** Deleting one of these is a statement, not a detail. */
export const PROTECTED_PATTERNS = [
  { label: "test suite", test: (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) },
  { label: "SQL migration", test: (f) => /^backend\/sql\/\d+.*\.sql$/.test(f) },
  { label: "CI workflow", test: (f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f) },
];

export const OVERRIDE_MARKER = "[allow-deletions]";

/**
 * Total deletions tolerated without a marker.
 *
 * Removing a handful of files while moving code is normal; removing many at
 * once is what every incident looked like. Ten is above routine refactoring and
 * well below the thirty-eight that went unnoticed.
 */
export const BULK_DELETION_LIMIT = 10;

/**
 * @param {Array<{status: string, path: string}>} changes  from `git diff --name-status`
 * @param {string} message  commit message(s) in the range
 * @returns {{ ok: boolean, reasons: string[], deleted: string[], protectedHits: Array<{path:string,label:string}> }}
 */
export function assessDeletions(changes, message) {
  const deleted = changes.filter((c) => c.status === "D").map((c) => c.path);

  const protectedHits = [];
  for (const path of deleted) {
    const match = PROTECTED_PATTERNS.find((p) => p.test(path));
    if (match) protectedHits.push({ path, label: match.label });
  }

  // An explicit marker means a human decided; the guard's job is to make that
  // decision visible, not to prevent it.
  if (message.includes(OVERRIDE_MARKER)) {
    return { ok: true, reasons: [], deleted, protectedHits };
  }

  const reasons = [];
  for (const hit of protectedHits) {
    reasons.push(`deletes a ${hit.label}: ${hit.path}`);
  }
  if (deleted.length > BULK_DELETION_LIMIT) {
    reasons.push(`deletes ${deleted.length} files, over the limit of ${BULK_DELETION_LIMIT}`);
  }

  return { ok: reasons.length === 0, reasons, deleted, protectedHits };
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const range = process.argv[2];
  if (!range) {
    console.error("usage: node scripts/guard-mass-deletion.mjs <base>..<head>");
    process.exit(2);
  }

  let raw;
  try {
    raw = git(["diff", "--name-status", "--diff-filter=D", range]);
  } catch {
    // A shallow clone or an unknown base is not evidence of wrongdoing; do not
    // fail a build over it.
    console.log(`Could not diff ${range}; skipping deletion guard.`);
    return;
  }

  const changes = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      return { status: status.trim(), path: rest.join(" ").trim() };
    })
    .filter((c) => c.path);

  const message = (() => {
    try {
      return git(["log", "--format=%B", range]);
    } catch {
      return "";
    }
  })();

  const verdict = assessDeletions(changes, message);

  if (verdict.ok) {
    if (verdict.deleted.length > 0) {
      console.log(`Deletion guard: ${verdict.deleted.length} file(s) deleted, allowed.`);
    } else {
      console.log("Deletion guard: no deletions.");
    }
    return;
  }

  console.error("Deletion guard FAILED.\n");
  for (const reason of verdict.reasons) console.error(`  - ${reason}`);
  console.error(
    `\nIf these deletions are intended, say so in the commit message with ` +
    `${OVERRIDE_MARKER}.\n` +
    `If they are not, you are probably committing from a stale working tree — ` +
    `fetch and re-check the files before staging.\n`,
  );
  process.exit(1);
}

// Only run the CLI when invoked directly, so the assessment stays importable.
if (process.argv[1] && process.argv[1].endsWith("guard-mass-deletion.mjs")) {
  main();
}
