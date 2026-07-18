import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("../../../../sql/451_company_feed_foundation.sql", import.meta.url),
  "utf8",
);
const runtimeMigrationManifest = readFileSync(
  new URL("../../../../src/db/runPendingMigrations.ts", import.meta.url),
  "utf8",
);

describe("company feed database foundation", () => {
  it("preserves the required company post tables and statuses", () => {
    const requiredStatuses = [
      "draft",
      "pending_approval",
      "borderline_flagged",
      "approved",
      "rejected",
      "auto_rejected",
      "deleted",
    ];
    const requiredTables = [
      "company_posts",
      "company_post_media",
      "company_post_creator_access",
      "company_post_audit_log",
    ];

    expect(requiredStatuses).toEqual([
      "draft",
      "pending_approval",
      "borderline_flagged",
      "approved",
      "rejected",
      "auto_rejected",
      "deleted",
    ]);
    expect(requiredTables).toEqual([
      "company_posts",
      "company_post_media",
      "company_post_creator_access",
      "company_post_audit_log",
    ]);

    for (const table of requiredTables) {
      expect(migrationSql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "i"));
    }
    for (const status of requiredStatuses) {
      expect(migrationSql).toContain(`'${status}'`);
    }

    expect(runtimeMigrationManifest).toMatch(
      /"450_policy_engine_config\.sql",\s*"451_company_feed_foundation\.sql",/,
    );
  });
});
