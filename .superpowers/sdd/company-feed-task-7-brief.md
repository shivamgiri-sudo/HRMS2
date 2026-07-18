# Task 7 Brief: Employee Company Feed Page

Read this first. It is the requirements source for this task.

Plan file:
- `docs/superpowers/plans/2026-07-18-company-feed.md`

Task:
- Build the main employee-facing company feed page and wire it into app routes and navigation using the completed company-feed hooks.

Files in scope:
- Create: `src/pages/NativeCompanyFeed.tsx`
- Modify: `src/config/routes/platform.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`
- Report: `.superpowers/sdd/company-feed-task-7-report.md`

Must produce:
- Route: `/engagement/company-feed`
- Nav entry under engagement
- Page that consumes:
  - `useCompanyFeed`
  - `useMyCompanyPosts`
- Page should feel premium, social-feed-like, and aligned to MAS/MCN brand colors rather than Facebook colors

Required visual direction:
- Subject: internal employee announcement feed for a BPO/HRMS audience
- Single job: help employees quickly scan approved company updates while exposing lightweight shortcuts into creator/moderation flows
- Signature design move: a strong MAS-blue “broadcast deck” hero with editorial typography and a stacked newsroom-style content lane beneath it
- Use MAS tokens from:
  - `src/index.css`
  - `src/styles/hrms-design-system.css`
- Avoid generic purple/cream AI-default aesthetics and avoid copying Facebook colors

Required behavior:
- Main feed shows approved posts from `useCompanyFeed`
- Secondary area can show “My submissions” using `useMyCompanyPosts`
- Include a shortcut to creator studio and moderation queue if the current user has likely access; UX gating may be lightweight, but do not claim permissions the backend does not enforce
- Include meaningful loading, empty, and error states
- Responsive on desktop and mobile

Helpful implementation notes:
- Existing hook file: `src/hooks/useCompanyFeed.ts`
- Existing engagement visual reference: `src/pages/NativeEngagement.tsx`
- Existing route file: `src/config/routes/platform.routes.tsx`
- Existing nav file: `src/components/layout/navConfig.tsx`
- Existing role access helper: `src/hooks/useUserRole.ts`

Constraints:
- Do not add the creator page or approval page here
- Do not modify unrelated existing pages
- Preserve existing route structure and nav organization

Verification required:
- run `npm run typecheck`

Report file:
- `.superpowers/sdd/company-feed-task-7-report.md`

Return format:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- files changed
- tests run and results
- any concerns
