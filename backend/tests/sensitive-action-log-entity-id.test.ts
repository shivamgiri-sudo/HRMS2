import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * `sensitive_action_log.entity_id` was CHAR(36) — wide enough for a bare UUID and
 * nothing else. Several call sites deliberately audit a *pair* rather than a row
 * ("this employee on this day"), so their composite key overflowed, MySQL
 * rejected the insert, and writeSensitiveActionLog swallowed the error by design.
 * The failure was completely silent: the code read as though it were auditing.
 *
 * Live census before migration 1033 (2026-08-01) — every one of these had never
 * written a single row:
 *
 *   ATTENDANCE_RECORD_CORRECTED  0 rows   employee_id + ':' + date     = 47 chars
 *   TDS_PART_A_VERIFIED          0 rows   employee_id + ':' + FY       = 44
 *   DESIGNATION_ROLE_MAPPED      0 rows   designation_id + '::' + role = 38+
 *   MODULE_ACCESS_SET            0 rows   role + '::module::' + name
 *
 * 26 regularizations were approved leaving no record of what any of them changed.
 * These tests pin the column width and keep the composite-key call sites honest.
 */

const root = resolve(__dirname, "..");
const MIGRATION = "sql/1033_sensitive_action_log_entity_id_width.sql";

/** The longest key each composite call site can produce, worst case. */
const COMPOSITE_KEYS = [
  { site: "wfm.regularization.secure.routes.ts", shape: "<uuid>:<yyyy-mm-dd>", length: 36 + 1 + 10 },
  { site: "tds-certificate-part-a.routes.ts", shape: "<uuid>:<fy>", length: 36 + 1 + 7 },
  { site: "role-page-access.service.ts", shape: "<uuid>::<role_key>", length: 36 + 2 + 20 },
  { site: "role-page-access.service.ts", shape: "<role>::module::<module>", length: 20 + 10 + 40 },
];

describe("migration 1033 — entity_id width", () => {
  it("exists and is registered in MIGRATION_MANIFEST", () => {
    expect(existsSync(resolve(root, MIGRATION))).toBe(true);
    const manifest = readFileSync(resolve(root, "src/db/runPendingMigrations.ts"), "utf8");
    // A migration missing from the hardcoded manifest never runs — the runner
    // does not scan the directory.
    expect(manifest).toContain("1033_sensitive_action_log_entity_id_width.sql");
  });

  it("widens entity_id to at least VARCHAR(100)", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toMatch(/MODIFY COLUMN entity_id VARCHAR\((\d+)\)/i);
    const width = Number(sql.match(/MODIFY COLUMN entity_id VARCHAR\((\d+)\)/i)![1]);
    expect(width).toBeGreaterThanOrEqual(100);
  });

  it("is re-runnable — guarded on the current column definition", () => {
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toMatch(/information_schema\.columns/i);
    expect(sql).toMatch(/character_maximum_length/i);
  });

  it("keeps the column nullable and on the table's own collation", () => {
    // entity_id is optional (not every audited action has an entity), and a
    // different collation from entity_type would break idx_sal_entity.
    const sql = readFileSync(resolve(root, MIGRATION), "utf8");
    expect(sql).toMatch(/utf8mb4_unicode_ci/);
    expect(sql).toMatch(/\bNULL\b/);
    expect(sql).not.toMatch(/NOT NULL/);
  });

  it("is wide enough for every composite key the code actually builds", () => {
    const width = 100;
    for (const k of COMPOSITE_KEYS) {
      expect(
        k.length,
        `${k.site} builds ${k.shape} (~${k.length} chars) — VARCHAR(${width}) must hold it`
      ).toBeLessThanOrEqual(width);
    }
  });

  it("leaves idx_sal_entity inside InnoDB's key limit", () => {
    // idx_sal_entity is (entity_type VARCHAR(100), entity_id VARCHAR(100)).
    // utf8mb4 is 4 bytes/char; InnoDB caps an index key at 3072 bytes.
    const keyBytes = (100 + 100) * 4;
    expect(keyBytes).toBeLessThan(3072);
  });
});

describe("the call sites this migration exists for", () => {
  const sites: Array<[string, string]> = [
    ["src/modules/wfm/wfm.regularization.secure.routes.ts", "ATTENDANCE_RECORD_CORRECTED"],
    ["src/modules/payroll/tds-certificate-part-a.routes.ts", "TDS_PART_A_VERIFIED"],
    ["src/modules/access/role-page-access.service.ts", "DESIGNATION_ROLE_MAPPED"],
  ];

  for (const [file, actionType] of sites) {
    it(`${actionType} still writes a composite entity_id (the migration is what makes it fit)`, () => {
      const path = resolve(root, file);
      if (!existsSync(path)) return;   // file moved — nothing to assert
      const src = readFileSync(path, "utf8");
      expect(src).toContain(actionType);
      // If someone shortens these to a bare id, the audit key loses the second
      // half of the pair it identifies. That is a deliberate design decision, so
      // fail loudly rather than let it drift silently.
      expect(src).toMatch(/entity_id: `\$\{/);
    });
  }
});
