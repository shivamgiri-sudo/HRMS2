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
    console.log("-- crosstab for", String(b.slot_key));
    const tab = new Map<string, number>();
    for (const r of rows) {
      const ref = norm((r.match_id ? await existingRef(String(r.match_id)) : null) ?? followupRef(String(r.id)));
      const [x] = await db.execute<RowDataPacket[]>(
        `SELECT q.source_type, q.call_attempts,
                (SELECT COUNT(*) FROM he_call c JOIN he_lead l ON l.id = c.lead_id WHERE l.mobile10 = q.mobile10) earlier_bot_calls,
                (SELECT MAX(m.slot_at) FROM he_match m WHERE m.id = q.match_id) slot_at
           FROM qualified_followup q WHERE q.id = ? LIMIT 1`, [r.id]);
      const v = x[0] ?? {};
      const key = JSON.stringify({ inPortal: have.has(ref), src: v.source_type, attempts: Number(v.call_attempts ?? 0), botCalledBefore: Number(v.earlier_bot_calls ?? 0) > 0, futureSlot: v.slot_at ? new Date(String(v.slot_at).replace(" ", "T") + "+05:30") > new Date(b.created_at + "+05:30") : false });
      tab.set(key, (tab.get(key) ?? 0) + 1);
    }
    for (const [k, n] of [...tab].sort((a, c) => c[1] - a[1]).slice(0, 12)) console.log(n, k);
    console.log(JSON.stringify({ slot: b.slot_key, created: b.created_at, stamped: rows.length, inPortalList: present, notInPortalList: absent, uploadedBeforeAnyBatch: earlier, absentAndUploadedBefore: absentEarlier }));
  }
  await db.end?.();
})();
