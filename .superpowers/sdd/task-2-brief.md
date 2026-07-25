# Task 2 Brief: Remove hardcoded cross-dashboard frontend data calls

## Goal

Eliminate shared dashboard components and layouts that silently fetch HR dashboard data for non-HR dashboards.

## Scope

Focus on the shared frontend dashboard files identified in the plan and audit:

- `src/components/dashboard/layouts/OpsLayout.tsx`
- `src/components/dashboard/layouts/ManagerLayout.tsx`
- `src/components/dashboard/layouts/HrAdminLayout.tsx`
- `src/components/dashboard/layouts/FinanceLayout.tsx`
- `src/components/dashboard/layouts/CeoLayout.tsx`
- `src/components/dashboard/widgets/AiBriefingPanel.tsx`
- `src/components/dashboard/widgets/PendingActionsWidget.tsx`

You may also edit directly connected routed dashboard pages or shared props/interfaces if needed to make the shared components dashboard-code-aware.

## Required outcome

- Shared dashboard components must not silently default to `/api/dashboards/hr/summary` or equivalent HR-only data when rendered for other dashboards.
- Each shared component must either:
  - receive an explicit dashboard code / endpoint prop from the owning page, or
  - be restricted to HR-only usage when that is truly the intended behavior.
- `PendingActionsWidget` must not keep the broken lower-case `/api/dashboards/hr/summary` path if it remains available for future use.

## Verification expectations

- Search for every `/api/dashboards/hr/summary` occurrence and resolve whether it is valid HR-only code or a shared misuse.
- Run the relevant frontend build/typecheck command(s).
- Summarize exactly which shared components were corrected and how.

## Constraints

- Keep changes scoped to shared dashboard data wiring.
- Do not redesign dashboard UI.
- Do not introduce fake fallback data.
- Preserve existing dashboard access gating behavior.
