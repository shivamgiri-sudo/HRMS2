import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("SLA breach worker runtime safety", () => {
  const workerSource = readFileSync(
    resolve(process.cwd(), "src/workers/sla-breach-worker.ts"),
    "utf8",
  );

  it("only scans recent candidates and bounds each query and notification cycle", () => {
    expect(workerSource).toContain(
      "CONCAT(c.created_date, ' ', c.created_time) >= DATE_SUB(NOW(), INTERVAL 24 HOUR)",
    );
    expect(workerSource).toContain("ORDER BY pending_minutes ASC");
    expect(workerSource).toContain("LIMIT ${CANDIDATE_SCAN_LIMIT}");
    expect(workerSource).toContain("if (alertsSent >= MAX_ALERTS_PER_RUN) break");
  });

  it("does not run the SLA scan synchronously during server startup", () => {
    expect(workerSource).toContain("setTimeout(() =>");
    expect(workerSource).toContain("STARTUP_DELAY_MS");
    expect(workerSource).not.toContain("await processSLABreaches();");
  });

  it("prevents overlapping scans", () => {
    expect(workerSource).toContain("if (isProcessing)");
    expect(workerSource).toContain("isProcessing = true");
    expect(workerSource).toContain("isProcessing = false");
  });
});
