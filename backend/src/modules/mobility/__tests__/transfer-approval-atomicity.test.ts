import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Rule 9 — immediate transfer approval, 2026-08-16.
 *
 * updateTransfer ran four unrelated autocommit statements: the status UPDATE, a re-SELECT,
 * the employee-row move, then the journey log. status went to 'completed' first and on its
 * own, so any failure after it left the record asserting a transfer that had not happened.
 *
 * That window was not theoretical. applyTransferToEmployee throws by design when a master
 * lookup misses — "branch 'X' not found in branch_master" — specifically so a FK is never
 * silently nulled. On that throw the transfer stayed 'completed', the employee never moved,
 * and neither the journey log nor the TRANSFER_APPROVED audit ran, so nothing recorded that
 * anything had gone wrong.
 *
 * The status UPDATE also had no expected-state predicate and no affectedRows check, so two
 * approvers both succeeded: employee moved twice, two audits, two journey entries.
 */

const { execute, connExecute, connBegin, connCommit, connRollback, connRelease, getConnection } = vi.hoisted(() => {
  const connExecute = vi.fn();
  return {
    execute: vi.fn(),
    connExecute,
    connBegin: vi.fn(async () => undefined),
    connCommit: vi.fn(async () => undefined),
    connRollback: vi.fn(async () => undefined),
    connRelease: vi.fn(() => undefined),
    getConnection: vi.fn(async () => ({
      execute: connExecute,
      beginTransaction: vi.fn(async () => undefined),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
      release: vi.fn(() => undefined),
    })),
  };
});

vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection } }));

const { logSensitiveAction } = vi.hoisted(() => ({ logSensitiveAction: vi.fn(async () => undefined) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction }));

const { mobilityService } = await import("../mobility.service.js");

const TRANSFER_ID = "tr-1";
const APPROVER = "user-approver";
const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function transferRow(over: Record<string, unknown> = {}) {
  return {
    id: TRANSFER_ID,
    employee_id: "emp-1",
    transfer_type: "branch",
    from_value: "NOIDA",
    to_value: "NOIDA-2",
    effective_date: YESTERDAY,
    status: "pending",
    applied_at: null,
    ...over,
  };
}

/** Wires one transaction connection whose statements are recorded, plus the outcome knobs. */
function wire(
  row: Record<string, unknown> | null,
  opts: {
    statusAffectedRows?: number;
    claimAffectedRows?: number;
    masterFound?: boolean;
  } = {}
) {
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const release = vi.fn(() => undefined);
  const begin = vi.fn(async () => undefined);

  connExecute.mockReset();
  connExecute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/SELECT \* FROM transfer_record WHERE id = \? FOR UPDATE/.test(s)) {
      return [row ? [row] : [], []];
    }
    if (/UPDATE transfer_record SET status/.test(s)) {
      return [{ affectedRows: opts.statusAffectedRows ?? 1 }, []];
    }
    if (/UPDATE transfer_record SET applied_at = NOW\(\) WHERE id = \? AND applied_at IS NULL/.test(s)) {
      return [{ affectedRows: opts.claimAffectedRows ?? 1 }, []];
    }
    if (/_master WHERE id = \?/.test(s)) {
      return [(opts.masterFound ?? true) ? [{ id: "branch-uuid" }] : [], []];
    }
    if (/UPDATE employees SET/.test(s)) return [{ affectedRows: 1 }, []];
    if (/INSERT INTO employee_journey_log/.test(s)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });

  getConnection.mockReset();
  getConnection.mockResolvedValue({
    execute: connExecute,
    beginTransaction: begin,
    commit,
    rollback,
    release,
  } as never);

  execute.mockReset();
  execute.mockImplementation(async () => [[row ?? {}], []]);

  return { commit, rollback, release, begin };
}

const sqlIssued = () => connExecute.mock.calls.map(([s]) => String(s));

beforeEach(() => {
  logSensitiveAction.mockReset();
});

describe("immediate transfer approval is atomic", () => {
  it("rolls back the 'completed' status when the master lookup fails", async () => {
    // The exact Rule 9 case: transfer = completed, employee = old assignment.
    const { commit, rollback } = wire(transferRow(), { masterFound: false });

    await expect(
      mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
    ).rejects.toThrow(/not found in branch_master/);

    expect(rollback).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("writes no TRANSFER_APPROVED audit for a transfer that rolled back", async () => {
    wire(transferRow(), { masterFound: false });
    await mobilityService
      .updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
      .catch(() => undefined);
    expect(logSensitiveAction).not.toHaveBeenCalled();
  });

  it("commits once and audits when the move succeeds", async () => {
    const { commit, rollback } = wire(transferRow());
    await mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(logSensitiveAction).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction.mock.calls[0][0]).toMatchObject({ action_type: "TRANSFER_APPROVED" });
  });

  it("always returns the pooled connection", async () => {
    const { release } = wire(transferRow(), { masterFound: false });
    await mobilityService
      .updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
      .catch(() => undefined);
    expect(release).toHaveBeenCalled();
  });
});

describe("a transfer cannot be actioned twice", () => {
  it("refuses one that is already completed", async () => {
    wire(transferRow({ status: "completed" }));
    await expect(
      mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("guards the status UPDATE on the state the decision was made on", async () => {
    wire(transferRow());
    await mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never);
    const statusSql = sqlIssued().find((s) => /UPDATE transfer_record SET status/.test(s));
    expect(statusSql).toMatch(/AND status = \?/);
  });

  it("refuses when another approver won the race", async () => {
    wire(transferRow(), { statusAffectedRows: 0 });
    await expect(
      mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("claims applied_at before moving the employee, so the worker cannot double-apply", async () => {
    wire(transferRow());
    await mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never);

    const issued = sqlIssued();
    const claimIdx = issued.findIndex((s) => /applied_at = NOW\(\) WHERE id = \? AND applied_at IS NULL/.test(s));
    const moveIdx = issued.findIndex((s) => /UPDATE employees SET branch_id/.test(s));
    expect(claimIdx).toBeGreaterThan(-1);
    expect(moveIdx).toBeGreaterThan(claimIdx);
  });

  it("refuses when the row was already applied", async () => {
    wire(transferRow(), { claimAffectedRows: 0 });
    await expect(
      mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("the future-dated rule is unchanged", () => {
  it("approves but does not move the employee before effective_date", async () => {
    const { commit } = wire(transferRow({ effective_date: TOMORROW }));
    await mobilityService.updateTransfer(TRANSFER_ID, { action: "approved", approved_by: APPROVER } as never);

    const issued = sqlIssued();
    expect(issued.some((s) => /UPDATE employees SET/.test(s))).toBe(false);
    expect(issued.some((s) => /applied_at IS NULL/.test(s))).toBe(false);
    // Still recorded and still committed — held, not dropped.
    expect(issued.some((s) => /INSERT INTO employee_journey_log/.test(s))).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(logSensitiveAction.mock.calls[0][0]).toMatchObject({ change_summary: { applied: false } });
  });
});

describe("rejection path", () => {
  it("records the rejection without touching the employee", async () => {
    const { commit } = wire(transferRow());
    await mobilityService.updateTransfer(TRANSFER_ID, { action: "rejected", approved_by: APPROVER } as never);

    expect(sqlIssued().some((s) => /UPDATE employees SET/.test(s))).toBe(false);
    expect(logSensitiveAction).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
