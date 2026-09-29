import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, AlertTriangle, Banknote, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Clock, Mail, Phone, Search, ShieldCheck, Ticket, UserCheck, X } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hrmsApi } from "@/lib/hrmsApi";
import { useCandidateJourney, usePipeline, type PipelineFilters, type PipelineRow } from "@/hooks/useAtsDashboards";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { DashboardFrame, Hero } from "@/components/ats/overview/shell";
import { Empty, MiniStat, Panel, V, fmt } from "@/components/ats/overview/viz";
import { Journey, StatusPill, isoDay, waited } from "@/components/ats/overview/journey";

const RANGES = [{ k: "today", label: "Today", from: () => isoDay(0) }, { k: "7d", label: "7D", from: () => isoDay(6) }, { k: "30d", label: "30D", from: () => isoDay(29) }, { k: "all", label: "All", from: () => "" }];

export default function NativeATSDashboardV2() {
  const qc = useQueryClient();
  const [range, setRange] = useState("30d");
  const [f, setF] = useState<PipelineFilters>({ from: isoDay(29), to: "", branch: "", process: "", status: "", stage: "", search: "", includeLeads: false, page: 1 });
  const [searchText, setSearchText] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isLoading, isFetching, isError, error, refetch } = usePipeline(f);
  const { data: ov } = useAtsOverview("90d", "");

  useEffect(() => { const t = setTimeout(() => setF((p) => (p.search === searchText.trim() ? p : { ...p, search: searchText.trim(), page: 1 })), 350); return () => clearTimeout(t); }, [searchText]);
  const set = (patch: Partial<PipelineFilters>) => setF((p) => ({ ...p, ...patch, page: 1 }));
  const pickRange = (k: string) => { setRange(k); set({ from: RANGES.find((r) => r.k === k)!.from() }); };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const stat = (name: string) => data?.statuses.find((s) => s.name === name)?.n ?? 0;
  const stale = useMemo(() => (data?.rows ?? []).filter((r) => r.status === "Waiting" && Date.now() - new Date(r.created_at).getTime() > 120 * 60000).length, [data]);
  const branches = ov?.branches.map((b) => b.name).filter((n) => n !== "Unspecified" && n !== "Unmapped") ?? [];
  const processes = ov?.processes.map((p) => p.name).filter((n) => n !== "Unspecified" && n !== "Unmapped") ?? [];
  const activeFilters = [f.branch, f.process, f.status, f.stage, f.search].filter(Boolean).length;

  const sel = "h-10 w-full border-border bg-background";
  return (
    <DashboardLayout>
      <DashboardFrame hero={
        <Hero eyebrow="Talent Acquisition" title="Candidate Pipeline" active="Pipeline" fetching={isFetching} onRefresh={() => void refetch()}
          subtitle="Search, filter and open any candidate's full journey"
          controls={<div className="inline-flex rounded-xl bg-white/10 p-1 backdrop-blur" role="group" aria-label="Date range">{RANGES.map((r) => (
            <button key={r.k} onClick={() => pickRange(r.k)} aria-pressed={range === r.k} className={`min-h-[36px] min-w-[44px] cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${range === r.k ? "bg-white text-[#0b2a5b] shadow" : "text-blue-50 hover:bg-white/15"}`}>{r.label}</button>))}</div>} />
      }>
        {(drill) => (<>
        {isError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not load candidates: {(error as Error)?.message}</div>}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MiniStat i={0} label="In this view" icon={<CircleDot className="h-4 w-4" />} color={V.blue} value={data ? fmt(data.total) : <Skeleton className="h-8 w-16" />} sub={activeFilters ? `${activeFilters} filter(s) applied` : "All engaged candidates"} />
          <MiniStat onClick={() => set({ status: "Selected" })} i={1} label="Selected" icon={<CheckCircle2 className="h-4 w-4" />} color={V.aqua} value={fmt(stat("Selected"))} sub="Ready for offer / onboarding" />
          <MiniStat onClick={() => set({ status: "Rejected" })} i={2} label="Rejected + no-show" icon={<X className="h-4 w-4" />} color={V.orange} value={fmt(stat("Rejected") + stat("No Show"))} sub={`${fmt(stat("No Show"))} no-shows`} />
          <MiniStat i={3} label="Waiting over 2h" icon={<Clock className="h-4 w-4" />} color={V.red} value={fmt(stale)} sub="On this page, not yet attended" />
        </div>

        <Panel i={4} title="Stage" hint="Click a stage to filter the list" icon={<CircleDot className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => set({ stage: "" })} aria-pressed={!f.stage} className={`cursor-pointer rounded-xl border px-3 py-2 text-left text-xs transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!f.stage ? "border-primary bg-primary/10" : "hover:bg-muted"}`}><div className="font-semibold">All stages</div><div className="tabular-nums text-muted-foreground">{fmt(data?.stages.reduce((a, s) => a + s.n, 0) ?? 0)}</div></button>
            {data?.stages.map((s) => (
              <button key={s.name} onClick={() => set({ stage: f.stage === s.name ? "" : s.name })} aria-pressed={f.stage === s.name} className={`cursor-pointer rounded-xl border px-3 py-2 text-left text-xs transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${f.stage === s.name ? "border-primary bg-primary/10" : "hover:bg-muted"}`}><div className="max-w-[150px] truncate font-semibold">{s.name}</div><div className="tabular-nums text-muted-foreground">{fmt(s.n)}</div></button>
            ))}
          </div>
        </Panel>

        <Panel i={5} title="Candidates" icon={<UserCheck className="h-4 w-4" />}
          right={<div className="flex items-center gap-1"><Button variant="outline" size="sm" onClick={() => drill.openDrill("Pipeline view", { from: f.from || undefined, to: f.to || undefined, branch: f.branch || undefined, process: f.process || undefined, status: f.status || undefined, stage: f.stage || undefined, search: f.search || undefined })}><BarChart3 className="mr-1.5 h-4 w-4" aria-hidden />Analyze this view</Button>{activeFilters > 0 && <Button variant="ghost" size="sm" onClick={() => { setSearchText(""); set({ branch: "", process: "", status: "", stage: "", search: "" }); }}>Clear filters</Button>}</div>}>
          <div className="mb-3 grid gap-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <label className="relative"><span className="sr-only">Search candidates</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Name, mobile, candidate code or token" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>
            <Select value={f.branch || "all"} onValueChange={(v) => set({ branch: v === "all" ? "" : v })}><SelectTrigger className={sel} aria-label="Branch"><SelectValue placeholder="All branches" /></SelectTrigger><SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={f.process || "all"} onValueChange={(v) => set({ process: v === "all" ? "" : v })}><SelectTrigger className={sel} aria-label="Process"><SelectValue placeholder="All processes" /></SelectTrigger><SelectContent><SelectItem value="all">All processes</SelectItem>{processes.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
            <Select value={f.status || "all"} onValueChange={(v) => set({ status: v === "all" ? "" : v })}><SelectTrigger className={sel} aria-label="Status"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{data?.statuses.map((s) => <SelectItem key={s.name} value={s.name}>{s.name} ({fmt(s.n)})</SelectItem>)}</SelectContent></Select>
          </div>

          <div className={`overflow-x-auto rounded-xl border transition-opacity duration-200 ${isFetching ? "opacity-70" : ""}`}>
            <table className="w-full min-w-[860px] text-sm text-card-foreground">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2.5 font-medium">Candidate</th><th className="px-3 font-medium">Stage</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Branch · process</th><th className="px-3 font-medium">Recruiter</th><th className="px-3 text-right font-medium">Age</th></tr></thead>
              <tbody>
                {isLoading ? Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-t"><td colSpan={6} className="p-2"><Skeleton className="h-9" /></td></tr>)
                  : !data?.rows.length ? <tr><td colSpan={6}><Empty text="No candidates match these filters" /></td></tr>
                  : data.rows.map((r: PipelineRow) => (
                    <tr key={r.id} tabIndex={0} role="button" aria-label={`Open ${r.full_name}`} onClick={() => setOpenId(r.id)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpenId(r.id)}
                      className="cursor-pointer border-t transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                      <td className="px-3 py-2.5"><div className="font-medium">{r.full_name}</div><div className="text-xs text-muted-foreground">{r.mobile} · {r.candidate_code}</div></td>
                      <td className="px-3 text-xs">{r.stage}</td><td className="px-3"><StatusPill status={r.status} /></td>
                      <td className="px-3 text-xs"><div>{r.branch}</div><div className="text-muted-foreground">{r.process ?? "-"}</div></td>
                      <td className="px-3 text-xs">{r.recruiter || "Unassigned"}</td><td className="px-3 text-right text-xs tabular-nums text-muted-foreground">{waited(r.created_at)}</td>
                    </tr>))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>{data ? `${fmt((f.page - 1) * data.limit + (data.rows.length ? 1 : 0))}–${fmt((f.page - 1) * data.limit + data.rows.length)} of ${fmt(data.total)}` : ""}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" disabled={f.page <= 1} onClick={() => setF((p) => ({ ...p, page: p.page - 1 }))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-2 tabular-nums">Page {f.page} / {pages}</span>
              <Button variant="outline" size="icon" className="h-9 w-9" disabled={f.page >= pages} onClick={() => setF((p) => ({ ...p, page: p.page + 1 }))} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </Panel>
        </>)}
      </DashboardFrame>
      {openId && <Journey id={openId} onClose={() => setOpenId(null)} onChanged={() => { void qc.invalidateQueries({ queryKey: ["ats-pipeline"] }); void qc.invalidateQueries({ queryKey: ["ats-journey", openId] }); }} />}
    </DashboardLayout>
  );
}
