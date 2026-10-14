/**
 * Copy the legacy Tally names from db_bill into HRMS, so HRMS Tally files use the names the Tally company
 * already has (it was fed by db_bill).
 *
 *   npx tsx scripts/backfill-tally-legacy-names.ts            # dry run
 *   npx tsx scripts/backfill-tally-legacy-names.ts --apply    # fills empty fields only, one transaction
 *
 *   branches   branch_master.tally_cost_category / tally_cost_centre_code <- db_bill branch_master.tally_branch /
 *              tally_code, through grn_migration_branch_map. Where several db_bill branches map to one HRMS
 *              branch (HEAD OFFICE 3 and 10), the one this year's MAS GRNs use wins.
 *   sub-heads  finance_expense_sub_head_master.tally_ledger_name <- the db_bill sub-head the legacy import used,
 *              when the wording differs from HRMS ("Computer software cost 26-27" -> "Computer Software Cost
 *              2026 - 27"). Matched ignoring case, spacing, punctuation and "2026 - 27" vs "26-27".
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
console.log(`mode: ${APPLY ? "APPLY" : "dry run (nothing is written)"}`);

const hasCols = async () => {
  try { await db.query(`SELECT tally_cost_category, tally_cost_centre_code FROM branch_master LIMIT 1`); await db.query(`SELECT tally_ledger_name FROM finance_expense_sub_head_master LIMIT 1`); return true; }
  catch { return false; }
};
const ready = await hasCols();
if (!ready) console.log("(migration 2210 not applied yet: reading the new columns as empty; --apply will refuse)");

// ── branches ────────────────────────────────────────────────────────────────────────────────────
const legacyBranches = new Map<number, any>();
for (const b of (await billQuery<any>(`SELECT id, branch_name, tally_branch, tally_code, active FROM branch_master`)) as any[]) legacyBranches.set(Number(b.id), b);
const usage = new Map<number, number>();
for (const u of (await billQuery<any>(`SELECT BranchId, COUNT(*) n FROM expense_entry_master WHERE CompId = 1 AND FinanceYear = '2026-27' GROUP BY BranchId`)) as any[]) usage.set(Number(u.BranchId), Number(u.n));
const [mapRows] = await db.query<RowDataPacket[]>(`SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map`);
const [hrmsBranches] = await db.query<RowDataPacket[]>(
  ready ? `SELECT id, branch_name, active_status, tally_cost_category, tally_cost_centre_code FROM branch_master`
        : `SELECT id, branch_name, active_status, NULL AS tally_cost_category, NULL AS tally_cost_centre_code FROM branch_master`);
const branchUpdates: any[] = [];
const branchNotes: string[] = [];
for (const hb of hrmsBranches) {
  const candidates = mapRows.filter((m) => String(m.hrms_branch_id) === String(hb.id)).map((m) => legacyBranches.get(Number(m.dbbill_branch_id))).filter(Boolean);
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
  ready ? `SELECT id, sub_head_name, tally_ledger_name FROM finance_expense_sub_head_master WHERE active_status = 1`
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

if (APPLY) {
  if (!ready) throw new Error("migration 2210 is not applied; deploy first");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const u of branchUpdates)
      await conn.execute(`UPDATE branch_master SET tally_cost_category = ?, tally_cost_centre_code = ? WHERE id = ? AND tally_cost_category IS NULL AND tally_cost_centre_code IS NULL`, [u.category || null, u.code || null, u.id]);
    for (const u of subUpdates)
      await conn.execute(`UPDATE finance_expense_sub_head_master SET tally_ledger_name = ? WHERE id = ? AND tally_ledger_name IS NULL`, [u.legacy, u.id]);
    await conn.commit();
    console.log(`\nAPPLIED: ${branchUpdates.length} branches, ${subUpdates.length} sub-heads (empty fields only).`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
} else console.log(`\nDRY RUN: would set ${branchUpdates.length} branches, ${subUpdates.length} sub-heads.`);
await closeBillPool();
process.exit(0);
