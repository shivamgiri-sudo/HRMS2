/**
 * Links every ACTIVE cost centre to client_master (client_id) and process_master (process_id).
 *
 * Before this, 408 of 409 active cost centres carried the client only as free text
 * (cost_centre_master.client_name), with ~370 client names that did not exist in client_master and
 * the same client spelled several ways. client_master is now the single source of the client's
 * name and official (legal) name; cost_centre_master.client_name stays as a copy kept in step.
 *
 *   Dry run (default, rolls back):  npx tsx scripts/backfill-cost-centre-client-process-link.ts
 *   Apply:                          npx tsx scripts/backfill-cost-centre-client-process-link.ts --apply
 *
 * --apply first snapshots client_master, cost_centre_master and process_master into
 * bkp_20260930_* tables, then writes in one transaction. Never overwrites a client_id/process_id
 * that is already set, and never re-points a process that already belongs to another client.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const APPLY = process.argv.includes("--apply");
const BKP = "bkp_20260930";

/** Names that are not clients: shared / internal cost centres. They go under one internal client. */
const INTERNAL_CLIENT_CODE = "MAS_INTERNAL";
const INTERNAL_CLIENT_NAME = "MAS Internal (Shared Services)";
const INTERNAL_NAMES = new Set(["back office", "shared dc", "mas delhi", "process management services", "bo i spark"]);
const INTERNAL_CC_CODES = new Set(["BO/", "BSS-OTHERS", "FINANCE/ACCOUNTS", "MANAGEMENT-CORPORATE"]);

/** Reviewed merges: normalised spelling -> canonical normalised spelling. */
const ALIASES: Record<string, string> = {
  "godfrey phillips": "godfrey philips",
  "gpi": "godfrey philips",
  "hero fin corp": "herofincorp",
  "hero fincorp": "herofincorp",
  "ispark dataconnect up": "ispark dataconnect",
  "du digital technologies limite": "dudigital global",
  "du digital": "dudigital global",
  "snap deal": "snapdeal",
  "exicom tele systems": "exicom",
  "tipping mr pink burger singh": "tipping mr pink",
  "travelport holidays ob": "travelport",
  "finnable technologies": "finnable credit",
  "birlanu": "birla nu",
  "dam natural wellness idc": "idam natural wellness",
};

/** Values that name a process or centre rather than a client: left unresolved. */
const NOT_A_CLIENT = new Set(["loan process", "filed collection", "customer verification", "s and m", "cs others"]);

function clean(s: string | null | undefined): string {
  return String(s ?? "").replace(/[Â ]+/g, " ").replace(/\s+/g, " ").trim();
}
function norm(s: string): string {
  let n = clean(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ");
  n = n.replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|the|opc|p)\b/g, " ");
  n = n.split(/\s+/).filter(Boolean).join(" ");
  return ALIASES[n] ?? n;
}
function slug(s: string): string {
  return clean(s).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "CLIENT";
}
function derivedProcessCode(ccCode: string): string {
  return ccCode.replace(/[^A-Za-z0-9]/g, "_").toUpperCase().replace(/_+/g, "_").slice(0, 50);
}
function workload(cat: string | null): { w: string; t: string } {
  switch ((cat ?? "").toLowerCase()) {
    case "backoffice": return { w: "backoffice", t: "BACK_OFFICE" };
    default: return { w: "outbound_voice", t: "OUTBOUND" };
  }
}
function mode<T>(xs: T[]): T | undefined {
  const c = new Map<T, number>();
  xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

type CC = {
  id: string; cost_centre_code: string; client_name: string | null; billing_client_name: string | null;
  process_name_bill: string | null; cc_category: string | null; branch_id: string | null; client_id: string | null;
  process_id: string | null; pm_client_id: string | null; pm_process_name: string | null;
};

async function main() {
  const conn = await db.getConnection();
  try {
    if (APPLY) {
      for (const t of ["client_master", "cost_centre_master", "process_master"]) {
        await conn.query(`CREATE TABLE IF NOT EXISTS ${BKP}_${t} AS SELECT * FROM ${t}`);
      }
      console.log(`backups: ${BKP}_client_master, ${BKP}_cost_centre_master, ${BKP}_process_master`);
    }
    await conn.query(`SET SESSION innodb_lock_wait_timeout = 5`);
    // Dry run: one transaction, rolled back at the end. Apply: one short transaction per unit of
    // work, retried on deadlock/lock timeout (the DB is live; a single long transaction deadlocks).
    if (!APPLY) await conn.beginTransaction();
    async function unit<T>(fn: () => Promise<T>): Promise<T> {
      if (!APPLY) return fn();
      for (let attempt = 1; ; attempt++) {
        await conn.beginTransaction();
        try {
          const r = await fn();
          await conn.commit();
          return r;
        } catch (e: any) {
          await conn.rollback();
          if ((e?.code === "ER_LOCK_DEADLOCK" || e?.code === "ER_LOCK_WAIT_TIMEOUT") && attempt < 5) {
            await new Promise((r) => setTimeout(r, 1500 * attempt));
            continue;
          }
          throw e;
        }
      }
    }

    const [ccs] = await conn.query<RowDataPacket[]>(
      `SELECT c.id, c.cost_centre_code, c.client_name, c.billing_client_name, c.process_name_bill, c.cc_category,
              c.branch_id, c.client_id, c.process_id,
              pm.client_id AS pm_client_id, pm.process_name AS pm_process_name
         FROM cost_centre_master c LEFT JOIN process_master pm ON pm.id = c.process_id
        WHERE c.status = 'active' AND c.active_status = 1`);
    const rows = ccs as unknown as CC[];

    const [cms] = await conn.query<RowDataPacket[]>(`SELECT id, client_code, client_name, legal_entity_name FROM client_master`);
    const byNorm = new Map<string, { id: string; name: string; legal: string | null }>();
    const codes = new Set<string>();
    for (const r of cms) {
      byNorm.set(norm(r.client_name), { id: r.id, name: r.client_name, legal: r.legal_entity_name });
      codes.add(r.client_code);
    }

    // 1. resolve each cost centre to a canonical client key
    const resolved = new Map<string, string | null>();
    const groups = new Map<string, CC[]>();
    const unresolved: string[] = [];
    for (const cc of rows) {
      let key: string | null = null;
      const raw = clean(cc.client_name) || clean(cc.billing_client_name);
      if (INTERNAL_CC_CODES.has(cc.cost_centre_code) || (raw && INTERNAL_NAMES.has(norm(raw)))) key = "INTERNAL";
      else if (raw && !NOT_A_CLIENT.has(norm(raw))) key = norm(raw);
      else if (cc.pm_client_id) {
        const hit = [...byNorm.entries()].find(([, v]) => v.id === cc.pm_client_id);
        key = hit?.[0] ?? null;
      }
      if (!key) {
        const hint = norm(cc.pm_process_name ?? cc.process_name_bill ?? "");
        if (hint && byNorm.has(hint)) key = hint;
      }
      resolved.set(cc.id, key);
      if (!key) unresolved.push(`${cc.cost_centre_code} (client="${raw}", process="${cc.pm_process_name ?? cc.process_name_bill ?? ""}")`);
      else {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(cc);
      }
    }

    // 2. ensure a client_master row per key
    const clientIdByKey = new Map<string, string>();
    const clientNameById = new Map<string, string>(cms.map((r) => [String(r.id), String(r.client_name)]));
    let created = 0, legalFilled = 0;
    const merges: string[] = [];
    for (const [key, list] of groups) {
      const existing = key === "INTERNAL"
        ? [...byNorm.values()].find((v) => v.name === INTERNAL_CLIENT_NAME)
        : byNorm.get(key);
      const rawNames = [...new Set(list.map((c) => clean(c.client_name)).filter(Boolean))];
      if (rawNames.length > 1 && key !== "INTERNAL") merges.push(rawNames.join(" | "));
      const bill = mode(list.map((c) => clean(c.billing_client_name)).filter(Boolean));
      const display = key === "INTERNAL" ? INTERNAL_CLIENT_NAME : mode(rawNames) ?? clean(list[0].billing_client_name);
      if (existing) {
        clientIdByKey.set(key, existing.id);
        clientNameById.set(existing.id, existing.name);
        if (!existing.legal) {
          await unit(() => conn.query(`UPDATE client_master SET legal_entity_name = ? WHERE id = ? AND legal_entity_name IS NULL`, [bill || existing.name, existing.id]));
          legalFilled++;
        }
        continue;
      }
      const id = randomUUID();
      let code = key === "INTERNAL" ? INTERNAL_CLIENT_CODE : slug(display);
      for (let i = 2; codes.has(code); i++) code = `${slug(display).slice(0, 45)}_${i}`;
      codes.add(code);
      await unit(() => conn.query(
        `INSERT INTO client_master (id, client_code, client_name, legal_entity_name, industry, active_status) VALUES (?,?,?,?,?,1)`,
        [id, code, display, key === "INTERNAL" ? INTERNAL_CLIENT_NAME : bill || display, key === "INTERNAL" ? "Internal" : null],
      ));
      clientIdByKey.set(key, id);
      clientNameById.set(id, display);
      created++;
    }

    // 3. link cost centres -> client, then process
    const [pms] = await conn.query<RowDataPacket[]>(`SELECT id, process_code FROM process_master`);
    const pmByCode = new Map(pms.map((p) => [String(p.process_code), String(p.id)]));
    const codeTaken = new Set(pms.map((p) => String(p.process_code)));
    let ccClient = 0, ccProcess = 0, procCreated = 0, procClientFilled = 0;
    const procConflicts: string[] = [];
    for (const cc of rows) {
      const key = resolved.get(cc.id);
      if (!key) continue;
      const clientId = clientIdByKey.get(key)!;
      // In-memory name: a deadlock rolls back the whole dry-run transaction and would hide just-inserted clients.
      const clName = clientNameById.get(clientId);
      const cl = clName === undefined ? undefined : { client_name: clName };
      if (!cl) throw new Error(`client not found for cost centre ${cc.cost_centre_code}: key="${key}" clientId=${clientId}`);
      // Pre-decide the new process (code/id) outside the unit so a retry reuses the same values.
      const derived = derivedProcessCode(cc.cost_centre_code);
      const existingPid = cc.process_id ?? pmByCode.get(derived) ?? null;
      let newProc: { pid: string; code: string } | null = null;
      if (!existingPid) {
        let code = derived || `CC_${cc.id.slice(0, 8)}`;
        for (let i = 2; codeTaken.has(code); i++) code = `${derived.slice(0, 45)}_${i}`;
        newProc = { pid: randomUUID(), code };
      }
      const r = await unit(async () => {
        let d = { client: 0, proc: 0, created: 0, filled: 0, conflict: "" };
        if (!cc.client_id) {
          await conn.query(
            `UPDATE cost_centre_master SET client_id = ?, client_name = ?, updated_at = NOW() WHERE id = ? AND client_id IS NULL`,
            [clientId, cl.client_name, cc.id]);
          d.client = 1;
        }
        let processId = existingPid;
        if (newProc) {
          const { w, t } = workload(cc.cc_category);
          await conn.query(
            `INSERT INTO process_master (id, process_code, process_name, branch_id, workload_type, process_type, client_id, client_name, active_status)
             VALUES (?,?,?,?,?,?,?,?,1)`,
            [newProc.pid, newProc.code, clean(cc.process_name_bill) || cl.client_name, cc.branch_id, w, t, clientId, cl.client_name]);
          processId = newProc.pid;
          d.created = 1;
        }
        if (!cc.process_id) {
          await conn.query(`UPDATE cost_centre_master SET process_id = ? WHERE id = ? AND process_id IS NULL`, [processId, cc.id]);
          d.proc = 1;
        }
        const [res] = await conn.query<any>(
          `UPDATE process_master SET client_id = ?, client_name = COALESCE(client_name, ?) WHERE id = ? AND client_id IS NULL`,
          [clientId, cl.client_name, processId]);
        if (res.affectedRows) d.filled = 1;
        else {
          const [[cur]] = await conn.query<RowDataPacket[]>(`SELECT client_id FROM process_master WHERE id = ?`, [processId]);
          if (cur && cur.client_id !== clientId) d.conflict = `${cc.cost_centre_code}: process ${processId} already belongs to another client`;
        }
        return d;
      }).catch((e: any) => {
        if (e?.code !== "ER_LOCK_DEADLOCK" && e?.code !== "ER_LOCK_WAIT_TIMEOUT") throw e;
        procConflicts.push(`${cc.cost_centre_code}: skipped, rows locked by another transaction (re-run later)`);
        return null;
      });
      if (!r) continue;
      if (newProc) { pmByCode.set(newProc.code, newProc.pid); codeTaken.add(newProc.code); }
      ccClient += r.client; ccProcess += r.proc; procCreated += r.created; procClientFilled += r.filled;
      if (r.conflict) procConflicts.push(r.conflict);
    }

    console.log(JSON.stringify({
      mode: APPLY ? "APPLY" : "DRY-RUN", scope_active_cost_centres: rows.length,
      canonical_clients: groups.size, clients_created: created, legal_names_filled_on_existing: legalFilled,
      cost_centres_client_linked: ccClient, cost_centres_process_linked: ccProcess,
      processes_created: procCreated, processes_client_filled: procClientFilled,
      unresolved: unresolved.length, process_client_conflicts: procConflicts.length,
    }, null, 2));
    console.log("\nMERGED SPELLINGS (review):\n" + merges.map((m) => "  " + m).join("\n"));
    console.log("\nUNRESOLVED (left with no client):\n" + unresolved.map((u) => "  " + u).join("\n"));
    console.log("\nPROCESS CONFLICTS:\n" + procConflicts.map((u) => "  " + u).join("\n"));

    if (APPLY) console.log("\nCOMMITTED (per unit)");
    else { await conn.rollback(); console.log("\nROLLED BACK (dry run)"); }
  } catch (e) {
    if (!APPLY) await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await db.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
