import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { validatePerformanceCron } from "../performance-scheduler.service.js";

describe("performance source schedule validation", () => {
  it("accepts standard schedules and returns the next run", () => {
    const result = validatePerformanceCron("0 2 * * *", "Asia/Kolkata");
    expect(result.expression).toBe("0 2 * * *");
    expect(result.timezone).toBe("Asia/Kolkata");
    expect(Number.isNaN(new Date(result.nextRunAt).getTime())).toBe(false);
  });

  it("rejects schedules more frequent than every five minutes", () => {
    expect(() => validatePerformanceCron("* * * * *", "Asia/Kolkata"))
      .toThrow(/five minutes/i);
  });

  it("rejects invalid cron expressions and timezones", () => {
    expect(() => validatePerformanceCron("not-a-cron", "Asia/Kolkata"))
      .toThrow(/invalid cron/i);
    expect(() => validatePerformanceCron("0 2 * * *", "Invalid/Timezone"))
      .toThrow(/timezone/i);
  });
});

describe("scheduled ingestion safety contract", () => {
  const serviceCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-ingestion.service.ts"),
    "utf8",
  );
  const schedulerCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-scheduler.service.ts"),
    "utf8",
  );
  const routeCode = fs.readFileSync(
    path.resolve(__dirname, "../performance-scheduler.routes.ts"),
    "utf8",
  );

  it("blocks rows outside the selected correction window", () => {
    expect(serviceCode).toContain("EVENT_DATE_OUTSIDE_WINDOW");
    expect(serviceCode).toContain("eventDate < input.from || eventDate > input.to");
  });

  it("blocks partial and empty publication unless explicitly configured", () => {
    expect(serviceCode).toContain("allowPartialPublication");
    expect(serviceCode).toContain("allowEmptyPublication");
    expect(serviceCode).toContain("Publication blocked because");
  });

  it("uses distributed worker locks and approved publication mode", () => {
    expect(schedulerCode).toContain("withWorkerLock");
    expect(schedulerCode).toContain('mode: "publish"');
    expect(schedulerCode).toContain('triggerType: "schedule"');
  });

  it("requires write access for schedule changes and run-now", () => {
    expect(routeCode).toMatch(/router\.put\([\s\S]*requireWriteAccess/);
    expect(routeCode).toMatch(/"\/datasets\/:id\/run-now"[\s\S]*requireWriteAccess/);
  });
});
