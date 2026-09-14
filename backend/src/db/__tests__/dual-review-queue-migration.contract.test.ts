// backend/src/db/__tests__/dual-review-queue-migration.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(__dirname, '../../../sql');
const MIGRATION = '1643_dual_review_queue.sql';

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

/**
 * The executable statements only. This file's header comment DISCUSSES the two things the
 * assertions below forbid -- it explains why `ADD COLUMN IF NOT EXISTS` is not used and why
 * there is no FOREIGN KEY -- so a whole-file substring check would read the explanation as
 * the value and fail for the wrong reason. Same reasoning as
 * wfm-productivity-upload-page-access-migration.contract.test.ts.
 */
function statementsOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

const sql = readMigration(MIGRATION);
const statements = statementsOnly(sql);

/**
 * Criterion 7.11's list, column by column. Each entry is the column and the criterion it
 * serves; a column silently dropped from the migration fails here by name rather than being
 * noticed months later as a missing field on the queue screen.
 */
const ADDED_COLUMNS: Array<[column: string, why: string]> = [
  // Reviewer slot 1 -- the existing reviewed_by / reviewed_at pair.
  ['first_reviewer_role', '7.11 Reviewer_Role of the existing reviewer slot'],
  ['first_review_outcome', '7.3 Review_Outcome per reviewer'],
  ['first_review_comment', '7.3/7.4 reviewer comment per reviewer'],
  // Reviewer slot 2 -- the second identity and timestamp 7.11 names.
  ['second_reviewer_user_id', '7.11 second reviewer identity'],
  ['second_reviewed_at', '7.11 second reviewer timestamp'],
  ['second_reviewer_role', '7.11 Reviewer_Role of the second slot'],
  ['second_review_outcome', '7.3 Review_Outcome per reviewer'],
  ['second_review_comment', '7.3/7.4 reviewer comment per reviewer'],
  // Contested (7.10). The state itself is the new status enum value.
  ['contested_at', '7.10 contested state'],
  ['override_approver_user_id', '7.10 Override_Approver routing target'],
  // Escalation (7.8, 7.9).
  ['presented_at', '7.8 start of the escalation clock'],
  ['escalation_age_days', '7.8/7.9 escalation age'],
  ['escalation_interval_days', '7.8 escalation interval'],
  ['last_escalated_at', '7.8 once-per-interval idempotence'],
  // Ranking and queue state (6.8, 6.9, 6.11, 7.1).
  ['variance_risk_score', '7.11 Variance_Risk_Score'],
  ['queue_state', '7.1/7.11 Queue_State'],
  ['is_floor_absence', '6.8 always-queue irrespective of the ceiling'],
  // Criterion 7.6 substitution.
  ['manager_substitution_applied', '7.6 substitution occurred'],
  ['substitute_spoc_user_id', '7.6 who stood in'],
  // Evidence snapshot (6.3, 7.2).
  ['biometric_minutes', '7.2 evidence snapshot'],
  ['canonical_productive_minutes', '7.2 evidence snapshot'],
  ['applied_corroboration_threshold', '7.2 applied APR_Corroboration_Threshold'],
  ['applied_variance_tolerance', '6.3 applied Variance_Tolerance'],
  ['resolved_attendance_source', '7.2 resolved Attendance_Source'],
  ['deciding_rule_id', '6.3 deciding Attendance_Source_Rule'],
  // Pay_Month (9.3).
  ['pay_month', '9.3 Pay_Month scope'],
  ['carried_forward_from_pay_month', '9.3 carried forward from Pay_Month'],
];

const EXISTING_STATUS_VALUES = [
  'open',
  'notified',
  'reviewed',
  'no_issue',
  'regularization_required',
];

describe('Dual_Review queue migration (1643) -- columns added', () => {
  it.each(ADDED_COLUMNS)('adds %s (%s)', (column) => {
    expect(statements).toContain(`ADD COLUMN ${column} `);
  });

  it('adds every column to payroll_attendance_conflict_review and no other table', () => {
    const altered = new Set(
      [...statements.matchAll(/ALTER TABLE (\w+)/g)].map((m) => m[1]!),
    );
    expect([...altered]).toEqual(['payroll_attendance_conflict_review']);
  });
});

describe('Dual_Review queue migration (1643) -- information_schema guards', () => {
  // ADD COLUMN IF NOT EXISTS is MariaDB syntax. MySQL 8 rejects it at parse time while the
  // runner still records the file as applied, which is how migration 1064 was lost. Every
  // ADD COLUMN therefore needs its own information_schema.columns guard, and there must be at
  // least as many guards as there are ADD COLUMNs -- one shared guard over several columns
  // would replay wrongly on a partially applied table.
  it('guards every ADD COLUMN on information_schema.columns', () => {
    const addColumns = [...statements.matchAll(/ADD COLUMN (\w+) /g)].map((m) => m[1]!);
    expect(addColumns.length).toBe(ADDED_COLUMNS.length);

    const guardedColumns = [
      ...statements.matchAll(
        /information_schema\.columns[\s\S]{0,240}?column_name = '(\w+)'/g,
      ),
    ].map((m) => m[1]!);

    for (const column of addColumns) {
      expect(guardedColumns, `${column} has no information_schema guard`).toContain(column);
    }
  });

  it('wraps every guard in PREPARE / EXECUTE / DEALLOCATE', () => {
    const prepares = statements.match(/PREPARE stmt FROM @sql/g) ?? [];
    const executes = statements.match(/EXECUTE stmt/g) ?? [];
    const deallocs = statements.match(/DEALLOCATE PREPARE stmt/g) ?? [];
    // 27 columns + 2 indexes + the status MODIFY.
    expect(prepares.length).toBe(ADDED_COLUMNS.length + 3);
    expect(executes.length).toBe(prepares.length);
    expect(deallocs.length).toBe(prepares.length);
  });

  it('guards both added indexes on information_schema.statistics', () => {
    const indexes = [...statements.matchAll(/ADD INDEX (\w+) /g)].map((m) => m[1]!);
    expect(indexes.length).toBeGreaterThan(0);
    for (const index of indexes) {
      expect(statements).toContain(`index_name = '${index}'`);
    }
    const statsGuards = statements.match(/information_schema\.statistics/g) ?? [];
    expect(statsGuards.length).toBe(indexes.length);
  });

  it('never uses ADD COLUMN IF NOT EXISTS', () => {
    expect(statements).not.toMatch(/ADD COLUMN IF NOT EXISTS/i);
    // The header must still explain why, so the next person does not reintroduce it.
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
  });
});

describe('Dual_Review queue migration (1643) -- status enum', () => {
  // Criterion 7.10 needs a contested state. MODIFY COLUMN restates the WHOLE value list, so
  // omitting one of the five existing values would orphan the rows holding it (209 rows are
  // 'reviewed', 59 are 'notified').
  it('keeps all five existing status values and adds contested', () => {
    const modify = statements.match(
      /MODIFY COLUMN status\s*\n?\s*ENUM\(([^)]*)\)/,
    );
    expect(modify, 'no MODIFY COLUMN status found').toBeTruthy();
    const values = [...modify![1]!.matchAll(/''(\w+)''/g)].map((m) => m[1]!);
    expect(values.sort()).toEqual([...EXISTING_STATUS_VALUES, 'contested'].sort());
    expect(values).toHaveLength(6);
  });

  it('modifies the enum rather than adding a parallel contested flag', () => {
    // Two independently writable representations of one state can disagree.
    expect(statements).not.toMatch(/ADD COLUMN contested /);
    expect(statements).toContain('MODIFY COLUMN status');
  });

  it('skips the MODIFY on replay by testing column_type', () => {
    expect(statements).toContain("column_type LIKE '%contested%'");
  });
});

describe('Dual_Review queue migration (1643) -- fixed vocabulary', () => {
  it('spells the Review_Outcome vocabulary exactly once per reviewer slot', () => {
    const outcomeEnums = statements.match(
      /ENUM\(''apr_accepted'',''apr_disputed'',''adjustment_requested''\)/g,
    ) ?? [];
    expect(outcomeEnums.length).toBe(2);
  });

  it('uses the Queue_State vocabulary', () => {
    expect(statements).toContain(
      "ENUM(''queued_for_dual_review'',''recorded_not_queued'')",
    );
  });

  it('uses the Reviewer_Role vocabulary', () => {
    const roleEnums = statements.match(
      /ENUM\(''wfm_reviewer'',''reporting_manager''\)/g,
    ) ?? [];
    // One per reviewer slot on the queue table.
    expect(roleEnums.length).toBe(2);
    // Plus the requesting reviewer on the adjustment-request table, which is a plain
    // CREATE TABLE and therefore not single-quote-doubled.
    expect(statements).toContain("ENUM('wfm_reviewer','reporting_manager')");
  });

  it('applies criterion 7.9 default escalation age of three whole days', () => {
    expect(statements).toMatch(/escalation_age_days SMALLINT UNSIGNED NULL DEFAULT 3/);
  });

  it('stores the Variance_Risk_Score as a signed type', () => {
    // Biometric_Minutes minus Canonical_Productive_Minutes is negative under criterion 6.4.
    // UNSIGNED would wrap and put the least risky records at the top of 6.9's ranking.
    expect(statements).toMatch(/ADD COLUMN variance_risk_score INT NULL/);
    expect(statements).not.toMatch(/variance_risk_score INT UNSIGNED/);
  });
});

describe('Dual_Review queue migration (1643) -- collation and keys', () => {
  it('declares no FOREIGN KEY', () => {
    expect(statements).not.toMatch(/FOREIGN KEY/i);
    expect(statements).not.toMatch(/REFERENCES /i);
  });

  // A bare CHARSET=utf8mb4 resolves to the SERVER default on MySQL 8, and joining such a
  // column against auth_user or employees is a hard errno 1267. Migration 1627 exists only to
  // repair the 49 tables that already hit this.
  it('gives every added string column an explicit COLLATE utf8mb4_unicode_ci', () => {
    const stringColumns = [
      ...statements.matchAll(
        /ADD COLUMN (\w+) (CHAR\(\d+\)|VARCHAR\(\d+\)|TEXT|ENUM\([^)]*\))([^\n]*)/g,
      ),
    ];
    expect(stringColumns.length).toBeGreaterThan(0);
    for (const match of stringColumns) {
      const column = match[1]!;
      const tail = match[3]!;
      const next = statements.slice(match.index! + match[0].length, match.index! + match[0].length + 120);
      expect(
        `${tail}${next}`,
        `${column} has no explicit COLLATE utf8mb4_unicode_ci`,
      ).toContain('COLLATE utf8mb4_unicode_ci');
    }
  });

  it('gives every string column of the new table an explicit COLLATE', () => {
    const create = statements.slice(
      statements.indexOf('CREATE TABLE IF NOT EXISTS attendance_adjustment_request'),
    );
    const stringColumns = [
      ...create.matchAll(
        /^\s{2}(\w+)\s+(CHAR\(\d+\)|VARCHAR\(\d+\)|TEXT|ENUM\([^)]*\))([^\n]*)/gm,
      ),
    ];
    expect(stringColumns.length).toBeGreaterThan(0);
    for (const match of stringColumns) {
      expect(match[3]!, `${match[1]!} has no explicit COLLATE`).toContain(
        'COLLATE utf8mb4_unicode_ci',
      );
    }
  });

  // 537 declared no CHARSET and this table is absent from 1627's repair sweep, so `status`
  // currently carries the server default. Restating a collation on the MODIFY would convert
  // that one column away from the rest of its own table.
  it('does not restate a collation on the pre-existing status column', () => {
    const modifyBlock = statements.slice(statements.indexOf('MODIFY COLUMN status'));
    const upToEnd = modifyBlock.slice(0, modifyBlock.indexOf('DEALLOCATE'));
    expect(upToEnd).not.toContain('COLLATE');
  });
});

describe('Dual_Review queue migration (1643) -- adjustment request table', () => {
  const REQUEST_COLUMNS = [
    'variance_record_id',
    'employee_id',
    'target_date',
    'target_pay_month',
    'requested_classification',
    'requesting_user_id',
    'justification',
    'approval_state',
    'approver_user_id',
    'approved_at',
    'superseded_classification',
    'arrear_pay_month',
  ];

  it('creates attendance_adjustment_request idempotently', () => {
    expect(statements).toContain(
      'CREATE TABLE IF NOT EXISTS attendance_adjustment_request',
    );
  });

  it.each(REQUEST_COLUMNS)('holds %s', (column) => {
    const create = statements.slice(
      statements.indexOf('CREATE TABLE IF NOT EXISTS attendance_adjustment_request'),
    );
    expect(create).toMatch(new RegExp(`^\\s{2}${column}\\s`, 'm'));
  });

  // Criterion 8.2: the request is distinct from the Review_Outcome, so requester and approver
  // are separate columns -- which is what makes criterion 8.5 (same user may not be both)
  // auditable from this table alone rather than only from a log.
  it('records requester and approver separately, both indexed', () => {
    const create = statements.slice(
      statements.indexOf('CREATE TABLE IF NOT EXISTS attendance_adjustment_request'),
    );
    expect(create).toContain('idx_aar_requester (requesting_user_id)');
    expect(create).toContain('idx_aar_approver (approver_user_id)');
  });

  // Criterion 8.3/8.7: the superseded classification is what makes an approved adjustment
  // reversible, so it cannot be optional to the shape of the table.
  it('records the superseded classification and its lwp value', () => {
    expect(statements).toContain('superseded_classification');
    expect(statements).toContain('superseded_lwp_value');
  });

  it('holds the three approval states', () => {
    expect(statements).toContain(
      "ENUM('pending','approved','rejected')",
    );
  });
});

describe('Dual_Review queue migration (1643) -- idempotence, rollback, registration', () => {
  it('touches no existing row', () => {
    // Criterion 7.12 maps the 268 existing rows in a LATER phase. This migration must not
    // pre-empt it, and must not be able to lose one.
    expect(statements).not.toMatch(/\bDELETE\b/i);
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/\bUPDATE payroll_attendance_conflict_review\b/i);
    expect(statements).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('states a ROLLBACK block naming every DROP COLUMN and DROP TABLE', () => {
    const header = sql
      .split('\n')
      .filter((line) => line.trimStart().startsWith('--'))
      .join('\n');
    expect(header).toContain('ROLLBACK');
    expect(header).toContain('DROP TABLE attendance_adjustment_request;');

    const dropped = [...header.matchAll(/DROP COLUMN (\w+)/g)].map((m) => m[1]!);
    for (const [column] of ADDED_COLUMNS) {
      expect(dropped, `ROLLBACK does not drop ${column}`).toContain(column);
    }
    expect(dropped).toHaveLength(ADDED_COLUMNS.length);

    for (const index of [...statements.matchAll(/ADD INDEX (\w+) /g)].map((m) => m[1]!)) {
      expect(header).toContain(`DROP INDEX ${index}`);
    }
  });

  it('states that it is not yet executed and needs owner approval', () => {
    expect(sql).toContain('NOT YET EXECUTED');
    expect(sql).toMatch(/owner approval/i);
  });

  it('states that it is additive so the 268 existing rows keep working', () => {
    expect(sql).toContain('268');
    expect(sql).toMatch(/ADDITIVE ONLY/);
  });

  it('is registered in MIGRATION_MANIFEST', () => {
    const runner = readFileSync(
      join(__dirname, '..', 'runPendingMigrations.ts'),
      'utf-8',
    );
    const start = runner.indexOf('MIGRATION_MANIFEST');
    const end = runner.indexOf('export type MigrationHealth');
    const manifest = runner.slice(start, end);
    expect(manifest).toContain(`"${MIGRATION}"`);
  });
});
