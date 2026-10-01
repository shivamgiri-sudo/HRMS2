/**
 * The shared drill-down drawer: every number on the attrition surfaces opens the people behind it here.
 * Right-side sheet, 60% of the viewport on >=640px (full width below). A row opens that person inside the
 * same drawer (Back returns to the list).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Download, MessageSquarePlus, Search } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { num, pct, SERIES } from "@/components/analytics/analytics-kit";
import { RaiseExitButton } from "@/components/exit/RaiseExitButton";
import { useHubDrill, useHubEmployee } from "./api";
import { ErrorCard, Shimmer, TIER_COLOR, TierChip, fmtAon, fmtDate } from "./charts";
import { ExitFacts, RiskDetail } from "./EmployeeView";
import FollowupPanel, { KIND_LABEL, OUTCOME_LABEL } from "./FollowupPanel";
import type { DrillQuery, DrillRow, HubDrill, Tier } from "./types";

export const DRAWER_CLS = "w-full sm:w-[60vw] sm:max-w-none gap-0 p-0 flex flex-col overflow-hidden bg-slate-50";

type SortKey = NonNullable<DrillQuery["sort"]>;

/** Employee-only sheet (Risk board rows). */
export function EmployeeSheet({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const q = useHubEmployee(employeeId);
  const r = q.data?.row;
  return (
    <Sheet open={!!employeeId} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className={DRAWER_CLS}>
        <SheetHeader className="shrink-0 space-y-0.5 border-b border-slate-200 bg-white px-5 py-4 pr-14">
          <SheetTitle className="truncate text-base">{r?.name ?? "Attrition risk"}</SheetTitle>
          <SheetDescription className="text-xs">
            {r ? <><span className="tabular-nums">{r.code}</span>{[r.designation, r.process, r.branch].filter(Boolean).map(v => ` · ${v}`).join("")}</> : "Why this person is flagged and what to do about it."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{employeeId && <RiskDetail employeeId={employeeId} />}</div>
      </SheetContent>
    </Sheet>
  );
}

export default function DrillDrawer({ query, onClose }: { query: DrillQuery | null; onClose: () => void }) {
  // keep the last query rendered while the close animation runs
  const last = useRef<DrillQuery | null>(null);
  if (query) last.current = query;
  const shown = query ?? last.current;
  return (
    <Sheet open={!!query} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className={DRAWER_CLS}>
        {shown && <DrillBody key={JSON.stringify(shown)} query={shown} />}
      </SheetContent>
    </Sheet>
  );
}

function mixColor(label: string, i: number): string {
  const up = label.toUpperCase();
  if (up in TIER_COLOR) return TIER_COLOR[up as Tier];
  return [SERIES[0], SERIES[1], SERIES[3], SERIES[2], SERIES[6], SERIES[4]][i % 6];
}

function MixBar({ mix }: { mix: HubDrill["mix"] }) {
  const total = mix.reduce((s, m) => s + m.value, 0);
  if (total <= 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div role="img" aria-label={`Mix: ${mix.map(m => `${m.label} ${m.value}`).join(", ")}`} className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {mix.map((m, i) => m.value > 0 && (
          <div key={m.label} title={`${m.label}: ${num(m.value)}`} style={{ width: `${(m.value / total) * 100}%`, background: mixColor(m.label, i) }} className="h-full border-r border-white last:border-r-0 motion-safe:transition-[width] motion-safe:duration-500" />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {mix.map((m, i) => (
          <li key={m.label} className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: mixColor(m.label, i) }} />{m.label} <strong className="tabular-nums text-slate-900">{num(m.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(rows: DrillRow[], active: boolean, title: string) {
  const head = active
    ? ["Code", "Name", "Designation", "Process", "Branch", "Manager", "Tier", "Score", "30-day chance %", "Top reason", "Absent streak", "Last follow-up", "Tenure days"]
    : ["Code", "Name", "Designation", "Process", "Branch", "Manager", "Join date", "Exit date", "Tenure days", "Reason", "Exit type", "Status"];
  const body = rows.map(r => active
    ? [r.code, r.name, r.designation, r.process, r.branch, r.manager, r.tier, r.score, r.probability30 == null ? "" : (r.probability30 * 100).toFixed(1), r.topReason, r.absentStreak, r.lastFollowup ? `${KIND_LABEL[r.lastFollowup.kind]} / ${OUTCOME_LABEL[r.lastFollowup.outcome]} (${r.lastFollowup.at})` : "", r.aonDays]
    : [r.code, r.name, r.designation, r.process, r.branch, r.manager, r.joinDate, r.exitDate, r.tenureDays ?? r.aonDays, r.reason, r.exitType, r.status]);
  const csv = [head, ...body].map(l => l.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "people"}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DrillBody({ query }: { query: DrillQuery }) {
  const active = query.population === "active";
  const [search, setSearch] = useState(query.q ?? "");
  const [dq, setDq] = useState(query.q ?? "");
  const [sort, setSort] = useState<SortKey>(query.sort ?? (active ? "score" : "date"));
  const [view, setView] = useState<DrillRow | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setDq(search.trim()), 350); return () => clearTimeout(t); }, [search]);

  const effective = useMemo<DrillQuery>(() => ({ ...query, q: dq || undefined, sort }), [query, dq, sort]);
  const q = useHubDrill(effective);
  const pages = q.data?.pages ?? [];
  const rows = useMemo(() => pages.flatMap(p => p.rows), [pages]);
  const first = pages[0];
  const total = first?.total ?? 0;
  const title = query.title || "People";
  const sortOpts: { v: SortKey; l: string }[] = active
    ? [{ v: "score", l: "Highest risk" }, { v: "aon", l: "Tenure" }, { v: "name", l: "Name" }]
    : [{ v: "date", l: "Most recent" }, { v: "aon", l: "Tenure" }, { v: "name", l: "Name" }];

  const cols = active ? ["Employee", "Tier", "Score", "30-day chance", "Top reason", "Absent", "Last follow-up", ""] : ["Employee", "Joined", "Left", "Tenure", "Reason", "Exit type", "Status"];
  const th = "whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500";

  return (
    <>
      <SheetHeader className="shrink-0 space-y-0.5 border-b border-slate-200 bg-white px-5 py-4 pr-14">
        {view ? (
          <div className="flex items-start gap-3">
            <button type="button" onClick={() => setView(null)} aria-label="Back to the list"
              className="mt-0.5 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
            </button>
            <div className="min-w-0">
              <SheetTitle className="truncate text-base">{view.name}</SheetTitle>
              <SheetDescription className="truncate text-xs"><span className="tabular-nums">{view.code}</span>{[view.designation, view.process, view.branch].filter(Boolean).map(v => ` · ${v}`).join("")}</SheetDescription>
            </div>
          </div>
        ) : (
          <>
            <SheetTitle className="truncate text-base">{title}</SheetTitle>
            <SheetDescription className="text-xs">{first ? `${num(total)} ${total === 1 ? "person" : "people"} in this slice` : "Loading the people behind this number"}</SheetDescription>
          </>
        )}
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {view ? (
          view.status === "left" ? <ExitFacts row={view} /> : <RiskDetail employeeId={view.employeeId} fallback={view} />
        ) : (
          <div className="space-y-4">
            {q.isLoading && <div className="space-y-3" aria-busy="true"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map(i => <Shimmer key={i} className="h-16" />)}</div><Shimmer className="h-14" /><Shimmer className="h-64" /></div>}
            {q.error && !first && <ErrorCard what="these people" error={q.error} onRetry={() => q.refetch()} />}
            {first && (
              <>
                {first.summary.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {first.summary.slice(0, 4).map(s => (
                      <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{s.label}</div>
                        <div className="mt-1 truncate text-xl font-bold tabular-nums text-slate-900" title={s.value}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
                <MixBar mix={first.mix} />
              </>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search by name or employee code" placeholder="Search name or code"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-300" />
              </div>
              <label className="sr-only" htmlFor="drill-sort">Sort</label>
              <select id="drill-sort" value={sort} onChange={e => setSort(e.target.value as SortKey)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-slate-400 focus:outline-none">
                {sortOpts.map(o => <option key={o.v} value={o.v}>Sort: {o.l}</option>)}
              </select>
              <button type="button" disabled={rows.length === 0} onClick={() => downloadCsv(rows, active, title)}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50">
                <Download className="h-3.5 w-3.5" aria-hidden /> Download CSV
              </button>
            </div>

            {first && (
              <div className={`overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm ${q.isFetching && !q.isFetchingNextPage ? "opacity-70" : ""}`}>
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <caption className="sr-only">{title}</caption>
                  <thead className="bg-slate-50"><tr className="border-b border-slate-200">{cols.map(c => <th key={c} scope="col" className={th}>{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <RowGroup key={r.employeeId} r={r} active={active} cols={cols.length} logOpen={logId === r.employeeId}
                        onOpen={() => setView(r)} onLog={() => setLogId(logId === r.employeeId ? null : r.employeeId)} />
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="py-10 text-center text-sm text-slate-400">No people match{dq ? ` "${dq}"` : " this slice"}.</div>}
              </div>
            )}

            {first && rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span className="tabular-nums">Showing {num(rows.length)} of {num(total)}</span>
                {q.hasNextPage && (
                  <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-60">
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden /> {q.isFetchingNextPage ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function RowGroup({ r, active, cols, logOpen, onOpen, onLog }: { r: DrillRow; active: boolean; cols: number; logOpen: boolean; onOpen: () => void; onLog: () => void }) {
  const td = "px-3 py-2.5 align-middle";
  return (
    <>
      <tr tabIndex={0} role="button" aria-label={`Open details for ${r.name}`} onClick={onOpen}
        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
        className="cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400">
        <td className={`${td} max-w-[230px]`}>
          <div className="truncate font-semibold text-slate-900">{r.name}</div>
          <div className="truncate text-[11px] text-slate-500"><span className="tabular-nums">{r.code}</span>{r.process ? ` · ${r.process}` : ""}{r.branch ? ` · ${r.branch}` : ""}</div>
        </td>
        {active ? (
          <>
            <td className={td}>{r.tier ? <TierChip tier={r.tier} /> : <span className="text-xs text-slate-400">{r.status === "notice" ? "In notice" : "-"}</span>}</td>
            <td className={`${td} font-bold tabular-nums text-slate-900`}>{r.score != null ? Math.round(r.score) : "-"}</td>
            <td className={`${td} tabular-nums text-slate-700`}>{r.probability30 == null ? <span className="text-slate-400">n/a</span> : pct(r.probability30 * 100)}</td>
            <td className={`${td} max-w-[200px]`}><span className="line-clamp-2 text-xs text-slate-700">{r.topReason || "-"}</span></td>
            <td className={`${td} tabular-nums`}>{r.absentStreak ? <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.absentStreak >= 3 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>{r.absentStreak}d</span> : <span className="text-slate-400">0</span>}</td>
            <td className={`${td} text-xs text-slate-600`}>
              {r.lastFollowup ? <div><div className="font-semibold text-slate-800">{OUTCOME_LABEL[r.lastFollowup.outcome]}</div><div className="text-[11px] text-slate-500">{KIND_LABEL[r.lastFollowup.kind]} · {fmtDate(r.lastFollowup.at)}</div></div> : <span className="text-slate-400">None</span>}
            </td>
            <td className={`${td} whitespace-nowrap`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-expanded={logOpen} aria-label={`Log outcome for ${r.name}`} onClick={e => { e.stopPropagation(); onLog(); }}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
                  <MessageSquarePlus className="h-3 w-3" aria-hidden /> Log outcome
                </button>
                <RaiseExitButton compact employee={{ id: r.employeeId, name: r.name, code: r.code, process: r.process, branch: r.branch, reportingManager: r.manager }} />
              </div>
            </td>
          </>
        ) : (
          <>
            <td className={`${td} whitespace-nowrap text-xs tabular-nums text-slate-600`}>{fmtDate(r.joinDate)}</td>
            <td className={`${td} whitespace-nowrap text-xs tabular-nums text-slate-600`}>{fmtDate(r.exitDate)}</td>
            <td className={`${td} whitespace-nowrap text-xs tabular-nums text-slate-700`}>{fmtAon(r.tenureDays ?? r.aonDays)}</td>
            <td className={`${td} max-w-[200px]`}><span className="line-clamp-2 text-xs text-slate-700">{r.reason || <span className="text-slate-400">Not recorded</span>}</span></td>
            <td className={`${td} text-xs capitalize text-slate-700`}>{r.exitType || <span className="text-slate-400">-</span>}</td>
            <td className={td}><span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${r.status === "left" ? "border-slate-200 bg-slate-100 text-slate-600" : r.status === "notice" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{r.status === "left" ? "Left" : r.status === "notice" ? "Notice" : "Active"}</span></td>
          </>
        )}
      </tr>
      {logOpen && (
        <tr className="border-b border-slate-100 bg-slate-50/70"><td colSpan={cols} className="px-4 py-3"><FollowupPanel employeeId={r.employeeId} compact onLogged={onLog} /></td></tr>
      )}
    </>
  );
}
