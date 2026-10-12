/** Is the WhatsApp webhook delivering? Inbound rows and delivery statuses by day. STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
const run = async (label: string, sql: string) => { try { const [r] = await db.execute<RowDataPacket[]>(sql); console.log(`== ${label} (${r.length})`); r.slice(0, 40).forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log(`== ${label} FAILED ${(e as Error).message.slice(0, 200)}`); } };
(async () => {
  await run("he_message by day, channel, direction (5d)", `SELECT DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) d, channel, direction, COUNT(*) n, MAX(created_at) last_at FROM he_message WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 DAY) GROUP BY d, channel, direction ORDER BY d DESC, channel, direction`);
  await run("whatsapp out delivery_status (3d)", `SELECT delivery_status, COUNT(*) n, MAX(created_at) last_at FROM he_message WHERE channel = 'whatsapp' AND direction = 'out' AND created_at >= DATE_SUB(NOW(), INTERVAL 3 DAY) GROUP BY delivery_status`);
  await run("latest 5 inbound whatsapp ever", `SELECT created_at, LEFT(body, 60) body FROM he_message WHERE channel = 'whatsapp' AND direction = 'in' ORDER BY created_at DESC LIMIT 5`);
  await run("followup wa_status (live, today)", `SELECT wa_status, COUNT(*) n FROM qualified_followup WHERE wa_sent_at >= DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)) - INTERVAL 330 MINUTE GROUP BY wa_status`);
  await db.end?.();
})();
