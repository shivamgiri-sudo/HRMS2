/**
 * Re-pull APR from the dialler for past dates the hourly sync missed (21-29 Sep 2026: the sync carried
 * ~14-37 agents a day instead of ~195). Prints COUNTS ONLY.
 *
 *   npx tsx scripts/apr-resync-dates.ts 2026-09-21 2026-09-29            # dry run: nothing written
 *   npx tsx scripts/apr-resync-dates.ts 2026-09-21 2026-09-29 --apply    # upsert via the sync's own write
 *
 * Users who already have a MANUAL (bulk upload) row on a date are left out for that date: the engine sums
 * every apr row of a user/date, so adding a synced row beside an uploaded one would count the day twice.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { collectAprRowsForDate, writeAprRowsForDate, aggNetSeconds, stopAprVicidialSyncWorker, type AggRow } from "../src/workers/apr-vicidial-sync.worker.js";

const [from, to] = [process.argv[2], process.argv[3]];
const APPLY = process.argv.includes("--apply");
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
  console.error("usage: apr-resync-dates.ts YYYY-MM-DD YYYY-MM-DD [--apply]");
  process.exit(2);
}
const addDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

(async () => {
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run (nothing written)"}  dates ${from}..${to}`);
  const tot = { newKeys: 0, changed: 0, same: 0, skippedManualUsers: 0, addedHours: 0, written: 0 };
  for (let d = from; d <= to; d = addDay(d)) {
    const rows = await collectAprRowsForDate(d);
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT UPPER(UserID) u, campaign_id c, source s, TIME_TO_SEC(Net_Login) secs FROM apr WHERE ReportDate = ?`, [d]);
    const byKey = new Map((existing as any[]).map((r) => [`${r.u}|${r.c}`, r]));
    const manualUsers = new Set((existing as any[]).filter((r) => r.s === "manual").map((r) => String(r.u)));
    const keep = new Map<string, AggRow>();
    let newKeys = 0, changed = 0, same = 0, addedSecs = 0;
    const skippedUsers = new Set<string>();
    for (const [key, agg] of rows) {
      const [, user, campaign] = key.split("|");
      const u = user.toUpperCase();
      const cur = byKey.get(`${u}|${campaign}`);
      const secs = aggNetSeconds(agg);
      if (cur && Number(cur.secs) === secs) { same++; continue; }
      if (manualUsers.has(u) && (!cur || cur.s === "manual")) { skippedUsers.add(u); continue; }
      if (!cur) { newKeys++; addedSecs += secs; } else { changed++; addedSecs += secs - Number(cur.secs); }
      keep.set(key, agg);
    }
    const dialUsers = new Set([...rows.keys()].map((k) => k.split("|")[1].toUpperCase())).size;
    console.log(`  ${d}  dialler agents=${dialUsers}  stored apr users=${new Set((existing as any[]).map((r) => r.u)).size}`
      + `  new rows=${newKeys} changed=${changed} unchanged=${same}  left out (already bulk-uploaded)=${skippedUsers.size}`
      + `  net hours added=${Math.round(addedSecs / 360) / 10}`);
    tot.newKeys += newKeys; tot.changed += changed; tot.same += same; tot.skippedManualUsers += skippedUsers.size; tot.addedHours += addedSecs / 3600;
    if (APPLY && keep.size) tot.written += (await writeAprRowsForDate(d, keep)).upserted;
  }
  console.log(`TOTAL new rows=${tot.newKeys} changed=${tot.changed} unchanged=${tot.same} left-out user-days=${tot.skippedManualUsers} net hours added=${Math.round(tot.addedHours)}${APPLY ? ` written=${tot.written}` : ""}`);
  stopAprVicidialSyncWorker();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
