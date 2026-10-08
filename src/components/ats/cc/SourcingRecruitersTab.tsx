import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Copy, Crown, Database, Filter, GitBranch, Layers3, Lightbulb, Phone, Radar as RadarIcon, Repeat, Send, Share2, Timer, Trophy, UserCheck, Users, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { useAtsInsights, useAtsSourcing, useDrill, useHiringTrend, useSourceRoi, useTimeToHire, type DrillFilters } from "@/hooks/useAtsDashboards";
import { useDrillActions } from "@/components/ats/overview/drill";
import { BarRows, Empty, RateBar, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { SourceTreemap } from "@/components/ats/overview/charts";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, RadarCompare, Section, Waterfall, downloadCsv, type InsightItem } from "./cc-kit";
import { useCC } from "./cc-context";
import { getHrmsApiErrorStatus } from "@/lib/hrmsApi";
import { CostPerHireCard } from "./CostPerHireCard";
import { DuplicateReview, cleanSuspects } from "./DuplicateReview";
import { useRecruiterNameSuspects, useReusablePool } from "@/hooks/useAtsCommandCenter";
import { RADAR_AXES, bestSource, isRawId, isUnowned, momentum, peerMedian, pct, radarValues, rankRecruiters, recruiterFindings, statsFromKpis, toStats } from "./sourcing-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const SERIES = [V.blue, V.aqua, V.orange, V.violet, V.yellow];
const STAGE_KEY: Record<string, string | undefined> = { Sourced: undefined, Contacted: "contacted", "Walked in": "walkin", Selected: "selected", Joined: "joined" };
const monthLabel = (m: unknown) => new Date(`${String(m)}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const P = (n: number) => `${n}%`;
const PODIUM = ["from-amber-400/25 to-amber-500/5", "from-slate-400/25 to-slate-500/5", "from-orange-500/25 to-orange-600/5"];

const NoteBox = ({ children }: { children: React.ReactNode }) => <div role="status" className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">{children}</div>;

export function SourcingRecruitersTab() {
  const cc = useCC();
  const act = useDrillActions();
  // Scoped roles (branch head, process manager) skip every org-wide aggregate: those endpoints refuse branch-limited roles, and the
  // panels that depend on them say so. Recruiter names, the leaderboard and the scorecard come from the row-scoped drill instead.
  // `on` = the org-wide-only endpoints (sourcing ledger, analytics, name review) may be called; branch-limited aggregate roles (hr, manager)
  // would only get a 403 from them. Overview and insights are branch-pinned aggregates, so they stay on for every non-scoped role.
  const on = cc.orgWide;
  const src = useAtsSourcing(cc.period, on);
  const ov = useAtsOverview(cc.period, cc.branch, !cc.scoped);
  const ins = useAtsInsights(cc.period, cc.branch, !cc.scoped);
  const roi = useSourceRoi(on), tth = useTimeToHire(on), hire = useHiringTrend(6, on);
  const go = (crumb: string, extra: DrillFilters = {}) => act.openDrill(crumb, cc.drill(extra));

  // Peer slice: the unfiltered-by-recruiter drill, whose recruiter split is the leaderboard and the peer baseline.
  const peerF = useMemo(() => { const f = { ...cc.drill() }; delete f.recruiter; return f; }, [cc.period, cc.branch, cc.process]); // eslint-disable-line react-hooks/exhaustive-deps
  const peer = useDrill(peerF);
  const [picked, setPicked] = useState(cc.recruiter);
  useEffect(() => { if (cc.recruiter) setPicked(cc.recruiter); }, [cc.recruiter]);
  const slice = useDrill(picked ? cc.drill({ recruiter: picked }) : null);
  const names = useRecruiterNameSuspects(on);
  const pool = useReusablePool(cc.drill());

  const d = src.data, o = ov.data;
  const recruiterNames = useMemo(() => Array.from(new Set([...(o?.recruiters ?? []).map((r) => r.name), ...(peer.data?.splits.recruiter ?? []).map((r) => r.name), ...(cc.recruiter ? [cc.recruiter] : [])])).filter((n) => n && n !== "Unspecified" && n !== "Unmapped" && n !== "Unassigned"), [o, peer.data, cc.recruiter]);
  const board = useMemo(() => {
    const rows = peer.data?.splits.recruiter?.length ? peer.data.splits.recruiter.map(toStats) : (o?.recruiters ?? []).map((r) => toStats({ ...r, total: r.total }));
    return rankRecruiters(rows.filter((r) => !isUnowned(r.name)));
  }, [peer.data, o]);
  const peers = useMemo(() => peerMedian(board), [board]);
  const me = slice.data && picked ? statsFromKpis(picked, slice.data.kpis) : null;
  const sources = d?.sources ?? [];
  const live = sources.filter((s) => s.name !== "Walk-in");
  const best = bestSource(live, (s) => s.sourced, (s) => s.yieldRate);
  const mom = useMemo(() => (d ? momentum(d.trend, d.seriesNames) : []), [d]);
  const lead = (crumb: string, f: Parameters<typeof act.openLeads>[1]) => act.openLeads(crumb, f);

  const findings: InsightItem[] = me ? recruiterFindings(me, peers).map((f) => ({
    tone: f.tone, title: f.title, body: f.body,
    onClick: () => go(`${picked}: ${f.title}`, { recruiter: picked, ...(f.key === "selection" ? { outcome: "selected" } : f.key === "join" ? { outcome: "joined" } : f.key === "showup" ? { outcome: "noShow" } : {}) }),
  })) : [];

  if (src.isLoading && ov.isLoading) return <div className="space-y-4"><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;
  const denied = cc.scoped || (cc.scopeKnown && !cc.orgWide) || src.isError;
  const t = d?.totals;

  return (
    <div className="space-y-5">
      <FilterBar show={["period", "recruiter"]} recruiters={recruiterNames}
        right={<span className="text-[11px] text-muted-foreground">{cc.branch || cc.process ? "Lead ledger is organisation-wide; drills honour branch and process" : "Lead ledger is organisation-wide"}</span>} />

      {denied && <NoteBox>The lead-sourcing ledger (sourced, contacted, referrers, duplicates) is limited to organisation-wide roles, so it is hidden for your access level. Everything below that comes from candidate records, recruiters and channels still works.</NoteBox>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        {t ? <>
          <KpiCard i={0} label="Leads sourced" value={t.sourced} icon={<Send className="h-4 w-4" />} color={V.blue} sub="excl. bulk walk-in import" onClick={() => lead("Leads sourced", { notSource: "Walk-in" })} />
          <KpiCard i={1} label="Contacted" value={t.contacted} sub={`${pct(t.contacted, t.sourced)}% of sourced`} icon={<Phone className="h-4 w-4" />} color={V.aqua} onClick={() => lead("Contacted leads", { notSource: "Walk-in", stage: "contacted" })} />
          <KpiCard i={2} label="Walked in" value={t.walkin} sub={`${pct(t.walkin, t.contacted)}% of contacted`} icon={<Users className="h-4 w-4" />} color={V.violet} onClick={() => lead("Walked-in leads", { notSource: "Walk-in", stage: "walkin" })} />
          <KpiCard i={3} label="Selected" value={t.selected} sub={`${pct(t.selected, t.sourced)}% of sourced`} icon={<UserCheck className="h-4 w-4" />} color={V.orange} onClick={() => lead("Selected leads", { notSource: "Walk-in", stage: "selected" })} />
          <KpiCard i={4} label="Joined" value={t.joined} sub={`${pct(t.joined, t.selected)}% of selected`} icon={<Crown className="h-4 w-4" />} color={V.yellow} onClick={() => lead("Joined leads", { notSource: "Walk-in", stage: "joined" })} />
          <KpiCard i={5} label="Best source" value={best?.yieldRate ?? 0} decimals={1} suffix="%" sub={best ? `${best.name} · ${fmt(best.sourced)} leads` : "No source with 10+ leads"} icon={<Trophy className="h-4 w-4" />} color={V.aqua} onClick={best ? () => go(`Source: ${best.name}`, { source: best.name }) : undefined} />
          <KpiCard i={6} label="Duplicate warnings" value={d?.duplicateWarnings ?? 0} sub={`${fmt(ins.data?.rewalkins ?? 0)} re-walk-ins`} icon={<Copy className="h-4 w-4" />} color={V.red} />
        </> : [0, 1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>

      <Section title="Source funnel" hint="Cells open the leads or candidates behind them">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-4" i={1} title="Sourced to joined" hint="Step bars show what each stage kept" icon={<Filter className="h-4 w-4" />}>
            {d ? <Waterfall steps={d.funnel.map((f) => ({ key: f.stage, label: f.stage, n: f.n }))} onStep={(k) => lead(k, { notSource: "Walk-in", stage: STAGE_KEY[k] })} /> : <Skeleton className="h-52" />}
          </Card>
          <Card className="lg:col-span-8" i={2} title="Funnel by source" hint="Top eight live sources by volume" icon={<GitBranch className="h-4 w-4" />}>
            {live.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={live.slice(0, 8)} margin={{ left: -10, right: 6 }}>
                  <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} interval={0} /><YAxis tick={tick} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  {(["sourced", "contacted", "walkin", "selected", "joined"] as const).map((k, i) => (
                    <Bar key={k} dataKey={k} name={k === "walkin" ? "Walked in" : k[0].toUpperCase() + k.slice(1)} fill={SERIES[i % 5]} radius={[4, 4, 0, 0]} className="cursor-pointer"
                      onClick={(p: { name?: string }) => p.name && lead(`${p.name} · ${k}`, { source: p.name, stage: k === "sourced" ? undefined : k })} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty text={denied ? "Lead ledger not available for your role" : "No sourced leads in this period"} />}
          </Card>
        </div>
        <Card i={3} title="Source ledger" hint="Contact, walk-in, yield (selected of sourced) and join (joined of selected). Each column shaded on its own scale." icon={<Layers3 className="h-4 w-4" />}
          right={d && <ExportButton onClick={() => downloadCsv("ats-source-ledger.csv", ["Source", "Sourced", "Contacted", "Walked in", "Selected", "Joined", "Contact %", "Walk-in %", "Yield %", "Join %"], sources.map((s) => [s.name, s.sourced, s.contacted, s.walkin, s.selected, s.joined, s.contactRate, s.walkinRate, s.yieldRate, s.joinRate]))} />}>
          <HeatTable rows={sources} max={20}
            cols={[
              { key: "n", label: "Sourced", get: (r) => r.sourced },
              { key: "c", label: "Contact %", get: (r) => r.contactRate, format: P, hue: "green" },
              { key: "w", label: "Walk-in %", get: (r) => r.walkinRate, format: P, hue: "green" },
              { key: "y", label: "Yield %", get: (r) => r.yieldRate, format: P, hue: "green" },
              { key: "j", label: "Join %", get: (r) => r.joinRate, format: P, hue: "green" },
            ]}
            onRow={(r) => go(`Source: ${r.name}`, { source: r.name })}
            onCell={(r, c) => c.key === "n" ? lead(`${r.name} · sourced`, { source: r.name }) : c.key === "c" ? lead(`${r.name} · contacted`, { source: r.name, stage: "contacted" })
              : go(`${r.name} · ${c.label}`, { source: r.name, ...(c.key === "y" ? { outcome: "selected" } : c.key === "j" ? { outcome: "joined" } : {}) })} />
        </Card>
      </Section>

      <Section title="Quality and momentum">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-4" i={4} title="Source quality" hint="Area is volume, colour is selection rate" icon={<Layers3 className="h-4 w-4" />}>
            {o ? <SourceTreemap data={o.sources} onSelect={(n) => go(`Source: ${n}`, { source: n })} /> : <Skeleton className="h-52" />}
          </Card>
          <Card className="lg:col-span-5" i={5} title="Leads over time" hint="Monthly leads by source, top five" icon={<GitBranch className="h-4 w-4" />}>
            {d?.trend.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.trend} margin={{ left: -10, right: 6 }}>
                  <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} tickFormatter={monthLabel} /><YAxis tick={tick} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} labelFormatter={monthLabel} /><Legend wrapperStyle={{ fontSize: 11 }} />
                  {d.seriesNames.map((n, i) => <Bar key={n} dataKey={n} stackId="s" fill={SERIES[i % 5]} stroke="hsl(var(--card))" strokeWidth={2} className="cursor-pointer" onClick={(p: { month?: string }) => p.month && lead(`${n} · ${monthLabel(p.month)}`, { source: n, month: p.month })} />)}
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty text="No monthly lead data" />}
          </Card>
          <Card className="lg:col-span-3" i={6} title="Source momentum" hint="Latest month vs the one before" icon={<Lightbulb className="h-4 w-4" />}>
            {mom.length ? <ul className="space-y-1">{mom.map((m) => (
              <li key={m.name}><button onClick={() => lead(m.name, { source: m.name })} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <span className="truncate font-medium">{m.name}</span>
                <span className={`cc-num text-xs font-semibold ${m.change == null ? "text-muted-foreground" : m.change >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>{fmt(m.prev)} to {fmt(m.last)}{m.change != null && ` (${m.change > 0 ? "+" : ""}${m.change}%)`}</span></button></li>))}</ul>
              : <Empty text="Need two months of data" />}
          </Card>
        </div>
      </Section>

      <Section title="Cost and time" hint="Analytics endpoints; small samples are stage-tracked hires only">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-5" i={7} title="Hires by channel" hint="Candidates, hires, conversion and days to hire" icon={<Wallet className="h-4 w-4" />}>
            {roi.data?.length ? (
              <HeatTable rows={roi.data.map((r) => ({ ...r, name: r.source_channel }))} max={12}
                cols={[
                  { key: "t", label: "Candidates", get: (r) => r.total_candidates }, { key: "h", label: "Hired", get: (r) => r.total_hired },
                  { key: "c", label: "Conv %", get: (r) => r.conversion_rate, format: P, hue: "green" },
                  { key: "d", label: "Days", get: (r) => r.avg_time_to_hire_days ?? 0, format: (n) => (n ? `${n}d` : "–"), invert: true, hue: "blue" },
                ]}
                onRow={(r) => go(`Source: ${r.name}`, { source: r.name })} onCell={(r, c) => go(`${r.name} · ${c.label}`, { source: r.name, ...(c.key === "h" ? { outcome: "joined" } : {}) })} />
            ) : <Empty text={roi.isLoading ? "Loading" : roi.isError ? "Not available for your role" : "No hires recorded"} />}
          </Card>
          <Card className="lg:col-span-4" i={8} title="Time to hire" hint="By role and by source, in days" icon={<Timer className="h-4 w-4" />}>
            {tth.data ? <>
              <div className="mb-3 grid grid-cols-3 gap-2 text-center">{([["Average", tth.data.overall_avg_days], ["Fastest", tth.data.fastest_hire_days], ["Slowest", tth.data.slowest_hire_days]] as const).map(([l, v]) => <div key={l} className="rounded-xl bg-muted/50 p-2"><div className="cc-num text-lg font-semibold">{v == null ? "–" : `${v}d`}</div><div className="text-[11px] text-muted-foreground">{l}</div></div>)}</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">By role</div><BarRows rows={tth.data.by_role.filter((r) => !isRawId(r.role)).slice(0, 5).map((r) => ({ label: r.role, value: r.avg_days }))} color={V.violet} format={(n) => `${n}d`} /></div>
                <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">By source</div><BarRows rows={tth.data.by_source.slice(0, 5).map((r) => ({ label: r.source, value: r.avg_days }))} color={V.aqua} format={(n) => `${n}d`} onSelect={(n) => go(`Source: ${n}`, { source: n, outcome: "joined" })} /></div>
              </div></> : <Empty text={tth.isLoading ? "Loading" : "Not available"} />}
          </Card>
          <Card className="lg:col-span-3" i={9} title="Hiring trend" hint="Registrations, interviews, selections" icon={<Layers3 className="h-4 w-4" />}>
            {hire.data?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={hire.data} margin={{ left: -16, right: 4 }}><CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} /><Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                  <Bar dataKey="registrations" fill={V.blue} radius={[3, 3, 0, 0]} /><Bar dataKey="interviews" fill={V.violet} radius={[3, 3, 0, 0]} /><Bar dataKey="selections" fill={V.aqua} radius={[3, 3, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            ) : <Empty text={hire.isLoading ? "Loading" : "Not available"} />}
          </Card>
        </div>
      </Section>

      <CostPerHireCard i={9} />

      <Section title="Recruiter leaderboard" hint="Ranked by selections; recruiters with fewer than five candidates are listed last">
        {peer.isLoading && !board.length ? <Skeleton className="h-64 rounded-2xl" /> : board.length ? (
          <div className="grid gap-4 lg:grid-cols-12">
            <div className="grid grid-cols-3 items-end gap-2 lg:col-span-5">
              {[1, 0, 2].map((idx) => { const r = board[idx]; if (!r || r.thin) return <div key={idx} />; return (
                <button key={r.name} onClick={() => go(r.name, { recruiter: r.name })} aria-label={`${r.name}, rank ${r.rank}`}
                  className={`cc-card cc-hot cursor-pointer bg-gradient-to-b p-3 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${PODIUM[idx]}`} style={{ minHeight: idx === 0 ? 210 : idx === 1 ? 180 : 160 }}>
                  <Trophy className="mx-auto h-5 w-5" style={{ color: [V.yellow, V.blue, V.orange][idx] }} aria-hidden />
                  <div className="cc-num mt-1 text-2xl font-semibold">#{r.rank}</div>
                  <div className="truncate text-sm font-semibold">{r.name}</div>
                  <div className="cc-num mt-1 text-xs text-muted-foreground">{fmt(r.selected)} selected · {r.selRate}%</div>
                  <div className="cc-num text-xs text-muted-foreground">{fmt(r.joined)} joined · {r.showUp}% show-up</div>
                </button>); })}
            </div>
            <Card className="lg:col-span-7" i={10} title="All recruiters" hint={`${board.length} in this view; click a name to open, a cell to drill`} icon={<Trophy className="h-4 w-4" />}
              right={<ExportButton onClick={() => downloadCsv("ats-recruiter-leaderboard.csv", ["Rank", "Recruiter", "Handled", "Selected", "Selected %", "Joined", "Join %", "Show-up %"], board.map((r) => [r.rank, r.name, r.handled, r.selected, r.selRate, r.joined, r.joinRate, r.showUp]))} />}>
              <HeatTable rows={board} max={board.length}
                cols={[
                  { key: "h", label: "Handled", get: (r) => r.handled }, { key: "s", label: "Selected", get: (r) => r.selected },
                  { key: "p", label: "Selected %", get: (r) => r.selRate, format: P, hue: "green" }, { key: "j", label: "Joined", get: (r) => r.joined },
                  { key: "u", label: "Show-up", get: (r) => r.showUp, format: P, hue: "green" },
                ]}
                onRow={(r) => { setPicked(r.name); go(r.name, { recruiter: r.name }); }}
                onCell={(r, c) => go(`${r.name} · ${c.label}`, { recruiter: r.name, ...(c.key === "s" || c.key === "p" ? { outcome: "selected" } : c.key === "j" ? { outcome: "joined" } : c.key === "u" ? { outcome: "noShow" } : {}) })} />
            </Card>
          </div>
        ) : <Empty text="No recruiter activity in this view" />}
      </Section>

      <Section title="Recruiter scorecard" hint="One recruiter against the peer median">
        <Card i={11} title="Pick a recruiter" icon={<RadarIcon className="h-4 w-4" />}
          right={<Select value={picked || "none"} onValueChange={(v) => setPicked(v === "none" ? "" : v)}>
            <SelectTrigger className="h-10 min-w-[12rem] rounded-xl bg-card text-sm" aria-label="Recruiter"><SelectValue placeholder="Choose a recruiter" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Choose a recruiter</SelectItem>{recruiterNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent></Select>}>
          {!picked ? <Empty text="Choose a recruiter to see their scorecard" /> : slice.isLoading || !me ? <Skeleton className="h-72" /> : slice.isError ? <Empty text="Could not load this recruiter" /> : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <KpiCard i={0} label="Handled" value={me.handled} icon={<Users className="h-4 w-4" />} sub={`peer median ${fmt(Math.round(peers.handled))}`} onClick={() => go(`${picked}: handled`, { recruiter: picked })} />
                <KpiCard i={1} label="Selected" value={me.selRate} decimals={1} suffix="%" icon={<UserCheck className="h-4 w-4" />} color={V.aqua} sub={`${fmt(me.selected)} selected · peers ${peers.selRate}%`} onClick={() => go(`${picked}: selected`, { recruiter: picked, outcome: "selected" })} />
                <KpiCard i={2} label="Joined" value={me.joined} icon={<Crown className="h-4 w-4" />} color={V.violet} sub={`${me.joinRate}% of selected · peers ${peers.joinRate}%`} onClick={() => go(`${picked}: joined`, { recruiter: picked, outcome: "joined" })} />
                <KpiCard i={3} label="Show-up" value={me.showUp} decimals={1} suffix="%" icon={<Users className="h-4 w-4" />} color={V.blue} sub={`peers ${peers.showUp}%`} onClick={() => go(`${picked}: no-shows`, { recruiter: picked, outcome: "noShow" })} />
                <KpiCard i={4} label="Rejected" value={me.rejected} icon={<Filter className="h-4 w-4" />} color={V.orange} sub={`${pct(me.rejected, me.handled)}% of handled`} onClick={() => go(`${picked}: rejected`, { recruiter: picked, outcome: "rejected" })} />
              </div>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-4"><div className="mb-1 text-xs font-medium text-muted-foreground">Against peer median (volume 50 = median; speed = share decided)</div>
                  <RadarCompare axes={RADAR_AXES} a={radarValues(me, peers)} b={radarValues(peers, peers)} aLabel={picked} bLabel="Peer median" /></div>
                <div className="lg:col-span-4"><div className="mb-1 text-xs font-medium text-muted-foreground">Findings</div><InsightList items={findings} /></div>
                <div className="lg:col-span-4"><div className="mb-1 text-xs font-medium text-muted-foreground">Handled and selected over time</div>
                  {slice.data!.trend.length ? <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={slice.data!.trend} margin={{ left: -18, right: 4 }}><CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" tick={tick} axisLine={false} tickLine={false} tickFormatter={(v: string) => v.slice(5)} /><YAxis tick={tick} axisLine={false} tickLine={false} /><Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                      <Bar dataKey="total" name="Handled" fill={V.blue} radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(p: { date?: string }) => p.date && go(`${picked} · ${p.date}`, { recruiter: picked, from: p.date, ...(slice.data!.weekly ? {} : { to: p.date }) })} />
                      <Bar dataKey="selected" name="Selected" fill={V.aqua} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer> : <Empty text="No activity in this period" />}</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">Source mix (candidates handled)</div>
                  <BarRows rows={slice.data!.splits.source.slice(0, 6).map((s) => ({ label: s.name, value: s.total, sub: `${s.selRate}% sel` }))} color={V.blue} onSelect={(n) => go(`${picked} · ${n}`, { recruiter: picked, source: n })} /></div>
                <div><div className="mb-1.5 text-xs font-medium text-muted-foreground">Rejections by stage</div>
                  <BarRows rows={slice.data!.splits.stage.filter((s) => s.rejected > 0).sort((a, b) => b.rejected - a.rejected).slice(0, 6).map((s) => ({ label: s.name, value: s.rejected }))} color={V.orange} onSelect={(n) => go(`${picked} · rejected after ${n}`, { recruiter: picked, stage: n, outcome: "rejected" })} /></div>
              </div>
            </div>
          )}
        </Card>
      </Section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5" i={12} title="Referrers" hint="Referred against joined" icon={<Share2 className="h-4 w-4" />}
          right={d?.referrers.length ? <ExportButton onClick={() => downloadCsv("ats-referrers.csv", ["Referrer", "Referred", "Joined", "Join %"], d.referrers.map((r) => [r.name, r.referred, r.joined, pct(r.joined, r.referred)]))} /> : undefined}>
          {d?.referrers.length ? <div className="max-h-72 space-y-2 overflow-auto pr-1">{d.referrers.map((r) => (
            <div key={r.name}><div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{r.name}</span><span className="cc-num text-xs text-muted-foreground">{fmt(r.joined)} of {fmt(r.referred)} joined · {pct(r.joined, r.referred)}%</span></div><RateBar value={pct(r.joined, r.referred)} color={V.violet} /></div>))}</div>
            : <Empty text={denied ? "Not available for your role" : "No referrals in this period"} />}
        </Card>
        <Card className="lg:col-span-7" i={13} title="Duplicates and re-walk-ins" hint="Data quality and returning candidates" icon={<Repeat className="h-4 w-4" />}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/40 p-3"><div className="text-xs text-muted-foreground">Duplicate warnings</div><div className="cc-num text-2xl font-semibold">{denied ? "–" : fmt(d?.duplicateWarnings ?? 0)}</div><div className="text-[11px] text-muted-foreground">same mobile seen again, from the lead ledger</div></div>
            <div className="rounded-xl bg-muted/40 p-3"><div className="text-xs text-muted-foreground">Re-walk-ins</div><div className="cc-num text-2xl font-semibold">{fmt(ins.data?.rewalkins ?? 0)}</div><div className="text-[11px] text-muted-foreground">candidates who came back (no per-candidate list exists yet)</div></div>
            <div className="rounded-xl bg-muted/40 p-3"><div className="text-xs text-muted-foreground">Unresolved duplicates</div><div className="cc-num text-2xl font-semibold">{fmt(o?.kpis.duplicateUnresolved ?? 0)}</div><div className="text-[11px] text-muted-foreground">candidate records flagged as duplicates</div></div>
          </div>
          {d?.legacyWalkin && <p className="mt-3 text-xs text-muted-foreground">The bulk walk-in import ({fmt(d.legacyWalkin.sourced)} leads, {fmt(d.legacyWalkin.selected)} selected) is kept out of the funnel above but is in the ledger.</p>}
        </Card>
      </div>

      <DuplicateReview i={13} suspects={cleanSuspects(names.data?.suspects)} loading={!cc.scopeKnown || (on && names.isLoading)} error={on && names.isError && getHrmsApiErrorStatus(names.error) !== 403} forbidden={cc.scoped || (cc.scopeKnown && !on) || (names.isError && getHrmsApiErrorStatus(names.error) === 403)} onRetry={() => void names.refetch()} />

      <Card i={14} title="Reusable pool" hint="Earlier candidates worth re-approaching before fresh sourcing" icon={<Database className="h-4 w-4" />}
        right={pool.data && pool.data.rows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-reusable-pool.csv", ["Candidate ID", "Name", "Branch", "Process", "Status", "Stage", "Reason", "Last update"], pool.data.rows.map((r) => [r.candidateCode || r.id, r.name, r.branch, r.process, r.status, r.stage, r.reason, r.lastUpdate ?? ""]))} />}>
        <p className="mb-2 text-xs text-muted-foreground">Who counts: candidates on Hold or Client Round - Pending, No Shows (reattempt the confirmation call), and Rejected candidates whose latest interview feedback cites a fixable reason (salary, shift, timing, location, travel or not interested). Updated in the selected period, or the last 90 days.</p>
        {pool.isLoading ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-40" /></div>
        : pool.isError || !pool.data ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-600 dark:text-red-300">Could not load the pool. <button onClick={() => void pool.refetch()} className="cursor-pointer rounded-lg border px-2 py-1 text-xs text-foreground">Retry</button></div>
        : (
          <>
            <p className="mb-2 text-xs text-muted-foreground" role="status">Showing the <b className="text-foreground">{fmt(pool.data.shown)}</b> most recently updated reusable candidates{pool.data.more ? " (more match; narrow the period or process to see others)" : ""}.</p>
            {pool.data.rows.length ? (
              <div className="max-h-[420px] overflow-auto rounded-xl border"><table className="w-full min-w-[680px] text-xs">
                <thead className="sticky top-0 bg-muted text-left text-muted-foreground"><tr><th className="px-3 py-2 font-medium">ID</th><th className="px-3 py-2 font-medium">Candidate</th><th className="px-3 py-2 font-medium">Branch</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Reason</th></tr></thead>
                <tbody>{pool.data.rows.map((r) => (
                  <tr key={r.id} onClick={() => act.openCandidate(r.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act.openCandidate(r.id); } }} tabIndex={0} role="button" aria-label={`Open ${r.name || "candidate"}`} className="cursor-pointer border-t hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.candidateCode || "–"}</td>
                    <td className="px-3 py-1.5 font-medium">{r.name || "–"}</td>
                    <td className="px-3 py-1.5">{r.branch || "–"}</td>
                    <td className="px-3 py-1.5"><span className="rounded-full bg-muted px-2 py-0.5">{r.status || "–"}</span></td>
                    <td className="px-3 py-1.5"><span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{r.reason || "–"}</span></td></tr>))}</tbody></table></div>
            ) : <Empty text="No reusable candidates for these filters" />}
          </>
        )}
      </Card>
    </div>
  );
}
