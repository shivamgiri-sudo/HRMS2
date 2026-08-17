# HRMS2 Go-Live UAT — Run Log

## Session Metadata

| Field | Value |
|---|---|
| UAT_START_SHA | `327b2deb02042050751b02493565630ab815591e` |
| Branch | main |
| Repository | shivamgiri-sudo/HRMS2 |
| Frontend build tool | Vite (React 18 + TypeScript) |
| Backend runtime | Node.js v24.18.0 (Active LTS) |
| Database | MySQL `mas_hrms` |
| Environment | Production (mcnhrms.teammas.in) — no separate staging confirmed |
| Timezone for business-date validation | Asia/Kolkata (IST, UTC+5:30) |
| Working tree status at start | Clean (scratch worktree `/tmp/uat-run`, detached at UAT_START_SHA) |
| Kickoff reason | Go-live scheduled tomorrow; full pre-launch UAT + defect closure requested |

## Scope Decision (recorded, per explicit safety boundary agreed with product owner)

The originally pasted UAT spec requests full autonomous execution including destructive
employee-lifecycle mutations and unsupervised payroll/statutory/bank code fixes with no
check-ins. Given this is deploying to production for all users tomorrow, the following
boundary applies to today's run:

- **Autonomous, no check-in required:** RBAC/access sweep, report-catalog 404 sweep, core
  page smoke tests across roles, responsive/console/network checks, code-level defect fixes
  that are clearly UI/routing/display bugs with no payroll/statutory/bank money impact.
- **Flag-and-wait for explicit approval before proceeding:** any change to payroll/statutory
  calculation logic, any bank blind-index/encryption-key operation, any real (non-synthetic)
  employee lifecycle mutation (transfer/resignation/exit/F&F/deprovision), any RBAC/maker-checker
  weakening.
- Test personas are synthetic/UAT-only wherever the flow requires creating or mutating a
  record. No production employee record is used for destructive lifecycle testing.

## Deploy status at kickoff

Deploy of commit `0b40730921c249944932c4f6a7a83a193aff74dd` triggered via `workflow_dispatch`
prior to this UAT run — see uat/UAT_DEPLOY_LOG.md for the outcome.

## Log

### Environment blocker: chrome-devtools MCP cannot attach

The `chrome-devtools` MCP server (`.mcp.json`, configured with `--isolated`) fails to
connect on every attempt: "Could not find DevToolsActivePort for chrome". Diagnosed:
- No stale lock/port file was the cause (removed one stale file, still failed).
- Chrome IS installed and CAN launch (confirmed via a manual `chrome.exe` invocation,
  which produced a full 13-process running instance) — but that instance was not launched
  with remote debugging enabled, and the MCP server's own managed launch never writes a
  fresh DevToolsActivePort file at all, meaning its internal Chrome spawn is failing
  silently in this environment (likely resource/permission-related given the machine's
  documented heavy concurrent-session CPU load today).
- This could not be resolved from within available tools/permissions (no MCP-server-restart
  capability, no way to safely edit the MCP server's own launch flags mid-session).

**Decision:** literal click-through frontend UI automation (screenshot/DOM/console
verification via chrome-devtools) is NOT available this session. Per the ABSOLUTE
FRONTEND-FIRST RULE, any flow that cannot be executed this way is NOT marked as
frontend-UAT-passed. Substituting the following instead, clearly labelled as such wherever
used:
- **DB-driven RBAC verification**: querying the live `role_page_access` table (read-only)
  against the actual route/pageCode inventory built in Phase 1 — this is the same
  authorization data the frontend Gate component reads, so it verifies the real access
  decision even without clicking through the UI.
- **API-level verification**: curl against the locally-running backend (current origin/main
  code, same DB) to confirm routes exist/respond/enforce auth, matching what "Backend/API/
  database inspection is allowed AFTER the frontend action to verify" already permits — used
  here as the primary check for flows that need it, with the gap to real UI verification
  explicitly recorded, not hidden.
- Any defect found and fixed via this route is marked **CODE-VERIFIED, UI-UNVERIFIED** in the
  defect log, not FRONTEND_VERIFIED — a distinction preserved through to the final report so
  it doesn't get silently upgraded to a false "tested in browser" claim.

