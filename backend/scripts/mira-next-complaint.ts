/**
 * Read-only: the next Mira complaint worth a human fix, with everything needed to start.
 *
 * This is the dispatch half of the /mira-fix workflow. The pipeline's triage stage already
 * decides what is a genuine, actionable bug (mira-issue-triage.service.ts) and its keyword
 * search already knows which files are probably involved (mira-fix-draft-context.ts) — but
 * nothing ever handed that to the person who would actually fix it, so the diagnoses sat in
 * work_item_audit_log unread. This prints them.
 *
 * Deliberately does NOT write a fix, a diff, or a draft row. The engine's job here ends at
 * "here is the bug, here is the hypothesis, here are the likely files"; the judgment about
 * what the correct change is stays with a human, for the reasons in the 2026-08-14 decision
 * (an unattended diff generator has no way to reproduce a defect against the live database,
 * and this codebase's real bugs keep turning on exactly that).
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/mira-next-complaint.ts            # next eligible
 *   ./node_modules/.bin/tsx scripts/mira-next-complaint.ts <workItemId>
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';
import { buildContextBundle } from '../src/modules/ai/mira-fix-draft-context.js';
import { parseDiagnosisRemark } from '../src/modules/ai/mira-fix-draft-generate.service.js';

/** Interpolated, not bound: mas_hrms (MySQL 8.0.42) rejects a NUMBER bound into LIMIT on a
 *  prepared statement with ER_WRONG_ARGUMENTS — see backend/src/db/pagination.ts. A literal
 *  here rather than sqlLimit() only because the value is a hard-coded 1. */
const ONE = 'LIMIT 1';

async function main() {
  const wantedId = process.argv[2]?.trim();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.id, wi.title, wi.description, wi.status, wi.created_at,
            CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS reporter_name,
            e.employee_code AS reporter_code,
            (SELECT al.remarks FROM work_item_audit_log al
              WHERE al.work_item_id = wi.id AND al.action = 'mira_ai_triage'
              ORDER BY al.performed_at DESC ${ONE}) AS remarks
       FROM work_item wi
       LEFT JOIN employees e ON e.id = wi.created_by
      WHERE wi.item_type = 'MIRA_FEEDBACK'
        AND wi.status <> 'completed'
        ${wantedId ? 'AND wi.id = ?' : ''}
      ORDER BY wi.created_at ASC`,
    wantedId ? [wantedId] : [],
  );

  // Eligibility is decided from the diagnosis text, the same way the draft stage decides it:
  // genuine_bug + actionable=true. Anything else is a feature request or needs a human
  // judgment call that is not "go write a patch".
  const eligible = (rows as RowDataPacket[])
    .map((r) => ({ row: r, parsed: r.remarks ? parseDiagnosisRemark(String(r.remarks)) : null }))
    .filter((c) => wantedId || (c.parsed?.category === 'genuine_bug' && c.parsed.actionable));

  if (!eligible.length) {
    console.log(wantedId
      ? `No open MIRA_FEEDBACK work item with id ${wantedId}.`
      : 'No complaint is currently eligible for a fix (none is diagnosed genuine_bug + actionable). Run the triage pass first, or pass an id explicitly.');
    return;
  }

  const { row, parsed } = eligible[0];
  const contextFiles = buildContextBundle(
    String(row.description ?? ''),
    parsed ? `${parsed.rootCauseHypothesis} ${parsed.suggestedNextStep}` : '',
  );

  console.log(`WORK_ITEM_ID: ${row.id}`);
  console.log(`REPORTED_BY:  ${String(row.reporter_name ?? '').trim() || 'Unknown'} (${row.reporter_code ?? 'no code'}) on ${row.created_at}`);
  console.log(`STATUS:       ${row.status}`);
  console.log(`\nCOMPLAINT:\n${row.description}`);
  if (parsed) {
    console.log(`\nAI DIAGNOSIS (${parsed.category}, confidence ${parsed.confidence}):`);
    console.log(`  Root cause hypothesis: ${parsed.rootCauseHypothesis}`);
    console.log(`  Suggested next step:   ${parsed.suggestedNextStep}`);
    console.log(`  NOTE: this is an AI hypothesis for review, not a verified cause. Confirm it before acting on it.`);
  } else {
    console.log('\nAI DIAGNOSIS: none recorded — this item has not been triaged.');
  }
  console.log(`\nCANDIDATE FILES (keyword search — a starting point, not a conclusion):`);
  console.log(contextFiles.length
    ? contextFiles.map((f) => `  ${f.path}`).join('\n')
    : '  (none matched — search manually)');
  console.log(`\nWhen the fix is pushed and verified on origin/main, close it with:`);
  console.log(`  ./node_modules/.bin/tsx scripts/mira-close-complaint.ts ${row.id} <commitSha>`);
}

main()
  .catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exitCode = 1; })
  .finally(async () => { await db.end(); });
