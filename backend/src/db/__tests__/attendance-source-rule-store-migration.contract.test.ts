import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

describe('attendance source rule store migrations (1633-1635)', () => {
  it('1633 declares attendance_source_rule with the ENUM and COLLATE this design requires', () => {
    const sql = readMigration('1633_attendance_source_rule_store.sql');
    expect(sql).toContain("attendance_source ENUM('dialler','biometric') NOT NULL");
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });

  it('1633 declares the dimension_value child table keyed (rule_id, dimension, value_id)', () => {
    const sql = readMigration('1633_attendance_source_rule_store.sql');
    expect(sql).toContain('PRIMARY KEY (rule_id, dimension, value_id)');
  });

  it('1634 declares day_threshold_rule with all three threshold columns', () => {
    const sql = readMigration('1634_day_threshold_rule_store.sql');
    expect(sql).toContain('full_day_minutes  SMALLINT UNSIGNED NOT NULL');
    expect(sql).toContain('half_day_minutes  SMALLINT UNSIGNED NOT NULL');
    expect(sql).toContain('grace_minutes     SMALLINT UNSIGNED NOT NULL');
  });

  it('1635 declares attendance_threshold_rule with the three-kind ENUM', () => {
    const sql = readMigration('1635_attendance_threshold_and_ceiling_store.sql');
    expect(sql).toContain(
      "threshold_kind    ENUM('apr_corroboration','variance_tolerance','floor_absence_ceiling') NOT NULL",
    );
  });

  it('1635 declares attendance_dual_review_ceiling scoped to branch + pay_month, not the six dimensions', () => {
    const sql = readMigration('1635_attendance_threshold_and_ceiling_store.sql');
    expect(sql).toContain('branch_id     CHAR(36)     NULL');
    expect(sql).toContain("pay_month     VARCHAR(7)   NULL");
    expect(sql).toContain('UNIQUE KEY uq_adrc_scope (branch_id, pay_month)');
  });

  it('1634 declares utf8mb4_unicode_ci COLLATE and ENGINE=InnoDB on both its tables', () => {
    const sql = readMigration('1634_day_threshold_rule_store.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(2);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(2);
  });

  it('1635 declares utf8mb4_unicode_ci COLLATE and ENGINE=InnoDB on all three of its tables', () => {
    const sql = readMigration('1635_attendance_threshold_and_ceiling_store.sql');
    expect((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length).toBe(3);
    expect((sql.match(/ENGINE=InnoDB/g) || []).length).toBe(3);
  });

  it('none of the three migrations use a FOREIGN KEY constraint', () => {
    for (const file of [
      '1633_attendance_source_rule_store.sql',
      '1634_day_threshold_rule_store.sql',
      '1635_attendance_threshold_and_ceiling_store.sql',
    ]) {
      expect(readMigration(file)).not.toMatch(/FOREIGN KEY/i);
    }
  });
});
