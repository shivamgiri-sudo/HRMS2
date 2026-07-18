import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CreateCompanyPostSchema,
  GrantCompanyPostCreatorSchema,
  ModerateCompanyPostSchema,
  RevokeCompanyPostCreatorSchema,
} from "../company-posts.validation";
import type { CreateCompanyPostDTO } from "../company-posts.types";

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

describe("company feed validation", () => {
  it("accepts a text post with image media", () => {
    expect(CreateCompanyPostSchema.safeParse({
      content_text: "Townhall at 4 PM",
      media: [{ file_id: "file-1", media_type: "image", sort_order: 1 }],
    }).success).toBe(true);
  });

  it("requires text or at least one image", () => {
    expect(CreateCompanyPostSchema.safeParse({
      content_text: "",
      media: [],
    }).success).toBe(false);
  });

  it("limits v1 media to four images", () => {
    expect(CreateCompanyPostSchema.safeParse({
      media: [1, 2, 3, 4, 5].map((sort_order) => ({
        file_id: `file-${sort_order}`,
        media_type: "image",
        sort_order,
      })),
    }).success).toBe(false);
  });

  it("requires UUID employee and user IDs for creator access", () => {
    expect(GrantCompanyPostCreatorSchema.safeParse({
      employee_id: "not-a-uuid",
      user_id: "not-a-uuid",
    }).success).toBe(false);
    expect(RevokeCompanyPostCreatorSchema.safeParse({
      employee_id: "not-a-uuid",
    }).success).toBe(false);
  });

  it("requires a UUID post and actor for moderation", () => {
    expect(ModerateCompanyPostSchema.safeParse({
      actor_user_id: "00000000-0000-0000-0000-000000000001",
      action: "approve",
    }).success).toBe(false);
    expect(ModerateCompanyPostSchema.safeParse({
      post_id: "not-a-uuid",
      actor_user_id: "not-a-uuid",
      action: "approve",
    }).success).toBe(false);
  });

  it("does not expose server-managed media fields in create requests", () => {
    const createPost: CreateCompanyPostDTO = {
      media: [{ file_id: "file-1", media_type: "image", sort_order: 1 }],
    };

    expect(createPost.media).toEqual([
      { file_id: "file-1", media_type: "image", sort_order: 1 },
    ]);

    // @ts-expect-error Response-only media identifiers must not be accepted on create.
    const serverManagedMedia: CreateCompanyPostDTO["media"] = [
      { file_id: "file-1", media_type: "image", sort_order: 1, id: "post-media-1" },
    ];
    expect(serverManagedMedia).toBeDefined();
  });

  it("rejects server-managed media fields at runtime", () => {
    const result = CreateCompanyPostSchema.safeParse({
      media: [{
        file_id: "file-1",
        media_type: "image",
        sort_order: 1,
        id: "post-media-1",
      }],
    });

    expect(result.success).toBe(false);
  });
});
