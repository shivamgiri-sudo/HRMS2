# Company Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a government-audit-ready internal company feed with restricted creator access, pre-publication moderation, approver-controlled publishing, and MCN-branded premium UI.

**Architecture:** Extend the existing engagement module with an additive `company-posts` service and routes, backed by new MySQL tables for posts, media, creator access, and audit history. Add four frontend pages plus a Super Admin creator-access page, using existing shadcn/Tailwind/HRMS design tokens and enforcing visibility rules entirely from backend APIs.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind, shadcn/ui, Express, TypeScript, MySQL, existing file-storage APIs, existing audit logging utility.

## Global Constraints

- Use additive MySQL migrations only; do not edit previously applied migrations.
- Do not delete or replace existing engagement functionality.
- Backend authorization is mandatory for create, approve, reject, delete, and creator-right changes.
- All moderation, approval, deletion, and creator-access changes must be auditable.
- All employees can read approved posts; only Super Admin-assigned creators can submit posts.
- `hr_head`, `admin`, and `super_admin` are the only approvers and deleters.
- Violating content must auto-reject before publication; borderline content must route to moderation.
- Use existing MCN brand tokens from `src/index.css` and `src/styles/hrms-design-system.css`.
- UI should feel premium and social-feed-like, but must not copy Facebook colors.
- Follow existing engagement module patterns and existing file-handling patterns.

---

## File Map

### Backend

- Create: `backend/sql/451_company_feed_foundation.sql`
- Create: `backend/src/modules/engagement/company-posts.types.ts`
- Create: `backend/src/modules/engagement/company-posts.validation.ts`
- Create: `backend/src/modules/engagement/company-posts.service.ts`
- Create: `backend/src/modules/engagement/company-posts.controller.ts`
- Modify: `backend/src/modules/engagement/engagement.routes.ts`
- Modify: `backend/src/modules/engagement/engagement.types.ts`
- Modify: `backend/src/modules/engagement/engagement.validation.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.routes.test.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

### Frontend

- Create: `src/hooks/useCompanyFeed.ts`
- Create: `src/pages/NativeCompanyFeed.tsx`
- Create: `src/pages/NativeCompanyPostCreate.tsx`
- Create: `src/pages/NativeCompanyPostApproval.tsx`
- Create: `src/pages/NativeCompanyPostManage.tsx`
- Create: `src/pages/NativeCompanyFeedCreatorAccess.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`

### Documentation

- Create: `docs/superpowers/specs/2026-07-18-company-feed-design.md` (already written)
- Create: `docs/superpowers/plans/2026-07-18-company-feed.md` (this file)

## Interfaces

### Backend service interfaces

- `createCompanyPost(input: CreateCompanyPostInput): Promise<CompanyPostDetail>`
- `listApprovedCompanyFeed(input: CompanyFeedQuery): Promise<CompanyFeedResponse>`
- `listMyCompanyPosts(input: MyCompanyPostsQuery): Promise<CreatorPostListResponse>`
- `listCompanyPostApprovals(input: ApprovalQueueQuery): Promise<ApprovalQueueResponse>`
- `approveCompanyPost(input: ModerateCompanyPostInput): Promise<CompanyPostDetail>`
- `rejectCompanyPost(input: ModerateCompanyPostInput): Promise<CompanyPostDetail>`
- `deleteCompanyPost(input: DeleteCompanyPostInput): Promise<void>`
- `listCompanyPostCreators(): Promise<CompanyPostCreatorAccessRow[]>`
- `grantCompanyPostCreator(input: CreatorAccessGrantInput): Promise<CompanyPostCreatorAccessRow>`
- `revokeCompanyPostCreator(input: CreatorAccessRevokeInput): Promise<CompanyPostCreatorAccessRow>`

### Frontend hook interfaces

- `useCompanyFeed(params)`
- `useMyCompanyPosts(params)`
- `useCreateCompanyPost()`
- `useApprovalQueue(params)`
- `useApproveCompanyPost()`
- `useRejectCompanyPost()`
- `useDeleteCompanyPost()`
- `useCompanyPostCreators()`
- `useGrantCompanyPostCreator()`
- `useRevokeCompanyPostCreator()`

---

### Task 1: Add Company Feed Database Foundation

**Files:**
- Create: `backend/sql/451_company_feed_foundation.sql`
- Modify: `backend/sql/000_run_all.sql` only if this repo’s migration runner manifest requires adding the new SQL source
- Test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

**Interfaces:**
- Consumes: existing MySQL migration conventions
- Produces:
  - `company_posts`
  - `company_post_media`
  - `company_post_creator_access`
  - `company_post_audit_log`

- [ ] **Step 1: Write the migration contract test cases in the service test file**

Add tests asserting the service expects these columns/status values:

```ts
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
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: FAIL because the test file/service schema assumptions do not exist yet.

- [ ] **Step 3: Write the additive SQL migration**

Create the migration with:

```sql
CREATE TABLE IF NOT EXISTS company_posts (
  id char(36) NOT NULL PRIMARY KEY,
  author_user_id char(36) NOT NULL,
  author_employee_id char(36) NOT NULL,
  content_text text NULL,
  status varchar(32) NOT NULL,
  moderation_state varchar(32) NOT NULL DEFAULT 'clean',
  moderation_score decimal(5,2) NULL,
  auto_reject_reason varchar(255) NULL,
  review_notes text NULL,
  submitted_at datetime NULL,
  approved_at datetime NULL,
  approved_by char(36) NULL,
  rejected_at datetime NULL,
  rejected_by char(36) NULL,
  rejection_reason varchar(500) NULL,
  deleted_at datetime NULL,
  deleted_by char(36) NULL,
  active_status tinyint(1) NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_company_posts_status (status),
  KEY idx_company_posts_author_user (author_user_id),
  KEY idx_company_posts_author_employee (author_employee_id),
  KEY idx_company_posts_created (created_at)
);
```

And similar additive definitions for media, creator access, and audit log.

- [ ] **Step 4: Update the runner manifest only if needed**

If the local schema runner requires explicit inclusion, add:

```sql
SOURCE sql/451_company_feed_foundation.sql;
```

Do not edit older migration contents beyond manifest inclusion.

- [ ] **Step 5: Run the targeted test again**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: test progresses past missing-contract assumptions or still fails on missing service logic, but no longer fails due to absent status/table definitions in the plan assumptions.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/451_company_feed_foundation.sql backend/sql/000_run_all.sql backend/src/modules/engagement/__tests__/company-posts.service.test.ts
git commit -m "feat: add company feed database foundation"
```

### Task 2: Define Company Feed Domain Types and Validation

**Files:**
- Create: `backend/src/modules/engagement/company-posts.types.ts`
- Create: `backend/src/modules/engagement/company-posts.validation.ts`
- Modify: `backend/src/modules/engagement/engagement.types.ts`
- Modify: `backend/src/modules/engagement/engagement.validation.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

**Interfaces:**
- Consumes: existing engagement type/validation conventions
- Produces:
  - `CompanyPostStatus`
  - `CompanyPostModerationState`
  - `CreateCompanyPostSchema`
  - `ModerateCompanyPostSchema`
  - `GrantCompanyPostCreatorSchema`

- [ ] **Step 1: Write the failing validation tests**

Add tests for:

```ts
expect(CreateCompanyPostSchema.safeParse({
  content_text: "Townhall at 4 PM",
  media: [{ file_id: "file-1", media_type: "image", sort_order: 1 }],
}).success).toBe(true);

expect(CreateCompanyPostSchema.safeParse({
  content_text: "",
  media: [],
}).success).toBe(false);

expect(GrantCompanyPostCreatorSchema.safeParse({
  employee_id: "not-a-uuid",
}).success).toBe(false);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: FAIL because the new types/schemas are not defined.

- [ ] **Step 3: Implement domain types**

Create `company-posts.types.ts` with:

```ts
export type CompanyPostStatus =
  | "draft"
  | "pending_approval"
  | "borderline_flagged"
  | "approved"
  | "rejected"
  | "auto_rejected"
  | "deleted";

export type CompanyPostModerationState =
  | "clean"
  | "borderline"
  | "violation"
  | "manual_override_approved"
  | "manual_override_rejected";
```

Also define input/output DTOs for feed items, creator access rows, and moderation actions.

- [ ] **Step 4: Implement validation schemas**

Create schemas such as:

```ts
export const CreateCompanyPostSchema = z.object({
  content_text: z.string().trim().max(5000).optional(),
  media: z.array(z.object({
    file_id: z.string().min(1),
    media_type: z.literal("image"),
    sort_order: z.number().int().min(1).max(4),
  })).max(4).default([]),
}).refine((data) => Boolean(data.content_text) || data.media.length > 0, {
  message: "Post must contain text or at least one image",
});
```

- [ ] **Step 5: Run the targeted test again**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: PASS for schema-focused assertions, or fail later on unimplemented service logic.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/engagement/company-posts.types.ts backend/src/modules/engagement/company-posts.validation.ts backend/src/modules/engagement/engagement.types.ts backend/src/modules/engagement/engagement.validation.ts backend/src/modules/engagement/__tests__/company-posts.service.test.ts
git commit -m "feat: define company feed types and validation"
```

### Task 3: Implement Creator Access and Permission Checks

**Files:**
- Create: `backend/src/modules/engagement/company-posts.service.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

**Interfaces:**
- Consumes: `db`, authenticated user id, existing role normalization
- Produces:
  - `assertCanCreateCompanyPost(userId: string): Promise<void>`
  - `assertCanModerateCompanyPosts(userId: string): Promise<void>`
  - `grantCompanyPostCreator(...)`
  - `revokeCompanyPostCreator(...)`
  - `listCompanyPostCreators()`

- [ ] **Step 1: Write failing permission tests**

Add tests such as:

```ts
await expect(assertCanCreateCompanyPost("user-1")).rejects.toThrow("creator access");
await expect(assertCanModerateCompanyPosts("user-2")).rejects.toThrow("Access denied");
await expect(grantCompanyPostCreator({
  actorUserId: "super-admin-id",
  employeeId: "emp-id",
})).resolves.toBeDefined();
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: FAIL because permission helpers do not exist.

- [ ] **Step 3: Implement creator access queries**

Add service helpers:

```ts
async function hasActiveCreatorAccess(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1
       FROM company_post_creator_access
      WHERE user_id = ? AND active_status = 1
      LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}
```

Also add role-based moderation check using normalized roles for `hr_head`, `admin`, `super_admin`.

- [ ] **Step 4: Implement grant/revoke with audit logging**

Use `logSensitiveAction` or `writeAuditActionLog` pattern with payloads like:

```ts
await logSensitiveAction({
  actor_user_id: actorUserId,
  action_type: "COMPANY_FEED_CREATOR_GRANTED",
  module_key: "engagement",
  entity_type: "company_post_creator_access",
  entity_id: employeeId,
  change_summary: { employee_id: employeeId, user_id: targetUserId },
});
```

- [ ] **Step 5: Run the targeted test again**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: PASS for permission and access-control cases.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/engagement/company-posts.service.ts backend/src/modules/engagement/__tests__/company-posts.service.test.ts
git commit -m "feat: add company feed creator access controls"
```

### Task 4: Implement Moderation and Post Lifecycle Service Logic

**Files:**
- Modify: `backend/src/modules/engagement/company-posts.service.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`

**Interfaces:**
- Consumes: creator access helpers, validation outputs, audit logging
- Produces:
  - `createCompanyPost(...)`
  - `listApprovedCompanyFeed(...)`
  - `listMyCompanyPosts(...)`
  - `listCompanyPostApprovals(...)`
  - `approveCompanyPost(...)`
  - `rejectCompanyPost(...)`
  - `deleteCompanyPost(...)`

- [ ] **Step 1: Write failing lifecycle tests**

Add tests for:

```ts
expect(result.status).toBe("auto_rejected");
expect(result.status).toBe("pending_approval");
expect(result.status).toBe("borderline_flagged");
expect(feed.every((post) => post.status === "approved")).toBe(true);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: FAIL because lifecycle methods are missing or incomplete.

- [ ] **Step 3: Implement moderation evaluator stub and status mapping**

Keep v1 moderation pluggable. Add a private helper:

```ts
function evaluateCompanyPostModeration(input: {
  contentText: string;
  mediaCount: number;
}): { moderation_state: CompanyPostModerationState; status: CompanyPostStatus; reason: string | null } {
  const text = input.contentText.toLowerCase();
  if (text.includes("nude") || text.includes("porn") || text.includes("viagra")) {
    return { moderation_state: "violation", status: "auto_rejected", reason: "Policy-violating content detected" };
  }
  if (text.includes("investment scheme") || text.includes("click here now")) {
    return { moderation_state: "borderline", status: "borderline_flagged", reason: "Borderline/spam-like content requires review" };
  }
  return { moderation_state: "clean", status: "pending_approval", reason: null };
}
```

This is a placeholder moderation engine for v1 implementation, not a final AI classifier.

- [ ] **Step 4: Implement visibility-safe feed queries**

Ensure:

```ts
WHERE p.status = 'approved' AND p.active_status = 1
```

for public feed queries, and separate author/moderator queries for non-approved items.

- [ ] **Step 5: Implement moderation actions and audit writes**

On approve/reject/delete:

```ts
await logSensitiveAction({
  actor_user_id: actorUserId,
  action_type: "COMPANY_FEED_POST_APPROVED",
  module_key: "engagement",
  entity_type: "company_post",
  entity_id: postId,
  change_summary: { status: "approved" },
});
```

- [ ] **Step 6: Run the targeted test again**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts`

Expected: PASS for lifecycle and visibility behaviors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/engagement/company-posts.service.ts backend/src/modules/engagement/__tests__/company-posts.service.test.ts
git commit -m "feat: implement company feed lifecycle and moderation"
```

### Task 5: Add Company Feed Controller and Routes

**Files:**
- Create: `backend/src/modules/engagement/company-posts.controller.ts`
- Modify: `backend/src/modules/engagement/engagement.routes.ts`
- Test: `backend/src/modules/engagement/__tests__/company-posts.routes.test.ts`

**Interfaces:**
- Consumes: service methods and validation schemas
- Produces:
  - `GET /api/engagement/company-posts/feed`
  - `POST /api/engagement/company-posts`
  - `GET /api/engagement/company-posts/mine`
  - `GET /api/engagement/company-posts/approvals`
  - `POST /api/engagement/company-posts/:id/approve`
  - `POST /api/engagement/company-posts/:id/reject`
  - `DELETE /api/engagement/company-posts/:id`
  - `GET /api/engagement/company-post-creators`
  - `POST /api/engagement/company-post-creators/:employeeId/grant`
  - `POST /api/engagement/company-post-creators/:employeeId/revoke`

- [ ] **Step 1: Write failing route tests**

Add route tests such as:

```ts
await request(app).get("/api/engagement/company-posts/feed").expect(200);
await request(app).post("/api/engagement/company-posts").send({}).expect(400);
await request(app).post("/api/engagement/company-posts/post-1/approve").expect(403);
```

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.routes.test.ts`

Expected: FAIL because controller/routes do not exist.

- [ ] **Step 3: Implement controller methods**

Use the existing controller style:

```ts
export const companyPostsController = {
  async listFeed(req, res) {
    return res.json({ success: true, data: await listApprovedCompanyFeed(...) });
  },
};
```

- [ ] **Step 4: Mount routes in `engagement.routes.ts`**

Add route entries without disrupting existing engagement endpoints.

- [ ] **Step 5: Run the route test again**

Run: `npx vitest run src/modules/engagement/__tests__/company-posts.routes.test.ts`

Expected: PASS for authorization and route wiring.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/engagement/company-posts.controller.ts backend/src/modules/engagement/engagement.routes.ts backend/src/modules/engagement/__tests__/company-posts.routes.test.ts
git commit -m "feat: expose company feed engagement routes"
```

### Task 6: Build Shared Frontend Data Hook

**Files:**
- Create: `src/hooks/useCompanyFeed.ts`
- Test: manual verification through page integration

**Interfaces:**
- Consumes: `hrmsApi`
- Produces:
  - `useCompanyFeed`
  - `useMyCompanyPosts`
  - `useApprovalQueue`
  - mutation hooks for create/approve/reject/delete/grant/revoke

- [ ] **Step 1: Write the hook signatures**

Create a hook file exporting:

```ts
export function useCompanyFeed(params: { page?: number; limit?: number }) { ... }
export function useMyCompanyPosts(params?: { status?: string }) { ... }
export function useCreateCompanyPost() { ... }
export function useApprovalQueue(params?: { status?: string }) { ... }
```

- [ ] **Step 2: Run frontend typecheck to verify it fails before implementation**

Run: `npm run typecheck`

Expected: FAIL if the pages/hooks import missing functions.

- [ ] **Step 3: Implement the minimal query and mutation layer**

Use TanStack Query patterns already present in the repo:

```ts
return useQuery({
  queryKey: ["company-feed", params],
  queryFn: async () => {
    const res = await hrmsApi.get("/api/engagement/company-posts/feed");
    return res.data;
  },
});
```

- [ ] **Step 4: Run frontend typecheck again**

Run: `npm run typecheck`

Expected: Progresses past missing hook errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCompanyFeed.ts
git commit -m "feat: add company feed frontend data hooks"
```

### Task 7: Build the Employee Feed Page

**Files:**
- Create: `src/pages/NativeCompanyFeed.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Test: manual UI verification

**Interfaces:**
- Consumes: `useCompanyFeed`, `useMyCompanyPosts`
- Produces:
  - route `/engagement/company-feed`
  - nav entry visible to authenticated users

- [ ] **Step 1: Write the page skeleton**

Create the page with sections:

```tsx
<DashboardLayout>
  <main className="space-y-8 p-6 lg:p-8">
    <section>{/* branded hero */}</section>
    <section>{/* approved feed */}</section>
    <aside>{/* creator/moderation rail on desktop */}</aside>
  </main>
</DashboardLayout>
```

- [ ] **Step 2: Add route and nav wiring**

Add:

```tsx
<Route path="/engagement/company-feed" element={<ProtectedRoute><NativeCompanyFeed /></ProtectedRoute>} />
```

and a nav child under engagement.

- [ ] **Step 3: Implement MCN-branded feed visuals**

Use:

- `#073f78 -> #1B6AB5` hero gradient
- `#e8f2fc` soft accents
- `Space Grotesk` titles
- white post cards with subtle shadow

Include skeleton states and an empty state.

- [ ] **Step 4: Run frontend typecheck**

Run: `npm run typecheck`

Expected: PASS for this page integration.

- [ ] **Step 5: Manually verify page behavior**

Run app and verify:

```bash
npm run dev
```

Expected:

- page loads
- feed cards render
- non-creators see approved-feed-only experience

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeCompanyFeed.tsx src/config/routes/platform.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add company feed page and navigation"
```

### Task 8: Build the Creator Studio Page

**Files:**
- Create: `src/pages/NativeCompanyPostCreate.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Test: manual UI verification

**Interfaces:**
- Consumes: `useCreateCompanyPost`
- Produces:
  - route `/engagement/company-feed/create`

- [ ] **Step 1: Write the creator page skeleton**

Add form regions for:

- text area
- multi-image preview grid
- policy note
- submit CTA

- [ ] **Step 2: Implement guarded visibility**

Use a creator-access-aware UX:

```tsx
if (!canCreate) {
  return <AccessDeniedCard message="Company feed creator access is required." />;
}
```

Back this up with backend enforcement; the page check is UX only.

- [ ] **Step 3: Implement premium creator UI**

Use:

- large brand panel
- drag/drop or file picker tray
- upload tile previews
- motion on submit/result states

- [ ] **Step 4: Wire route and optional nav child**

Add:

```tsx
<Route path="/engagement/company-feed/create" element={<ProtectedRoute><NativeCompanyPostCreate /></ProtectedRoute>} />
```

- [ ] **Step 5: Run frontend typecheck and manual verification**

Run:

```bash
npm run typecheck
```

Expected: PASS

Manual expected behavior:

- creator can draft and submit
- non-creator gets blocked

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeCompanyPostCreate.tsx src/config/routes/platform.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add company feed creator studio"
```

### Task 9: Build the Approval Queue and Management Pages

**Files:**
- Create: `src/pages/NativeCompanyPostApproval.tsx`
- Create: `src/pages/NativeCompanyPostManage.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Test: manual UI verification

**Interfaces:**
- Consumes: `useApprovalQueue`, `useApproveCompanyPost`, `useRejectCompanyPost`, `useDeleteCompanyPost`
- Produces:
  - route `/engagement/company-feed/approvals`
  - route `/engagement/company-feed/manage`

- [ ] **Step 1: Write failing page imports and route shells**

Create basic components and route placeholders first so type errors are localized.

- [ ] **Step 2: Implement approval queue UI**

Build:

- status chips
- creator/date filters
- card or drawer-based review pane
- approve/reject actions

- [ ] **Step 3: Implement management page UI**

Build:

- status filter tabs
- searchable list
- delete action with confirmation
- audit metadata visibility

- [ ] **Step 4: Add role-guarded routes**

Use:

```tsx
<ProtectedRoute roles={['hr_head','admin','super_admin']}>
```

for both pages.

- [ ] **Step 5: Run frontend typecheck and manual verification**

Run:

```bash
npm run typecheck
```

Expected: PASS

Manual expected behavior:

- approvers can open queue/manage pages
- unauthorized users cannot

- [ ] **Step 6: Commit**

```bash
git add src/pages/NativeCompanyPostApproval.tsx src/pages/NativeCompanyPostManage.tsx src/config/routes/platform.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add company feed approval and management pages"
```

### Task 10: Build the Super Admin Creator Access Page

**Files:**
- Create: `src/pages/NativeCompanyFeedCreatorAccess.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Test: manual UI verification

**Interfaces:**
- Consumes: `useCompanyPostCreators`, `useGrantCompanyPostCreator`, `useRevokeCompanyPostCreator`
- Produces:
  - route `/super-admin/company-feed-creators`

- [ ] **Step 1: Create the page shell**

Use a management layout with:

- active creators list
- employee search/add flow
- revoke action

- [ ] **Step 2: Wire the route**

Add:

```tsx
<Route path="/super-admin/company-feed-creators" element={<ProtectedRoute roles={['super_admin']}><NativeCompanyFeedCreatorAccess /></ProtectedRoute>} />
```

- [ ] **Step 3: Add the management UX**

Include:

- grant button
- revoke button
- audit-friendly metadata (granted by, granted at)

- [ ] **Step 4: Run frontend typecheck and manual verification**

Run:

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/NativeCompanyFeedCreatorAccess.tsx src/config/routes/platform.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add company feed creator access admin page"
```

### Task 11: Add Compliance Hardening and Audit Coverage

**Files:**
- Modify: `backend/src/modules/engagement/company-posts.service.ts`
- Modify: `backend/src/modules/engagement/company-posts.controller.ts`
- Modify: `backend/src/modules/engagement/__tests__/company-posts.service.test.ts`
- Modify: `backend/src/modules/engagement/__tests__/company-posts.routes.test.ts`

**Interfaces:**
- Consumes: audit log utility and route/service code
- Produces:
  - complete create/approve/reject/delete/grant/revoke audit paths
  - retention-safe deletion behavior

- [ ] **Step 1: Write failing compliance tests**

Add tests that assert:

```ts
expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
  action_type: "COMPANY_FEED_POST_DELETED",
}));
expect(deletedPost.status).toBe("deleted");
expect(deletedPost.deleted_at).toBeTruthy();
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:

```bash
npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts src/modules/engagement/__tests__/company-posts.routes.test.ts
```

Expected: FAIL until audit and retention behavior are complete.

- [ ] **Step 3: Implement soft-delete and audit-only deletion**

Do not hard-delete post rows in v1. Use:

```ts
UPDATE company_posts
   SET status = 'deleted',
       deleted_at = NOW(),
       deleted_by = ?
 WHERE id = ?
```

- [ ] **Step 4: Complete audit events for every sensitive transition**

Ensure audit writes on:

- creator grant
- creator revoke
- post create
- auto reject
- approve
- reject
- delete

- [ ] **Step 5: Run the targeted tests again**

Run:

```bash
npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts src/modules/engagement/__tests__/company-posts.routes.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/engagement/company-posts.service.ts backend/src/modules/engagement/company-posts.controller.ts backend/src/modules/engagement/__tests__/company-posts.service.test.ts backend/src/modules/engagement/__tests__/company-posts.routes.test.ts
git commit -m "feat: harden company feed compliance and audit flow"
```

### Task 12: Final Verification

**Files:**
- Modify: any files needed from prior tasks
- Test: backend and frontend validation commands

**Interfaces:**
- Consumes: all completed work
- Produces: verified working company feed feature

- [ ] **Step 1: Run backend targeted tests**

Run:

```bash
cd backend
npx vitest run src/modules/engagement/__tests__/company-posts.service.test.ts src/modules/engagement/__tests__/company-posts.routes.test.ts
```

Expected: PASS

- [ ] **Step 2: Run backend typecheck**

Run:

```bash
cd backend
npx tsc --noEmit --pretty false --incremental false
```

Expected: PASS

- [ ] **Step 3: Run frontend typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build
```

Expected: PASS

- [ ] **Step 5: Manual verification checklist**

Verify:

- employee sees only approved posts
- non-creator cannot access create flow meaningfully
- creator can submit text-only and multi-image posts
- violating post auto-rejects
- borderline post appears in moderation queue
- approver can approve/reject/delete
- Super Admin can grant/revoke creators
- UI uses MCN brand colors and looks polished on mobile and desktop

- [ ] **Step 6: Commit**

```bash
git add backend src docs
git commit -m "feat: complete company feed feature"
```

## Self-Review

### Spec coverage

Covered requirements:

- four new pages and routes
- backend service and route mount under engagement
- Super Admin creator-right assignment
- strict pre-publication moderation
- auto-reject for violations
- multi-image support
- HR Head/Admin/Super Admin approval and deletion
- MCN-branded premium UI
- compliance/audit hardening

No gaps identified for v1 scope.

### Placeholder scan

The only intentionally open area is the moderation classifier sophistication. The plan defines a v1 deterministic moderation layer so implementation can proceed without blocking on third-party AI moderation. No `TBD` placeholders remain.

### Type consistency

Planned signatures and route paths are consistent across backend service, controller, hook, and page tasks.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-18-company-feed.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
