/**
 * Read-only: for each catalogue process, which process_master rows really hold employees. Finds the process codes staff are
 * actually assigned to (e.g. BSS_* cost-centre rows) so the catalogue / TPZ mapping points at rows that have people.
 * Prints codes, names and headcounts only - no employee data.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { SEED_PROCESSES } from "../src/modules/kpi-catalogue/kpi-catalogue.seed.js";

const PATTERNS: Record<string, string[]> = {
  gnc: ["gnc", "nutrition"], housing_owner: ["housing", "owner"], housing_premium: ["housing", "premium"], reginald: ["reginald", "regin"],
  sbi_card: ["sbi"], satya_retail: ["satya"], finnable: ["finnable"], neemans: ["neeman"], clovia: ["clovia"], dalmia: ["dalmia"],
  appreciate_health: ["apprec", "appric"], lp_feedback: ["lawyer", "eresolution", "lp "], lp_onboarding: ["lawyer", "eresolution", "lp "],
  gs1: ["gs1"], bla_bli_blu: ["bla", "blabli"], birlanu: ["birla"], bellavita: ["bella", "bevz"], du_bangladesh: ["du digital", "bangladesh"],
  viega: ["viega"], exicom: ["exicom"],
};

try {
  for (const p of SEED_PROCESSES.filter((x) => x.processKey !== "_global" && PATTERNS[x.processKey])) {
    const likes = PATTERNS[p.processKey];
    const [rows] = await db.execute(
      `SELECT pm.process_code, pm.process_name, pm.client_name, pm.active_status,
              (SELECT COUNT(*) FROM employees e WHERE e.process_id = pm.id AND e.active_status = 1) AS headcount
         FROM process_master pm
        WHERE ${likes.map(() => "(LOWER(pm.process_name) LIKE ? OR LOWER(pm.process_code) LIKE ? OR LOWER(COALESCE(pm.client_name,'')) LIKE ?)").join(" OR ")}
           OR pm.process_code IN (${p.processCodes.length ? p.processCodes.map(() => "?").join(",") : "''"})
        ORDER BY headcount DESC`,
      [...likes.flatMap((l) => [`%${l}%`, `%${l}%`, `%${l}%`]), ...p.processCodes] as never[],
    );
    console.log(`\n## ${p.processKey} (mapped: ${p.processCodes.join(", ") || "-"})`);
    for (const r of rows as Array<Record<string, unknown>>) {
      const mapped = p.processCodes.includes(String(r.process_code)) ? "MAPPED" : "      ";
      console.log(`map | ${p.processKey} | ${mapped} | ${r.process_code} | ${String(r.process_name).slice(0, 48)} | client ${String(r.client_name ?? "-").slice(0, 30)} | active ${r.active_status} | headcount ${r.headcount}`);
    }
  }
} finally {
  await (db as unknown as { end?: () => Promise<void> }).end?.();
  process.exit(0);
}
