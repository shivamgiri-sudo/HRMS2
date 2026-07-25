# Task 1 Fix Brief

The task reviewer found two Important omissions in the routed dashboard audit matrix.

Update only:

- `docs/dashboard-audit/2026-07-25-role-dashboard-widget-matrix.md`
- append to `C:\\Users\\ADMIN\\Desktop\\HRMS2-latest\\.superpowers\\sdd\\task-1-report.md`

Required fixes:

1. In the Employee Self section, add the actual Company Feed request used by the visible side panel/login popup:
   - `GET /api/engagement/company-posts/feed`
   - note that it uses `page` / `limit`

2. In the IT Manager section, add the actual bulk upload endpoint used by the visible workflow:
   - `POST /api/it-provisioning/bulk-sync`

Constraints:

- No other scope changes.
- Keep the matrix consistent with its existing style.
- Report status back as DONE when complete.
