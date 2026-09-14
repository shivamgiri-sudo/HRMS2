import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("SLA breach worker runtime safety", () => {
  const workerSource = readFileSync(
    resolve(process.cwd(), "src/workers/sla-breach-worker.ts"),
    "utf8",
  );

  it("only scans recent candidates and bounds each query and notification cycle", () => {
    // The bound, not the column expression it is written against. 49c30935
    // deliberately moved this from CONCAT(c.created_date, ' ', c.created_time)
    // to COALESCE(qt.arrival_time, qt.created_at); the guarantee this test
    // exists for — that the scan cannot walk the whole table — is the 24-hour
    // window, and pinning the exact expression failed on an intended rewrite
    // while proving nothing extra.
    expect(workerSource).toContain("DATE_SUB(NOW(), INTERVAL 24 HOUR)");
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
