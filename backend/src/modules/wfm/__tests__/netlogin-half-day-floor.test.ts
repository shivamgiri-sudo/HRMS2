import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Operations/APR half-day floor.
 *
 * classifyCosecMinutes has always taken its floor as a parameter, sourced from
 * attendance_feature_config.biometric_half_day_floor_minutes.
 * classifyOperationsNetLogin hardcoded 240 and ignored configuration entirely, so
 * the two boundaries agreed only because the constant happened to equal the
 * configured value. Changing the biometric setting moved one boundary and
 * silently left the other, meaning the same day could be a half day or an
 * absence depending only on which source recorded it.
 *
 * These tests pin three things: the floor is inclusive, it is configurable, and
 * a malformed setting can never become the threshold.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../logger.js", () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  classifyOperationsNetLogin,
  resolveHalfDayFloorMinutes,
  DEFAULT_HALF_DAY_FLOOR_MINUTES,
} from "../attendance-engine.service.js";

/** Make attendance_feature_config answer with `value` for any key. */
function configuredAs(value: unknown) {
  execute.mockResolvedValue([value === undefined ? [] : [{ config_value: value }], []]);
}

beforeEach(() => {
  execute.mockReset();
  loggerError.mockReset();
});

describe("the four-hour floor is inclusive", () => {
  it("classifies exactly the floor as a half day, not an absence", () => {
    // A floor qualifies. attendance_feature_config holds 240 in production, so
    // exactly four hours earns the half day.
    expect(classifyOperationsNetLogin(239)).toEqual({ status: "absent", lwpValue: 1.0 });
    expect(classifyOperationsNetLogin(240)).toEqual({ status: "half_day", lwpValue: 0.5 });
    expect(classifyOperationsNetLogin(241)).toEqual({ status: "half_day", lwpValue: 0.5 });
  });

  it("leaves the full-day threshold where it was", () => {
    // 480 is deliberately NOT configurable in this change: moving it moves
    // full-day pay, which is a separate decision.
    expect(classifyOperationsNetLogin(479).status).toBe("half_day");
    expect(classifyOperationsNetLogin(480)).toEqual({ status: "present", lwpValue: 0.0 });
  });
});

describe("the floor is configurable", () => {
  it("honours a floor other than the default", () => {
    expect(classifyOperationsNetLogin(299, 300)).toEqual({ status: "absent", lwpValue: 1.0 });
    expect(classifyOperationsNetLogin(300, 300)).toEqual({ status: "half_day", lwpValue: 0.5 });
  });

  it("defaults to 240 when no floor is passed", () => {
    expect(DEFAULT_HALF_DAY_FLOOR_MINUTES).toBe(240);
    expect(classifyOperationsNetLogin(240)).toEqual(classifyOperationsNetLogin(240, 240));
  });
});

describe("resolving the configured floor", () => {
  it("reads the net-login key, not the biometric one", async () => {
    configuredAs("240");
    await resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes");
    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    // The whole point of the change: these are separate settings.
    expect(params).toContain("netlogin_half_day_floor_minutes");
    expect(params).not.toContain("biometric_half_day_floor_minutes");
  });

  it("applies a configured value", async () => {
    configuredAs("300");
    await expect(resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes")).resolves.toBe(300);
  });

  it("falls back to 240 when the key is absent", async () => {
    configuredAs(undefined);
    await expect(resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes")).resolves.toBe(240);
    // Absence is normal before the migration runs — not worth an error.
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("falls back to 240 when the table cannot be read", async () => {
    execute.mockRejectedValue(new Error("Table 'attendance_feature_config' doesn't exist"));
    await expect(resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes")).resolves.toBe(240);
  });

  for (const bad of ["", "   ", "abc", "NaN", "0", "-30", "null"]) {
    it(`refuses ${JSON.stringify(bad)} rather than letting it become the threshold`, async () => {
      configuredAs(bad);

      const floor = await resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes");

      // The failure modes this exists to prevent. Number("abc") is NaN, and
      // `minutes >= NaN` is false for every input — every short day would become
      // an absence. Number("0") is 0, and `minutes >= 0` is true for every input
      // — every day would become at least a half day. Neither may ever be the
      // applied threshold.
      expect(floor).toBe(240);
      expect(Number.isNaN(floor)).toBe(false);
      expect(floor).toBeGreaterThan(0);

      // And it must be visible, not silent — someone set this value expecting it
      // to take effect.
      if (bad.trim() !== "") {
        expect(loggerError).toHaveBeenCalledTimes(1);
        const [context] = loggerError.mock.calls[0] as [Record<string, unknown>, string];
        expect(context).toMatchObject({ key: "netlogin_half_day_floor_minutes", applied: 240 });
      }
    });
  }

  it("classifies against the default when the value is malformed", async () => {
    configuredAs("abc");
    const floor = await resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes");
    // End to end: a malformed setting must not silently reclassify a day.
    expect(classifyOperationsNetLogin(240, floor)).toEqual({ status: "half_day", lwpValue: 0.5 });
    expect(classifyOperationsNetLogin(239, floor)).toEqual({ status: "absent", lwpValue: 1.0 });
  });
});

describe("every production call site uses the configured floor", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

  const CALL_SITES = [
    "src/modules/wfm/apr-attendance.service.ts",
    "src/modules/wfm/attendance-apr-bulk.routes.ts",
    "src/modules/wfm/attendance-engine.service.ts",
  ];

  it("passes a floor at every call — none left on the default", () => {
    // A missed call site is the failure this change exists to prevent: it would
    // read the hardcoded default while the others honoured the setting, which is
    // exactly the divergence being removed.
    for (const file of CALL_SITES) {
      const source = read(file);
      const calls = source.match(/classifyOperationsNetLogin\([^)]*\)/g) ?? [];
      const invocations = calls.filter((c) => !c.startsWith("classifyOperationsNetLogin(\n"));
      for (const call of invocations) {
        // The declaration itself is the one place a bare parameter list is fine.
        if (call.includes("netLoginMinutes")) continue;
        expect(call, `${file}: ${call} does not pass a floor`).toMatch(/,\s*netLoginHalfDayFloor\)/);
      }
    }
  });

  it("resolves the floor once per operation, never per row", () => {
    // The classifier is synchronous precisely so it can run per row without a
    // query each time. A resolve inside a map or loop would be a database read
    // per employee — and would let the floor change midway through one upload.
    for (const file of CALL_SITES) {
      const source = read(file);
      const resolves = source.match(/resolveHalfDayFloorMinutes\('netlogin_half_day_floor_minutes'\)/g) ?? [];
      expect(resolves.length, `${file} should resolve the net-login floor exactly once`).toBe(1);
    }
  });

  it("seeds the key in an additive migration that cannot overwrite a set value", () => {
    const migration = read("sql/1060_netlogin_half_day_floor_config.sql");
    expect(migration).toContain("netlogin_half_day_floor_minutes");
    expect(migration).toContain("'240'");
    // Only the description may be refreshed on re-run. Checked against the SQL
    // with comment lines stripped — the explanatory header legitimately mentions
    // config_value, and a whole-file regex matched that prose rather than the
    // statement, passing judgement on a comment instead of the code.
    const sqlOnly = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(sqlOnly).toContain("ON DUPLICATE KEY UPDATE description = VALUES(description)");
    expect(sqlOnly).not.toMatch(/ON DUPLICATE KEY UPDATE[\s\S]*config_value/);
    expect(sqlOnly).not.toMatch(/\bUPDATE\s+attendance_feature_config\b/);
  });
});

/**
 * The biometric floor was the asymmetry this file's original fix left behind.
 *
 * classifyOperationsNetLogin was routed through resolveHalfDayFloorMinutes, but
 * the biometric line kept parsing inline as `raw ? Number(raw) : 240`. That
 * yields NaN for a malformed value, and `minutes >= NaN` is false for every
 * input — so one bad setting would have classified every biometric day as absent,
 * for the entire workforce, with nothing logged. The header comment there flagged
 * it as a known follow-up; these pin that it was done.
 */
describe("the biometric floor resolves through the same guard", () => {
  const ENGINE = readFileSync(
    resolve(process.cwd(), "src/modules/wfm/attendance-engine.service.ts"),
    "utf8",
  );

  it("no longer parses the biometric setting inline", () => {
    expect(
      ENGINE,
      "inline parsing returns NaN for a malformed value and silently marks every day absent",
    ).not.toMatch(/halfDayFloorStr \? Number\(halfDayFloorStr\) : 240/);
  });

  it("uses resolveHalfDayFloorMinutes for the biometric key", () => {
    expect(ENGINE).toMatch(/resolveHalfDayFloorMinutes\('biometric_half_day_floor_minutes'\)/);
  });

  it("refuses an unusable biometric value and applies the default instead", async () => {
    for (const bad of ["abc", "-5", "0"]) {
      execute.mockReset();
      loggerError.mockReset();
      execute.mockResolvedValueOnce([[{ config_value: bad }]]);

      const floor = await resolveHalfDayFloorMinutes("biometric_half_day_floor_minutes");

      expect(floor, `"${bad}" must not become the threshold`).toBe(DEFAULT_HALF_DAY_FLOOR_MINUTES);
      expect(Number.isFinite(floor)).toBe(true);
      expect(loggerError, `refusing "${bad}" should be logged, not silent`).toHaveBeenCalled();
    }
  });

  it("still honours a valid biometric override", async () => {
    execute.mockReset();
    execute.mockResolvedValueOnce([[{ config_value: "300" }]]);

    expect(await resolveHalfDayFloorMinutes("biometric_half_day_floor_minutes")).toBe(300);
  });
});
