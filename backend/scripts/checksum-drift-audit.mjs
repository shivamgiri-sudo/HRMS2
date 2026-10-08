#!/usr/bin/env node
/**
 * Classify checksum drift on already-applied migrations. Read-only, changes nothing.
 *
 * 380 of 503 applied migrations hash differently to the file on disk, so the runner
 * logs "checksum mismatch for already-applied ..." on every boot. A log line nobody
 * can act on is a log line everybody learns to skip, which is how a real problem hides.
 *
 * The tempting fix — rebaseline every stored checksum to the current file — is wrong
 * and unsafe. A mismatch has two very different causes:
 *
 *   COSMETIC    the file gained comments or whitespace after it ran. The database has
 *               everything the file asks for. Rebaselining is correct.
 *   SUBSTANTIVE the file gained or changed SQL statements after it ran. Those
 *               statements have NEVER executed anywhere. Rebaselining marks the drift
 *               as resolved and guarantees nobody ever finds it.
 *
 * Telling them apart needs the file as it was when it ran, which nothing stores — only
 * its checksum. Git has it: schema_migrations.applied_at gives a timestamp, and the
 * blob at the last commit before that timestamp is the version that ran. When its hash
 * matches the stored checksum, the original is identified with certainty and the two
 * versions can be diffed.
 *
 *   node scripts/checksum-drift-audit.mjs            # summary
 *   node scripts/checksum-drift-audit.mjs --verbose  # every substantive statement
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const REPO = path.resolve(BACKEND, "..");
const VERBOSE = process.argv.includes("--verbose");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function env(key) {
  const raw = fs.readFileSync(path.join(BACKEND, ".env"), "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: REPO, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/**
 * SQL reduced to what the database actually executes: comments gone, whitespace and
 * case normalised. Two files that reduce to the same string are the same migration
 * however differently they are written or documented.
 */
function executableSql(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*--.*$/gm, " ")
    .replace(/\s+--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * Every historical version of every migration, hashed, in two git calls total.
 *
 * The readable implementation — `git show <commit>:<path>` per candidate — spawns up
 * to 60 processes per file and did not finish 380 files in ten minutes on Windows,
 * where process creation is expensive. `git rev-list --objects` lists every blob that
 * has ever existed at these paths in one pass, and `git cat-file --batch` streams all
 * of their contents through a single process. Same answer, two processes instead of
 * twenty thousand.
 *
 * Keyed by content hash, because that is the only thing that identifies which version
 * ran — see the timezone note at the call site.
 */
function buildBlobIndex() {
  const listing = git(["rev-list", "--objects", "--all", "--", "backend/sql"]);
  if (!listing) return new Map();

  const wanted = new Map(); // git object id -> repo path
  for (const line of listing.toString("utf8").split("\n")) {
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const oid = line.slice(0, space);
    const file = line.slice(space + 1).trim();
    if (file.startsWith("backend/sql/") && file.endsWith(".sql")) wanted.set(oid, file);
  }
  if (wanted.size === 0) return new Map();

  // One cat-file process, all objects. Output per object:
  //   "<oid> blob <size>\n" then <size> bytes then "\n"
  const stdin = [...wanted.keys()].join("\n") + "\n";
  const out = execFileSync("git", ["cat-file", "--batch"], {
    cwd: REPO,
    input: stdin,
    maxBuffer: 1024 * 1024 * 1024,
  });

  // Keyed "<path>|<sha256>" — a pipe cannot occur in either half, so the two cannot
  // run together into a colliding key.
  const index = new Map();
  let pos = 0;
  while (pos < out.length) {
    const nl = out.indexOf(0x0a, pos);
    if (nl === -1) break;
    const header = out.subarray(pos, nl).toString("utf8").split(" ");
    const [oid, type, sizeText] = header;
    if (type !== "blob") break;
    const size = Number(sizeText);
    const start = nl + 1;
    const content = out.subarray(start, start + size);
    const file = wanted.get(oid);
    if (file) index.set(`${file}|${sha(content)}`, content);
    pos = start + size + 1;
  }
  return index;
}

const blobIndex = buildBlobIndex();
const findOriginal = (rel, checksum) => blobIndex.get(`${rel}|${checksum}`) ?? null;

const connection = await mysql.createConnection({
  host: env("DB_HOST"),
  port: Number(env("DB_PORT") ?? 3306),
  user: env("DB_USER"),
  password: env("DB_PASSWORD"),
  database: env("DB_NAME"),
  connectTimeout: 30_000,
});
const [rows] = await connection.query(
  "SELECT filename, checksum_sha256, applied_at FROM schema_migrations WHERE success = 1 ORDER BY applied_at",
);
await connection.end();

const buckets = { clean: [], cosmetic: [], substantive: [], unresolved: [], absent: [] };

for (const row of rows) {
  const rel = `backend/sql/${row.filename}`;
  const abs = path.join(BACKEND, "sql", row.filename);
  if (!fs.existsSync(abs)) {
    buckets.absent.push(row.filename);
    continue;
  }

  const current = fs.readFileSync(abs);
  if (sha(current) === row.checksum_sha256) {
    buckets.clean.push(row.filename);
    continue;
  }

  // Find the version that ran by searching this file's own blob history for one whose
  // hash equals the stored checksum.
  //
  // The obvious approach — take applied_at and ask for the commit current at that
  // moment — does not work, and failed on all 380 here before this rewrite. mysql2
  // returns DATETIME as a Date in the process timezone, so serialising it to ISO
  // shifts it by the offset (5.5h for IST) and lands on commits from before the file
  // existed, which git reports as "exists on disk, but not in <sha>". Blob hashes carry
  // no timezone and no clock skew: if some historical version hashes to the stored
  // checksum, that version is what ran, whatever any timestamp claims.
  const original = findOriginal(rel, row.checksum_sha256);

  if (!original) {
    // Could not prove which bytes ran — the file may predate the repo history, or the
    // blob may have been rewritten. Reported separately and never auto-fixed: a guess
    // here is exactly the unsafe rebaseline this script exists to avoid.
    buckets.unresolved.push(row.filename);
    continue;
  }

  const before = executableSql(original.toString("utf8"));
  const after = executableSql(current.toString("utf8"));
  if (before === after) buckets.cosmetic.push(row.filename);
  else buckets.substantive.push({ filename: row.filename, before, after });
}

console.log(`applied migrations : ${rows.length}`);
console.log(`  checksum clean   : ${buckets.clean.length}`);
console.log(`  COSMETIC drift   : ${buckets.cosmetic.length}  (comments/whitespace only — safe to rebaseline)`);
console.log(`  SUBSTANTIVE drift: ${buckets.substantive.length}  (SQL changed after it ran — never executed)`);
console.log(`  unresolved       : ${buckets.unresolved.length}  (original bytes not recoverable from git)`);
console.log(`  file absent      : ${buckets.absent.length}`);

if (buckets.cosmetic.length > 0) {
  console.log(`\nCOSMETIC — identical SQL, only comments/whitespace changed:`);
  for (const name of buckets.cosmetic) console.log(`  - ${name}`);
}

if (buckets.substantive.length > 0) {
  console.log(`\nSUBSTANTIVE — these files contain SQL the database has never run:`);
  for (const item of buckets.substantive) {
    console.log(`  ! ${item.filename}`);
    if (VERBOSE) {
      console.log(`      was ${item.before.length} chars, now ${item.after.length} chars`);
    }
  }
  console.log(`\nDo NOT rebaseline these. Work out whether the added SQL still needs to run.`);
}

if (VERBOSE && buckets.unresolved.length > 0) {
  console.log(`\nUNRESOLVED (original not in git history):`);
  for (const name of buckets.unresolved) console.log(`  ? ${name}`);
}
