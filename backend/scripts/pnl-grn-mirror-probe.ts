/** Why is a db_bill voucher that IS in the HRMS mirror not counted by the P&L? READ-ONLY. Input: comma-separated GRN numbers. Prints GRN numbers, codes and amounts only. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

(async () => {
  const refs = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const ref of refs) {
    const [lines] = await db.execute<RowDataPacket[]>(
      `SELECT ge.grn_no, ge.period_code, ge.is_rejected, l.cost_centre_code AS line_cc, l.amount,
              ccm.id IS NOT NULL AS cc_found, ccm.company_name, ccm.branch_id IS NOT NULL AS has_branch,
              REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%' AS own_company
         FROM grn_entry_snapshot ge JOIN grn_entry_line_snapshot l ON l.grn_source_id = ge.bill_source_id
         LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code = l.cost_centre_code COLLATE utf8mb4_unicode_ci
        WHERE UPPER(TRIM(ge.grn_no)) = UPPER(?)`, [ref]);
    const [reqs] = await db.execute<RowDataPacket[]>(
      `SELECT grn_number, status, accounting_period, (bill_source_id IS NOT NULL) AS imported, created_by LIKE '00000000-%' AS system_user FROM grn_request WHERE UPPER(TRIM(grn_number)) = UPPER(?)`, [ref]);
    console.log("PROBE " + JSON.stringify({ ref, mirrorLines: lines.map((r) => ({ period: r.period_code, rejected: r.is_rejected, cc: r.line_cc, amount: Math.round(Number(r.amount)), ccFound: r.cc_found, company: r.company_name, ownCompany: r.own_company, hasBranch: r.has_branch })), hrmsGrnRequests: reqs }));
  }
  await new Promise((resolve) => process.stdout.write("PROBE_DONE\n", resolve));
  process.exit(0);
})();
