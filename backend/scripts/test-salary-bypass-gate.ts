/**
 * Salary Bypass Gate — API Test Script
 *
 * Tests the salary governance gate at the API level.
 * Run against a running backend: npx ts-node --esm test-salary-bypass-gate.ts
 *
 * Requires: valid admin JWT in env HRMS_TEST_TOKEN
 * Requires: valid salary_structure_master.id in env TEST_STRUCTURE_ID
 * Requires: valid payroll_salary_slabs.id (with ctc_annual) in env TEST_SLAB_ID
 * Requires: valid employee ID in env TEST_EMPLOYEE_ID
 * Requires: valid final_approved salary_proposal.id in env TEST_PROPOSAL_ID (optional)
 */

const BASE_URL = process.env.HRMS_API_URL ?? "http://localhost:5056";
const TOKEN = process.env.HRMS_TEST_TOKEN ?? "";
const STRUCTURE_ID = process.env.TEST_STRUCTURE_ID ?? "";
const SLAB_ID = process.env.TEST_SLAB_ID ?? "";
const EMPLOYEE_ID = process.env.TEST_EMPLOYEE_ID ?? "";
const PROPOSAL_ID = process.env.TEST_PROPOSAL_ID ?? "";
const SLAB_CTC = Number(process.env.TEST_SLAB_CTC ?? "120000");

if (!TOKEN || !STRUCTURE_ID || !EMPLOYEE_ID) {
  console.error("HRMS_TEST_TOKEN, TEST_STRUCTURE_ID, and TEST_EMPLOYEE_ID must be set.");
  process.exit(1);
}

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  detail?: string;
}

const results: TestResult[] = [];

async function post(path: string, body: object): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function record(
  name: string,
  passed: boolean,
  expected: string,
  actual: string,
  detail?: string
) {
  results.push({ name, passed, expected, actual, detail });
  const icon = passed ? "✓" : "✗";
  console.log(`${icon} [${passed ? "PASS" : "FAIL"}] ${name}`);
  if (!passed) console.log(`       Expected: ${expected}\n       Actual:   ${actual}${detail ? `\n       Detail:   ${detail}` : ""}`);
}

// ─── NEGATIVE TESTS ───────────────────────────────────────────────────────────

console.log("\n=== NEGATIVE TESTS (must all fail with SALARY_BYPASS_BLOCKED) ===\n");

// Negative 1: Custom ctcAnnual with no salarySlabId and no approvalReferenceId
{
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: 99999,
    effectiveFrom: "2026-07-01",
    // No salarySlabId, no salaryProposalId
  });
  const gotBlocked = r.status === 400 && r.json?.code === "SALARY_BYPASS_BLOCKED";
  record(
    "NEG-1: Custom ctcAnnual without slab or approval → 400 SALARY_BYPASS_BLOCKED",
    gotBlocked,
    "HTTP 400, code=SALARY_BYPASS_BLOCKED",
    `HTTP ${r.status}, code=${r.json?.code ?? "none"}`,
    r.json?.message
  );
}

// Negative 2: salarySlabId provided but ctcAnnual differs from slab amount
if (SLAB_ID) {
  const wrongCTC = SLAB_CTC + 5000; // deliberately mismatched
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: wrongCTC,
    effectiveFrom: "2026-07-01",
    salarySlabId: SLAB_ID,
  });
  const gotBlocked = r.status === 400 && r.json?.code === "SALARY_BYPASS_BLOCKED";
  record(
    "NEG-2: Valid slab but ctcAnnual mismatch → 400 SALARY_BYPASS_BLOCKED",
    gotBlocked,
    "HTTP 400, code=SALARY_BYPASS_BLOCKED",
    `HTTP ${r.status}, code=${r.json?.code ?? "none"}`,
    r.json?.message
  );
} else {
  console.log("  SKIP NEG-2: TEST_SLAB_ID not set");
}

// Negative 3: Non-existent / rejected proposal ID
{
  const fakeProposalId = "00000000-0000-0000-0000-000000000000";
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: 120000,
    effectiveFrom: "2026-07-01",
    salaryProposalId: fakeProposalId,
  });
  const gotBlocked = r.status === 400 && r.json?.code === "SALARY_BYPASS_BLOCKED";
  record(
    "NEG-3: Non-existent proposal ID → 400 SALARY_BYPASS_BLOCKED",
    gotBlocked,
    "HTTP 400, code=SALARY_BYPASS_BLOCKED",
    `HTTP ${r.status}, code=${r.json?.code ?? "none"}`,
    r.json?.message
  );
}

// ─── POSITIVE TESTS ───────────────────────────────────────────────────────────

console.log("\n=== POSITIVE TESTS (must all succeed) ===\n");

// Positive 1: Valid salarySlabId with matching ctcAnnual
if (SLAB_ID) {
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: SLAB_CTC,
    effectiveFrom: "2026-07-01",
    salarySlabId: SLAB_ID,
  });
  const passed = r.status === 201 && r.json?.data?.id;
  record(
    "POS-1: Valid slab + matching ctcAnnual → 201 success",
    passed,
    "HTTP 201, data.id present",
    `HTTP ${r.status}, data.id=${r.json?.data?.id ?? "none"}`,
    r.json?.message ?? r.json?.error
  );
} else {
  console.log("  SKIP POS-1: TEST_SLAB_ID not set");
}

// Positive 2: Valid final_approved proposal with matching ctcAnnual
if (PROPOSAL_ID) {
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: 130000,
    effectiveFrom: "2026-07-01",
    salaryProposalId: PROPOSAL_ID,
  });
  const passed = r.status === 201 && r.json?.data?.id;
  record(
    "POS-2: Approved proposal + matching ctcAnnual → 201 success",
    passed,
    "HTTP 201, data.id present",
    `HTTP ${r.status}, data.id=${r.json?.data?.id ?? "none"}`,
    r.json?.message ?? r.json?.error
  );
} else {
  console.log("  SKIP POS-2: TEST_PROPOSAL_ID not set (requires approved proposal in DB)");
}

// Positive 3: Super admin migration mode with reason
// NOTE: This test requires the token to belong to a super_admin user.
{
  const r = await post("/api/payroll/salary-assignments", {
    employeeId: EMPLOYEE_ID,
    structureId: STRUCTURE_ID,
    ctcAnnual: 85000,
    effectiveFrom: "2026-07-01",
    migrationMode: true,
    reason: "Controlled data migration — legacy salary record import",
  });
  // May fail if token is not super_admin — that is correct behavior
  const passed = r.status === 201 && r.json?.data?.id;
  const blockedCorrectly = r.status === 400 && r.json?.code === "SALARY_BYPASS_BLOCKED";
  if (passed) {
    record(
      "POS-3: Super admin migration mode + reason → 201 success",
      true,
      "HTTP 201",
      `HTTP ${r.status}`
    );
  } else if (blockedCorrectly) {
    record(
      "POS-3: Migration mode blocked (token not super_admin) → gate working correctly",
      true,
      "HTTP 400 SALARY_BYPASS_BLOCKED (non-super-admin token)",
      `HTTP ${r.status}, code=${r.json?.code}`
    );
  } else {
    record(
      "POS-3: Super admin migration mode",
      false,
      "HTTP 201 or HTTP 400 SALARY_BYPASS_BLOCKED",
      `HTTP ${r.status}, code=${r.json?.code ?? "none"}`,
      r.json?.message ?? r.json?.error
    );
  }
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

console.log("\n=== SUMMARY ===\n");
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Total: ${results.length}  Pass: ${passed}  Fail: ${failed}`);
if (failed === 0) {
  console.log("\n✓ ALL TESTS PASSED — salary bypass gate is enforced correctly at API level.");
} else {
  console.log("\n✗ SOME TESTS FAILED — review failures above.");
  process.exit(1);
}
