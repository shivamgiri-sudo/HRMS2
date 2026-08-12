import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
    const allowlist = section.slice(
      section.indexOf('ALLOWED_FIELDS'),
      section.indexOf(']', section.indexOf('ALLOWED_FIELDS')),
    );
    expect(allowlist).not.toContain('official_email');
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
describe('exit.service — exited status propagation', () => {
  it('exit.service must set date_of_exit on employees on exited', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../exit/exit.service.ts'),
      'utf8'
    );
    const exitedBlock = src.slice(
      src.indexOf('nextStatus === "exited"'),
      src.indexOf('nextStatus === "exited"') + 2000
    );
    expect(exitedBlock).toContain('date_of_exit');
  });

  it('exit.service must cancel open leave requests on exited', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../exit/exit.service.ts'),
      'utf8'
    );
    const exitedBlock = src.slice(
      src.indexOf('nextStatus === "exited"'),
      src.indexOf('nextStatus === "exited"') + 5000
    );
    expect(exitedBlock).toMatch(/leave_requests|leave_request/);
  });

  it('exit.service must flag asset assignments on exited', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../exit/exit.service.ts'),
      'utf8'
    );
    const exitedBlock = src.slice(
      src.indexOf('nextStatus === "exited"'),
      src.indexOf('nextStatus === "exited"') + 5000
    );
    expect(exitedBlock).toMatch(/asset_assignment|employee_asset_assignment/);
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
