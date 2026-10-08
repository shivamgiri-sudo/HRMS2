/**
 * Inbound email poller: every 5 minutes, under the MySQL advisory lock inbound_email_tick (one process at a time), reads new replies
 * to invitation emails into the response review queue. Not started at all unless INBOUND_EMAIL_MODE (and the IMAP settings) are set.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../db/mysql.js";
import { logger } from "../logger.js";
import { inboundEmailConfig, pollInboundEmail, type PollResult } from "../modules/hiring-engine/inbound-email.service.js";
import { connectImap } from "../modules/hiring-engine/inbound-email.imap.js";

export const INBOUND_LOCK = "inbound_email_tick";
const INTERVAL_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | undefined;
let running = false;

export async function runInboundEmailTick(now = new Date()): Promise<PollResult | "locked" | "running" | "off"> {
  if (inboundEmailConfig().mode === "off") return "off";
  if (running) return "running";
  running = true;
  let conn: PoolConnection | undefined;
  let locked = false;
  try {
    conn = (await db.getConnection()) as unknown as PoolConnection;
    const [l] = await conn.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS got", [INBOUND_LOCK]);
    locked = Number(l[0]?.got) === 1;
    if (!locked) return "locked";
    const r = await pollInboundEmail(now, { connect: connectImap });
    if (r.read) logger.info({ read: r.read, matched: r.matched, recorded: r.recorded, skipped: r.skipped }, "[inbound-email] tick");
    return r;
  } finally {
    if (conn && locked) await conn.execute("SELECT RELEASE_LOCK(?)", [INBOUND_LOCK]).catch(() => undefined);
    conn?.release();
    running = false;
  }
}

export function startInboundEmailWorker(): void {
  if (timer) return;
  if (inboundEmailConfig().mode === "off") return;
  timer = setInterval(() => {
    runInboundEmailTick().catch((err) => logger.error({ err: (err as Error).message }, "[inbound-email] tick failed"));
  }, INTERVAL_MS);
  timer.unref();
}

export function stopInboundEmailWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
