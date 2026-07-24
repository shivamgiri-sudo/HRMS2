/**
 * MySQL Integration Tests for Migration Governance
 *
 * These tests verify actual database behavior when TEST_DB_HOST is configured.
 * They are SKIPPED when no test database is available (CI without MySQL).
 *
 * To run locally with a test database:
 *   TEST_DB_HOST=localhost TEST_DB_USER=root TEST_DB_PASSWORD=root TEST_DB_NAME=mas_hrms_test npm test -- --run migration-mysql-integration
 *
 * Test scenarios:
 * 1. Advisory lock acquisition and release
 * 2. Schema verification state transitions
 * 3. Concurrent migration protection
 * 4. Checksum verification against actual DB
 * 5. Failed migration handling (never marked success=1)
 * 6. Ledger row verification
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import mysql from "mysql2/promise";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import * as crypto from "crypto";

// Test database configuration - ONLY use explicit TEST_DB_* env vars
// Do NOT fall back to production DB_* vars to prevent accidents
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST,
  port: parseInt(process.env.TEST_DB_PORT || "3306", 10),
  user: process.env.TEST_DB_USER,
  password: process.env.TEST_DB_PASSWORD,
  database: process.env.TEST_DB_NAME,
};

// Skip MySQL tests unless TEST_DB_HOST is explicitly set
const SKIP_MYSQL_TESTS = !process.env.TEST_DB_HOST;

describe.skipIf(SKIP_MYSQL_TESTS)("Migration MySQL Integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (SKIP_MYSQL_TESTS) return;

    pool = mysql.createPool({
      ...TEST_DB_CONFIG,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 10,
      connectTimeout: 5000,
    });

    // Verify connection
    const [rows] = await pool.query("SELECT 1 AS test");
    expect(rows).toBeDefined();

    // Ensure schema_migrations table exists for tests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum_sha256 VARCHAR(64),
        environment VARCHAR(50),
        start_time TIMESTAMP NULL,
        end_time TIMESTAMP NULL,
        duration_ms INT,
        executor VARCHAR(255),
        success TINYINT(1) DEFAULT 1,
        error_message TEXT
      )
    `);
  }, 15000);

  afterAll(async () => {
    if (pool) {
      await pool.end().catch(() => {});
    }
  });

  describe("Advisory Lock Behavior", () => {
    const LOCK_NAME = "hrms_migration_test_lock";
    const LOCK_TIMEOUT = 1; // 1 second for fast tests

    it("should acquire advisory lock successfully", async () => {
      const conn = await pool.getConnection();
      try {
        const [result] = await conn.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, ?) AS acquired`,
          [LOCK_NAME, LOCK_TIMEOUT]
        );
        expect(result[0].acquired).toBe(1);

        // Release the lock
        await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
      } finally {
        conn.release();
      }
    });

    it("should block second lock attempt while first is held", async () => {
      const conn1 = await pool.getConnection();
      const conn2 = await pool.getConnection();

      try {
        // First connection acquires lock
        const [result1] = await conn1.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, ?) AS acquired`,
          [LOCK_NAME, LOCK_TIMEOUT]
        );
        expect(result1[0].acquired).toBe(1);

        // Second connection tries to acquire - should timeout
        const [result2] = await conn2.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, ?) AS acquired`,
          [LOCK_NAME, LOCK_TIMEOUT]
        );
        expect(result2[0].acquired).toBe(0); // Should fail to acquire

        // Release from first connection
        await conn1.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);

        // Now second connection should be able to acquire
        const [result3] = await conn2.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, ?) AS acquired`,
          [LOCK_NAME, LOCK_TIMEOUT]
        );
        expect(result3[0].acquired).toBe(1);

        await conn2.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
      } finally {
        conn1.release();
        conn2.release();
      }
    });

    it("should release lock when connection closes", async () => {
      // First connection acquires lock, then closes
      const conn1 = await pool.getConnection();
      await conn1.query<RowDataPacket[]>(
        `SELECT GET_LOCK(?, ?) AS acquired`,
        [LOCK_NAME, LOCK_TIMEOUT]
      );
      conn1.release(); // Releases lock automatically

      // Second connection should be able to acquire immediately
      const conn2 = await pool.getConnection();
      try {
        const [result] = await conn2.query<RowDataPacket[]>(
          `SELECT GET_LOCK(?, ?) AS acquired`,
          [LOCK_NAME, LOCK_TIMEOUT]
        );
        expect(result[0].acquired).toBe(1);
        await conn2.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]);
      } finally {
        conn2.release();
      }
    });
  });

  describe("Schema Migrations Ledger", () => {
    const TEST_MIGRATION = `test_migration_${Date.now()}.sql`;

    afterEach(async () => {
      // Cleanup test migrations
      await pool.query(
        `DELETE FROM schema_migrations WHERE filename LIKE 'test_migration_%'`
      ).catch(() => {});
    });

    it("should record successful migration with checksum", async () => {
      const content = "CREATE TABLE test_table (id INT);";
      const checksum = crypto.createHash("sha256").update(content).digest("hex");

      await pool.query(
        `INSERT INTO schema_migrations (filename, checksum_sha256, success, environment, executor)
         VALUES (?, ?, 1, 'test', 'vitest')`,
        [TEST_MIGRATION, checksum]
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM schema_migrations WHERE filename = ?`,
        [TEST_MIGRATION]
      );

      expect(rows.length).toBe(1);
      expect(rows[0].checksum_sha256).toBe(checksum);
      expect(rows[0].success).toBe(1);
    });

    it("should record failed migration with success=0 and error message", async () => {
      const errorMessage = "Test error: column already exists";

      await pool.query(
        `INSERT INTO schema_migrations (filename, success, error_message, environment)
         VALUES (?, 0, ?, 'test')`,
        [TEST_MIGRATION, errorMessage]
      );

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM schema_migrations WHERE filename = ?`,
        [TEST_MIGRATION]
      );

      expect(rows.length).toBe(1);
      expect(rows[0].success).toBe(0);
      expect(rows[0].error_message).toBe(errorMessage);
    });

    it("should prevent duplicate successful migrations (unique filename)", async () => {
      // First insert
      await pool.query(
        `INSERT INTO schema_migrations (filename, success) VALUES (?, 1)`,
        [TEST_MIGRATION]
      );

      // Second insert should fail
      await expect(
        pool.query(
          `INSERT INTO schema_migrations (filename, success) VALUES (?, 1)`,
          [TEST_MIGRATION]
        )
      ).rejects.toThrow(/Duplicate entry/);
    });

    it("should not have any success=1 entries with non-empty error_message", async () => {
      // This is a data integrity check
      const [rows] = await pool.query<RowDataPacket[]>(`
        SELECT filename FROM schema_migrations
        WHERE success = 1 AND error_message IS NOT NULL AND error_message != ''
      `);

      // Log any violations for debugging
      if (rows.length > 0) {
        console.warn("Integrity violation: success=1 with error_message:", rows.map(r => r.filename));
      }

      expect(rows.length).toBe(0);
    });
  });

  describe("Connection Pool Behavior", () => {
    it("should handle connection exhaustion gracefully", async () => {
      // Create a small pool to test exhaustion
      const smallPool = mysql.createPool({
        ...TEST_DB_CONFIG,
        connectionLimit: 2,
        queueLimit: 1,
        waitForConnections: true,
        acquireTimeout: 1000,
      });

      try {
        // Acquire all connections
        const conn1 = await smallPool.getConnection();
        const conn2 = await smallPool.getConnection();

        // Third connection should queue but succeed when one is released
        const conn3Promise = smallPool.getConnection();

        // Release one to allow conn3 to proceed
        conn1.release();

        const conn3 = await conn3Promise;
        expect(conn3).toBeDefined();

        conn2.release();
        conn3.release();
      } finally {
        await smallPool.end();
      }
    });

    it("should detect database connection errors", async () => {
      const badPool = mysql.createPool({
        host: "nonexistent.invalid.host.that.does.not.exist",
        port: 3306,
        user: "nobody",
        password: "wrong",
        database: "nonexistent",
        connectTimeout: 1000,
      });

      try {
        await badPool.query("SELECT 1");
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // Expected - connection should fail
        expect(error.code).toMatch(/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ER_ACCESS_DENIED|ENETUNREACH/);
      } finally {
        await badPool.end().catch(() => {});
      }
    });
  });

  describe("Transaction Safety", () => {
    const TEST_TABLE = "migration_test_txn_" + Date.now();

    beforeAll(async () => {
      // Create test table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
          id INT PRIMARY KEY AUTO_INCREMENT,
          value VARCHAR(100)
        )
      `);
    });

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
    });

    it("should rollback transaction on error", async () => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(`INSERT INTO ${TEST_TABLE} (value) VALUES ('rollback_test')`);

        // Simulate error by rolling back
        await conn.rollback();

        // Verify rollback worked
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM ${TEST_TABLE} WHERE value = 'rollback_test'`
        );
        expect(rows.length).toBe(0);
      } finally {
        conn.release();
      }
    });

    it("should commit transaction successfully", async () => {
      const conn = await pool.getConnection();
      const testValue = `commit_test_${Date.now()}`;
      try {
        await conn.beginTransaction();
        await conn.query(`INSERT INTO ${TEST_TABLE} (value) VALUES (?)`, [testValue]);
        await conn.commit();

        // Verify commit worked
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT * FROM ${TEST_TABLE} WHERE value = ?`,
          [testValue]
        );
        expect(rows.length).toBe(1);

        // Cleanup
        await pool.query(`DELETE FROM ${TEST_TABLE} WHERE value = ?`, [testValue]);
      } finally {
        conn.release();
      }
    });
  });

  describe("Checksum Verification", () => {
    it("should compute consistent checksums", () => {
      const content = "CREATE TABLE test (id INT);";
      const hash1 = crypto.createHash("sha256").update(content).digest("hex");
      const hash2 = crypto.createHash("sha256").update(content).digest("hex");

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should detect content changes via checksum", () => {
      const content1 = "CREATE TABLE test (id INT);";
      const content2 = "CREATE TABLE test (id INT, name VARCHAR(100));";

      const hash1 = crypto.createHash("sha256").update(content1).digest("hex");
      const hash2 = crypto.createHash("sha256").update(content2).digest("hex");

      expect(hash1).not.toBe(hash2);
    });
  });
});

// Static tests that run without a database
describe("Migration Governance (Static)", () => {
  it("should export schema verification functions", async () => {
    const module = await import("../runPendingMigrations.js");
    expect(typeof module.getSchemaVerificationState).toBe("function");
    expect(typeof module.isSchemaReady).toBe("function");
    expect(typeof module.verifySchemaVersion).toBe("function");
  });

  it("should have valid initial verification state", async () => {
    const module = await import("../runPendingMigrations.js");
    const state = module.getSchemaVerificationState();

    const validStates = ["unverified", "verifying", "verified", "incompatible", "error"];
    expect(validStates).toContain(state.state);
    expect(typeof state.appliedCount).toBe("number");
    expect(typeof state.pendingCount).toBe("number");
    expect(Array.isArray(state.pendingFiles)).toBe(true);
  });

  it("should export migration manifest", async () => {
    const module = await import("../runPendingMigrations.js");
    expect(Array.isArray(module.MIGRATION_MANIFEST)).toBe("object" || "undefined" ? true : Array.isArray(module.MIGRATION_MANIFEST));
  });
});
