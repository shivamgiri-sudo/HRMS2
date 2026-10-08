/**
 * Merge duplicate-named master rows. DRY RUN BY DEFAULT.
 *
 * For each master, rows sharing UPPER(TRIM(name)) form a group. The survivor is the row with
 * the most employees (ties: active first, then lowest id). Every other row in the group is a
 * loser: every foreign-key-style column (department_id, branch_id, ...) in every base table
 * that holds a loser id is repointed to the survivor, then the loser is deactivated
 * (active_status = 0 when the master has that column). Losers are never deleted.
 *
 * The whole run is ONE transaction. Without --apply it rolls back, so the dry run executes the
 * real statements (including any unique-key collision) and reports exact row counts.
 * With --apply it commits only if there were zero errors.
 *
 *   npx tsx scripts/master-duplicate-merge.ts                       # dry run, all masters
 *   npx tsx scripts/master-duplicate-merge.ts --masters=department,designation
 *   npx tsx scripts/master-duplicate-merge.ts --masters=department --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const ALL = ["department", "designation", "branch", "process", "cost_centre"] as const;
type Key = (typeof ALL)[number];
const arg = process.argv.find((a) => a.startsWith("--masters="));
const WANT = (arg ? arg.slice(10).split(",").map((s) => s.trim()) : [...ALL]) as Key[];
for (const w of WANT) if (!ALL.includes(w)) { console.error(`unknown master '${w}'`); process.exit(2); }
if (APPLY && !arg) { console.error("--apply requires an explicit --masters=… list"); process.exit(2); }

const MASTERS: Record<Key, { table: string; name: string; fk: string[]; empFk: string }> = {
  department: { table: "department_master", name: "dept_name", fk: ["department_id", "dept_id"], empFk: "department_id" },
  designation: { table: "designation_master", name: "designation_name", fk: ["designation_id"], empFk: "designation_id" },
  branch: { table: "branch_master", name: "branch_name", fk: ["branch_id"], empFk: "branch_id" },
  process: { table: "process_master", name: "process_name", fk: ["process_id"], empFk: "process_id" },
  cost_centre: { table: "cost_centre_master", name: "cost_centre_name", fk: ["cost_centre_id"], empFk: "cost_centre_id" },
};

(async () => {
  const conn = await db.getConnection();
  const rowsOf = async (sql: string, p: unknown[] = []) => (await conn.query(sql, p))[0] as any[];
  let errors = 0;
  try {
    console.log(`mode: ${APPLY ? "APPLY (commits if no errors)" : "DRY RUN (rolls back)"}  masters: ${WANT.join(",")}`);
    await conn.beginTransaction();

    for (const key of WANT) {
      const m = MASTERS[key];
      const hasActive = (await rowsOf(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
          AND table_name = ? AND column_name = 'active_status'`, [m.table])).length > 0;
      const all = await rowsOf(
        `SELECT t.id, t.${m.name} AS name, ${hasActive ? "t.active_status" : "1"} AS active,
                (SELECT COUNT(*) FROM employees e WHERE e.${m.empFk} = t.id) AS employees
           FROM ${m.table} t`);
      const groups = new Map<string, any[]>();
      for (const r of all) {
        const norm = String(r.name ?? "").trim().toUpperCase();
        if (!norm) continue;
        (groups.get(norm) ?? groups.set(norm, []).get(norm)!).push(r);
      }
      const dup = [...groups.entries()].filter(([, g]) => g.length > 1);

      const refs = await rowsOf(
        `SELECT c.table_name AS t, c.column_name AS c
           FROM information_schema.columns c
           JOIN information_schema.tables x
             ON x.table_schema = c.table_schema AND x.table_name = c.table_name AND x.table_type = 'BASE TABLE'
          WHERE c.table_schema = DATABASE() AND c.column_name IN (${m.fk.map(() => "?").join(",")})
            AND c.table_name <> ?
            AND c.table_name NOT LIKE 'bkp\\_%'
          ORDER BY c.table_name`, [...m.fk, m.table]);

      console.log(`\n=== ${m.table}: ${dup.length} duplicate names, ${refs.length} referencing columns ===`);
      const touched = new Map<string, number>();

      for (const [norm, g] of dup) {
        // survivor: active first, then most employees, then lowest id
        g.sort((a, b) => (Number(b.active) - Number(a.active)) || (Number(b.employees) - Number(a.employees)) || String(a.id).localeCompare(String(b.id)));
        const [keep, ...losers] = g;
        console.log(`  ${norm}: keep ${keep.id} (${keep.employees} emp) <- ${losers.map((l) => `${l.id} (${l.employees} emp)`).join(", ")}`);
        for (const loser of losers) {
          for (const { t, c } of refs) {
            try {
              const [r]: any = await conn.query(`UPDATE \`${t}\` SET \`${c}\` = ? WHERE \`${c}\` = ?`, [keep.id, loser.id]);
              if (r.affectedRows) touched.set(`${t}.${c}`, (touched.get(`${t}.${c}`) ?? 0) + r.affectedRows);
            } catch (e: any) {
              errors++;
              console.log(`    ERROR ${t}.${c}: ${e.code} ${e.sqlMessage ?? e.message}`);
            }
          }
          if (hasActive) await conn.query(`UPDATE ${m.table} SET active_status = 0 WHERE id = ?`, [loser.id]);
        }
      }
      console.log(`  -- rows repointed per column (${touched.size} columns touched):`);
      for (const [k, n] of [...touched.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(8)}  ${k}`);
    }

    if (APPLY && errors === 0) {
      await conn.commit();
      console.log("\nCOMMITTED.");
    } else {
      await conn.rollback();
      console.log(`\nROLLED BACK. errors=${errors}${APPLY ? " (apply aborted because of errors)" : " (dry run)"}`);
    }
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error("FAILED, rolled back:", e);
    process.exitCode = 1;
  } finally {
    conn.release();
    process.exit(process.exitCode ?? 0);
  }
})();
