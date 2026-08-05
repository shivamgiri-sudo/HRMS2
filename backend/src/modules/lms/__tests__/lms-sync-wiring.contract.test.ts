/**
 * lms_learner_progress sync wiring.
 *
 * The computation for this table (modules/lms-integration/lms-sync.service.ts:
 * syncLearnerProgress) existed and was correct, but had zero call sites anywhere —
 * confirmed live: SELECT COUNT(*) FROM lms_learner_progress returned 0 rows in
 * production while 5 other modules (bi.service.ts, the reporting executor,
 * report-catalog, data-governance, this module's own /progress-summary) read it
 * assuming freshness. This is the same "module exists, nothing calls it" failure
 * mode notification-wiring.test.ts guards against for the notification engine —
 * same style here: source-text inspection, not a runtime spy, because the goal is
 * to catch the call site vanishing again, not to exercise the sync itself.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const syncSource = readFileSync(resolve(process.cwd(), "src/modules/lms/lms.sync.service.ts"), "utf8");
const deadModuleSource = readFileSync(
  resolve(process.cwd(), "src/modules/lms-integration/lms-sync.service.ts"),
  "utf8",
);

describe("LMS learner-progress snapshot is wired into the active sync", () => {
  it("lms.sync.service.ts imports lmsSyncService from the lms-integration module", () => {
    expect(syncSource).toMatch(/from\s+["'][^"']*lms-integration\/lms-sync\.service\.js["']/);
  });

  it("runFullSync calls syncLearnerProgressSnapshot", () => {
    const fnMatch = syncSource.match(/export async function runFullSync[\s\S]*?\n\}/);
    expect(fnMatch, "runFullSync function body not found").toBeTruthy();
    expect(
      fnMatch![0],
      "runFullSync no longer calls syncLearnerProgressSnapshot — lms_learner_progress " +
        "will silently stop being populated again",
    ).toMatch(/syncLearnerProgressSnapshot\s*\(/);
  });

  it("syncLearnerProgressSnapshot calls lmsSyncService.syncLearnerProgress", () => {
    const fnMatch = syncSource.match(/export async function syncLearnerProgressSnapshot[\s\S]*?\n\}/);
    expect(fnMatch, "syncLearnerProgressSnapshot function body not found").toBeTruthy();
    expect(fnMatch![0]).toMatch(/lmsSyncService\.syncLearnerProgress\s*\(/);
  });

  it("the dead module's syncLearnerProgress no longer imports the broken same-directory mapper", () => {
    // Guards against the ORIGINAL defect recurring: this module's own mapper
    // references columns (lms_employee_id, hrms_employee_id, ...) that
    // lms_employee_mapping has never had, so every lookup would throw.
    expect(deadModuleSource).not.toMatch(/from\s+["']\.\/lms-employee-mapper\.js["']/);
    expect(deadModuleSource).toMatch(/from\s+["']\.\.\/lms\/lms-employee-mapper\.js["']/);
  });
});
