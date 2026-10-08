// backend/src/db/__tests__/apr-manual-write-attribution-triggers.contract.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { splitSql } from '../runPendingMigrations.js';

const SQL_DIR = join(__dirname, '../../../sql');
const FILE = '1640_apr_manual_write_attribution_triggers.sql';

function readMigration(file: string): string {
  return readFileSync(join(SQL_DIR, file), 'utf-8');
}

/**
 * The executable statements only.
 *
 * This file's header comment discusses, at length, the exact strings the assertions below look for
 * ('MANUAL_UPLOAD', source = 'sync', DROP TRIGGER, ROLLBACK), because that is where the reasoning
 * about what the trigger must and must not catch lives. A whole-file substring check would read the
 * explanation as the implementation and pass for the wrong reason - the same trap the sibling
 * migration-1639 contract test documents.
 */
function statementsOnly(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

describe('apr unattributed-manual-write rejection triggers (1640)', () => {
  it('is registered in MIGRATION_MANIFEST', () => {
    const manifest = readFileSync(join(__dirname, '../runPendingMigrations.ts'), 'utf-8');
    expect(manifest).toContain(`"${FILE}"`);
  });

  it('installs both a BEFORE INSERT and a BEFORE UPDATE trigger on apr', () => {
    const sql = statementsOnly(readMigration(FILE));
    expect(sql).toMatch(/CREATE TRIGGER trg_apr_reject_unattributed_manual_insert\s+BEFORE INSERT ON apr/);
    expect(sql).toMatch(/CREATE TRIGGER trg_apr_reject_unattributed_manual_update\s+BEFORE UPDATE ON apr/);
  });

  // The reject condition, spelled out. Every disjunct is one way a row arrived unattributed in
  // production: NULL upload_batch_id (0 distinct values across all 46,163 rows), and the bare
  // 'MANUAL_UPLOAD' campaign sentinel (3,810 rows). Empty-string campaign_id is included because a
  // NOT NULL column can still hold '' and that is no more attributed than NULL.
  it('rejects a manual row with no batch id or an unregistered campaign, on both branches', () => {
    const sql = statementsOnly(readMigration(FILE));
    const rejectCondition = /NEW\.source = 'manual'\s+AND \(NEW\.upload_batch_id IS NULL\s+OR NEW\.campaign_id IS NULL\s+OR NEW\.campaign_id = ''\s+OR NEW\.campaign_id = 'MANUAL_UPLOAD'\)/g;
    expect([...sql.matchAll(rejectCondition)]).toHaveLength(2);
    expect([...sql.matchAll(/SIGNAL SQLSTATE '45000'/g)]).toHaveLength(2);
  });

  // The single most dangerous way to get this wrong: the integrated ViciDial sync
  // (apr-vicidial-sync.worker.ts) writes apr continuously with source = 'sync'. A condition that
  // caught it takes production ingestion down, so the triggers must key on 'manual' and never
  // mention 'sync' in an executable predicate.
  it('keys on source = manual only, so the integrated dialler sync cannot be caught', () => {
    const sql = statementsOnly(readMigration(FILE));
    expect(sql).not.toMatch(/source\s*(=|<>|!=)\s*'sync'/);
    expect(sql).not.toMatch(/NEW\.source\s*<>\s*'manual'/);
  });

  // The UPDATE branch fires only on a TRANSITION into an unattributed manual state. Without the
  // NOT(OLD ...) clause it would reject every future update to the 3,810 legacy rows - which are
  // unattributed by definition - including a corrected re-upload for a historical date and
  // requirement 15's own attribution backfill of exactly those rows.
  it('grandfathers the legacy rows: the UPDATE branch fires only on a transition, not on a state', () => {
    const sql = statementsOnly(readMigration(FILE));
    expect(sql).toMatch(/AND NOT \(OLD\.source = 'manual'\s+AND \(OLD\.upload_batch_id IS NULL\s+OR OLD\.campaign_id IS NULL\s+OR OLD\.campaign_id = ''\s+OR OLD\.campaign_id = 'MANUAL_UPLOAD'\)\)/);
    // The INSERT branch has no OLD row to compare against, so exactly one OLD-state clause exists.
    expect([...sql.matchAll(/OLD\.source = 'manual'/g)]).toHaveLength(1);
  });

  it('drops each trigger before creating it, so a replay redefines rather than fails', () => {
    const sql = statementsOnly(readMigration(FILE));
    for (const name of [
      'trg_apr_reject_unattributed_manual_insert',
      'trg_apr_reject_unattributed_manual_update',
    ]) {
      const dropAt = sql.indexOf(`DROP TRIGGER IF EXISTS ${name};`);
      const createAt = sql.indexOf(`CREATE TRIGGER ${name}`);
      expect(dropAt, `${name} has no DROP TRIGGER IF EXISTS`).toBeGreaterThan(-1);
      expect(createAt).toBeGreaterThan(dropAt);
    }
  });

  it('documents a ROLLBACK that drops both triggers', () => {
    const sql = readMigration(FILE);
    const rollbackAt = sql.indexOf('ROLLBACK');
    expect(rollbackAt).toBeGreaterThan(-1);
    const block = sql.slice(rollbackAt, rollbackAt + 600);
    expect(block).toContain('DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_insert;');
    expect(block).toContain('DROP TRIGGER IF EXISTS trg_apr_reject_unattributed_manual_update;');
  });

  it('states that it must ship with its paired route change', () => {
    const sql = readMigration(FILE);
    expect(sql).toContain('SAME DEPLOYMENT');
    expect(sql).toContain('attendance-apr-bulk.routes.ts');
  });

  // MySQL caps MESSAGE_TEXT at 128 characters; past that it substitutes HY000 "Data too long for
  // condition item 'MESSAGE_TEXT'", so the write is still blocked but the caller is told about
  // truncation instead of the reason. Migration 1213 hit exactly this.
  it('keeps every SIGNAL message inside MySQL 128-character MESSAGE_TEXT cap', () => {
    const sql = statementsOnly(readMigration(FILE));
    const messages = [...sql.matchAll(/MESSAGE_TEXT = '([^']*)'/g)].map((m) => m[1]!);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.length, `MESSAGE_TEXT is ${message.length} chars: ${message}`).toBeLessThanOrEqual(128);
      // The reason must be actionable, not just a refusal.
      expect(message).toMatch(/upload_batch_id/);
    }
  });

  // The runner is not the mysql CLI: it strips DELIMITER directives itself and tracks BEGIN...END
  // nesting so a trigger body's internal semicolons are not statement terminators. A naive split
  // would execute the body's fragments. Parsed with the real splitter, as
  // newly-scheduled-migrations.test.ts does for the stored-procedure migrations.
  it('parses into whole statements with the runner own splitter', () => {
    const statements = splitSql(readMigration(FILE));
    const triggers = statements.filter((s) => /^CREATE TRIGGER/i.test(s.trim()));
    expect(triggers).toHaveLength(2);
    for (const trigger of triggers) {
      // A cut body loses its END, or its SIGNAL, or both.
      expect(trigger).toMatch(/BEGIN[\s\S]*SIGNAL SQLSTATE '45000'[\s\S]*END\s*$/);
      expect(trigger).not.toMatch(/DELIMITER/i);
    }
    expect(statements.filter((s) => /^DROP TRIGGER/i.test(s.trim()))).toHaveLength(2);
    // Nothing here creates, alters or removes a table or a column.
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
      expect(statement).not.toMatch(/\bALTER\s+TABLE\b/i);
      expect(statement).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
    }
  });
});
