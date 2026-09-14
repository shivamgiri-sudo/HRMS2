import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Receivables ageing, bucketed by days since invoice_date (NOT "days overdue" — this table has no
 * due_date column, so there is no way to know a contractual due date; every bucket label says
 * "since invoice" for that reason).
 *
 * Unpaid = billing_invoice_snapshot.payment_status = '0' (confirmed live: 10,913 unpaid rows /
 * Rs 39.71 Cr vs 118 paid rows / Rs 3.02 Cr, measured 2026-09-10).
 *
 * DATA-QUALITY CAVEAT, NOT A NICE-TO-HAVE. 98.9% of the unpaid amount lands in the 90+ bucket,
 * which is not a plausible real ageing curve for an operating BPO — it is the signature of a flag
 * that is set once (perhaps at import) and essentially never updated as invoices are actually
 * collected. This service returns a `caveat` field alongside every response; the UI is required to
 * render it as a visible warning badge (reusing the existing dataStatus/missing_rule badge pattern
 * from useProcessLobPnl / ProcessLobManagementPage) rather than presenting the buckets as an
 * authoritative live AR position.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export type AgeingBucketId = "0-30" | "31-60" | "61-90" | "90+";
export const AGEING_BUCKETS: AgeingBucketId[] = ["0-30", "31-60", "61-90", "90+"];

export interface AgeingBucketAmounts {
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
}

export interface PnlReceivablesAgeingProcessRow {
  processId: string | null;
  processName: string | null;
  buckets: AgeingBucketAmounts;
  total: number;
  invoiceCount: number;
}

export interface PnlReceivablesAgeingResult {
  asOfDate: string;
  totals: AgeingBucketAmounts;
  grandTotal: number;
  byProcess: PnlReceivablesAgeingProcessRow[];
  dataStatus: "approximate";
  caveat: string;
}

const emptyBuckets = (): AgeingBucketAmounts => ({ "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 });

function bucketFor(days: number): AgeingBucketId {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function getReceivablesAgeing(filters: { branchId?: string; processId?: string } = {}): Promise<PnlReceivablesAgeingResult> {
  const branchClause = filters.branchId ? "AND ccm.branch_id = ?" : "";
  const processClause = filters.processId ? "AND pm.id = ?" : "";
  const params: unknown[] = [];
  if (filters.branchId) params.push(filters.branchId);
  if (filters.processId) params.push(filters.processId);

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT pm.id AS processId, pm.process_name AS processName,
            bis.grand_total AS amount,
            DATEDIFF(CURDATE(), bis.invoice_date) AS daysSinceInvoice
       FROM billing_invoice_snapshot bis
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci = bis.cost_centre_code COLLATE utf8mb4_unicode_ci
       LEFT JOIN process_master pm ON pm.id = ccm.process_id
      WHERE bis.payment_status = '0' AND bis.invoice_date IS NOT NULL ${branchClause} ${processClause}`,
    params
  );

  const totals = emptyBuckets();
  let grandTotal = 0;
  const byProcessMap = new Map<string, PnlReceivablesAgeingProcessRow>();

  for (const row of rows) {
    const amount = n(row.amount);
    const days = n(row.daysSinceInvoice);
    const bucket = bucketFor(days);
    totals[bucket] += amount;
    grandTotal += amount;

    const processId = row.processId != null ? String(row.processId) : null;
    const key = processId ?? "__unmapped__";
    let entry = byProcessMap.get(key);
    if (!entry) {
      entry = {
        processId,
        processName: processId != null ? String(row.processName ?? "Unnamed process") : "Not mapped to a process",
        buckets: emptyBuckets(),
        total: 0,
        invoiceCount: 0,
      };
      byProcessMap.set(key, entry);
    }
    entry.buckets[bucket] += amount;
    entry.total += amount;
    entry.invoiceCount += 1;
  }

  const byProcess = Array.from(byProcessMap.values()).sort((a, b) => b.total - a.total);

  return {
    asOfDate: new Date().toISOString().slice(0, 10),
    totals,
    grandTotal,
    byProcess,
    dataStatus: "approximate",
    caveat:
      "Buckets are computed from days since invoice_date, not days overdue — this table has no due_date column. " +
      "Roughly 99% of the unpaid amount falls in the 90+ bucket, which looks less like a live ageing curve than a " +
      "payment_status flag that is rarely updated after import. Treat these figures as directional only, not as an " +
      "authoritative current AR position.",
  };
}
