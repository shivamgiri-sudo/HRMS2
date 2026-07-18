# Task 1 Brief: Rename expandedCat → selectedCat

## Context
Single-file change to `src/pages/NativeReportsCenter.tsx` in the HRMS project at `c:/Users/ADMIN/Desktop/HRMS2-latest`. This is Task 1 of 4 in the Reports Center layout redesign — a pure rename before structural work begins in Tasks 2–3.

## Requirements (verbatim from plan)

**Step 1:** In `src/pages/NativeReportsCenter.tsx`, find and replace:

State declaration (around line 315):
```tsx
const [expandedCat, setExpandedCat] = useState<string | null>(null);
```
Replace with:
```tsx
const [selectedCat, setSelectedCat] = useState<string | null>(null);
```

Callback (around line 400):
```tsx
const toggleCategory = useCallback((cat: string) => {
  setExpandedCat(prev => prev === cat ? null : cat);
}, []);
```
Replace with:
```tsx
const toggleCategory = useCallback((cat: string) => {
  setSelectedCat(prev => prev === cat ? null : cat);
}, []);
```

Also find every other occurrence of `expandedCat` and `setExpandedCat` in the JSX (there are usages like `expandedCat === cat` and `isExpanded = expandedCat === cat`) and replace them with `selectedCat` / `setSelectedCat` accordingly.

**Step 2:** Verify TypeScript compiles:
```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors referencing `expandedCat`.

**Step 3:** Commit:
```bash
git add src/pages/NativeReportsCenter.tsx
git commit -m "refactor(reports): rename expandedCat to selectedCat"
```

## Global Constraints
- Only `src/pages/NativeReportsCenter.tsx` is modified — no new files, no backend changes, no route changes.
- This is a pure rename — no logic changes, no JSX restructuring in this task.

## Report
Write your full report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/reports-layout-task-1-report.md`

Return only: status (DONE/BLOCKED/NEEDS_CONTEXT), commit hash, one-line test summary, and any concerns.
