// backend/src/db/__tests__/attendance-rule-migration-proposal-store.contract.test.ts
//
// Migration 1642, the Requirement 15 proposal store. Asserts the conventions that have each
// broken a deploy on this codebase at least once, so a future edit to the file cannot
// reintroduce them:
//   - the seven tables the builder's output maps onto
//   - an explicit COLLATE on every string column (a bare CHARSET=utf8mb4 takes the SERVER
//     default utf8mb4_0900_ai_ci, and a later join is then a hard errno 1267 - migration 1627
//     exists only to repair the 49 tables that already hit this)
//   - CREATE TABLE IF NOT EXISTS throughout, so a replay is a no-op
//   - no FOREIGN KEY anywhere (1500's FK to process_master is the one that blocked deploys)
//   - a ROLLBACK block naming every table, child-first
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');
const FILE = '1642_attendance_rule_migration_proposal.sql';

const RAW = readFileSync(join(SQL_DIR, FILE), 'utf-8');

/**
 * The executable statements only. The file's header explains at length why there is no FOREIGN
 * KEY and why an explicit COLLATE is mandatory, so a whole-file substring check would read the
 * explanation as the thing being explained and pass or fail for the wrong reason.
 */
const STATEMENTS = RAW.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

// Ordered child-last, which is the order the file creates them in.
const TABLES = [
  'attendance_source_rule_proposal',
  'attendance_source_rule_proposal_rule',
  'attendance_source_rule_proposal_rule_dimension_value',
  'attendance_source_rule_proposal_day_threshold',
  'attendance_source_rule_proposal_day_threshold_dimension_value',
  'attendance_source_rule_proposal_source_row',
  'attendance_source_rule_proposal_finding',
];

describe('attendance rule migration proposal store (1642)', () => {
  it('creates the seven tables the proposal builder writes into, and nothing else', () => {
    const created = [...STATEMENTS.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)].map(
      (m) => m[1]!,
    );
    expect(created.sort()).toEqual([...TABLES].sort());
    expect(created).toHaveLength(7);
  });

  it('creates every table idempotently, so a replay is a no-op', () => {
    // Any bare CREATE TABLE would abort the whole migration on the second run.
    const bare = [...STATEMENTS.matchAll(/CREATE TABLE(?! IF NOT EXISTS)/g)];
    expect(bare).toHaveLength(0);
  });

  it('declares no FOREIGN KEY, matching every other table in this feature', () => {
    expect(STATEMENTS).not.toMatch(/FOREIGN KEY/i);
    expect(STATEMENTS).not.toMatch(/\bREFERENCES\b/i);
  });

  it('carries an explicit COLLATE on every string column', () => {
    const offenders: string[] = [];
    for (const line of STATEMENTS.split('\n')) {
      // A column definition in this file is "  name TYPE ...". PRIMARY/UNIQUE/KEY lines and the
      // table-option lines do not match, and JSON / DATE / DATETIME / TINYINT / SMALLINT / INT
      // columns need no collation.
      const match = /^\s+(\w+)\s+(CHAR|VARCHAR|TEXT|ENUM)\b/i.exec(line);
      if (!match) continue;
      if (/\bKEY\b/i.test(match[1]!)) continue;
      if (!/COLLATE\s+utf8mb4_unicode_ci/i.test(line)) {
        offenders.push(line.trim());
      }
    }
    expect(
      offenders,
      'A string column with no explicit COLLATE takes the server default ' +
        '(utf8mb4_0900_ai_ci here), and a later join against a utf8mb4_unicode_ci table is a ' +
        'hard errno 1267:\n' +
        offenders.map((o) => `  - ${o}`).join('\n'),
    ).toEqual([]);
    // Sanity: the scanner found string columns at all.
    const scanned = STATEMENTS.split('\n').filter((l) =>
      /^\s+\w+\s+(CHAR|VARCHAR|TEXT|ENUM)\b/i.test(l),
    );
    expect(scanned.length).toBeGreaterThan(30);
  });

  it('sets the table collation explicitly on every table too', () => {
    const engines = [...STATEMENTS.matchAll(/ENGINE=InnoDB/g)];
    expect(engines).toHaveLength(7);
    const collations = [...STATEMENTS.matchAll(/COLLATE=utf8mb4_unicode_ci/g)];
    expect(collations).toHaveLength(7);
  });

  it('documents a ROLLBACK naming every table, children first', () => {
    expect(RAW).toContain('-- ROLLBACK');
    const dropped = [...RAW.matchAll(/DROP TABLE\s+(\w+);/g)].map((m) => m[1]!);
    expect([...dropped].sort()).toEqual([...TABLES].sort());
    // A parent dropped before its children would leave the rollback half-applied if the
    // statements were ever guarded by FKs, and reads as the wrong order regardless.
    expect(dropped.indexOf('attendance_source_rule_proposal')).toBe(dropped.length - 1);
  });

  it('uses no MariaDB-only DDL this server rejects at parse time', () => {
    // MySQL 8.0.42 rejects ADD COLUMN IF NOT EXISTS outright, which is what got 1064 dropped
    // and left 1110 unlisted.
    expect(STATEMENTS).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
  });

  it('holds the enum value sets the proposal builder produces', () => {
    // criterion 1.3 / decision A9: the existing two-value set, no rename, no third value.
    expect(STATEMENTS).toContain("ENUM('dialler','biometric')");
    expect(STATEMENTS).toContain(
      "ENUM('cost_centre','process','branch','department','designation','employment_profile')",
    );
    expect(STATEMENTS).toContain("ENUM('info','decision_required','blocking')");
    expect(STATEMENTS).toContain("ENUM('source_rule','day_threshold')");
    expect(STATEMENTS).toContain(
      "ENUM('attendance_rule_config','apr_eligibility_config','attendance_feature_config')",
    );
    expect(STATEMENTS).toContain("ENUM('draft','approved','rejected')");
  });

  it('keys each proposed rule by proposal_key, unique within a run', () => {
    // The builder derives proposal_key as the sha-256 of the canonical signature, which is what
    // makes a re-run over unchanged data diffable. CHAR(64) is that digest in hex.
    expect(STATEMENTS).toMatch(/proposal_key\s+CHAR\(64\)/);
    expect(STATEMENTS).toContain('UNIQUE KEY uq_asrpr_key (proposal_id, proposal_key)');
    expect(STATEMENTS).toContain('UNIQUE KEY uq_asrpdt_key (proposal_id, proposal_key)');
  });

  it('is registered in the migration manifest', () => {
    const manifest = readFileSync(join(__dirname, '../runPendingMigrations.ts'), 'utf-8');
    expect(manifest).toContain(`"${FILE}"`);
  });
});
