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
