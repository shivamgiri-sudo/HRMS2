import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { ChartCard, EmptyState, num, pct } from "@/components/analytics/analytics-kit";
import { PAGE_SIZE, type PredictionFilters, useHubRisk } from "./api";
import { ErrorCard, FactorLegend, GROUP_LABEL, FactorStack, MiniBar, TIER_COLOR, TierChip, ToggleChip, fmtAon } from "./charts";
import { TIERS, type HubRisk, type RiskRow, type Tier } from "./types";

type Sort = NonNullable<PredictionFilters["sort"]>;

/** Resolve a human label for an id filter from whatever the response already carries. */
function labelFor(kind: "branch" | "process" | "manager", id: string, data?: HubRisk): string {
  const g = data?.groups[kind].find(x => x.id === id);
  if (g) return g.label;
  const r = data?.rows.find(x => (kind === "branch" ? x.branchId : kind === "process" ? x.processId : x.managerId) === id);
  const v = r && (kind === "branch" ? r.branch : kind === "process" ? r.process : r.manager);
  return v || `selected ${kind}`;
}

export default function RiskBoard({
  filters, setFilters, onOpen, onData,
}: {
  filters: PredictionFilters;
  setFilters: (f: PredictionFilters) => void;
  onOpen: (r: RiskRow) => void;
  onData?: (d: HubRisk | undefined) => void;
}) {
  const q = useHubRisk(filters);
  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => setSearch(filters.q ?? ""), [filters.q]);
  useEffect(() => { onData?.(q.data); }, [q.data, onData]);
  // debounce search typing
  useEffect(() => {
    if (search === (filters.q ?? "")) return;
    const t = setTimeout(() => setFilters({ ...filters, q: search || undefined, offset: 0 }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<PredictionFilters>) => setFilters({ ...filters, offset: 0, ...p });
  const d = q.data;
  const offset = filters.offset ?? 0;
  const sort: Sort = filters.sort ?? "score";
  const activeIds = (["branch", "process", "manager"] as const)
    .map(k => ({ k, id: filters[`${k}Id` as const] }))
    .filter(x => !!x.id) as { k: "branch" | "process" | "manager"; id: string }[];
  const anyFilter = !!(filters.tier || filters.group || activeIds.length || filters.q || filters.absentOnly || filters.newJoinerOnly);

  const sortHead = (s: Sort, label: string, align = "text-left") => (
    <th scope="col" aria-sort={sort === s ? (s === "name" ? "ascending" : "descending") : "none"} className={`px-3 py-2 ${align}`}>
      <button type="button" onClick={() => patch({ sort: s })} className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
        {label}{sort === s && (s === "name" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
      </button>
    </th>
  );
  const plainHead = (label: string, align = "text-left") => (
    <th scope="col" className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 ${align}`}>{label}</th>
  );

  return (
    <ChartCard
      title="Risk board"
      subtitle="Everyone in scope, ranked by risk score. Open a row to see why, and what to do."
      action={d && <span className="text-[11px] tabular-nums text-slate-500">{num(d.total)} {d.total === 1 ? "person" : "people"}</span>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {TIERS.map((t: Tier) => (
            <ToggleChip key={t} active={filters.tier === t} onClick={() => patch({ tier: filters.tier === t ? undefined : t })}>
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: filters.tier === t ? "#fff" : TIER_COLOR[t] }} />
              {t[0] + t.slice(1).toLowerCase()}
              {d && <span className="tabular-nums opacity-80">{num(d.tierCounts[t] ?? 0)}</span>}
            </ToggleChip>
          ))}
          <ToggleChip active={!!filters.absentOnly} onClick={() => patch({ absentOnly: !filters.absentOnly || undefined })} title="People on an absence streak">Absent streak</ToggleChip>
          <ToggleChip active={!!filters.newJoinerOnly} onClick={() => patch({ newJoinerOnly: !filters.newJoinerOnly || undefined })} title="Joined 90 days ago or less">New joiners (≤90d)</ToggleChip>
          <div className="relative ml-auto w-full sm:w-60">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search by name or employee code" placeholder="Search name or code"
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300"
            />
          </div>
        </div>

        {(activeIds.length > 0 || anyFilter) && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filtered by:</span>
            {activeIds.map(a => (
              <button key={a.k} type="button" onClick={() => patch({ [`${a.k}Id`]: undefined })} aria-label={`Remove ${a.k} filter`}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100">
                <span className="capitalize text-slate-500">{a.k}:</span> {labelFor(a.k, a.id, d)} <X className="h-3 w-3" aria-hidden />
              </button>
            ))}
            {filters.group && (
              <button type="button" onClick={() => patch({ group: undefined })} aria-label="Remove signal filter"
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 font-semibold text-slate-700 hover:bg-slate-100">
                <span className="text-slate-500">Signal:</span> {GROUP_LABEL[filters.group]} <X className="h-3 w-3" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setFilters({ sort: filters.sort })} className="cursor-pointer font-semibold text-slate-500 underline hover:text-slate-800">Clear all</button>
          </div>
        )}

        <FactorLegend />

        {q.error && !d ? <ErrorCard what="the risk board" error={q.error} onRetry={() => q.refetch()} /> : (
          <div className={`overflow-x-auto rounded-lg border border-slate-100 ${q.isFetching ? "opacity-70" : ""}`} aria-busy={q.isFetching}>
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <caption className="sr-only">People ranked by attrition risk</caption>
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  {sortHead("name", "Employee")}
                  {plainHead("Tier")}
                  {sortHead("score", "Score")}
                  {plainHead("30-day chance", "text-right")}
                  {plainHead("Score breakdown")}
                  {plainHead("Top reasons")}
                  {sortHead("aon", "Tenure", "text-right")}
                </tr>
              </thead>
              <tbody>
                {q.isLoading && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-b border-slate-50"><td colSpan={7} className="px-3 py-3"><div className="h-4 rounded bg-slate-100" /></td></tr>
                ))}
                {d?.rows.map(r => (
                  <tr
                    key={r.employeeId} tabIndex={0} role="button" aria-label={`Open risk details for ${r.name}`}
                    onClick={() => onOpen(r)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(r); } }}
                    className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400"
                  >
                    <td className="max-w-[220px] px-3 py-2.5">
                      <div className="truncate font-semibold text-slate-900">{r.name}</div>
                      <div className="truncate text-[11px] text-slate-500"><span className="tabular-nums">{r.code}</span>{r.designation ? ` · ${r.designation}` : ""}{r.process ? ` · ${r.process}` : ""}</div>
                    </td>
                    <td className="px-3 py-2.5"><TierChip tier={r.tier} /></td>
                    <td className="w-28 px-3 py-2.5">
                      <div className="font-bold tabular-nums text-slate-900">{Math.round(r.score)}</div>
                      <MiniBar value={r.score} max={100} color={TIER_COLOR[r.tier]} height={4} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {r.probability30 === null ? <span title="Too few past cases in this tier to estimate" className="text-slate-400">n/a</span> : pct(r.probability30 * 100)}
                    </td>
                    <td className="w-44 px-3 py-2.5"><FactorStack factors={r.factors} /></td>
                    <td className="max-w-[260px] px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.reasons.slice(0, 3).map(x => (
                          <span key={x.label} title={x.detail} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">{x.label}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{fmtAon(r.aonDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d && d.rows.length === 0 && <EmptyState label="No people match these filters" hint="Remove a filter to widen the list." height={140} />}
          </div>
        )}

        {d && d.total > 0 && (
          <nav aria-label="Risk board pages" className="flex items-center justify-between text-xs text-slate-600">
            <span className="tabular-nums">{num(offset + 1)}–{num(Math.min(offset + PAGE_SIZE, d.total))} of {num(d.total)}</span>
            <div className="flex gap-1.5">
              <button type="button" disabled={offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, offset - PAGE_SIZE) })} aria-label="Previous page"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" disabled={offset + PAGE_SIZE >= d.total} onClick={() => setFilters({ ...filters, offset: offset + PAGE_SIZE })} aria-label="Next page"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </nav>
        )}
      </div>
    </ChartCard>
  );
}
