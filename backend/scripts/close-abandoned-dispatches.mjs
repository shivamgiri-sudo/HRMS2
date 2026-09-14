#!/usr/bin/env node
/**
 * Close dispatch_log rows abandoned in 'queued', but only where nothing was lost.
 *
 * dispatchService writes the row as 'queued', calls the provider, then updates it. A
 * process that dies in between leaves the row at 'queued' permanently — never sent,
 * never retried, never reported. 25 such rows exist, all is_critical = 1, the oldest
 * from 2026-08-04.
 *
 * Leaving them is not free: the nightly stale-queued warning will name them forever,
 * and a check that always fires is a check people stop reading. But blanket-resending
 * them is worse — the row predates the provider call, so 'queued' cannot distinguish
 * "never sent" from "sent, then the process died before recording it", and a duplicate
 * payroll notification is its own harm.
 *
 * So each row must PROVE it lost nothing before it is closed. Two proofs are accepted:
 *
 *   SUPERSEDED  a later row with the same recipient AND the same subject reached
 *               status 'sent'. The person received this message; these particular 25
 *               are e-sign reminders from the mail storm, superseded 43-186 times over.
 *
 *   UNDELIVERABLE  the channel has never delivered anything, ever. sms and whatsapp
 *               have 0 all-time sends in this database, so no send was possible and
 *               none was lost.
 *
 * Anything that proves neither is LEFT ALONE and printed. That is the case a human
 * needs to look at, and quietly closing it would destroy the only evidence it happened.
 *
 * Sets 'failed' rather than 'sent', because that is what is true: no send was ever
 * recorded. The reason is written into error_message so the row explains itself.
 *
 *   node scripts/close-abandoned-dispatches.mjs           # report
 *   node scripts/close-abandoned-dispatches.mjs --apply   # close
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const APPLY = process.argv.includes("--apply");
const STALE_HOURS = 6;

function env(key) {
  const raw = fs.readFileSync(path.join(BACKEND, ".env"), "utf8");
  const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

async function connect(hosts) {
  for (const host of hosts) {
    try {
      const c = await mysql.createConnection({
        host, port: 3306, database: "mas_hrms",
        user: env("DB_USER") ?? "shivam_user", password: env("DB_PASSWORD"),
        connectTimeout: 12_000,
      });
      console.log(`  mas_hrms: ${host}`);
      return c;
    } catch (e) {
      console.log(`  ${host} unavailable (${e.code ?? e.message})`);
    }
  }
  throw new Error("no route to mas_hrms");
}

console.log(APPLY ? "MODE: APPLY (will close rows)" : "MODE: dry run (no writes)");
const db = await connect([env("DB_HOST"), "192.168.10.6", "122.184.128.90"].filter(Boolean));

// Channels that have never delivered anything at all.
const [chan] = await db.query(
  `SELECT channel, SUM(status = 'sent') AS ever_sent FROM dispatch_log GROUP BY channel`,
);
const deadChannels = new Set(chan.filter((c) => Number(c.ever_sent) === 0).map((c) => c.channel));
console.log(`\nchannels with zero all-time sends: ${[...deadChannels].join(", ") || "(none)"}`);

const [stuck] = await db.query(
  `SELECT q.id, q.channel, q.subject, q.recipient_contact, q.created_at, q.is_critical,
          (SELECT COUNT(*) FROM dispatch_log s
            WHERE s.status = 'sent' AND s.recipient_contact = q.recipient_contact
              AND s.subject = q.subject AND s.created_at > q.created_at) AS later_sent
     FROM dispatch_log q
    WHERE q.status = 'queued' AND q.created_at < NOW() - INTERVAL ? HOUR
    ORDER BY q.created_at`,
  [STALE_HOURS],
);

const closable = [];
const keep = [];
for (const row of stuck) {
  const superseded = Number(row.later_sent) > 0;
  const undeliverable = deadChannels.has(row.channel);
  if (superseded) closable.push({ row, why: `superseded by ${row.later_sent} later successful send(s)` });
  else if (undeliverable) closable.push({ row, why: `channel '${row.channel}' has never delivered anything` });
  else keep.push(row);
}

console.log(`\nabandoned in 'queued' older than ${STALE_HOURS}h: ${stuck.length}`);
console.log(`  provably lost nothing -> closable : ${closable.length}`);
console.log(`  UNPROVEN -> left alone            : ${keep.length}`);

for (const { row, why } of closable) {
  console.log(`  close ${String(row.channel).padEnd(9)} ${String(row.subject).slice(0, 34).padEnd(36)} ${why}`);
}
for (const row of keep) {
  console.log(`  KEEP  ${String(row.channel).padEnd(9)} ${String(row.subject).slice(0, 34).padEnd(36)} to ${row.recipient_contact} — needs a human`);
}

if (!APPLY) {
  console.log(`\nDry run — nothing written. Re-run with --apply to close ${closable.length}.`);
  await db.end();
  process.exit(0);
}

let closed = 0;
for (const { row, why } of closable) {
  // Re-asserts status='queued' so a row that moved on between the read and this write
  // is never overwritten, and a second run is a no-op.
  const [res] = await db.execute(
    `UPDATE dispatch_log
        SET status = 'failed',
            error_message = ?
      WHERE id = ? AND status = 'queued'`,
    [`Abandoned in 'queued' — process died between insert and provider call. Closed without resending: ${why}.`.slice(0, 500), row.id],
  );
  if (res.affectedRows === 1) closed++;
}
console.log(`\nclosed: ${closed} of ${closable.length}`);
await db.end();
