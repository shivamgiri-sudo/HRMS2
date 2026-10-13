/**
 * Read-only: why the Molecular / Reginald email dashboards stopped getting data.
 * - Worker logs: first/last successful sync, first/last connection failure, failures per day.
 * - A plain TCP connect from this server to the ticketing DB host (no login, no query).
 * - What HRMS holds: newest email_ticket_daily_actual row per dashboard, molecular_email_ticket count.
 *
 * - Blabli Blu abandon (Received Data) uploads: rows per file in the dashboard uploader and the Bulk Upload Hub,
 *   to find where a ~2,000-row ceiling comes from.
 *
 *   npx tsx scripts/molecular-feed-diagnose.ts
 */
import "dotenv/config";
import fs from "fs";
import net from "net";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { env } from "../src/config/env.js";

const LOGS = ["/home/masadmin/.pm2/logs/hrms2-workers-out.log", "/home/masadmin/.pm2/logs/hrms2-workers-error.log"];
const PATTERNS: Record<string, string> = {
  ok_molecular: "MOLECULAR: ",
  ok_reginald: "REGINALD_MEN: ",
  connected: "[MOLECULAR_EMAIL] Connected to",
  failed: "[MOLECULAR_EMAIL] Connection failed",
  ticket_ok: "Molecular tickets (",
};

function scanLogs() {
  for (const f of LOGS) {
    let text: string;
    try {
      // Last 300 MB at most (a JS string tops out near 512 MB).
      const st = fs.statSync(f);
      const start = Math.max(0, st.size - 300 * 1024 * 1024);
      const fd = fs.openSync(f, "r");
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      text = buf.toString("utf8");
    } catch (e) { console.log(`${f}: ${(e as Error).message}`); continue; }
    const lines = text.split("\n");
    console.log(`=== ${f}: ${lines.length} lines, first ${lines[0]?.slice(0, 20)}`);
    for (const [key, p] of Object.entries(PATTERNS)) {
      const hits = lines.filter((l) => l.includes(p) && (p.startsWith("[MOLECULAR") || l.includes("molecular")));
      if (!hits.length) { console.log(`  ${key}: 0`); continue; }
      const perDay = new Map<string, number>();
      for (const h of hits) { const d = h.slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
      console.log(`  ${key}: ${hits.length}  first: ${hits[0].slice(0, 160)}`);
      console.log(`  ${key}  last: ${hits[hits.length - 1].slice(0, 160)}`);
      console.log(`  ${key} per day: ${[...perDay.entries()].slice(-10).map(([d, n]) => `${d}=${n}`).join(" ")}`);
    }
  }
}

function tcp(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const s = net.connect({ host, port, timeout: 10000 });
    s.on("connect", () => { resolve(`OPEN in ${Date.now() - t0}ms`); s.destroy(); });
    s.on("timeout", () => { resolve(`TIMEOUT after ${Date.now() - t0}ms`); s.destroy(); });
    s.on("error", (e) => resolve(`ERROR ${e.message} after ${Date.now() - t0}ms`));
  });
}

async function main() {
  scanLogs();
  const host = env.MOLECULAR_EMAIL_DB_HOST, port = env.MOLECULAR_EMAIL_DB_PORT || 3306;
  console.log(`=== TCP ${host}:${port}: ${await tcp(String(host), Number(port))}`);
  const [d] = await db.query<RowDataPacket[]>(
    `SELECT dashboard_label, DATE_FORMAT(MAX(report_date),'%Y-%m-%d') AS latest_day, DATE_FORMAT(MAX(updated_at),'%Y-%m-%d %H:%i') AS last_write, COUNT(*) AS rows_
       FROM email_ticket_daily_actual GROUP BY dashboard_label`);
  console.log("=== email_ticket_daily_actual", JSON.stringify(d));
  const [t] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS n, MAX(synced_at) AS last FROM molecular_email_ticket`);
  console.log("=== molecular_email_ticket", JSON.stringify(t));
  const [bb] = await db.query<RowDataPacket[]>(
    `SELECT batch_id, state, live_rows, date_from, date_to, DATE_FORMAT(uploaded_at,'%Y-%m-%d %H:%i') AS at
       FROM bbb_upload_batch WHERE kind = 'received' ORDER BY uploaded_at DESC LIMIT 25`);
  console.log("=== bbb_upload_batch (dashboard uploader, newest 25)");
  for (const r of bb) console.log("  ", JSON.stringify(r));
  const [hub] = await db.query<RowDataPacket[]>(
    `SELECT b.upload_batch_no, b.batch_status, b.total_rows, b.valid_rows, b.imported_rows, b.error_rows,
            (SELECT COUNT(*) FROM upload_batch_row r WHERE r.upload_batch_id = b.id) AS staged_rows,
            LEFT(b.error_summary, 160) AS err, DATE_FORMAT(b.created_at,'%Y-%m-%d %H:%i') AS at
       FROM upload_batch b
      WHERE b.upload_type_code = 'BLA_BLI_BLU_ABANDON' ORDER BY b.created_at DESC LIMIT 25`).catch((e) => [[{ error: (e as Error).message }]] as never);
  console.log("=== Bulk Upload Hub BLA_BLI_BLU_ABANDON batches (newest 25)");
  for (const r of hub as RowDataPacket[]) console.log("  ", JSON.stringify(r));
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
