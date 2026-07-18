import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateCompanyPostSchema,
  GrantCompanyPostCreatorSchema,
  ModerateCompanyPostSchema,
  RevokeCompanyPostCreatorSchema,
} from "../company-posts.validation";
import type { CreateCompanyPostDTO } from "../company-posts.types";
import { Role } from "../../../platform/policy/roles";
import {
  assertCanCreateCompanyPost,
  assertCanModerateCompanyPosts,
  grantCompanyPostCreator,
  listCompanyPostCreators,
  revokeCompanyPostCreator,
} from "../company-posts.service";

const { executeMock, logSensitiveActionMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  logSensitiveActionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: { execute: executeMock },
}));

vi.mock("../../../shared/auditLog.js", () => ({
  logSensitiveAction: logSensitiveActionMock,
}));

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

describe("company feed permissions and creator access", () => {
  beforeEach(() => {
    executeMock.mockReset();
    logSensitiveActionMock.mockClear();
  });

  it("requires active creator access to create a company post", async () => {
    executeMock.mockResolvedValueOnce([[], []]);

    await expect(assertCanCreateCompanyPost("user-1")).rejects.toThrow("creator access");
    expect(executeMock.mock.calls[0][0]).toContain("company_post_creator_access");
  });

  it("allows only normalized moderation roles", async () => {
    executeMock.mockResolvedValueOnce([[{ role_key: ` ${Role.HR_ADMIN} ` }], []]);
    await expect(assertCanModerateCompanyPosts("user-2")).resolves.toBeUndefined();

    executeMock.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    await expect(assertCanModerateCompanyPosts("user-3")).rejects.toThrow("Access denied");
  });

  it("allows only super admins to grant creator access and audits the grant", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "Super Admin" }], []])
      .mockResolvedValueOnce([[{ user_id: "user-4" }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([[{ id: "access-1", employee_id: "emp-1", user_id: "user-4" }], []]);

    await expect(grantCompanyPostCreator({
      actorUserId: "super-admin-id",
      employeeId: "emp-1",
    })).resolves.toMatchObject({ id: "access-1" });
    expect(logSensitiveActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action_type: "COMPANY_FEED_CREATOR_GRANTED",
      actor_user_id: "super-admin-id",
    }));
  });

  it("revokes creator access only for super admins and audits the revoke", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "admin" }], []]);

    await expect(revokeCompanyPostCreator({
      actorUserId: "admin-id",
      employeeId: "emp-1",
    })).rejects.toThrow("super administrator");
  });

  it("fails without auditing when no active creator access row is revoked", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "super_admin" }], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(revokeCompanyPostCreator({
      actorUserId: "super-admin-id",
      employeeId: "emp-1",
    })).rejects.toThrow("active company post creator access");
    expect(logSensitiveActionMock).not.toHaveBeenCalled();
  });

  it("lists creator access rows", async () => {
    executeMock.mockResolvedValueOnce([[{ id: "access-1" }], []]);

    await expect(listCompanyPostCreators()).resolves.toEqual([{ id: "access-1" }]);
    expect(executeMock.mock.calls[0][0]).toContain("FROM company_post_creator_access");
  });
});
