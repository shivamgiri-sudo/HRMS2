# Task 6: Wire up — replace FloatingChatWidget, update layout, update exports

## Context
Task 6 of 7. All 5 new AI Command Bar files exist:
- `src/hooks/useAmbientInsights.ts`
- `src/components/ai/AmbientStrip.tsx`
- `src/components/ai/CommandPalette.tsx`
- `src/components/ai/AmbientInsightBar.tsx`
- `src/components/ai/AICommandBar.tsx`

This task wires everything together by modifying 4 files and deleting 1.

## Change 1: `src/App.tsx`

**Current line 6:**
```ts
import { FloatingChatWidget } from "@/components/ai/FloatingChatWidget";
```
**Replace with:**
```ts
import { AICommandBar } from "@/components/ai/AICommandBar";
```

**Current line 53:**
```tsx
          <FloatingChatWidget />
```
**Replace with:**
```tsx
          <AICommandBar />
```

## Change 2: `src/components/layout/CompactDashboardLayout.tsx`

Remove the entire `/* ⌘K shortcut */` useEffect block. It is currently lines 138-151:

```ts
  /* ⌘K shortcut */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          'input[aria-label="Search modules"]'
        );
        input?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
```

Delete this entire block. The `AICommandBar` now owns ⌘K via capture phase.

Also add `pb-9` to the main content area so the 36px ambient strip doesn't overlap content.
Find this line (currently ~line 343):
```tsx
        <main className="flex-1 px-4 py-5 sm:px-5 lg:px-6 lg:py-6">
```
Replace with:
```tsx
        <main className="flex-1 px-4 py-5 pb-9 sm:px-5 lg:px-6 lg:py-6">
```

## Change 3: `src/components/layout/TopBar.tsx`

Remove the `⌘K` hint span. Find these lines (~lines 147-151):
```tsx
          <span
            className="cmd-key-hint pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
            aria-hidden
          >
            ⌘K
          </span>
```
Delete this entire span element. The ⌘K hint now lives in the AmbientStrip.

Also update the search input className from `pr-16` to `pr-4` since the ⌘K span is gone and extra padding is no longer needed:
```tsx
className="h-9 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-16 text-sm focus:bg-white"
```
→
```tsx
className="h-9 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-4 text-sm focus:bg-white"
```

## Change 4: `src/components/ai/index.ts`

**Current content:**
```ts
export { AIInsightPanel } from "./AIInsightPanel";
export { FloatingChatWidget } from "./FloatingChatWidget";
```

**Replace with:**
```ts
export { AIInsightPanel } from "./AIInsightPanel";
export { AICommandBar } from "./AICommandBar";
export { AmbientStrip } from "./AmbientStrip";
export { CommandPalette } from "./CommandPalette";
export { AmbientInsightBar } from "./AmbientInsightBar";
```

## Change 5: Delete `src/components/ai/FloatingChatWidget.tsx`

```bash
git rm src/components/ai/FloatingChatWidget.tsx
```

Use `git rm` (not just file deletion) so the deletion is staged.

## Steps
1. Apply all 5 changes above
2. Run `cd c:/Users/ADMIN/Desktop/HRMS2-latest && npx tsc --noEmit` — 0 errors
3. Verify FloatingChatWidget is gone: `grep -r "FloatingChatWidget" src/` → 0 matches
4. Commit all changes: `git add -A && git commit -m "feat(ai): wire AICommandBar — replace FloatingChatWidget, update layout padding, remove old ⌘K handler"`

## Report file
`c:\Users\ADMIN\Desktop\HRMS2-latest\.superpowers\sdd\ai-cmd-task-6-report.md`

Include: Status, commit hash, TypeScript result, FloatingChatWidget grep result (0 matches expected), concerns.

Return: status, commit hash, TypeScript result, grep result, concerns.
