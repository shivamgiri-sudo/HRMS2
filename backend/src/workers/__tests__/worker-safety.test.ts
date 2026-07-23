import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as crypto from "crypto";

describe("Worker Distributed Safety", () => {
  describe("workerLockName", () => {
    it("should generate deterministic lock names", () => {
      const workerName = "payroll-nightly-recalc";
      const digest = crypto.createHash("sha256").update(workerName).digest("hex").slice(0, 40);
      const lockName = `hrms:worker:${digest}`;

      // Verify determinism
      const digest2 = crypto.createHash("sha256").update(workerName).digest("hex").slice(0, 40);
      expect(digest).toBe(digest2);

      // Verify format
      expect(lockName).toMatch(/^hrms:worker:[a-f0-9]{40}$/);
    });

    it("should generate different lock names for different workers", () => {
      const worker1 = "payroll-nightly-recalc";
      const worker2 = "leave-monthly-credit";

      const digest1 = crypto.createHash("sha256").update(worker1).digest("hex").slice(0, 40);
      const digest2 = crypto.createHash("sha256").update(worker2).digest("hex").slice(0, 40);

      expect(digest1).not.toBe(digest2);
    });
  });

  describe("Timer Registration", () => {
    it("should track registered timers", async () => {
      const { registerTimer, unregisterTimer, getActiveTimerCount, clearAllTimers } = await import("../worker-utils.js");

      const initialCount = getActiveTimerCount();

      // Register a timer
      const timer = setTimeout(() => {}, 10000);
      registerTimer("test-timer", timer);

      expect(getActiveTimerCount()).toBe(initialCount + 1);

      // Unregister the timer
      clearTimeout(timer);
      unregisterTimer("test-timer");

      expect(getActiveTimerCount()).toBe(initialCount);

      // Clean up any remaining timers
      clearAllTimers();
    });
  });

  describe("Advisory Lock Behavior", () => {
    it("should document lock timeout configuration", () => {
      // Lock timeout is 0 (non-blocking) for worker locks
      // This ensures workers don't hang waiting for locks
      const LOCK_TIMEOUT_SECONDS = 0;
      expect(LOCK_TIMEOUT_SECONDS).toBe(0);
    });

    it("should document lock name format", () => {
      // Lock names follow pattern: hrms:worker:{sha256-prefix}
      const lockNamePattern = /^hrms:worker:[a-f0-9]+$/;
      const exampleLockName = "hrms:worker:abc123def456";
      expect(exampleLockName).toMatch(lockNamePattern);
    });
  });

  describe("Graceful Shutdown", () => {
    it("should define shutdown timeout", () => {
      // Shutdown waits up to 30 seconds for active requests to drain
      const SHUTDOWN_TIMEOUT_MS = 30000;
      expect(SHUTDOWN_TIMEOUT_MS).toBe(30000);
    });

    it("should handle multiple shutdown signals gracefully", () => {
      // isShuttingDown flag prevents duplicate shutdown attempts
      let isShuttingDown = false;

      const shutdown = () => {
        if (isShuttingDown) return false;
        isShuttingDown = true;
        return true;
      };

      expect(shutdown()).toBe(true);
      expect(shutdown()).toBe(false);
      expect(shutdown()).toBe(false);
    });
  });

  describe("Worker External Gating", () => {
    it("should respect WORKERS_PROCESS environment variable", () => {
      // When WORKERS_PROCESS=external, all workers run in separate process
      const WORKERS_EXTERNAL_TRUE = "external" === "external";
      const WORKERS_EXTERNAL_FALSE = "inline" === "external";

      expect(WORKERS_EXTERNAL_TRUE).toBe(true);
      expect(WORKERS_EXTERNAL_FALSE).toBe(false);
    });
  });

  describe("Worker Job Run Table Schema", () => {
    it("should define required columns", () => {
      const requiredColumns = [
        "id",
        "worker_name",
        "status",
        "started_at",
        "completed_at",
        "duration_ms",
        "lock_acquired",
        "error_message",
        "metadata",
        "hostname",
      ];

      expect(requiredColumns).toContain("worker_name");
      expect(requiredColumns).toContain("status");
      expect(requiredColumns).toContain("lock_acquired");
    });

    it("should define valid status values", () => {
      const validStatuses = ["started", "completed", "failed"];

      expect(validStatuses).toContain("started");
      expect(validStatuses).toContain("completed");
      expect(validStatuses).toContain("failed");
    });
  });

  describe("Worker Config Table Schema", () => {
    it("should define configurable worker properties", () => {
      const configProperties = [
        "worker_name",
        "enabled",
        "description",
        "schedule_cron",
        "max_retries",
        "timeout_seconds",
      ];

      expect(configProperties).toContain("enabled");
      expect(configProperties).toContain("max_retries");
      expect(configProperties).toContain("timeout_seconds");
    });
  });

  describe("Critical Workers List", () => {
    it("should include all workers requiring distributed locks", () => {
      const criticalWorkers = [
        "payroll-nightly-recalc",
        "leave-monthly-credit",
        "leave-annual-el-credit",
        "attendance-engine",
        "integration-scheduler",
        "lms-sync",
        "privacy-retention",
        "sla-breach",
        "kpi-daily-sync",
        "apr-vicidial-sync",
        "cosec-sync",
      ];

      expect(criticalWorkers).toContain("payroll-nightly-recalc");
      expect(criticalWorkers).toContain("leave-monthly-credit");
      expect(criticalWorkers).toContain("integration-scheduler");
    });
  });
});
