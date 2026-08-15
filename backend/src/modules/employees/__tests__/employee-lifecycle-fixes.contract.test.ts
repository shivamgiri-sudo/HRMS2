import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SELF_EDITABLE_PERSONAL_COLUMNS } from '../fieldOwnership.js';

// ── Task 1: employment_status case consistency ──────────────────────────────
describe('activateEmployee — employment_status case', () => {
  it('activation SQL must write capital-A Active, matching payroll/attendance filters', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee-activation.service.ts'),
      'utf8'
    );
    expect(src).toContain("employment_status = 'Active'");
  });
});

// ── Task 2: userId must not be patchable via updateEmployee ──────────────────
describe('updateEmployeeSchema — userId not patchable', () => {
  it('updateEmployeeSchema must not contain userId field', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.validation.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/userId\s*:\s*z\.string\(\)\.uuid\(\)/);
  });

  it('updateEmployee service must not build a user_id SET clause from input.userId', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.service.ts'),
      'utf8'
    );
    expect(src).not.toMatch(/input\.userId[^}]+user_id\s*=\s*\?/);
  });
});

// ── Task 3: official_email must not be self-serviceable ──────────────────────
describe('PATCH /me — official_email not self-serviceable', () => {
  // These assertions used to read employee.profile.service.ts, which has NO importer:
  // `updateMyProfile` exists in three places and only the inline router.patch("/me")
  // handler in employee.routes.ts is routed. The other two (employee.profile.service.ts,
  // employee.controller.ts) are unreachable, so guarding them proved nothing about the
  // live endpoint. Read the routed handler instead.
  const routeSrc = () =>
    fs.readFileSync(path.resolve(__dirname, '../employee.routes.ts'), 'utf8');

  /** The body of the routed PATCH /me handler, isolated from the rest of the file. */
  function patchMeHandler(): string {
    const src = routeSrc();
    const startIdx = src.indexOf('router.patch("/me"');
    expect(startIdx, 'routed PATCH /me handler not found in employee.routes.ts').toBeGreaterThan(-1);
    const endIdx = src.indexOf('\n}));', startIdx) + 5;
    return src.slice(startIdx, endIdx);
  }

  it('rejects official_email with a 403 before building any UPDATE', () => {
    const section = patchMeHandler();
    expect(section).toMatch(/req\.body\.official_email\s*!==\s*undefined/);
    expect(section).toMatch(/status\(403\)/);
  });

  it('never writes the official_email column', () => {
    expect(patchMeHandler()).not.toMatch(/official_email\s*=\s*\?/);
  });

  it('builds its UPDATE from an allowlist, not from arbitrary req.body keys', () => {
    const section = patchMeHandler();
    expect(section).toContain('ALLOWED_FIELDS');
    // The SET clause must iterate the allowlist. Iterating req.body directly would
    // let any column through, which is the defect the 403 above only partially covers.
    expect(section).toMatch(/for\s*\(\s*const\s+field\s+of\s+ALLOWED_FIELDS\s*\)/);
    expect(section).not.toMatch(/Object\.keys\(\s*req\.body\s*\)/);
  });

  // ALLOWED_FIELDS is now sourced from fieldOwnership.ts's SELF_EDITABLE_PERSONAL_COLUMNS
  // (see that file — the single source of truth this replaced three disagreeing allowlists
  // with), rather than a literal array in this file, so this asserts against the real,
  // live-imported value instead of regex-slicing a moving target string.
  it('the live field-ownership matrix does not mark official_email as employee-editable', () => {
    expect(SELF_EDITABLE_PERSONAL_COLUMNS).not.toContain('official_email');
  });
});

// ── Task 4: statutory-details must go through approval ───────────────────────
describe('PUT /me/statutory-details — approval gate', () => {
  it('route handler must not directly write to employee_statutory_info', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.routes.ts'),
      'utf8'
    );
    const startIdx = src.indexOf('router.put("/me/statutory-details"');
    const endIdx = src.indexOf('\n}));', startIdx) + 5;
    const section = src.slice(startIdx, endIdx);
    expect(section).not.toContain('employee_statutory_info');
    expect(section).toContain('submitStatutoryDetailsForApproval');
  });

  it('profile-approval.service must export submitStatutoryDetailsForApproval', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../profile-approval.service.ts'),
      'utf8'
    );
    expect(src).toContain('export async function submitStatutoryDetailsForApproval(');
    expect(src).toContain("'statutory_details'");
  });
});

// ── Task 5: PUT /me/bank-details must not bypass approval ───────────────────
describe('PUT /me/bank-details — tombstoned', () => {
  it('route handler returns 410 and does not directly write to employee_bank_detail', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.routes.ts'),
      'utf8'
    );
    const startIdx = src.indexOf('router.put("/me/bank-details"');
    const endIdx = src.indexOf('\n}));', startIdx) + 5;
    const section = src.slice(startIdx, endIdx);
    expect(section).toContain('410');
    expect(section).not.toContain('INSERT INTO employee_bank_detail');
    expect(section).not.toContain('UPDATE employee_bank_detail');
  });
});

// ── Task 6: promotion approval must be transactional ────────────────────────
describe('mobility.service — updatePromotion is transactional', () => {
  it('updatePromotion source must use a transaction', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../mobility/mobility.service.ts'),
      'utf8'
    );
    const promotionSection = src.slice(src.indexOf('async updatePromotion('));
    expect(promotionSection).toMatch(/beginTransaction|START TRANSACTION/);
    expect(promotionSection).toMatch(/commit|COMMIT/);
    expect(promotionSection).toMatch(/rollback|ROLLBACK/);
  });
});

// ── Task 7: transfer NULL-safe master lookup ────────────────────────────────
describe('mobility.service — applyTransferToEmployee is NULL-safe', () => {
  it('must not use inline correlated subquery that could silently null the FK', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../mobility/mobility.service.ts'),
      'utf8'
    );
    const applyFn = src.slice(src.indexOf('async applyTransferToEmployee('));
    expect(applyFn).not.toMatch(/branch_id\s*=\s*\(SELECT\s+id\s+FROM\s+branch_master/);
    expect(applyFn).not.toMatch(/department_id\s*=\s*\(SELECT\s+id\s+FROM\s+department_master/);
    expect(applyFn).not.toMatch(/designation_id\s*=\s*\(SELECT\s+id\s+FROM\s+designation_master/);
    expect(applyFn).not.toMatch(/process_id\s*=\s*\(SELECT\s+id\s+FROM\s+process_master/);
  });

  it('must throw when master lookup returns null instead of silently nulling FK', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../mobility/mobility.service.ts'),
      'utf8'
    );
    const applyFn = src.slice(src.indexOf('async applyTransferToEmployee('));
    expect(applyFn).toContain('not found in branch_master');
    expect(applyFn).toContain('not found in department_master');
    expect(applyFn).toContain('not found in designation_master');
    expect(applyFn).toContain('not found in process_master');
  });
});

// ── Task 8: exit propagation completeness ───────────────────────────────────
/**
 * These three read the `exited` branch of exit.service.ts as source text.
 *
 * They used to slice a fixed character count from the anchor, which measures prose as well
 * as code: a later session added an explanatory comment inside the branch and pushed
 * `date_of_exit` from inside the 2,000-char window to 2,444 chars away, so the guard began
 * failing on main while the behaviour it protects was still perfectly correct. A test that
 * breaks when someone writes a comment trains people to ignore it.
 *
 * Comments are now stripped before the window is taken, so the distance measured is code,
 * and the window runs to the end of the file rather than a magic number.
 */
const exitedBranch = (): string => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../exit/exit.service.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const i = code.indexOf('nextStatus === "exited"');
  expect(i, 'the exited branch is gone from exit.service.ts').toBeGreaterThan(-1);
  return code.slice(i);
};

describe('exit.service — exited status propagation', () => {
  it('exit.service must set date_of_exit on employees on exited', () => {
    // Asserts the actual write, not that the string appears somewhere nearby: the point is
    // that the employees row is stamped, and `date_of_exit` could otherwise be satisfied by
    // a SELECT or an unrelated table.
    expect(exitedBranch()).toMatch(/UPDATE\s+employees[\s\S]{0,400}?date_of_exit\s*=/);
  });

  /**
   * These two asserted `leave_requests` and `employee_asset_assignment` appeared near the
   * anchor. Both did — inside a COMMENT, and specifically inside the comment explaining that
   * those very statements had been REMOVED because they named tables that do not exist. So
   * the guards went green off the removal note describing their own deletion. Stripping
   * comments exposed it: neither term occurs in the branch's code at all.
   *
   * They now assert the mechanism that actually replaced those statements —
   * deprovisionEmployeeAccess — so they fail if exit stops revoking access, rather than if
   * someone edits a comment.
   *
   * The behaviour itself was never lost, only moved: the inline statements named
   * `leave_requests` (plural) and `employee_asset_assignment`, neither of which exists, so
   * they had never worked. employeeDeprovisioning.ts does both properly against the real
   * `leave_request` (singular) table, and routes cancellation through the balance-restore
   * path rather than flipping status directly. Asserting the call therefore covers strictly
   * more than the two dead statements did.
   */
  it('exit.service revokes access on exited via deprovisionEmployeeAccess', () => {
    expect(exitedBranch()).toMatch(/await\s+deprovisionEmployeeAccess\s*\(/);
  });

  it('exit.service revokes live sessions on exited', () => {
    expect(exitedBranch()).toMatch(/await\s+revokeSessionsForEmployee\s*\(/);
  });

  it('exit.service must create clearance tasks for all exit paths including exited', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../exit/exit.service.ts'),
      'utf8'
    );
    // Find the line that calls createDefaultClearanceTasks with the status check
    const clearanceLine = src.split('\n').find(
      (l) => l.includes('accepted') && l.includes('notice_serving') && l.includes('exited')
    );
    expect(clearanceLine).toBeDefined();
  });
});

// ── Task 9: BGV scope — HR without branch_id must not see all ──────────────
describe('canViewEmployeeBgv — HR without branch_id', () => {
  it('HR without branch_id must return false, not true', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee-bgv.service.ts'),
      'utf8'
    );
    expect(src).not.toContain('HR without branch restriction can view all');
    const canViewFn = src.slice(src.indexOf('export async function canViewEmployeeBgv('));
    expect(canViewFn).not.toMatch(/return true;\s*\/\/ HR without/);
    expect(canViewFn).toMatch(/if\s*\(\s*!actorScope\.branch_id\s*\)\s*return false/);
  });
});

// ── Task 10: createEmployee email duplicate guard ───────────────────────────
describe('employee.service — createEmployee duplicate guards', () => {
  it('createEmployee must check for duplicate email in employees table before INSERT', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.service.ts'),
      'utf8'
    );
    const createFn = src.slice(src.indexOf('async createEmployee('));
    const insertIdx = createFn.indexOf('INSERT INTO employees');
    const preamble = createFn.slice(0, insertIdx);
    expect(preamble).toMatch(/email.*employees|employees.*email/);
  });
});

// ── Task 11: Absconded/Terminated not settable via updateEmployee ────────────
describe('updateEmployeeSchema — no bypass of exit module', () => {
  it('Absconded and Terminated must not be in employmentStatus enum of updateEmployeeSchema', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.validation.ts'),
      'utf8'
    );
    const enumLine = src.split('\n').find(
      (l) => l.includes('employmentStatus') && l.includes('z.enum')
    );
    expect(enumLine).toBeDefined();
    expect(enumLine).not.toContain('Absconded');
    expect(enumLine).not.toContain('Terminated');
  });
});
