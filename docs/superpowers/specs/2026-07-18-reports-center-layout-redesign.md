# Reports Center Layout Redesign

**Date:** 2026-07-18  
**File:** `src/pages/NativeReportsCenter.tsx`  
**Status:** Approved, ready for implementation

---

## Goal

Move the category navigation in NativeReportsCenter from a horizontal 4-column card grid (click-to-expand accordion) to a persistent left sidebar panel with inline subcategory expansion, matching the standard left-nav pattern of the HRMS shell.

---

## Architecture

### Outer Shell (unchanged)
`HrmsModernShell` remains the page wrapper. The header strip (eyebrow, title, search input, MCN logo) is unchanged. The search input in the header now drives left-panel filter behaviour instead of the overlay card.

### Two-Column Layout (new)
Inside `HrmsModernShell`'s `children`, the top-level container changes from `space-y-6` to a `flex gap-0` row:

```
┌─ Left panel (w-60, shrink-0) ──┬─ Right content (flex-1, min-w-0) ─┐
│  Category + subcategory tree   │  Stats tiles                        │
│  (scrolls independently)       │  Recent bar                         │
│                                │  Category report list               │
│                                │  Report runner                      │
└────────────────────────────────┴────────────────────────────────────┘
```

---

## Left Panel

**Dimensions:** `w-60 shrink-0 bg-white border-r border-slate-200`  
**Scroll:** `sticky top-0 h-[calc(100vh-120px)] overflow-y-auto`

### Category rows (14)
- Gradient icon (20×20, matching `CATEGORY_GRADIENTS`) + label + chevron
- Click: toggles expansion (accordion — one open at a time)
- Active: `bg-blue-50 text-blue-700 border-l-2 border-blue-500`
- Collapsed chevron: pointing right; expanded: pointing down

### Subcategory + report rows (expanded state)
- Container: `ml-4 border-l border-slate-200`
- Subcategory header: `text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-3 py-1 mt-2` — not clickable
- Report row: `text-xs text-slate-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded cursor-pointer`
- Selected report row: `bg-blue-100 text-blue-700 font-medium`
- Favourite indicator: `⭐` (gold star icon, 9px) inline before report name

### Search-filter behaviour
When `searchQ` is non-empty, the left panel switches from the category tree to a flat filtered list:
- Results grouped by category header (`text-[10px] font-bold text-gray-400 uppercase`)
- Each match shown as a report row (same style as above)
- Clearing search restores the full category tree

---

## Right Content Area

### Always visible (top of right panel)
1. **Stats tiles** — 3-col grid (total reports, categories, favourites) — unchanged
2. **Recent reports bar** — horizontal chip strip — unchanged

### No category selected (initial state)
- Prompt card: `← Select a category from the left panel to browse reports`
- Favourites section (if any) — same as today

### Category selected
- **Category header bar**: gradient strip + icon + category name + report count badge
- **Subcategory sections**: label (`text-[10px] font-bold uppercase`) + report chips (`bg-gray-50 border rounded-lg text-xs px-3 py-1.5`)
- Active chip: `bg-blue-600 text-white shadow-md ring-2 ring-blue-300`

### Report runner (report selected)
No structural changes. Runner renders below the report list as today:
- Report name + filter inputs + Run button
- Results table with column headers
- Export XLSX button

---

## What Is Removed

| Removed element | Replacement |
|---|---|
| 4-column category card grid | Left panel category tree |
| Inline accordion below category cards | Left panel subcategory expansion |
| `expandedCat` state (grid accordion) | `selectedCat` state (left panel) |

Everything else — stats tiles, recent bar, favourites section, runner, filter logic, XLSX export, search — is preserved unchanged.

---

## State Changes

| State var | Before | After |
|---|---|---|
| `expandedCat` | Which grid card is expanded | Rename to `selectedCat` — which left-panel category is open |
| (new) `selectedCat` for report list filter | n/a | Drives right-panel report list |
| `selectedReport` | Unchanged | Unchanged |
| `searchQ` | Drives overlay card | Drives left-panel filtered list |

---

## Files Modified

| File | Change |
|---|---|
| `src/pages/NativeReportsCenter.tsx` | Full JSX restructure of the return block; state rename; left panel component added inline |

No new files. No backend changes. No route changes.

---

## Self-Review

- No TBDs or placeholders
- Architecture matches feature description
- State changes are internally consistent
- Scope is a single file, single page — no decomposition needed
- "Sticky + overflow-y-auto" height calc uses `100vh - 120px` which covers the HrmsModernShell header height; may need adjustment if header height changes
