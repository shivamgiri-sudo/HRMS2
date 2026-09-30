import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Startup migrations run BEFORE the server listens, and production refuses to start if one fails.
 * An ALTER TABLE on a busy table can queue behind a long report query, then block every later query on that table
 * (metadata-lock pile-up) until "Lock wait timeout exceeded" — which fails the migration and takes the site down.
 * That is exactly how migration 1918 caused a 502 outage on 2026-09-30.
 *
 * From 1919 on, no migration may ALTER a hot table. Do the change as a background, lock-safe job instead
 * (see backend/src/modules/operations/ops-command.indexes.ts) or run it by hand off-peak.
 * A migration that is genuinely safe (empty/new table, off-peak window agreed with the owner) can opt out by
 * containing the marker comment:   -- hot-table-ok: <reason>
 */
const FIRST_GUARDED = 1919;

const HOT_TABLES = [
  "employees", "attendance_daily_record", "wfm_roster_assignment", "kpi_daily_actual", "exit_request",
  "work_inbox_item", "break_daily_summary", "wfm_attendance_session", "leave_request", "employee_salary_assignment",
  "biometric_attendance_log", "audit_action_log", "notification", "payroll_run_employee",
];

const MIGRATIONS_DIR = path.resolve(__dirname, "../sql/migrations");

describe("migration hot-table guard", () => {
  const files = fs.existsSync(MIGRATIONS_DIR) ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")) : [];

  it("finds the migrations directory", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it(`no migration numbered ${FIRST_GUARDED}+ alters a hot table without an explicit opt-out`, () => {
    const offenders: string[] = [];
    for (const f of files) {
      const n = parseInt(f.split("_")[0], 10);
      if (!Number.isFinite(n) || n < FIRST_GUARDED) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
      if (/--\s*hot-table-ok\s*:/i.test(sql)) continue;
      for (const t of HOT_TABLES) {
        // matches both plain statements and ALTERs hidden inside PREPARE '...' strings
        if (new RegExp(`ALTER\\s+TABLE\\s+\`?${t}\`?\\b`, "i").test(sql)) offenders.push(`${f} → ALTER TABLE ${t}`);
      }
    }
    expect(offenders, `Hot-table ALTERs must not run at startup:\n${offenders.join("\n")}`).toEqual([]);
  });
});
