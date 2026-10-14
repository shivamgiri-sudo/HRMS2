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
const legacySub = new Map<string, { enabled: number; rate: number; ledger: string | null; ids: string[] }>();
const subById = new Map<string, { enabled: number | null; rate: number; ledger: string | null; name: string }>();
const conflicts: string[] = [];
for (const s of (await billQuery<any>(`SELECT SubHeadingId, SubHeadingDesc, SubHeadTDSEnabled, SubHeadTdsSection, SubHeadTds FROM tbl_bgt_expensesubheadingmaster`)) as any[]) {
  const enabled = flag(s.SubHeadTDSEnabled);
  const section = tdsMaster.get(Number(s.SubHeadTdsSection));
  const value = { enabled: enabled ?? 0, rate: enabled === 1 ? rate(s.SubHeadTds) || section?.rate || 0 : 0, ledger: enabled === 1 ? section?.ledger ?? null : null };
  subById.set(String(s.SubHeadingId), { ...value, enabled, name: String(s.SubHeadingDesc) });
  if (enabled === null) continue;
  const k = key(s.SubHeadingDesc);
  const prev = legacySub.get(k);
  if (prev && (prev.enabled !== value.enabled || prev.rate !== value.rate || prev.ledger !== value.ledger)) {
    conflicts.push(`${s.SubHeadingDesc}: ids ${prev.ids.join(",")} vs ${s.SubHeadingId} disagree — skipped`);
    legacySub.set(k, { ...prev, enabled: -1 });
    continue;
  }
  legacySub.set(k, { ...value, ids: [...(prev?.ids ?? []), String(s.SubHeadingId)] });
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
  const l = legacySub.get(key(h.sub_head_name));
  if (!l) { subUnmatched.push(String(h.sub_head_name)); continue; }
  if (l.enabled === -1) continue;
  if (l.enabled === 1 && (!l.ledger || !l.rate)) { subDiffs.push(`${h.sub_head_name}: legacy TDS on but no ledger/rate — skipped`); continue; }
  if (h.tds_enabled == null) subUpdates.push({ id: h.id, name: h.sub_head_name, enabled: l.enabled, rate: l.rate || null, ledger: l.ledger });
  else if (Number(h.tds_enabled) !== l.enabled || Number(h.tds_rate ?? 0) !== l.rate || (h.tds_tally_ledger ?? null) !== l.ledger)
    subDiffs.push(`${h.sub_head_name}: HRMS ${h.tds_enabled}/${h.tds_rate}/${h.tds_tally_ledger} vs legacy ${l.enabled}/${l.rate}/${l.ledger} — kept HRMS`);
}
sample("sub-heads to set (legacy TDS)", subUpdates.map((u) => `${u.name}: ${u.enabled ? `${u.ledger} @ ${u.rate}%` : "no TDS"}`), 120);
sample("sub-head conflicts inside db_bill", conflicts);
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
const legacyHolders = (await billQuery<any>(`SELECT Id, EmailId, TallyHead, Branch, Active FROM imprest_manager`)) as any[];
const [hrmsHolders] = await db.query<RowDataPacket[]>(
  `SELECT im.id, im.tally_name, im.branch_id, im.user_id, im.active_status FROM imprest_manager im`,
);
const userIds = [...new Set(hrmsHolders.map((h) => String(h.user_id)))];
const emails = new Map<string, string>();
if (userIds.length) {
  const [users] = await db.query<RowDataPacket[]>(`SELECT id, email FROM auth_user WHERE id IN (${userIds.map(() => "?").join(",")})`, userIds);
  for (const u of users) emails.set(String(u.id), key(u.email));
}
const branchIds = [...new Set(hrmsHolders.map((h) => String(h.branch_id)))];
const branchNames = new Map<string, string>();
if (branchIds.length) {
  const [branches] = await db.query<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`, branchIds);
  for (const b of branches) branchNames.set(String(b.id), key(b.branch_name));
}
const holderUpdates: any[] = [];
const holderMisses: string[] = [];
for (const h of hrmsHolders) {
  const email = emails.get(String(h.user_id)) ?? "";
  const branch = branchNames.get(String(h.branch_id)) ?? "";
  let hits = legacyHolders.filter((l) => key(l.EmailId) === email && String(l.TallyHead ?? "").trim());
  if (hits.length > 1) hits = hits.filter((l) => key(l.Branch) === branch);
  const ledgers = [...new Set(hits.map((l) => String(l.TallyHead).trim()))];
  if (ledgers.length !== 1) { holderMisses.push(`${email || h.user_id} @ ${branch}: ${ledgers.length ? `ambiguous ${ledgers.join(" | ")}` : "no legacy imprest manager"}`); continue; }
  if (!String(h.tally_name ?? "").trim()) holderUpdates.push({ id: h.id, who: `${email} @ ${branch}`, tally: ledgers[0] });
  else if (key(h.tally_name) !== key(ledgers[0])) holderMisses.push(`${email} @ ${branch}: HRMS "${h.tally_name}" vs legacy "${ledgers[0]}" — kept HRMS`);
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
