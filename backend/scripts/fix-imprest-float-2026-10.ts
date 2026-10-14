/**
 * Imprest float correction, 2026-10 (HRMS becomes the system of record).
 *
 *   npx tsx scripts/fix-imprest-float-2026-10.ts            # dry run: prints the plan, writes nothing
 *   npx tsx scripts/fix-imprest-float-2026-10.ts --apply    # one transaction; every row it adds is logged
 *
 * Found by scripts/imprest-float-reconcile.ts on 2026-10-14:
 *   - db_bill top-ups after #2847 (29-Aug) never reached HRMS;
 *   - migrated imprest GRNs debited to the wrong holder: backfill-imprest-ledger-gaps.cjs chose "the best
 *     manager in the branch", so one person's spend sits on another's float;
 *   - when logins moved to @teammas.co.in, HRMS created a second record per holder, splitting each float;
 *   - holders long gone are still "active".
 *
 * The ledger is append-only, so nothing is edited or deleted there: a wrong debit is moved with an
 * adjustment pair (credit the wrong float, debit the right one), a merge transfers the old record's
 * balance by an adjustment pair, all through imprestLedgerService.post (locks, running balance, period
 * lock). Corrections are dated today; a top-up keeps its own date unless that month is locked.
 *
 * Who a legacy GRN belongs to: db_bill expense_entry_master.userid + BranchId -> db_bill imprest_manager
 * (UserId, BranchId) -> HRMS imprest_manager by Tally name (as the original migration matched) ->
 * the person's current record.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";
import { imprestLedgerService } from "../src/modules/finance/imprest-ledger.service.js";
import { isPeriodLocked } from "../src/modules/process-pnl/finance-period-lock.js";

const APPLY = process.argv.includes("--apply");
const ACTOR = "00000000-0000-0000-0000-dbbill000001"; // the db_bill migration user: marks these as data fixes
const TODAY = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const ACTIVE_SINCE = "2026-06-01";
const r2 = (n: number) => Math.round(n * 100) / 100;
const short = (id: string) => String(id).slice(0, 8);
const loose = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const out = (title: string, rows: unknown[], max = 60) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r)}`);
  if (rows.length > max) console.log(`  ... ${rows.length - max} more`);
};
const q = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as any[];
const safeDate = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

console.log(`mode: ${APPLY ? "APPLY" : "dry run (nothing is written)"}; corrections dated ${TODAY}`);

// ── masters ─────────────────────────────────────────────────────────────────────────────────────
const branchMap = new Map<number, string>();
for (const b of await q(`SELECT dbbill_branch_id, hrms_branch_id FROM grn_migration_branch_map`)) branchMap.set(Number(b.dbbill_branch_id), String(b.hrms_branch_id));
const branchName = new Map<string, string>();
const branchActive = new Map<string, boolean>();
for (const b of await q(`SELECT id, branch_name, active_status FROM branch_master`)) { branchName.set(String(b.id), String(b.branch_name)); branchActive.set(String(b.id), Number(b.active_status) === 1); }
const hm = await q(`SELECT id, branch_id, tally_name, user_id, employee_id, effective_from, effective_to, active_status, created_at FROM imprest_manager`);
const bm = (await billQuery<any>(`SELECT Id, UserId, UserName, TallyHead, BranchId, Active FROM imprest_manager`)) as any[];

// Records that are the same person's float: same branch and same Tally name. The current record is the
// most recently appointed one (the HRMS-created record the person signs in with).
const canon = new Map<string, string>();
const groups = new Map<string, any[]>();
for (const m of hm) if (m.tally_name) { const k = `${m.branch_id}|${loose(m.tally_name)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(m); }
const merges: { from: any; to: any }[] = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  g.sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
  for (const m of g.slice(1)) { canon.set(String(m.id), String(g[0].id)); merges.push({ from: m, to: g[0] }); }
}
const C = (id: string | null | undefined) => (id ? canon.get(String(id)) ?? String(id) : null);
const label = (id: string | null) => { const m = hm.find((x) => String(x.id) === String(id)); return m ? `${short(m.id)} ${m.tally_name ?? "?"} @${branchName.get(String(m.branch_id))}` : String(id); };

// db_bill holder -> HRMS record (by Tally name, then branch), then the person's current record.
const legacyToHrms = new Map<number, string>();
for (const b of bm) {
  let hits = hm.filter((m) => m.tally_name && loose(m.tally_name) === loose(b.TallyHead));
  const hb = branchMap.get(Number(b.BranchId));
  if (hits.length > 1 && hb) { const same = hits.filter((m) => String(m.branch_id) === hb); if (same.length) hits = same; }
  if (hits.length) legacyToHrms.set(Number(b.Id), C(String(hits[0].id))!);
}
const holderFor = (userId: number, branchId: number): string | null => {
  let hits = bm.filter((b) => Number(b.UserId) === userId && Number(b.BranchId) === branchId);
  if (!hits.length) return null;
  hits = hits.sort((a, b) => Number(b.Active) - Number(a.Active) || Number(b.Id) - Number(a.Id));
  return legacyToHrms.get(Number(hits[0].Id)) ?? null;
};

// ── legacy GRNs and their ledger debits ─────────────────────────────────────────────────────────
const grns = await q(`SELECT id, grn_number, status, branch_id, bill_source_id, created_by, bill_date, accounting_period,
    COALESCE(NULLIF(amount_with_tax, 0), amount) amount
  FROM grn_request WHERE grn_type = 'imprest' AND (bill_source_id IS NOT NULL OR created_by LIKE '00000000-%')`);
const legacyId = (g: any) => (g.bill_source_id ? Number(g.bill_source_id) : Number(String(g.grn_number).match(/-(\d+)$/)?.[1] ?? 0));
const ids = [...new Set(grns.map(legacyId).filter(Boolean))];
const entries = new Map<number, any>();
for (let i = 0; i < ids.length; i += 2000) {
  const part = ids.slice(i, i + 2000);
  for (const e of (await billQuery<any>(`SELECT Id, userid, BranchId FROM expense_entry_master WHERE Id IN (${part.map(() => "?").join(",")})`, part)) as any[]) entries.set(Number(e.Id), e);
}
const debits = await q(`SELECT id, imprest_manager_id, amount, reference_id FROM imprest_transaction_ledger
  WHERE reference_type = 'grn_request' AND direction = 'debit' AND entry_type = 'voucher'`);
const debitByGrn = new Map<string, any[]>();
for (const d of debits) { const k = String(d.reference_id); if (!debitByGrn.has(k)) debitByGrn.set(k, []); debitByGrn.get(k)!.push(d); }
// Earlier corrections by this script (re-runs) count as already moved.
const moved = new Set((await q(`SELECT DISTINCT reference_id FROM imprest_transaction_ledger WHERE entry_type = 'adjustment' AND reference_type = 'grn_request' AND narration LIKE 'Re-attributed%'`)).map((r) => String(r.reference_id)));

out("legacy imprest GRN statuses", Object.entries(grns.reduce((a: any, g) => { a[g.status] = (a[g.status] ?? 0) + 1; return a; }, {})).map(([k, v]) => `${k}: ${v}`));
const SPENT = new Set(["approved", "paid", "finance_head_approved", "pending_accounts_payment", "partially_paid", "closed", "accounts_head_approved"]);

const reattribute: any[] = [];
const missing: any[] = [];
const unresolved: string[] = [];
for (const g of grns) {
  const e = entries.get(legacyId(g));
  const expected = e ? holderFor(Number(e.userid), Number(e.BranchId)) : null;
  const ds = debitByGrn.get(String(g.id)) ?? [];
  if (!expected) { if (ds.length || SPENT.has(g.status)) unresolved.push(`${g.grn_number}: db_bill user ${e?.userid ?? "?"} @ branch ${e?.BranchId ?? "?"} has no HRMS holder`); continue; }
  if (!ds.length) { if (SPENT.has(g.status) && Number(g.amount) > 0) missing.push({ g, to: expected }); continue; }
  if (moved.has(String(g.id))) continue;
  for (const d of ds) if (C(d.imprest_manager_id) !== expected) reattribute.push({ g, d, from: String(d.imprest_manager_id), to: expected });
}
const pairSum = (rows: any[], k: (r: any) => string, amt: (r: any) => number) => Object.entries(rows.reduce((a: any, r) => { const key = k(r); a[key] = r2((a[key] ?? 0) + amt(r)); return a; }, {}));
out("debits to move (from -> to): total", pairSum(reattribute, (r) => `${label(r.from)}  ->  ${label(r.to)}`, (r) => Number(r.d.amount)).map(([k, v]) => `${v}  ${k}`), 80);
out("approved legacy GRNs with no debit, to post (by holder)", pairSum(missing, (r) => label(r.to), (r) => Number(r.g.amount)).map(([k, v]) => `${v}  ${k}`));
out("legacy GRNs whose holder cannot be identified (left as they are)", unresolved, 30);

// ── top-ups db_bill has and HRMS does not ───────────────────────────────────────────────────────
const have = new Set((await q(`SELECT bill_source_id FROM imprest_allocation WHERE bill_source_id IS NOT NULL`)).map((r) => Number(r.bill_source_id)));
const topups = ((await billQuery<any>(`SELECT Id, ImprestManagerId, BranchId, EntryDate, Amount, PaymentMode, PaymentNo, Remarks, CreateDate FROM imprest_allotment_master`)) as any[])
  .filter((a) => !have.has(Number(a.Id)))
  .map((a) => ({ a, to: legacyToHrms.get(Number(a.ImprestManagerId)) ?? null, date: safeDate(a.EntryDate) ?? safeDate(a.CreateDate) ?? TODAY }));
out("top-ups missing from HRMS", topups.map((t) => `#${t.a.Id} ${t.date} ${t.a.Amount} -> ${t.to ? label(t.to) : "NO HOLDER (skipped)"}`));

// ── who stays active ────────────────────────────────────────────────────────────────────────────
const current = new Set<string>();
for (const g of grns) if (String(g.bill_date ?? "") >= ACTIVE_SINCE) { const e = entries.get(legacyId(g)); const h = e ? holderFor(Number(e.userid), Number(e.BranchId)) : null; if (h) current.add(h); }
for (const t of topups) if (t.to && t.date >= ACTIVE_SINCE) current.add(t.to);
for (const a of (await billQuery<any>(`SELECT DISTINCT ImprestManagerId id FROM imprest_allotment_master WHERE CreateDate >= ?`, [ACTIVE_SINCE])) as any[]) { const h = legacyToHrms.get(Number(a.id)); if (h) current.add(h); }
for (const r of await q(`SELECT DISTINCT imprest_manager_id id FROM imprest_transaction_ledger WHERE created_by NOT LIKE '00000000-%' AND created_at >= '2026-09-01'`)) current.add(C(String(r.id))!);
const deactivate = hm.filter((m) => Number(m.active_status) === 1 && !canon.has(String(m.id)) && !current.has(String(m.id)));
out("records merged into the person's current record", merges.map((m) => `${label(m.from.id)}  =>  ${label(m.to.id)}`));
out("current holders (stay active)", [...current].map(label));
out("holders to close (no activity since June); balance stays visible", deactivate.map((m) => label(m.id)), 80);

// Scope decided 2026-10-14: the GRN-level history is too scrambled to re-attribute reliably (db_bill's own
// per-user arithmetic does not give believable floats either), so moves and back-dated debits are REPORTED
// above but NOT posted. Each current holder's float is set from the balance Accounts confirm, separately.
// Posted here: missing top-ups, duplicate-record merges, closing obsolete holders.
reattribute.length = 0;
missing.length = 0;

for (const p of [TODAY.slice(0, 7), "2026-09", "2026-08"]) console.log(`period ${p} locked: ${await isPeriodLocked(p)}`);
console.log(`\nPLAN: move ${reattribute.length} debits (${r2(reattribute.reduce((s, r) => s + Number(r.d.amount), 0))}), post ${missing.length} missing debits (${r2(missing.reduce((s, r) => s + Number(r.g.amount), 0))}), add ${topups.filter((t) => t.to).length} top-ups (${r2(topups.filter((t) => t.to).reduce((s, t) => s + Number(t.a.Amount), 0))}), merge ${merges.length} records, close ${deactivate.length} holders.`);

// ── apply ───────────────────────────────────────────────────────────────────────────────────────
if (APPLY) {
  const conn = (await db.getConnection()) as PoolConnection;
  const branchOf = (id: string) => String(hm.find((m) => String(m.id) === id)?.branch_id ?? "");
  const post = (o: { to: string; type: "allocation" | "voucher" | "adjustment" | "return"; dir: "credit" | "debit"; amount: number; date?: string; refType: "grn_request" | "imprest_allocation" | "manual" | null; refId: string | null; narration: string }) =>
    imprestLedgerService.post({ imprestManagerId: o.to, branchId: branchOf(o.to), entryType: o.type, direction: o.dir, amount: r2(o.amount), transactionDate: o.date ?? TODAY, referenceType: o.refType, referenceId: o.refId, narration: o.narration.slice(0, 480), actorUserId: ACTOR }, conn);
  try {
    await conn.beginTransaction();
    for (const t of topups) {
      if (!t.to) continue;
      const date = (await isPeriodLocked(t.date.slice(0, 7), conn)) ? TODAY : t.date;
      const amount = Number(t.a.Amount) || 0;
      if (!amount) continue;
      const allocId = randomUUID();
      const [y, m] = t.date.split("-");
      await conn.execute(
        `INSERT INTO imprest_allocation (id, allocation_no, imprest_manager_id, branch_id, allocation_date, amount, payment_mode, reference_no, remarks, status, disbursed_at, created_by, created_at, accounting_period, bill_source_id)
         VALUES (?,?,?,?,?,?,?,?,?,'disbursed',NOW(),?,NOW(),?,?)`,
        [allocId, `IMP/${m}/${y.slice(2)}/${String(t.a.Id).padStart(5, "0")}`, t.to, branchOf(t.to), t.date, Math.abs(amount),
          ({ 1: "Cash", 2: "Cheque", 3: "NEFT" } as any)[Number(t.a.PaymentMode)] ?? "Other", t.a.PaymentNo ? String(t.a.PaymentNo).trim() || null : null,
          `db_bill top-up #${t.a.Id}${t.a.Remarks ? `: ${String(t.a.Remarks).trim()}` : ""}`.slice(0, 500), ACTOR, date.slice(0, 7), Number(t.a.Id)],
      );
      await post({ to: t.to, type: amount > 0 ? "allocation" : "return", dir: amount > 0 ? "credit" : "debit", amount: Math.abs(amount), date, refType: "imprest_allocation", refId: allocId, narration: `db_bill top-up #${t.a.Id} of ${t.date}` });
    }
    for (const r of missing)
      await post({ to: r.to, type: "voucher", dir: "debit", amount: Number(r.g.amount), refType: "grn_request", refId: String(r.g.id), narration: `Imprest GRN ${r.g.grn_number} (db_bill) was never debited; posted 2026-10 correction` });
    for (const r of reattribute) {
      await post({ to: r.from, type: "adjustment", dir: "credit", amount: Number(r.d.amount), refType: "grn_request", refId: String(r.g.id), narration: `Re-attributed GRN ${r.g.grn_number} to ${label(r.to)} (was debited here by the migration)` });
      await post({ to: r.to, type: "adjustment", dir: "debit", amount: Number(r.d.amount), refType: "grn_request", refId: String(r.g.id), narration: `Re-attributed GRN ${r.g.grn_number} from ${label(r.from)} (raised by this holder in db_bill)` });
    }
    for (const { from, to } of merges) {
      const [[bal]] = (await conn.execute<RowDataPacket[]>(`SELECT COALESCE(SUM(IF(direction='credit', amount, -amount)), 0) b FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`, [from.id])) as any;
      const b = r2(Number(bal.b));
      if (b !== 0) {
        await post({ to: String(from.id), type: "adjustment", dir: b > 0 ? "debit" : "credit", amount: Math.abs(b), refType: "manual", refId: null, narration: `Balance moved to ${label(to.id)}: same holder, merged duplicate record` });
        await post({ to: String(to.id), type: "adjustment", dir: b > 0 ? "credit" : "debit", amount: Math.abs(b), refType: "manual", refId: null, narration: `Balance brought from ${label(from.id)}: same holder, merged duplicate record` });
      }
      await conn.execute(`UPDATE imprest_manager SET active_status = 0, effective_to = ?, updated_by = ? WHERE id = ?`, [TODAY, ACTOR, from.id]);
      await conn.execute(`UPDATE grn_request SET imprest_manager_id = ? WHERE imprest_manager_id = ? AND status NOT IN ('approved','paid','cancelled','rejected')`, [to.id, from.id]);
      await conn.execute(`UPDATE imprest_allocation SET imprest_manager_id = ? WHERE imprest_manager_id = ? AND status NOT IN ('disbursed','rejected','cancelled')`, [to.id, from.id]);
    }
    for (const m of deactivate) await conn.execute(`UPDATE imprest_manager SET active_status = 0, effective_to = COALESCE(effective_to, ?), updated_by = ? WHERE id = ?`, [TODAY, ACTOR, m.id]);
    await conn.commit();
    console.log("\nAPPLIED (one transaction).");
  } catch (e) {
    await conn.rollback();
    console.log(`\nROLLED BACK: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
}

// ── balances after (or as they would be) vs db_bill ─────────────────────────────────────────────
const bal = new Map<string, number>();
for (const r of await q(`SELECT imprest_manager_id id, SUM(IF(direction='credit', amount, -amount)) b FROM imprest_transaction_ledger GROUP BY imprest_manager_id`)) bal.set(String(r.id), Number(r.b));
if (!APPLY) {
  const add = (id: string, v: number) => bal.set(id, (bal.get(id) ?? 0) + v);
  for (const t of topups) if (t.to) add(t.to, Number(t.a.Amount));
  for (const r of missing) add(r.to, -Number(r.g.amount));
  for (const r of reattribute) { add(r.from, Number(r.d.amount)); add(r.to, -Number(r.d.amount)); }
  for (const { from, to } of merges) { add(String(to.id), bal.get(String(from.id)) ?? 0); bal.set(String(from.id), 0); }
}
const dbBal = new Map<string, number>();
const allot = new Map<number, number>();
for (const a of (await billQuery<any>(`SELECT ImprestManagerId id, SUM(Amount) s FROM imprest_allotment_master GROUP BY ImprestManagerId`)) as any[]) allot.set(Number(a.id), Number(a.s));
const spend = new Map<string, number>();
for (const s of (await billQuery<any>(`SELECT userid, BranchId, SUM(CAST(Amount AS DECIMAL(16,2))) s FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' GROUP BY userid, BranchId`)) as any[]) spend.set(`${s.userid}|${s.BranchId}`, Number(s.s));
for (const b of bm) { const h = legacyToHrms.get(Number(b.Id)); if (!h) continue; dbBal.set(h, (dbBal.get(h) ?? 0) + (allot.get(Number(b.Id)) ?? 0) - (spend.get(`${b.UserId}|${b.BranchId}`) ?? 0)); }
out(`balances ${APPLY ? "now" : "after the fix"} for current holders: HRMS vs db_bill (allotments - imprest GRNs)`, [...current].map((h) => `${label(h)} | HRMS ${r2(bal.get(h) ?? 0)} | db_bill ${r2(dbBal.get(h) ?? 0)}`));
await closeBillPool();
process.exit(process.exitCode ?? 0);
