/**
 * Splits the merged client "DU Digital" into the two clients db_bill bills separately (owner ruling 2026-10-02:
 * "two different"):
 *   - DU DIGITAL TECHNOLOGIES LIMITED  : BSS/IB/Noida/654          (keeps the existing client row, renamed)
 *   - Dudigital Global Limited         : BSS/BO/NOIDA-DD/843, BSS/OB/Noida/978 (new client row)
 * The process shared by 843 and 978 (BSS_BO_NOIDA_DD_843) moves to the new client with them.
 *
 *   Dry run (default, rolls back):  npx tsx scripts/split-du-digital-client.ts
 *   Apply:                          npx tsx scripts/split-du-digital-client.ts --apply
 *
 * --apply snapshots client_master, cost_centre_master and process_master into bkp_20261002_* first. Rows are
 * updated by primary key (client_id has no index; a client_id predicate would lock the whole table on the live DB).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const BKP = "bkp_20261002";
const OLD_NAME = "DU Digital";
const TECH = "DU DIGITAL TECHNOLOGIES LIMITED";
const GLOBAL = "Dudigital Global Limited";
const GLOBAL_CODE = "DUDIGITAL_GLOBAL_LIMITED";
const GLOBAL_CCS = ["BSS/BO/NOIDA-DD/843", "BSS/OB/Noida/978"];
const TECH_CCS = ["BSS/IB/Noida/654"];

async function main() {
  const conn = await db.getConnection();
  try {
    if (APPLY) {
      for (const t of ["client_master", "cost_centre_master", "process_master"]) {
        await conn.query(`CREATE TABLE IF NOT EXISTS ${BKP}_${t} AS SELECT * FROM ${t}`);
      }
      console.log(`backups: ${BKP}_client_master, ${BKP}_cost_centre_master, ${BKP}_process_master`);
    }
    await conn.query(`SET SESSION innodb_lock_wait_timeout = 30`);
    await conn.beginTransaction();

    const [[old]] = await conn.query<RowDataPacket[]>(`SELECT id, client_code, client_name FROM client_master WHERE client_name IN (?, ?) ORDER BY client_name = ? DESC LIMIT 1`, [OLD_NAME, TECH, OLD_NAME]);
    if (!old) throw new Error(`client "${OLD_NAME}" not found`);
    const [[existingGlobal]] = await conn.query<RowDataPacket[]>(`SELECT id FROM client_master WHERE client_name = ? LIMIT 1`, [GLOBAL]);

    // 1. the old client keeps its row and becomes DU DIGITAL TECHNOLOGIES LIMITED
    await conn.query(`UPDATE client_master SET client_name = ?, legal_entity_name = ? WHERE id = ?`, [TECH, TECH, old.id]);
    // 2. the new client
    let globalId = existingGlobal?.id as string | undefined;
    if (!globalId) {
      globalId = randomUUID();
      await conn.query(`INSERT INTO client_master (id, client_code, client_name, legal_entity_name, active_status) VALUES (?,?,?,?,1)`, [globalId, GLOBAL_CODE, GLOBAL, GLOBAL]);
    }
    // 3. move the Global cost centres and their processes
    const [ccs] = await conn.query<RowDataPacket[]>(`SELECT id, cost_centre_code, process_id FROM cost_centre_master WHERE cost_centre_code IN (?) AND status = 'active' AND active_status = 1`, [GLOBAL_CCS]);
    if (ccs.length !== GLOBAL_CCS.length) throw new Error(`expected ${GLOBAL_CCS.length} cost centres, found ${ccs.length}`);
    const procIds = new Set<string>();
    for (const cc of ccs) {
      await conn.query(`UPDATE cost_centre_master SET client_id = ?, client_name = ?, billing_client_name = ? WHERE id = ?`, [globalId, GLOBAL, GLOBAL, cc.id]);
      if (cc.process_id) procIds.add(String(cc.process_id));
    }
    // a process moves only if no Technologies cost centre also uses it
    const [techCcs] = await conn.query<RowDataPacket[]>(`SELECT id, process_id FROM cost_centre_master WHERE cost_centre_code IN (?)`, [TECH_CCS]);
    const techProcs = new Set(techCcs.map((r) => String(r.process_id)));
    const moved: string[] = [], shared: string[] = [];
    for (const pid of procIds) {
      if (techProcs.has(pid)) { shared.push(pid); continue; }
      await conn.query(`UPDATE process_master SET client_id = ?, client_name = ? WHERE id = ?`, [globalId, GLOBAL, pid]);
      moved.push(pid);
    }
    for (const cc of techCcs) await conn.query(`UPDATE cost_centre_master SET client_id = ?, client_name = ?, billing_client_name = ? WHERE id = ?`, [old.id, TECH, TECH, cc.id]);

    console.log(`renamed "${old.client_name}" -> "${TECH}" (${old.id})`);
    console.log(`${existingGlobal ? "re-used" : "created"} "${GLOBAL}" (${globalId}); ${ccs.length} cost centre(s) and ${moved.length} process(es) moved${shared.length ? `; ${shared.length} shared process(es) left with Technologies: ${shared.join(",")}` : ""}`);

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
