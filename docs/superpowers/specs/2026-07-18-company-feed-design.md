# Company Feed with HR Head Approval Design

## Goal

Add a premium internal company feed to HRMS that:

- shows approved company posts to employees;
- allows only explicitly authorized creators to submit posts;
- enforces pre-publication moderation with automatic rejection for violations;
- routes all non-rejected posts through approval by HR Head, Admin, or Super Admin;
- provides management and creator access without creating a public-social free-for-all.

## Product Scope

This feature adds:

- 4 frontend pages:
  - `NativeCompanyFeed.tsx`
  - `NativeCompanyPostCreate.tsx`
  - `NativeCompanyPostApproval.tsx`
  - `NativeCompanyPostManage.tsx`
- backend service:
  - `company-posts.service.ts`
- engagement backend routes mounted in `engagement.routes.ts`
- nav entry in `navConfig.tsx`
- a Super Admin-controlled access surface for assigning company feed creator rights

Out of scope for v1:

- likes, comments, shares, saves, bookmarks
- live publishing without approval
- video uploads
- scheduled publishing
- branch-wise audience targeting
- creator self-publishing

## Users and Permissions

### Reader

All authenticated employees can:

- view approved company posts in the main feed

They cannot:

- create posts
- view pending/rejected posts from other users
- approve, reject, or delete posts

### Authorized Creator

Only users explicitly granted creator access by Super Admin can:

- open the create page
- submit `text-only` or `text + multi-image` posts
- view their own posts across statuses
- see rejection reasons for their own posts

They cannot:

- approve posts
- delete posts after submission unless later business rules explicitly add that

### Moderator / Approver

The following can approve, reject, and delete posts:

- `hr_head`
- `admin`
- `super_admin`

They can:

- see all post statuses
- open moderation queue
- review detector findings
- approve, reject, delete
- inspect creator details

### Creator Access Administrator

Only `super_admin` can:

- grant creator rights to a user/employee
- revoke creator rights
- see creator access registry

This permission must be DB-backed, not hardcoded.

## Visibility Rules

### Public Feed

Visible to all authenticated users:

- only `approved` posts

### Creator View

Visible to the post author:

- `approved`
- `pending_approval`
- `borderline_flagged`
- `rejected`
- `auto_rejected`

### Moderator View

Visible to `hr_head`, `admin`, `super_admin`:

- all statuses, including deleted/audit-visible records if management view includes them

## Moderation Rules

The company feed is pre-publication moderated.

### Mandatory Rule

Any violation post should be auto rejected.

### Image and Content Rules

Supported in v1:

- text-only posts
- text with multiple images

Moderation must evaluate:

- post text
- each uploaded image
- combined post context if possible

### Outcomes

#### Auto Reject

Clear violations must be automatically rejected before they can enter the live feed.

Examples:

- explicit/nude imagery
- obvious spam or scam-style content
- prohibited abusive/unsafe content
- clearly disallowed graphic or sexual content

Result:

- status = `auto_rejected`
- creator sees rejection reason
- post never appears in live feed

#### Borderline Review

Borderline content should go to manual moderation.

Examples:

- uncertain image classification
- suspicious marketing-like content
- ambiguous policy-sensitive language

Result:

- status = `borderline_flagged`
- shown in approval queue only

#### Clean Submission

Even clean posts must still follow the chosen moderation model.

Result:

- status = `pending_approval`

### Approval Model

Chosen model:

- pre-publication moderation pipeline

Flow:

1. creator submits post
2. moderation checks run
3. if violation: auto reject
4. else: post enters approval queue
5. `hr_head`, `admin`, or `super_admin` approves or rejects
6. only then is the post visible to all employees

## Status Model

Recommended post statuses:

- `draft`
- `pending_approval`
- `borderline_flagged`
- `approved`
- `rejected`
- `auto_rejected`
- `deleted`

Recommended moderation states:

- `clean`
- `borderline`
- `violation`
- `manual_override_approved`
- `manual_override_rejected`

## Data Model

### `company_posts`

Purpose:

- one row per company feed post

Columns:

- `id`
- `author_user_id`
- `author_employee_id`
- `content_text`
- `status`
- `moderation_state`
- `moderation_score`
- `auto_reject_reason`
- `review_notes`
- `submitted_at`
- `approved_at`
- `approved_by`
- `rejected_at`
- `rejected_by`
- `rejection_reason`
- `deleted_at`
- `deleted_by`
- `created_at`
- `updated_at`
- `active_status`

### `company_post_media`

Purpose:

- store ordered post attachments

Columns:

- `id`
- `post_id`
- `file_id` or storage reference field used by existing file system
- `media_type`
- `sort_order`
- `moderation_state`
- `moderation_reason`
- `created_at`
- `active_status`

### `company_post_creator_access`

Purpose:

- explicit posting access managed by Super Admin

Columns:

- `id`
- `employee_id`
- `user_id`
- `active_status`
- `granted_by`
- `granted_at`
- `revoked_by`
- `revoked_at`
- `created_at`
- `updated_at`

### `company_post_audit_log`

Purpose:

- immutable moderation and management audit

Columns:

- `id`
- `post_id`
- `action_type`
- `actor_user_id`
- `notes_json`
- `created_at`

## Frontend Pages

### 1. `NativeCompanyFeed.tsx`

Purpose:

- employee-facing feed page

Behavior:

- shows approved posts in a premium internal social timeline
- shows creator-owned post status block if the viewer is also a creator
- may surface moderation badges and quick links for approvers

Desktop layout:

- main feed column
- right rail with creator shortcuts / moderation stats / queue summary

Mobile layout:

- single-column feed

### 2. `NativeCompanyPostCreate.tsx`

Purpose:

- controlled creator studio

Behavior:

- create text-only or multi-image post
- image preview grid
- pre-submit moderation note
- submit button disabled while upload/moderation is running
- clear result state after submission:
  - pending approval
  - queued for review
  - auto rejected

### 3. `NativeCompanyPostApproval.tsx`

Purpose:

- moderation and approval queue

Access:

- `hr_head`, `admin`, `super_admin`

Behavior:

- list pending/borderline posts
- filter by creator, date, moderation state
- open detailed review drawer/modal
- actions:
  - approve
  - reject
  - inspect reasons/evidence

### 4. `NativeCompanyPostManage.tsx`

Purpose:

- management console for posts

Access:

- `hr_head`, `admin`, `super_admin`

Behavior:

- browse approved/rejected/deleted/history items
- filter by status, date, creator
- delete post
- inspect audit trail

### 5. Super Admin Creator Access Surface

Purpose:

- grant and revoke creator access

This may be:

- a dedicated page under admin/super-admin routes; or
- a panel within an existing Super Admin surface if one exists and is appropriate

Behavior:

- search employees
- grant creator access
- revoke creator access
- view active creator list

## UI Direction

The feed should feel familiar like a social product, but it must not visually copy Facebook.

### Layout Language

Use:

- feed-style stacked cards
- expressive hero/top strip
- polished composer/create surface
- high-quality iconography
- smooth, intentional animation

Do not use:

- generic admin-table-only look
- copied Facebook colors

### Brand Source of Truth

Use existing MCN/MAS design tokens already present in the codebase.

Primary references found in repo:

- `#1B6AB5` brand blue
- `#155e9f` hover blue
- `#0f4f89` pressed blue
- `#e8f2fc` soft brand surface
- `#073f78` deep brand navy/sidebar tone

### Typography

- page titles and social headers: `Space Grotesk`
- body/feed text: `Inter`

### Visual Quality

- strong Lucide icon usage
- polished hover lifts
- shimmer/skeleton states
- feed entry motion
- image hover zoom or preview polish
- reduced motion respected

### Semantic Colors

- approved/success: green
- pending/review: amber
- rejected/unsafe: red

## Backend API Design

All routes live under engagement.

### Feed

- `GET /api/engagement/company-posts/feed`
  - returns approved posts for normal viewers
  - returns status-enriched view if requester is creator/moderator where needed

### Creator

- `POST /api/engagement/company-posts`
  - create post
- `GET /api/engagement/company-posts/mine`
  - creator’s own posts by status

### Moderation

- `GET /api/engagement/company-posts/approvals`
  - moderation queue
- `POST /api/engagement/company-posts/:id/approve`
- `POST /api/engagement/company-posts/:id/reject`
- `DELETE /api/engagement/company-posts/:id`

### Creator Access

- `GET /api/engagement/company-post-creators`
- `POST /api/engagement/company-post-creators/:employeeId/grant`
- `POST /api/engagement/company-post-creators/:employeeId/revoke`

## Security Requirements

- all create/approve/delete flows require backend authorization
- creator access must be checked server-side
- feed visibility must be filtered server-side
- moderation queue must not leak to unauthorized users
- deleted and rejected posts must not become visible through loose feed queries
- file/media attachments must use existing secure file handling patterns

## Audit Requirements

Audit all sensitive actions:

- creator access granted
- creator access revoked
- post created
- post auto rejected
- post moved to borderline queue
- post approved
- post rejected
- post deleted

Each audit event should capture:

- actor
- target post
- timestamp
- moderation summary
- reason / notes

## Error and Empty States

### Creator

- no creator access
- upload failed
- moderation rejected
- approval pending

### Feed

- no approved posts yet

### Approval Queue

- no pending approvals

### Creator Access Admin

- no active creators assigned

## Testing Requirements

Backend tests should cover:

- unauthorized create blocked
- authorized creator create allowed
- normal employee cannot create
- moderation auto reject path
- pending approval path
- approval by allowed roles only
- deletion by allowed roles only
- feed visibility rules
- creator access grant/revoke behavior

Frontend tests or verification should cover:

- feed page loads for employee
- create page hidden/blocked for non-creators
- approval page hidden/blocked for non-approvers
- management page hidden/blocked for non-approvers
- branded layout remains responsive on mobile and desktop

## Route and Nav Integration

Add nav entry under engagement.

Recommended routes:

- `/engagement/company-feed`
- `/engagement/company-feed/create`
- `/engagement/company-feed/approvals`
- `/engagement/company-feed/manage`
- `/super-admin/company-feed-creators` or equivalent admin route

Nav visibility:

- feed: all authenticated users
- create: creators only
- approvals/manage: `hr_head`, `admin`, `super_admin`
- creator access admin: `super_admin` only

## Architecture Summary

This feature should follow the existing engagement module pattern:

- backend routes in engagement module
- service-driven business logic
- additive DB migrations only
- frontend pages mounted through existing route config
- existing brand tokens and shadcn/Tailwind components reused

The core principle is:

- controlled publishing
- strong moderation
- premium branded UI
- explicit creator access
- auditable approval lifecycle
