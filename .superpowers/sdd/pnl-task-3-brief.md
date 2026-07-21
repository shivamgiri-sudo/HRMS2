# Task Brief: P&L Task 3 — PnlMasterControlCenterPage split-pane form

## Context
MAS PeopleOS HRMS compact UI redesign. P&L Task 3 of 4.
Working directory: `C:\Users\ADMIN\Desktop\HRMS2-latest`

## Goal
Rewrite `src/pages/finance/PnlMasterControlCenterPage.tsx` (817 lines):
1. Remove dark hero + 4 large metric cards
2. Add 48px slim header with period/branch badges
3. For each of the 8 tabs: replace `WorkspaceCard` 2-col (form+table) with split-pane (table left, form slides in right on row click)

## What to keep
- ALL hooks from `useBpoPnlConfiguration`
- ALL mutations (add/update for each master type)
- ALL the 8 tabs with their existing tab values
- All payload types imported from `useBpoPnlConfiguration`

## What to change

### Step 1: Delete the dark hero section
Find and delete the decorative hero `<div>` at the top of the return.

### Step 2: Delete the 4 large KPI metric cards
Find the row of 4 metric/stat cards below the hero (revenue model coverage, revenue at risk, etc.). Delete them.

### Step 3: Add 48px header
```tsx
<div className="flex h-full flex-col">
  <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
    <h1 className="text-sm font-semibold">P&L Control Centre</h1>
    <div className="flex items-center gap-3">
      {period && <Badge variant="outline" className="text-xs">{period}</Badge>}
    </div>
  </div>
```

### Step 4: Replace WorkspaceCard form+table with split-pane pattern

This is the main refactor. The file has 8 tabs. Each tab currently has something like:
```tsx
<div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
  <WorkspaceCard title="Add / Edit">
    <form .../>
  </WorkspaceCard>
  <WorkspaceCard title="Current entries">
    <table .../>
  </WorkspaceCard>
</div>
```

Replace with a split-pane where the form slides in from the right:

**Shared state (add at top of component, after existing state):**
```tsx
const [formOpen, setFormOpen] = useState(false);
const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
```

**Split-pane pattern for each tab:**
```tsx
<TabsContent value="tab-value" className="flex-1 overflow-hidden m-0">
  <div className="flex h-full gap-0 overflow-hidden">
    {/* Table side */}
    <div className={`flex flex-col overflow-hidden transition-all duration-150 ${formOpen ? "w-[55%]" : "w-full"}`}>
      <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
        <span className="text-xs font-medium text-slate-500">Tab Name entries</span>
        <Button size="sm" onClick={() => { setSelectedRow(null); setFormOpen(true); }}>
          + Add
        </Button>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2">
        {/* Existing table — keep all columns and data, just keep it */}
        {/* Rows get onClick: row => { setSelectedRow(row); setFormOpen(true); } */}
      </div>
    </div>

    {/* Form panel */}
    {formOpen && (
      <div className="w-[45%] border-l flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center justify-between border-b px-3 py-2 shrink-0">
          <span className="text-xs font-semibold">
            {selectedRow ? "Edit" : "Add new"}
          </span>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setFormOpen(false); setSelectedRow(null); }}>
            ×
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {/* Existing form fields — keep all, just move into here */}
        </div>
        <div className="border-t px-3 py-2 flex justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => { setFormOpen(false); setSelectedRow(null); }}>Cancel</Button>
          <Button size="sm" onClick={handleTabSubmit}>Save</Button>
        </div>
      </div>
    )}
  </div>
</TabsContent>
```

**IMPORTANT:** The shared `formOpen`/`selectedRow` state works because only one tab is active at a time. When the active tab changes (user clicks another tab), reset the form: add `onValueChange={tab => { setActiveTab(tab); setFormOpen(false); setSelectedRow(null); }}` to the `<Tabs>` component.

### Step 5: WorkspaceCard removal
Remove the `WorkspaceCard` import if it exists. Replace with the split-pane div structure above.

### Step 6: Handle 8 tabs
Read the file and apply the split-pane pattern to each of the 8 tabs. Keep the existing form fields and table data — just restructure the layout.

The 8 tabs are likely: revenue_components, cost_components, allocation_policy, classification_rules, delivery_actuals, revenue_rules, process_mapping, or similar. Find the actual tab values from the file.

### Step 7: Add Badge import
```tsx
import { Badge } from "@/components/ui/badge";
```

Remove WorkspaceCard import. Remove unused imports (Link, icons no longer used).

### Step 8: Fix TypeScript + commit
```bash
npx tsc --noEmit 2>&1 | grep -i "PnlMasterControl"
git add src/pages/finance/PnlMasterControlCenterPage.tsx
git commit -m "feat(pnl): PnlMasterControlCenter split-pane form panel, remove hero + WorkspaceCard nesting"
```

Write report to `.superpowers/sdd/pnl-task-3-report.md`

Return only: Status, commit hash, tsc result, concerns.
