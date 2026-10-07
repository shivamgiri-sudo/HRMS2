/** READ-ONLY. For every active branch, shows the Back Office cost centre the GRN branch split would pick. */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { listBackOfficeCandidates, pickBackOffice } from "../src/modules/finance/grn-branch-split.js";

async function main() {
  const [branches] = (await db.execute(
    `SELECT id, branch_name FROM branch_master
      WHERE active_status = 1 AND (close_date IS NULL OR close_date > CURDATE()) ORDER BY branch_name`,
  )) as [Array<{ id: string; branch_name: string }>, unknown];
  const tally = { ok: 0, none: 0, ambiguous: 0 };
  for (const b of branches) {
    const cands = await listBackOfficeCandidates(b.id);
    const pick = pickBackOffice(cands);
    const how = (c: (typeof cands)[number]) =>
      [c.byType && "type", c.byCode && "code", c.byName && "name", c.clientBilled && "CLIENT-BILLED"].filter(Boolean).join("+");
    const list = cands.map((c) => `${c.code} "${c.name ?? ""}" [${how(c)}]`).join(" ; ");
    if (pick.ok) { tally.ok++; console.log(`OK        ${b.branch_name} -> ${pick.costCentre.code} "${pick.costCentre.name ?? ""}"${cands.length > 1 ? `   (others: ${list})` : ""}`); }
    else { tally[pick.reason === "NONE" ? "none" : "ambiguous"]++; console.log(`${pick.reason === "NONE" ? "NONE     " : "AMBIGUOUS"} ${b.branch_name} -> ${list || "no candidates"}`); }
  }
  const [raw] = (await db.execute(
    `SELECT bm.branch_name, ccm.cost_centre_code, ccm.cost_centre_name, ccm.cc_type, ccm.cost_center_type, ccm.process_type,
            ccm.revenue_flag, ccm.billing_flag, ccm.billing_client_name, ccm.client_name, ccm.company_name, ccm.status
       FROM cost_centre_master ccm JOIN branch_master bm ON bm.id = ccm.branch_id
      WHERE ccm.active_status = 1 AND (ccm.cost_centre_code LIKE '%/BO/%' OR UPPER(ccm.cost_centre_name) REGEXP '(^|[^A-Z])BO([^A-Z]|$)' OR UPPER(ccm.cost_centre_name) LIKE '%BACK%OFFICE%')
      ORDER BY bm.branch_name, ccm.cost_centre_code`,
  )) as [Array<Record<string, unknown>>, unknown];
  for (const r of raw) console.log(`RAW ${JSON.stringify(r)}`);
  console.log(`SUMMARY branches=${branches.length} ok=${tally.ok} none=${tally.none} ambiguous=${tally.ambiguous}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
