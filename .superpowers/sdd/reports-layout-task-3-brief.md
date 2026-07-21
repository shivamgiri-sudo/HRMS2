# Task 3 Brief: Restructure return JSX — two-column layout

## Context
Task 3 of 4. Tasks 1–2 are done:
- `selectedCat`/`setSelectedCat` state exists (was `expandedCat`)
- `leftPanel` JSX const is defined just above `return (`

Now restructure the `return (...)` body to a two-column layout.

## What to change

### Change 1: Update `selectReport` function

Find the `selectReport` function (around line 378 in the current file) and add `setSelectedCat(r.category)` to it.

Current:
```tsx
  function selectReport(r: ReportDef) {
    setSelectedReport(r);
    setRows([]);
    setRunError("");
    setFilterValues({});
    // Track recent
    const next = [r.code, ...recentCodes.filter(c => c !== r.code)].slice(0, 8);
    setRecentCodes(next);
    saveList(LS_RECENT, next);
    // Scroll to runner
    setTimeout(() => runnerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }
```

Replace with:
```tsx
  function selectReport(r: ReportDef) {
    setSelectedReport(r);
    setSelectedCat(r.category);
    setRows([]);
    setRunError("");
    setFilterValues({});
    const next = [r.code, ...recentCodes.filter(c => c !== r.code)].slice(0, 8);
    setRecentCodes(next);
    saveList(LS_RECENT, next);
    setTimeout(() => runnerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }
```

### Change 2: Replace the entire main content section in `return (...)`

Inside the `return (` block, after the `<style>{...}</style>` block, find this entire section:

```tsx
      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <div className="space-y-6">
```

...and everything inside it down to and including its closing `</div>` (which comes just before `</HrmsModernShell>`).

Replace the entire block with:

```tsx
      {/* ── Two-column layout ─────────────────────────────────────────── */}
      <div className="flex min-h-0 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">

        {/* Left panel */}
        {leftPanel}

        {/* Right content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">

          {/* Stats tiles */}
          <div className="grid gap-4 md:grid-cols-3">
            <HrmsBentoTile
              title="Reports"
              value={animatedTotal}
              detail="Across HR, payroll, ATS, WFM, and compliance"
              icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
              accentClassName="from-blue-600 to-cyan-500"
            />
            <HrmsBentoTile
              title="Categories"
              value={animatedCats}
              detail="Grouped as tiles for faster scanning"
              icon={<Layers className="h-5 w-5 text-violet-600" />}
              accentClassName="from-violet-500 to-purple-600"
            />
            <HrmsBentoTile
              title="Favourites"
              value={animatedFavs}
              detail={favCount > 0 ? "Saved for quick launch" : "Star reports to pin them here"}
              icon={<Star className="h-5 w-5 text-amber-500" fill={favCount > 0 ? "currentColor" : "none"} />}
              accentClassName="from-amber-500 to-orange-500"
            />
          </div>

          {/* Recent bar */}
          {recentReports.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <Clock size={13} className="text-slate-400 flex-shrink-0" />
              {recentReports.slice(0, 8).map(r => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => selectReport(r)}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                >
                  {r.name.length > 28 ? r.name.slice(0, 28) + "..." : r.name}
                </button>
              ))}
            </div>
          )}

          {/* No category selected — prompt */}
          {!selectedCat && !selectedReport && !searchResults && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center shadow-sm">
              <BarChart3 size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm text-slate-400 font-medium">← Select a category from the left panel to browse reports</p>
            </div>
          )}

          {/* Favourites (no report selected, has favs, no search) */}
          {!selectedReport && favCodes.size > 0 && !searchResults && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Star size={12} className="text-yellow-400" fill="currentColor" /> Favourites
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from(favCodes).map(code => {
                  const r = CATALOG.find(x => x.code === code);
                  return r ? (
                    <button key={code} type="button" onClick={() => selectReport(r)}
                      className="text-xs px-3 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg hover:bg-yellow-100 font-medium transition-colors">
                      {r.name}
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {/* Category report list (when category selected, no specific report running) */}
          {selectedCat && !searchResults && grouped[selectedCat] && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
              {(() => {
                const grad = CATEGORY_GRADIENTS[selectedCat];
                return (
                  <div className={`h-1.5 bg-gradient-to-r ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"}`} />
                );
              })()}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                {(() => {
                  const grad = CATEGORY_GRADIENTS[selectedCat];
                  const Icon = grad?.icon ?? BarChart3;
                  return (
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"} flex items-center justify-center shadow-sm`}>
                      <Icon size={15} className="text-white" />
                    </div>
                  );
                })()}
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-slate-800">{selectedCat}</h2>
                  <p className="text-xs text-slate-400">{grouped[selectedCat].length} reports</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                {Array.from(new Set(grouped[selectedCat].map(r => r.subcategory))).map(sub => {
                  const subReports = grouped[selectedCat].filter(r => r.subcategory === sub);
                  return (
                    <div key={sub}>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{sub}</p>
                      <div className="flex flex-wrap gap-2">
                        {subReports.map(r => (
                          <button
                            key={r.code}
                            type="button"
                            onClick={() => selectReport(r)}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                              selectedReport?.code === r.code
                                ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-300"
                                : "bg-gray-50 text-gray-700 hover:bg-blue-50 hover:text-blue-700 border border-gray-100"
                            }`}
                          >
                            {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                            {r.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search results list (when search active) */}
          {searchResults && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-800">Search Results ({searchResults.length})</h3>
                <button type="button" onClick={() => setSearchQ("")} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  <X size={12} /> Clear
                </button>
              </div>
              {searchResults.length === 0 ? (
                <p className="text-sm text-gray-400">No reports matching "{searchQ}"</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {searchResults.slice(0, 30).map(r => {
                    const grad = CATEGORY_GRADIENTS[r.category];
                    return (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => { selectReport(r); setSearchQ(""); }}
                        className={`text-left px-3 py-2.5 rounded-lg border transition-all hover:shadow-md ${
                          selectedReport?.code === r.code ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-gray-100 hover:border-gray-200 bg-white"
                        }`}
                      >
                        <p className="text-xs font-semibold text-gray-800 leading-snug">{r.name}</p>
                        <p className={`text-[10px] mt-1 font-medium bg-gradient-to-r ${grad?.from ?? "from-gray-500"} ${grad?.to ?? "to-gray-600"} bg-clip-text text-transparent`}>
                          {r.category}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Runner Panel ─────────────────────────────────────────────── */}
          {selectedReport && (
            <div ref={runnerRef} className="animate-slide-up space-y-4">
              {/* Report Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const grad = CATEGORY_GRADIENTS[selectedReport.category];
                        const Icon = grad?.icon ?? BarChart3;
                        return (
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad?.from ?? "from-gray-500"} ${grad?.to ?? "to-gray-600"} flex items-center justify-center shadow-sm`}>
                            <Icon size={16} className="text-white" />
                          </div>
                        );
                      })()}
                      <div>
                        <h2 className="text-base font-bold text-gray-900">{selectedReport.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{selectedReport.category} / {selectedReport.subcategory}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleFav(selectedReport.code)}
                        className={`p-2 rounded-lg border transition-colors ${
                          favCodes.has(selectedReport.code) ? "bg-yellow-50 border-yellow-200 text-yellow-500" : "bg-white border-gray-200 text-gray-400 hover:text-yellow-400"
                        }`}
                        title={favCodes.has(selectedReport.code) ? "Remove from favourites" : "Add to favourites"}
                      >
                        <Star size={14} fill={favCodes.has(selectedReport.code) ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedReport(null); setRows([]); setRunError(""); }}
                        className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Close report"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {selectedReport.requiresRunSelector && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                      <CheckCircle2 size={13} />
                      <span><span className="font-semibold">Tip:</span> This report uses payroll run data. Set the Month filter to the run month you want.</span>
                    </div>
                  )}
                </div>

                {/* Filter Row */}
                <div className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(!filtersOpen)}
                    className="md:hidden flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
                  >
                    <Filter size={14} />
                    Filters {activeFilterCount > 0 && `(${activeFilterCount} active)`}
                    <ChevronDown size={14} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
                  </button>

                  <div className={`${filtersOpen ? "" : "hidden md:block"}`}>
                    <div className="flex flex-wrap items-end gap-3">
                      {selectedReport.filters.map(def => {
                        const resolved = resolveFilterDef(def);
                        return (
                          <div key={def.key} className="space-y-1 w-full sm:w-auto sm:min-w-[140px] sm:max-w-[200px]">
                            <label className="block text-xs font-medium text-gray-500">{def.label}</label>
                            <FilterInput
                              def={resolved}
                              value={filterValues[def.key] ?? ""}
                              onChange={v => setFilter(def.key, v)}
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        disabled={running}
                        onClick={runReport}
                        className="flex items-center gap-2 px-5 h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 transition-colors shadow-sm"
                      >
                        {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Error */}
              {runError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2 animate-slide-up">
                  <X size={15} className="flex-shrink-0" />
                  <span>{runError} -- This report may not be implemented yet on the backend. It will be available in a future phase.</span>
                </div>
              )}

              {/* Results Table */}
              {rows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm animate-slide-up">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                        {rows.length.toLocaleString()} rows
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-gray-50 text-gray-600 rounded-full">
                        {columns.length} columns
                      </span>
                      {rows.length === 2000 && (
                        <span className="text-xs text-amber-600 font-medium">(limit reached -- export for full data)</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadXlsx(rows, `${selectedReport.code}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                    >
                      <Download size={14} /> Export XLSX
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {columns.map(col => (
                            <th key={col} className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.slice(0, 500).map((row, i) => (
                          <tr
                            key={i}
                            className={`hover:bg-blue-50/50 transition-colors animate-fade-row ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}
                            style={{ animationDelay: `${Math.min(i * 20, 400)}ms`, opacity: 0 }}
                          >
                            {columns.map(col => (
                              <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[220px] truncate" title={String(row[col] ?? "")}>
                                {row[col] == null ? <span className="text-gray-300">--</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && (
                      <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                        Showing 500 of {rows.length.toLocaleString()} rows in the table. Export XLSX to see all rows.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* No results yet */}
              {!running && !runError && rows.length === 0 && (
                <div className="bg-white rounded-xl border border-slate-200 py-14 text-center shadow-sm">
                  <BarChart3 size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400 font-medium">Set filters above and click Run to generate the report</p>
                </div>
              )}
            </div>
          )}

        </div>{/* end right content */}
      </div>{/* end two-column flex */}
```

The closing `</HrmsModernShell>` and `);` end of function remain unchanged.

## Verification

```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest
npx tsc --noEmit 2>&1 | head -40
```
Expected: zero errors.

## Commit

```bash
git add src/pages/NativeReportsCenter.tsx
git commit -m "feat(reports): two-column layout with persistent left category panel"
```

## Global Constraints
- Only `src/pages/NativeReportsCenter.tsx` is modified
- The old 4-column category card grid (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`) must be fully removed
- All existing functionality preserved: stats tiles, recent bar, favourites, runner, filter logic, XLSX export, search overlay

## Report
Write your full report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/reports-layout-task-3-report.md`

Return only: status (DONE/BLOCKED/NEEDS_CONTEXT), commit hash, one-line test summary, and any concerns.
