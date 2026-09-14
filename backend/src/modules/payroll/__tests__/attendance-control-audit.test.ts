import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Attendance Control Tower mutations left no audit trail.
 *
 * The service writes attendance_daily_record rows (repairMissingAdr) and records
 * review decisions on cross-evidence conflicts (updateReviewStatus). Payable days
 * are derived from attendance_daily_record, so a repair changes what someone is
 * paid — and the whole 1,098-line file contained no call to logSensitiveAction
 * and no insert into payroll_calculation_audit, the two tables the Payroll Audit
 * Trail screen reads. Attendance feeding payroll could be materially altered with
 * no record of who did it.
 *
 * This is the same gap closed on payroll run status changes; the two were the
 * remaining unaudited mutating paths in the module.
 */

const { execute, logSensitiveAction } = vi.hoisted(() => ({
  execute: vi.fn(),
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));
vi.mock("../payroll-governance.service.js", () => ({ payrollGovernanceService: { readiness: vi.fn() } }));
vi.mock("../../inbox/inbox.service.js", () => ({ inboxService: { createItem: vi.fn() } }));

import { payrollAttendanceControlService } from "../payroll-attendance-control.service.js";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payroll-attendance-control.service.ts"),
  "utf8",
);

describe("repairMissingAdr is audited", () => {
  beforeEach(() => {
    execute.mockReset();
    logSensitiveAction.mockClear();
  });

  it("writes an audit row naming the actor and the keys touched", async () => {
    // No key matches the apr:/ncosec: prefixes, so neither repair helper runs and
    // no database work is needed — this exercises the audit path directly.
    await payrollAttendanceControlService.repairMissingAdr({
      conflictKeys: ["other:emp-1:2026-07-01"],
      actorUserId: "user-9",
    });

    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    const entry = logSensitiveAction.mock.calls[0][0];
    expect(entry.actor_user_id).toBe("user-9");
    expect(entry.action_type).toBe("ATTENDANCE_ADR_REPAIRED");
    expect(entry.entity_type).toBe("attendance_daily_record");
    // The keys carry employee and date, so the row says which attendance was
    // written rather than only how many rows were.
    expect(entry.change_summary.conflict_keys).toEqual(["other:emp-1:2026-07-01"]);
  });

  it("logs even when nothing was repaired", async () => {
    await payrollAttendanceControlService.repairMissingAdr({
      conflictKeys: [],
      actorUserId: "user-9",
    });

    // An attempt that repaired nothing is worth seeing: it usually means the
    // evidence did not support the repair the operator thought they were making.
    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction.mock.calls[0][0].change_summary.repaired).toBe(0);
  });

  it("attributes an unattributed call to system rather than dropping the row", async () => {
    await payrollAttendanceControlService.repairMissingAdr({
      conflictKeys: [],
      actorUserId: null,
    });

    expect(logSensitiveAction.mock.calls[0][0].actor_user_id).toBe("system");
  });
});

describe("the audit rows reach the Payroll Audit Trail", () => {
  it("tags both actions with the module the trail filters on", () => {
    // payroll-audit-trail.routes.ts selects sensitive_action_log WHERE
    // module_key='payroll'. A different tag would write a row nobody ever sees.
    const tags = SOURCE.match(/module_key: "([a-z_]+)"/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(2);
    for (const tag of tags) expect(tag).toBe('module_key: "payroll"');
  });

  it("audits the review decision as well as the repair", () => {
    expect(SOURCE).toContain("ATTENDANCE_CONFLICT_REVIEWED");
    expect(SOURCE).toContain("ATTENDANCE_ADR_REPAIRED");
  });

  it("records the review status and count, not merely that something happened", () => {
    const idx = SOURCE.indexOf("ATTENDANCE_CONFLICT_REVIEWED");
    const block = SOURCE.slice(idx, idx + 500);
    expect(block).toMatch(/status: params\.status/);
    expect(block).toMatch(/conflicts_updated: updated/);
  });
});
