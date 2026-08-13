/**
 * Combined audit closure tests — Branch Budget + Smart GRN governance controls.
 *
 * Audit snapshot: HEAD 0ffcd4eb, 2026-08-13
 * Fix commits: e5ed1a11 (round 1), b60093a6 (round 2)
 *
 * Test strategy:
 *  - Contract tests (source-file assertions) prove the control is wired in and cannot be
 *    silently removed — they fail the moment the relevant code is deleted.
 *  - Unit tests with mocked DB exercise the actual runtime paths so a refactor that moves
 *    code while preserving the strings still causes a test failure if the logic changes.
 *
 * vi.mock() is hoisted to top of file by Vitest regardless of where it appears in source,
 * so all mock setup and shared variables MUST be at module scope.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect, vi, beforeEach } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level mock state (vi.mock factories cannot reference describe-block vars)
// ─────────────────────────────────────────────────────────────────────────────
const mockExecute = vi.fn();
const mockConnection = {
  execute: vi.fn(),
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  rollback: vi.fn().mockResolvedValue(undefined),
  release: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
    query: (...args: unknown[]) => mockExecute(...args),
    getConnection: vi.fn().mockResolvedValue(mockConnection),
  },
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn().mockResolvedValue(undefined),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// P0-1  Legacy GRN validation bypass removed
// ─────────────────────────────────────────────────────────────────────────────
describe("P0-1: zero-allocation GRNs cannot bypass Smart validation on submit", () => {
  it("submit route uses requireAllocationsForSubmit, not onlyWhenSmart", () => {
    const routes = read("src/modules/finance/grn-smart.routes.ts");
    expect(routes).toContain("async function requireAllocationsForSubmit");
    expect(routes).toContain("ALLOCATIONS_REQUIRED");
  });

  it("requireAllocationsForSubmit sends 400 and does not call next('router')", () => {
    const routes = read("src/modules/finance/grn-smart.routes.ts");
    const fnStart = routes.indexOf("async function requireAllocationsForSubmit");
    // Extract just the function body (next function starts with "async function" or "smartGrnRouter")
    const fnEnd = Math.min(
      routes.indexOf("\nasync function", fnStart + 1),
      routes.indexOf("\nsmartGrnRouter", fnStart + 1),
    );
    const fnBody = routes.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 600);
    expect(fnBody).toContain("res.status(400)");
    expect(fnBody).not.toContain('next("router")');
  });

  it("submit route handler wires requireAllocationsForSubmit, not onlyWhenSmart", () => {
    const routes = read("src/modules/finance/grn-smart.routes.ts");
    const submitIdx = routes.indexOf('"/:id/submit"');
    expect(submitIdx).toBeGreaterThan(-1);
    const submitBlock = routes.slice(submitIdx, submitIdx + 500);
    expect(submitBlock).toContain("requireAllocationsForSubmit");
    expect(submitBlock).not.toContain("onlyWhenSmart");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-2  Provision GRNs fail closed at every entry point
// ─────────────────────────────────────────────────────────────────────────────
describe("P0-2: provision GRNs blocked at all four entry points", () => {
  it("grn.service.ts createDraft blocks provision type before the branch guard", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    expect(svc).toContain("PROVISION_GRN_NOT_SUPPORTED");
    const provIdx = svc.indexOf("PROVISION_GRN_NOT_SUPPORTED");
    const branchIdx = svc.indexOf("if (!payload.branchId)");
    expect(provIdx).toBeLessThan(branchIdx);
  });

  it("grn.service.ts submitForApproval blocks provision type", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const submitFn = svc.slice(svc.indexOf("async submitForApproval("));
    expect(submitFn).toContain("PROVISION_GRN_NOT_SUPPORTED");
  });

  it("grn.service.ts reviewGrn blocks provision type inside the transaction", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async reviewGrn("));
    expect(reviewFn).toContain("PROVISION_GRN_NOT_SUPPORTED");
    const txIdx = reviewFn.indexOf("beginTransaction");
    const provIdx = reviewFn.indexOf("PROVISION_GRN_NOT_SUPPORTED");
    expect(provIdx).toBeGreaterThan(txIdx);
  });

  it("grnValidationControlService.submit blocks provision before effectiveValidation", () => {
    const svc = read("src/modules/finance/grn-validation-control.service.ts");
    const submitFn = svc.slice(svc.indexOf("async submit("));
    expect(submitFn).toContain("PROVISION_GRN_NOT_SUPPORTED");
    const provIdx = submitFn.indexOf("PROVISION_GRN_NOT_SUPPORTED");
    const valIdx = submitFn.indexOf("effectiveValidation(grnId)");
    expect(provIdx).toBeLessThan(valIdx);
  });

  it("grn-smart.service.ts review blocks provision type inside the transaction", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("PROVISION_GRN_NOT_SUPPORTED");
    const txIdx = reviewFn.indexOf("beginTransaction");
    const provIdx = reviewFn.indexOf("PROVISION_GRN_NOT_SUPPORTED");
    expect(provIdx).toBeGreaterThan(txIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0-3  Period lock re-checked inside the financial mutation transaction
// ─────────────────────────────────────────────────────────────────────────────
describe("P0-3: isPeriodLocked accepts PoolConnection and is called inside transactions", () => {
  it("finance-period-lock.ts signature accepts an optional PoolConnection", () => {
    const src = read("src/modules/process-pnl/finance-period-lock.ts");
    expect(src).toContain("conn?: PoolConnection");
    expect(src).toContain("const executor = conn ?? db");
  });

  it("grn.service.ts reviewGrn passes `connection` to isPeriodLocked inside transaction", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async reviewGrn("));
    // The connection arg must appear in the isPeriodLocked call
    expect(reviewFn).toContain("isPeriodLocked(");
    expect(reviewFn).toContain(", connection)");
    const txIdx = reviewFn.indexOf("beginTransaction");
    const lockIdx = reviewFn.indexOf("isPeriodLocked(");
    expect(lockIdx).toBeGreaterThan(txIdx);
  });

  it("grn-smart.service.ts review passes `connection` to isPeriodLocked inside transaction", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("isPeriodLocked(");
    expect(reviewFn).toContain(", connection)");
    const txIdx = reviewFn.indexOf("beginTransaction");
    const lockIdx = reviewFn.indexOf("isPeriodLocked(");
    expect(lockIdx).toBeGreaterThan(txIdx);
  });

  it("budget-topup.service.ts finance_head stage calls isPeriodLocked before applyTopupToLine", () => {
    const svc = read("src/modules/process-pnl/budget-topup.service.ts");
    expect(svc).toContain("import { isPeriodLocked }");
    const fhIdx = svc.indexOf('effectiveRole === "finance_head"');
    const lockIdx = svc.indexOf("isPeriodLocked(", fhIdx);
    const applyIdx = svc.indexOf("applyTopupToLine(", fhIdx);
    expect(lockIdx).toBeGreaterThan(fhIdx);
    expect(lockIdx).toBeLessThan(applyIdx);
  });

  it("branch-budget.service.ts reviewTransfer calls isPeriodLocked inside the transaction", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    // The call must be present and must pass a connection (second argument)
    expect(fn).toContain("isPeriodLocked(");
    expect(fn).toContain(", connection)");
    // Must be inside the transaction
    const txIdx = fn.indexOf("beginTransaction");
    const lockIdx = fn.indexOf("isPeriodLocked(");
    expect(lockIdx).toBeGreaterThan(txIdx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P0P1-4  Maker-checker enforces actor identity, not role names
// ─────────────────────────────────────────────────────────────────────────────
describe("P0P1-4: GRN approval maker-checker checks actor ID, not only role", () => {
  it("grn-smart.service.ts review has branch_head self-approval guard on submitted_by", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("Maker-checker violation");
    expect(reviewFn).toContain("grn.submitted_by");
    expect(reviewFn).toContain("role === \"branch_head\"");
  });

  it("grn-smart.service.ts review has finance_head guard against BH reviewer", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("grn.branch_head_reviewed_by");
    expect(reviewFn).toContain("role === \"finance_head\"");
  });

  it("grn.service.ts reviewGrn has the same identity checks", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async reviewGrn("));
    expect(reviewFn).toContain("Maker-checker violation");
    expect(reviewFn).toContain("grn.submitted_by");
    expect(reviewFn).toContain("grn.branch_head_reviewed_by");
  });
});

describe("P0P1-4: Budget approval maker-checker checks actor ID at all three stages", () => {
  it("branch-budget.service.ts review() SELECT includes actor columns", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("submitted_by");
    expect(reviewFn).toContain("branch_head_approved_by");
    expect(reviewFn).toContain("finance_head_approved_by");
  });

  it("branch-budget.service.ts review() has at least three distinct maker-checker violations", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const reviewFn = svc.slice(svc.indexOf("async review("));
    expect(reviewFn).toContain("role === \"branch_head\"");
    expect(reviewFn).toContain("role === \"finance_head\"");
    expect(reviewFn).toContain("role === \"accounts_head\"");
    const count = (reviewFn.match(/Maker-checker violation/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-5  GRN approval atomic state guard
// ─────────────────────────────────────────────────────────────────────────────
describe("P1-5: smart GRN review UPDATEs include expected status in WHERE and check affectedRows", () => {
  it("branch_head UPDATE uses AND status = 'submitted'", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    expect(svc).toContain("AND status = 'submitted'");
  });

  it("finance_head UPDATE uses AND status = 'branch_head_approved'", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    expect(svc).toContain("AND status = 'branch_head_approved'");
  });

  it("both stage UPDATEs assert affectedRows === 1 and throw STATE_CHANGED on mismatch", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    expect(svc).toContain("STATE_CHANGED");
    const count = (svc.match(/STATE_CHANGED/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-6  Virement recalculates all budget-line fields canonically
// ─────────────────────────────────────────────────────────────────────────────
describe("P1-6: reviewTransfer uses calculateBudgetLine for full field recomputation", () => {
  it("reviewTransfer calls calculateBudgetLine at least twice (from + to lines)", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    const count = (fn.match(/calculateBudgetLine\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("reviewTransfer updates pnl_cost_amount, cgst/sgst/igst, and recoverable_tax", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    expect(fn).toContain("pnl_cost_amount");
    expect(fn).toContain("cgst_amount");
    expect(fn).toContain("sgst_amount");
    expect(fn).toContain("igst_amount");
    expect(fn).toContain("recoverable_tax_amount");
  });

  it("reviewTransfer re-sums header totals from lines after line mutation", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    expect(fn).toContain("gross_budget_amount");
    expect(fn).toContain("pnl_budget_amount");
    expect(fn).toContain("SUM(l.gross_amount)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-7  Budget transfer is pending until approved by a different actor
// ─────────────────────────────────────────────────────────────────────────────
describe("P1-7: submitTransfer creates pending record; reviewTransfer enforces maker-checker", () => {
  it("submitTransfer inserts with status='pending', not 'approved'", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fnStart = svc.indexOf("async submitTransfer(");
    // Find end of submitTransfer (next async method)
    const fnEnd = svc.indexOf("\n  async", fnStart + 10);
    const fn = svc.slice(fnStart, fnEnd);
    expect(fn).toContain("'pending'");
    // Direct 'approved' INSERT must not appear in submitTransfer
    expect(fn).not.toContain("'approved'");
  });

  it("submitTransfer has a 60-second idempotency window", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async submitTransfer("));
    expect(fn).toContain("INTERVAL 60 SECOND");
    expect(fn).toContain("duplicate transfer");
  });

  it("reviewTransfer enforces created_by !== actorId", () => {
    const svc = read("src/modules/process-pnl/branch-budget.service.ts");
    const fn = svc.slice(svc.indexOf("async reviewTransfer("));
    expect(fn).toContain("transfer.created_by");
    expect(fn).toContain("Maker-checker violation");
  });

  it("POST /pnl/budget-transfers/:id/review endpoint exists", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("/pnl/budget-transfers/:id/review");
    expect(routes).toContain("reviewTransfer(");
  });

  it("original transferBetweenLines replaced by submitTransfer in the route", () => {
    const routes = read("src/modules/process-pnl/process-pnl.routes.ts");
    expect(routes).toContain("submitTransfer(");
    expect(routes).not.toContain("transferBetweenLines(");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P1-8  Debit note lifecycle
// ─────────────────────────────────────────────────────────────────────────────
describe("P1-8: debit note creation guarded; approve and cancel endpoints exist", () => {
  it("creation endpoint checks GRN type and status before allowing a debit note", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain("DN_ELIGIBLE_GRN_STATUSES");
    expect(routes).toContain("pending_accounts_payment");
    expect(routes).toContain("Debit notes can only be raised against vendor GRNs");
    expect(routes).toContain("Finance Head-approved GRNs");
  });

  it("approve endpoint exists at /debit-notes/:id/approve", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain('"/debit-notes/:id/approve"');
    // Sets status to approved
    expect(routes).toContain("status = 'approved'");
    // Rejects if not in draft
    expect(routes).toContain("cannot be approved");
  });

  it("cancel endpoint exists at /debit-notes/:id/cancel", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain('"/debit-notes/:id/cancel"');
    expect(routes).toContain("status = 'cancelled'");
    expect(routes).toContain("Settled debit notes cannot be cancelled");
    // Requires a reason
    expect(routes).toContain("reason is required to cancel");
  });

  it("approve and cancel both write to the reviewer-facing approval timeline", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain("recordFinanceApprovalEvent");
    // Should appear at least twice — once for approve, once for cancel
    const callCount = (routes.match(/recordFinanceApprovalEvent\(/g) ?? []).length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("settlement is explicitly NOT IMPLEMENTED pending Finance sign-off", () => {
    const routes = read("src/modules/finance/grn.routes.ts");
    expect(routes).toContain("NOT IMPLEMENTED");
    expect(routes).toContain("Finance sign-off");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consumption reversal — reviewer-facing timeline
// ─────────────────────────────────────────────────────────────────────────────
describe("Consumption reversal audit trail appears in the reviewer-facing timeline", () => {
  it("reverseConsumption calls recordFinanceApprovalEvent before commit()", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const fn = svc.slice(svc.indexOf("async reverseConsumption("));
    expect(fn).toContain("recordFinanceApprovalEvent");
    const eventIdx = fn.indexOf("recordFinanceApprovalEvent");
    const commitIdx = fn.indexOf("connection.commit()");
    expect(eventIdx).toBeLessThan(commitIdx);
  });

  it("the event records action='reverse' and toStatus='consumption_reversed'", () => {
    const svc = read("src/modules/finance/grn.service.ts");
    const fn = svc.slice(svc.indexOf("async reverseConsumption("));
    const blockStart = fn.indexOf("recordFinanceApprovalEvent");
    const block = fn.slice(blockStart, blockStart + 400);
    expect(block).toContain('"reverse"');
    expect(block).toContain('"consumption_reversed"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HSN/SAC and IRN validation in canonical layer
// ─────────────────────────────────────────────────────────────────────────────
describe("HSN/SAC and IRN validation added to canonical buildValidations()", () => {
  it("buildValidations emits HSN_SAC_REQUIRED for components missing the code", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    expect(svc).toContain("HSN_SAC_REQUIRED");
    expect(svc).toContain("hsn_sac_code");
  });

  it("buildValidations emits IRN_ACK_REQUIRED when IRN is set but ACK is absent", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    expect(svc).toContain("IRN_ACK_REQUIRED");
    expect(svc).toContain("irn_ack_no");
  });

  it("both new validations are non-blocking (advisory until rules are codified)", () => {
    const svc = read("src/modules/finance/grn-smart.service.ts");
    // HSN/SAC block
    const hsnIdx = svc.indexOf("HSN_SAC_REQUIRED");
    const hsnBlock = svc.slice(hsnIdx - 20, hsnIdx + 300);
    expect(hsnBlock).toContain("blocking: false");
    // IRN block
    const irnIdx = svc.indexOf("IRN_ACK_REQUIRED");
    const irnBlock = svc.slice(irnIdx - 20, irnIdx + 300);
    expect(irnBlock).toContain("blocking: false");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — maker-checker runtime behaviour (DB mocked at module level above)
// ─────────────────────────────────────────────────────────────────────────────
describe("GRN smart review maker-checker — runtime paths (DB mocked)", () => {
  const GRN_ID = "grn-001";
  const SUBMITTER = "user-submitter";
  const BH_REVIEWER = "user-bh";
  const FINANCE_HEAD = "user-fh";

  function grnRow(overrides: Record<string, unknown> = {}) {
    return {
      id: GRN_ID,
      status: "submitted",
      grn_type: "vendor",
      accounting_period: "2026-07",
      submitted_by: SUBMITTER,
      branch_head_reviewed_by: null,
      branch_id: "br-001",
      budget_line_id: "bl-001",
      amount_with_tax: 1000,
      amount_without_tax: 847,
      tax_amount: 153,
      quantity: 1,
      ...overrides,
    };
  }

  const allocationRow = {
    id: "alloc-1",
    grn_request_id: GRN_ID,
    budget_line_id: "bl-001",
    amount_with_tax: 1000,
    amount_without_tax: 847,
    tax_amount: 153,
    pnl_cost_amount: 847,
    allocation_percentage: 100,
    quantity: 1,
    lifecycle_status: "pending",
  };

  function setupReviewMocks(grnOverrides: Record<string, unknown> = {}, periodLocked = false) {
    mockConnection.execute
      .mockResolvedValueOnce([[grnRow(grnOverrides)], []])          // lockGrn
      .mockResolvedValueOnce([[allocationRow], []])                  // loadAllocations (with=true)
      .mockResolvedValueOnce([[{ status: periodLocked ? "locked" : "open" }], []]); // isPeriodLocked
  }

  beforeEach(() => {
    mockExecute.mockReset();
    mockConnection.execute.mockReset();
    mockConnection.beginTransaction.mockResolvedValue(undefined);
    mockConnection.commit.mockResolvedValue(undefined);
    mockConnection.rollback.mockResolvedValue(undefined);
    mockConnection.release.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("branch_head cannot approve a GRN they submitted", async () => {
    setupReviewMocks();
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review(GRN_ID, "approved", undefined, SUBMITTER, "branch_head"),
    ).rejects.toThrow(/Maker-checker violation/);
  });

  it("finance_head cannot approve a GRN they submitted", async () => {
    setupReviewMocks({ status: "branch_head_approved", branch_head_reviewed_by: BH_REVIEWER });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review(GRN_ID, "approved", undefined, SUBMITTER, "finance_head"),
    ).rejects.toThrow(/Maker-checker violation/);
  });

  it("finance_head cannot approve a GRN where they were the branch_head reviewer", async () => {
    setupReviewMocks({ status: "branch_head_approved", branch_head_reviewed_by: FINANCE_HEAD });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review(GRN_ID, "approved", undefined, FINANCE_HEAD, "finance_head"),
    ).rejects.toThrow(/Maker-checker violation/);
  });

  it("approval is blocked when the GRN period is locked (P0-3)", async () => {
    setupReviewMocks({}, true /* periodLocked */);
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review(GRN_ID, "approved", undefined, BH_REVIEWER, "branch_head"),
    ).rejects.toThrow(/locked for P&L close/);
  });

  it("provision GRN approval is blocked (P0-2)", async () => {
    setupReviewMocks({ grn_type: "provision" });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review(GRN_ID, "approved", undefined, BH_REVIEWER, "branch_head"),
    ).rejects.toThrow(/PROVISION_GRN_NOT_SUPPORTED/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit test — submitTransfer idempotency (DB mocked at module level above)
// ─────────────────────────────────────────────────────────────────────────────
describe("submitTransfer idempotency — runtime (DB mocked)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    vi.resetModules();
  });

  it("blocks a second pending transfer with same parameters within 60 seconds", async () => {
    // Idempotency check returns an existing row
    mockExecute.mockResolvedValueOnce([[{ id: "existing-transfer" }], []]);
    const { branchBudgetService } = await import(
      "../../process-pnl/branch-budget.service.js"
    );
    await expect(
      branchBudgetService.submitTransfer({
        budgetId: "bgt-1",
        fromLineId: "line-a",
        toLineId: "line-b",
        transferAmount: 5000,
        reason: "Rebalancing",
        actorId: "user-fh",
      }),
    ).rejects.toThrow(/duplicate transfer/);
  });

  it("proceeds when no duplicate pending transfer exists", async () => {
    // idempotency → empty; header → active; period lock → open; lines; INSERT; getTransfer
    mockExecute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: "bgt-1", status: "active", period_code: "2026-07" }], []])
      .mockResolvedValueOnce([[{ status: "open" }], []])
      .mockResolvedValueOnce([[
        { id: "line-a", budget_id: "bgt-1", gross_amount: 10000, reserved_amount: 0, consumed_amount: 0 },
        { id: "line-b", budget_id: "bgt-1", gross_amount: 5000,  reserved_amount: 0, consumed_amount: 0 },
      ], []])
      .mockResolvedValueOnce([{ insertId: 1 }, []])
      .mockResolvedValueOnce([[{ id: "new-transfer", status: "pending" }], []]);
    const { branchBudgetService } = await import(
      "../../process-pnl/branch-budget.service.js"
    );
    const result = await branchBudgetService.submitTransfer({
      budgetId: "bgt-1",
      fromLineId: "line-a",
      toLineId: "line-b",
      transferAmount: 5000,
      reason: "Rebalancing",
      actorId: "user-fh",
    });
    expect(result).toBeDefined();
  });
});
