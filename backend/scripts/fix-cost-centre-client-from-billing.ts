/**
 * One-off follow-up to backfill-cost-centre-client-process-link.ts.
 *
 * 20 active cost centres were left with no client, or a process owned by another client. db_bill.cost_master
 * (the billing system, the source of truth for client per cost centre) names the real client for each; the
 * pairs below were read from it on 2026-10-01 and reviewed by the owner.
 *
 *   Dry run (default, rolls back):  npx tsx scripts/fix-cost-centre-client-from-billing.ts
 *   Apply:                          npx tsx scripts/fix-cost-centre-client-from-billing.ts --apply
 *
 * Owner ruling 2026-10-01: internal cost centres belong to "MAS Internal (Shared Services)"; the duplicate client
 * "MAS CALLNET INDIA PVT LTD" is merged into it (its processes and cost centres re-pointed, then deactivated if no
 * other table still references it). Every targeted cost centre ends up with a process owned by ITS client:
 * a process owned by a different client is never re-pointed, a new one is created for this client instead.
 * --apply snapshots the three tables into bkp_20261001_* first; one short transaction per unit, retried on deadlock.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const BKP = "bkp_20261001";
const INTERNAL_CLIENT_NAME = "MAS Internal (Shared Services)";
const DUPLICATE_INTERNAL_NORM = "mas callnet india";

/** cost centre code -> client per db_bill.cost_master ("INTERNAL" = the MAS internal client). */
const TARGETS: Array<{ code: string; client: string }> = [
  { code: "BSS/OB/NOIDA-2/983", client: "Captureatrip India Pvt. Ltd." },
  { code: "BSS/IB/NOIDA-DD/1007", client: "Dynamic Memory Pvt Ltd." },
  { code: "BSS/IB/NOIDA-DD/1011", client: "Pristino Premium Dry Cleaning" },
  { code: "BSS/BLD/NOI/ISPARK/565", client: "GKK DOODLE" },
  { code: "BSS/FLD/JPR/341", client: "Hero FinCorp Ltd" },
  { code: "BSS/OB/NOIDAISPARK-2/554", client: "Kreditin Private Limited" },
  { code: "BSS/OB/AHMH-JD/484", client: "Pikquick Services Private Limited" },
  { code: "BSS/BLD/CORP/319", client: "INTERNAL" },
  { code: "BSS/BO/CORP/318", client: "INTERNAL" },
  { code: "BSS/BO/AHMH-JD/560", client: "INTERNAL" },
  { code: "BSS/BO/NOIDA-2/577", client: "INTERNAL" },
  { code: "BSS/BLD/CORP/796", client: "INTERNAL" },
  { code: "IT/SYSTEM", client: "Netcom softech pvt ltd." },
  { code: "BSS/OB/JPR/495", client: "Vodafone Idea Limited" },
  { code: "BSS/OB/AHMH-JD/465", client: "Godfrey Philips India Ltd" },
  { code: "BSS/OB/AHMH-JD/474", client: "Godfrey Philips India Ltd" },
  { code: "BSS/OB/Noida/923", client: "Appreciate Broking IFSC Private Limited" },
  { code: "BSS/BO/Noida/795", client: "Viega India Innovative Technologies Private Limited" },
  { code: "BSS/OB/Noida/968", client: "VST INDUSTRIES LIMITED" },
  { code: "BSS/BLD/AHMH-JD/1041", client: "SAMARTH E-MOBILITY PRIVATE LIMITED" },
];

function clean(s: string | null | undefined): string {
  return String(s ?? "").replace(/[Â ]+/g, " ").replace(/\s+/g, " ").trim();
}
function norm(s: string): string {
  const n = clean(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|the|opc|p)\b/g, " ");
  const k = n.split(/\s+/).filter(Boolean).join(" ");
  return k === "hero fincorp" ? "hero fin corp" : k; // existing spelling of the same client
}
const slug = (s: string) => clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "CLIENT";
const derivedProcessCode = (cc: string) => cc.replace(/[^A-Za-z0-9]/g, "_").toUpperCase().replace(/_+/g, "_").slice(0, 50);

async function main() {
  const conn = await db.getConnection();
  const log: string[] = [];
  try {
    if (APPLY) {
      for (const t of ["client_master", "cost_centre_master", "process_master"]) {
        await conn.query(`CREATE TABLE IF NOT EXISTS ${BKP}_${t} AS SELECT * FROM ${t}`);
      }
      console.log(`backups: ${BKP}_client_master, ${BKP}_cost_centre_master, ${BKP}_process_master`);
    }
    await conn.query(`SET SESSION innodb_lock_wait_timeout = 30`);
    if (!APPLY) await conn.beginTransaction();
    async function unit<T>(fn: () => Promise<T>): Promise<T> {
      if (!APPLY) return fn();
      for (let attempt = 1; ; attempt++) {
        await conn.beginTransaction();
        try { const r = await fn(); await conn.commit(); return r; }
        catch (e: any) {
          await conn.rollback();
          if ((e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT") && attempt < 5) {
            await new Promise((r) => setTimeout(r, 1500 * attempt)); continue;
          }
          throw e;
        }
      }
    }

    const [cms] = await conn.query<RowDataPacket[]>(`SELECT id, client_code, client_name, legal_entity_name FROM client_master`);
    const byNorm = new Map<string, RowDataPacket>();
    const codes = new Set<string>(cms.map((r) => String(r.client_code)));
    for (const r of cms) if (!byNorm.has(norm(r.client_name))) byNorm.set(norm(r.client_name), r);
    const internal = cms.find((r) => r.client_name === INTERNAL_CLIENT_NAME);
    if (!internal) throw new Error(`internal client "${INTERNAL_CLIENT_NAME}" not found - run the first backfill first`);
    const dup = cms.find((r) => norm(r.client_name) === DUPLICATE_INTERNAL_NORM && r.id !== internal.id);

    // 1. merge the duplicate internal client into the internal one
    if (dup) {
      await unit(async () => {
        // Update by primary key: a client_id predicate has no index and would lock the whole table on a live DB.
        const [pr] = await conn.query<RowDataPacket[]>(`SELECT id FROM process_master WHERE client_id = ?`, [dup.id]);
        const [cr] = await conn.query<RowDataPacket[]>(`SELECT id FROM cost_centre_master WHERE client_id = ?`, [dup.id]);
        for (const r of pr) await conn.query(`UPDATE process_master SET client_id = ?, client_name = ? WHERE id = ?`, [internal.id, INTERNAL_CLIENT_NAME, r.id]);
        for (const r of cr) await conn.query(`UPDATE cost_centre_master SET client_id = ?, client_name = ? WHERE id = ?`, [internal.id, INTERNAL_CLIENT_NAME, r.id]);
        log.push(`merge "${dup.client_name}" -> "${INTERNAL_CLIENT_NAME}": ${pr.length} process(es), ${cr.length} cost centre(s) re-pointed`);
        const [refs] = await conn.query<RowDataPacket[]>(
          `SELECT table_name t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'client_id'
             AND table_name NOT IN ('client_master','process_master','cost_centre_master') AND table_name NOT LIKE 'bkp\\_%'`);
        const stillUsed: string[] = [];
        for (const r of refs) {
          const [[n]] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM \`${r.t}\` WHERE client_id = ?`, [dup.id]);
          if (Number(n.n) > 0) stillUsed.push(`${r.t}(${n.n})`);
        }
        if (stillUsed.length) log.push(`  duplicate client left ACTIVE, still referenced by: ${stillUsed.join(", ")}`);
        else { await conn.query(`UPDATE client_master SET active_status = 0 WHERE id = ?`, [dup.id]); log.push(`  duplicate client deactivated (no other references)`); }
      });
    }

    // 2. each targeted cost centre: right client, and a process owned by that client
    for (const t of TARGETS) {
      const [[cc]] = await conn.query<RowDataPacket[]>(
        `SELECT id, cost_centre_code, client_id, client_name, billing_client_name, process_id, process_name_bill, cc_category, branch_id
           FROM cost_centre_master WHERE cost_centre_code = ? AND status = 'active' AND active_status = 1 LIMIT 1`, [t.code]);
      if (!cc) { log.push(`${t.code}: NOT FOUND (skipped)`); continue; }

      let clientId: string, clientName: string, clientNote: string;
      if (t.client === "INTERNAL") { clientId = internal.id; clientName = INTERNAL_CLIENT_NAME; clientNote = "internal"; }
      else {
        const hit = byNorm.get(norm(t.client));
        if (hit) { clientId = hit.id; clientName = hit.client_name; clientNote = hit.client_name === t.client ? "existing" : `existing as "${hit.client_name}"`; }
        else {
          const id = randomUUID();
          let code = slug(t.client);
          for (let i = 2; codes.has(code); i++) code = `${slug(t.client).slice(0, 45)}_${i}`;
          codes.add(code);
          await unit(() => conn.query(
            `INSERT INTO client_master (id, client_code, client_name, legal_entity_name, active_status) VALUES (?,?,?,?,1)`, [id, code, t.client, t.client]));
          const row = { id, client_name: t.client } as RowDataPacket;
          byNorm.set(norm(t.client), row);
          clientId = id; clientName = t.client; clientNote = "CREATED";
        }
      }

      const note = await unit(async () => {
        await conn.query(
          `UPDATE cost_centre_master SET client_id = ?, client_name = ?, billing_client_name = COALESCE(NULLIF(billing_client_name, ''), ?), updated_at = NOW() WHERE id = ?`,
          [clientId, clientName, clientName, cc.id]);
        let cur: RowDataPacket | undefined;
        if (cc.process_id) [[cur]] = await conn.query<RowDataPacket[]>(`SELECT id, process_code, process_name, client_id, workload_type, process_type FROM process_master WHERE id = ?`, [cc.process_id]);
        if (cur && cur.client_id === clientId) return "process already owned by this client";
        if (cur && !cur.client_id) {
          await conn.query(`UPDATE process_master SET client_id = ?, client_name = ? WHERE id = ? AND client_id IS NULL`, [clientId, clientName, cur.id]);
          return `process ${cur.process_code} had no client: now owned by this client`;
        }
        const base = derivedProcessCode(cc.cost_centre_code);
        let code = base;
        for (let i = 2; ; i++) {
          const [[ex]] = await conn.query<RowDataPacket[]>(`SELECT id, client_id FROM process_master WHERE process_code = ?`, [code]);
          if (!ex) break;
          if (!ex.client_id) {
            await conn.query(`UPDATE process_master SET client_id = ?, client_name = ? WHERE id = ? AND client_id IS NULL`, [clientId, clientName, ex.id]);
            await conn.query(`UPDATE cost_centre_master SET process_id = ? WHERE id = ?`, [ex.id, cc.id]);
            return `claimed existing unowned process ${code}`;
          }
          if (ex.client_id === clientId) { await conn.query(`UPDATE cost_centre_master SET process_id = ? WHERE id = ?`, [ex.id, cc.id]); return `re-used process ${code}`; }
          code = `${base.slice(0, 45)}_${i}`;
        }
        const w = cur?.workload_type ?? (String(cc.cc_category ?? "").toLowerCase() === "backoffice" ? "backoffice" : "outbound_voice");
        const ty = cur?.process_type ?? (w === "backoffice" ? "BACK_OFFICE" : "OUTBOUND");
        const pid = randomUUID();
        await conn.query(
          `INSERT INTO process_master (id, process_code, process_name, branch_id, workload_type, process_type, client_id, client_name, active_status) VALUES (?,?,?,?,?,?,?,?,1)`,
          [pid, code, clean(cc.process_name_bill) || cur?.process_name || clientName, cc.branch_id, w, ty, clientId, clientName]);
        await conn.query(`UPDATE cost_centre_master SET process_id = ? WHERE id = ?`, [pid, cc.id]);
        return cur ? `process ${cur.process_code} belongs to another client: NEW process ${code} created for this client` : `no process: NEW process ${code} created`;
      });
      log.push(`${t.code}: client ${clientNote} "${clientName}"; ${note}`);
    }

    console.log(log.join("\n"));
    if (APPLY) console.log("\nCOMMITTED (per unit)");
    else { await conn.rollback(); console.log("\nROLLED BACK (dry run)"); }
  } catch (e) {
    if (!APPLY) await conn.rollback().catch(() => {});
    console.log(log.join("\n"));
    throw e;
  } finally {
    conn.release();
    await db.end?.();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
