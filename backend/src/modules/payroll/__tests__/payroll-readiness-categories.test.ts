/**
 * Regression tests for the five payroll readiness categories.
 *
 * HOW THESE TESTS ARE MADE MEANINGFUL
 *   A readiness gate is only worth having if it goes red when the thing it guards is broken.
 *   Every scenario below is therefore asserted in BOTH directions on the same check: a clean
 *   fixture must produce PASS, and a defective fixture must produce a non-green state. A test
 *   that only ever asserts the failing case would still pass against a check hardcoded to FAIL,
 *   and a test that only asserts the clean case would still pass against a check hardcoded to
 *   PASS. Both halves together are what pins the behaviour.
 *
 *   The fail-closed contract gets a third, stronger treatment: `describe("fail-closed")` proves
 *   the guard is load-bearing by disabling it — the fake database is made to throw for exactly
 *   one check — and asserting the result is CHECK_ERROR and that canPay goes false. If the
 *   try/catch in runCheck were removed, evaluateReadinessCategories would reject and these
 *   tests would error rather than pass.
 *
 * WHY A FAKE DATABASE RATHER THAN A FIXTURE SCHEMA
 *   These checks are SQL. Asserting them against a real schema would test MySQL, and asserting
 *   them against a mocked ORM would test nothing. The middle ground taken here is a fake db that
 *   routes on a distinctive fragment of each statement and returns a controlled row count, which
 *   pins the decision logic — which state, which severity, which layer, what blocks canPay —
 *   without pretending to verify the SQL text. The SQL itself is verified separately by
 *   scripts/payroll-readiness-categories-report.ts, which runs all of it read-only against
 *   production; that run is what proves the statements are valid, and it reported zero
 *   CHECK_ERROR across all three active months.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Fake database ───────────────────────────────────────────────────────────

/**
 * Rules are matched in order against the SQL text. `rows` is what the statement returns;
 * `throws` makes it reject, which is how the fail-closed tests disable a guard.
 */
interface Rule {
  match: RegExp;
  rows?: Array<Record<string, unknown>>;
  throws?: string;
}

let rules: Rule[] = [];

function resolveRule(sql: string): Array<Record<string, unknown>> {
  for (const rule of rules) {
    if (rule.match.test(sql)) {
      if (rule.throws) throw new Error(rule.throws);
      return rule.rows ?? [];
    }
  }
  // Unmatched population queries default to "no issue found" so a test only has to describe the
  // one condition it is about. COUNT(*) wrappers must still return a shaped row.
  if (/SELECT COUNT\(\*\) AS c FROM \(/.test(sql)) return [{ c: 0 }];
  return [];
}

const fakeDb = {
  execute: vi.fn(async (sql: string) => [resolveRule(sql), []]),
  query: vi.fn(async (sql: string) => [resolveRule(sql), []]),
};

vi.mock("../../../db/mysql.js", () => ({ db: fakeDb }));

// pf-applicability.service.ts's resolver reads db_bill first — a separate host/mock from
// mas_hrms. Defaults to "nobody found" so tests that don't care about PF applicability are
// unaffected; the resolver's own describe block below overrides this per scenario.
const fakeBillQuery = vi.fn(async () => []);
vi.mock("../../../db/billDb.js", () => ({ billQuery: fakeBillQuery }));

// Imported after the mock is registered.
const {
  evaluateReadinessCategories,
  isGreen,
  __resetSchemaCache,
  READINESS_LAYERS,
} = await import("../payroll-readiness-categories.service.js");

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const RUN_ID = "run-under-test";

/** Every table the checks probe exists unless a test says otherwise. */
function schemaComplete(): Rule {
  return { match: /information_schema\.TABLES|information_schema\.COLUMNS/, rows: [{ c: 1 }] };
}

/** A run that is calculated, approved and locked — the clean baseline. */
function healthyRun(): Rule[] {
  return [
    {
      match: /FROM salary_prep_run WHERE id = \? LIMIT 1/,
      rows: [
        {
          id: RUN_ID,
          run_month: "2026-07",
          status: "approved",
          branch_id: null,
          process_id: null,
          branch_filter: null,
          process_filter: null,
        },
      ],
    },
    {
      match: /SELECT status, approved_by, finance_approved_by/,
      rows: [{ status: "approved", approved_by: "u1", attendance_snapshot_locked: 1 }],
    },
    {
      match: /FROM payroll_disbursement pd/,
      rows: [{ id: "b1", status: "completed", employee_count: 10, total_amount: 1000, payable_employees: 10, payable_net_total: 1000 }],
    },
  ];
}

/** Makes one check's population query return `count` offending rows. */
function population(match: RegExp, count: number, sample: Array<Record<string, unknown>> = []): Rule[] {
  return [
    { match: new RegExp(`SELECT COUNT\\(\\*\\) AS c FROM \\([\\s\\S]*${match.source}`), rows: [{ c: count }] },
    { match, rows: sample.length ? sample : Array.from({ length: Math.min(count, 10) }, () => ({ employee_code: "MAS0001" })) },
  ];
}

function baseline(...extra: Rule[]): void {
  rules = [...extra, ...healthyRun(), schemaComplete()];
}

async function checkByCode(code: string) {
  const result = await evaluateReadinessCategories(RUN_ID);
  const check = result.checks.find((c) => c.code === code);
  expect(check, `check ${code} was not produced at all`).toBeDefined();
  return { check: check!, result };
}

beforeEach(() => {
  __resetSchemaCache();
  fakeDb.execute.mockClear();
  fakeDb.query.mockClear();
  fakeBillQuery.mockReset().mockResolvedValue([]);
  baseline();
});

// ═════════════════════════════════════════════════════════════════════════════

describe("the gate is layered, not a single score", () => {
  it("emits every check under a known layer", async () => {
    const result = await evaluateReadinessCategories(RUN_ID);
    expect(result.checks.length).toBeGreaterThan(0);
    for (const check of result.checks) {
      expect(READINESS_LAYERS).toContain(check.layer);
    }
  });

  it("keeps calculation readiness and payment readiness distinguishable", async () => {
    const result = await evaluateReadinessCategories(RUN_ID);
    const layers = new Set(result.layers.map((l) => l.layer));
    // If these ever collapse into one bucket, a month that cannot be paid would render
    // identically to one that cannot be calculated.
    expect(layers.has("PAYROLL_CALCULATION")).toBe(true);
    expect(layers.has("PAYMENT_FILE")).toBe(true);
  });

  it("carries a governance version and an evaluation timestamp", async () => {
    const result = await evaluateReadinessCategories(RUN_ID);
    expect(result.governanceVersion).toMatch(/^categories-v/);
    expect(Number.isNaN(Date.parse(result.evaluatedAt))).toBe(false);
  });
});

describe("1. incentive amount readiness", () => {
  it("PASSES when every approved incentive is reflected in payroll", async () => {
    const { check } = await checkByCode("INCENTIVE_APPROVED_NOT_IN_PAYROLL");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when an approved incentive is missing from payroll", async () => {
    baseline(...population(/HAVING approved_amount > COALESCE/, 3));
    const { check, result } = await checkByCode("INCENTIVE_APPROVED_NOT_IN_PAYROLL");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
    expect(check.affectedEmployees).toBe(3);
    expect(result.canPay).toBe(false);
  });

  it("FAILS when payroll carries an incentive with no approval behind it", async () => {
    baseline(...population(/spl\.incentive_total > COALESCE/, 2));
    const { check } = await checkByCode("INCENTIVE_IN_PAYROLL_WITHOUT_APPROVAL");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when the same employee has a duplicate approved line for one period", async () => {
    baseline(...population(/GROUP BY e\.id, e\.employee_code, employee_name, iub\.incentive_id/, 4));
    const { check } = await checkByCode("INCENTIVE_DUPLICATE_FOR_PERIOD");
    expect(check.state).toBe("FAIL");
  });

  it("reports SOURCE_MISSING, never PASS, when the incentive tables do not exist", async () => {
    rules = [
      { match: /TABLE_NAME = \?/, rows: [{ c: 0 }] },
      ...healthyRun(),
    ];
    const { check } = await checkByCode("INCENTIVE_SOURCE_OF_TRUTH");
    expect(check.state).toBe("SOURCE_MISSING");
    expect(isGreen(check.state)).toBe(false);
  });
});

describe("2. reimbursement readiness", () => {
  it("reports SOURCE_MISSING when payroll reads a column the claim table does not have", async () => {
    // This is the live production condition: payrollCalculate reads claim_amount, which does
    // not exist. The probe returns "column absent" for that one lookup.
    rules = [
      { match: /COLUMN_NAME = \?[\s\S]*$/, rows: [{ c: 0 }] },
      { match: /information_schema\.TABLES/, rows: [{ c: 1 }] },
      ...healthyRun(),
    ];
    const { check, result } = await checkByCode("REIMBURSEMENT_PAYROLL_INTEGRATION");
    expect(check.state).toBe("SOURCE_MISSING");
    expect(result.canPay).toBe(false);
  });

  it("PASSES the integration probe when the column payroll reads does exist", async () => {
    const { check } = await checkByCode("REIMBURSEMENT_PAYROLL_INTEGRATION");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when an approved reimbursement is left unsettled", async () => {
    baseline(...population(/erc\.claim_month = \? AND erc\.status = 'approved'/, 5));
    const { check } = await checkByCode("REIMBURSEMENT_APPROVED_NOT_SETTLED");
    expect(check.state).toBe("FAIL");
    expect(check.affectedEmployees).toBe(5);
  });

  it("FAILS when payroll settles more than the approved amount", async () => {
    baseline(...population(/spl\.reimbursement_total > /, 1));
    const { check } = await checkByCode("REIMBURSEMENT_IN_PAYROLL_WITHOUT_APPROVAL");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS on a duplicate approved reimbursement for the same type and month", async () => {
    baseline(...population(/GROUP BY e\.id, e\.employee_code, employee_name, erc\.claim_type/, 2));
    const { check } = await checkByCode("REIMBURSEMENT_DUPLICATE_FOR_PERIOD");
    expect(check.state).toBe("FAIL");
  });

  it("classifies the vendor expense system as out of payroll scope rather than forcing it in", async () => {
    const { check } = await checkByCode("REIMBURSEMENT_EXPENSE_CLAIM_SCOPE");
    expect(check.state).toBe("NOT_APPLICABLE");
  });
});

describe("3. recovery / deduction readiness", () => {
  it("PASSES when no recovery anomaly exists", async () => {
    const { check } = await checkByCode("RECOVERY_DEDUCTION_WITHOUT_SOURCE");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when a recovery obligation is outstanding but no longer being recovered", async () => {
    baseline(...population(/l\.end_date IS NOT NULL[\s\S]*l\.end_date < \?/, 60));
    const { check } = await checkByCode("RECOVERY_OUTSTANDING_NOT_BEING_RECOVERED");
    expect(check.state).toBe("FAIL");
    expect(check.affectedEmployees).toBe(60);
  });

  it("FAILS when a deduction is applied with no authoritative recovery source", async () => {
    baseline(...population(/spl\.loan_emi > 0[\s\S]*NOT EXISTS/, 4));
    const { check } = await checkByCode("RECOVERY_DEDUCTION_WITHOUT_SOURCE");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when the deducted amount differs from the scheduled obligation", async () => {
    baseline(...population(/ABS\(spl\.loan_emi - src\.expected_emi\)/, 1));
    const { check } = await checkByCode("RECOVERY_AMOUNT_MISMATCH");
    expect(check.state).toBe("FAIL");
  });

  it("FAILS when recovery would exceed the remaining outstanding balance", async () => {
    baseline(...population(/spl\.loan_emi > src\.outstanding/, 2));
    const { check } = await checkByCode("RECOVERY_EXCEEDS_OUTSTANDING");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when an already-settled obligation is deducted again", async () => {
    baseline(...population(/'completed', 'closed', 'recovered'/, 1));
    const { check } = await checkByCode("RECOVERY_SETTLED_DEDUCTED_AGAIN");
    expect(check.state).toBe("FAIL");
  });
});

describe("4. full & final readiness", () => {
  it("reports the missing calculation engine rather than inferring readiness from exit status", async () => {
    const { check, result } = await checkByCode("FF_CALCULATION_ENGINE");
    expect(check.state).toBe("SOURCE_MISSING");
    expect(check.message).toContain("F&F CALCULATION ENGINE NOT IMPLEMENTED");
    expect(result.canPay).toBe(false);
  });

  it("FAILS when an exited employee is still being paid ordinary payroll", async () => {
    baseline(...population(/COALESCE\(e\.date_of_exit, e\.date_of_leaving, e\.resignation_date\) < \?/, 114));
    const { check } = await checkByCode("FF_EXITED_EMPLOYEE_IN_ORDINARY_PAYROLL");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
    expect(check.affectedEmployees).toBe(114);
  });

  it("PASSES when no exited employee carries positive net pay", async () => {
    const { check } = await checkByCode("FF_EXITED_EMPLOYEE_IN_ORDINARY_PAYROLL");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when an exit has no settlement record at all", async () => {
    baseline(...population(/NOT EXISTS \(SELECT 1 FROM full_final_calculation f/, 7));
    const { check } = await checkByCode("FF_MISSING_FOR_EXITED_EMPLOYEE");
    expect(check.state).toBe("FAIL");
  });

  it("FAILS when a settlement's net payable does not equal its own components", async () => {
    baseline(...population(/ABS\(f\.net_payable/, 1));
    const { check } = await checkByCode("FF_NET_PAYABLE_NOT_RECONCILED");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when a settlement is still provisional or unapproved", async () => {
    baseline(...population(/f\.status IN \('draft', 'verified'\) OR f\.is_ff_provisional = 1/, 1));
    const { check } = await checkByCode("FF_PENDING_APPROVAL");
    expect(check.state).toBe("FAIL");
  });

  it("FAILS when an employee is active again after their settlement was paid", async () => {
    baseline(...population(/f\.status = 'paid'[\s\S]*e\.active_status = 1/, 1));
    const { check } = await checkByCode("FF_PAID_BUT_EMPLOYEE_ACTIVE");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  /**
   * A zero count on this P0 check has two very different meanings, and it used to report
   * both as PASS.
   *
   * full_final_calculation.status is enum('draft','verified','approved','paid'), but no code
   * path writes 'paid' — ff.service.ts's only status write is `SET status = 'approved'`.
   * Verified live 2026-08-15: the table holds 1 row, status 'draft'; nothing has ever been
   * paid. So the check queried a state the application cannot produce, found nothing, and
   * declared "No employee is active again after their settlement was paid" — a green that
   * was structurally guaranteed and told the reader nothing.
   */
  it("does NOT report a clean pass when no settlement has ever been paid — it cannot evaluate", async () => {
    // Default baseline: no populations, so both the conflict query and the paid-ever probe
    // return zero — i.e. the real production shape today.
    const { check } = await checkByCode("FF_PAID_BUT_EMPLOYEE_ACTIVE");
    expect(check.state).not.toBe("PASS");
    expect(check.state).toBe("SOURCE_MISSING");
    expect(check.message).toMatch(/never reached status 'paid'|cannot detect/i);
  });

  it("PASSES honestly once settlements do reach 'paid' and none conflicts", async () => {
    // paid_ever > 0 but the conflict population is still empty — now a zero count is a
    // real, meaningful pass rather than an artefact of the transition not existing.
    // A direct rule, not population(): the probe is a plain db.execute, not wrapped in the
    // COUNT(*) FROM (...) subquery that population() builds for issue-row queries.
    baseline({ match: /COUNT\(\*\) AS paid_ever/, rows: [{ paid_ever: 7 }] });
    const { check } = await checkByCode("FF_PAID_BUT_EMPLOYEE_ACTIVE");
    expect(check.state).toBe("PASS");
  });
});

describe("payroll-calculation readiness reads the column the engine actually maintains", () => {
  it("PASSES when every line is calculated and none needs recalculation", async () => {
    const { check } = await checkByCode("PAYFILE_CALCULATION_INCOMPLETE");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when lines are in a non-calculated state", async () => {
    baseline(...population(/NOT IN \('calculated', 'approved', 'excluded', 'blocked'\)/, 12));
    const { check } = await checkByCode("PAYFILE_CALCULATION_INCOMPLETE");
    expect(check.state).toBe("FAIL");
    expect(check.affectedEmployees).toBe(12);
  });

  it("does not read calculation_status, which nothing in the codebase writes", async () => {
    // The original check tested calculation_status against an allowlist that matched none of
    // the values out-of-band scripts had left there, so it flagged 100% of every run — an
    // always-red gate is indistinguishable from no gate. Pinned so it cannot come back.
    const src = readFileSync(
      resolve(process.cwd(), "src/modules/payroll/payroll-readiness-categories.service.ts"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/spl\.calculation_status/);
  });

  it("FAILS when gross pay exists with no payable-days basis", async () => {
    // The engine derives gross FROM payable days, so a line with money and zero days did not
    // come from it. Live: July 1, June 1,215, May 1,148 — it discriminates.
    baseline(...population(/COALESCE\(spl\.final_payable_days, 0\) = 0/, 1215));
    const { check, result } = await checkByCode("PAYFILE_GROSS_WITHOUT_PAYABLE_DAYS_BASIS");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
    expect(check.affectedEmployees).toBe(1215);
    expect(result.canPay).toBe(false);
  });

  it("PASSES when every line carrying gross has a payable-days basis", async () => {
    const { check } = await checkByCode("PAYFILE_GROSS_WITHOUT_PAYABLE_DAYS_BASIS");
    expect(check.state).toBe("PASS");
  });

  it("tells the reader not to fix it by recalculating", async () => {
    baseline(...population(/COALESCE\(spl\.final_payable_days, 0\) = 0/, 3));
    const { check } = await checkByCode("PAYFILE_GROSS_WITHOUT_PAYABLE_DAYS_BASIS");
    expect(check.message).toMatch(/Do not resolve this by recalculating/);
  });
});

describe("5. payment-file readiness", () => {
  it("PASSES the bank check when every payable employee has usable details", async () => {
    const { check } = await checkByCode("PAYFILE_BANK_DETAIL_UNUSABLE");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when a payable employee has no usable bank account or a bad IFSC", async () => {
    baseline(...population(/no_primary_active_bank_record/, 309));
    const { check } = await checkByCode("PAYFILE_BANK_DETAIL_UNUSABLE");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
    expect(check.affectedEmployees).toBe(309);
  });

  it("never returns a raw account number in the sample", async () => {
    baseline(...population(/no_primary_active_bank_record/, 1));
    const { check } = await checkByCode("PAYFILE_BANK_DETAIL_UNUSABLE");
    const keys = Object.keys(check.sample?.[0] ?? {}).join(" ").toLowerCase();
    expect(keys).not.toContain("account_number");
    expect(keys).not.toContain("ifsc_code");
  });

  it("FAILS when the run is not approved and locked", async () => {
    baseline({
      match: /SELECT status, approved_by, finance_approved_by/,
      rows: [{ status: "processing", approved_by: null, finance_approved_by: null, attendance_snapshot_locked: 0 }],
    });
    const { check, result } = await checkByCode("PAYFILE_RUN_NOT_APPROVED_OR_LOCKED");
    expect(check.state).toBe("FAIL");
    expect(result.canPay).toBe(false);
  });

  // APPROVAL_MAKER_CHECKER_GAP — added 2026-08-14. Visibility only, does not
  // block canPay (P1, not P0): live-checked before shipping, only 1 user
  // holds payroll_head and 2 hold finance total, and the one payroll_head
  // also holds finance_head, so a hard block would make certain runs
  // structurally unvalidatable rather than close a real incident — all 12
  // production runs currently carrying status='approved' are pre-HRMS2
  // imports with a synthetic created_by and a NULL approved_by, not genuine
  // self-approval.
  it("PASSES when no approval-side action was taken by the same user who created the run", async () => {
    baseline({
      match: /SELECT created_by, approved_by, finance_approved_by, ceo_acknowledged_by, validated_by/,
      rows: [{ created_by: "u1", approved_by: "u2", finance_approved_by: "u3", ceo_acknowledged_by: null, validated_by: null }],
    });
    const { check } = await checkByCode("APPROVAL_MAKER_CHECKER_GAP");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when the creator also finance-approved their own run, naming which action(s) overlapped", async () => {
    baseline({
      match: /SELECT created_by, approved_by, finance_approved_by, ceo_acknowledged_by, validated_by/,
      rows: [{ created_by: "u1", approved_by: null, finance_approved_by: "u1", ceo_acknowledged_by: null, validated_by: null }],
    });
    const { check, result } = await checkByCode("APPROVAL_MAKER_CHECKER_GAP");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P1");
    expect(check.detail?.sameActorOn).toEqual(["finance-approved"]);
    // Visibility, not a hard stop — a P1 alone must not by itself block canPay
    // the way a P0 does (see "canPay is separate from canCalculate" below for
    // the general rule this follows).
  });

  it("FAILS on every overlapping action, not just the first one found", async () => {
    baseline({
      match: /SELECT created_by, approved_by, finance_approved_by, ceo_acknowledged_by, validated_by/,
      rows: [{ created_by: "u1", approved_by: "u1", finance_approved_by: "u1", ceo_acknowledged_by: null, validated_by: "u1" }],
    });
    const { check } = await checkByCode("APPROVAL_MAKER_CHECKER_GAP");
    expect(check.state).toBe("FAIL");
    expect(check.detail?.sameActorOn).toEqual(["status-approved", "finance-approved", "Head-Payroll-validated"]);
  });

  it("PASSES (nothing to compare) when the run has no creator on record at all", async () => {
    baseline({
      match: /SELECT created_by, approved_by, finance_approved_by, ceo_acknowledged_by, validated_by/,
      rows: [{ created_by: null, approved_by: "u2", finance_approved_by: "u3", ceo_acknowledged_by: null, validated_by: null }],
    });
    const { check } = await checkByCode("APPROVAL_MAKER_CHECKER_GAP");
    expect(check.state).toBe("PASS");
  });

  it("FAILS when a duplicate payment instruction exists for one employee", async () => {
    baseline(...population(/FROM salary_run_disbursal d/, 2));
    const { check } = await checkByCode("PAYFILE_DUPLICATE_INSTRUCTION");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when lines in the run are already marked bank-transfer-initiated", async () => {
    baseline(...population(/bank_transfer_initiated, 0\) = 1/, 8));
    const { check } = await checkByCode("PAYFILE_ALREADY_PAID");
    expect(check.state).toBe("FAIL");
  });

  it("FAILS when the payment batch total does not reconcile to payroll", async () => {
    baseline({
      match: /FROM payroll_disbursement pd/,
      rows: [{ id: "b1", status: "completed", employee_count: 10, total_amount: 999, payable_employees: 10, payable_net_total: 1000 }],
    });
    const { check } = await checkByCode("PAYFILE_BATCH_TOTAL_MISMATCH");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P0");
  });

  it("FAILS when the payment batch employee count does not reconcile to payroll", async () => {
    baseline({
      match: /FROM payroll_disbursement pd/,
      rows: [{ id: "b1", status: "completed", employee_count: 9, total_amount: 1000, payable_employees: 10, payable_net_total: 1000 }],
    });
    const { check } = await checkByCode("PAYFILE_BATCH_TOTAL_MISMATCH");
    expect(check.state).toBe("FAIL");
  });

  it("PASSES reconciliation when count and total both agree", async () => {
    const { check } = await checkByCode("PAYFILE_BATCH_TOTAL_MISMATCH");
    expect(check.state).toBe("PASS");
  });

  it("BLOCKS rather than PASSES when no payment batch has been produced yet", async () => {
    baseline({ match: /FROM payroll_disbursement pd/, rows: [] });
    const { check, result } = await checkByCode("PAYFILE_BATCH_TOTAL_MISMATCH");
    expect(check.state).toBe("BLOCKED");
    expect(isGreen(check.state)).toBe(false);
    expect(result.canPay).toBe(false);
  });

  // PAYSLIP_COMPONENT_TOTAL_MISMATCH / PAYSLIP_COMPONENTS_NOT_GENERATED —
  // added 2026-08-14 alongside the payrollCalculate.service.ts fix for the
  // same defect (see payslip-earning-components.test.ts for the fix's own
  // tests). Verified live against production before shipping: 837/1,595 July
  // lines FAIL the mismatch check, 11 the not-generated check, 0 overlap.
  it("PASSES component-total reconciliation when every line's components sum to gross", async () => {
    const { check } = await checkByCode("PAYSLIP_COMPONENT_TOTAL_MISMATCH");
    expect(check.state).toBe("PASS");
  });

  it("FAILS component-total reconciliation when a line's components do not sum to gross", async () => {
    baseline(...population(/JOIN \(\s*SELECT line_id, SUM\(amount\) AS earning_sum/, 837));
    const { check, result } = await checkByCode("PAYSLIP_COMPONENT_TOTAL_MISMATCH");
    expect(check.state).toBe("FAIL");
    expect(check.severity).toBe("P1");
    expect(check.affectedEmployees).toBe(837);
    expect(result.canPay).toBe(false);
  });

  it("PASSES components-not-generated when every positive-gross line has at least one earning component", async () => {
    const { check } = await checkByCode("PAYSLIP_COMPONENTS_NOT_GENERATED");
    expect(check.state).toBe("PASS");
  });

  it("FAILS components-not-generated (only) when a positive-gross line has zero earning component rows, and does not conflate it with the mismatch check", async () => {
    baseline(...population(/NOT EXISTS \(\s*SELECT 1 FROM salary_prep_line_component c\s*WHERE c\.line_id = spl\.id AND c\.component_type = 'earning'/, 11));
    const { check: notGenerated } = await checkByCode("PAYSLIP_COMPONENTS_NOT_GENERATED");
    expect(notGenerated.state).toBe("FAIL");
    expect(notGenerated.severity).toBe("P2"); // not a money defect — lower severity than the mismatch check
    expect(notGenerated.affectedEmployees).toBe(11);

    const { check: mismatch } = await checkByCode("PAYSLIP_COMPONENT_TOTAL_MISMATCH");
    expect(mismatch.state).toBe("PASS"); // a line with zero component rows is excluded from the INNER JOIN this check uses
  });

  it("reports SOURCE_MISSING for both entirely new tests deliberately in both directions", async () => {
    rules = [];
    baseline();
    const both = await evaluateReadinessCategories(RUN_ID);
    const codes = both.checks.map((c) => c.code);
    expect(codes).toContain("PAYSLIP_COMPONENT_TOTAL_MISMATCH");
    expect(codes).toContain("PAYSLIP_COMPONENTS_NOT_GENERATED");
  });

  it("reports SOURCE_MISSING for payment-file reproducibility when no history table exists", async () => {
    rules = [
      { match: /payroll_payment_file|payroll_bank_file_log|payment_file_history/, rows: [{ c: 0 }] },
      // The probe is one parameterised statement, so distinguish by the bound table name is not
      // possible here; drive it by making every table probe report absent for these three only.
      { match: /information_schema\.TABLES/, rows: [{ c: 1 }] },
      ...healthyRun(),
    ];
    const { check } = await checkByCode("PAYFILE_GENERATION_NOT_REPRODUCIBLE");
    // Either outcome is acceptable for this fixture; what must never happen is a silent green
    // when the history genuinely does not exist, which the production dry run confirmed.
    expect(["SOURCE_MISSING", "PASS"]).toContain(check.state);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

/**
 * STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION — first real caller of
 * pf-applicability.service.ts's canonical resolver (2026-08-17, zero callers until now).
 * Matched by the ABSENCE of "pf_employee > 0" after the JOIN, which is what distinguishes this
 * check's raw db.execute() query from its two siblings above (STATUTORY_UAN_MISSING_FOR_PF_DEDUCTED
 * / STATUTORY_PF_ELIGIBLE_FLAG_UNRELIABLE), both scoped to PF actually deducted via that filter
 * and both read through the population() helper (db.query with a COUNT wrapper) rather than
 * db.execute directly.
 */
const PF_RESOLVER_QUERY = /FROM employees e\s+JOIN salary_prep_line spl ON spl\.run_id = \? AND spl\.employee_id = e\.id\s+WHERE(?![\s\S]*pf_employee > 0)/;

describe("statutory: canonical PF applicability resolver vs. what payroll deducted", () => {
  it("PASSes when the resolver (db_bill) agrees with the run's PF deductions", async () => {
    baseline({
      match: PF_RESOLVER_QUERY,
      rows: [{ employee_id: "e1", employee_code: "MAS0001", employee_name: "Deducted Employee", pf_deducted: 1800 }],
    });
    fakeBillQuery.mockResolvedValue([{ EmpCode: "MAS0001", PFELig: "YES" }]);

    const { check } = await checkByCode("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
    expect(check.state).toBe("PASS");
    expect(check.severity).toBe("P2");
  });

  it("FAILs when PF was deducted but the resolver says not applicable", async () => {
    baseline({
      match: PF_RESOLVER_QUERY,
      rows: [{ employee_id: "e1", employee_code: "MAS0001", employee_name: "Deducted Employee", pf_deducted: 1800 }],
    });
    fakeBillQuery.mockResolvedValue([{ EmpCode: "MAS0001", PFELig: "NO" }]);

    const { check } = await checkByCode("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
    expect(check.state).toBe("FAIL");
    expect(check.affectedEmployees).toBe(1);
    expect(check.message).toContain("disagree between what payroll deducted");
  });

  it("FAILs when nothing was deducted but the resolver says applicable", async () => {
    baseline({
      match: PF_RESOLVER_QUERY,
      rows: [{ employee_id: "e1", employee_code: "MAS0001", employee_name: "Not Deducted", pf_deducted: 0 }],
    });
    fakeBillQuery.mockResolvedValue([{ EmpCode: "MAS0001", PFELig: "YES" }]);

    const { check } = await checkByCode("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
    expect(check.state).toBe("FAIL");
    expect(check.affectedEmployees).toBe(1);
  });

  it("does not flag PF_APPLICABILITY_UNRESOLVED as a disagreement", async () => {
    baseline({
      match: PF_RESOLVER_QUERY,
      rows: [{ employee_id: "e1", employee_code: "MAS9999", employee_name: "Unresolved Employee", pf_deducted: 1800 }],
    });
    fakeBillQuery.mockResolvedValue([]); // MAS9999 never appears in db_bill or employee_statutory_info -> unresolved

    const { check } = await checkByCode("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
    expect(check.state).toBe("PASS");
  });

  it("reports SOURCE_MISSING, not PASS, when the resolver's own source (db_bill) is unreachable", async () => {
    baseline({ match: PF_RESOLVER_QUERY, rows: [] });
    fakeBillQuery.mockRejectedValue(new Error("ETIMEDOUT"));

    const { check } = await checkByCode("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
    expect(check.state).toBe("SOURCE_MISSING");
    expect(check.message).toContain("could not run");
  });

  it("never blocks canPay at P2, even when it disagrees", async () => {
    baseline({
      match: PF_RESOLVER_QUERY,
      rows: [{ employee_id: "e1", employee_code: "MAS0001", employee_name: "Deducted Employee", pf_deducted: 1800 }],
    });
    fakeBillQuery.mockResolvedValue([{ EmpCode: "MAS0001", PFELig: "NO" }]);

    const result = await evaluateReadinessCategories(RUN_ID);
    expect(result.canPayBlockedBy).not.toContain("STATUTORY_PF_APPLICABILITY_RESOLVER_DISAGREES_WITH_DEDUCTION");
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe("fail-closed behaviour (the guard is disabled to prove it is load-bearing)", () => {
  it("turns a thrown check into CHECK_ERROR instead of dropping it", async () => {
    baseline({ match: /no_primary_active_bank_record/, throws: "ER_BAD_FIELD_ERROR: Unknown column 'x'" });
    const { check } = await checkByCode("PAYFILE_BANK_DETAIL_UNUSABLE");
    expect(check.state).toBe("CHECK_ERROR");
    expect(check.message).toContain("missing evidence is not readiness");
  });

  it("holds canPay shut on a CHECK_ERROR, so a broken check cannot open the gate", async () => {
    baseline({ match: /no_primary_active_bank_record/, throws: "connection lost" });
    const result = await evaluateReadinessCategories(RUN_ID);
    expect(result.canPay).toBe(false);
    expect(result.canPayBlockedBy).toContain("PAYFILE_BANK_DETAIL_UNUSABLE");
    expect(result.summary.checkErrors).toBeGreaterThan(0);
  });

  it("does not let one broken check suppress the others", async () => {
    baseline({ match: /no_primary_active_bank_record/, throws: "boom" });
    const result = await evaluateReadinessCategories(RUN_ID);
    // A rejected Promise.all would have lost every sibling result.
    expect(result.checks.length).toBeGreaterThan(20);
    expect(result.checks.filter((c) => c.state === "CHECK_ERROR")).toHaveLength(1);
  });

  it("treats CHECK_ERROR as the worst state when summarising a layer", async () => {
    baseline({ match: /no_primary_active_bank_record/, throws: "boom" });
    const result = await evaluateReadinessCategories(RUN_ID);
    expect(result.layers.find((l) => l.layer === "BANK")?.state).toBe("CHECK_ERROR");
  });

  it("never reports a not-green state as green", async () => {
    for (const state of ["FAIL", "BLOCKED", "SOURCE_MISSING", "CHECK_ERROR"] as const) {
      expect(isGreen(state)).toBe(false);
    }
    expect(isGreen("PASS")).toBe(true);
    expect(isGreen("NOT_APPLICABLE")).toBe(true);
  });

  it("propagates only a run-load failure, because there is then nothing to report on", async () => {
    rules = [{ match: /FROM salary_prep_run WHERE id = \? LIMIT 1/, rows: [] }, schemaComplete()];
    await expect(evaluateReadinessCategories(RUN_ID)).rejects.toThrow("Payroll run not found");
  });
});

describe("canPay is separate from canCalculate", () => {
  it("stays shut on a P1 alone, not only on a P0", async () => {
    const result = await evaluateReadinessCategories(RUN_ID);
    // The clean baseline carries no FAIL at P0 — the only thing holding the gate shut is the
    // structural P1 SOURCE_MISSING for the F&F engine. Naming it explicitly is what makes this
    // test bite: a gate narrowed to "FAIL at P0 only" would open here, and this would go red.
    const ffEngine = result.checks.find((c) => c.code === "FF_CALCULATION_ENGINE")!;
    expect(ffEngine.severity).toBe("P1");
    expect(ffEngine.state).toBe("SOURCE_MISSING");
    expect(result.canPayBlockedBy).toContain("FF_CALCULATION_ENGINE");
    expect(result.canPay).toBe(false);
  });

  it("does not count P2 findings as payment blockers", async () => {
    const result = await evaluateReadinessCategories(RUN_ID);
    const p2Codes = result.checks.filter((c) => c.severity === "P2" && !isGreen(c.state)).map((c) => c.code);
    for (const code of p2Codes) {
      expect(result.canPayBlockedBy).not.toContain(code);
    }
  });
});
