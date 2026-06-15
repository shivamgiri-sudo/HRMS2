import { describe, expect, it } from "vitest";
import {
  nextCronRun,
  validateCronExpression,
} from "../src/modules/integration-hub/cronSchedule.js";

describe("Integration Hub cron schedule", () => {
  it("calculates the next run in the configured timezone", () => {
    const next = nextCronRun(
      "0 9 * * *",
      new Date("2026-06-15T03:00:00.000Z"),
      "Asia/Kolkata",
    );

    expect(next.toISOString()).toBe("2026-06-15T03:30:00.000Z");
  });

  it("supports six-field cron expressions", () => {
    const next = nextCronRun(
      "*/15 * * * * *",
      new Date("2026-06-15T03:00:01.000Z"),
      "UTC",
    );

    expect(next.toISOString()).toBe("2026-06-15T03:00:15.000Z");
  });

  it("rejects invalid field ranges", () => {
    expect(validateCronExpression("0 99 * * *")).not.toBeNull();
  });
});
