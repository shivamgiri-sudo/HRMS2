import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

// NOTE: this used to check a separate, ungoverned runFinanceSupplementalMigrations.ts /
// verifyFinanceSupplementalMigrations() pair. That runner (and its schema-hardening sibling)
// was retired once its coverage was confirmed fully redundant with the single governed
// MIGRATION_MANIFEST in runPendingMigrations.ts — see the finance stabilization work. Same
// intent (the reimbursement migration is registered and verified at startup/CLI), now checked
// against the one remaining source of truth.
describe('Mira reimbursement migration governance', () => {
  it('registers the reimbursement schema in the governed migration manifest', () => {
    const manifest = source('../../../db/runPendingMigrations.ts');
    expect(manifest).toContain('424_employee_reimbursement_claim.sql');
    expect(manifest).toContain('verifySchemaVersion');
  });

  it('enforces schema verification in production verify-only startup', () => {
    const server = source('../../../server.ts');
    expect(server).toContain('verifySchemaVersion');
    expect(server).toContain('schemaStatus.valid');
  });

  it('includes schema verification in the migration CLI status and completion path', () => {
    const migrate = source('../../../scripts/migrate.ts');
    expect(migrate).toContain('verifySchemaVersion');
    expect(migrate).toContain('Migrations pending');
    expect(migrate).toContain('Migration failed');
  });

  it('defines the reimbursement table through an idempotent migration', () => {
    const migration = source('../../../../sql/424_employee_reimbursement_claim.sql');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS employee_reimbursement_claim');
    expect(migration).toContain('KEY idx_erc_emp (employee_id)');
    expect(migration).toContain("ENUM('draft','submitted','approved','rejected','processed')");
  });
});
