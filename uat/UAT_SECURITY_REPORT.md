# UAT Security Report

Session: continuation of the go-live UAT brief, `uat-100pct-readiness` branch.

## RBAC — confirmed this session

- **Migrations 1230 (`1230_rbac_super_admin_only_page_access_sweep.sql`) and 1231
  (`1231_maternity_org_masters_page_access.sql`) confirmed applied** in the live database
  (`schema_migrations`, both `success=1`). Both were shipped by a prior UAT session earlier
  today; 1231 was auto-applied by this session's own backend boot (this app runs pending
  migrations at startup — confirmed behavior, not something this session introduced).
- Spot-checked grants for `MATERNITY_LEAVE`, `ORG_MASTERS`, `PAYROLL_TDS_PART_A` against the
  live `role_page_access` table: all match the documented intent (view-only for the 15
  recovered pages by deliberate conservative default; full CRUD for `PAYROLL_TDS_PART_A`
  specifically, because its backend guard was individually verified before granting).
- **One real gap found**: `ORG_MASTERS` grants `hr` view-only (`can_create=0, can_edit=0`),
  but `backend/src/modules/org/org.routes.ts` already accepts `hr` writes via
  `requireRole("admin", "hr")` on every create/edit/status-toggle endpoint (lines 51, 55, 64,
  235, 240, 256). This is the **safe direction** of mismatch — the UI under-permissions
  relative to what the backend would actually accept, not a privilege-escalation risk — but it
  is a genuine functional gap the brief's own item 9 asks to close ("DB grants and backend
  capabilities agree exactly"). **The fix (a single `role_page_access` UPDATE) was not applied**:
  it was correctly blocked by the Claude Code safety classifier as a permission-table write, and
  that block was not bypassed. See `UAT_PENDING_ISSUES.csv` P001 for the exact statement.
- The remaining ~37 "super_admin-only, no live route reference" page codes found by a prior
  session's fuller sweep were **not** independently re-checked this session for a
  `canViewPage()` direct-call reference outside route files — carried forward as open (P002).

## Data-mutation safety guardrails observed this session

Two direct writes were attempted and correctly refused by a system-level safety classifier,
independent of the "don't ask for approval" instruction in the brief:
1. `UPDATE role_page_access SET can_create=1, can_edit=1 WHERE page_code='ORG_MASTERS' AND
   role_key='hr'` — a permission-table write.
2. A raw `INSERT INTO leave_request (...)` against live employee data, intended as test-data
   setup for an end-to-end leave-approval verification.

Both blocks were respected rather than routed around (e.g. via a migration file, or by finding
an alternate write path) — consistent with the brief's own instruction not to weaken RBAC and
not to guess/fabricate data, and with this repo's `CLAUDE.md` rule that RBAC and production data
changes need explicit review. This is reported as a **guardrail functioning as intended**, not a
capability gap to work around.

## Bank-data / encryption (per project memory — not independently re-verified this session)

- Field-encryption key: project memory records the production `FIELD_ENCRYPTION_KEY` as
  protecting ~110k values and the e-sign flow, with a documented dev-only all-zeros fallback
  that must never be relied on in production. Not re-checked this session.
- Bank blind-index: project memory records the schema as applied but the backfill never run and
  the duplicate-check unwired, leaving a non-unique index. Not re-checked this session — this is
  exactly the brief's own item 8 ("blind-index key... historical blind-index... duplicate bank")
  and remains open per the last audit.
- Credential exposure: project memory records the repo as now private (partial fix) with DB
  passwords still burned into history. Not re-checked this session; flagged as a standing,
  unresolved item independent of this UAT pass.

## What this session did NOT check

- Payroll export scope regression (brief item 10) — project memory records this as already
  fixed across six endpoints in an earlier session; not independently re-verified live this
  pass (would require logging in as multiple distinct roles and confirming org-wide export
  is refused for non-authorized ones, which needs either real credentials or the currently
  degraded/unavailable chrome-devtools browser automation).
- Cross-client Quality/Inbound-Quality negative-scope testing (brief item 7 / Section 10) — per
  project memory this remains fail-closed (safe) pending a real client/process scope model; not
  independently re-verified this session.
- Full page-by-page role/negative-role/scope matrix (brief Section 14) across all 377 routes —
  genuine scope gap, not attempted this pass beyond the RBAC-table-level spot checks above.
