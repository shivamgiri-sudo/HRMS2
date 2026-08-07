#!/usr/bin/env node
/**
 * The path gate. Rejects a patch that touches anything outside its approved allowlist.
 *
 * ⚠ THIS SCRIPT MUST RUN FROM A TRUSTED CHECKOUT OF origin/main, NEVER FROM THE PATCHED TREE.
 *
 *   That is the entire point. If the guard is executed from the working tree that the patch
 *   was applied to, then a patch that edits this file changes the rules it is judged by — a
 *   guard evaluating its own modification. The workflow therefore checks out origin/main to
 *   a separate directory and runs THAT copy, pointing it at the patch file.
 *
 *   The script cannot enforce this about itself; a copy of it in the patched tree would be a
 *   patched copy. What it can do is refuse to run without an explicit --base flag naming the
 *   trusted checkout, and print its own SHA so the workflow log records which copy ran.
 *
 * WHAT IT CHECKS
 *   1. Every path in the diff is in the approved allowlist.
 *   2. No path matches a deny-tier pattern in uat/protected-paths.json — read from the
 *      TRUSTED checkout, so a patch that rewrites the control plane is judged by the real one.
 *   3. The diff deletes nothing: no removed file, and no removed export, route or migration
 *      line. Additive-only is checked structurally, not asked for politely.
 *   4. package.json and the lockfile are untouched (BR-07).
 *
 * Exit 0 means clean. Any non-zero exit is a hard stop with no retry: a guardrail breach is
 * not a flaky test.
 *
 * Usage:
 *   node uat-check-diff.mjs --base <trusted-checkout-dir> --patch <file> --allow <json-file>
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function die(code, message, detail) {
  console.error(`\n[uat-guard] REJECTED: ${message}`);
  if (detail) console.error(detail);
  process.exit(code);
}

const base = arg("base");
const patchFile = arg("patch");
const allowFile = arg("allow");

if (!base || !patchFile || !allowFile) {
  die(
    2,
    "usage: uat-check-diff.mjs --base <trusted-checkout> --patch <file> --allow <json>",
    "--base must point at a checkout of origin/main that the patch has NOT been applied to."
  );
}

// Announce which copy is running. If this hash is not the one from origin/main, the guard
// evaluating the patch is the patched guard, and the log is where that becomes visible.
const selfSha = crypto
  .createHash("sha256")
  .update(fs.readFileSync(new URL(import.meta.url)))
  .digest("hex");
console.log(`[uat-guard] guard sha256 = ${selfSha}`);
console.log(`[uat-guard] trusted base = ${base}`);

if (!fs.existsSync(path.join(base, "uat", "protected-paths.json"))) {
  die(2, `--base does not look like a repository checkout: ${base}`);
}
// A base that also contains the patch is not a trusted base.
if (path.resolve(base) === path.resolve(process.cwd())) {
  die(
    2,
    "--base is the current working directory.",
    "The guard must run from a separate, unpatched checkout of origin/main. Running it from " +
      "the patched tree means a patch could modify the guard that judges it."
  );
}

const protectedPaths = JSON.parse(
  fs.readFileSync(path.join(base, "uat", "protected-paths.json"), "utf8")
);
const allowed = JSON.parse(fs.readFileSync(allowFile, "utf8"));
const allowSet = new Set((Array.isArray(allowed) ? allowed : allowed.allowedPaths || []).map(String));

if (allowSet.size === 0) die(2, "The allowlist is empty. There is nothing this patch may edit.");

const patch = fs.readFileSync(patchFile, "utf8");

/** Same hand-rolled glob as the backend's control-plane.ts — one behaviour, two runtimes. */
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

const denyPatterns = protectedPaths.rules
  .filter((r) => r.tier === "deny")
  .map((r) => ({ pattern: r.pattern, re: globToRegExp(r.pattern), reason: r.reason }));

// ── Parse the diff ────────────────────────────────────────────────────────────

const touched = new Set();
const deletedFiles = [];
const removedLines = [];
let currentFile = null;

for (const line of patch.split(/\r?\n/)) {
  const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (header) {
    currentFile = header[2];
    touched.add(header[1]);
    touched.add(header[2]);
    continue;
  }
  if (line.startsWith("deleted file mode")) {
    if (currentFile) deletedFiles.push(currentFile);
    continue;
  }
  if (line.startsWith("rename from ")) {
    // A rename is a deletion plus an addition as far as "nothing is removed" is concerned.
    deletedFiles.push(line.slice("rename from ".length).trim());
    continue;
  }
  // A removed line: "-" but not the "---" file marker.
  if (line.startsWith("-") && !line.startsWith("---") && currentFile) {
    removedLines.push({ file: currentFile, text: line.slice(1) });
  }
}

if (touched.size === 0) die(2, "The patch touches no files, or could not be parsed.");

// ── 1. Allowlist ──────────────────────────────────────────────────────────────

const outside = [...touched].filter((p) => p !== "/dev/null" && !allowSet.has(p));
if (outside.length) {
  die(
    1,
    `${outside.length} path(s) outside the approved allowlist.`,
    outside.map((p) => `  - ${p}`).join("\n") +
      "\n\nApproved:\n" +
      [...allowSet].map((p) => `  + ${p}`).join("\n")
  );
}

// ── 2. Deny tier ──────────────────────────────────────────────────────────────
// Belt and braces: the allowlist was already intersected against these server-side. This
// re-checks from the TRUSTED control plane, so a patched allowlist cannot smuggle one past.

for (const p of touched) {
  for (const d of denyPatterns) {
    if (d.re.test(p)) {
      die(1, `Protected path in the diff: ${p}`, `  matches ${d.pattern}\n  ${d.reason}`);
    }
  }
}

// ── 3. Additive only ──────────────────────────────────────────────────────────

if (deletedFiles.length) {
  die(1, "The patch deletes or renames files.", deletedFiles.map((f) => `  - ${f}`).join("\n"));
}

// Removing an export, a route registration or a migration entry breaks callers that this
// diff cannot see. Detected structurally rather than trusted to a promise in the prompt.
const DESTRUCTIVE = [
  { re: /^\s*export\s+(async\s+)?(function|const|class|interface|type|enum)\s/, what: "an export" },
  { re: /^\s*(app|router)\.(use|get|post|put|patch|delete)\s*\(/, what: "a route registration" },
  { re: /^\s*"[0-9]{3,4}_[a-z0-9_]+\.sql"/, what: "a migration manifest entry" },
  { re: /^\s*(CREATE|ALTER|DROP)\s+TABLE/i, what: "a DDL statement" },
];

const destructive = [];
for (const { file, text } of removedLines) {
  for (const d of DESTRUCTIVE) {
    if (d.re.test(text)) destructive.push(`  - ${file}: removes ${d.what}\n      ${text.trim().slice(0, 120)}`);
  }
}
if (destructive.length) {
  die(1, "The patch removes something other code may depend on.", destructive.join("\n"));
}

// ── 4. No new dependency ──────────────────────────────────────────────────────

const depFiles = [...touched].filter((p) =>
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(p)
);
if (depFiles.length) {
  die(1, "The patch changes dependency manifests (BR-07).", depFiles.map((p) => `  - ${p}`).join("\n"));
}

// ── 5. No DDL introduced anywhere ─────────────────────────────────────────────

const addedDdl = patch
  .split(/\r?\n/)
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .filter((l) => /\b(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i.test(l));
if (addedDdl.length) {
  die(1, "The patch introduces DDL (DI-01/DI-02).", addedDdl.slice(0, 10).map((l) => `  ${l.trim().slice(0, 140)}`).join("\n"));
}

// ── 6. No unbounded write ─────────────────────────────────────────────────────

const unbounded = patch
  .split(/\r?\n/)
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .filter((l) => /\b(UPDATE|DELETE\s+FROM)\b/i.test(l) && !/\bWHERE\b/i.test(l));
if (unbounded.length) {
  die(
    1,
    "The patch adds an UPDATE or DELETE with no WHERE clause (DI-05).",
    unbounded.slice(0, 10).map((l) => `  ${l.trim().slice(0, 140)}`).join("\n")
  );
}

console.log(`[uat-guard] OK — ${touched.size} path(s), all within the approved allowlist.`);
for (const p of [...touched].sort()) console.log(`[uat-guard]   ${p}`);
process.exit(0);
