/**
 * Why does the WhatsApp Inbox "Hiring Engine candidates" tab keep loading? STRICTLY READ-ONLY: row counts and
 * timings of the exact listInbox query (admin scope), plus the candidate-side index list. Prints no personal data.
 *
 *   npx tsx scripts/he-inbox-timing.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { listInbox, getInboxThread } from "../src/modules/hiring-engine/he-inbox.service.js";

const q = async (sql: string) => (await db.execute<RowDataPacket[]>(sql))[0];
const ms = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  const t0 = Date.now();
  try {
    const r = await fn();
    console.log(`TIME ${label}: ${Date.now() - t0} ms`);
    return r;
  } catch (e) {
    console.log(`TIME ${label}: FAILED after ${Date.now() - t0} ms: ${(e as Error).message.slice(0, 200)}`);
    return null;
  }
};

(async () => {
  console.log("COUNTS", JSON.stringify({
    he_lead: (await q("SELECT COUNT(*) n FROM he_lead"))[0]!.n,
    he_message: (await q("SELECT COUNT(*) n FROM he_message"))[0]!.n,
    he_message_whatsapp_in: (await q("SELECT COUNT(*) n FROM he_message WHERE channel='whatsapp' AND direction='in'"))[0]!.n,
    he_lead_event: (await q("SELECT COUNT(*) n FROM he_lead_event"))[0]!.n,
    he_lead_with_messages: (await q("SELECT COUNT(DISTINCT lead_id) n FROM he_message"))[0]!.n,
  }));
  for (const t of ["he_message", "he_lead", "he_lead_event"]) {
    const idx = await q(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' GROUP BY INDEX_NAME`);
    console.log(`INDEXES ${t}`, JSON.stringify(idx));
  }
  const r = await ms("listInbox (all branches)", () => listInbox({ all: true } as never, undefined));
  if (r) {
    console.log("INBOX", JSON.stringify({ total: r.total, unread: r.unread }));
    const first = r.data[0];
    if (first) await ms("getInboxThread (first row, read-marking skipped by null actor)", () => getInboxThread(first.leadId, { all: true } as never, null));
  }
  await ms("listInbox search", () => listInbox({ all: true } as never, "a"));
  process.exit(0);
})().catch((e) => { console.error("FAILED", e); process.exit(1); });
