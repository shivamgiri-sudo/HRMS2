# Task 6 Report: Wire AICommandBar — Replace FloatingChatWidget

## Status
COMPLETE

## Commit Hash
`c893b56d`

## Changes Applied

### 1. `src/App.tsx`
- Replaced `import { FloatingChatWidget }` with `import { AICommandBar }`
- Replaced `<FloatingChatWidget />` with `<AICommandBar />` in JSX

### 2. `src/components/layout/CompactDashboardLayout.tsx`
- Removed the entire `/* ⌘K shortcut */` useEffect block (lines 139-152 in original)
- Added `pb-9` to `<main>` className so ambient strip does not overlap content

### 3. `src/components/layout/TopBar.tsx`
- Removed the `<span className="cmd-key-hint ...">⌘K</span>` element
- Changed search input className from `pr-16` to `pr-4`

### 4. `src/components/ai/index.ts`
- Replaced `FloatingChatWidget` export with four new exports:
  `AICommandBar`, `AmbientStrip`, `CommandPalette`, `AmbientInsightBar`

### 5. `src/components/ai/FloatingChatWidget.tsx`
- Deleted via `git rm` (staged deletion)

### 6. `src/tests/app-shell-routing.contract.test.ts` (bonus fix)
- Updated contract assertion from `<FloatingChatWidget />` to `<AICommandBar />`
  to keep the shell routing contract test green

## TypeScript Result
```
npx tsc --noEmit → (no output) — 0 errors
```

## FloatingChatWidget grep result
```
grep -r "FloatingChatWidget" src/ → (no output) — 0 matches
```

## Concerns
- One additional file (`src/tests/app-shell-routing.contract.test.ts`) was updated beyond the brief's listed 4+1. The brief omitted this contract test update; without it the test suite would fail on the deleted symbol. The fix is correct and conservative (updates the assertion to match the new component name).
- CRLF warning on `src/components/ai/index.ts` is cosmetic (Git line-ending normalisation) and has no functional impact.
