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
  console.log(`SUMMARY branches=${branches.length} ok=${tally.ok} none=${tally.none} ambiguous=${tally.ambiguous}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
