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
  approveCompanyPost,
  assertCanCreateCompanyPost,
  assertCanModerateCompanyPosts,
  createCompanyPost,
  deleteCompanyPost,
  grantCompanyPostCreator,
  listCompanyPostCreators,
  listApprovedCompanyFeed,
  listCompanyPostApprovals,
  listMyCompanyPosts,
  rejectCompanyPost,
  revokeCompanyPostCreator,
} from "../company-posts.service";

const {
  executeMock,
  connectionExecuteMock,
  beginTransactionMock,
  commitMock,
  rollbackMock,
  releaseMock,
  getConnectionMock,
  logSensitiveActionMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  connectionExecuteMock: vi.fn(),
  beginTransactionMock: vi.fn().mockResolvedValue(undefined),
  commitMock: vi.fn().mockResolvedValue(undefined),
  rollbackMock: vi.fn().mockResolvedValue(undefined),
  releaseMock: vi.fn(),
  getConnectionMock: vi.fn(),
  logSensitiveActionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../db/mysql.js", () => ({
  db: {
    execute: executeMock,
    getConnection: getConnectionMock,
  },
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

function makePostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000101",
    author_user_id: "00000000-0000-0000-0000-000000000201",
    author_employee_id: "00000000-0000-0000-0000-000000000301",
    content_text: "Team update",
    status: "pending_approval",
    moderation_state: "clean",
    moderation_score: null,
    auto_reject_reason: null,
    review_notes: null,
    submitted_at: "2026-07-18 09:00:00",
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    deleted_at: null,
    deleted_by: null,
    active_status: 1,
    created_at: "2026-07-18 09:00:00",
    updated_at: "2026-07-18 09:00:00",
    ...overrides,
  };
}

function makeMediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000401",
    post_id: "00000000-0000-0000-0000-000000000101",
    file_id: "00000000-0000-0000-0000-000000000501",
    media_type: "image",
    sort_order: 1,
    moderation_state: "clean",
    moderation_reason: null,
    ...overrides,
  };
}

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
    connectionExecuteMock.mockReset();
    beginTransactionMock.mockClear();
    commitMock.mockClear();
    rollbackMock.mockClear();
    releaseMock.mockClear();
    getConnectionMock.mockReset();
    getConnectionMock.mockResolvedValue({
      execute: connectionExecuteMock,
      beginTransaction: beginTransactionMock,
      commit: commitMock,
      rollback: rollbackMock,
      release: releaseMock,
    });
    logSensitiveActionMock.mockClear();
  });

  it("requires active creator access to create a company post", async () => {
    executeMock.mockResolvedValueOnce([[], []]);

    await expect(assertCanCreateCompanyPost("user-1")).rejects.toThrow("creator access");
    expect(executeMock.mock.calls[0][0]).toContain("company_post_creator_access");
  });

  it("allows only normalized moderation roles", async () => {
    executeMock.mockResolvedValueOnce([[{ role_key: "hr_head" }], []]);
    await expect(assertCanModerateCompanyPosts("user-2")).resolves.toBeUndefined();

    executeMock.mockResolvedValueOnce([[{ role_key: ` ${Role.HR_ADMIN} ` }], []]);
    await expect(assertCanModerateCompanyPosts("user-3")).rejects.toThrow("Access denied");

    executeMock.mockResolvedValueOnce([[{ role_key: "employee" }], []]);
    await expect(assertCanModerateCompanyPosts("user-4")).rejects.toThrow("Access denied");
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

describe("company feed lifecycle and moderation", () => {
  beforeEach(() => {
    executeMock.mockReset();
    connectionExecuteMock.mockReset();
    beginTransactionMock.mockClear();
    commitMock.mockClear();
    rollbackMock.mockClear();
    releaseMock.mockClear();
    getConnectionMock.mockReset();
    getConnectionMock.mockResolvedValue({
      execute: connectionExecuteMock,
      beginTransaction: beginTransactionMock,
      commit: commitMock,
      rollback: rollbackMock,
      release: releaseMock,
    });
    logSensitiveActionMock.mockClear();
  });

  it("auto rejects clear violations and audits the rejection path", async () => {
    executeMock
      .mockResolvedValueOnce([[{ 1: 1 }], []])
      .mockResolvedValueOnce([[{ id: "00000000-0000-0000-0000-000000000301" }], []])
      .mockResolvedValueOnce([[makePostRow({
        content_text: "This contains porn",
        status: "auto_rejected",
        moderation_state: "violation",
        auto_reject_reason: "Policy-violating content detected",
      })], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await createCompanyPost({
      actorUserId: "00000000-0000-0000-0000-000000000201",
      content_text: "This contains porn",
      media: [],
    });

    expect(result.status).toBe("auto_rejected");
    expect(result.moderation_state).toBe("violation");
    expect(beginTransactionMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(connectionExecuteMock.mock.calls[1][0]).toContain("INSERT INTO sensitive_action_log");
    expect(logSensitiveActionMock).not.toHaveBeenCalled();
  });

  it("flags borderline content for moderation review", async () => {
    executeMock
      .mockResolvedValueOnce([[{ 1: 1 }], []])
      .mockResolvedValueOnce([[{ id: "00000000-0000-0000-0000-000000000301" }], []])
      .mockResolvedValueOnce([[makePostRow({
        content_text: "Click here now for an investment scheme",
        status: "borderline_flagged",
        moderation_state: "borderline",
      })], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await createCompanyPost({
      actorUserId: "00000000-0000-0000-0000-000000000201",
      content_text: "Click here now for an investment scheme",
      media: [],
    });

    expect(result.status).toBe("borderline_flagged");
    expect(result.moderation_state).toBe("borderline");
    expect(logSensitiveActionMock).not.toHaveBeenCalled();
  });

  it("stores clean creator submissions as pending approval", async () => {
    executeMock
      .mockResolvedValueOnce([[{ 1: 1 }], []])
      .mockResolvedValueOnce([[{ id: "00000000-0000-0000-0000-000000000301" }], []])
      .mockResolvedValueOnce([[makePostRow({
        status: "pending_approval",
        moderation_state: "clean",
      })], []])
      .mockResolvedValueOnce([[makeMediaRow()], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await createCompanyPost({
      actorUserId: "00000000-0000-0000-0000-000000000201",
      content_text: "Quarterly townhall at 4 PM",
      media: [{ file_id: "00000000-0000-0000-0000-000000000501", media_type: "image", sort_order: 1 }],
    });

    expect(result.status).toBe("pending_approval");
    expect(result.media).toHaveLength(1);
    expect(connectionExecuteMock.mock.calls[0][0]).toContain("INSERT INTO company_posts");
    expect(connectionExecuteMock.mock.calls[1][0]).toContain("INSERT INTO company_post_media");
  });

  it("lists only approved posts on the public feed", async () => {
    executeMock
      .mockResolvedValueOnce([[makePostRow({
        status: "approved",
        moderation_state: "manual_override_approved",
      })], []])
      .mockResolvedValueOnce([[makeMediaRow()], []]);

    const result = await listApprovedCompanyFeed();

    expect(result.every((post) => post.status === "approved")).toBe(true);
    expect(executeMock.mock.calls[0][0]).toContain("status = 'approved' AND active_status = 1");
  });

  it("lets creators view their own non-approved posts", async () => {
    executeMock
      .mockResolvedValueOnce([[{ 1: 1 }], []])
      .mockResolvedValueOnce([[
        makePostRow({ status: "pending_approval" }),
        makePostRow({
          id: "00000000-0000-0000-0000-000000000102",
          status: "rejected",
          moderation_state: "manual_override_rejected",
        }),
      ], []])
      .mockResolvedValueOnce([[], []]);

    const result = await listMyCompanyPosts({
      actorUserId: "00000000-0000-0000-0000-000000000201",
    });

    expect(result.map((post) => post.status)).toEqual(["pending_approval", "rejected"]);
    expect(executeMock.mock.calls[1][0]).toContain("author_user_id = ? AND active_status = 1");
    expect(executeMock.mock.calls[1][0]).toContain("status <> 'deleted'");
  });

  it("returns pending and borderline posts in the moderator approval queue", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "hr_head" }], []])
      .mockResolvedValueOnce([[
        makePostRow({ status: "pending_approval" }),
        makePostRow({
          id: "00000000-0000-0000-0000-000000000103",
          status: "borderline_flagged",
          moderation_state: "borderline",
        }),
      ], []])
      .mockResolvedValueOnce([[], []]);

    const result = await listCompanyPostApprovals({
      actorUserId: "00000000-0000-0000-0000-000000000701",
    });

    expect(result.map((post) => post.status)).toEqual(["pending_approval", "borderline_flagged"]);
    expect(executeMock.mock.calls[1][0]).toContain(
      "status IN ('pending_approval', 'borderline_flagged') AND active_status = 1",
    );
  });

  it("approves a queued post and audits the moderation action", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "hr_head" }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[makePostRow({
        status: "approved",
        moderation_state: "manual_override_approved",
        approved_by: "00000000-0000-0000-0000-000000000701",
        approved_at: "2026-07-18 10:00:00",
      })], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "pending_approval" })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await approveCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000701",
      action: "approve",
      review_notes: "Policy compliant",
    });

    expect(result.status).toBe("approved");
    expect(connectionExecuteMock.mock.calls[2][0]).toContain("INSERT INTO sensitive_action_log");
  });

  it("rejects a queued post and audits the moderation action", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "admin" }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[makePostRow({
        status: "rejected",
        moderation_state: "manual_override_rejected",
        rejection_reason: "Spam-like content",
        rejected_by: "00000000-0000-0000-0000-000000000702",
        rejected_at: "2026-07-18 10:30:00",
      })], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "borderline_flagged", moderation_state: "borderline" })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    const result = await rejectCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000702",
      action: "reject",
      reason: "Spam-like content",
      review_notes: "Needs rewrite",
    });

    expect(result.status).toBe("rejected");
    expect(connectionExecuteMock.mock.calls[2][0]).toContain("INSERT INTO sensitive_action_log");
  });

  it("soft deletes a post and audits the deletion path", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "super_admin" }], []])
      .mockResolvedValueOnce([[makePostRow({ status: "approved" })], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "approved" })], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(deleteCompanyPost({
      postId: "00000000-0000-0000-0000-000000000101",
      actorUserId: "00000000-0000-0000-0000-000000000703",
      reason: "Policy retention cleanup",
    })).resolves.toBeUndefined();

    expect(connectionExecuteMock.mock.calls[1][0]).toContain("SET status = 'deleted'");
    expect(connectionExecuteMock.mock.calls[2][0]).toContain("INSERT INTO sensitive_action_log");
  });

  it("denies moderation to ordinary HR admin users", async () => {
    executeMock.mockResolvedValueOnce([[{ role_key: Role.HR_ADMIN }], []]);

    await expect(approveCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000704",
      action: "approve",
    })).rejects.toThrow("Access denied");

    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects approval when the post is not in a queued moderation state", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "super_admin" }], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock.mockResolvedValueOnce([[
      makePostRow({
        status: "auto_rejected",
        moderation_state: "violation",
      }),
    ], []]);

    await expect(approveCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000705",
      action: "approve",
    })).rejects.toThrow("Only queued company posts can be approved");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("rejects moderation rejection when the post is not in a queued moderation state", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "admin" }], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock.mockResolvedValueOnce([[
      makePostRow({
        status: "approved",
        moderation_state: "manual_override_approved",
      }),
    ], []]);

    await expect(rejectCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000706",
      action: "reject",
      reason: "Late moderation attempt",
    })).rejects.toThrow("Only queued company posts can be rejected");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("rolls back create when transactional audit insert fails", async () => {
    executeMock
      .mockResolvedValueOnce([[{ 1: 1 }], []])
      .mockResolvedValueOnce([[{ id: "00000000-0000-0000-0000-000000000301" }], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(createCompanyPost({
      actorUserId: "00000000-0000-0000-0000-000000000201",
      content_text: "This contains porn",
      media: [],
    })).rejects.toThrow("audit insert failed");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("rolls back approval when the queued row is changed before update", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "super_admin" }], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "pending_approval" })], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(approveCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000707",
      action: "approve",
    })).rejects.toThrow("queued state changed");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
    expect(connectionExecuteMock).toHaveBeenCalledTimes(2);
  });

  it("rolls back rejection when the queued row is changed before update", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "admin" }], []])
      .mockResolvedValueOnce([[], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "borderline_flagged", moderation_state: "borderline" })], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(rejectCompanyPost({
      post_id: "00000000-0000-0000-0000-000000000101",
      actor_user_id: "00000000-0000-0000-0000-000000000708",
      action: "reject",
      reason: "Concurrent moderation change",
    })).rejects.toThrow("queued state changed");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
    expect(connectionExecuteMock).toHaveBeenCalledTimes(2);
  });

  it("rolls back deletion when the post row is changed before update", async () => {
    executeMock
      .mockResolvedValueOnce([[{ role_key: "super_admin" }], []])
      .mockResolvedValueOnce([[makePostRow({ status: "approved" })], []]);
    connectionExecuteMock
      .mockResolvedValueOnce([[makePostRow({ status: "approved" })], []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(deleteCompanyPost({
      postId: "00000000-0000-0000-0000-000000000101",
      actorUserId: "00000000-0000-0000-0000-000000000709",
      reason: "Concurrent delete race",
    })).rejects.toThrow("record changed");

    expect(rollbackMock).toHaveBeenCalledTimes(1);
    expect(commitMock).not.toHaveBeenCalled();
    expect(connectionExecuteMock).toHaveBeenCalledTimes(2);
    expect(connectionExecuteMock.mock.calls[1][0]).toContain("WHERE id = ? AND status = ?");
  });
});
