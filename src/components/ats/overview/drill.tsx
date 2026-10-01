import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, ChevronRight as Crumb, Layers, Lightbulb, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDrill, useDrillList, useLeads, type DrillFilters, type DrillSplit, type LeadFilters } from "@/hooks/useAtsDashboards";
import { Journey, StatusPill, waited } from "./journey";
import { BarRows, Empty, RateBar, V, fmt, tooltipStyle } from "./viz";
import { ExportButton, HeatTable, InsightList, downloadCsv } from "../cc/cc-viz";
import { buildDrillFindings } from "../cc/drill-insights";

/**
 * Drill-down engine. Any tile, chart segment or table row on the ATS dashboards calls openDrill() with a set of
 * filters; the drawer shows trend, splits and candidates for that slice, and every split row drills one level deeper.
 */
export interface DrillSpec { crumb: string; filters: DrillFilters }
export interface Actions { openDrill: (crumb: string, filters: DrillFilters) => void; openLeads: (crumb: string, filters: LeadFilters) => void; openCandidate: (id: string) => void }

const Ctx = createContext<Actions>({ openDrill: () => undefined, openLeads: () => undefined, openCandidate: () => undefined });
export const useDrillActions = () => useContext(Ctx);

const DOW = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KEY_LABEL: Record<string, string> = { branch: "Branch", process: "Process", source: "Source", recruiter: "Recruiter", status: "Status", stage: "Stage", outcome: "Outcome", gender: "Gender", idle: "Idle", experience: "Experience", education: "Education", shift: "Shift", age: "Age", voc: "Reason", interviewer: "Interviewer", search: "Search" };
const OUTCOME_LABEL: Record<string, string> = { selected: "Selected", rejected: "Rejected", noShow: "No-show", hold: "On hold", waiting: "Waiting", joined: "Joined", offered: "Offered" };
const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function chipText(k: string, v: unknown): string {
  if (k === "outcome") return `Outcome: ${OUTCOME_LABEL[String(v)] ?? v}`;
  if (k === "hour") return `Hour: ${v}:00`;
  if (k === "dow") return `Day: ${DOW[Number(v)]}`;
  if (k === "idle") return `Idle ${v}`;
  if (k === "age") return `Age ${v}–${Number(v) + 4}`;
  return `${KEY_LABEL[k] ?? k}: ${v}`;
}

export function DrillProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrillSpec[]>([]);
  const [leads, setLeads] = useState<{ crumb: string; filters: LeadFilters } | null>(null);
  const [candidate, setCandidate] = useState<string | null>(null);

  const openDrill = useCallback((crumb: string, filters: DrillFilters) => setStack([{ crumb, filters }]), []);
  const openLeads = useCallback((crumb: string, filters: LeadFilters) => setLeads({ crumb, filters }), []);
  const openCandidate = useCallback((id: string) => setCandidate(id), []);
  const actions = useMemo(() => ({ openDrill, openLeads, openCandidate }), [openDrill, openLeads, openCandidate]);

  return (
    <Ctx.Provider value={actions}>
      {children}
      {stack.length > 0 && <DrillSheet stack={stack} setStack={setStack} />}
      {leads && <LeadsSheet spec={leads} onClose={() => setLeads(null)} />}
      {candidate && <Journey id={candidate} onClose={() => setCandidate(null)} onChanged={() => undefined} />}
    </Ctx.Provider>
  );
}

function Stat({ label, value, sub, onClick, active }: { label: string; value: string; sub?: string; onClick?: () => void; active?: boolean }) {
  const cls = `rounded-xl border p-3 text-left transition-colors duration-200 ${active ? "border-primary bg-primary/10" : onClick ? "hover:bg-muted" : ""}`;
  const body = <><div className="text-xs text-muted-foreground">{label}</div><div className="text-xl font-semibold tabular-nums">{value}</div>{sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}</>;
  return onClick ? <button onClick={onClick} className={`${cls} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}>{body}</button> : <div className={cls}>{body}</div>;
}

const SPLITS = ["branch", "process", "source", "recruiter", "stage", "status"] as const;

function DrillSheet({ stack, setStack }: { stack: DrillSpec[]; setStack: (s: DrillSpec[]) => void }) {
  const { openCandidate } = useDrillActions();
  const cur = stack[stack.length - 1];
  const f = cur.filters;
  const [tab, setTab] = useState<(typeof SPLITS)[number]>("branch");
  const [page, setPage] = useState(1);
  const { data: d, isLoading, isFetching } = useDrill(f);
  const { data: list, isFetching: listFetching } = useDrillList(f, page);
  // The level above is the baseline for "In depth"; it is usually already cached because the user just came from it.
  const { data: parent } = useDrill(stack.length > 1 ? stack[stack.length - 2].filters : null);

  const push = (crumb: string, extra: DrillFilters) => { setPage(1); setStack([...stack, { crumb, filters: { ...f, ...extra } }]); };
  const removeKey = (k: string) => { const next = { ...f }; delete (next as Record<string, unknown>)[k]; setPage(1); setStack([...stack.slice(0, -1), { ...cur, filters: next }]); };
  const goTo = (i: number) => { setPage(1); setStack(stack.slice(0, i + 1)); };

  const chips = Object.entries(f).filter(([k, v]) => v !== undefined && v !== "" && k !== "from" && k !== "to");
  const availableTabs = SPLITS.filter((s) => !f[s as keyof DrillFilters]);
  const activeTab = availableTabs.includes(tab) ? tab : availableTabs[0];
  const splitRows = (d && activeTab ? d.splits[activeTab] : []) as DrillSplit[];
  const pages = list ? Math.max(1, Math.ceil(list.total / list.limit)) : 1;
  const k = d?.kpis;
  const findings = d ? buildDrillFindings(d, stack.length > 1 ? parent : null, activeTab) : [];
  const exportList = () => list && downloadCsv(`ats-${stack[stack.length - 1].crumb.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
    ["Candidate", "Code", "Branch", "Process", "Source", "Recruiter", "Stage", "Status", "Registered"],
    list.rows.map((r) => [r.full_name, r.candidate_code, r.branch, r.process, r.source, r.recruiter, r.stage, r.status, r.created_at?.slice(0, 10)]));

  return (
    <Sheet open onOpenChange={(o) => !o && setStack([])}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:w-[60vw] sm:max-w-[60vw]">
        <div className="ats-viz space-y-4 p-5 text-foreground">
          <SheetHeader className="space-y-2 text-left">
            <SheetTitle className="flex items-center gap-2 text-lg"><Layers className="h-5 w-5 text-primary" aria-hidden />{stack[0].crumb}</SheetTitle>
            <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1 text-xs">
              {stack.map((s, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <Crumb className="h-3 w-3 text-muted-foreground" aria-hidden />}
                  <button onClick={() => goTo(i)} disabled={i === stack.length - 1} aria-current={i === stack.length - 1 ? "page" : undefined}
                    className={`rounded px-1.5 py-0.5 ${i === stack.length - 1 ? "bg-primary/10 font-semibold text-primary" : "cursor-pointer text-muted-foreground hover:bg-muted"}`}>{i === 0 ? "Start" : s.crumb}</button>
                </span>
              ))}
            </nav>
            <div className="flex flex-wrap gap-1.5">
              {f.from && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">Since {f.from}{f.to ? ` to ${f.to}` : ""}</span>}
              {chips.map(([key, val]) => (
                <span key={key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] font-medium text-primary">{chipText(key, val)}
                  <button onClick={() => removeKey(key)} aria-label={`Remove ${chipText(key, val)}`} className="cursor-pointer rounded-full p-0.5 hover:bg-primary/20"><X className="h-3 w-3" /></button></span>
              ))}
            </div>
          </SheetHeader>

          {isLoading || !d || !k ? <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-52" /><Skeleton className="h-40" /></div> : (
            <div className={`space-y-4 transition-opacity duration-200 ${isFetching ? "opacity-70" : ""}`}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Candidates" value={fmt(k.total)} sub={k.total ? undefined : "No match"} />
                <Stat label="Selected" value={fmt(k.selected)} sub={`${k.selRate}%`} active={f.outcome === "selected"} onClick={f.outcome ? undefined : () => push("Selected", { outcome: "selected" })} />
                <Stat label="Rejected" value={fmt(k.rejected)} sub={`${k.rejRate}%`} active={f.outcome === "rejected"} onClick={f.outcome ? undefined : () => push("Rejected", { outcome: "rejected" })} />
                <Stat label="No-show" value={fmt(k.noShow)} sub={`${k.noShowRate}%`} active={f.outcome === "noShow"} onClick={f.outcome ? undefined : () => push("No-show", { outcome: "noShow" })} />
                <Stat label="On hold" value={fmt(k.hold)} onClick={f.outcome ? undefined : () => push("On hold", { outcome: "hold" })} />
                <Stat label="Waiting" value={fmt(k.waiting)} onClick={f.outcome ? undefined : () => push("Waiting", { outcome: "waiting" })} />
                <Stat label="Joined" value={fmt(k.joined)} sub={`${k.joinRate}% of selected`} onClick={f.outcome ? undefined : () => push("Joined", { outcome: "joined" })} />
                <Stat label="Selection rate" value={`${k.selRate}%`} sub="of candidates in view" />
              </div>

              {findings.length > 0 && (
                <section aria-label="In depth"><h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden />In depth <span className="text-xs font-normal text-muted-foreground">what stands out in this slice</span></h3>
                  <InsightList items={findings.map((x) => ({ tone: x.tone, title: x.title, body: x.body, onClick: x.drill ? () => push(x.drill!.crumb, x.drill!.extra) : undefined }))} />
                </section>
              )}

              <section aria-label="Trend"><h3 className="mb-1 text-sm font-semibold">{d.weekly ? "Weekly trend" : "Daily trend"}</h3>
                {d.trend.length > 1 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={d.trend} margin={{ left: -18, right: 6 }}>
                      <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="date" tick={tick} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} minTickGap={20} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                      <Area type="monotone" dataKey="total" name="Candidates" stroke={V.blue} fill={V.blue} fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="selected" name="Selected" stroke={V.aqua} fill={V.aqua} fillOpacity={0.15} strokeWidth={2} />
                      <Area type="monotone" dataKey="rejected" name="Rejected" stroke={V.orange} fill={V.orange} fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <Empty text="Not enough days to chart a trend" />}
              </section>

              {f.dow === undefined && (
                <section aria-label="Weekday pattern"><h3 className="mb-1 text-sm font-semibold">Weekday pattern <span className="text-xs font-normal text-muted-foreground">click a day to drill</span></h3>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={d.weekday.map((w) => ({ ...w, label: DOW[w.dow] }))} margin={{ left: -24 }}>
                      <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} formatter={(v: number, _n, item) => [`${v} candidates · ${(item.payload as { selRate: number }).selRate}% selected`, ""]} />
                      <Bar dataKey="total" fill={V.blue} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { dow?: number }) => p.dow && push(DOW[p.dow], { dow: p.dow })} />
                    </BarChart>
                  </ResponsiveContainer>
                </section>
              )}

              {availableTabs.length > 0 && (
                <section aria-label="Break down by"><div className="mb-2 flex flex-wrap items-center gap-1.5"><h3 className="mr-1 text-sm font-semibold">Break down by</h3>
                  {availableTabs.map((s) => <button key={s} onClick={() => setTab(s)} aria-pressed={activeTab === s} className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${activeTab === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"}`}>{s}</button>)}</div>
                  {splitRows.length ? (
                    <HeatTable rows={splitRows} max={25}
                      cols={[
                        { key: "total", label: "Candidates", get: (r) => r.total },
                        { key: "sel", label: "Selected %", get: (r) => r.selRate, format: (n) => `${n}%`, hue: "green" },
                        { key: "rej", label: "Rejected %", get: (r) => r.rejRate ?? (r.total ? Math.round((r.rejected / r.total) * 100) : 0), format: (n) => `${n}%`, invert: true, hue: "red" },
                        ...(splitRows.some((r) => r.noShowRate != null) ? [{ key: "ns", label: "No-show %", get: (r: DrillSplit) => r.noShowRate ?? 0, format: (n: number) => `${n}%`, invert: true, hue: "red" as const }] : []),
                        ...(splitRows.some((r) => r.joinRate != null) ? [{ key: "jn", label: "Joined %", get: (r: DrillSplit) => r.joinRate ?? 0, format: (n: number) => `${n}%`, hue: "green" as const }] : []),
                      ]}
                      onRow={(r) => push(r.name, { [activeTab!]: r.name } as DrillFilters)}
                      onCell={(r) => push(r.name, { [activeTab!]: r.name } as DrillFilters)} />
                  ) : <Empty text="Nothing to break down" />}
                </section>
              )}

              <section aria-label="Candidates"><h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Users className="h-4 w-4" aria-hidden />Candidates <span className="text-xs font-normal text-muted-foreground">click one for the full journey</span><span className="ml-auto"><ExportButton onClick={exportList} label="Export page" /></span></h3>
                <div className={`overflow-x-auto rounded-xl border transition-opacity duration-200 ${listFetching ? "opacity-70" : ""}`}>
                  <table className="w-full min-w-[520px] text-sm text-card-foreground"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Candidate</th><th className="px-3 font-medium">Stage</th><th className="px-3 font-medium">Status</th><th className="px-3 text-right font-medium">Age</th></tr></thead>
                    <tbody>{list?.rows.length ? list.rows.map((r) => (
                      <tr key={r.id} tabIndex={0} role="button" aria-label={`Open ${r.full_name}`} onClick={() => openCandidate(r.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openCandidate(r.id)} className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                        <td className="px-3 py-2"><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.branch} · {r.process ?? "-"}</div></td>
                        <td className="px-3 text-xs">{r.stage}</td><td className="px-3"><StatusPill status={r.status} /></td><td className="px-3 text-right text-xs tabular-nums text-muted-foreground">{waited(r.created_at)}</td></tr>))
                      : <tr><td colSpan={4}><Empty text="No candidates" /></td></tr>}</tbody></table>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{list ? `${fmt(list.total)} total` : ""}</span>
                  <div className="flex items-center gap-1"><Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><span className="px-1 tabular-nums">{page} / {pages}</span><Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div></div>
              </section>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LeadsSheet({ spec, onClose }: { spec: { crumb: string; filters: LeadFilters }; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(spec.filters);
  const { data, isLoading, isFetching } = useLeads(filters, page);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const chips = Object.entries(filters).filter(([, v]) => v);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:w-[60vw] sm:max-w-[60vw]">
        <div className="ats-viz space-y-3 p-5 text-foreground">
          <SheetHeader className="text-left"><SheetTitle className="flex items-center gap-2 text-lg"><Layers className="h-5 w-5 text-primary" aria-hidden />{spec.crumb}</SheetTitle></SheetHeader>
          <div className="flex flex-wrap gap-1.5">{chips.map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] font-medium capitalize text-primary">{k}: {v}
              <button onClick={() => { const n = { ...filters }; delete (n as Record<string, unknown>)[k]; setFilters(n); setPage(1); }} aria-label={`Remove ${k} filter`} className="cursor-pointer rounded-full p-0.5 hover:bg-primary/20"><X className="h-3 w-3" /></button></span>))}</div>
          {isLoading || !data ? <Skeleton className="h-64" /> : (
            <div className={`space-y-3 transition-opacity duration-200 ${isFetching ? "opacity-70" : ""}`}>
              <div className="text-sm"><b className="tabular-nums">{fmt(data.total)}</b> lead records</div>
              {data.statuses.length > 0 && <BarRows rows={data.statuses.map((s) => ({ label: s.name, value: s.n }))} color={V.violet} />}
              <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[520px] text-sm text-card-foreground"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Lead</th><th className="px-3 font-medium">Recruiter</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Date</th></tr></thead>
                <tbody>{data.rows.length ? data.rows.map((r, i) => (
                  <tr key={r.mobile + i} className="border-t"><td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.mobile} · {r.source}</div></td><td className="px-3 text-xs">{r.recruiter}</td>
                    <td className="px-3 text-xs">{r.status ?? "-"}{r.joining && <div className="text-muted-foreground">{r.joining}</div>}</td><td className="px-3 text-xs tabular-nums text-muted-foreground">{r.at ? new Date(r.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"}</td></tr>)) : <tr><td colSpan={4}><Empty text="No records" /></td></tr>}</tbody></table></div>
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground"><Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button><span className="px-1 tabular-nums">{page} / {pages}</span><Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button></div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
