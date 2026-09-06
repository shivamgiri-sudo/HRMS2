# Dismissible "Today's Celebrations" posts on role dashboards

## Problem
`TodayCelebrationsWidget` (rendered at the top of all 10 role-based dashboards —
Super Admin, CEO, Manager, Employee, IT Manager, Operations, Payroll, Quality,
Recruiter, WFM) renders every birthday/anniversary post for today as a full-size
social-post card (`CelebrationPostCard`: avatar, message, reaction bar), with no
limit and no way to hide one. On a day with several celebrations, the KPI grid
and every other dashboard panel are pushed below the fold behind a wall of posts
the user has already seen.

## Fix
Add a dismiss (`×`) affordance to each post rendered by the widget, persisted
per logged-in user in `localStorage`, so a dismissed post stops appearing on
that dashboard for that user. Scope is deliberately narrow:

- **File touched: only `src/components/dashboard/TodayCelebrationsWidget.tsx`.**
  No change to `CelebrationPostCard.tsx` (528 lines, also used by the Company
  Feed's `FeedPostCard.tsx`) or any backend/API. The `×` is layered on top of
  each card from a `relative` wrapper the widget already controls — it does not
  touch the card's own markup.
- Dismissing hides a post from **this widget only**. The post stays fully
  visible, with its likes/comments, on `/engagement/company-feed` — confirmed
  with the user this is the wanted scope, not a cross-surface "hide forever."
- Persistence: `localStorage` key `dismissed-celebrations:<userId>` (the widget
  already extracts the user id from the auth token for reactions), holding an
  array of dismissed post ids. No backend "seen" table — today's celebrations
  are a fresh set of post ids every day, so an old dismissed id simply never
  matches a future post again; nothing needs expiry or cleanup logic.
- If every post on a given day is dismissed, the widget already returns `null`
  when its post list is empty (existing behavior) — the section disappears
  entirely and the KPI grid naturally moves up. No reordering change needed
  elsewhere.
- Applies automatically to all 10 dashboards, since they all render this one
  shared widget — no per-dashboard edits.

## Explicitly out of scope (YAGNI)
- No backend/DB persistence of dismissals (no cross-device sync).
- No undo for a dismissed post.
- No change to `/engagement/company-feed` or `CelebrationPostCard.tsx`.

## Verification
- `npm run build` — zero TypeScript errors.
- Manual read-through: dismissing a post removes it from the widget's render
  list on the next render tick; reloading the page keeps it dismissed (reads
  localStorage on mount); a post from a different day (different id) is never
  affected by an old dismissal.
