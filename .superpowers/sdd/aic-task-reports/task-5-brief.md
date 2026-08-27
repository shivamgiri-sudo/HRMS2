### Task 5 — Frontend: the console shell

`src/pages/wfm/AttendanceIntegrityConsole.tsx` (new).

- Header: title "Attendance Integrity", one-line description, no per-panel page `<h1>`.
- Tab bar: Exceptions / Mismatches / Biometric Sync / Billing Rules, keyboard-navigable
  (arrow keys), `focus-visible:ring-2`, 44px tap targets, horizontally scrollable at 375px.
- Tab state lives in the URL as `?tab=<key>` via `useSearchParams`, so a tab is linkable and
  survives reload. **Changing tabs must not drop the other panels' query params** — the deep links
  in Task 6 arrive with `issueType`/`status`/`severity` attached.
- **Per-tab gating from existing page codes.** Render a tab only if `canViewPage(code)` for that
  tab's code (table in "Target design"). The route itself carries **no** single `Gate` wrapper —
  a single code cannot express the union. If zero tabs are visible, render the same
  "Access not available" panel `WorkforcePageGate` renders, including its Request Access button, so
  the denied experience is identical to every other gated page.
- Respect `isResolved` before computing visible tabs, or every tab flickers off on first render.
- If the URL names a tab the viewer cannot see, fall back to their first visible tab rather than
  rendering an empty shell.
- Lazy-load the four panels so opening the console does not fetch all four datasets at once.

Run after: `npm run typecheck`

