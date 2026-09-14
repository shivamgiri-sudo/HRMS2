import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The readable history of a GRN must cover the whole GRN, not the middle of it.
 *
 * Finance has TWO audit sinks and they are not interchangeable:
 *
 *   finance_approval_event (1089) — append-only workflow history. THROWS on failure and takes
 *     the caller's connection, so an event cannot survive a rolled-back transition or vanish
 *     unnoticed. It is the only one with a read endpoint: GET /grns/:id/approval-history.
 *   sensitive_action_log (via writeGrnAudit -> logSensitiveAction) — security telemetry.
 *     Deliberately NON-throwing: it catches, prints to stderr and lets the operation continue.
 *     1033_sensitive_action_log_entity_id_width.sql records what that costs — 26 approved
 *     regularizations left no trail at all because a write was silently dropped.
 *
 * The workflow trail held approve, reject, return, resubmit, reverse and billing_cycle_set —
 * but not create, submit or cancel. Those three lived only on the non-throwing sink, so the
 * one history a reviewer can actually read began mid-chain: it could not say who raised the
 * document, when it entered the approval chain, or who killed it. Both writes stay; each
 * answers a different question.
 */

const financeDir = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(financeDir, file), "utf8");

const { execute, query, getConnection } = vi.hoisted(() => ({
  execute: vi.fn(), query: vi.fn(), getConnection: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query, getConnection } }));
vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(async () => {}),
  writeSensitiveActionLog: vi.fn(async () => {}),
}));

const { grnService } = await import("../grn.service.js");

const DRAFT_GRN = {
  id: "grn-1",
  grn_number: "GRN/2026/0007",
  branch_id: "branch-A",
  status: "draft",
  grn_type: "vendor",
  budget_line_id: "line-1",
  attachment_path: "uploads/x.pdf",
  amount_with_tax: 11800,
  amount: 10000,
  quantity: 1,
};

/** id, entity_type, entity_id, action, from_status, to_status, decision, actor, role, remarks, details */
const eventShape = (params: unknown[]) => ({
  entityType: params[1], entityId: params[2], action: params[3],
  fromStatus: params[4], toStatus: params[5], actorRole: params[8],
});

const eventsFrom = (calls: unknown[][]) =>
  calls
    .filter(([sql]) => /INSERT INTO finance_approval_event/i.test(String(sql)))
    .map(([, params]) => eventShape(params as unknown[]));

beforeEach(() => {
  execute.mockReset();
  query.mockReset();
  getConnection.mockReset();
  query.mockResolvedValue([[], []]);
});

describe("submitting a GRN", () => {
  it("records the draft -> submitted transition on the readable workflow trail", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request/i.test(String(sql)) && /SELECT/i.test(String(sql))) return [[DRAFT_GRN], []];
      if (/UPDATE grn_request/i.test(String(sql))) return [{ affectedRows: 1 } as any, []];
      return [[], []];
    });

    await grnService.submitForApproval("grn-1", { remarks: "please approve" } as any, "user-1", "branch_admin");

    const events = eventsFrom(execute.mock.calls);
    expect(events, "submit was the one chain-starting transition with no readable event").toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "grn", entityId: "grn-1", action: "submit",
      fromStatus: "draft", toStatus: "submitted", actorRole: "branch_admin",
    });
  });

  it("writes no event when the submission itself is refused", async () => {
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request/i.test(String(sql)) && /SELECT/i.test(String(sql))) {
        return [[{ ...DRAFT_GRN, status: "submitted" }], []];
      }
      return [[], []];
    });
    await expect(
      grnService.submitForApproval("grn-1", {} as any, "user-1", "branch_admin")
    ).rejects.toThrow(/cannot submit/i);
    expect(eventsFrom(execute.mock.calls)).toHaveLength(0);
  });
});

describe("cancelling a GRN", () => {
  it("records the cancellation inside the same transaction as the status change", async () => {
    // cancelGrn reads the row FOR UPDATE on the same connection it writes on, so the row has
    // to come back from the connection mock, not the pool.
    const connectionExecute = vi.fn(async (sql: string) => {
      if (/UPDATE grn_request/i.test(String(sql))) return [{ affectedRows: 1 } as any, []];
      if (/FROM grn_request/i.test(String(sql))) return [[{ ...DRAFT_GRN, status: "submitted" }], []];
      return [[], []];
    });
    const connection = {
      execute: connectionExecute,
      beginTransaction: vi.fn(async () => {}), commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}), release: vi.fn(() => {}),
    };
    getConnection.mockResolvedValue(connection);
    execute.mockImplementation(async (sql: string) => {
      if (/FROM grn_request/i.test(String(sql)) && /SELECT/i.test(String(sql))) {
        return [[{ ...DRAFT_GRN, status: "submitted" }], []];
      }
      return [[], []];
    });

    await grnService.cancelGrn("grn-1", "user-1", "branch_admin");

    const events = eventsFrom(connectionExecute.mock.calls);
    expect(events, "an event on the pool could outlive a rolled-back cancellation").toHaveLength(1);
    expect(events[0]).toMatchObject({
      entityType: "grn", action: "cancel", fromStatus: "submitted", toStatus: "cancelled",
    });
    // Inside the transaction means before the commit, not merely on the same connection.
    const eventIdx = connectionExecute.mock.calls
      .findIndex(([sql]) => /INSERT INTO finance_approval_event/i.test(String(sql)));
    expect(connectionExecute.mock.invocationCallOrder[eventIdx])
      .toBeLessThan(connection.commit.mock.invocationCallOrder[0]);
  });
});

describe("raising a GRN", () => {
  // createDraft's happy path needs the whole budget-line/vendor/cost-centre chain mocked, so
  // these assert the call is present and correctly shaped at both creation sites rather than
  // rebuilding that fixture. The behaviour of the writer itself is covered above.
  const service = read("grn.service.ts");

  it("records the budgeted draft, naming the budget line it was raised against", () => {
    const idx = service.indexOf('await writeGrnAudit("CREATE_DRAFT", id');
    expect(idx).toBeGreaterThan(-1);
    const preceding = service.slice(Math.max(0, idx - 700), idx);
    expect(preceding).toContain("recordFinanceApprovalEvent");
    expect(preceding).toContain('action: "create"');
    expect(preceding).toContain('toStatus: "draft"');
    expect(preceding).toContain("budgetLineId: budgetLine.id");
  });

  it("records the unbudgeted draft too, flagged as the path that bypasses the budget", () => {
    const idx = service.indexOf('await writeGrnAudit("CREATE_DRAFT_UNBUDGETED", id');
    expect(idx).toBeGreaterThan(-1);
    const preceding = service.slice(Math.max(0, idx - 700), idx);
    expect(preceding).toContain("recordFinanceApprovalEvent");
    expect(preceding).toContain("unbudgeted: true");
  });

  it("keeps both sinks — the security log is not replaced by the workflow trail", () => {
    // Deleting writeGrnAudit in favour of the new events would drop FINANCE telemetry that
    // production already relies on (GRN_CREATE_DRAFT, GRN_SUBMIT, GRN_CANCEL all have live rows).
    for (const action of ["CREATE_DRAFT", "CREATE_DRAFT_UNBUDGETED", "SUBMIT", "CANCEL"]) {
      expect(service).toContain(`writeGrnAudit("${action}"`);
    }
  });
});

describe("every GRN lifecycle transition has a workflow event", () => {
  it("names each action exactly once in the service that owns it", () => {
    const service = read("grn.service.ts");
    // The full chain a reader of /approval-history should be able to reconstruct.
    for (const action of ["create", "submit", "cancel", "return", "resubmit", "reverse"]) {
      expect(service, `no workflow event is written for '${action}'`)
        .toContain(`action: "${action}"`);
    }
    // approve/reject are written from one conditional expression rather than a literal.
    expect(service).toContain('action: payload.decision === "approved" ? "approve" : "reject"');
  });

  it("still exposes the trail through the branch-guarded read endpoint", () => {
    const routes = read("grn.routes.ts");
    expect(routes).toContain('"/grns/:id/approval-history"');
    expect(routes).toContain('listFinanceApprovalEvents("grn"');
    // A UUID is not an access control: the history carries rejection reasons and reviewer notes.
    const idx = routes.indexOf('"/grns/:id/approval-history"');
    expect(routes.slice(idx, idx + 500)).toContain("authorizeGrnBranch");
  });
});
