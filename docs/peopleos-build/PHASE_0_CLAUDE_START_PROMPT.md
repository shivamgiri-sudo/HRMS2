# Phase 0 — Claude Start Prompt

Paste the prompt below into Claude Code while working on a new branch and in Plan mode.

```text
We are building MAS Callnet PeopleOS by extending the current repository safely.

Read first:
1. CLAUDE.md
2. docs/peopleos-build/CURRENT_PROJECT_OVERVIEW_2026-05-29.md
3. docs/peopleos-build/MAS_CALLNET_PEOPLEOS_REVISED_MASTER_ROADMAP.md
4. docs/peopleos-build/LMS_INTEGRATION_BLUEPRINT.md
5. docs/peopleos-build/SOURCE_AUDIT_NOTES.md

Important correction:
The LMS is already independently built and deployed internally. Do not plan or build a new LMS backend. Treat existing HRMS LMS pages as future integration/deep-link/reporting surfaces and plan only a controlled LMS integration layer through the existing Integration Hub patterns.

Work in Plan mode only. Do not edit files, run production SQL, deploy, push code or change the independently deployed LMS.

Audit the current repository and verify:
- frontend/backend architecture and build/test commands;
- which modules use Express/MySQL and which remain direct Supabase/transitional;
- local/staging MySQL requirement for safe backend migration testing;
- schema execution order and whether mounted backend routes have required tables;
- backend authentication, role authorization and row-scope enforcement;
- payroll configuration/calculation contract and incomplete statutory functions;
- existing Assets/Documents flows that must be preserved during convergence;
- current Client Portal process isolation/data masking/export-audit requirements;
- current LMS route/components and the safest integration-only reuse approach;
- native placeholder wrapper behaviour before any proposed deletion or routing refactor.

Return a Phase 0 audit with:
1. verified architecture and system-of-record matrix;
2. protected existing workflows;
3. P0/P1/P2 defects with file-path evidence;
4. proposed implementation order for Phase 0 only;
5. exact files Claude would modify in Phase 0 only;
6. isolated local/staging MySQL validation plan;
7. route-to-role-and-scope matrix;
8. data/privacy/security negative test plan;
9. LMS integration discovery questions only, not an LMS build plan;
10. rollback plan.

Stop after the audit for approval.
```
