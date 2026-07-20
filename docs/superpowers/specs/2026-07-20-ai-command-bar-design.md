# PeopleOS AI Command Bar — Design Spec

**Date:** 2026-07-20  
**Status:** Approved for implementation

---

## Problem

The current `FloatingChatWidget` is a bottom-right bubble that users ignore after day 2. It:
- Has no ambient value — requires deliberate click to see any AI insight
- Is not contextual — shows the same interface on every page
- Competes with the existing `Ctrl+K` search rather than unifying with it
- The full `cmdk` package is installed but unused
- The backend `/api/ai/role-insights` endpoint exists but nothing calls it

---

## Solution: Three-State AI Command Bar

Replace `FloatingChatWidget` with a unified component that has three states:

---

### State 1 — Ambient Strip (passive, always visible on dashboard/ops pages)

**What it looks like:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ ⚡ 3 regularization pending · Bellavita SLA at 87% · Ask anything  ⌘K │
└──────────────────────────────────────────────────────────────────────┘
```

- Pinned to the **bottom of the page content area** (inside DashboardLayout, above any footer)
- Height: 36px. Never overlaps content — pushes content up via padding
- Shows 2–3 live insight chips sourced from `/api/ai/role-insights` refreshed every **5 minutes**
- Chips are contextual to current page (route-to-contextType mapping)
- Clicking any chip or the "Ask anything" label opens State 2
- Clicking `⌘K` anywhere also opens State 2
- Visible on: `/dashboard`, `/my-dashboard`, `/ceo/*`, `/operations/*`, `/quality/*`, `/call-master`, `/wfm/*`, `/hr/*`, `/manager/*`, `/recruiter*`, `/payroll*`
- Hidden on: forms, config pages, ATS candidate pages, auth pages, `/peopleos/copilot`

**Chip severity styling:**
- Critical: red background, white text, pulsing dot
- Warning: amber background, dark text
- Info: slate background, default text

---

### State 2 — Command Palette (active, full-overlay)

**Triggered by:** `⌘K` / `Ctrl+K` anywhere, clicking the ambient strip, clicking any chip

**What it looks like:** Full-screen overlay with a centered floating panel (max-width 640px), slides down from top-center. Dark backdrop.

```
┌────────────────────────────────────────────────┐
│ ⚡ PeopleOS Copilot                          ✕  │
├────────────────────────────────────────────────┤
│ 🔍 Ask anything or type / to navigate...        │
├────────────────────────────────────────────────┤
│ SUGGESTED FOR YOU                               │
│ › What are my top risks today?                  │
│ › Show pending regularizations                  │
│ › Who hasn't clocked in yet?                    │
│                                                 │
│ QUICK NAVIGATE                                  │
│ › /attendance       Attendance                  │
│ › /quality/dashboard  Quality Dashboard         │
│ › /operations/dashboard  Operations             │
├────────────────────────────────────────────────┤
│ ↵ to send   /  to navigate   Esc to close       │
└────────────────────────────────────────────────┘
```

**Interaction modes:**

1. **AI mode (default):** Type a question → press Enter → AI responds inline in the palette, showing answer + insight badges + action links. Pressing Enter again or clicking "Open full chat →" goes to `/peopleos/copilot`.

2. **Navigation mode (prefix `/`):** Type `/att` → filters to Attendance pages. Type `/emp` → Employee pages. Uses the existing nav structure from `navGroups`. Arrow keys to select, Enter to navigate. Closes palette and navigates.

3. **Employee lookup (prefix `@`):** Type `@Ravi` → searches employees by name/code from `/api/employees?search=`. Shows name, code, branch, role chips. Enter navigates to their profile.

**Uses `cmdk` (already installed v1.1.1)** for the command list, keyboard navigation, and filtering.

**AI response in palette:**
- Shows a loading skeleton while waiting
- Renders the answer as prose text (max 4 lines, "See more" expands)
- Shows up to 3 insight chips below the answer
- Shows up to 2 action link buttons
- "Open full conversation →" link at bottom-right takes to `/peopleos/copilot`
- Does NOT maintain conversation history — palette is stateless. Full history lives in `/peopleos/copilot`.

---

### State 3 — Inline Insight Injection (zero interaction)

For 4 specific high-value pages, the ambient strip **expands** into a 3-chip insight row rendered directly inside the page layout (above the page header), not in a floating overlay.

**Pages where this activates:**
- `/operations/dashboard` — shows ops-specific signals
- `/ceo/dashboard` — shows executive risk signals  
- `/quality/dashboard` — shows quality alerts
- `/wfm/dashboard` or `/wfm-attendance` — shows attendance anomalies

This is achieved by a context hook `useAmbientInsights()` that page components can call. The hook returns `{ chips, loading }` from the role-insights cache. Pages that want State 3 render `<AmbientInsightBar />` at their own top. The ambient strip at the bottom still shows but collapses to just the "Ask anything ⌘K" trigger.

---

## Architecture

### Files to Create

```
src/components/ai/
  AICommandBar.tsx          — Root orchestrator, replaces FloatingChatWidget
  AmbientStrip.tsx          — State 1: 36px bottom strip
  CommandPalette.tsx         — State 2: cmdk-powered overlay
  AmbientInsightBar.tsx     — State 3: inline page-level insight bar
  useAmbientInsights.ts     — Hook: fetches role-insights, caches per route, refreshes every 5 min
  index.ts                  — Re-export all (update existing barrel)
```

### Files to Modify

```
src/App.tsx                 — Replace <FloatingChatWidget /> with <AICommandBar />
src/components/layout/CompactDashboardLayout.tsx
                            — Add pb-9 padding-bottom to main content area (space for strip)
                            — Remove old Ctrl+K handler (now handled by AICommandBar)
src/components/layout/TopBar.tsx
                            — Remove ⌘K hint from search input (now belongs to command bar)
src/components/ai/index.ts  — Add new exports
```

### Route → Context Type Mapping

```typescript
const ROUTE_CONTEXT: Record<string, string> = {
  "/dashboard":           "generic",
  "/my-dashboard":        "employee_self",
  "/ceo/dashboard":       "executive_dashboard",
  "/operations/dashboard":"operations",
  "/operations-dashboard":"operations",
  "/quality/dashboard":   "quality_operations",
  "/quality-dashboard":   "quality_operations",
  "/wfm/dashboard":       "wfm_roster",
  "/wfm-attendance":      "wfm_roster",
  "/hr/dashboard":        "hr_operations",
  "/manager/dashboard":   "manager_team",
  "/recruiter-dashboard": "ats_recruiter",
  "/payroll-hr/dashboard":"payroll_readiness",
  "/call-master":         "operations",
  "/attendance":          "wfm_roster",
};
```

### useAmbientInsights Hook

```typescript
// Returns cached role-insights for the current route, refreshes every 5 minutes
function useAmbientInsights(): {
  chips: Array<{ label: string; severity: "critical" | "warning" | "info"; action_url?: string }>;
  loading: boolean;
  refresh: () => void;
}
```

- Calls `GET /api/ai/role-insights` (already exists, returns role-scoped insights)
- Caches result in a module-level Map keyed by `contextType + userId`
- Auto-refreshes every 300_000ms (5 min) via setInterval
- Returns empty array gracefully if rate-limited or API unavailable (never blocks UI)

### CommandPalette component

Built on `cmdk` (`Command`, `CommandInput`, `CommandList`, `CommandItem`, `CommandGroup`).

Input prefix routing:
- No prefix → AI mode: debounced 500ms, calls `/api/ai/ask`
- `/` prefix → nav mode: filters navGroups from navConfig
- `@` prefix → employee mode: calls `/api/employees?search=&limit=8`

Keyboard:
- `Esc` → close
- `↑ ↓` → navigate items (cmdk handles)
- `Enter` → execute selected action
- `⌘K` or `Ctrl+K` anywhere → toggle open/close (global keydown listener in AICommandBar)

---

## What Gets Removed

- `FloatingChatWidget.tsx` — **deleted**. All functionality absorbed into `AICommandBar`.
- Old `Ctrl+K` handler in `CompactDashboardLayout.tsx` — removed (superseded).
- `⌘K` hint in TopBar search — removed (now belongs to command bar).

The existing `AIInsightPanel` on dashboards and the full-page `/peopleos/copilot` are **unchanged**.

---

## Non-Goals

- No conversation history in the palette (full history stays in `/peopleos/copilot`)
- No drag-to-move
- No persistence across sessions
- No streaming responses (use standard request/response)
- No changes to backend AI endpoints

---

## Visual Design

- Ambient strip: `bg-slate-900/95 backdrop-blur-sm` dark bar, white text, colored severity dots
- Command palette backdrop: `bg-black/40`
- Palette panel: white, `rounded-2xl`, `shadow-2xl`, slides down with `translate-y` animation
- Insight chips in palette: same severity-color system as `AIInsightPanel` already uses
- Animation: 150ms ease-out open, 100ms ease-in close
- Strip chips: small rounded pills with a leading colored dot and short label text

---

## Verification

1. `npx tsc --noEmit` — 0 errors
2. Press `⌘K` on any authenticated page → command palette opens centered
3. Type a question → AI responds inline with insight chips
4. Type `/att` → navigation results filter to attendance pages, Enter navigates
5. Type `@Ravi` → employee search results appear
6. Ambient strip visible on `/operations/dashboard`, hidden on `/settings`
7. Strip shows role-relevant chips, refreshes every 5 minutes
8. `FloatingChatWidget` no longer rendered anywhere
9. `/peopleos/copilot` full page still works independently
