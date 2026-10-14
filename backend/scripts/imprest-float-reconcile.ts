/**
 * Imprest float reconciliation — read-only (HRMS SELECTs only; db_bill through billQuery).
 *
 *   npx tsx scripts/imprest-float-reconcile.ts
 *
 * Per float holder: the HRMS ledger balance next to db_bill's (allotments minus imprest GRNs), the
 * duplicate imprest_manager rows (same person, same branch, same Tally ledger), and what never reached
 * the ledger (finance-approved imprest GRNs and disbursed allocations with no ledger row).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const q = async (sql: string, params: unknown[] = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only");
  return (await db.query<RowDataPacket[]>(sql, params))[0] as any[];
};
const loose = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const out = (title: string, rows: unknown[]) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(typeof r === "string" ? `  ${r}` : `  ${JSON.stringify(r)}`);
};

// ── HRMS managers ───────────────────────────────────────────────────────────────────────────────
const managers = await q(`SELECT im.id, im.branch_id, im.user_id, im.employee_id, im.tally_name, im.effective_from, im.effective_to,
  im.active_status, im.created_at, b.branch_name
  FROM imprest_manager im LEFT JOIN branch_master b ON b.id = im.branch_id ORDER BY b.branch_name, im.effective_from`);
const users = new Map<string, string>();
const ids = (k: string) => [...new Set(managers.map((m) => String(m[k] ?? "")).filter(Boolean))];
if (ids("user_id").length) for (const u of await q(`SELECT id, email FROM auth_user WHERE id IN (?)`, [ids("user_id")])) users.set(String(u.id), String(u.email ?? ""));
const people = new Map<string, string>();
if (ids("employee_id").length) for (const e of await q(`SELECT id, employee_code, first_name, last_name FROM employees WHERE id IN (?)`, [ids("employee_id")]))
  people.set(String(e.id), `${e.first_name ?? ""} ${e.last_name ?? ""} (${e.employee_code ?? ""})`.replace(/\s+/g, " ").trim());

const ledger = new Map<string, any>();
for (const l of await q(`SELECT imprest_manager_id id,
    SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END) cr, SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END) dr,
    SUM(CASE WHEN direction='credit' AND entry_type='allocation' THEN amount ELSE 0 END) alloc,
    SUM(CASE WHEN direction='debit' AND entry_type='voucher' THEN amount ELSE 0 END) vouchers,
    SUM(CASE WHEN entry_type='adjustment' THEN IF(direction='credit', amount, -amount) ELSE 0 END) adj,
    SUM(CASE WHEN entry_type='opening' THEN IF(direction='credit', amount, -amount) ELSE 0 END) opening,
    COUNT(*) n, MAX(period_code) last_period,
    SUM(created_at >= '2026-09-01' AND created_by NOT LIKE '00000000-%') live_rows
  FROM imprest_transaction_ledger GROUP BY imprest_manager_id`)) ledger.set(String(l.id), l);

const rows = managers.map((m) => {
  const l = ledger.get(String(m.id)) ?? {};
  return {
    id: String(m.id).slice(0, 8), branch: m.branch_name, person: people.get(String(m.employee_id)) ?? "", email: users.get(String(m.user_id)) ?? "",
    tally: m.tally_name, active: m.active_status, from: String(m.effective_from ?? "").slice(0, 10), to: String(m.effective_to ?? "").slice(0, 10),
    balance: r2(Number(l.cr ?? 0) - Number(l.dr ?? 0)), alloc: r2(Number(l.alloc ?? 0)), vouchers: r2(Number(l.vouchers ?? 0)),
    adj: r2(Number(l.adj ?? 0)), opening: r2(Number(l.opening ?? 0)), entries: Number(l.n ?? 0), live: Number(l.live_rows ?? 0), last: l.last_period ?? "",
  };
});
out("HRMS imprest managers with ledger totals", rows);

const groupBy = (key: (r: any) => string) => {
  const g = new Map<string, any[]>();
  for (const r of rows) { const k = key(r); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k)!.push(r); }
  return [...g.entries()].filter(([, v]) => v.length > 1);
};
out("duplicates: same person (email local part)", groupBy((r) => loose(String(r.email).split("@")[0])).map(([k, v]) => `${k}: ${v.map((r) => `${r.id}@${r.branch}[${r.active ? "active" : "inactive"} bal ${r.balance}, ${r.entries} rows]`).join(" | ")}`));
out("duplicates: same branch, more than one ACTIVE", groupBy((r) => (r.active ? loose(r.branch) : "")).map(([k, v]) => `${k}: ${v.map((r) => `${r.id} ${r.person || r.email} bal ${r.balance}`).join(" | ")}`));
out("duplicates: same Tally ledger", groupBy((r) => loose(r.tally)).map(([k, v]) => `${k}: ${v.map((r) => `${r.id}@${r.branch} ${r.person || r.email}`).join(" | ")}`));
out("managers with no person or login", rows.filter((r) => !r.person && !r.email).map((r) => `${r.id}@${r.branch} tally=${r.tally}`));

// ── what never reached the ledger ───────────────────────────────────────────────────────────────
out("finance-approved imprest GRNs (HRMS-raised) with no ledger row, by branch", await q(`SELECT b.branch_name, COUNT(*) n, SUM(COALESCE(NULLIF(g.amount_with_tax,0), g.amount)) amount,
    MIN(g.grn_number) first_grn, MAX(g.grn_number) last_grn, SUM(g.imprest_manager_id IS NULL) no_manager_on_grn
  FROM grn_request g LEFT JOIN branch_master b ON b.id = g.branch_id
  WHERE g.grn_type = 'imprest' AND g.bill_source_id IS NULL AND g.status IN ('approved','paid') AND g.imprest_ledger_entry_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM imprest_transaction_ledger l WHERE l.reference_type = 'grn_request' AND l.reference_id = g.id)
  GROUP BY b.branch_name`));
out("finance-approved imprest GRNs (HRMS-raised) WITH a ledger row, by branch", await q(`SELECT b.branch_name, COUNT(*) n, SUM(COALESCE(NULLIF(g.amount_with_tax,0), g.amount)) amount
  FROM grn_request g LEFT JOIN branch_master b ON b.id = g.branch_id
  WHERE g.grn_type = 'imprest' AND g.bill_source_id IS NULL AND g.status IN ('approved','paid')
    AND (g.imprest_ledger_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM imprest_transaction_ledger l WHERE l.reference_type = 'grn_request' AND l.reference_id = g.id))
  GROUP BY b.branch_name`));
out("imprest GRN statuses (HRMS-raised)", await q(`SELECT status, COUNT(*) n, SUM(COALESCE(NULLIF(amount_with_tax,0), amount)) amount FROM grn_request WHERE grn_type='imprest' AND bill_source_id IS NULL GROUP BY status`));
out("allocations by status, and disbursed ones with no ledger credit", await q(`SELECT a.status, COUNT(*) n, SUM(a.amount) amount,
    SUM(NOT EXISTS (SELECT 1 FROM imprest_transaction_ledger l WHERE l.reference_type='imprest_allocation' AND l.reference_id=a.id)) no_ledger,
    SUM(a.bill_source_id IS NULL) hrms_raised, MAX(a.allocation_date) latest
  FROM imprest_allocation a GROUP BY a.status`));

// ── db_bill side ────────────────────────────────────────────────────────────────────────────────
const bm = (await billQuery<any>(`SELECT Id, UserId, UserName, EmailId, TallyHead, BranchId, Branch, Active FROM imprest_manager`)) as any[];
const allot = new Map<string, any>();
for (const a of (await billQuery<any>(`SELECT ImprestManagerId id, SUM(Amount) amt, COUNT(*) n, MAX(STR_TO_DATE(EntryDate,'%d-%m-%Y')) last FROM imprest_allotment_master GROUP BY ImprestManagerId`)) as any[]) allot.set(String(a.id), a);
// Legacy imprest GRNs are keyed by the entering user and branch.
const spend = new Map<string, any>();
for (const s of (await billQuery<any>(`SELECT userid, BranchId, SUM(CAST(Amount AS DECIMAL(16,2))) amt, COUNT(*) n, MAX(createdate) last FROM expense_entry_master WHERE ExpenseEntryType='Imprest' GROUP BY userid, BranchId`)) as any[])
  spend.set(`${s.userid}|${s.BranchId}`, s);
const legacy = bm.map((m) => {
  const a = allot.get(String(m.Id)); const s = spend.get(`${m.UserId}|${m.BranchId}`);
  return { id: m.Id, branch: m.Branch, user: m.UserName, email: m.EmailId, tally: m.TallyHead, active: m.Active,
    allotted: r2(Number(a?.amt ?? 0)), spent: r2(Number(s?.amt ?? 0)), legacy_balance: r2(Number(a?.amt ?? 0) - Number(s?.amt ?? 0)),
    allot_n: Number(a?.n ?? 0), spend_n: Number(s?.n ?? 0), last_allot: a?.last ? String(a.last).slice(0, 10) : "", last_spend: s?.last ? String(s.last).slice(0, 10) : "" };
}).filter((m) => m.allot_n || m.spend_n);
out("db_bill float holders with activity (allotments - imprest GRNs)", legacy);

// ── side by side for active HRMS holders ────────────────────────────────────────────────────────
const side = rows.filter((r) => r.active).map((r) => {
  const local = loose(String(r.email).split("@")[0]);
  const hits = legacy.filter((l) => loose(l.branch) === loose(r.branch) && (loose(String(l.email).split("@")[0]) === local || loose(l.tally) === loose(r.tally)));
  const lb = hits.reduce((s, h) => s + h.legacy_balance, 0);
  return `${r.branch} | ${r.person || r.email} | tally ${r.tally ?? "-"} | HRMS ${r.balance} | db_bill ${hits.length ? r2(lb) : "no match"} (${hits.map((h) => h.id).join(",")}) | diff ${hits.length ? r2(r.balance - lb) : "-"}`;
});
out("active holders: HRMS ledger balance vs db_bill balance", side);
await closeBillPool();
process.exit(0);
