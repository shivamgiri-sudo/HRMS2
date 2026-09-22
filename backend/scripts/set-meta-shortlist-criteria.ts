/**
 * Apply the agreed META shortlisting criteria (src/modules/meta-campaign/shortlist-criteria.ts).
 *
 *   npx tsx scripts/set-meta-shortlist-criteria.ts            # PREVIEW: nothing is written. Shows the
 *                                                             # shortlist HRMS would produce with the
 *                                                             # criteria in place, vs. today.
 *   npx tsx scripts/set-meta-shortlist-criteria.ts --apply    # write the criteria (rollback SQL saved)
 *
 * --apply only sets criteria (job_requisition.education_requirement + meta_screening_config, and
 * meta_campaign.screening_config once migration 1835 exists). It does NOT re-screen any lead and
 * messages nobody; run rescreen-meta-leads.ts afterwards for that.
 *
 * A requisition/campaign that already has a screening config is skipped, never silently overwritten
 * — pass --force to intentionally overwrite one whose criteria in shortlist-criteria.ts changed
 * (recruitment refining a rule after it went live). --force still saves the pre-change values to the
 * rollback SQL first, and still leaves alone anything not listed in shortlist-criteria.ts.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import {
  evaluateAllLeads,
  loadRequisitionIndex,
  summarise,
  toCsv,
} from "../src/modules/meta-campaign/shortlist-report.service.js";
import type { RequisitionIndex } from "../src/modules/meta-campaign/shortlist-report.service.js";
import { CAMPAIGN_CRITERIA, REQUISITION_CRITERIA } from "../src/modules/meta-campaign/shortlist-criteria.js";

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");
const sqlStr = (v: unknown) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/** The live index with the agreed criteria laid over it, in memory only. */
function withCriteria(base: RequisitionIndex): RequisitionIndex {
  const byId = new Map(base.byId);
  const byCode = new Map(base.byCode);
  for (const [code, criteria] of Object.entries(REQUISITION_CRITERIA)) {
    const r = byCode.get(code.toUpperCase());
    if (!r) {
      console.warn(`requisition ${code} not found - skipped`);
      continue;
    }
    const merged = { ...r, education: criteria.education ?? r.education, screeningConfig: criteria.config };
    byId.set(r.id, merged);
    byCode.set(code.toUpperCase(), merged);
  }
  const campaignByForm = new Map(base.campaignByForm);
  for (const c of CAMPAIGN_CRITERIA) {
    const existing = campaignByForm.get(c.formId);
    campaignByForm.set(c.formId, {
      formId: c.formId,
      campaignName: existing?.campaignName ?? c.campaignName,
      requisitionId: existing?.requisitionId ?? null,
      screeningConfig: c.config,
    });
  }
  return { byId, byCode, campaignByForm };
}

async function campaignColumnExists(): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meta_campaign' AND COLUMN_NAME = 'screening_config' LIMIT 1`
  );
  return rows.length > 0;
}

async function writeCriteria(stamp: string): Promise<void> {
  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const rollback: string[] = [];

  for (const [code, criteria] of Object.entries(REQUISITION_CRITERIA)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, education_requirement, meta_screening_config FROM job_requisition WHERE requisition_code = ? LIMIT 1",
      [code]
    );
    const row = rows[0];
    if (!row) {
      console.warn(`requisition ${code} not found - skipped`);
      continue;
    }
    if (row.meta_screening_config && !force) {
      console.warn(`requisition ${code} already has a screening config - skipped, not overwritten (pass --force to update it)`);
      continue;
    }
    rollback.push(
      `UPDATE job_requisition SET education_requirement=${sqlStr(row.education_requirement)}, meta_screening_config=NULL WHERE id=${sqlStr(row.id)};`
    );
    await db.execute("UPDATE job_requisition SET education_requirement = ?, meta_screening_config = ? WHERE id = ?", [
      criteria.education ?? row.education_requirement,
      JSON.stringify(criteria.config),
      row.id,
    ]);
    console.log(`set criteria on ${code}: ${criteria.note}`);
  }

  if (await campaignColumnExists()) {
    for (const c of CAMPAIGN_CRITERIA) {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id, screening_config FROM meta_campaign WHERE meta_form_id = ? LIMIT 1",
        [c.formId]
      );
      const row = rows[0];
      if (!row) {
        console.warn(`campaign for form ${c.formId} not found - skipped`);
        continue;
      }
      if (row.screening_config && !force) {
        console.warn(`campaign ${c.campaignName} already has criteria - skipped (pass --force to update it)`);
        continue;
      }
      rollback.push(`UPDATE meta_campaign SET screening_config=${sqlStr(row.screening_config)} WHERE id=${sqlStr(row.id)};`);
      await db.execute("UPDATE meta_campaign SET screening_config = ? WHERE id = ?", [JSON.stringify(c.config), row.id]);
      console.log(`set campaign criteria on ${c.campaignName}: ${c.note}`);
    }
  } else {
    console.warn("meta_campaign.screening_config does not exist yet (migration 1835 not applied) - campaign criteria NOT written.");
  }

  const sqlPath = `${dir}/meta-criteria-rollback-${stamp}.sql`;
  writeFileSync(sqlPath, rollback.join("\n") + "\n");
  console.log(`rollback SQL: ${sqlPath}`);
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`mode: ${apply ? "APPLY CRITERIA" : "PREVIEW"}${force ? " (force)" : ""}  db=${process.env.DB_HOST}:${process.env.DB_PORT}`);

  const base = await loadRequisitionIndex();
  const before = summarise((await evaluateAllLeads(base)).evaluations, base);
  const overlay = withCriteria(base);
  const { evaluations } = await evaluateAllLeads(overlay);
  const after = summarise(evaluations, overlay);

  console.log("TODAY (criteria as stored):", JSON.stringify(before.proposed));
  console.log("WITH AGREED CRITERIA      :", JSON.stringify(after.proposed), `contactable in an open batch: ${after.outreachEligible}`);
  console.log("by requisition:");
  for (const r of after.byRequisition) {
    console.log(`  ${r.requisitionCode} ${r.branch}: ${r.total} leads -> ${r.qualified} shortlisted, ${r.disqualified} not`);
  }
  console.log("by campaign without a requisition:");
  for (const c of after.byCampaign) {
    console.log(`  ${c.campaignName}: ${c.total} leads -> ${c.qualified} shortlisted, ${c.disqualified} not, ${c.unscreened} unscreened (${c.criteria})`);
  }
  console.log("top rejection reasons:", JSON.stringify(after.topDisqualificationReasons.slice(0, 8)));
  console.log("top unverified checks:", JSON.stringify(after.topUnverifiedChecks.slice(0, 8)));

  const dir = "./.deploy-backups";
  mkdirSync(dir, { recursive: true });
  const csv = `${dir}/meta-shortlist-with-criteria-${stamp}.csv`;
  writeFileSync(csv, "﻿" + toCsv(evaluations));
  console.log(`report: ${csv}`);

  if (!apply) {
    console.log("preview only - re-run with --apply to write the criteria.");
    return;
  }
  await writeCriteria(stamp);
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
