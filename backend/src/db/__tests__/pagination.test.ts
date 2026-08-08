import { describe, expect, it } from "vitest";
import { sqlLimitOffset } from "../pagination.js";

/**
 * sqlLimitOffset exists so that 27 call sites can interpolate LIMIT/OFFSET instead of binding it
 * (MySQL rejects a bound parameter in LIMIT on a prepared statement). Interpolation is only safe
 * while this function cannot emit anything but two integers, so that is what these tests pin.
 */
describe("sqlLimitOffset", () => {
  it("emits plain integers for ordinary input", () => {
    expect(sqlLimitOffset(25, 50)).toBe("LIMIT 25 OFFSET 50");
  });

  it("never emits anything but digits, whatever it is handed", () => {
    const hostile: unknown[] = [
      "10; DROP TABLE employees",
      "1 UNION SELECT password FROM auth_user",
      "'; --",
      NaN, Infinity, -Infinity, null, undefined, "", {}, [], () => 1,
    ];
    for (const value of hostile) {
      for (const clause of [sqlLimitOffset(value, 0), sqlLimitOffset(10, value)]) {
        expect(clause).toMatch(/^LIMIT \d+ OFFSET \d+$/);
      }
    }
  });

  it("clamps the limit into 1..maxLimit rather than trusting the caller", () => {
    // A nonsensical limit falls back to the default rather than clamping to 1: returning a single
    // row for "?limit=-5" would look like real but nearly-empty data, which is harder to notice
    // than an ordinary page.
    expect(sqlLimitOffset(0, 0)).toBe("LIMIT 50 OFFSET 0");
    expect(sqlLimitOffset(-5, 0)).toBe("LIMIT 50 OFFSET 0");
    expect(sqlLimitOffset(9999, 0)).toBe("LIMIT 500 OFFSET 0");
    expect(sqlLimitOffset(9999, 0, { maxLimit: 50 })).toBe("LIMIT 50 OFFSET 0");
  });

  it("never emits a negative offset", () => {
    expect(sqlLimitOffset(10, -1)).toBe("LIMIT 10 OFFSET 0");
    expect(sqlLimitOffset(10, -99999)).toBe("LIMIT 10 OFFSET 0");
  });

  it("truncates fractional values instead of stringifying a decimal point", () => {
    expect(sqlLimitOffset(10.9, 20.9)).toBe("LIMIT 10 OFFSET 20");
    expect(sqlLimitOffset("25.7", "5.2")).toBe("LIMIT 25 OFFSET 5");
  });

  it("honours a per-call default when the value is absent", () => {
    expect(sqlLimitOffset(undefined, 0, { defaultLimit: 100 })).toBe("LIMIT 100 OFFSET 0");
  });
});
