import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The GRN lifecycle, gate by gate, driven for real against a faked DB.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The GRN suite is strong on two things — the money maths of the branch-wide headroom gate
 * (grn-branch-headroom-gate.test.ts, grn-component-branch-headroom-gate.test.ts) and the
 * return-for-correction flow — and thin on the rest of the lifecycle, where most of the coverage
 * is source-text assertions. A source assertion proves a line of code is present. It cannot prove
 * that submitting a GRN with a failing blocking validation is actually refused, that a Branch
 * Head cannot approve their own submission, or that a Finance Head approval of a vendor GRN
 * really creates a payable. Those are the rules Finance relies on, and they were untested as
 * BEHAVIOUR.
 *
 * So this file drives grnValidationControlService.submit() and grnSmartService.review()/cancel()/
 * reopen() end to end. The services, their guards, the validation engine and the type gate all run
 * for real; only the DB layer and the four side-effect modules (payables, imprest ledger, audit,
 * approval events) are faked, and each fake records what it was asked to do so the test can assert
 * the effect rather than the call.
 *
 * WHAT IS DELIBERATELY NOT COVERED HERE, so nobody reads this as more than it is:
 *   - the money split itself — the two headroom files above own that, behaviourally.
 *   - document upload/extraction and the AI path, which need a filesystem and a model.
 *   - route-level RBAC (requireRole), which is middleware and is exercised by the route tests.
 *   - the legacy grnService.reviewGrn path, which router shadowing makes unreachable for any GRN
 *     with saved allocations — see grn-number-on-submit.ts's banner.
 */

const { stateRef, sideEffects } = vi.hoisted(() => ({
  stateRef: { current: null as any },
  sideEffects: {
    payablesCreatedFor: [] as string[],
    imprestDebits: [] as Array<{ grnId: string; amount: number }>,
    imprestBalanceChecks: [] as Array<{ managerId: string; amount: number }>,
    reserved: [] as Array<{ lineId: string; amount: number }>,
    consumed: [] as Array<{ lineId: string; amount: number }>,
    released: [] as Array<{ lineId: string; amount: number }>,
    auditActions: [] as string[],
    approvalEvents: [] as Array<{ action: string; fromStatus: string; toStatus: string; actorRole: string }>,
  },
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: (...args: unknown[]) => stateRef.current.route(...(args as [string, unknown[]?])),
    getConnection: async () => stateRef.current.connection,
  },
}));

vi.mock("../../../shared/financeApprovalEvent.js", () => ({
  recordFinanceApprovalEvent: vi.fn(async (event: any) => {
    sideEffects.approvalEvents.push({
      action: String(event.action),
      fromStatus: String(event.fromStatus),
      toStatus: String(event.toStatus),
      actorRole: String(event.actorRole),
    });
  }),
  listFinanceApprovalEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: vi.fn(async (entry: any) => {
    sideEffects.auditActions.push(String(entry.action_type));
  }),
}));

vi.mock("../../process-pnl/budget-consumption.service.js", () => ({
  budgetConsumptionService: {
    reserve: vi.fn(async (_c: unknown, lineId: string, amount: number) => {
      sideEffects.reserved.push({ lineId, amount });
    }),
    consume: vi.fn(async (_c: unknown, lineId: string, amount: number) => {
      sideEffects.consumed.push({ lineId, amount });
    }),
    release: vi.fn(async (_c: unknown, lineId: string, amount: number) => {
      sideEffects.released.push({ lineId, amount });
    }),
    reverseConsumption: vi.fn().mockResolvedValue(undefined),
  },
  lockActiveBudgetLine: vi.fn().mockResolvedValue({ id: "line-A" }),
}));

vi.mock("../vendor-payment.service.js", () => ({
  vendorPaymentService: {
    createFromGrn: vi.fn(async (grnId: string) => {
      sideEffects.payablesCreatedFor.push(grnId);
      return `pay-${grnId}`;
    }),
    notifyPaymentPending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../imprest-ledger.service.js", () => ({
  imprestLedgerService: {
    assertSufficientBalance: vi.fn(async (managerId: string, amount: number) => {
      sideEffects.imprestBalanceChecks.push({ managerId, amount });
      if (stateRef.current?.floatShort) {
        throw Object.assign(new Error("Imprest float is short"), { statusCode: 409, code: "IMPREST_FLOAT_SHORT" });
      }
    }),
    post: vi.fn(async (entry: any) => {
      sideEffects.imprestDebits.push({ grnId: String(entry.referenceId), amount: Number(entry.amount) });
      return "ledger-1";
    }),
  },
}));

const periodLocked = vi.fn().mockResolvedValue(false);
vi.mock("../../process-pnl/finance-period-lock.js", () => ({
  isPeriodLocked: (...args: unknown[]) => periodLocked(...args),
}));

vi.mock("../grn-number.service.js", () => ({
  allocateGrnNumber: vi.fn().mockResolvedValue("GRN/BR1/2026-27/0007"),
}));
vi.mock("../grn-number-monthly.service.js", () => ({
  allocateMonthlyGrnNumber: vi.fn().mockResolvedValue("GRN/202608/0007"),
  resolveGrnNumberFormat: vi.fn().mockResolvedValue("legacy_branch_fy"),
  resolveAccountingPeriod: vi.fn(() => "2026-08"),
}));

// ── the fake database ────────────────────────────────────────────────────────

type Validation = { code: string; status: string; blocking: 0 | 1; message?: string };

function makeState(opts: {
  grn: Record<string, unknown>;
  allocations?: Array<Record<string, unknown>>;
  /** Rows buildValidations would have produced. Injected directly, because what this file tests
   *  is what SUBMIT and REVIEW do about a blocking validation, not how one comes to exist —
   *  grn-invoice-components / grn-lob-attribution own that. */
  validations?: Validation[];
  overrides?: Array<{ validation_code: string; override_reason: string; approved_by: string }>;
  imprestManagers?: Array<{ id: string }>;
  floatShort?: boolean;
}) {
  const grn = { ...opts.grn };
  const allocations = opts.allocations ?? [
    {
      id: "alloc-1", grn_request_id: grn.id, budget_id: "hdr-1", budget_line_id: "line-A",
      cost_centre_id: "cc-A", funding_cost_centre_id: "cc-A", amount_with_tax: 1000,
      amount_without_tax: 1000, quantity: 1, lifecycle_status: "draft", is_unbudgeted: 0,
      process_id: null, cost_centre_name: "CC A",
    },
  ];
  let validations: Validation[] = [...(opts.validations ?? [])];
  const statusHistory: string[] = [];

  async function route(sql: string, params: unknown[] = []) {
    const s = sql.trim().replace(/\s+/g, " ");

    // A SELECT returns a SNAPSHOT. Handing back the live object let a later UPDATE mutate the row
    // the service had already read, so `fromStatus` on the approval event read as the status the
    // GRN was moving TO. The real DB cannot do that, and neither should the fake.
    if (s.includes("FROM grn_request WHERE id = ? FOR UPDATE") || s.startsWith("SELECT * FROM grn_request WHERE id = ?")) {
      return [[{ ...grn }], []];
    }
    if (s.includes("SELECT grn_type, grn_number, branch_id, accounting_period, financial_year")) {
      return [[{ ...grn }], []];
    }
    if (s.includes("SELECT id, status FROM grn_request")) {
      return [[{ id: grn.id, status: grn.status }], []];
    }
    if (s.includes("FROM grn_cost_allocation a")) {
      return [allocations, []];
    }
    if (s.includes("FROM grn_validation_result")) {
      return [validations.map((v) => ({ ...v, is_blocking: v.blocking, validation_code: v.code, validation_status: v.status })), []];
    }
    if (s.includes("FROM grn_validation_override")) {
      return [opts.overrides ?? [], []];
    }
    if (s.startsWith("UPDATE grn_validation_result")) {
      const code = String(params[params.length - 1]);
      validations = validations.map((v) => (v.code === code ? { ...v, status: "overridden", blocking: 0 } : v));
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("DELETE FROM grn_validation_result")) {
      // revalidate() rebuilds the set. The injected rows are the fixture's whole point, so they
      // survive the rebuild — otherwise every test would be asserting an empty validation set.
      return [{ affectedRows: 0 }, []];
    }
    if (s.startsWith("INSERT INTO grn_validation_result")) {
      return [{ affectedRows: 1 }, []];
    }
    if (s.includes("FROM imprest_manager")) {
      return [opts.imprestManagers ?? [], []];
    }
    if (s.startsWith("UPDATE grn_request")) {
      // Every status UPDATE in the service carries its expected current status in the WHERE, which
      // is the concurrency guard. Honour it, so a test can prove the 409 path.
      const expected = /status = '([a-z_]+)'\s*$/.exec(s.replace(/`/g, ""))?.[1]
        ?? (s.includes("status IN ('rejected','returned_to_raiser','returned_to_branch_head')")
          ? String(grn.status)
          : null);
      const expectedFromParam = s.includes("AND status = ?") ? String(params[params.length - 1]) : null;
      const guard = expectedFromParam ?? expected;
      if (guard && guard !== String(grn.status) && !s.includes("status IN (")) {
        return [{ affectedRows: 0 }, []];
      }
      const next = /SET status = '([a-z_]+)'/.exec(s)?.[1] ?? (params[0] as string);
      if (typeof next === "string" && /^[a-z_]+$/.test(next)) {
        grn.status = next;
        statusHistory.push(next);
      }
      return [{ affectedRows: 1 }, []];
    }
    if (s.startsWith("UPDATE grn_cost_allocation")) return [{ affectedRows: allocations.length }, []];
    if (s.startsWith("INSERT INTO sensitive_action_log")) return [{ insertId: 1 }, []];
    if (s.startsWith("INSERT") || s.startsWith("DELETE") || s.startsWith("UPDATE")) return [{ affectedRows: 1 }, []];
    if (s.startsWith("SELECT")) return [[], []];
    throw new Error(`Unhandled SQL in fake DB router: ${s.slice(0, 160)}`);
  }

  const connection = {
    execute: (...args: [string, unknown[]?]) => route(...args),
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };

  return { route, connection, grn, statusHistory, floatShort: opts.floatShort ?? false };
}

function baseGrn(overrides: Record<string, unknown> = {}) {
  return {
    id: "grn-1",
    grn_number: null,
    grn_type: "vendor",
    status: "draft",
    branch_id: "br-1",
    accounting_period: "2026-08",
    financial_year: "2026-27",
    recognition_start_period: null,
    bill_date: "2026-08-05",
    amount_with_tax: 1000,
    amount: 1000,
    submitted_by: null,
    branch_head_reviewed_by: null,
    is_unbudgeted: 0,
    imprest_manager_id: null,
    description: "Test GRN",
    ...overrides,
  };
}

/** An allocation that is actually holding budget. releaseAllocations() skips any row whose
 *  lifecycle_status is not 'reserved', which is the guard that stops a cancel from releasing
 *  money that was never taken — see the test that pins it below. */
function reservedAllocation() {
  return {
    id: "alloc-1", grn_request_id: "grn-1", budget_id: "hdr-1", budget_line_id: "line-A",
    cost_centre_id: "cc-A", funding_cost_centre_id: "cc-A", amount_with_tax: 1000,
    amount_without_tax: 1000, quantity: 1, lifecycle_status: "reserved", is_unbudgeted: 0,
    process_id: null, cost_centre_name: "CC A",
  };
}

const PASSING: Validation[] = [{ code: "DOCUMENT_REQUIRED", status: "passed", blocking: 0 }];
const BLOCKED: Validation[] = [
  { code: "DOCUMENT_REQUIRED", status: "failed", blocking: 1, message: "At least one invoice or supporting proof is mandatory" },
];

beforeEach(() => {
  vi.clearAllMocks();
  periodLocked.mockResolvedValue(false);
  for (const key of Object.keys(sideEffects) as Array<keyof typeof sideEffects>) {
    (sideEffects[key] as unknown[]).length = 0;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GRN type gate — a type with no accounting lifecycle fails closed", () => {
  for (const [type, action] of [["provision", "Submission"], ["salary", "Submission"]] as const) {
    it(`${type} cannot be submitted`, async () => {
      stateRef.current = makeState({ grn: baseGrn({ grn_type: type }), validations: PASSING });
      const { grnValidationControlService } = await import("../grn-validation-control.service.js");
      await expect(
        grnValidationControlService.submit("grn-1", "u1", "branch_admin")
      ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_SUPPORTED/) });
      expect(action).toBe("Submission");
    });
  }

  it("salary cannot be approved either — it used to fall through and become 'approved' with nothing posted", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ grn_type: "salary", status: "branch_head_approved", branch_head_reviewed_by: "u-bh" }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head")
    ).rejects.toMatchObject({ code: "SALARY_GRN_NOT_SUPPORTED" });
    expect(sideEffects.payablesCreatedFor).toHaveLength(0);
    expect(sideEffects.consumed).toHaveLength(0);
  });

  it("vendor and imprest are unaffected", async () => {
    stateRef.current = makeState({ grn: baseGrn({ grn_type: "vendor" }), validations: PASSING });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    const result = await grnValidationControlService.submit("grn-1", "u1", "branch_admin");
    expect(result.newStatus).toBe("submitted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Submit gate", () => {
  it("refuses while a blocking validation is failing, and names it", async () => {
    stateRef.current = makeState({ grn: baseGrn(), validations: BLOCKED });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.submit("grn-1", "u1", "branch_admin")
    ).rejects.toThrow(/supporting proof is mandatory/);
    expect(stateRef.current.grn.status).toBe("draft");
  });

  it("does NOT allocate a GRN number — that now happens at Finance Head approval", async () => {
    // Owner ruling: a number identifies approved spend, not merely raised spend. Submitting
    // used to allocate one (2026-08-27 fix); it no longer does, on the same request/response
    // shape as before so callers keying off result.grnNumber still get a sensible (null) value.
    stateRef.current = makeState({ grn: baseGrn(), validations: PASSING });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    const result = await grnValidationControlService.submit("grn-1", "u1", "branch_admin");
    expect(result.grnNumber).toBeNull();
    expect(result.newStatus).toBe("submitted");
  });

  it("still reports an existing number — a re-submit after return must never renumber, and never hides one that already exists", async () => {
    stateRef.current = makeState({ grn: baseGrn({ grn_number: "GRN/BR1/2026-27/0001" }), validations: PASSING });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    const result = await grnValidationControlService.submit("grn-1", "u1", "branch_admin");
    expect(result.grnNumber).toBe("GRN/BR1/2026-27/0001");
  });

  it("refuses when the GRN left draft between the check and the write", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted" }), validations: PASSING });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.submit("grn-1", "u1", "branch_admin")
    ).rejects.toThrow(/status changed before submission/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Maker-checker — enforced on identity, not on role name", () => {
  it("the Branch Head cannot approve a GRN they submitted themselves", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-same" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "fine", "u-same", "branch_head")
    ).rejects.toThrow(/Maker-checker/i);
    expect(sideEffects.reserved).toHaveLength(0);
  });

  it("the Finance Head cannot approve a GRN they submitted", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-same", branch_head_reviewed_by: "u-bh" }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "fine", "u-same", "finance_head")
    ).rejects.toThrow(/Maker-checker/i);
  });

  it("the Finance Head cannot approve a GRN they Branch-Head reviewed", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-same" }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "fine", "u-same", "finance_head")
    ).rejects.toThrow(/Maker-checker/i);
  });

  it("REJECTION by the same person is allowed — it creates no financial commitment", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-same" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "rejected", "wrong vendor", "u-same", "branch_head");
    expect(result.newStatus).toBe("rejected");
  });

  it("a rejection with no remarks is refused at every stage", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "rejected", "   ", "u-bh", "branch_head")
    ).rejects.toThrow(/remarks are mandatory/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Review stage guards", () => {
  it("a Branch Head can only review a submitted GRN", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head")
    ).rejects.toThrow(/only review submitted GRNs/i);
  });

  it("a Finance Head can only review a Branch-Head-approved GRN", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head")
    ).rejects.toThrow(/only review Branch Head-approved/i);
  });

  it("no other role may review at all", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-x", "accounts_head")
    ).rejects.toThrow(/not permitted to review/i);
  });

  it("a GRN with no saved allocations cannot be reviewed", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }), allocations: [] });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head")
    ).rejects.toThrow(/no saved cost allocations/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("What each approval stage actually does to the money", () => {
  it("Branch Head approval RESERVES and does not consume", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head");
    expect(result.newStatus).toBe("branch_head_approved");
    expect(sideEffects.reserved).toEqual([{ lineId: "line-A", amount: 1000 }]);
    expect(sideEffects.consumed).toHaveLength(0);
    expect(sideEffects.payablesCreatedFor).toHaveLength(0);
  });

  it("Finance Head approval of a VENDOR GRN consumes and creates the payable", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh" }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.newStatus).toBe("pending_accounts_payment");
    expect(sideEffects.consumed).toEqual([{ lineId: "line-A", amount: 1000 }]);
    expect(sideEffects.payablesCreatedFor).toEqual(["grn-1"]);
    expect(sideEffects.imprestDebits).toHaveLength(0);
  });

  it("Finance Head approval of an IMPREST GRN debits the float and raises no payable", async () => {
    stateRef.current = makeState({
      grn: baseGrn({
        grn_type: "imprest", status: "branch_head_approved",
        submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh",
      }),
      imprestManagers: [{ id: "mgr-1" }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.newStatus).toBe("approved");
    expect(sideEffects.payablesCreatedFor).toHaveLength(0);
    expect(sideEffects.imprestDebits).toEqual([{ grnId: "grn-1", amount: 1000 }]);
    // The float must be checked BEFORE it is debited, inside the same transaction.
    expect(sideEffects.imprestBalanceChecks).toEqual([{ managerId: "mgr-1", amount: 1000 }]);
  });

  it("an imprest branch with NO appointed manager still approves, and the skip is audited", async () => {
    // Deliberate: imprest_manager is empty in production, so throwing here would stop every
    // imprest approval the moment it deployed. The skip has to be visible, not silent.
    stateRef.current = makeState({
      grn: baseGrn({
        grn_type: "imprest", status: "branch_head_approved",
        submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh",
      }),
      imprestManagers: [],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.newStatus).toBe("approved");
    expect(sideEffects.imprestDebits).toHaveLength(0);
    expect(sideEffects.auditActions).toContain("GRN_IMPREST_LEDGER_SKIPPED");
  });

  it("a float that cannot cover the voucher fails the approval rather than going negative", async () => {
    stateRef.current = makeState({
      grn: baseGrn({
        grn_type: "imprest", status: "branch_head_approved",
        submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh",
      }),
      imprestManagers: [{ id: "mgr-1" }],
      floatShort: true,
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head")
    ).rejects.toThrow(/float is short/i);
    expect(sideEffects.imprestDebits).toHaveLength(0);
  });

  it("a Finance Head REJECTION releases the reservation", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh" }),
      allocations: [reservedAllocation()],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "rejected", "not approved", "u-fh", "finance_head");
    expect(result.newStatus).toBe("rejected");
    expect(sideEffects.released).toEqual([{ lineId: "line-A", amount: 1000 }]);
    expect(sideEffects.consumed).toHaveLength(0);
  });

  it("records an approval event naming the stage that was cleared", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head");
    expect(sideEffects.approvalEvents).toEqual([
      { action: "approve", fromStatus: "submitted", toStatus: "branch_head_approved", actorRole: "branch_head" },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GRN numbering happens at Finance Head approval, not before — Owner ruling", () => {
  it("Branch Head approval does NOT allocate a number — the GRN is still pending final approval", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head");
    expect(result.newStatus).toBe("branch_head_approved");
    expect(result.grnNumber).toBeNull();
  });

  it("Finance Head approval DOES allocate one, on a VENDOR GRN", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh" }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.newStatus).toBe("pending_accounts_payment");
    expect(result.grnNumber).toBe("GRN/BR1/2026-27/0007");
  });

  it("Finance Head approval DOES allocate one, on an IMPREST GRN too — both types share one final stage", async () => {
    stateRef.current = makeState({
      grn: baseGrn({
        grn_type: "imprest", status: "branch_head_approved",
        submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh",
      }),
      imprestManagers: [{ id: "mgr-1" }],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.newStatus).toBe("approved");
    expect(result.grnNumber).toBe("GRN/BR1/2026-27/0007");
  });

  it("a Finance Head REJECTION never allocates one — the deliberate, approved consequence", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh" }),
      allocations: [reservedAllocation()],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "rejected", "not approved", "u-fh", "finance_head");
    expect(result.newStatus).toBe("rejected");
    expect(result.grnNumber).toBeNull();
  });

  it("a Branch Head REJECTION never allocates one either — it never reaches Finance Head at all", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "rejected", "not approved", "u-bh", "branch_head");
    expect(result.newStatus).toBe("rejected");
    expect(result.grnNumber).toBeNull();
  });

  it("an existing number (a legacy migrated row, or a retried approval) is kept, never reissued", async () => {
    stateRef.current = makeState({
      grn: baseGrn({
        status: "branch_head_approved", submitted_by: "u-raiser", branch_head_reviewed_by: "u-bh",
        grn_number: "GRN/BR1/2026-27/0001",
      }),
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.review("grn-1", "approved", "ok", "u-fh", "finance_head");
    expect(result.grnNumber).toBe("GRN/BR1/2026-27/0001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Period lock is re-checked inside the approval transaction", () => {
  it("a lock landing between the API check and the write still stops the approval", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    periodLocked.mockResolvedValue(true);
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "approved", "ok", "u-bh", "branch_head")
    ).rejects.toThrow(/locked for P&L close/i);
    expect(sideEffects.reserved).toHaveLength(0);
  });

  it("a locked period does not stop a REJECTION — nothing is being committed", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "submitted", submitted_by: "u-raiser" }) });
    periodLocked.mockResolvedValue(true);
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.review("grn-1", "rejected", "wrong", "u-bh", "branch_head")
    ).rejects.toThrow(/locked for P&L close/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Validation overrides", () => {
  const draftGrn = () => baseGrn({ status: "draft" });

  it("LOB_ATTRIBUTION can never be overridden — it is the one structural control", async () => {
    stateRef.current = makeState({ grn: draftGrn(), validations: [{ code: "LOB_ATTRIBUTION", status: "failed", blocking: 1 }] });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.overrideValidation("grn-1", "LOB_ATTRIBUTION", "Finance accepts this exception", "u-fh", "finance_head")
    ).rejects.toThrow(/structural attribution control/i);
  });

  it("a reason under 10 characters is refused", async () => {
    stateRef.current = makeState({ grn: draftGrn(), validations: BLOCKED });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.overrideValidation("grn-1", "DOCUMENT_REQUIRED", "ok", "u-fh", "finance_head")
    ).rejects.toThrow(/at least 10 characters/i);
  });

  it("a validation that never ran cannot be overridden", async () => {
    stateRef.current = makeState({ grn: draftGrn(), validations: [] });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.overrideValidation("grn-1", "DOCUMENT_REQUIRED", "Finance accepts this exception", "u-fh", "finance_head")
    ).rejects.toThrow(/Run GRN validation before/i);
  });

  it("a PASSING validation cannot be overridden — there is nothing to waive", async () => {
    stateRef.current = makeState({ grn: draftGrn(), validations: PASSING });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.overrideValidation("grn-1", "DOCUMENT_REQUIRED", "Finance accepts this exception", "u-fh", "finance_head")
    ).rejects.toThrow(/do not require an override/i);
  });

  for (const closed of ["paid", "approved", "cancelled", "rejected"]) {
    it(`an override cannot be changed once the GRN is ${closed}`, async () => {
      stateRef.current = makeState({ grn: baseGrn({ status: closed }), validations: BLOCKED });
      const { grnValidationControlService } = await import("../grn-validation-control.service.js");
      await expect(
        grnValidationControlService.overrideValidation("grn-1", "DOCUMENT_REQUIRED", "Finance accepts this exception", "u-fh", "finance_head")
      ).rejects.toThrow(/after final closure/i);
    });
  }

  it("an active override clears the block, so the same GRN then submits", async () => {
    stateRef.current = makeState({
      grn: baseGrn(),
      validations: BLOCKED,
      overrides: [{ validation_code: "DOCUMENT_REQUIRED", override_reason: "Proof held offline by Finance", approved_by: "u-fh" }],
    });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    const result = await grnValidationControlService.submit("grn-1", "u1", "branch_admin");
    expect(result.newStatus).toBe("submitted");
  });

  it("an override does NOT clear LOB_ATTRIBUTION even if a row exists for it", async () => {
    // The non-overridable set is applied when overrides are re-applied, not only when one is
    // created — so a row inserted by any other means still cannot waive it.
    stateRef.current = makeState({
      grn: baseGrn(),
      validations: [{ code: "LOB_ATTRIBUTION", status: "failed", blocking: 1, message: "requires an exact LOB mapping" }],
      overrides: [{ validation_code: "LOB_ATTRIBUTION", override_reason: "Trying to waive it", approved_by: "u-fh" }],
    });
    const { grnValidationControlService } = await import("../grn-validation-control.service.js");
    await expect(
      grnValidationControlService.submit("grn-1", "u1", "branch_admin")
    ).rejects.toThrow(/LOB/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Cancel and reopen", () => {
  for (const status of ["pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved", "cancelled"]) {
    it(`cannot cancel from ${status} — it is already accounted for`, async () => {
      stateRef.current = makeState({ grn: baseGrn({ status }) });
      const { grnSmartService } = await import("../grn-smart.service.js");
      await expect(grnSmartService.cancel("grn-1", "u1", "branch_admin")).rejects.toThrow(/Cannot cancel/i);
    });
  }

  it("cancelling from branch_head_approved releases the reservation it was holding", async () => {
    stateRef.current = makeState({
      grn: baseGrn({ status: "branch_head_approved" }),
      allocations: [reservedAllocation()],
    });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await grnSmartService.cancel("grn-1", "u1", "branch_admin");
    expect(sideEffects.released).toEqual([{ lineId: "line-A", amount: 1000 }]);
  });

  it("a cancel does not release a row that was never reserved, even from an approved status", async () => {
    // The status says a reservation should exist; the row says it does not. Releasing on the
    // strength of the status alone would hand back budget that was never taken.
    stateRef.current = makeState({ grn: baseGrn({ status: "branch_head_approved" }) }); // allocation is 'draft'
    const { grnSmartService } = await import("../grn-smart.service.js");
    await grnSmartService.cancel("grn-1", "u1", "branch_admin");
    expect(sideEffects.released).toHaveLength(0);
  });

  it("cancelling from draft releases nothing — nothing was ever held", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "draft" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await grnSmartService.cancel("grn-1", "u1", "branch_admin");
    expect(sideEffects.released).toHaveLength(0);
  });

  for (const status of ["draft", "submitted", "branch_head_approved", "paid", "cancelled"]) {
    it(`cannot reopen from ${status}`, async () => {
      stateRef.current = makeState({ grn: baseGrn({ status, created_by: "u1" }) });
      const { grnSmartService } = await import("../grn-smart.service.js");
      await expect(grnSmartService.reopen("grn-1", "u1", "branch_admin")).rejects.toThrow(/cannot be reopened/i);
    });
  }

  it("the creator can reopen a rejected GRN, and it lands back in draft", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "rejected", created_by: "u1" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.reopen("grn-1", "u1", "branch_admin");
    expect(result.newStatus).toBe("draft");
  });

  it("a stranger cannot reopen someone else's rejected GRN", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "rejected", created_by: "u1" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(
      grnSmartService.reopen("grn-1", "u-other", "branch_admin")
    ).rejects.toThrow(/Only the GRN creator/i);
  });

  it("Finance Head can reopen anyone's rejected GRN", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "rejected", created_by: "u1" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    const result = await grnSmartService.reopen("grn-1", "u-fh", "finance_head");
    expect(result.newStatus).toBe("draft");
  });

  it("a Branch Head can reopen one returned TO them, but not one returned to the raiser", async () => {
    stateRef.current = makeState({ grn: baseGrn({ status: "returned_to_branch_head", created_by: "u1" }) });
    const { grnSmartService } = await import("../grn-smart.service.js");
    await expect(grnSmartService.reopen("grn-1", "u-bh", "branch_head")).resolves.toMatchObject({ newStatus: "draft" });

    stateRef.current = makeState({ grn: baseGrn({ status: "returned_to_raiser", created_by: "u1" }) });
    await expect(
      grnSmartService.reopen("grn-1", "u-bh", "branch_head")
    ).rejects.toThrow(/Only the GRN creator/i);
  });
});
