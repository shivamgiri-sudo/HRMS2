/**
 * Re-screen stored META leads against the batch requisition each one maps to.
 *
 *   npx tsx scripts/rescreen-meta-leads.ts                      # dry run: counts + CSV, writes nothing to leads
 *   npx tsx scripts/rescreen-meta-leads.ts --apply              # re-screen leads whose result / link would change
 *
 * Options
 *   --create-candidates   also create ATS candidates for leads that become qualified (OFF by default:
 *                         a bulk re-screen of old leads must not seed the ATS funnel unasked)
 *   --limit N             stop after N leads (useful for a first small apply)
 *   --throttle-ms N       pause between leads (default 25) — the pool is shared with 45 workers
 *
 * Outreach is never sent from here: rescreenLead does not message anyone.
 *
 * An apply run first writes a rollback snapshot (JSON + SQL) of every lead it is about to touch to
 * ./.deploy-backups, so any lead can be put back exactly as it was.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { metaCampaignService } from "../src/modules/meta-campaign/meta-campaign.service.js";
import {
  evaluateAllLeads,
  summarise,
  toCsv,
} from "../src/modules/meta-campaign/shortlist-report.service.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const numArg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

const apply = flag("--apply");
const createCandidates = flag("--create-candidates");
const limit = numArg("--limit", Number.POSITIVE_INFINITY);
const throttleMs = numArg("--throttle-ms", 25);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sqlStr = (v: unknown) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`);

async function snapshot(ids: string[], stamp: string): Promise<string> {
  const rows: RowDataPacket[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const [found] = await db.execute<RowDataPacket[]>(
      `SELECT id, campaign_id, requisition_id, parsed_name, parsed_phone, parsed_email, parsed_age,
              parsed_location, parsed_education, parsed_experience_yr, screening_result, disqualification_reason
         FROM meta_lead_raw WHERE id IN (${chunk.map(() => "?").join(",")})`,
      chunk
    );
    rows.push(...found);
  }
  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const jsonPath = `${dir}/meta_lead_raw-rescreen-${stamp}.json`;
  const sqlPath = `${dir}/meta_lead_raw-rescreen-rollback-${stamp}.sql`;
  writeFileSync(jsonPath, JSON.stringify(rows, null, 1));
  const lines = rows.map(
    (r) =>
      `UPDATE meta_lead_raw SET campaign_id=${sqlStr(r.campaign_id)}, requisition_id=${sqlStr(r.requisition_id)}, ` +
      `parsed_name=${sqlStr(r.parsed_name)}, parsed_phone=${sqlStr(r.parsed_phone)}, parsed_email=${sqlStr(r.parsed_email)}, ` +
      `parsed_age=${sqlStr(r.parsed_age)}, parsed_location=${sqlStr(r.parsed_location)}, parsed_education=${sqlStr(r.parsed_education)}, ` +
      `parsed_experience_yr=${sqlStr(r.parsed_experience_yr)}, screening_result=${sqlStr(r.screening_result)}, ` +
      `disqualification_reason=${sqlStr(r.disqualification_reason)} WHERE id=${sqlStr(r.id)};`
  );
  writeFileSync(sqlPath, lines.join("\n") + "\n");
  console.log(`rollback snapshot: ${jsonPath} and ${sqlPath} (${rows.length} leads)`);
  return sqlPath;
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`mode: ${apply ? "APPLY" : "DRY RUN"}  createCandidates=${createCandidates}  db=${process.env.DB_HOST}:${process.env.DB_PORT}`);

  const { evaluations, index } = await evaluateAllLeads();
  const summary = summarise(evaluations, index);
  console.log(JSON.stringify({ ...summary, byRequisition: `${summary.byRequisition.length} requisitions` }, null, 1));

  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const csvPath = `${dir}/meta-shortlist-${apply ? "before" : "dryrun"}-${stamp}.csv`;
  writeFileSync(csvPath, "﻿" + toCsv(evaluations));
  console.log(`shortlist report: ${csvPath}`);

  const targets = evaluations.filter((e) => e.changed || e.relink).slice(0, limit);
  console.log(`leads that would be updated: ${targets.length} (of ${evaluations.length})`);
  if (!apply) {
    console.log("dry run only — re-run with --apply to write.");
    return;
  }
  if (!targets.length) return;

  await snapshot(targets.map((t) => t.leadId), stamp);

  let done = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      await metaCampaignService.rescreenLead(t.leadId, { createCandidate: createCandidates });
      done += 1;
    } catch (err) {
      failed += 1;
      console.warn(`lead ${t.leadId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((done + failed) % 200 === 0) console.log(`progress ${done + failed}/${targets.length} (failed ${failed})`);
    await sleep(throttleMs);
  }
  console.log(`re-screened ${done}, failed ${failed}`);

  const after = await evaluateAllLeads();
  writeFileSync(`${dir}/meta-shortlist-after-${stamp}.csv`, "﻿" + toCsv(after.evaluations));
  console.log("after:", JSON.stringify({ current: summarise(after.evaluations, after.index).current }));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end?.().catch(() => undefined);
    process.exit();
  });
