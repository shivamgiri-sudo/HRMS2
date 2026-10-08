import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { financeBranchFilter, type FinanceBranchScope } from "./finance-access-scope.js";
import { resolveJvAccountNames } from "./journal-voucher.queries.js";

/**
 * Day book and single-voucher view over the journal: every posted entry in a date range with its debit
 * and credit totals, and one entry's lines in the Particulars / Debit / Credit layout used in Tally.
 */

const SOURCE_LABELS: Record<string, string> = {
  grn: "GRN",
  payment_voucher: "Payment voucher",
  bank_reconciliation_adjustment: "Bank reconciliation",
  imprest: "Imprest",
  manual: "Journal voucher",
  payroll: "Payroll",
};

export const sourceLabel = (source: unknown): string => SOURCE_LABELS[String(source)] ?? String(source ?? "Entry");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? "")).slice(0, 10);
const r2 = (n: unknown) => Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;

export function clampPage(limitRaw: unknown, offsetRaw: unknown): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(Number(limitRaw)) || 100, 1), 500);
  const offset = Math.max(Math.trunc(Number(offsetRaw)) || 0, 0);
  return { limit, offset };
}

export const journalBookService = {
  async dayBook(opts: { from?: string; to?: string; sourceType?: string; limit?: unknown; offset?: unknown }, scope?: FinanceBranchScope) {
    const to = opts.to && ISO_DATE.test(opts.to) ? opts.to : new Date().toISOString().slice(0, 10);
    const from = opts.from && ISO_DATE.test(opts.from) ? opts.from : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const { limit, offset } = clampPage(opts.limit, opts.offset);
    const conditions = ["je.entry_date >= ?", "je.entry_date <= ?"];
    const params: unknown[] = [from, to];
    if (opts.sourceType && opts.sourceType in SOURCE_LABELS) {
      conditions.push("je.source_type = ?");
      params.push(opts.sourceType);
    }
    if (scope && scope.mode !== "all") {
      const f = financeBranchFilter(scope, "je.branch_id");
      conditions.push(f.sql);
      params.push(...f.params);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT je.id, je.entry_date, je.narration, je.source_type, je.source_id, je.posted_at, je.reversed_by_entry_id, je.branch_id,
              SUM(l.debit_amount) AS debit, SUM(l.credit_amount) AS credit, COUNT(*) AS line_count
         FROM journal_entry je
         JOIN journal_entry_line l ON l.journal_entry_id = je.id
        WHERE ${conditions.join(" AND ")}
        GROUP BY je.id, je.entry_date, je.narration, je.source_type, je.source_id, je.posted_at, je.reversed_by_entry_id, je.branch_id
        ORDER BY je.entry_date DESC, je.posted_at DESC
        LIMIT ${limit + 1} OFFSET ${offset}`,
      params,
    );
    const page = rows.slice(0, limit);
    const branchIds = [...new Set(page.map((r) => String(r.branch_id ?? "")).filter(Boolean))];
    const branches = new Map<string, string>();
    if (branchIds.length) {
      const [found] = await db.execute<RowDataPacket[]>(
        `SELECT id, branch_name FROM branch_master WHERE id IN (${branchIds.map(() => "?").join(",")})`,
        branchIds,
      );
      for (const b of found) branches.set(String(b.id), String(b.branch_name));
    }
    return {
      from,
      to,
      hasMore: rows.length > limit,
      entries: page.map((r) => ({
        id: String(r.id),
        entryDate: day(r.entry_date),
        narration: String(r.narration ?? ""),
        sourceType: String(r.source_type ?? ""),
        sourceLabel: sourceLabel(r.source_type),
        sourceId: r.source_id ? String(r.source_id) : null,
        postedAt: r.posted_at ? String(r.posted_at) : null,
        reversed: Boolean(r.reversed_by_entry_id),
        branchName: r.branch_id ? branches.get(String(r.branch_id)) ?? null : null,
        debit: r2(r.debit),
        credit: r2(r.credit),
        lines: Number(r.line_count),
      })),
    };
  },

  async voucher(id: string, scope?: FinanceBranchScope) {
    const [entries] = await db.execute<RowDataPacket[]>(
      `SELECT id, entry_date, narration, source_type, source_id, posted_by, posted_at, reversed_by_entry_id, branch_id, cost_centre_id, process_id
         FROM journal_entry WHERE id = ? LIMIT 1`,
      [id],
    );
    const e = entries[0];
    if (!e) return null;
    if (scope && scope.mode !== "all" && !(e.branch_id && scope.branchIds.includes(String(e.branch_id)))) return null;

    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT line_order, account_type, account_id, debit_amount, credit_amount, narration
         FROM journal_entry_line WHERE journal_entry_id = ? ORDER BY line_order, created_at`,
      [id],
    );
    const names = await resolveJvAccountNames(lines.map((l) => ({ accountType: String(l.account_type), accountId: String(l.account_id) })));
    let branchName: string | null = null;
    if (e.branch_id) {
      const [b] = await db.execute<RowDataPacket[]>(`SELECT branch_name FROM branch_master WHERE id = ?`, [e.branch_id]);
      branchName = b[0]?.branch_name ? String(b[0].branch_name) : null;
    }
    const out = lines.map((l) => {
      const name = names.get(`${l.account_type}:${l.account_id}`);
      return {
        accountType: String(l.account_type),
        accountName: name?.label ?? `(unresolved ${l.account_type})`,
        accountNote: name?.hint ?? null,
        debit: r2(l.debit_amount),
        credit: r2(l.credit_amount),
        narration: l.narration ? String(l.narration) : null,
      };
    });
    const debit = r2(out.reduce((s, l) => s + l.debit, 0));
    const credit = r2(out.reduce((s, l) => s + l.credit, 0));
    return {
      id: String(e.id),
      entryDate: day(e.entry_date),
      narration: String(e.narration ?? ""),
      sourceType: String(e.source_type ?? ""),
      sourceLabel: sourceLabel(e.source_type),
      sourceId: e.source_id ? String(e.source_id) : null,
      postedAt: e.posted_at ? String(e.posted_at) : null,
      reversed: Boolean(e.reversed_by_entry_id),
      branchName,
      lines: out,
      totals: { debit, credit, balanced: debit === credit },
    };
  },
};
