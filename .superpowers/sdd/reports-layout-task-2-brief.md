# Task 2 Brief: Build the left panel JSX block

## Context
Task 2 of 4 in `src/pages/NativeReportsCenter.tsx` layout redesign. Task 1 is complete — `expandedCat` has been renamed to `selectedCat`/`setSelectedCat`. Now add the `leftPanel` JSX const directly above the `return (` statement.

## What to add

Find the line that says `return (` (around line 442 in the file) and insert the following block **directly before** it. Copy it exactly — do not paraphrase or simplify:

```tsx
  // ─── Left Panel ───────────────────────────────────────────────────────────────
  const leftPanel = (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-[calc(100vh-120px)] overflow-y-auto flex flex-col">
      <div className="px-3 py-3 border-b border-slate-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Report Categories</p>
      </div>
      <nav className="flex-1 overflow-y-auto py-1">
        {/* Search results mode: flat filtered list */}
        {searchResults ? (
          <div className="px-2 py-1 space-y-0.5">
            {CATEGORY_ORDER.filter(cat => searchResults.some(r => r.category === cat)).map(cat => {
              const grad = CATEGORY_GRADIENTS[cat];
              const Icon = grad?.icon ?? BarChart3;
              const catResults = searchResults.filter(r => r.category === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 pt-2 pb-1">{cat}</p>
                  {catResults.map(r => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => { selectReport(r); }}
                      className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        selectedReport?.code === r.code
                          ? "bg-blue-100 text-blue-700 font-medium"
                          : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                      }`}
                    >
                      {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                      {r.name}
                    </button>
                  ))}
                </div>
              );
            })}
            {searchResults.length === 0 && (
              <p className="text-xs text-slate-400 px-3 py-4">No results</p>
            )}
          </div>
        ) : (
          /* Normal mode: category accordion */
          <div className="px-2 py-1 space-y-0.5">
            {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => {
              const grad = CATEGORY_GRADIENTS[cat];
              const Icon = grad?.icon ?? BarChart3;
              const isOpen = selectedCat === cat;
              const subcats = Array.from(new Set(grouped[cat].map(r => r.subcategory)));

              return (
                <div key={cat}>
                  {/* Category row */}
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                      isOpen
                        ? "bg-blue-50 text-blue-700 border-l-2 border-blue-500"
                        : "text-slate-700 hover:bg-slate-50 border-l-2 border-transparent"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"} flex items-center justify-center flex-shrink-0`}>
                      <Icon size={11} className="text-white" />
                    </div>
                    <span className="flex-1 text-xs font-semibold truncate">{cat}</span>
                    <ChevronDown
                      size={13}
                      className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* Expanded: subcategory + report rows */}
                  {isOpen && (
                    <div className="ml-4 border-l border-slate-200 mt-0.5 mb-1">
                      {subcats.map(sub => {
                        const subReports = grouped[cat].filter(r => r.subcategory === sub);
                        return (
                          <div key={sub}>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-0.5">{sub}</p>
                            {subReports.map(r => (
                              <button
                                key={r.code}
                                type="button"
                                onClick={() => selectReport(r)}
                                className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                                  selectedReport?.code === r.code
                                    ? "bg-blue-100 text-blue-700 font-medium"
                                    : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                                }`}
                              >
                                {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                                {r.name}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );
```

## Verification

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | head -30
```
Expected: zero errors. `BarChart3`, `ChevronDown`, `Star` are already imported in the file.

## Commit

```bash
git add src/pages/NativeReportsCenter.tsx
git commit -m "feat(reports): add left panel sidebar component (not wired yet)"
```

## Global Constraints
- Only `src/pages/NativeReportsCenter.tsx` is modified
- Do NOT modify the `return (` block or any existing JSX yet — that is Task 3
- `leftPanel` is a `const` defined in the component body, not a separate component file

## Report
Write your full report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/reports-layout-task-2-report.md`

Return only: status (DONE/BLOCKED/NEEDS_CONTEXT), commit hash, one-line test summary, and any concerns.
