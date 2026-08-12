/**
 * Bank exception report — which payable rows can actually be paid.
 *
 * READ-ONLY. SELECT only; issues no INSERT, UPDATE, DELETE or DDL.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/bank-exception-report.ts [--limit-sample=20]
 *
 * ⚠️ MUST RUN ON THE PRODUCTION HOST
 *   Classifying a row requires DECRYPTING employee_bank_detail.account_number_enc. Anywhere
 *   else loadKey() silently substitutes the all-zeros dev key, every decrypt fails, and
 *   resolveAccountNumberWithConflict() falls back to the legacy plaintext — so every
 *   encrypted row is reported as `legacy_only` and the CONFLICT count, which is the whole
 *   point of the report, comes out as zero. A confidently wrong answer about who can be paid
 *   is worse than no answer, so this refuses to run unless the loaded key decrypts ciphertext
 *   that is already stored.
 *
 * WHY IT USES resolveAccountNumberWithConflict
 *   disbursal.routes.ts and payroll-extended.routes.ts resolve accounts through that helper,
 *   so the payment path and this report agree by construction. A second implementation here
 *   would classify rows the payment path treats differently, which is the failure this report
 *   is meant to detect, not commit.
 *
 * OUTPUT IS SENSITIVE
 *   It never prints an account number. Values are masked to the last 4 digits, the same shape
 *   the /bank-exception-report endpoint already emits for both sides of a conflict. The report
 *   is still a precise map of who cannot be paid — keep it out of the repository.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { checkKeyParity, resolveAccountNumberWithConflict } from "../src/shared/fieldEncryption.js";
import type { RowDataPacket } from "mysql2";

const SAMPLE = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit-sample="));
  return arg ? parseInt(arg.split("=")[1], 10) : 15;
})();

/** RBI format: 4 letters, then 0, then 6 alphanumerics. */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** An account number that is not a plausible account number. */
function isCorruptAccount(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/[Ee]\+?\d/.test(v)) return true;      // Excel scientific notation, e.g. 2.0021E+14
  if (/^0+$/.test(v)) return true;           // all zeros
  if (!/^[0-9]{6,20}$/.test(v)) return true; // Indian account numbers are digits, 6-20 long
  return false;
}

const mask = (v: string | null): string => (v && v.length >= 4 ? `XXXX${v.slice(-4)}` : "XXXX");

async function main(): Promise<void> {
  // Key parity FIRST. Without it every classification below is fiction.
  const [ctRows] = await db.query<RowDataPacket[]>(
    `SELECT account_number_enc FROM employee_bank_detail
      WHERE account_number_enc IS NOT NULL AND account_number_enc <> '' LIMIT 25`,
  );
  const parity = checkKeyParity((ctRows as Array<{ account_number_enc: string }>).map((r) => r.account_number_enc));
  console.log(`[bank-report] key parity: ${parity.decrypted}/${parity.sampled} decrypt`);
  if (!parity.ok) {
    console.error(
      "[bank-report] REFUSING TO RUN — the loaded key cannot read stored ciphertext. " +
      "Off-host this is the all-zeros dev key, and every encrypted row would be misreported " +
      "as legacy-only with a CONFLICT count of zero. Run this on the production host.",
    );
    process.exitCode = 1;
    return;
  }

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            b.id AS bank_detail_id, b.account_number_enc, b.account_number AS account_number_legacy,
            b.ifsc_code, b.verified
       FROM employees e
       LEFT JOIN employee_bank_detail b
         ON b.employee_id = e.id AND b.is_primary = 1 AND b.active_status = 1
      WHERE e.active_status = 1`,
  );

  const buckets = {
    OK: [] as string[],
    MISSING: [] as string[],
    CONFLICT: [] as string[],
    INVALID: [] as string[],
    UNVERIFIED: [] as string[],
  };
  const detail: Array<{ code: string; cls: string; note: string }> = [];

  for (const r of rows as any[]) {
    const code = String(r.employee_code ?? r.id);

    if (!r.bank_detail_id) {
      buckets.MISSING.push(code);
      detail.push({ code, cls: "MISSING", note: "no primary bank record" });
      continue;
    }

    const res = resolveAccountNumberWithConflict({
      account_number_enc: r.account_number_enc,
      account_number: r.account_number_legacy,
    });

    if (res.status === "missing") {
      buckets.MISSING.push(code);
      detail.push({ code, cls: "MISSING", note: "both sources empty" });
      continue;
    }
    if (res.status === "conflict") {
      buckets.CONFLICT.push(code);
      detail.push({ code, cls: "CONFLICT", note: `enc ${mask(res.encValue)} vs legacy ${mask(res.legacyValue)}` });
      continue;
    }

    const ifsc = String(r.ifsc_code ?? "").trim().toUpperCase();
    const acct = res.resolved ?? "";
    const badIfsc = !IFSC_RE.test(ifsc);
    const badAcct = isCorruptAccount(acct);
    if (badIfsc || badAcct) {
      buckets.INVALID.push(code);
      detail.push({
        code, cls: "INVALID",
        note: [badAcct ? "account not a plausible number" : "", badIfsc ? `ifsc '${ifsc || "(empty)"}'` : ""]
          .filter(Boolean).join(", "),
      });
      continue;
    }

    if (Number(r.verified ?? 0) !== 1) {
      buckets.UNVERIFIED.push(code);
      detail.push({ code, cls: "UNVERIFIED", note: "bank record never verified" });
      continue;
    }

    buckets.OK.push(code);
  }

  const total = (rows as any[]).length;
  const unresolved = buckets.MISSING.length + buckets.CONFLICT.length + buckets.INVALID.length;

  console.log(`\n[bank-report] active employees: ${total}`);
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`  ${k.padEnd(11)} ${String(v.length).padStart(6)}`);
  }
  console.log(`\n  unresolved (MISSING + CONFLICT + INVALID): ${unresolved}`);
  console.log(`  payment release gate: ${unresolved === 0 ? "CLEAR" : "BLOCKED"}`);
  console.log(
    `\n  UNVERIFIED is reported separately and does NOT block the gate: the account resolves ` +
    `and is well-formed, but nobody has confirmed it belongs to the employee.`,
  );

  console.log(`\n--- sample of unresolved rows (accounts masked) ---`);
  for (const d of detail.filter((x) => x.cls !== "UNVERIFIED").slice(0, SAMPLE)) {
    console.log(`  ${d.code.padEnd(12)} ${d.cls.padEnd(9)} ${d.note}`);
  }
}

main()
  .catch((err) => {
    // `err.message` alone is not enough here. A pool connection failure arrives as an
    // AggregateError whose message is the EMPTY STRING, so the obvious
    // `console.error(err.message)` prints "[bank-report] FATAL" and nothing else — which is
    // indistinguishable from a silent success and sent me looking in the wrong place.
    // Observed exactly that off-host: AggregateError, code ECONNREFUSED, message "".
    const e = err as { name?: string; code?: string; errno?: number; message?: string };
    const parts = [e?.name, e?.code, e?.errno != null ? `errno=${e.errno}` : "", e?.message]
      .filter((p) => p !== undefined && p !== null && String(p).trim() !== "");
    console.error(`[bank-report] FATAL ${parts.join(" | ") || String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => { void (db as unknown as { end?: () => Promise<void> }).end?.(); });
