/**
 * Finishes the merge of the duplicate internal client "MAS CALLNET INDIA PVT LTD" into
 * "MAS Internal (Shared Services)" (owner ruling 2026-10-01). fix-cost-centre-client-from-billing.ts already moved
 * its processes and cost centres; client_contract_master (5 rows) and client_user (1 row) still pointed at it.
 *
 *   Dry run (default, rolls back):  npx tsx scripts/merge-duplicate-internal-client.ts
 *   Apply:                          npx tsx scripts/merge-duplicate-internal-client.ts --apply
 *
 * --apply snapshots the three tables into bkp_20261001b_* first. Rows are updated by primary key (client_id has no
 * index, so a client_id predicate would lock the whole table on the live DB). The duplicate is deactivated, never
 * deleted, and only once nothing references it any more.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const BKP = "bkp_20261001b";
const INTERNAL = "MAS Internal (Shared Services)";
const DUPLICATE = "MAS CALLNET INDIA PVT LTD";

async function main() {
  const conn = await db.getConnection();
  try {
    if (APPLY) {
      for (const t of ["client_master", "client_contract_master", "client_user"]) {
        await conn.query(`CREATE TABLE IF NOT EXISTS ${BKP}_${t} AS SELECT * FROM ${t}`);
      }
      console.log(`backups: ${BKP}_client_master, ${BKP}_client_contract_master, ${BKP}_client_user`);
    }
    await conn.query(`SET SESSION innodb_lock_wait_timeout = 30`);
    await conn.beginTransaction();
    const [[dup]] = await conn.query<RowDataPacket[]>(`SELECT id FROM client_master WHERE client_name = ? LIMIT 1`, [DUPLICATE]);
    const [[internal]] = await conn.query<RowDataPacket[]>(`SELECT id FROM client_master WHERE client_name = ? LIMIT 1`, [INTERNAL]);
    if (!dup || !internal) throw new Error("duplicate or internal client not found");

    const [contracts] = await conn.query<RowDataPacket[]>(`SELECT id FROM client_contract_master WHERE client_id = ?`, [dup.id]);
    for (const r of contracts) await conn.query(`UPDATE client_contract_master SET client_id = ? WHERE id = ?`, [internal.id, r.id]);
    const [users] = await conn.query<RowDataPacket[]>(`SELECT id FROM client_user WHERE client_id = ?`, [dup.id]);
    for (const r of users) await conn.query(`UPDATE client_user SET client_id = ? WHERE id = ?`, [internal.id, r.id]);
    console.log(`re-pointed ${contracts.length} contract(s), ${users.length} client user(s)`);

    // nothing may reference the duplicate before it is deactivated
    const [refs] = await conn.query<RowDataPacket[]>(
      `SELECT table_name t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'client_id'
         AND table_name <> 'client_master' AND table_name NOT LIKE 'bkp\\_%'`);
    const still: string[] = [];
    for (const r of refs) {
      const [[n]] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM \`${r.t}\` WHERE client_id = ?`, [dup.id]);
      if (Number(n.n) > 0) still.push(`${r.t}(${n.n})`);
    }
    if (still.length) console.log(`duplicate left ACTIVE, still referenced by: ${still.join(", ")}`);
    else { await conn.query(`UPDATE client_master SET active_status = 0 WHERE id = ?`, [dup.id]); console.log(`duplicate "${DUPLICATE}" deactivated`); }

    if (APPLY) { await conn.commit(); console.log("COMMITTED"); }
    else { await conn.rollback(); console.log("ROLLED BACK (dry run)"); }
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
    await db.end?.();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
