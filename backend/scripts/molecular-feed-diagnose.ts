/**
 * Read-only: why the Molecular / Reginald email dashboards stopped getting data.
 * - Worker logs: first/last successful sync, first/last connection failure, failures per day.
 * - A plain TCP connect from this server to the ticketing DB host (no login, no query).
 * - What HRMS holds: newest email_ticket_daily_actual row per dashboard, molecular_email_ticket count.
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
  await db.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
