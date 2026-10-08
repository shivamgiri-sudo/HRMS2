/**
 * Print a non-reversible fingerprint of the field-encryption keys.
 *
 *   node scripts/field-key-fingerprint.mjs
 *
 * WHY THIS EXISTS
 *   FIELD_ENCRYPTION_KEY is set only on the production server. To run a backfill from
 *   anywhere else the key has to be present there too — and the danger is not a MISSING
 *   key (isUsingDevEncryptionKey catches that) but a WRONG one. A wrong-but-valid
 *   64-hex key passes every guard and silently produces ciphertext production can never
 *   decrypt. With zero rows encrypted today there is no stored sample to test against,
 *   so checkKeyParity() has nothing to verify and cannot help.
 *
 *   So: run this on the server, run it again wherever the backfill will execute, and
 *   compare the fingerprints. Equal fingerprints prove the same key without the value
 *   ever being displayed, logged, or pasted into a chat window.
 *
 * WHAT IT PRINTS
 *   Presence, length, whether it is the all-zeros dev key, and sha256(key) truncated to
 *   16 hex characters. The key is 256 bits of randomness, so its SHA-256 is not
 *   reversible and the truncated form is safe to read aloud or paste.
 *
 *   It never prints a key.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEV_ENCRYPTION_KEY = "0".repeat(64);
const DEV_BLIND_INDEX_KEY = "f".repeat(64);

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, "..", ".env");

/** env var wins; fall back to backend/.env, whose values are wrapped in double quotes. */
function readKey(name) {
  if (process.env[name]) return process.env[name].trim().replace(/^["']|["']$/g, "");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function report(name, devValue) {
  const key = readKey(name);
  if (!key) {
    console.log(`${name}: ABSENT here`);
    return;
  }
  const norm = key.toLowerCase();
  const valid = /^[0-9a-f]{64}$/.test(norm);
  const fp = crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
  console.log(
    `${name}: present  len=${key.length}  valid_hex=${valid}` +
    `  is_dev_key=${norm === devValue}  FINGERPRINT=${fp}`
  );
}

console.log(`host=${process.env.HOSTNAME || process.env.COMPUTERNAME || "(unknown)"}  node_env=${process.env.NODE_ENV || "(unset)"}`);
report("FIELD_ENCRYPTION_KEY", DEV_ENCRYPTION_KEY);
report("FIELD_BLIND_INDEX_KEY", DEV_BLIND_INDEX_KEY);
console.log("\nFingerprints must match the production host before running any backfill.");
console.log("No key value is printed by this script.");
