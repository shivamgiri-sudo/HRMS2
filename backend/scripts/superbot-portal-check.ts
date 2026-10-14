/**
 * Superbot portal check. READ-ONLY. Logs in with the server's SUPERBOT_* env and prints what the portal itself holds:
 * its upload history (what HRMS pushed, accepted vs rejected) and the campaign call list counted by day and status.
 * Counts only: no names, numbers or credentials are printed.
 *
 *   npx tsx scripts/superbot-portal-check.ts
 */
import "dotenv/config";
import { botConfig, uploadLogs, listCalls } from "../src/modules/hiring-engine/superbot-portal.client.js";

(async () => {
  const c = botConfig();
  if (!c) { console.log("SUPERBOT_* env incomplete: portal not configured"); return; }
  console.log(`account=${c.accountId} campaign=${c.campaignId} base=${c.base} uploadMode=${c.uploadMode}`);
  console.log("NOW(IST)", new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 19).replace("T", " "));
  const logs = await uploadLogs(c).catch((e) => { console.log("upload-logs failed:", String((e as Error).message).slice(0, 160)); return []; });
  console.log(`== portal upload history (${logs.length}, newest first as returned)`);
  for (const l of logs.slice(0, 30)) console.log(JSON.stringify(l));
  const r = await listCalls(c, 20).catch((e) => { console.log("call list failed:", String((e as Error).message).slice(0, 160)); return { ok: false, calls: [] }; });
  console.log(`== portal call list ok=${r.ok} rows=${r.calls.length}`);
  const byDay = new Map<string, Map<string, number>>();
  for (const x of r.calls) {
    const day = (x.processedAtIst ?? "not-yet-processed").slice(0, 10);
    const m = byDay.get(day) ?? new Map<string, number>();
    const k = `${x.status || "-"}/${x.disposition || "-"}`;
    m.set(k, (m.get(k) ?? 0) + 1);
    byDay.set(day, m);
  }
  for (const [day, m] of [...byDay].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8)) console.log(day, JSON.stringify(Object.fromEntries(m)));
})().catch((e) => { console.error("ERR", String(e?.message ?? e).slice(0, 200)); process.exit(1); });
