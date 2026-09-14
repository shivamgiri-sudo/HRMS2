import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('Mira upgrade migration governance', () => {
  it('creates approved company knowledge and seeds OpenRouter safely', () => {
    const sql = source('../../../../sql/425_mira_openrouter_company_knowledge.sql');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_company_knowledge');
    expect(sql).toContain("'openrouter'");
    expect(sql).toContain('https://openrouter.ai/api/v1');
    expect(sql).toContain("'inactive'");
    expect(sql).not.toContain('sk-or-');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/TRUNCATE\s+TABLE/i);
  });

  it('runs and verifies the AI migration in startup and CLI flows', () => {
    // See ai-mira-migration.test.ts — the separate supplemental runner this used to check was
    // retired in favor of the single governed MIGRATION_MANIFEST.
    const manifest = source('../../../db/runPendingMigrations.ts');
    const manual = source('../../../../sql/000_ai_supplemental.sql');
    expect(manifest).toContain('425_mira_openrouter_company_knowledge.sql');
    expect(manifest).toContain('schema_migrations');
    expect(manual).toContain('SOURCE sql/425_mira_openrouter_company_knowledge.sql;');
  });
});
