/** Staff arrival alerts: how many were sent per hour and on which channels (channels_json). STRICTLY READ-ONLY. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
(async () => {
  const [r] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(DATE_ADD(created_at, INTERVAL 330 MINUTE), '%m-%d %H:00') hr, COUNT(*) alerts, SUM(recipients) recipients,
            SUM(CAST(JSON_EXTRACT(channels_json,'$.whatsapp') AS UNSIGNED)) whatsapp, SUM(CAST(JSON_EXTRACT(channels_json,'$.email') AS UNSIGNED)) email
       FROM he_hr_alert WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 HOUR) GROUP BY hr ORDER BY hr DESC`);
  for (const x of r) console.log(JSON.stringify(x));
  await db.end?.();
})();
