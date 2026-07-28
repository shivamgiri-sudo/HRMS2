import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('Mira reimbursement migration governance', () => {
  it('registers the reimbursement schema in the startup supplemental runner', () => {
    const supplemental = source('../../../db/runFinanceSupplementalMigrations.ts');
    expect(supplemental).toContain('424_employee_reimbursement_claim.sql');
    expect(supplemental).toContain('verifyFinanceSupplementalMigrations');
  });

  it('enforces supplemental verification in production verify-only startup', () => {
    const server = source('../../../server.ts');
    expect(server).toContain('verifyFinanceSupplementalMigrations');
    expect(server).toContain('schemaStatus.valid && supplementalStatus.valid');
  });

  it('includes supplemental verification in the migration CLI status and completion path', () => {
    const migrate = source('../../../scripts/migrate.ts');
    expect(migrate).toContain('verifyFinanceSupplementalMigrations');
    expect(migrate).toContain('Supplemental migrations pending');
    expect(migrate).toContain('Supplemental migrations remain pending');
  });

  it('defines the reimbursement table through an idempotent migration', () => {
    const migration = source('../../../../sql/424_employee_reimbursement_claim.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS employee_reimbursement_claim');
    expect(migration).toContain('KEY idx_erc_emp (employee_id)');
    expect(migration).toContain("ENUM('draft','submitted','approved','rejected','processed')");
  });
});
