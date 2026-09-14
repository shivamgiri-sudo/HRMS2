import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * calculateGratuity read three statutory_config keys that production has never
 * held. It asked for gratuity_day_divisor, gratuity_multiplier_days and
 * gratuity_min_months; migration 028 seeded gratuity_divisor (26),
 * gratuity_multiplier (15) and gratuity_min_service_months (60). All three
 * lookups missed, so the function returned "not eligible" for every employee
 * unconditionally — while an admin reading the statutory config screen saw three
 * populated gratuity rows and would reasonably conclude it was configured.
 *
 * Confirmed against production: the old key set resolves to
 * undefined/undefined/undefined; the seeded set resolves to 60/26/15.
 *
 * Two further defects were fixed at the same time, because unblocking the
 * calculation without them would have shipped a money bug:
 *   - tenure was measured to today rather than to the last working day, which
 *     credits service between the exit and whenever the settlement is prepared;
 *   - a missing-configuration result was reported to the caller identically to
 *     "has not served long enough", which told a twenty-year employee they had
 *     completed 0 years.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { calculateGratuity } from "../payrollCalculate.service.js";

const EMPLOYEE_ID = "11111111-1111-1111-1111-111111111111";

/** The key names production actually holds. */
const SEEDED = [
  { config_key: "gratuity_min_service_months", config_value: "60" },
  { config_key: "gratuity_divisor", config_value: "26" },
  { config_key: "gratuity_multiplier", config_value: "15" },
];

/** The names the code used to ask for, kept working so neither spelling silently misses. */
const LEGACY = [
  { config_key: "gratuity_min_months", config_value: "60" },
  { config_key: "gratuity_day_divisor", config_value: "26" },
  { config_key: "gratuity_multiplier_days", config_value: "15" },
];

function mockConfigAndJoining(cfg: unknown[], dateOfJoining: string | null) {
  execute
    .mockResolvedValueOnce([cfg])
    .mockResolvedValueOnce([dateOfJoining ? [{ date_of_joining: dateOfJoining }] : []]);
}

describe("gratuity resolves against the key names production actually holds", () => {
  beforeEach(() => execute.mockReset());

  it("computes from the seeded gratuity_divisor / gratuity_multiplier / gratuity_min_service_months", async () => {
    mockConfigAndJoining(SEEDED, "2016-01-01");

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2026-01-01");

    expect(r.eligible).toBe(true);
    expect(r.years).toBe(10);
    // Payment of Gratuity Act: 15 days' wages per completed year on a 26-day month.
    expect(r.amount).toBe(Math.round((20000 / 26) * 15 * 10 * 100) / 100);
    expect(r.amount).toBe(115384.62);
  });

  it("still accepts the legacy key spellings, so neither environment silently misses", async () => {
    mockConfigAndJoining(LEGACY, "2016-01-01");

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2026-01-01");

    expect(r.eligible).toBe(true);
    expect(r.amount).toBe(115384.62);
  });

  it("reports a missing configuration as such, not as insufficient service", async () => {
    mockConfigAndJoining([], "2006-01-01"); // twenty years of service, nothing configured

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2026-01-01");

    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("not_configured");
    // The old behaviour returned years: 0 here, which read as "served no time".
  });
});

describe("tenure is measured to the settlement date, not to today", () => {
  beforeEach(() => execute.mockReset());

  it("uses the supplied last working day", async () => {
    // Joined 2016-01-01, left 2021-01-01 => 5 completed years, not the ~10 that
    // measuring to today would produce.
    mockConfigAndJoining(SEEDED, "2016-01-01");

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2021-01-01");

    expect(r.years).toBe(5);
    expect(r.amount).toBe(Math.round((20000 / 26) * 15 * 5 * 100) / 100);
  });

  it("refuses below the configured minimum service", async () => {
    mockConfigAndJoining(SEEDED, "2023-01-01"); // ~3 years at the as-of date

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2026-01-01");

    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("below_minimum_service");
    expect(r.amount).toBe(0);
  });

  it("distinguishes a missing joining date from every other cause", async () => {
    mockConfigAndJoining(SEEDED, null);

    const r = await calculateGratuity(EMPLOYEE_ID, 20000, "2026-01-01");

    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("no_joining_date");
  });
});
