/**
 * Phase 5 parity check — compares tallyExportService.buildEnvelope() (existing, bank-ledger-
 * based) against buildEnvelopeFromJournal() (new, journal-based) for the same bank account and
 * date range. Run this across every active bank account, ideally for a range entirely AFTER
 * Journal Task 3 went live (or after Phase 6's backfill), before switching any real call site
 * from buildEnvelope() to buildEnvelopeFromJournal(). READ-ONLY — never writes.
 *
 * A clean parity report here is the actual "Phase 5 is safe to cut over" signal — not this
 * script's own existence.
 *
 * Usage: npx tsx backend/scripts/verify-tally-export-parity.ts <bankAccountId> [from] [to]
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { tallyExportService } from "../src/modules/finance/tally-export.service.js";

function money(v: number) {
  return `Rs.${(Math.round((v + Number.EPSILON) * 100) / 100).toFixed(2)}`;
}

async function main() {
  const bankAccountId = process.argv[2];
  const from = process.argv[3];
  const to = process.argv[4];
  if (!bankAccountId) {
    console.log("Usage: verify-tally-export-parity.ts <bankAccountId> [from] [to]");
    process.exit(1);
  }

  // tally-export.service.ts calls db.execute (the shared pool) directly, not a passed
  // connection — importing it is enough to exercise both paths against the real database.
  const [oldResult, newResult] = await Promise.all([
    tallyExportService.buildEnvelope(bankAccountId, from, to),
    tallyExportService.buildEnvelopeFromJournal(bankAccountId, from, to),
  ]);

  console.log(`\n=== Tally export parity: bank account ${bankAccountId} ===`);
  console.log(`Existing (bank-ledger-based):  ${oldResult.entryCount} vouchers, total ${money(oldResult.totalDebit)}, isFinal=${oldResult.isFinal}`);
  console.log(`New (journal-based):           ${newResult.entryCount} vouchers, total ${money(newResult.totalDebit)}, isFinal=${newResult.isFinal}`);

  if (oldResult.entryCount !== newResult.entryCount) {
    console.log(`\nMISMATCH: entry counts differ by ${Math.abs(oldResult.entryCount - newResult.entryCount)}.`);
    console.log(`Expected if this range includes vouchers released before Journal Task 3 went live (they have no journal_entry yet — see Phase 6's backfill) or after it but not yet backfilled.`);
  }
  const totalDiff = Math.abs(oldResult.totalDebit - newResult.totalDebit);
  if (totalDiff > 0.01) {
    console.log(`\nMISMATCH: total debit differs by ${money(totalDiff)}.`);
  }
  if (oldResult.entryCount === newResult.entryCount && totalDiff <= 0.01) {
    console.log(`\nParity confirmed for this range.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
