# Work Inbox — Package 1: Volume Relief

**Date:** 2026-08-22
**Status:** Approved — ready for implementation planning
**Scope:** NativeWorkInbox page + ActionSheet + one new backend endpoint
**Packages in series:** 1 (Volume Relief) → 2 (Smart Prioritization) → 3 (Time Management) → 4 (Team & Collaboration) → 5 (Intelligence & Closure)

---

## Problem

The Work Inbox currently renders every item individually. A BPO branch with 3 HR reps can have 80+ items at any given time, dominated by repeated low-signal types (attendance missing-punch, walk-in SLA alerts) that all need the same action. Acting on them one-by-one is the primary reason users stop opening the inbox.

Secondary friction: the remarks textarea is blank every time, forcing users to retype the same notes; and there is no keyboard navigation for heavy daily users.

---

## Goals

1. Collapse repeated same-type items into a single bulk row — one click clears dozens.
2. Pre-fill common remarks per module type to eliminate re-typing.
3. Enable keyboard-driven navigation for power users.
4. Surface a visual split between items that only the current user can act on versus items any team member could handle.

## Non-Goals (deferred to later packages)

- Server-side snooze (Package 3)
- Soft claims / team load view (Package 4)
- AI-powered item explanation or outcome tracking (Package 5)
- Triage scoring or flow-state processor (Packages 2 & 3)

---

## Architecture

No new database tables. One new backend endpoint. All other changes are pure frontend.

```
NativeWorkInbox (page)
├── groupItems()          ← new: groups raw items array into GroupedItem | PendingTask
├── TaskRow               ← existing compact row (unchanged)
├── GroupRow              ← new: renders a collapsed batch row
├── SectionDivider        ← new: "Needs You" / "Your Team Can Handle" label
├── ActionSheet           ← existing, receives remarksChips prop
│   └── RemarksChips      ← new: module-keyed chip bar above textarea
└── useKeyboardNav        ← new hook: J/K/A/O/D/? key bindings

Backend
└── POST /api/inbox/bulk-actioned   ← new endpoint
```

---

## Feature 1: Bulk Group + Acknowledge All

### Grouping Algorithm

Run after every fetch. Input: `PendingTask[]`. Output: `(PendingTask | GroupedItem)[]`.

```typescript
interface GroupedItem {
  kind: "group";
  groupKey: string;          // `${module}::${source}::${branch_name ?? "all"}`
  module: string;
  source: "tat" | "inbox" | "work_item";
  branch_name: string | null;
  items: PendingTask[];
  worstRisk: Risk;           // highest risk among members
  highestPriority: string;   // highest priority among members
}
```

**Grouping criteria — all must be true:**

| Criterion | Value |
|-----------|-------|
| Same `module` | yes |
| Same `source` | yes — can't mix tat/inbox/work_item in one bulk call |
| `source !== "derived"` | derived items require real workflow navigation |
| Same `branch_name` | null branches are grouped separately from named branches |
| Group size | ≥ 3 (below 3, individual rows are preferable) |
| No member has `priority === "urgent"` | urgent items always stay individual |

Items that don't qualify for any group remain as individual `PendingTask` rows.

### Group Row UI

```
[38]  Attendance · Branch A · Missing Punch    [breached]  —    [▼ Expand]  [Acknowledge All (38)]
```

- Count badge: slate background, white text, `text-xs font-black`
- Risk badge: worst risk in the group (if any member is breached, the whole group shows breached)
- Expand toggle: reveals individual `TaskRow`s inline beneath the group row
- "Acknowledge All (N)" button: shows a confirmation dialog before firing

**Confirmation dialog text:**
> "Close 38 attendance items from Branch A? This will mark all of them as actioned with the remark 'Bulk acknowledged'. This cannot be undone."
> [Cancel] [Acknowledge All]

### Backend Endpoint

`POST /api/inbox/bulk-actioned`

**Request:**
```json
{
  "ids": ["uuid1", "uuid2", "..."],
  "source": "inbox",
  "remarks": "Bulk acknowledged"
}
```

**Validation:**
- `ids` array: max 500 items, non-empty, all strings
- `source`: one of `"inbox" | "tat" | "work_item"`
- Caller must have permission to act on every ID — validated in a single query using role + branch scope, not N individual checks

**Per-source action:**
- `inbox`: `UPDATE work_inbox_item SET is_actioned=1, actioned_at=NOW(), actioned_remarks=? WHERE id IN (?) AND user_id=?`
- `tat`: bulk insert into `tat_task_completions`
- `work_item`: `UPDATE work_items SET status='completed', completed_at=NOW(), completion_remarks=? WHERE id IN (?)`

All updates run in a single transaction. Partial failures (e.g., one ID no longer exists) do not roll back the whole batch — they are reported in the response.

**Response:**
```json
{
  "success": true,
  "actioned": 36,
  "failed": [
    { "id": "uuid37", "reason": "not_found" },
    { "id": "uuid38", "reason": "already_actioned" }
  ]
}
```

**Frontend after success:**
1. Remove all group items from `items` state
2. Add a single entry to `actedItems`: `{ title: "Batch (38 items) — Attendance · Branch A", acted_at: now }`
3. Update summary counts by subtracting group size
4. Invalidate `["notifications"]` and `["notifications-unread-count"]` React Query caches

---

## Feature 2: Smart Remarks Chips

### Data

A constant in the component file (no backend required):

```typescript
const MODULE_REMARKS: Record<string, string[]> = {
  leave_approval:               ["Approved — coverage confirmed", "Declined — insufficient balance", "Approved with conditions"],
  leave_request:                ["Approved — coverage confirmed", "Declined — insufficient balance"],
  attendance_missing_punch:     ["Regularized — supervisor verified", "Declined — records correct"],
  attendance_regularization:    ["Regularized — supervisor verified", "Declined — records correct"],
  regularization:               ["Regularized — verified", "Declined — records correct"],
  bgv:                          ["Clear — proceeding", "Document resubmission requested", "Escalated to HR Head"],
  exit_clearance:               ["Cleared", "Pending — asset return outstanding", "Escalated"],
  resignation:                  ["Acknowledged — notice period begins", "Escalated to Branch Head"],
  onboarding:                   ["Completed — employee notified", "Pending documents — follow-up sent"],
  offboarding:                  ["Clearance complete", "Pending — IT access outstanding"],
  it_provisioning:              ["Provisioned", "Deferred — pending approval"],
  asset_return:                 ["Assets received and logged", "Partial return — follow-up required"],
  pip_checkpoint:               ["Checkpoint noted — plan on track", "Checkpoint missed — escalating"],
};
```

### UI

Rendered inside `ActionSheet` above the `<Textarea>`, only when `MODULE_REMARKS[task.module]` exists and `task.source !== "derived"`:

```
Quick remarks:
[Approved — coverage confirmed]  [Declined — insufficient balance]  [Approved with conditions]
```

- Each chip: `rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer`
- On click: sets `remarks` state to chip text. User can then edit freely before submitting.
- If `remarks` is already non-empty and user clicks a chip: replaces (not appends) — simpler mental model.

---

## Feature 3: Keyboard Shortcuts

### Hook: `useKeyboardNav`

```typescript
useKeyboardNav({
  itemCount: filtered.length,
  focusedIndex,
  setFocusedIndex,
  onAct: (index) => void completeTask(filtered[index].id, ""),
  onOpen: (index) => setSelected(filtered[index]),
  onOpenUrl: (index) => { const url = filtered[index].action_url; if (url) window.open(url, "_blank"); },
  onToggleLegend: () => setShowKeyLegend((v) => !v),
});
```

The hook registers a `window.addEventListener("keydown", handler)` inside `useEffect`. The handler returns early when `document.activeElement` is an `INPUT`, `TEXTAREA`, or `SELECT` — so typing in the search box or remarks field is unaffected.

### Key Bindings

| Key | Action | Notes |
|-----|--------|-------|
| `J` / `↓` | Focus next row | Wraps at bottom |
| `K` / `↑` | Focus previous row | Wraps at top |
| `A` | Act on focused row | No remarks; same as inline Act button |
| `O` | Open `action_url` | No-op if no URL |
| `D` | Open details sheet | Same as clicking Details button |
| `Escape` | Close sheet / clear focus | |
| `?` | Toggle shortcut legend | |

`S` (snooze) is bound but shows a `toast.info("Snooze coming soon")` — wires the affordance without blocking this package.

### Focused Row Styling

`focusedIndex` state in the main component. The focused `TaskRow` receives an additional class: `ring-2 ring-blue-500 ring-inset bg-blue-50/40`. The row is also scrolled into view via `ref.scrollIntoView({ block: "nearest" })`.

### Legend Overlay

A small fixed panel, bottom-right corner, `z-50`, shown when `showKeyLegend` is true:

```
Keyboard Shortcuts
──────────────────
J / K    Navigate rows
A        Act on row
O        Open link
D        Details
?        Toggle this panel
Esc      Close / clear
```

---

## Feature 4: "Needs You" vs "Your Team Can Handle" Split

### Classification Logic (frontend)

No new API field required. Classification runs on the filtered items array before rendering.

**"Needs You"** when any of:
- `risk === "breached"` or `risk === "due_soon"`
- `priority === "urgent"` or `priority === "high"`
- `source === "derived"` (only navigable, not actable generically)
- `module` is one of: `exit_clearance`, `resignation`, `bgv`, `payroll_attendance_conflict`, `pip_checkpoint`

**"Your Team Can Handle"** — everything else.

### UI

```
NEEDS YOU  (6)
─────────────────────────────────────────────────────────────────
[table rows]

YOUR TEAM CAN HANDLE  (14)                              [Reassign →]
─────────────────────────────────────────────────────────────────
[table rows — Reassign button stub visible in actions column]
```

Section headers are `text-[10px] font-black uppercase tracking-widest text-slate-400` — minimal visual weight.

The "Reassign" button in "Your Team Can Handle" rows is present but calls `toast.info("Reassignment coming in the next update")` — stubs the affordance for Package 4 without any backend work now.

If all items fall into one section, only that section renders — no empty section header.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Bulk-actioned API returns partial failures | Toast: "36 of 38 items closed. 2 were already actioned." Succeeded items leave the list; failed items remain. |
| Bulk-actioned API call fails entirely | Toast error; no items removed from state; user can retry |
| Keyboard `A` fires while `actingIds` contains focused row | No-op — button is already disabled |
| Group row expanded but individual item acted via row button | That item leaves both the group and the parent list; group count updates live |

---

## Files Changed

**Modified:**
- `src/pages/NativeWorkInbox.tsx` — groupItems(), GroupRow, SectionDivider, useKeyboardNav wired, MODULE_REMARKS constant, remarksChips prop on ActionSheet
- `src/components/ui/sheet.tsx` — no change expected (ActionSheet is inline in the page file)
- `backend/src/modules/inbox/inbox.routes.ts` — add bulk-actioned route
- `backend/src/modules/inbox/inbox.service.ts` — add bulkActioned() function

**New:**
- No new files — all additions are inline in existing files to keep the diff reviewable

---

## Testing Checklist

- [ ] Group row appears when 3+ same-module/source/branch items exist
- [ ] Urgent items never collapse into a group
- [ ] Derived items never appear in a group
- [ ] "Acknowledge All" confirmation shows correct count and module
- [ ] Bulk API: all items removed from state on success
- [ ] Bulk API: partial failure leaves failed items in list with a toast
- [ ] Remarks chips appear for supported modules, absent for unsupported
- [ ] Clicking a chip fills textarea; user can edit before submitting
- [ ] J/K navigation moves highlight ring and scrolls row into view
- [ ] Keyboard listener inactive while search input has focus
- [ ] "Needs You" section contains all breached/urgent items
- [ ] "Your Team" section reassign stub shows toast, takes no action
- [ ] Bell count drops immediately after bulk act (cache invalidated)
- [ ] Recently-acted section shows one batch entry after bulk act

---

## Rollback

All changes are additive. Reverting `NativeWorkInbox.tsx` to the pre-Package-1 version restores the previous behaviour. The `bulk-actioned` endpoint can be removed without affecting existing endpoints.
