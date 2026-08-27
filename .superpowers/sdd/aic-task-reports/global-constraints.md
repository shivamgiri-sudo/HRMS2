## Global Constraints

These bind every task. A reviewer must check each one.

1. **Never change payroll arithmetic.** No task may alter how any salary, LWP, or payable-day
   figure is computed. Fixing a *guard* that protects payroll data is in scope; changing a
   *calculation* is not.
2. **Do not weaken RBAC.** Every role widening in this plan is paired with row-level scope
   enforcement in the same task. Widening without scoping is a defect, not a fix.
3. **Page gate and API roles must agree.** After this plan, for every tab, the set of roles that can
   see the tab must equal the set of roles the tab's API accepts. A role that can open a surface it
   cannot load is the defect class this plan exists to remove.
4. **No silent failures.** Every `catch` must distinguish 403 from an empty result. A forbidden
   response must never render as an empty-success state. (Existing repo rule: silent failure is the
   dominant defect class here.)
5. **Frontend calls go through `hrmsApi` with an explicit `/api` prefix.** `hrmsApi` does not add
   one; a path without it returns the SPA's index.html at HTTP 200 and the panel renders blank.
6. **Design system (frozen, MAS PeopleOS):** Inter; `rounded-2xl` cards, `rounded-xl` inputs;
   card shadow `shadow-sm hover:shadow-md`; tone colours blue=info, green=success, amber=warning,
   red=critical; Lucide SVG icons only, never emoji; `transition-all duration-200` on hover;
   visible `focus-visible:ring-2` on every interactive element; no raw hex in `className`.
7. **Responsive without exceptions.** Every grid needs breakpoints (`grid-cols-1 sm:grid-cols-2
   lg:grid-cols-4`); no fixed pixel widths; tables wrapped in `overflow-x-auto`; tap targets >= 44px;
   no horizontal scroll on the page body at 375px.
8. **Every panel needs four states:** loading (skeleton/spinner, never blank), empty, error,
   and forbidden — each visually distinct from the others.
9. **Typecheck gate:** frontend is `npm run typecheck` (the root tsconfig misleadingly returns 0).
   Backend: NEVER run a full `tsc` — it surfaces unrelated orphan errors. Use a targeted
   `tsconfig.*-check.json` following the existing pattern, or run the vitest file for the module.
10. **Commit by explicit path only.** This tree is shared and has ~147 unrelated dirty files.
    Never `git add -A`, never rebase, never reset. Stage only the paths your task touched.
