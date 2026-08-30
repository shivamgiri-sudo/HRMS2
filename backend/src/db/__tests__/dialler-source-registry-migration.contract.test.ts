// backend/src/db/__tests__/dialler-source-registry-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('dialler source registry migration (1636)', () => {
  it('declares dialler_source with the ingestion_mode ENUM this design requires', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain("ingestion_mode       ENUM('integrated_pull','manual_upload') NOT NULL");
  });

  it('declares dialler_source_column_mapping with the JSON column_mappings shape, not a row-per-pair EAV table', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain('column_mappings   JSON           NOT NULL');
    expect(sql).toContain('UNIQUE KEY uq_dscm (dialler_source_id, mapping_version)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both tables', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('declares no FOREIGN KEY anywhere', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });

  it('declares source_key as unique so a duplicate registration is rejected at the database layer too (criterion 16.2)', () => {
    const sql = readMigration('1636_dialler_source_registry.sql');
    expect(sql).toContain('UNIQUE KEY uq_dialler_source_key (source_key)');
  });
});
