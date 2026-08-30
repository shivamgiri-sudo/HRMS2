// backend/src/db/__tests__/canonical-productivity-store-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

// Strips SQL line comments ("-- ...") before checking for the ABSENCE of a pattern. This
// migration's own header carries a "ROLLBACK:" comment block documenting DROP TABLE / DROP
// COLUMN statements a human would run to undo it, and a "campaign_master's two PRE-EXISTING
// FOREIGN KEYs" note — both legitimate prose that would otherwise false-positive against a
// naive whole-file regex asserting "no DROP" / "no FOREIGN KEY". Presence checks (toContain)
// don't need this since they're looking for real content, not policing its absence.
function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

describe('canonical productivity store migration (1637)', () => {
  it('guards all three campaign_master ALTERs on information_schema (no bare ADD COLUMN IF NOT EXISTS)', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    // Comment-stripped: the header explains WHY the guard exists ("ADD COLUMN IF NOT EXISTS is
    // invalid MySQL 8 syntax"), which legitimately contains the phrase this asserts is absent
    // from the executable SQL.
    expect(stripSqlComments(sql)).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    expect((sql.match(/PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;/g) || []).length).toBe(3);
  });

  it('adds dialler_source_id, owning_branch_id and is_sentinel to campaign_master', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('ADD COLUMN dialler_source_id CHAR(36) NULL');
    expect(sql).toContain('ADD COLUMN owning_branch_id CHAR(36) NULL');
    expect(sql).toContain("ADD COLUMN is_sentinel TINYINT(1) NOT NULL DEFAULT 0");
  });

  it('does not touch campaign_master\'s existing FOREIGN KEYs (only ADD COLUMN statements against it)', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    const active = stripSqlComments(sql);
    // Matches an actual FOREIGN KEY constraint declaration ("FOREIGN KEY (col)"), not prose that
    // merely mentions the phrase — this migration's own header comment legitimately says
    // "campaign_master's two PRE-EXISTING FOREIGN KEYs" while adding none itself. Checked
    // against the comment-stripped SQL so that prose doesn't false-positive the check.
    expect(active).not.toMatch(/FOREIGN KEY\s*\(/i);
    // Same reasoning: the ROLLBACK comment block legitimately documents "DROP TABLE ..." /
    // "DROP COLUMN ..." as the undo instructions — this checks no such statement actually runs.
    expect(active).not.toMatch(/DROP\s+(COLUMN|CONSTRAINT|FOREIGN KEY|TABLE)/i);
  });

  it('declares attendance_productive_day keyed (employee_id, work_date) with canonical_minutes nullable', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('PRIMARY KEY (employee_id, work_date)');
    expect(sql).toContain('canonical_minutes    SMALLINT UNSIGNED NULL');
  });

  it('declares attendance_productive_contribution with the supersession column and a uniqueness key covering feed + source_row_ref', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect(sql).toContain('superseded_at      DATETIME     NULL');
    expect(sql).toContain('UNIQUE KEY uq_apc (employee_id, work_date, dialler_source_id, feed, source_row_ref)');
  });

  it('declares COLLATE=utf8mb4_unicode_ci and ENGINE=InnoDB on both new tables', () => {
    const sql = readMigration('1637_canonical_productivity_store.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });
});
