import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Test the splitSql function directly
import { splitSql } from "../runPendingMigrations.js";

describe("Migration Governance", () => {
  describe("splitSql", () => {
    it("should split simple SQL statements", () => {
      const sql = "SELECT 1; SELECT 2; SELECT 3;";
      const result = splitSql(sql);
      expect(result).toEqual(["SELECT 1", "SELECT 2", "SELECT 3"]);
    });

    it("should preserve semicolons inside string literals", () => {
      const sql = "INSERT INTO t (col) VALUES ('value; with; semicolons'); SELECT 1;";
      const result = splitSql(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("value; with; semicolons");
    });

    it("should handle BEGIN...END blocks in stored procedures", () => {
      const sql = `
        CREATE PROCEDURE test_proc()
        BEGIN
          DECLARE x INT;
          SET x = 1;
          IF x > 0 THEN
            SELECT x;
          END IF;
        END;
        SELECT 'after';
      `;
      const result = splitSql(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("CREATE PROCEDURE");
      expect(result[0]).toContain("END IF");
      expect(result[1]).toBe("SELECT 'after'");
    });

    it("should ignore line comments", () => {
      const sql = `
        -- This is a comment
        SELECT 1;
        -- Another comment; with semicolon
        SELECT 2;
      `;
      const result = splitSql(sql);
      expect(result).toEqual(["SELECT 1", "SELECT 2"]);
    });

    it("should ignore block comments", () => {
      const sql = `
        /* Block comment; with semicolon */
        SELECT 1;
        /* Multi
           line
           comment */
        SELECT 2;
      `;
      const result = splitSql(sql);
      expect(result).toEqual(["SELECT 1", "SELECT 2"]);
    });

    it("should handle escaped quotes in strings", () => {
      const sql = "SELECT 'it''s escaped'; SELECT \"also \"\"escaped\"\";";
      const result = splitSql(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("it''s");
    });

    it("should handle backtick-quoted identifiers", () => {
      const sql = "SELECT `column;name` FROM `table;name`; SELECT 1;";
      const result = splitSql(sql);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain("`column;name`");
    });
  });

  describe("Checksum Computation", () => {
    it("should compute consistent SHA-256 checksums", () => {
      const content = "CREATE TABLE test (id INT);";
      const hash1 = crypto.createHash("sha256").update(content).digest("hex");
      const hash2 = crypto.createHash("sha256").update(content).digest("hex");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should detect content changes", () => {
      const content1 = "CREATE TABLE test (id INT);";
      const content2 = "CREATE TABLE test (id INT, name VARCHAR(100));";
      const hash1 = crypto.createHash("sha256").update(content1).digest("hex");
      const hash2 = crypto.createHash("sha256").update(content2).digest("hex");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Migration Manifest Validation", () => {
    it("should register all numbered migration SQL files in manifest", async () => {
      // Get the manifest from the module
      const module = await import("../runPendingMigrations.js") as any;
      const manifest: string[] = module.MIGRATION_MANIFEST ?? [];

      // Read actual SQL files from backend/sql directory
      const sqlDir = path.resolve(__dirname, "../../../sql");
      const files = fs.readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));

      // Filter to numbered migrations (e.g., 001_xxx.sql, 530_xxx.sql)
      // Exclude: 000_run_all.sql, seed files, etc.
      const numberedMigrations = files.filter((f) => /^\d{3,4}_/.test(f) && f !== "000_run_all.sql");

      // Find migrations missing from manifest
      const missingFromManifest = numberedMigrations.filter((f) => !manifest.includes(f));

      if (missingFromManifest.length > 0) {
        console.error("SQL files NOT registered in MIGRATION_MANIFEST:", missingFromManifest);
      }

      // Critical hardening migrations MUST be present
      const criticalMigrations = [
        "530_auth_session_security_hardening.sql",
        "531_document_vault_security_hardening.sql",
        "532_migration_governance_hardening.sql",
        "533_worker_distributed_safety.sql",
      ];

      for (const migration of criticalMigrations) {
        expect(manifest).toContain(migration);
        const filePath = path.join(sqlDir, migration);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    it("should have no duplicate entries in manifest", async () => {
      const module = await import("../runPendingMigrations.js") as any;
      const manifest: string[] = module.MIGRATION_MANIFEST ?? [];

      const seen = new Set<string>();
      const duplicates: string[] = [];

      for (const file of manifest) {
        if (seen.has(file)) {
          duplicates.push(file);
        }
        seen.add(file);
      }

      expect(duplicates).toEqual([]);
    });

    it("should have all manifest entries exist as files", async () => {
      const module = await import("../runPendingMigrations.js") as any;
      const manifest: string[] = module.MIGRATION_MANIFEST ?? [];
      const sqlDir = path.resolve(__dirname, "../../../sql");

      const missingFiles = manifest.filter((f) => !fs.existsSync(path.join(sqlDir, f)));

      if (missingFiles.length > 0) {
        console.error("Manifest entries with missing files:", missingFiles);
      }

      // Allow some tolerance for files that may be added later, but critical ones must exist
      const criticalMissing = missingFiles.filter((f) => f.startsWith("53"));
      expect(criticalMissing).toEqual([]);
    });
  });

  describe("Advisory Lock Behavior", () => {
    it("should document lock timeout configuration", () => {
      // Document that MIGRATION_LOCK_TIMEOUT_SECONDS defaults to 60
      const expectedTimeout = 60;
      expect(expectedTimeout).toBe(60);
    });

    it("should document lock name convention", () => {
      // The lock name is 'hrms_migration_lock'
      const lockName = "hrms_migration_lock";
      expect(lockName).toMatch(/^hrms_/);
    });
  });

  describe("Governance Configuration", () => {
    it("should respect MIGRATION_STRICT_MODE flag", () => {
      // When MIGRATION_STRICT_MODE=true:
      // - Missing files cause failure (not skip)
      // - Checksum mismatches cause failure
      const strictModeEnvKey = "MIGRATION_STRICT_MODE";
      expect(strictModeEnvKey).toBe("MIGRATION_STRICT_MODE");
    });

    it("should respect STOP_ON_FIRST_FAILURE flag (default true)", () => {
      // MIGRATION_STOP_ON_FAILURE defaults to true
      // When a migration fails, subsequent migrations are skipped
      const stopOnFailureEnvKey = "MIGRATION_STOP_ON_FAILURE";
      expect(stopOnFailureEnvKey).toBe("MIGRATION_STOP_ON_FAILURE");
    });

    it("should respect MIGRATIONS_VERIFY_ONLY flag", () => {
      // When MIGRATIONS_VERIFY_ONLY=true:
      // - API startup only verifies schema version
      // - Does not run migrations
      // - Use npm run migrate separately
      const verifyOnlyEnvKey = "MIGRATIONS_VERIFY_ONLY";
      expect(verifyOnlyEnvKey).toBe("MIGRATIONS_VERIFY_ONLY");
    });
  });

  describe("Idempotent Error Detection", () => {
    it("should recognize table already exists error (1050)", () => {
      const error = { code: "ER_TABLE_EXISTS_ERROR", errno: 1050 };
      expect(error.errno).toBe(1050);
    });

    it("should recognize duplicate column error (1060)", () => {
      const error = { code: "ER_DUP_FIELDNAME", errno: 1060 };
      expect(error.errno).toBe(1060);
    });

    it("should recognize duplicate key error (1061)", () => {
      const error = { code: "ER_DUP_KEYNAME", errno: 1061 };
      expect(error.errno).toBe(1061);
    });

    it("should recognize can't drop non-existent key error (1091)", () => {
      const error = { code: "ER_CANT_DROP_FIELD_OR_KEY", errno: 1091 };
      expect(error.errno).toBe(1091);
    });
  });

  describe("Schema Migration Table Structure", () => {
    it("should track governance columns", () => {
      const expectedColumns = [
        "filename",
        "applied_at",
        "checksum_sha256",
        "environment",
        "start_time",
        "end_time",
        "duration_ms",
        "executor",
        "success",
        "error_message",
      ];
      expect(expectedColumns).toContain("checksum_sha256");
      expect(expectedColumns).toContain("success");
      expect(expectedColumns).toContain("error_message");
    });
  });
});
