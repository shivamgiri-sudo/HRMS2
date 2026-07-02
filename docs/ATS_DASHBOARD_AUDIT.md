# ATS Dashboard Technical Audit

## Page checked

```text
/ats/dashboard
```

File:

```text
src/pages/NativeATSDashboardReplica.tsx
```

## Strengths

- Rich command-center page already exists.
- Includes tabs for dashboard, trends, rejections, recruiter productivity, sourcing, live queue, journey, and intelligence.
- Includes auto-refresh.
- Includes FTD/WTD/MTD/ALL period filters.
- Includes queue and SLA-style insights.
- Includes journey search.

## Issues

1. Uses native HTML `select`, not shared Select component.
2. Global dropdown readability fix will not fully apply here.
3. Loads a large payload and filters client-side.
4. Candidate/queue tables need server-side pagination.
5. Branch/process/recruiter filters should use active master options where applicable.
6. Export actions need backend audit.
7. Role scope must be verified for recruiter, HR, branch, process, admin, and client roles.
8. Custom classes make the design harder to maintain with the shared premium UI language.

## Required fixes

```text
Replace native select controls with shared filter controls.
Add server-side pagination for candidate and queue tables.
Add server-side search and filters.
Enforce role scope in backend APIs.
Add audited exports.
Mask sensitive candidate details by role.
Move repeated card/table styles into shared premium components.
```

## Recommended APIs

```text
GET /api/ats/dashboard/summary
GET /api/ats/dashboard/candidates
GET /api/ats/dashboard/queue
GET /api/ats/dashboard/recruiter-productivity
GET /api/ats/dashboard/sourcing
GET /api/ats/dashboard/rejections
```

Each list endpoint should support:

```text
page
limit
search
period
branchId
processId
status
ownerId
```

## Premium UI direction

Use the supplied HR SaaS dashboard style:

```text
Hero summary
KPI cards
Filter bar
Insight rail
Queue table
Funnel cards
Trend charts
Action cards
```

## Priority

P0:

```text
Readable filters
Server-side pagination
Role scope
Sensitive data masking
```

P1:

```text
Saved views
Export audit
Insight actions
Shared premium components
```
