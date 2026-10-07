/**
 * Meta lead WhatsApp messages stuck in 'queued' (Wassenger accepted them but no device ever sent them)
 * — list them, and with --apply re-send through Pinbot.
 *
 *   npx tsx scripts/meta-queued-resend.ts                 # dry run: counts + per-message table, sends nothing
 *   npx tsx scripts/meta-queued-resend.ts --apply         # send via Pinbot
 *   npx tsx scripts/meta-queued-resend.ts --apply --limit 5
 *   npx tsx scripts/meta-queued-resend.ts --days 14
 *
 * Pinbot free text only delivers inside the 24h window after the candidate last wrote to us; outside
 * it Meta refuses (131047) and nothing is sent, so a refused message is reported and left as it was.
 * Wassenger is never used as a fallback here (it would just queue again).
 *
 * On a successful Pinbot send the original row is marked 'failed' (it never reached the candidate) and
 * a new outbound row carries the Pinbot send. Identical text to the same lead is sent once; a message
 * already superseded by a later delivered one is skipped.
 *
 * Phone numbers are never printed (last 4 digits only).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { PinbotWhatsAppProvider } from "../src/modules/communication/providers/whatsapp/pinbot.provider.js";
import { saveMessage, updateDeliveryStatus } from "../src/modules/meta-campaign/meta-messages.service.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const numArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const limit = numArg("--limit", Number.POSITIVE_INFINITY);
const days = numArg("--days", 7);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const last4 = (p: string | null) => (p ? `***${String(p).replace(/\D/g, "").slice(-4)}` : "none");

interface Row extends RowDataPacket {
  id: string;
  lead_id: string;
  message_text: string;
  sender_type: "system" | "hr" | "candidate";
  sender_name: string | null;
  wassenger_message_id: string;
  created_at: Date;
  parsed_phone: string | null;
  screening_result: string;
  inbound_24h: number;
  superseded: number;
}

(async () => {
  const pinbot = new PinbotWhatsAppProvider();
  console.log(`mode=${apply ? "APPLY" : "dry-run"} pinbotConfigured=${pinbot.isConfigured()} days=${days}`);
  if (apply && !pinbot.isConfigured()) {
    console.log("Pinbot is not configured; refusing to apply.");
    process.exit(1);
  }

  const [rows] = await db.execute<Row[]>(
    `SELECT m.id, m.lead_id, m.message_text, m.sender_type, m.sender_name, m.wassenger_message_id, m.created_at,
            l.parsed_phone, l.screening_result,
            (SELECT COUNT(*) FROM meta_lead_messages i
               WHERE i.lead_id = m.lead_id AND i.direction = 'inbound' AND i.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)) AS inbound_24h,
            (SELECT COUNT(*) FROM meta_lead_messages o
               WHERE o.lead_id = m.lead_id AND o.direction = 'outbound' AND o.created_at > m.created_at
                 AND o.delivery_status IN ('sent', 'delivered', 'read')) AS superseded
       FROM meta_lead_messages m
       JOIN meta_lead_raw l ON l.id = m.lead_id
      WHERE m.direction = 'outbound' AND m.delivery_status = 'queued'
        AND m.wassenger_message_id IS NOT NULL AND m.wassenger_message_id <> 'sent'
        AND m.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY m.created_at ASC`,
    [days]
  );

  const byAge: Record<string, number> = {};
  for (const r of rows) {
    const d = r.created_at.toISOString().slice(0, 10);
    byAge[d] = (byAge[d] ?? 0) + 1;
  }
  const summary = {
    queued: rows.length,
    distinctLeads: new Set(rows.map((r) => r.lead_id)).size,
    noPhone: rows.filter((r) => !r.parsed_phone).length,
    windowOpen: rows.filter((r) => r.inbound_24h > 0).length,
    superseded: rows.filter((r) => r.superseded > 0).length,
    bySenderType: rows.reduce<Record<string, number>>((a, r) => ((a[r.sender_type] = (a[r.sender_type] ?? 0) + 1), a), {}),
    byScreening: rows.reduce<Record<string, number>>((a, r) => ((a[r.screening_result] = (a[r.screening_result] ?? 0) + 1), a), {}),
    byDay: byAge,
  };
  console.log("SUMMARY", JSON.stringify(summary));
  for (const r of rows.slice(0, 80)) {
    console.log(
      `MSG ${r.id.slice(0, 8)} lead=${r.lead_id.slice(0, 8)} ${r.created_at.toISOString().slice(0, 16)} ${r.sender_type} ` +
        `${r.screening_result} phone=${last4(r.parsed_phone)} window=${r.inbound_24h > 0} superseded=${r.superseded > 0} ` +
        `text="${r.message_text.replace(/\s+/g, " ").slice(0, 70)}"`
    );
  }

  if (!apply) {
    console.log("Dry run: nothing sent.");
    process.exit(0);
  }

  let sent = 0;
  let refused = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (sent + refused >= limit) break;
    const key = `${r.lead_id}|${r.message_text}`;
    if (!r.parsed_phone || r.superseded > 0 || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const res = await pinbot.send(r.parsed_phone, "", r.message_text);
    if (res.success) {
      sent++;
      await saveMessage({
        leadId: r.lead_id,
        direction: "outbound",
        messageText: r.message_text,
        senderType: r.sender_type === "candidate" ? "system" : r.sender_type,
        senderName: r.sender_name,
      });
      await updateDeliveryStatus(r.wassenger_message_id, "failed");
      console.log(`SENT ${r.id.slice(0, 8)} -> ${last4(r.parsed_phone)}`);
    } else {
      refused++;
      console.log(`REFUSED ${r.id.slice(0, 8)} -> ${last4(r.parsed_phone)}: ${String(res.error ?? "").slice(0, 160)}`);
    }
    await sleep(400);
  }
  console.log(`DONE sent=${sent} refused=${refused} skipped=${skipped}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
