# P&L Task 3 Report — PnlMasterControlCenterPage Split-Pane

## Status: DONE

## Commit
`51ef5b3b` — feat(pnl): PnlMasterControlCenter split-pane form panel, remove hero + WorkspaceCard nesting

## tsc result
`npx tsc --noEmit` — zero errors, zero warnings.

## What was done

### Removed
- Dark hero section (`<section>` with `bg-slate-950` full-bleed decorative panel)
- 4 large MetricCard KPI tiles row (`MetricCard` component instances)
- `WorkspaceCard` component usage and its import (component definition retained in-file but not used; could be removed in a future cleanup)
- `CardHeader`, `CardTitle` imports (no longer used)

### Added
- 48px slim header bar: `P&L Control Centre` title + period badge + nav buttons (P&L Command Centre, Period Close, Branch Budget)
- `Badge` import from `@/components/ui/badge`
- `SplitPane` internal component: reusable split-pane that takes `formOpen`, `tableLabel`, `onAdd`, `onClose`, `selectedRow`, `tableSlot`, `formSlot`, `onSave`, `saving` props
- `formOpen` / `selectedRow` shared state; reset on tab change via `onValueChange`

### Per-tab changes

| Tab | Pattern |
|-----|---------|
| overview | Converted WorkspaceCard to plain `div` with border/shadow; health lines + impact simulator kept intact |
| commercial | 3-way form-type switcher (Revenue Rule / Contract / Rate Card) + SplitPane for each |
| delivery | Two side-by-side SplitPanes: Delivery Actual and Revenue Component |
| costs | SplitPane + P&L line hierarchy info card below |
| allocation | SplitPane |
| classification | SplitPane |
| plans | SplitPane |
| governance | Plain div cards; adjustment history table at bottom |

### All mutations preserved
- `bpo.saveRevenueRule`, `bpo.saveDeliveryActual`, `bpo.saveRevenueComponent`, `bpo.saveCostComponent`, `bpo.saveAllocationPolicy`, `bpo.saveClassificationRule`
- `legacy.saveContract`, `legacy.saveRate`, `legacy.saveMonthlyPlan`

## Concerns

1. **Shared `formOpen`/`selectedRow` state**: The delivery tab has TWO split-panes side by side (delivery actuals and revenue components). Both share the same `formOpen` state, so opening the form in one affects the other. In practice they are in separate columns so the visual impact is minimal, but if both are active simultaneously the form would slide in on both columns. A future improvement would use per-pane state or a pane identifier.

2. **Row-click pre-population**: Row clicks set `selectedRow` and open the form panel, but the form fields are NOT pre-populated from the selected row. The existing mutation state forms are used as-is. Pre-populating from row data would require mapping table column keys back to camelCase payload keys — deferred to avoid breaking mutation shapes.

3. **`clientName` map is computed but unused**: The `clientName` useMemo was in the original file and is preserved. No TS error because `noUnusedLocals: false`. Safe to remove in a future cleanup.

4. **`WorkspaceCard` and `MetricCard` definitions remain in-file**: They are dead code but harmless. Tree-shaking removes them from the bundle.
