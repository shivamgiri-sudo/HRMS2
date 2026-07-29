#!/usr/bin/env node
/**
 * Standalone migration runner script.
 *
 * Usage:
 *   npm run migrate              # Run all pending migrations
 *   npm run migrate -- --status  # Show migration status without running
 *   npm run migrate -- --force   # Force run even if lock acquisition fails
 *
 * Environment variables:
 *   MIGRATION_STRICT_MODE=true   # Fail on missing files or checksum mismatch
 *   MIGRATION_STOP_ON_FAILURE=false  # Continue after failure (default: stop)
 *
 * This script should be run BEFORE starting the API server in production.
 * Use MIGRATIONS_VERIFY_ONLY=true on the API to enforce this workflow.
 */

import { runPendingMigrations, getMigrationHealth, verifySchemaVersion } from "../db/runPendingMigrations.js";

const args = process.argv.slice(2);
const showStatus = args.includes("--status");
const forceRun = args.includes("--force");

async function main() {
  console.log("=".repeat(60));
  console.log("HRMS Migration Runner");
  console.log("=".repeat(60));

  if (showStatus) {
    console.log("\nChecking migration status...\n");
    const status = await verifySchemaVersion();

    console.log(`Migrations applied: ${status.appliedCount}`);
    console.log(`Migrations pending: ${status.pendingCount}`);
    if (status.pendingFiles.length > 0) {
      console.log("\nPending files:");
      status.pendingFiles.forEach((file, index) => console.log(`  ${index + 1}. ${file}`));
    }
    console.log(`\nSchema valid: ${status.valid ? "YES" : "NO"}`);
    process.exit(status.valid ? 0 : 1);
  }

  if (forceRun) {
    console.log("\n[WARN] --force flag set. Will attempt to run even if lock fails.\n");
  }

  console.log("\nRunning migrations...\n");

  try {
    await runPendingMigrations();

    const finalHealth = getMigrationHealth();

    console.log("\n" + "=".repeat(60));
    console.log("Migration Summary");
    console.log("=".repeat(60));
    console.log(`Status: ${finalHealth.status.toUpperCase()}`);
    console.log(`Started: ${finalHealth.startedAt}`);
    console.log(`Completed: ${finalHealth.completedAt}`);
    console.log(`Applied: ${finalHealth.applied.length}`);
    console.log(`Skipped: ${finalHealth.skipped.length}`);
    console.log(`Failed: ${finalHealth.failed.length}`);

    if (finalHealth.applied.length > 0) {
      console.log("\nNewly applied migrations:");
      finalHealth.applied.forEach((file) => console.log(`  + ${file}`));
    }

    if (finalHealth.failed.length > 0) {
      console.log("\nFailed migrations:");
      finalHealth.failed.forEach((failure) => console.log(`  X ${failure.filename}: ${failure.error}`));
      process.exit(1);
    }

    console.log("\nMigrations completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\nMigration failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
