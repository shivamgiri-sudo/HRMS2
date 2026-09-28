/**
 * Bulk WhatsApp shortlist notification (with interview slot) for already-shortlisted leads.
 *
 * A shortlisted lead is only messaged automatically the moment it is screened — a bulk re-screen
 * (rescreen-meta-leads.ts) deliberately never sends outreach, so a large batch of newly-qualified
 * leads can sit shortlisted with nobody notified. This script is the explicit, human-triggered way
 * to catch that batch up. It sends real WhatsApp messages to real candidates — this is an outward,
 * hard-to-undo action, so it defaults to a dry run and never sends without --apply.
 *
 *   npx tsx scripts/bulk-notify-shortlisted.ts                        # DRY RUN — counts + a CSV of who would be
 *                                                                     # messaged. Sends nothing.
 *   npx tsx scripts/bulk-notify-shortlisted.ts --apply                # send, one lead at a time, throttled
 *
 * Options
 *   --requisition=REQ-CODE   only this requisition's batch (repeatable: --requisition=A --requisition=B)
 *   --limit N                stop after N sends (chunk a large run across several invocations)
 *   --throttle-ms N          pause between sends (default 2000 — ~30/min; WhatsApp numbers can be flagged
 *                            for spam by fast bulk sends, so this is deliberately conservative)
 *   --include-voice          also place the automated voice-bot call each lead would otherwise get
 *                            (Vapi / legacy voicebot, if configured). OFF by default: an unsolicited
 *                            phone call is a bigger, harder-to-undo action than a WhatsApp text, and a
 *                            simultaneous flood of ~N calls is its own problem. WhatsApp + email still
 *                            send as usual either way.
 *   --force                  re-send to leads already marked notified (normally skipped)
 *
 * Only leads that are: screening_result = 'qualified', mapped to a requisition whose batch is still
 * open (not closed/cancelled/filled — the same "outreachEligible" rule the Shortlist Report shows),
 * and not already notified (unless --force) are targeted. Every send/skip/fail is written to a CSV
 * in .deploy-backups (gitignored — candidate PII) for an audit trail of exactly who was messaged.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { db } from "../src/db/mysql.js";
import { evaluateAllLeads } from "../src/modules/meta-campaign/shortlist-report.service.js";
import type { ShortlistEvaluation } from "../src/modules/meta-campaign/shortlist-report.service.js";
import { notifyQualifiedLead } from "../src/modules/meta-campaign/lead-outreach.service.js";
import { isVapiConfigured } from "../src/modules/meta-campaign/vapi-voicebot.provider.js";
import { isVoicebotConfigured } from "../src/modules/meta-campaign/voicebot.provider.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const includeVoice = args.includes("--include-voice");
const requisitionCodes = args.filter((a) => a.startsWith("--requisition=")).map((a) => a.slice("--requisition=".length));
const numArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const limit = numArg("--limit", Number.POSITIVE_INFINITY);
const throttleMs = numArg("--throttle-ms", 2000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

/** Which leads a bulk run targets — exported so this selection rule is unit-testable in isolation. */
export function pickTargets(
  evaluations: ShortlistEvaluation[],
  opts: { requisitionCodes?: string[]; force?: boolean } = {}
): ShortlistEvaluation[] {
  return evaluations.filter((e) => {
    if (!e.outreachEligible) return false; // qualified AND batch open — same rule the report shows
    if (e.notified && !opts.force) return false;
    if (opts.requisitionCodes?.length && !opts.requisitionCodes.includes(e.requisitionCode ?? "")) return false;
    return true;
  });
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(
    `mode: ${apply ? "APPLY (sending real WhatsApp messages)" : "DRY RUN"}` +
      `  voice: ${includeVoice ? "INCLUDED" : "skipped"}  throttle: ${throttleMs}ms` +
      (requisitionCodes.length ? `  requisitions: ${requisitionCodes.join(", ")}` : "") +
      `  db=${process.env.DB_HOST}:${process.env.DB_PORT}`
  );

  const [vapi, legacyVoice] = [isVapiConfigured(), isVoicebotConfigured()];
  if (vapi || legacyVoice) {
    console.log(
      `note: a voice provider IS configured (${vapi ? "Vapi" : "legacy voicebot"}).` +
        (includeVoice ? " --include-voice is set, so each send will also place a call." : " Voice calls are skipped (pass --include-voice to enable).")
    );
  }

  const { evaluations } = await evaluateAllLeads();
  const targets = pickTargets(evaluations, { requisitionCodes, force }).slice(0, limit);

  const byReq = new Map<string, number>();
  for (const t of targets) byReq.set(t.requisitionCode ?? "unknown", (byReq.get(t.requisitionCode ?? "unknown") ?? 0) + 1);
  console.log(`leads to notify: ${targets.length}`);
  for (const [code, n] of byReq) console.log(`  ${code}: ${n}`);

  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const targetCsv = `${dir}/bulk-notify-targets-${stamp}.csv`;
  writeFileSync(
    targetCsv,
    "﻿" +
      toCsv([
        ["Lead ID", "Name", "Phone", "Requisition", "Branch"],
        ...targets.map((t) => [t.leadId, t.name, t.phone, t.requisitionCode, t.branch]),
      ])
  );
  console.log(`target list: ${targetCsv}`);

  if (!apply) {
    console.log("dry run only — nothing was sent. Re-run with --apply to send.");
    return;
  }
  if (!targets.length) {
    console.log("nothing to send.");
    return;
  }

  const results: string[][] = [["Lead ID", "Name", "Phone", "Requisition", "Succeeded channels", "Failed channels", "Skipped reasons"]];
  let sent = 0;
  let noChannelSucceeded = 0;
  let errored = 0;

  for (const t of targets) {
    try {
      const outcome = await notifyQualifiedLead(t.leadId, { force, skipVoice: !includeVoice });
      if (outcome.succeeded.length > 0) sent += 1;
      else noChannelSucceeded += 1;
      results.push([
        t.leadId,
        t.name,
        t.phone,
        t.requisitionCode,
        outcome.succeeded.join("; "),
        outcome.failed.map((f) => `${f.channel}: ${f.error}`).join("; "),
        outcome.skipped.map((s) => `${s.channel}: ${s.reason}`).join("; "),
      ]);
    } catch (err) {
      errored += 1;
      results.push([t.leadId, t.name, t.phone, t.requisitionCode, "", `threw: ${err instanceof Error ? err.message : String(err)}`, ""]);
      console.warn(`lead ${t.leadId} threw: ${err instanceof Error ? err.message : String(err)}`);
    }
    const done = results.length - 1;
    if (done % 50 === 0) console.log(`progress ${done}/${targets.length} (sent ${sent}, no channel succeeded ${noChannelSucceeded}, errored ${errored})`);
    await sleep(throttleMs);
  }

  const resultsCsv = `${dir}/bulk-notify-results-${stamp}.csv`;
  writeFileSync(resultsCsv, "﻿" + toCsv(results));
  console.log(`done: sent to ${sent}, no channel succeeded for ${noChannelSucceeded}, errored ${errored}. Full results: ${resultsCsv}`);
}

// Only run as a CLI script — importing pickTargets for a test must not also fire a live send.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.end?.().catch(() => undefined);
      process.exit();
    });
}
