/**
 * The COSEC monitoring panel must read a table that exists.
 *
 * getCosecMonitoring's latest_punches read queried `biometric_punch`. There is no such
 * table in mas_hrms and there never has been — `SELECT * FROM biometric_punch` returns
 * ER_NO_SUCH_TABLE. The read was wrapped in tableExists(), so nothing threw and nothing
 * was logged: the guard simply returned [] forever, and
 * GET /api/integrations/cosec/latest-punches has answered with an empty list since it
 * was written.
 *
 * That is the worst shape this codebase produces. On a screen whose job is to show
 * whether the biometric feed is alive, an empty list reads as "the feed is dead" — the
 * exact opposite of the truth. The feed is healthy: biometric_attendance_log holds
 * 176,694 rows and was current to today when this was fixed.
 *
 * The guard here is the table name, because a tableExists() wrapper converts a wrong
 * name into silence rather than an error, which no runtime check will ever surface.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(__dirname, "../peopleos.service.ts"), "utf8");
// Strip comments: the explanation above the fix names biometric_punch as the thing that
// was wrong, and a scan of raw source would read that prose as the bug itself.
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Biometric tables that genuinely exist in mas_hrms, verified against live. */
const REAL_TABLES = [
  "biometric_attendance_log",
  "biometric_device_master",
  "employee_biometric_enrollment",
  "integration_biometric_daily",
];

describe("COSEC monitoring — latest punches", () => {
  it("does not reference the table that has never existed", () => {
    expect(REAL_TABLES).not.toContain("biometric_punch");
    expect(code).not.toContain("biometric_punch");
  });

  it("reads the log table that actually holds the punches", () => {
    expect(code).toContain("FROM biometric_attendance_log");
    expect(REAL_TABLES).toContain("biometric_attendance_log");
  });

  it("guards on the same table it then queries", () => {
    // A tableExists() naming one table while the query reads another is how this became
    // permanently empty without an error.
    const guard = code.match(/tableExists\("([a-z_]+)"\)\s*\n?\s*\.then\(\(exists\) =>/);
    expect(guard?.[1]).toBe("biometric_attendance_log");
  });

  it("resolves who punched, since the log's employee_code is often null", () => {
    // Slice from the SELECT, not from the FROM: employee_name is in the select list,
    // which sits before the table name. Slicing at FROM made this assertion
    // unsatisfiable, and it failed against correct code until the slice was fixed.
    const start = code.lastIndexOf("SELECT", code.indexOf("FROM biometric_attendance_log"));
    const query = code.slice(start, code.indexOf("LIMIT 100", start));
    expect(query).toContain("LEFT JOIN employees e ON e.id = bal.employee_id");
    expect(query).toContain("employee_name");
  });

  it("orders newest first, which is the whole point of a 'latest' panel", () => {
    expect(code).toContain("ORDER BY bal.punch_date DESC");
  });
});
