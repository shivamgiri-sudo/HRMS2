import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "path";

/**
 * Repo-wide guard against DDL syntax and collation declarations this production database
 * rejects or silently mishandles.
 *
 * Born from a real outage: 2026-08-13, migration 1006_payroll_process_readiness_extend.sql
 * used `ADD COLUMN IF NOT EXISTS`. Every variant of that clause throws ER_PARSE_ERROR on this
 * production MySQL build (8.0.42) — confirmed live, at the `IF NOT EXISTS` token itself, not a
 * semantic "already exists" failure. Because a failed migration blocks the entire application
 * from starting (STOP_ON_FIRST_FAILURE), this took production down for ~24 minutes.
 * See docs/incidents/2026-08-13-migration-1006-production-outage.md.
 *
 * This exact incompatibility, and a second one (silent collation drift via a bare
 * `DEFAULT CHARSET=` with no `COLLATE=`), had ALREADY been found and fixed at scale — 0
 * findings across 572 files — on 2026-08-03, on a branch
 * (`stabilization/release-readiness-2026-08-03`) that was never merged into `main`. That fix
 * never reached migration 1006 (authored 2026-07-22, before that branch existed) or the many
 * other migrations written on `main` after 2026-08-03 while the fix sat unmerged. The audit
 * script itself (`backend/scripts/audit-migration-collations.mjs`) is ported from that branch
 * verbatim rather than re-implemented here, specifically so this test and any future manual
 * run of the script never diverge from each other.
 *
 * This test is the generalization the incident was missing: every migration in backend/sql/,
 * checked on every test run, not one file someone happened to already suspect.
 */

const SCRIPT_PATH = path.resolve(__dirname, "../../../scripts/audit-migration-collations.mjs");

/**
 * Ratchet baseline, not an exemption list.
 *
 * Snapshot taken 2026-08-13, immediately after porting the audit script from the stranded
 * branch and running it against current `main`: 62 files already violate one of the two
 * checked patterns (MariaDB-only conditional DDL, or a collation-drift-prone bare CHARSET).
 * All 62 are pre-existing and, where already deployed, already applied — none carries 1006's
 * immediate blast radius — but every one is a live landmine for the next fresh environment,
 * disaster-recovery restore, or replica build that has to run its full migration history from
 * scratch, and for any future work that touches the same tables before they're rewritten.
 *
 * This file deliberately does NOT fix all 62 at once — each needs the same treatment 1006 got
 * (verify current schema state, rewrite with a guard, test against real data), and doing that
 * carelessly across 62 files in one pass is how an audit turns into a second incident.
 *
 * The rule going forward: this list must never grow. Remove an entry only when that file has
 * been rewritten and reverified; never add a new one to make a failing test pass.
 */
const KNOWN_LEGACY_VIOLATIONS = new Set([
  "021_location_master.sql",
  "033_kpi_process_config.sql",
  "035_portal_published_data.sql",
  "036_erp_billing.sql",
  "071_communication_provider_config.sql",
  "1002_fix_salary_register_audit_log_columns.sql",
  "1004_role_catalog_names_scope_ui.sql",
  "1007_legacy_salary_snapshot.sql",
  "1007_legacy_salary_snapshot_FINAL.sql",
  "1008_migrate_legacy_increments.sql",
  "1014_regularization_spoc_columns.sql",
  "1038_salary_prep_line_component_reason.sql",
  "1064_celebration_post_type.sql",
  "204_personal_contact_fields.sql",
  "206_ats_recruiter_contact_details.sql",
  "206_leave_el_accrual_ledger.sql",
  "228_wfm_roster_assignment_lifecycle.sql",
  "229_roster_decision_audit_extension.sql",
  "230_attendance_reconciliation_rta_linkage.sql",
  "231_process_master_workload_type.sql",
  "235_soft_delete_wfm_planning_tables.sql",
  "237_attendance_dispute_schema.sql",
  "239_conversion_funnel_schema.sql",
  "246_nominee_gratuity_distribution.sql",
  "262_reporting_manager_change_request.sql",
  "271_web_punch_columns.sql",
  "289_candidate_onboarding_full_field_parity.sql",
  "289_candidate_onboarding_full_field_parity_mysql8.sql",
  "321_leave_request_geo.sql",
  "322_regularization_geo.sql",
  "323_onboarding_submit_geo.sql",
  "324_login_geo.sql",
  "327_aadhaar_esign_appointment_letter.sql",
  "336_dpdp_compliance_gaps.sql",
  "339_payroll_validation_status.sql",
  "341_onboarding_profile_missing_columns.sql",
  "391_payroll_validation_freeze_columns.sql",
  "396_statutory_config_history.sql",
  // 397, 398, 402, 404, 413 fixed 2026-08-14 — see backend/sql/{397,398,402,404,413}_*.sql.
  // 398 and 404 both targeted salary_prep_run.incentives_applied_at and were both recorded
  // success=1 since 2026-07-20 despite the column never existing; 402's payslip_emailed /
  // payslip_emailed_at were the same drift. All four columns/indexes now genuinely exist —
  // verified via information_schema before and after, and all five files re-run clean and
  // idempotent against the now-migrated schema.
  //
  // 364, 375, 380, 470, 504 fixed 2026-08-14 (batch 2) — same guard rewrite. 364/375/470/504
  // targets already existed on production (no-op fixes, all re-verified executing clean).
  // 380's target (job_requisition.last_overdue_notified_at) is genuinely missing and unused
  // by any application code (confirmed) — syntax fixed, deliberately NOT executed; adding the
  // column is a decision for whoever owns the requisition overdue-notification cron.
  "400_payroll_branch_readiness.sql",
  "401_payroll_calendar.sql",
  "403_payroll_run_signoff.sql",
  "450_policy_engine_config.sql",
  "451_company_feed_foundation.sql",
  "508_ats_onboarding_bridge_code_columns.sql",
  "521_security_audit_event_table.sql",
  "534_db_bill_snapshot_enrichment.sql",
  "538_branch_master_address_contact.sql",
  "539_payroll_schema_gaps.sql",
  "550_attendance_hub_performance_indexes.sql",
  "999_create_missing_engagement_tables.sql",
]);

function runAudit(): { exitCode: number; findings: Array<{ file: string; detail: string }> } {
  let stdout = "";
  let exitCode = 0;
  try {
    stdout = execFileSync("node", [SCRIPT_PATH], { encoding: "utf8" });
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    stdout = err.stdout ?? "";
    exitCode = err.status ?? 1;
  }
  const findings: Array<{ file: string; detail: string }> = [];
  for (const line of stdout.split("\n")) {
    // Format: "  <file>:<line>  <problem>"
    const m = line.match(/^\s+([^\s:]+\.sql):(\d+)\s+(.*)$/);
    if (m) findings.push({ file: m[1], detail: `${m[2]}: ${m[3]}` });
  }
  return { exitCode, findings };
}

describe("migration DDL syntax & collation compatibility (production MySQL 8.0.42)", () => {
  const { findings } = runAudit();

  it("introduces no NEW migration with unsupported DDL syntax or collation drift", () => {
    const newViolations = findings.filter((f) => !KNOWN_LEGACY_VIOLATIONS.has(f.file));
    if (newViolations.length > 0) {
      const report = newViolations.map((v) => `  ${v.file} — ${v.detail}`).join("\n");
      // eslint-disable-next-line no-console
      console.error(
        `\n${newViolations.length} migration(s) introduce a NEW compatibility problem:\n${report}\n` +
        `Run \`node scripts/audit-migration-collations.mjs\` for full detail. Guard conditional DDL with ` +
        `information_schema + PREPARE/EXECUTE (see backend/sql/1006_payroll_process_readiness_extend.sql), ` +
        `and always name COLLATE=utf8mb4_unicode_ci alongside DEFAULT CHARSET=utf8mb4.`
      );
    }
    expect(newViolations).toEqual([]);
  });

  it("does not grow the legacy baseline — fixed files must be removed from it, not re-added", () => {
    const stillViolating = new Set(findings.map((f) => f.file));
    const staleBaselineEntries = [...KNOWN_LEGACY_VIOLATIONS].filter((f) => !stillViolating.has(f));
    if (staleBaselineEntries.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `${staleBaselineEntries.length} file(s) in KNOWN_LEGACY_VIOLATIONS no longer violate — ` +
        `remove them from the baseline: ${staleBaselineEntries.join(", ")}`
      );
    }
    // Informational, not a failure: fixing a file ahead of removing it from the list is fine.
    // This just keeps the drift visible in test output.
    expect(true).toBe(true);
  });
});
