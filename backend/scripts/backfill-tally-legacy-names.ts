/**
 * Copy the legacy Tally names from db_bill into HRMS, so HRMS Tally files use the names the Tally company
 * already has (it was fed by db_bill).
 *
 *   npx tsx scripts/backfill-tally-legacy-names.ts            # dry run
 *   npx tsx scripts/backfill-tally-legacy-names.ts --apply    # fills empty fields only, one transaction
 *
 *   branches   tally_legacy_name (branch: tally_name / tally_code) <- db_bill branch_master.tally_branch /
 *              tally_code, through grn_migration_branch_map. Where several db_bill branches map to one HRMS
 *              branch (HEAD OFFICE 3 and 10), the one this year's MAS GRNs use wins.
 *              An active HRMS branch with no mapping is matched by name, ignoring "office"/"branch" (Delhi Office ->
 *              DELHI / 07, the active db_bill branch).
 *   sub-heads  tally_legacy_name (expense_sub_head: tally_name) <- the db_bill sub-head the legacy import used,
 *              when the wording differs from HRMS ("Computer software cost 26-27" -> "Computer Software Cost
 *              2026 - 27"). Matched ignoring case, spacing, punctuation and "2026 - 27" vs "26-27".
 *   banks      company_bank_account.tally_ledger_name <- db_bill tbl_bank name, replacing the account-number placeholder
 *              (no migration needed; applied even before 2210).
 * Tally itself matches names ignoring case and repeated spaces (tested on TallyPrime 7.2), so those differences
 * are reported but harmless.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const out = (title: string, rows: unknown[], max = 80) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r)}`);
};
const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/(?:20)?(\d{2})\s*-\s*(\d{2})/g, "$1$2").replace(/[^a-z0-9]/g, "");
const tallyEq = (a: unknown, b: unknown) => String(a ?? "").trim().replace(/\s+/g, " ").toLowerCase() === String(b ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const branchKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/\b(office|branch)\b/g, "").replace(/[^a-z0-9]/g, "");
console.log(`mode: ${APPLY ? "APPLY" : "dry run (nothing is written)"}`);

const hasCols = async () => {
  try { await db.query(`SELECT entity_type, entity_id, tally_name, tally_code FROM tally_legacy_name LIMIT 1`); return true; }
  catch { return false; }
};
const ready = await hasCols();
if (!ready) console.log("(migration 2210 not applied yet: no tally_legacy_name table; branches and sub-heads read as empty)");

// ── branches ────────────────────────────────────────────────────────────────────────────────────
const legacyBranches = new Map<number, any>();
for (const b of (await billQuery<any>(`SELECT id, branch_name, tally_branch, tally_code, active FROM branch_master`)) as any[]) legacyBranches.set(Number(b.id), b);
const usage = new Map<number, number>();
for (const u of (await billQuery<any>(`SELECT BranchId, COUNT(*) n FROM expense_entry_master WHERE CompId = 1 AND FinanceYear = '2026-27' GROUP BY BranchId`)) as any[]) usage.set(Number(u.BranchId), Number(u.n));
const [mapRows] = await db.query<RowDataPacket[]>(`SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map`);
const [hrmsBranches] = await db.query<RowDataPacket[]>(
  ready ? `SELECT b.id, b.branch_name, b.active_status, t.tally_name AS tally_cost_category, t.tally_code AS tally_cost_centre_code
             FROM branch_master b LEFT JOIN tally_legacy_name t ON t.entity_type = 'branch' AND t.entity_id = b.id`
        : `SELECT id, branch_name, active_status, NULL AS tally_cost_category, NULL AS tally_cost_centre_code FROM branch_master`);
const branchUpdates: any[] = [];
const branchNotes: string[] = [];
for (const hb of hrmsBranches) {
  let candidates = mapRows.filter((m) => String(m.hrms_branch_id) === String(hb.id)).map((m) => legacyBranches.get(Number(m.dbbill_branch_id))).filter(Boolean);
  // No GRN mapping (e.g. "Delhi Office", no GRNs yet): match the db_bill branch by name, ignoring "office"/"branch".
  if (!candidates.length && Number(hb.active_status) === 1) {
    const key = branchKey(hb.branch_name);
    candidates = [...legacyBranches.values()].filter((l) => branchKey(l.branch_name) === key || branchKey(l.tally_branch) === key);
  }
  if (!candidates.length) { if (Number(hb.active_status) === 1) branchNotes.push(`${hb.branch_name}: active in HRMS, no db_bill branch mapped — set its Tally cost category / code by hand`); continue; }
  candidates.sort((a, b) => (usage.get(Number(b.id)) ?? 0) - (usage.get(Number(a.id)) ?? 0) || Number(b.active) - Number(a.active) || Number(a.id) - Number(b.id));
  const l = candidates[0];
  const category = String(l.tally_branch ?? "").trim();
  const code = String(l.tally_code ?? "").trim();
  if (!category && !code) continue;
  if (!hb.tally_cost_category && !hb.tally_cost_centre_code) branchUpdates.push({ id: hb.id, hrms: hb.branch_name, category, code, from: `db_bill #${l.id} ${l.branch_name}` });
  else if (!tallyEq(hb.tally_cost_category, category) || !tallyEq(hb.tally_cost_centre_code, code))
    branchNotes.push(`${hb.branch_name}: HRMS ${hb.tally_cost_category}/${hb.tally_cost_centre_code} vs legacy ${category}/${code} — kept HRMS`);
}
out("branches: Tally cost category / cost-centre code to set", branchUpdates.map((u) => `${u.hrms} -> "${u.category}" / "${u.code}"   (${u.from})${tallyEq(u.hrms, u.category) ? "" : "   NAME DIFFERS"}`));
out("branches: notes", branchNotes);

// ── sub-heads ───────────────────────────────────────────────────────────────────────────────────
const legacySubs = (await billQuery<any>(`SELECT s.SubHeadingDesc d, COUNT(*) n FROM expense_entry_master m JOIN tbl_bgt_expensesubheadingmaster s ON s.SubHeadingId = m.SubHeadId
  WHERE m.CompId = 1 AND m.FinanceYear IN ('2024-25','2025-26','2026-27') GROUP BY s.SubHeadingDesc ORDER BY n DESC`)) as any[];
const legacyByNorm = new Map<string, string>();
for (const l of legacySubs) if (!legacyByNorm.has(norm(l.d))) legacyByNorm.set(norm(l.d), String(l.d).trim());
const [hrmsSubs] = await db.query<RowDataPacket[]>(
  ready ? `SELECT s.id, s.sub_head_name, t.tally_name AS tally_ledger_name FROM finance_expense_sub_head_master s
             LEFT JOIN tally_legacy_name t ON t.entity_type = 'expense_sub_head' AND t.entity_id = s.id WHERE s.active_status = 1`
        : `SELECT id, sub_head_name, NULL AS tally_ledger_name FROM finance_expense_sub_head_master WHERE active_status = 1`);
const subUpdates: any[] = [];
const subSame: string[] = [];
const subNoLegacy: string[] = [];
for (const s of hrmsSubs) {
  const legacy = legacyByNorm.get(norm(s.sub_head_name));
  if (!legacy) { subNoLegacy.push(String(s.sub_head_name)); continue; }
  if (tallyEq(legacy, s.sub_head_name)) { subSame.push(`${s.sub_head_name}${legacy !== String(s.sub_head_name).trim() ? `  (Tally has "${legacy}", same to Tally)` : ""}`); continue; }
  if (!s.tally_ledger_name) subUpdates.push({ id: s.id, hrms: s.sub_head_name, legacy });
}
out("sub-heads: Tally expense ledger to set (wording differs)", subUpdates.map((u) => `"${u.hrms}" -> "${u.legacy}"`));
out("sub-heads: same ledger to Tally (no change needed)", subSame, 100);
out("sub-heads: not used by the legacy import since FY 2024-25 (Tally may not have them; the masters file creates them)", subNoLegacy, 100);

// ── company bank accounts ───────────────────────────────────────────────────────────────────────
// HRMS seeded tally_ledger_name with the bare account number; Tally knows these banks by the db_bill tbl_bank names
// (deposit_bank / BankName on every legacy payment and receipt). Matched by IFSC + last 4 digits, from the
// 2026-10-14 probe: MAS paid 2,125 GRNs from "ICICI Sim Aanan Vihar" since 2025-04, received 444 payments into
// "Stata Bank of India-Power" in FY 2025-27, 2,695 receipts into "Stata Bank of India-CC" ("Stata" is how the
// Tally ledger is spelled). The IDC ICICI account (inactive, other company) is left alone.
const LEGACY_BANKS: { ifsc: string; last4: string; tally: string }[] = [
  { ifsc: "ICIC0000827", last4: "5852", tally: "ICICI Sim Aanan Vihar" },
  { ifsc: "SBIN0013913", last4: "3886", tally: "Stata Bank of India-Power" },
  { ifsc: "SBIN0013913", last4: "4502", tally: "Stata Bank of India-CC" },
];
const legacyBankNames = new Set(((await billQuery<any>(`SELECT bank_name FROM tbl_bank`)) as any[]).map((r) => String(r.bank_name).trim()));
const [hrmsBanks] = await db.query<RowDataPacket[]>(`SELECT id, account_name, account_number_last4, ifsc_code, tally_ledger_name FROM company_bank_account`);
const bankUpdates: any[] = [];
const bankNotes: string[] = [];
for (const a of hrmsBanks) {
  const m = LEGACY_BANKS.find((l) => l.ifsc === String(a.ifsc_code).trim().toUpperCase() && l.last4 === String(a.account_number_last4 ?? "").trim());
  if (!m) { bankNotes.push(`${a.account_name} (…${a.account_number_last4}): no legacy Tally bank — kept "${a.tally_ledger_name}"`); continue; }
  if (!legacyBankNames.has(m.tally)) { bankNotes.push(`${a.account_name}: "${m.tally}" not in db_bill tbl_bank — skipped`); continue; }
  if (tallyEq(a.tally_ledger_name, m.tally)) continue;
  // Only replace the seeded account-number placeholder, never a name someone typed.
  if (/^\d+$/.test(String(a.tally_ledger_name ?? "").trim())) bankUpdates.push({ id: a.id, hrms: a.account_name, from: a.tally_ledger_name, to: m.tally });
  else bankNotes.push(`${a.account_name}: HRMS "${a.tally_ledger_name}" vs legacy "${m.tally}" — kept HRMS`);
}
out("bank accounts: Tally ledger to set", bankUpdates.map((u) => `${u.hrms}: "${u.from}" -> "${u.to}"`));
out("bank accounts: notes", bankNotes);

if (APPLY) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const u of bankUpdates)
      await conn.execute(`UPDATE company_bank_account SET tally_ledger_name = ? WHERE id = ? AND tally_ledger_name = ?`, [u.to, u.id, u.from]);
    if (!ready) { branchUpdates.length = 0; subUpdates.length = 0; console.log("(migration 2210 not applied: branches and sub-heads skipped; re-run after deploy)"); }
    for (const u of branchUpdates)
      await conn.execute(`INSERT IGNORE INTO tally_legacy_name (entity_type, entity_id, tally_name, tally_code, source) VALUES ('branch', ?, ?, ?, ?)`, [u.id, u.category || null, u.code || null, u.from]);
    for (const u of subUpdates)
      await conn.execute(`INSERT IGNORE INTO tally_legacy_name (entity_type, entity_id, tally_name, source) VALUES ('expense_sub_head', ?, ?, 'db_bill tbl_bgt_expensesubheadingmaster')`, [u.id, u.legacy]);
    await conn.commit();
    console.log(`\nAPPLIED: ${bankUpdates.length} bank accounts, ${branchUpdates.length} branches, ${subUpdates.length} sub-heads (empty fields only).`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
} else console.log(`\nDRY RUN: would set ${bankUpdates.length} bank accounts, ${branchUpdates.length} branches, ${subUpdates.length} sub-heads.`);
await closeBillPool();
process.exit(0);
