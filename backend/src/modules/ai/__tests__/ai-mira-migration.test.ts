import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('Mira reimbursement migration governance', () => {
  it('registers the reimbursement schema in the governed migration manifest', () => {
    const runner = source('../../../db/runPendingMigrations.ts');
    expect(runner).toContain('424_employee_reimbursement_claim.sql');
  });

  it('verifies schema version on production verify-only startup', () => {
    const server = source('../../../server.ts');
    expect(server).toContain('verifySchemaVersion');
  });

  it('includes schema verification in the migration CLI status and completion path', () => {
    const migrate = source('../../../scripts/migrate.ts');
    expect(migrate).toContain('verifySchemaVersion');
  });

  it('defines the reimbursement table through an idempotent migration', () => {
    const migration = source('../../../../sql/424_employee_reimbursement_claim.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS employee_reimbursement_claim');
    expect(migration).toContain('KEY idx_erc_emp (employee_id)');
    expect(migration).toContain("ENUM('draft','submitted','approved','rejected','processed')");
  });
});
