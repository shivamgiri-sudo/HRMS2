/**
 * Which rows of the last sent calling-file batches did the portal actually take? Compares each batch's references with the campaign's
 * call list, and checks whether the rejected people were uploaded earlier. STRICTLY READ-ONLY.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { botConfig, listCalls } from "../src/modules/hiring-engine/superbot-portal.client.js";
import { existingRef } from "../src/modules/hiring-engine/he-call-ref.service.js";
import { followupRef } from "../src/modules/hiring-engine/qualified-followup.rules.js";
const norm = (s: string) => String(s ?? "").replace(/\s+/g, "").toUpperCase();
(async () => {
  const c = botConfig();
  if (!c) { console.log("portal not configured"); return; }
  const got = await listCalls(c, 30);
  const have = new Set(got.calls.map((x) => norm(x.reference)));
  console.log("portal list ok", got.ok, "calls", got.calls.length, "distinct refs", have.size);
  const [batches] = await db.execute<RowDataPacket[]>(
    `SELECT id, slot_key, row_count, created_at FROM qualified_followup_call_batch WHERE status = 'sent' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY) ORDER BY created_at`);
  for (const b of batches) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT id, match_id, mobile10, call_state FROM qualified_followup WHERE call_file_batch_id = ?", [b.id]);
    let present = 0, absent = 0, earlier = 0, absentEarlier = 0;
    for (const r of rows) {
      const ref = norm((r.match_id ? await existingRef(String(r.match_id)) : null) ?? followupRef(String(r.id)));
      const inPortal = have.has(ref);
      if (inPortal) present++; else absent++;
      const [e] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) n FROM qualified_followup q JOIN qualified_followup_call_batch ob ON ob.id = q.call_file_batch_id
          WHERE q.mobile10 = ? AND ob.created_at < ? AND ob.status = 'sent'`, [r.mobile10, b.created_at]);
      const wasBefore = Number(e[0].n) > 0;
      if (wasBefore) { earlier++; if (!inPortal) absentEarlier++; }
    }
    console.log(JSON.stringify({ slot: b.slot_key, created: b.created_at, stamped: rows.length, inPortalList: present, notInPortalList: absent, uploadedBeforeAnyBatch: earlier, absentAndUploadedBefore: absentEarlier }));
  }
  await db.end?.();
})();
