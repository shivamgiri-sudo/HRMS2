/**
 * A role grant must record who made it and when.
 *
 * user_roles held (id, user_id, role_key, active_status, created_at) and nothing
 * else — measured live 2026-08-26: 1,618 rows, 1,491 active. Assignment WAS
 * audited as an event (logSensitiveAction ROLE_ASSIGNED / ROLE_REVOKED), but the
 * grant row itself could not answer "who gave this person this role, and when did
 * the access they hold right now begin" without replaying the audit stream — and
 * only for grants made through the admin path. auth-launch.routes.ts held an actor
 * id it discarded, its own comment naming the missing column.
 *
 * created_at could not stand in for it. Every grant site inserts with
 * ON DUPLICATE KEY UPDATE active_status = 1 against uq_user_role(user_id, role_key),
 * so a role that was revoked and later re-granted keeps the created_at of the
 * ORIGINAL grant: a reinstated privilege reads as older than it is, by exactly the
 * length of the revocation. That is why the reactivation branch below must re-stamp
 * granted_by/granted_at rather than leave the superseded actor in place — the whole
 * point of the column is that it describes access held NOW.
 *
 * Migration 1614 added granted_by CHAR(36) NULL / granted_at DATETIME NULL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: Array<{ sql: string; params: unknown[] }> = [];

const dbExecute = vi.fn(async (sql: string, params: unknown[] = []) => {
  captured.push({ sql: String(sql), params });
  if (String(sql).includes("workforce_role_catalog")) return [[{ role_key: "finance_head" }]];
  return [{ affectedRows: 1 }];
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn(async () => {}) }));

const { assignRole } = await import("../access.service.js");

const grantInsert = () =>
  captured.find((c) => /INSERT INTO user_roles/i.test(c.sql));

beforeEach(() => { captured.length = 0; dbExecute.mockClear(); });

describe("user_roles grant provenance", () => {
  it("records the acting user on the grant row, not only in the audit stream", async () => {
    await assignRole("target-user-id", "finance_head", "actor-admin-id");

    const insert = grantInsert();
    expect(insert, "no INSERT INTO user_roles was issued").toBeDefined();
    expect(insert!.sql).toMatch(/granted_by/);
    expect(insert!.sql).toMatch(/granted_at/);
    // The actor must reach the statement as a bound parameter. Before migration
    // 1614 the actor was accepted by assignRole and then dropped on the floor.
    expect(insert!.params).toContain("actor-admin-id");
  });

  it("re-stamps provenance when ON DUPLICATE KEY revives a revoked grant", async () => {
    // The failure this pins: reviving a previously revoked grant is a NEW grant
    // decision by a NEW actor. If the ON DUPLICATE KEY branch only sets
    // active_status, the row keeps the superseded actor and the original date, and
    // reports today's access as having been granted by someone who no longer
    // decided it. `granted_by = VALUES(granted_by)` is what makes the update carry
    // the current actor rather than the stored one.
    await assignRole("target-user-id", "finance_head", "second-actor-id");

    const sql = grantInsert()!.sql;
    const onDuplicate = sql.slice(sql.search(/ON DUPLICATE KEY UPDATE/i));
    expect(onDuplicate, "reactivation branch does not refresh granted_by").toMatch(
      /granted_by\s*=\s*VALUES\(granted_by\)/i,
    );
    expect(onDuplicate, "reactivation branch does not refresh granted_at").toMatch(
      /granted_at\s*=\s*VALUES\(granted_at\)/i,
    );
  });

  it("leaves created_at alone — it still means first insert, not current access", async () => {
    // Two columns with two different meanings. Overwriting created_at on
    // reactivation would destroy the only record that the grant ever existed
    // before, which is the thing an auditor asks about.
    await assignRole("target-user-id", "finance_head", "actor-admin-id");

    expect(grantInsert()!.sql).not.toMatch(/created_at\s*=/i);
  });
});

/**
 * The two SYSTEM grant sites are guarded differently from the admin one, and the
 * difference is load-bearing enough to pin at source level.
 *
 * ensureEmployeeRole (auth.service.ts) runs on EVERY login and createAuthUserForEmployee
 * (employee.service.ts) on every employee creation. An unconditional re-stamp there
 * would reset granted_at to the last sign-in and blank out a granted_by an administrator
 * had deliberately set — turning a provenance column into a login timestamp. So both
 * guard on active_status = 0 (i.e. only a genuine reactivation re-stamps).
 *
 * MySQL evaluates ON DUPLICATE KEY UPDATE assignments left to right, and a bare column
 * reference yields its NOT-yet-updated value. Both IF()s must therefore appear BEFORE
 * `active_status = 1`, or they read the new status, never see 0, and the reactivation
 * re-stamp silently stops happening. Verified against production 8.0.42 on a scratch
 * clone: admin grant recorded 'admin-actor'; two consecutive logins left granted_by and
 * granted_at untouched; revoke-then-login re-stamped to granted_by NULL with a fresh
 * granted_at. Reordering these lines is the one edit that breaks it without failing
 * anything else, which is why it is asserted here rather than left to review.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("system-path grant sites", () => {
  const HERE = resolve(import.meta.dirname, "..", "..", "..");
  const SYSTEM_SITES = [
    ["auth/auth.service.ts", "runs on every login"],
    ["employees/employee.service.ts", "runs on every employee creation"],
  ] as const;

  /**
   * The INSERT IGNORE sites need no guard — IGNORE never updates an existing row, so
   * they cannot overwrite provenance that is already there. They must still SUPPLY it,
   * or a role granted down these paths lands with both columns NULL and is
   * indistinguishable from a pre-1614 historic row.
   */
  const IGNORE_SITES = [
    "auth/auth.routes.ts",
    "employees/employee-activation.service.ts",
  ] as const;

  for (const rel of IGNORE_SITES) {
    it(`${rel} supplies provenance on its INSERT IGNORE`, () => {
      const sql = readFileSync(resolve(HERE, "modules", rel), "utf8");
      const at = sql.search(/INSERT IGNORE INTO user_roles/);
      expect(at, "no INSERT IGNORE INTO user_roles in this file").toBeGreaterThan(-1);
      const stmt = sql.slice(at, at + 400);
      expect(stmt, "grant lands with no provenance at all").toMatch(/granted_by/);
      expect(stmt, "grant lands with no provenance at all").toMatch(/granted_at/);
    });
  }

  for (const [rel, why] of SYSTEM_SITES) {
    const src = () => readFileSync(resolve(HERE, "modules", rel), "utf8");

    it(`${rel} only re-stamps on reactivation — it ${why}`, () => {
      const sql = src();
      expect(sql, "system site lost its active_status = 0 guard on granted_at").toMatch(
        /granted_at\s*=\s*IF\(active_status\s*=\s*0,\s*NOW\(\),\s*granted_at\)/,
      );
      expect(sql, "system site lost its active_status = 0 guard on granted_by").toMatch(
        /granted_by\s*=\s*IF\(active_status\s*=\s*0,\s*NULL,\s*granted_by\)/,
      );
    });

    it(`${rel} evaluates both guards before active_status is overwritten`, () => {
      const sql = src();
      // Scope to the user_roles INSERT — these files carry other upserts, and the
      // first ON DUPLICATE KEY in the file is not necessarily this one.
      const insertAt = sql.search(/INSERT INTO user_roles/);
      expect(insertAt, "no INSERT INTO user_roles in this file").toBeGreaterThan(-1);
      const stmt = sql.slice(insertAt, insertAt + 800);
      const clause = stmt.slice(stmt.search(/ON DUPLICATE KEY UPDATE/));
      const guardEnd = Math.max(
        clause.search(/granted_at\s*=\s*IF/),
        clause.search(/granted_by\s*=\s*IF/),
      );
      const statusAssign = clause.search(/active_status\s*=\s*1/);
      expect(guardEnd, "no guarded assignment found").toBeGreaterThan(-1);
      expect(statusAssign, "no active_status = 1 assignment found").toBeGreaterThan(-1);
      expect(
        statusAssign,
        "active_status = 1 is assigned BEFORE the IF() guards, so they read the new " +
          "status, never see 0, and reactivation silently stops re-stamping",
      ).toBeGreaterThan(guardEnd);
    });
  }
});
