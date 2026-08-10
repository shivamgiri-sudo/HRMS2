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
  it('updateMyProfile must not contain officialEmailSet/officialEmailValues variables', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.profile.service.ts'),
      'utf8'
    );
    expect(src).not.toContain('officialEmailSet');
    expect(src).not.toContain('officialEmailValues');
  });

  it('updateMyProfile must not write official_email column in UPDATE statement', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../employee.profile.service.ts'),
      'utf8'
    );
    const updateFnIdx = src.indexOf('async updateMyProfile(');
    const updateFnSection = src.slice(updateFnIdx, updateFnIdx + 2000);
    expect(updateFnSection).not.toMatch(/official_email\s*=\s*\?/);
  });
});
