import type { RowDataPacket } from "mysql2";

/**
 * Daily GRN integrity checks for the Accounts Head and Finance Head.
 *
 * Each check returns a short list; buildDigest turns the non-empty ones into one inbox message. The
 * checks are the ones the six-month review found worth watching: a bill still in approval whose twin is
 * already paid, bills raised long after the bill date, vendor GRNs with no vendor, and imprest bills
 * entered twice by the same person on the same day.
 */

type Executor = { execute(sql: string, params?: any[]): Promise<[any, any]> };

export type DigestSection = {
  key: string;
  title: string;
  count: number;
  lines: string[];
};

const OPEN_STATUSES = [
  "submitted",
  "branch_head_approved",
  "accounts_head_approved",
  "finance_head_approved",
  "pending_accounts_payment",
];
const TOP = 5;

const rupees = (n: unknown) =>
  `₹${Math.round(Number(n ?? 0)).toLocaleString("en-IN")}`;

export async function paidTwinsStillOpen(db: Executor): Promise<DigestSection> {
  const [rows] = (await db.execute(
    `SELECT g.grn_number, g.vendor_name, g.amount, g.status, p.grn_number AS paid_grn
       FROM grn_request g
       JOIN grn_request p
         ON p.vendor_id = g.vendor_id AND p.id <> g.id AND p.status = 'paid'
        AND ABS(p.amount - g.amount) <= 1
        AND DATE_FORMAT(p.bill_date, '%Y-%m') = DATE_FORMAT(g.bill_date, '%Y-%m')
        AND p.branch_id <=> g.branch_id
      WHERE g.grn_type = 'vendor' AND g.vendor_id IS NOT NULL AND g.amount >= 1000
        AND g.status IN (${OPEN_STATUSES.map(() => "?").join(",")})
        AND g.created_at >= DATE_SUB(NOW(), INTERVAL 120 DAY)
      ORDER BY g.amount DESC
      LIMIT 200`,
    OPEN_STATUSES,
  )) as [RowDataPacket[], unknown];
  return {
    key: "paid_twin",
    title: "Bills in approval whose twin is already paid",
    count: rows.length,
    lines: rows
      .slice(0, TOP)
      .map(
        (r) =>
          `${r.vendor_name ?? "Vendor"} ${rupees(r.amount)}: ${r.grn_number ?? "no number yet"} (${String(r.status).replace(/_/g, " ")}) matches paid ${r.paid_grn ?? "GRN"}`,
      ),
  };
}

export async function lateBills(db: Executor): Promise<DigestSection> {
  const [rows] = (await db.execute(
    `SELECT grn_number, vendor_name, amount, DATEDIFF(created_at, bill_date) AS days_late
       FROM grn_request
      WHERE grn_type = 'vendor' AND bill_source_id IS NULL AND bill_date IS NOT NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND DATEDIFF(created_at, bill_date) > 30
        AND status NOT IN ('draft', 'rejected', 'cancelled')
      ORDER BY amount DESC
      LIMIT 100`,
  )) as [RowDataPacket[], unknown];
  return {
    key: "late_bill",
    title: "Bills raised more than 30 days after the bill date",
    count: rows.length,
    lines: rows
      .slice(0, TOP)
      .map(
        (r) =>
          `${r.vendor_name ?? "Vendor"} ${rupees(r.amount)}: ${r.days_late} days late (${r.grn_number ?? "no number yet"})`,
      ),
  };
}

export async function vendorGrnsWithoutVendor(
  db: Executor,
): Promise<DigestSection> {
  const [rows] = (await db.execute(
    `SELECT grn_number, amount, head, sub_head
       FROM grn_request
      WHERE grn_type = 'vendor' AND bill_source_id IS NULL AND vendor_id IS NULL
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND status NOT IN ('draft', 'rejected', 'cancelled')
      ORDER BY amount DESC
      LIMIT 100`,
  )) as [RowDataPacket[], unknown];
  return {
    key: "no_vendor",
    title: "Vendor GRNs raised with no vendor",
    count: rows.length,
    lines: rows
      .slice(0, TOP)
      .map(
        (r) =>
          `${rupees(r.amount)} under ${r.sub_head ?? r.head ?? "no head"} (${r.grn_number ?? "no number yet"})`,
      ),
  };
}

export async function imprestRepeats(db: Executor): Promise<DigestSection> {
  const [rows] = (await db.execute(
    `SELECT sub_head, amount, COUNT(*) AS n
       FROM grn_request
      WHERE grn_type = 'imprest' AND bill_source_id IS NULL AND amount >= 200
        AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
        AND status NOT IN ('draft', 'rejected', 'cancelled')
      GROUP BY created_by, bill_date, amount, sub_head
     HAVING COUNT(*) > 1
      ORDER BY amount * COUNT(*) DESC
      LIMIT 100`,
  )) as [RowDataPacket[], unknown];
  return {
    key: "imprest_repeat",
    title:
      "Imprest bills entered more than once by the same person on the same day",
    count: rows.length,
    lines: rows
      .slice(0, TOP)
      .map(
        (r) =>
          `${r.n} entries of ${rupees(r.amount)} under ${r.sub_head ?? "no sub-head"}`,
      ),
  };
}

/** One inbox message from the non-empty sections, or null when everything is clear. */
export function buildDigest(
  sections: DigestSection[],
  dateLabel: string,
): { title: string; description: string; urgent: boolean } | null {
  const active = sections.filter((s) => s.count > 0);
  if (!active.length) return null;
  const total = active.reduce((s, x) => s + x.count, 0);
  const description = active
    .map(
      (s) =>
        `${s.title}: ${s.count}\n${s.lines.map((l) => `  - ${l}`).join("\n")}${s.count > s.lines.length ? `\n  - and ${s.count - s.lines.length} more` : ""}`,
    )
    .join("\n\n");
  return {
    title: `GRN check ${dateLabel}: ${total} item${total === 1 ? "" : "s"} to look at`,
    description,
    urgent: active.some((s) => s.key === "paid_twin"),
  };
}

export async function collectGrnIntegrity(
  db: Executor,
): Promise<DigestSection[]> {
  return [
    await paidTwinsStillOpen(db),
    await lateBills(db),
    await vendorGrnsWithoutVendor(db),
    await imprestRepeats(db),
  ];
}
