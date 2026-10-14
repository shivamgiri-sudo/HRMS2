/**
 * Carry the legacy billing system's Tally settings into HRMS, for the GRN Tally export.
 *
 *   npx tsx scripts/backfill-grn-tally-from-dbbill.ts            # dry run: reports, writes nothing
 *   npx tsx scripts/backfill-grn-tally-from-dbbill.ts --apply    # writes (old values are logged)
 *
 * db_bill is read through billQuery (SELECT only). Three things are copied, each only where HRMS has
 * no value of its own, and every difference with an existing HRMS value is reported, not overwritten:
 *   1. sub-head TDS: tbl_bgt_expensesubheadingmaster SubHeadTDSEnabled / SubHeadTds / SubHeadTdsSection
 *      (-> tds_master.description, the Tally TDS ledger) into finance_expense_sub_head_master
 *      tds_enabled / tds_rate / tds_tally_ledger, matched by sub-head name.
 *   2. vendors (vendor_code DB_BILL_<Id>): TallyHead -> tally_name when HRMS has none; for a vendor with
 *      TDSEnabled = 1 and a tds_master section: tds_enabled, tds_rate, tds_tally_ledger.
 *   3. imprest holders: db_bill imprest_manager.TallyHead -> HRMS imprest_manager.tally_name, matched by
 *      the holder's login email (and branch name where the email holds floats at several branches).
 * Before writing, the legacy TDS rule (sub-head, then vendor) is replayed on the Sep-26 legacy import's
 * GRNs and compared with the TDS lines Accounts actually imported (fixtures/grn-tally-legacy-sep26-tds.json).
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const key = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
/** "AC- Hire" and "AC-Hire", "UPS - Hire" and "UPS Hire" are the same sub-head. */
const loose = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const flag = (v: unknown): number | null => {
  const s = String(v ?? "").trim().toLowerCase();
  if (["yes", "1", "y"].includes(s)) return 1;
  if (["no", "0", "n"].includes(s)) return 0;
  return null;
};
const rate = (v: unknown) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};
const sample = (title: string, rows: unknown[], max = 40) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) console.log(typeof r === "string" ? `  ${r}` : `  ${JSON.stringify(r)}`);
  if (rows.length > max) console.log(`  ... ${rows.length - max} more`);
};

console.log(`mode: ${APPLY ? "APPLY" : "dry run (nothing is written)"}`);

const tdsMaster = new Map<number, { ledger: string; rate: number }>();
for (const t of (await billQuery<any>(`SELECT Id, description, TDS FROM tds_master`)) as any[])
  tdsMaster.set(Number(t.Id), { ledger: String(t.description).trim(), rate: rate(t.TDS) });

// ── 1. sub-heads ────────────────────────────────────────────────────────────────────────────────
// db_bill keeps old duplicate rows of some sub-heads (zero-padded ids like 000013 next to 11) with the
// TDS fields blank. Where names repeat, the row this year's GRNs actually use is the one that counts.
const usage = new Map<string, number>();
for (const u of (await billQuery<any>(`SELECT SubHeadId, COUNT(*) n FROM expense_entry_master WHERE FinanceYear IN ('2025-26','2026-27') GROUP BY SubHeadId`)) as any[])
  usage.set(String(u.SubHeadId), Number(u.n));
const legacySub = new Map<string, { enabled: number; rate: number; ledger: string | null; id: string; used: number }>();
const subById = new Map<string, { enabled: number | null; rate: number; ledger: string | null; name: string }>();
const conflicts: string[] = [];
for (const s of (await billQuery<any>(`SELECT SubHeadingId, SubHeadingDesc, SubHeadTDSEnabled, SubHeadTdsSection, SubHeadTds FROM tbl_bgt_expensesubheadingmaster`)) as any[]) {
  // Anything but Yes/1 is "no TDS" in the legacy import (the Sep-26 replay confirms blank sub-heads got none).
  const enabled = flag(s.SubHeadTDSEnabled) ?? 0;
  const section = tdsMaster.get(Number(s.SubHeadTdsSection));
  const value = { enabled, rate: enabled === 1 ? rate(s.SubHeadTds) || section?.rate || 0 : 0, ledger: enabled === 1 ? section?.ledger ?? null : null };
  subById.set(String(s.SubHeadingId), { ...value, name: String(s.SubHeadingDesc) });
  const k = loose(s.SubHeadingDesc);
  const used = usage.get(String(s.SubHeadingId)) ?? 0;
  const prev = legacySub.get(k);
  if (prev && (prev.enabled !== value.enabled || prev.rate !== value.rate || prev.ledger !== value.ledger)) {
    const keep = used > prev.used || (used === prev.used && value.enabled > prev.enabled) ? { ...value, id: String(s.SubHeadingId), used } : prev;
    conflicts.push(`${s.SubHeadingDesc}: id ${prev.id} (${prev.used} GRNs) vs ${s.SubHeadingId} (${used} GRNs) differ — using ${keep.id}`);
    legacySub.set(k, keep);
    continue;
  }
  if (!prev || used > prev.used) legacySub.set(k, { ...value, id: String(s.SubHeadingId), used });
}
// Before migration 2205 is on the server the new columns are missing: a dry run then reads them as empty.
const withFallback = async (full: string, base: string) => {
  try {
    return (await db.query<RowDataPacket[]>(full))[0];
  } catch {
    console.log(`(new columns not present yet — reading them as empty)`);
    return (await db.query<RowDataPacket[]>(base))[0];
  }
};
const hrmsSubs = await withFallback(
  `SELECT id, sub_head_name, tds_enabled, tds_rate, tds_tally_ledger FROM finance_expense_sub_head_master`,
  `SELECT id, sub_head_name, NULL AS tds_enabled, NULL AS tds_rate, NULL AS tds_tally_ledger FROM finance_expense_sub_head_master`,
);
const subUpdates: any[] = [];
const subDiffs: string[] = [];
const subUnmatched: string[] = [];
for (const h of hrmsSubs) {
  const l = legacySub.get(loose(h.sub_head_name));
  if (!l) { subUnmatched.push(String(h.sub_head_name)); continue; }
  if (l.enabled === 1 && (!l.ledger || !l.rate)) { subDiffs.push(`${h.sub_head_name}: legacy TDS on but no ledger/rate — skipped`); continue; }
  if (h.tds_enabled == null) subUpdates.push({ id: h.id, name: h.sub_head_name, enabled: l.enabled, rate: l.rate || null, ledger: l.ledger });
  else if (Number(h.tds_enabled) !== l.enabled || Number(h.tds_rate ?? 0) !== l.rate || (h.tds_tally_ledger ?? null) !== l.ledger)
    subDiffs.push(`${h.sub_head_name}: HRMS ${h.tds_enabled}/${h.tds_rate}/${h.tds_tally_ledger} vs legacy ${l.enabled}/${l.rate}/${l.ledger} — kept HRMS`);
}
sample("sub-heads to set (legacy TDS)", subUpdates.map((u) => `${u.name}: ${u.enabled ? `${u.ledger} @ ${u.rate}%` : "no TDS"}`), 120);
sample("sub-heads named twice in db_bill (the one this year\'s GRNs use is taken)", conflicts);
sample("sub-heads differing from an existing HRMS value", subDiffs);
sample("HRMS sub-heads with no legacy setting (export falls back to the TDS engine defaults)", subUnmatched, 80);

// ── 2. vendors ──────────────────────────────────────────────────────────────────────────────────
const legacyVendors = new Map<string, any>();
for (const v of (await billQuery<any>(`SELECT Id, vendor, TallyHead, TDSEnabled, TDS, TDSSection, TDSTallyHead FROM tbl_vendormaster`)) as any[])
  legacyVendors.set(String(v.Id), v);
const hrmsVendors = await withFallback(
  `SELECT id, vendor_code, vendor_name, tally_name, tds_enabled, tds_rate, tds_tally_ledger FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'`,
  `SELECT id, vendor_code, vendor_name, tally_name, tds_enabled, tds_rate, NULL AS tds_tally_ledger FROM vendor_master WHERE vendor_code LIKE 'DB_BILL_%'`,
);
const vendorTally: any[] = [];
const vendorTds: any[] = [];
const vendorTallyDiff: string[] = [];
const vendorTdsSkipped: string[] = [];
for (const h of hrmsVendors) {
  const l = legacyVendors.get(String(h.vendor_code).replace(/^DB_BILL_/, ""));
  if (!l) continue;
  const tally = String(l.TallyHead ?? "").trim();
  if (tally && !String(h.tally_name ?? "").trim()) vendorTally.push({ id: h.id, name: h.vendor_name, tally });
  else if (tally && key(h.tally_name) !== key(tally)) vendorTallyDiff.push(`${h.vendor_name}: HRMS "${h.tally_name}" vs legacy "${tally}" — kept HRMS`);
  if (Number(l.TDSEnabled) === 1) {
    const section = /^\d+$/.test(String(l.TDSSection ?? "").trim()) ? tdsMaster.get(Number(l.TDSSection)) : undefined;
    const r = rate(l.TDS) || section?.rate || 0;
    if (!section || !r) { vendorTdsSkipped.push(`${l.vendor}: TDS on, section "${l.TDSSection}", head "${l.TDSTallyHead}" — not a tds_master section, skipped`); continue; }
    if (!h.tds_tally_ledger) vendorTds.push({ id: h.id, name: h.vendor_name, rate: r, ledger: section.ledger });
  }
}
sample("vendor Tally names to set", vendorTally.map((v) => `${v.name} -> ${v.tally}`));
sample("vendor Tally names differing from HRMS", vendorTallyDiff);
sample("vendor TDS to set", vendorTds.map((v) => `${v.name}: ${v.ledger} @ ${v.rate}%`), 120);
sample("vendor TDS in db_bill that cannot be mapped", vendorTdsSkipped);

// ── 3. imprest holders ──────────────────────────────────────────────────────────────────────────
const legacyHolders = (await billQuery<any>(`SELECT Id, UserName, EmailId, TallyHead, Branch, Active FROM imprest_manager`)) as any[];
const [hrmsHolders] = await db.query<RowDataPacket[]>(
  `SELECT im.id, im.tally_name, im.branch_id, im.user_id, im.employee_id, im.active_status FROM imprest_manager im`,
);
const lookup = async (sql: string, ids: string[]) =>
  ids.length ? (await db.query<RowDataPacket[]>(sql.replace("(?)", `(${ids.map(() => "?").join(",")})`), ids))[0] : [];
const emails = new Map<string, string>();
for (const u of await lookup(`SELECT id, email FROM auth_user WHERE id IN (?)`, [...new Set(hrmsHolders.map((h) => String(h.user_id)))]))
  emails.set(String(u.id), String(u.email ?? ""));
const people = new Map<string, string>();
for (const e of await lookup(`SELECT id, first_name, last_name FROM employees WHERE id IN (?)`, [...new Set(hrmsHolders.map((h) => String(h.employee_id ?? "")).filter(Boolean))]))
  people.set(String(e.id), `${e.first_name ?? ""} ${e.last_name ?? ""}`);
const branchNames = new Map<string, string>();
for (const b of await lookup(`SELECT id, branch_name FROM branch_master WHERE id IN (?)`, [...new Set(hrmsHolders.map((h) => String(h.branch_id)))]))
  branchNames.set(String(b.id), String(b.branch_name ?? ""));
const holderUpdates: any[] = [];
const holderMisses: string[] = [];
for (const h of hrmsHolders) {
  // Emails moved domain (teammas.in -> teammas.co.in) and one holder signs in with a personal address,
  // so match on the part before @, else on the person's name — within the same branch either way.
  const email = emails.get(String(h.user_id)) ?? "";
  const local = loose(email.split("@")[0]);
  const person = loose(people.get(String(h.employee_id ?? "")) ?? "");
  const branch = branchNames.get(String(h.branch_id)) ?? "";
  const sameBranch = legacyHolders.filter((l) => loose(l.Branch) === loose(branch) && String(l.TallyHead ?? "").trim());
  let hits = sameBranch.filter((l) => local && loose(String(l.EmailId ?? "").split("@")[0]) === local);
  if (!hits.length && person) hits = sameBranch.filter((l) => loose(l.UserName) === person);
  if (hits.length > 1) hits = [hits.filter((l) => Number(l.Active) === 1).sort((x, y) => Number(y.Id) - Number(x.Id))[0] ?? hits[0]];
  const ledger = hits[0] ? String(hits[0].TallyHead).trim() : "";
  if (!ledger) { holderMisses.push(`${email || h.user_id} @ ${branch}: no legacy imprest manager at this branch`); continue; }
  if (!String(h.tally_name ?? "").trim()) holderUpdates.push({ id: h.id, who: `${email} @ ${branch}`, tally: ledger });
  else if (key(h.tally_name) !== key(ledger)) holderMisses.push(`${email} @ ${branch}: HRMS "${h.tally_name}" vs legacy "${ledger}" — kept HRMS`);
}
sample("imprest holder Tally ledgers to set", holderUpdates.map((u) => `${u.who} -> ${u.tally}`), 60);
sample("imprest holders not set", holderMisses, 60);

// ── replay the legacy TDS rule on the Sep-26 legacy import ──────────────────────────────────────
const expected: Record<string, string> = JSON.parse(readFileSync(new URL("./fixtures/grn-tally-legacy-sep26-tds.json", import.meta.url), "utf8"));
const grnNos = Object.keys(expected);
const masters = (await billQuery<any>(
  `SELECT m.Id, m.GrnNo, m.SubHeadId, m.Vendor,
          (SELECT SUM(CAST(p.Amount AS DECIMAL(16,2))) FROM expense_entry_particular p WHERE CAST(p.ExpenseEntry AS UNSIGNED) = m.Id) AS taxable
     FROM expense_entry_master m WHERE m.GrnNo IN (${grnNos.map(() => "?").join(",")})`,
  grnNos,
)) as any[];
let agree = 0;
const disagree: string[] = [];
for (const m of masters) {
  const sub = subById.get(String(m.SubHeadId));
  const v = legacyVendors.get(String(m.Vendor));
  const vSection = v && Number(v.TDSEnabled) === 1 && /^\d+$/.test(String(v.TDSSection ?? "").trim()) ? tdsMaster.get(Number(v.TDSSection)) : undefined;
  let got = "";
  if (sub?.enabled === 1 && sub.ledger && sub.rate) got = `${sub.ledger}|${Math.round(Number(m.taxable) * sub.rate) / 100}`;
  else if (vSection) got = `${vSection.ledger}|${Math.round(Number(m.taxable) * (rate(v.TDS) || vSection.rate)) / 100}`;
  const want = expected[m.GrnNo];
  const same = got.split("|")[0] === want.split("|")[0] && Math.abs(Number(got.split("|")[1] || 0) - Number(want.split("|")[1] || 0)) <= 0.02;
  if (same) agree++;
  else disagree.push(`${m.GrnNo} sub-head "${sub?.name}" vendor "${v?.vendor}": imported [${want}] rule gives [${got}]`);
}
console.log(`\nlegacy TDS rule replay on the Sep-26 import: ${agree}/${masters.length} GRNs agree with what was imported`);
sample("disagreements", disagree, 60);

// ── apply ───────────────────────────────────────────────────────────────────────────────────────
if (APPLY) {
  // Applying needs migration 2205's columns; refuse rather than write half.
  await db.query(`SELECT tds_enabled, tds_rate, tds_tally_ledger FROM finance_expense_sub_head_master LIMIT 1`);
  await db.query(`SELECT tds_tally_ledger FROM vendor_master LIMIT 1`);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const u of subUpdates)
      await conn.execute(`UPDATE finance_expense_sub_head_master SET tds_enabled = ?, tds_rate = ?, tds_tally_ledger = ? WHERE id = ? AND tds_enabled IS NULL`, [u.enabled, u.rate, u.ledger, u.id]);
    for (const v of vendorTally)
      await conn.execute(`UPDATE vendor_master SET tally_name = ? WHERE id = ? AND (tally_name IS NULL OR TRIM(tally_name) = '')`, [v.tally, v.id]);
    for (const v of vendorTds)
      await conn.execute(`UPDATE vendor_master SET tds_enabled = 1, tds_rate = ?, tds_tally_ledger = ? WHERE id = ? AND tds_tally_ledger IS NULL`, [v.rate, v.ledger, v.id]);
    for (const u of holderUpdates)
      await conn.execute(`UPDATE imprest_manager SET tally_name = ? WHERE id = ? AND (tally_name IS NULL OR TRIM(tally_name) = '')`, [u.tally, u.id]);
    await conn.commit();
    console.log(`\nAPPLIED: ${subUpdates.length} sub-heads, ${vendorTally.length} vendor Tally names, ${vendorTds.length} vendor TDS, ${holderUpdates.length} imprest holders (only empty fields were filled).`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
} else {
  console.log(`\nDRY RUN: would set ${subUpdates.length} sub-heads, ${vendorTally.length} vendor Tally names, ${vendorTds.length} vendor TDS, ${holderUpdates.length} imprest holders.`);
}
await closeBillPool();
process.exit(0);
