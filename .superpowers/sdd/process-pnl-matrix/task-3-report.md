# Task 3 Report — Matrix presets, sticky totals, and sorting

## Status

Completed with concerns noted below.

## Files changed

- `src/components/finance/pnl/ProcessPnlMatrixTotals.tsx`
- `src/components/finance/pnl/BpoPnlMatrixTable.tsx`
- `src/components/finance/pnl/processPnlMatrixConfig.ts`
- `src/tests/process-pnl-matrix-config.test.ts`
- `src/tests/process-pnl-page.contract.test.tsx`
- `.superpowers/sdd/process-pnl-matrix/task-3-report.md`

## Delivered

- Replaced the hardcoded matrix with preset-driven columns, filters, sorting, density, and sticky identifying columns.
- Added a sticky totals row that delegates every value to the config's column-specific total definition.
- Preserved the exact Task 1 Summary column order.
- Restored the Full Matrix to a wide 56-column accounting layout, including commercial, revenue, cost, profitability, and budget coverage.
- Added contract coverage for the totals component, sortable headers, full-preset condition, required presets, and full-versus-summary width.

## Commands run

```bash
node backend/node_modules/vitest/vitest.mjs run src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx --config vite.config.ts --globals
npm run typecheck
npm run build
git diff --check -- src/components/finance/pnl/ProcessPnlMatrixTotals.tsx src/components/finance/pnl/BpoPnlMatrixTable.tsx src/components/finance/pnl/processPnlMatrixConfig.ts src/tests/process-pnl-matrix-config.test.ts src/tests/process-pnl-page.contract.test.tsx
```

## Results

- Focused Vitest command: passed, 2 files and 12 tests.
- Typecheck: passed.
- Production build: passed. Existing Vite chunk-size warnings remain.
- Diff whitespace check: passed.

## Concerns

- The checked-in Task 2 page currently passes only `rows`, `period`, `preset`, `status`, `issue`, and `density`; it does not pass the brief's `search` or `alerts` props. The matrix accepts and consumes both props, but page-level wiring is outside this task's allowed write scope.
- Chrome DevTools MCP is not configured, so no live-browser visual verification was possible.
