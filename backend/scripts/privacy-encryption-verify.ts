/**
 * Privacy Encryption Verify
 *
 * Read-only. Answers the question privacy-encryption-coverage.ts cannot: not "is this column
 * populated" but "is what is in it actually readable, and is it the right value".
 *
 * WHY IT EXISTS
 *   coverage counts rows where the protected column IS NOT NULL. That is a presence check, and
 *   presence is not protection. Ciphertext written with the wrong key is NOT NULL, so it counts
 *   as fully protected while being permanently unreadable — and nothing else notices either,
 *   because every resolve-style reader catches the decrypt failure and falls back to the
 *   plaintext still sitting beside it. The damage only becomes visible when the plaintext is
 *   retired, which is exactly the moment it becomes irreversible.
 *
 *   That is not hypothetical: employee_bank_detail.account_number_enc was measured on 2026-08-09
 *   as 0-of-50 decryptable with the development key, and the guards now in the backfill scripts
 *   exist because of it. This is the after-the-fact counterpart to those guards — they refuse to
 *   write badly, this detects it if something already did.
 *
 * WHAT IT DOES
 *   Discovers every <col>_encrypted / <col>_enc column, samples rows, and for each:
 *     - attempts decryptField()
 *     - where the source plaintext still exists, compares the decrypted value to it
 *   Reports per column: decryptable, round-trip matching, and coverage against the plaintext.
 *
 * USAGE
 *   cd backend
 *   npx tsx scripts/privacy-encryption-verify.ts [--sample=50]
 *
 *   Run it ON THE PRODUCTION HOST. From anywhere else the development key is loaded and every
 *   column will report 0 decryptable — which is a true statement about that shell, not about
 *   the data, and would be alarming for the wrong reason. The script says so in its output.
 *
 * OUTPUT
 *   Table, column and counts only. It never prints a decrypted value, and never writes.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { decryptField, isUsingDevEncryptionKey } from "../src/shared/fieldEncryption.js";
import type { RowDataPacket } from "mysql2";

const SAMPLE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--sample="));
  return arg ? parseInt(arg.split("=")[1], 10) : 50;
})();

const ENCRYPTED_SUFFIX = /_(encrypted|enc)$/;

/** mysql2 returns information_schema labels in either case depending on server config. */
const pick = (r: Record<string, unknown>, k: string): string =>
  String(r[k] ?? r[k.toUpperCase()] ?? "");
const num = (r: Record<string, unknown>, k: string): number =>
  Number(r[k] ?? r[k.toUpperCase()] ?? 0);

interface Finding {
  table: string;
  column: string;
  source: string | null;
  populated: number;
  plaintextPopulated: number | null;
  sampled: number;
  decryptable: number;
  foreign: number;
  roundTripMatched: number | null;
  verdict: string;
}

/**
 * Is this value even a fieldEncryption envelope?
 *
 * Not every `*_encrypted` column in this schema belongs to fieldEncryption. utils/encryption.ts
 * is a separate module with its own key, and it owns at least
 * company_signing_certificate.p12_encrypted / .passphrase_encrypted (dscConfig.service.ts) and
 * ats_candidate.bank_account_no_encrypted, candidate_onboarding_bank_detail.account_no_encrypted
 * and candidate_onboarding_profile.pan_number_encrypted (onboarding-full.service.ts).
 *
 * Judging those by whether decryptField() can read them reported all five as UNREADABLE on the
 * production server — which reads as "87 rows of corrupted PII, including the e-signing
 * certificate" when nothing is wrong at all. A name suffix is not evidence of ownership, so
 * check the envelope shape before drawing any conclusion from a failed decrypt.
 */
function isFieldEncryptionEnvelope(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return false;
    const p = parsed as Record<string, unknown>;
    return typeof p.iv === "string" && typeof p.tag === "string" && typeof p.ct === "string";
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (isUsingDevEncryptionKey()) {
    console.log(
      "WARNING: FIELD_ENCRYPTION_KEY is unset, so the development key is loaded. Every column " +
      "below will report 0 decryptable regardless of the data. Run this on the production host " +
      "for a meaningful answer.\n",
    );
  }

  const [columns] = await db.query<RowDataPacket[]>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() ORDER BY table_name, column_name`,
  );

  const byTable = new Map<string, string[]>();
  for (const r of columns as Array<Record<string, unknown>>) {
    const t = pick(r, "table_name");
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t)!.push(pick(r, "column_name"));
  }

  const findings: Finding[] = [];

  for (const [table, cols] of byTable) {
    for (const col of cols) {
      if (!ENCRYPTED_SUFFIX.test(col)) continue;

      // The plaintext it derives from, if that column still exists.
      const base = col.replace(ENCRYPTED_SUFFIX, "");
      const source = cols.find((c) => c.toLowerCase() === base.toLowerCase()) ?? null;

      let populated = 0;
      try {
        const [c] = await db.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${col}\` IS NOT NULL`,
        );
        populated = num(c[0] as Record<string, unknown>, "n");
      } catch {
        continue; // unreadable table — not this script's finding
      }
      if (populated === 0) continue;

      let plaintextPopulated: number | null = null;
      if (source) {
        try {
          const [c] = await db.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS n FROM \`${table}\`
              WHERE \`${source}\` IS NOT NULL AND TRIM(\`${source}\`) <> ''`,
          );
          plaintextPopulated = num(c[0] as Record<string, unknown>, "n");
        } catch {
          plaintextPopulated = null; // e.g. varbinary that TRIM cannot take
        }
      }

      const [rows] = await db.query<RowDataPacket[]>(
        `SELECT \`${col}\` AS ct${source ? `, CAST(\`${source}\` AS CHAR) AS pt` : ""}
           FROM \`${table}\` WHERE \`${col}\` IS NOT NULL LIMIT ${SAMPLE}`,
      );

      let decryptable = 0;
      let matched = 0;
      let comparable = 0;
      let foreign = 0;
      for (const row of rows as Array<{ ct: string; pt?: string | null }>) {
        if (!isFieldEncryptionEnvelope(row.ct)) {
          foreign++;
          continue;
        }
        let plain: string | null = null;
        try {
          plain = decryptField(row.ct);
          decryptable++;
        } catch {
          continue;
        }
        if (row.pt !== undefined && row.pt !== null && String(row.pt).trim() !== "") {
          comparable++;
          if (plain === String(row.pt).trim()) matched++;
        }
      }

      // Owned by another module — this tool has nothing to say about it either way.
      const ours = rows.length - foreign;
      const verdict =
        foreign === rows.length
          ? "FOREIGN — not a fieldEncryption envelope; owned by utils/encryption or similar"
          : foreign > 0
            ? "MIXED FORMAT — some rows are fieldEncryption envelopes and some are not"
            : decryptable === 0
              ? "UNREADABLE — ciphertext does not decrypt with the loaded key"
              : decryptable < ours
                ? "MIXED KEYS — some rows decrypt and some do not"
                : comparable > 0 && matched < comparable
                  ? "MISMATCH — decrypts, but not to the plaintext beside it"
                  : plaintextPopulated !== null && populated < plaintextPopulated
                    ? "INCOMPLETE — plaintext rows still have no ciphertext"
                    : "OK";

      findings.push({
        table, column: col, source,
        populated, plaintextPopulated,
        sampled: rows.length, decryptable, foreign,
        roundTripMatched: comparable > 0 ? matched : null,
        verdict,
      });
    }
  }

  await db.end();

  const order = ["UNREADABLE", "MIXED KEYS", "MIXED FORMAT", "MISMATCH", "INCOMPLETE", "FOREIGN", "OK"];
  findings.sort((a, b) =>
    order.findIndex((o) => a.verdict.startsWith(o)) - order.findIndex((o) => b.verdict.startsWith(o)));

  for (const f of findings) {
    console.log(
      `${f.verdict.split(" —")[0].padEnd(13)} ${f.table}.${f.column}  ` +
      `rows=${f.populated}${f.plaintextPopulated !== null ? `/${f.plaintextPopulated} plaintext` : ""}  ` +
      `sampled=${f.sampled} decrypted=${f.decryptable}` +
      (f.foreign ? ` foreign=${f.foreign}` : "") +
      (f.roundTripMatched !== null ? ` round_trip_ok=${f.roundTripMatched}` : "") +
      (f.verdict === "OK" ? "" : `  <-- ${f.verdict}`),
    );
  }

  // FOREIGN is not a defect: the column simply belongs to another encryption module. Counting it
  // as one is what turned a healthy server into a "87 rows corrupted, e-signing cert unreadable"
  // report on the first production run.
  const bad = findings.filter((f) => f.verdict !== "OK" && !f.verdict.startsWith("FOREIGN"));
  const foreignCount = findings.filter((f) => f.verdict.startsWith("FOREIGN")).length;
  console.log(
    `\n[encryption-verify] ${findings.length} encrypted column(s); ${bad.length} needing attention` +
    (foreignCount ? `; ${foreignCount} owned by another module (not assessed)` : "") +
    `. READ-ONLY: no value was printed, nothing modified.`,
  );
  // Non-zero exit so this can gate a deploy step, but not when the dev key explains it.
  if (bad.length && !isUsingDevEncryptionKey()) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[encryption-verify] failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
