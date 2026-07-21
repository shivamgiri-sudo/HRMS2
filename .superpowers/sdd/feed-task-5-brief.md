# Task Brief: Feed Task 5 — NativeCompanyFeedCreatorAccess bulk grant + roster pagination

## Context
MAS PeopleOS HRMS compact UI redesign. Company Feed module, Task 5 of 5.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Modify `src/pages/NativeCompanyFeedCreatorAccess.tsx`:
1. Add multi-select checkboxes to the search results list
2. Add "Grant X selected" bulk button
3. Add `ROSTER_PAGE_SIZE=20` pagination with "Show more" button on the creator roster list

## What to keep
- ALL existing hooks and mutations
- All search logic
- All individual grant/revoke logic
- All existing UI that is not being replaced
- `DashboardLayout` wrapper

## What to change

### Step 1: Read the file first
Read the full file to understand the current structure before making changes. Find:
- The employee search results list (where individual "Grant" buttons are)
- The creator roster list (where active creators are shown)
- The grant mutation and its call signature

### Step 2: Add multi-select state
Add near the top of the component, after existing state:
```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

const toggleSelect = (id: string) =>
  setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
```

Also add clear-on-search: when the search query changes or new search results arrive, clear selected IDs:
```tsx
// In the effect or handler that runs a new search, add:
setSelectedIds(new Set());
```

### Step 3: Add checkboxes to search results
In the search results list, add a checkbox before each employee entry:
```tsx
<div className="flex items-center gap-2 py-1.5 border-b last:border-0">
  <input
    type="checkbox"
    checked={selectedIds.has(emp.id)}
    onChange={() => toggleSelect(emp.id)}
    className="h-3.5 w-3.5 cursor-pointer"
  />
  {/* Keep existing employee name/code/info display */}
  {/* Keep existing individual Grant button */}
</div>
```

Note: Find the actual employee object field for `id` — it may be `employee_id`, `id`, or similar. Read the type.

### Step 4: Add "Grant X selected" bulk button
After the search results list (still inside the search results section):
```tsx
{selectedIds.size > 0 && (
  <div className="mt-2 flex justify-end border-t pt-2">
    <Button
      size="sm"
      onClick={() => {
        // Call grant mutation for each selected ID
        // Check actual grant mutation signature — if it takes one ID at a time, loop:
        Array.from(selectedIds).forEach(id => grantMutation.mutate(id));
        setSelectedIds(new Set());
      }}
      disabled={grantMutation.isPending}
    >
      Grant {selectedIds.size} selected
    </Button>
  </div>
)}
```

Note: Read the actual grant mutation signature. If it accepts an array, call it once with the array. If it accepts one ID, loop as shown above.

### Step 5: Add roster pagination
Add near the top of the component:
```tsx
const ROSTER_PAGE_SIZE = 20;
const [rosterPage, setRosterPage] = useState(1);
```

Find the creator roster list. Replace the full list render with paginated slice:
```tsx
const paginatedRoster = roster?.slice(0, rosterPage * ROSTER_PAGE_SIZE) ?? [];
const hasMore = (roster?.length ?? 0) > rosterPage * ROSTER_PAGE_SIZE;

{/* Render paginatedRoster instead of roster */}
{paginatedRoster.map(creator => (...))}

{/* After the list: */}
{hasMore && (
  <Button
    variant="ghost"
    size="sm"
    className="w-full text-xs mt-2"
    onClick={() => setRosterPage(p => p + 1)}
  >
    Show more ({(roster?.length ?? 0) - paginatedRoster.length} remaining)
  </Button>
)}
```

Note: Find the actual variable name for the roster list (the array of active creators). Read the file.

### Step 6: TypeScript + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "NativeCompanyFeedCreatorAccess"
git add src/pages/NativeCompanyFeedCreatorAccess.tsx
git commit -m "feat(feed): CreatorAccess bulk grant multi-select + roster pagination"
```

Write report to `.superpowers/sdd/feed-task-5-report.md`

Return only: Status, commit hash, tsc result, concerns.
