import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AlarmClock, Banknote, BadgeCheck, Brain, Cake, FileCheck2, GitBranch, GraduationCap, Grid3x3, Lightbulb, Moon, Network, ShieldCheck, TrendingUp, UserCheck, UserX, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { useAtsInsights, type AtsInsights, type DrillData, type DrillFilters } from "@/hooks/useAtsDashboards";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { useCohorts, useLeakage } from "@/hooks/useAtsCommandCenter";
import { useDrillActions } from "@/components/ats/overview/drill";
import { periodFrom } from "@/components/ats/overview/shell";
import { BarRows, Empty, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";
import { Card, ExportButton, FilterBar, HeatTable, InsightList, KpiCard, Section, Waterfall, downloadCsv, type HeatCol } from "./cc-kit";
import { useCC } from "./cc-context";
import { humanizeStage } from "./stage-label";
import { avgOfferedSalary, buildOutcomeFindings, buildReasonProcessMatrix, calibrateInterviewers, type ReasonRow, fastDecisionShare, inr, leakageOutcome, monthEnd, monthLabel, rateRows, topDropoff } from "./outcomes-helpers";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const MATRIX_REASONS = 6;
const pct = (n: number) => `${n}%`;
const Skel = ({ h = "h-52" }: { h?: string }) => <Skeleton className={`${h} rounded-xl`} />;

/** Drill call identical to useDrill's, so the cache is shared with the drill sheet. */
const drillQs = (f: DrillFilters) => { const q = new URLSearchParams(); Object.entries(f).forEach(([k, v]) => { if (v !== undefined && v !== "") q.set(k, String(v)); }); return q.toString(); };

type RowSel = { name: string; total: number; selRate: number };
function RateCard({ title, hint, icon, rows, color, onSelect, i }: { title: string; hint?: string; icon: React.ReactNode; rows: RowSel[]; color: string; onSelect: (l: string) => void; i: number }) {
  return (
    <Card i={i} title={title} hint={hint} icon={icon}>
      <BarRows rows={rows.map((r) => ({ label: r.name, value: r.selRate, sub: `${fmt(r.total)} cand.` }))} max={100} color={color} format={pct} onSelect={onSelect} />
    </Card>
  );
}

export function OutcomesTab() {
  const cc = useCC();
  const drill = useDrillActions();
  const ins = useAtsInsights(cc.period, cc.branch);
  const ov = useAtsOverview(cc.period, cc.branch);
  const from = periodFrom(cc.period);
  const base = useMemo<DrillFilters>(() => ({ from, branch: cc.branch || undefined }), [from, cc.branch]);
  const leak = useLeakage(base);
  const stepLabel = (key: string) => leak.data?.stages.find((x) => x.key === key)?.label ?? humanizeStage(key);
  const cohorts = useCohorts(12, { branch: cc.branch || undefined });
  const go = (crumb: string, extra: DrillFilters = {}) => drill.openDrill(crumb, { ...base, ...extra });

  const d = ins.data;
  const reasons = useMemo(() => (d?.rejectionReasons ?? []).slice(0, MATRIX_REASONS).map((r) => r.reason), [d]);
  const mq = useQueries({
    queries: reasons.map((reason) => {
      const f: DrillFilters = { ...base, voc: reason };
      return { queryKey: ["ats-drill", f], staleTime: 60_000, refetchOnWindowFocus: false, queryFn: async () => (await hrmsApi.get<{ data: DrillData }>(`/api/ats/dashboard/drill?${drillQs(f)}`)).data };
    }),
  });
  const matrixLoading = reasons.length > 0 && mq.some((q) => q.isLoading);
  const matrixData = mq.map((q) => q.data);
  // A fixed-length dependency: spreading `matrixData` into the list changed its size as reasons loaded, which React rejects.
  const matrixStamp = mq.map((q) => q.dataUpdatedAt).join(",");
  const matrix = useMemo(() => buildReasonProcessMatrix(reasons, matrixData), [reasons, matrixStamp]); // eslint-disable-line react-hooks/exhaustive-deps
  const cal = useMemo(() => calibrateInterviewers(d?.interviewers ?? []), [d]);
  const findings = useMemo(() => (d ? buildOutcomeFindings({ insights: d, dropoff: ov.data?.dropoff, leakage: leak.data, matrix: matrixLoading ? undefined : matrix }).map((f) => ({ tone: f.tone, title: f.title, body: f.body, onClick: f.drill ? () => go(f.drill!.crumb, f.drill!.extra) : undefined })) : []), [d, ov.data, leak.data, matrix, matrixLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ins.isError && !d) return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">Could not load quality and outcomes: {(ins.error as Error)?.message}</div>;
  if (ins.isLoading || !d) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;

  const o = ov.data;
  const top = d.rejectionReasons[0], fast = fastDecisionShare(d.decisionSpeed), avgOffer = avgOfferedSalary(d.salary);
  const bgvTotal = (o?.bgv ?? []).reduce((a, b) => a + b.n, 0);
  const drop = topDropoff(o?.dropoff ?? []);
  const dropTotal = (o?.dropoff ?? []).reduce((a, b) => a + b.n, 0);
  const monthly = d.monthly.map((m) => ({ ...m, raw: m.month, label: monthLabel(m.month), other: Math.max(0, m.registered - m.selected - m.rejected - m.noShow) }));
  const monthDrill = (outcome: string | undefined, name: string) => (p: { raw?: string }) => p.raw && drill.openDrill(`${name} · ${monthLabel(p.raw)}`, { branch: cc.branch || undefined, from: `${p.raw}-01`, to: monthEnd(p.raw), outcome });
  const lossRows = (leak.data?.losses ?? []).slice().sort((a, b) => b.n - a.n).slice(0, 8);
  const ivPts = cal.points.map((p) => ({ ...p, x: p.interviews, y: p.passRate }));
  const outliers = cal.points.filter((p) => p.outlier);

  return (
    <div className={`space-y-5 transition-opacity duration-200 ${ins.isFetching ? "opacity-90" : ""}`}>
      <FilterBar show={["period", "branch"]} branches={(o?.branches ?? []).map((b) => b.name).filter((n) => n !== "Unspecified" && n !== "Unmapped")}
        right={<ExportButton label="Export reasons" onClick={() => downloadCsv("ats-rejection-reasons.csv", ["Reason", "Rejected", "Share %"], d.rejectionReasons.map((r) => [r.reason, r.n, r.share]))} />} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard i={0} label="HR screening pass rate" value={d.rounds[0]?.passRate ?? 0} suffix="%" decimals={(d.rounds[0]?.passRate ?? 0) % 1 ? 1 : 0} sub={`${fmt(d.rounds[0]?.sel ?? 0)} passed · ${fmt(d.rounds[0]?.rej ?? 0)} rejected`} icon={<Users className="h-4 w-4" />} color={V.blue} onClick={() => go("HR screening passed", { outcome: "selected" })} />
        <KpiCard i={1} label="Decided within 3 h" value={fast.pct} suffix="%" sub={`${fmt(fast.measured)} decisions measured`} icon={<AlarmClock className="h-4 w-4" />} color={V.aqua} onClick={() => go("Decided candidates")} />
        <KpiCard i={2} label="Top rejection reason" value={top?.share ?? 0} suffix="%" sub={top?.reason ?? "No rejections recorded"} icon={<UserX className="h-4 w-4" />} color={V.orange} onClick={top ? () => go(`Reason: ${top.reason}`, { voc: top.reason }) : undefined} />
        <KpiCard i={3} label="Avg offered salary" value={Math.round(avgOffer)} sub={avgOffer ? `${inr(avgOffer)} per month · ${fmt(d.salary.reduce((a, s) => a + s.n, 0))} offers` : "No numeric offers"} icon={<Banknote className="h-4 w-4" />} color={V.violet} onClick={() => go("Offered", { outcome: "offered" })} />
        <KpiCard i={4} label="Offer approval" value={o?.kpis.offerApprovalRate ?? 0} suffix="%" sub={`${fmt(o?.kpis.offersTotal ?? 0)} offers raised`} icon={<FileCheck2 className="h-4 w-4" />} color={V.yellow} onClick={() => go("Offered", { outcome: "offered" })} />
        <KpiCard i={5} label="BGV flagged" value={o?.kpis.bgvFlagRate ?? 0} suffix="%" deltaInvert sub={`${fmt(bgvTotal)} checks need review or came back negative`} icon={<ShieldCheck className="h-4 w-4" />} color={V.aqua} onClick={() => go("Joined", { outcome: "joined" })} />
      </div>

      <Card i={1} title="What the data says" hint="Written findings from this period · click one to drill" icon={<Lightbulb className="h-4 w-4" />}>
        <InsightList items={findings} empty="Not enough data for findings" />
      </Card>

      <Section title="Rejection deep-dive" hint="Why candidates are turned down, and where">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={2} className="lg:col-span-5" title="Reason ranking" hint="Recorded reason of rejection · click a bar to drill" icon={<UserX className="h-4 w-4" />}>
            <BarRows rows={d.rejectionReasons.slice(0, 10).map((r) => ({ label: r.reason, value: r.n, sub: `${r.share}%` }))} color={V.orange} onSelect={(l) => go(`Reason: ${l}`, { voc: l })} />
          </Card>
          <Card i={3} className="lg:col-span-7" title="Reason by process" hint={`Top ${MATRIX_REASONS} reasons against the busiest processes · click a cell to drill`} icon={<Grid3x3 className="h-4 w-4" />}
            right={!matrixLoading && matrix.rows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-reason-by-process.csv", ["Reason", ...matrix.processes, "Total"], matrix.rows.map((r) => [r.name, ...matrix.processes.map((p) => r.cells[p] ?? 0), r.total]))} />}>
            {matrixLoading ? <Skel h="h-64" /> : matrix.rows.length && matrix.processes.length ? (
              <HeatTable rows={matrix.rows} max={MATRIX_REASONS}
                cols={[...matrix.processes.map((p): HeatCol<ReasonRow> => ({ key: p, label: p, get: (r) => r.cells[p] ?? 0, hue: "red" })), { key: "__t", label: "Total", get: (r) => r.total, hue: "blue" } as HeatCol<ReasonRow>]}
                onRow={(r) => go(`Reason: ${r.name}`, { voc: r.name })}
                onCell={(r, c) => go(c.key === "__t" ? `Reason: ${r.name}` : `${c.label} · ${r.name}`, c.key === "__t" ? { voc: r.name } : { voc: r.name, process: c.key })} />
            ) : <Empty text="No process split for these reasons" />}
          </Card>
        </div>
        <Card i={4} title="Where rejections happen" hint="The stage a candidate was last at before being rejected" icon={<GitBranch className="h-4 w-4" />}>
          {o?.dropoff.length ? (
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <div className="text-xs text-muted-foreground">Most rejections follow</div>
                <div className="mt-1 text-xl font-semibold leading-tight">{drop.stage}</div>
                <div className="cc-num mt-1 text-sm text-muted-foreground">{fmt(drop.n)} candidates · {dropTotal ? Math.round((drop.n / dropTotal) * 100) : 0}% of rejections</div>
                <button onClick={() => go(`Rejected after ${drop.stage}`, { stage: drop.stage, outcome: "rejected" })} className="mt-3 cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Open these candidates</button>
              </div>
              <div className="lg:col-span-8"><BarRows rows={o.dropoff.slice(0, 8).map((s) => ({ label: s.stage, value: s.n, sub: `${dropTotal ? Math.round((s.n / dropTotal) * 100) : 0}%`, color: s.stage === drop.stage ? V.red : V.blue }))} onSelect={(l) => go(`Rejected after ${l}`, { stage: l, outcome: "rejected" })} /></div>
            </div>
          ) : ov.isLoading ? <Skel h="h-32" /> : <Empty text="No stage history for rejections" />}
        </Card>
      </Section>

      <Section title="Offer-to-join leakage" hint="Selected candidates who never made it to a desk">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={5} className="lg:col-span-6" title="Selected to joined" hint="Bars are survivors; the shaded part is what was lost" icon={<TrendingUp className="h-4 w-4" />}>
            {leak.isLoading ? <Skel /> : leak.isError ? <Empty text="Could not load leakage" /> : leak.data?.stages.length ? (
              <Waterfall steps={leak.data.stages} onStep={(key) => { const s = leak.data!.stages.find((x) => x.key === key); go(s?.label ?? key, { outcome: leakageOutcome(key, s?.label) }); }} />
            ) : <Empty text="No offers in this window" />}
          </Card>
          <Card i={6} className="lg:col-span-6" title="Why they dropped" hint="Largest losses with the recorded reason"
            right={lossRows.length > 0 && <ExportButton onClick={() => downloadCsv("ats-offer-leakage.csv", ["From", "To", "Reason", "Candidates"], lossRows.map((l) => [stepLabel(l.from), stepLabel(l.to), l.reason, l.n]))} />}>
            {leak.isLoading ? <Skel /> : lossRows.length ? (
              <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Step</th><th className="px-2 py-2 font-medium">Reason</th><th className="px-3 py-2 text-right font-medium">Lost</th></tr></thead>
                <tbody>{lossRows.map((l, i) => (
                  <tr key={i} className="border-t"><td className="px-3 py-1.5 text-xs text-muted-foreground">{stepLabel(l.from)} to {stepLabel(l.to)}</td>
                    <td className="px-2 py-1.5"><button onClick={() => go(`${l.reason} · ${l.from}`, { outcome: leakageOutcome(l.from) })} className="cursor-pointer text-left font-medium hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{l.reason}</button></td>
                    <td className="cc-num px-3 py-1.5 text-right font-semibold">{fmt(l.n)}</td></tr>))}</tbody></table></div>
            ) : <Empty text="No recorded losses" />}
            {o && Object.keys(o.offers.byStatus).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3 text-xs">{Object.entries(o.offers.byStatus).map(([s, n]) => <span key={s} className="rounded-full bg-muted px-2.5 py-1"><span className="text-muted-foreground">{s}</span> <b className="cc-num">{fmt(n)}</b></span>)}
                {o.offers.declineReasons.slice(0, 3).map((r) => <span key={r.reason} className="rounded-full bg-red-500/10 px-2.5 py-1 text-red-700 dark:text-red-300">Declined: {r.reason} <b className="cc-num">{fmt(r.n)}</b></span>)}</div>
            )}
          </Card>
        </div>
      </Section>

      <Section title="Decision quality" hint="How consistently and how fast candidates are judged">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={7} className="lg:col-span-4" title="Round pass rates" hint="Selected ÷ (selected + rejected)" icon={<Brain className="h-4 w-4" />}>
            <BarRows rows={d.rounds.map((r) => ({ label: r.round, value: r.passRate, sub: `${fmt(r.sel)} pass · ${fmt(r.rej)} fail · ${fmt(r.noShow)} no-show` }))} max={100} color={V.aqua} format={pct} />
          </Card>
          <Card i={8} className="lg:col-span-8" title="Interviewer calibration" hint={`Interviews against pass rate · dashed line is the ${cal.peerAvg}% peer average · outliers in colour`} icon={<UserCheck className="h-4 w-4" />}>
            {ivPts.length ? (
              <div role="img" aria-label={`Scatter of interviews against pass rate for ${ivPts.length} interviewers. Peer average ${cal.peerAvg} percent. ${outliers.length} outliers.`}>
                <ResponsiveContainer width="100%" height={260}>
                  <ScatterChart margin={{ left: -8, right: 16, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke={V.grid} strokeDasharray="3 4" />
                    <XAxis type="number" dataKey="x" name="Interviews" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="number" dataKey="y" name="Pass rate" domain={[0, 100]} unit="%" tick={tick} axisLine={false} tickLine={false} />
                    <ZAxis range={[70, 70]} />
                    <ReferenceLine y={cal.peerAvg} stroke={V.violet} strokeDasharray="5 4" label={{ value: `Peer avg ${cal.peerAvg}%`, position: "insideTopRight", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip {...tooltipStyle} cursor={{ strokeDasharray: "3 3" }} content={({ payload }) => { const p = payload?.[0]?.payload as (typeof ivPts)[number] | undefined; return p ? <div style={tooltipStyle.contentStyle as React.CSSProperties} className="p-2"><b>{p.name}</b><div>{fmt(p.interviews)} interviews · {p.passRate}% pass</div><div className="text-muted-foreground">{p.delta > 0 ? "+" : ""}{p.delta} pts vs peers</div></div> : null; }} />
                    <Scatter data={ivPts} onClick={(p: { name?: string }) => p.name && go(`Interviewer: ${p.name}`, { interviewer: p.name })} className="cursor-pointer">
                      {ivPts.map((p) => <Cell key={p.name} fill={p.outlier === "low" ? V.red : p.outlier === "high" ? V.orange : V.blue} fillOpacity={p.outlier ? 0.95 : 0.65} stroke="hsl(var(--card))" strokeWidth={1.5} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            ) : <Empty text="No interviewer data" />}
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={9} className="lg:col-span-7" title="Interviewer table" hint="Sorted by pass-rate gap to peers · click a row to drill" icon={<Users className="h-4 w-4" />}
            right={cal.points.length > 0 && <ExportButton onClick={() => downloadCsv("ats-interviewers.csv", ["Interviewer", "Interviews", "Selected", "Rejected", "Pass %", "Gap to peers (pts)", "Flag"], cal.points.map((p) => [p.name, p.interviews, p.selected, p.rejected, p.passRate, p.delta, p.outlier ?? ""]))} />}>
            {cal.points.length ? (
              <div className="max-h-80 overflow-auto rounded-xl border"><table className="w-full min-w-[460px] text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Interviewer</th><th className="px-2 py-2 text-right font-medium">Interviews</th><th className="px-2 py-2 text-right font-medium">Pass</th><th className="px-2 py-2 text-right font-medium">vs peers</th><th className="px-3 py-2 font-medium">Flag</th></tr></thead>
                <tbody>{[...cal.points].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map((p) => (
                  <tr key={p.name} className="border-t"><td className="px-3 py-1.5"><button onClick={() => go(`Interviewer: ${p.name}`, { interviewer: p.name })} className="cursor-pointer text-left font-medium hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{p.name}</button></td>
                    <td className="cc-num px-2 py-1.5 text-right">{fmt(p.interviews)}</td><td className="cc-num px-2 py-1.5 text-right">{p.passRate}%</td>
                    <td className={`cc-num px-2 py-1.5 text-right ${p.outlier ? "font-semibold" : "text-muted-foreground"}`}>{p.delta > 0 ? "+" : ""}{p.delta}</td>
                    <td className="px-3 py-1.5 text-xs">{p.outlier === "high" ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">Lenient</span> : p.outlier === "low" ? <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-medium text-red-700 dark:text-red-300">Strict</span> : <span className="text-muted-foreground">In range</span>}</td></tr>))}</tbody></table></div>
            ) : <Empty />}
          </Card>
          <Card i={10} className="lg:col-span-5" title="Time to decision" hint="Registration to outcome · orange is over a day" icon={<AlarmClock className="h-4 w-4" />}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={d.decisionSpeed} margin={{ left: -18 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="bucket" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                <Bar dataKey="n" name="Candidates" radius={[8, 8, 0, 0]}>{d.decisionSpeed.map((x, i) => <Cell key={x.bucket} fill={i >= 3 ? V.orange : V.blue} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      </Section>

      <Section title="Candidate profile against outcome" hint="Selection rate by who walked in · groups under 10 candidates are hidden">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <RateCard i={11} title="By experience" icon={<GraduationCap className="h-4 w-4" />} rows={rateRows(d.experience)} color={V.blue} onSelect={(l) => go(`Experience: ${l}`, { experience: l })} />
          <RateCard i={12} title="By education" icon={<GraduationCap className="h-4 w-4" />} rows={rateRows(d.education)} color={V.aqua} onSelect={(l) => go(`Education: ${l}`, { education: l })} />
          <RateCard i={13} title="By night-shift stance" icon={<Moon className="h-4 w-4" />} rows={rateRows(d.shift)} color={V.violet} onSelect={(l) => go(`Shift: ${l}`, { shift: l })} />
          <RateCard i={14} title="By age band" hint="Where date of birth is recorded" icon={<Cake className="h-4 w-4" />} rows={rateRows(d.ageBands)} color={V.orange} onSelect={(l) => go(`Age ${l}`, { age: l.slice(0, 2) })} />
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Card i={15} className="lg:col-span-5" title="Skill test averages" hint="Typing speed (WPM) and AI score by process" icon={<Brain className="h-4 w-4" />}>
            {d.skill.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.skill} margin={{ left: -14 }}>
                  <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="process" tick={{ ...tick, fontSize: 10 }} interval={0} tickFormatter={(v: string) => v.slice(0, 9)} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                  <Bar dataKey="typing" name="Typing" fill={V.blue} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { process?: string }) => p.process && go(`Process: ${p.process}`, { process: p.process })} />
                  <Bar dataKey="ai" name="AI score" fill={V.aqua} radius={[6, 6, 0, 0]} className="cursor-pointer" onClick={(p: { process?: string }) => p.process && go(`Process: ${p.process}`, { process: p.process })} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </Card>
          <Card i={16} className="lg:col-span-4" title="Offered salary by process" hint="Average with min to max range" icon={<Banknote className="h-4 w-4" />}>
            {d.salary.length ? <ul className="space-y-1">{d.salary.map((s) => <SalaryRow key={s.process} s={s} onClick={() => go(`Process: ${s.process}`, { process: s.process, outcome: "offered" })} />)}</ul> : <Empty />}
          </Card>
          <Card i={17} className="lg:col-span-3" title="Approved offer bands" hint="Offered CTC per month" icon={<BadgeCheck className="h-4 w-4" />}>
            {d.ctcBands.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.ctcBands} margin={{ left: -18 }}>
                  <XAxis dataKey="band" tick={{ ...tick, fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                  <Bar dataKey="n" name="Offers" fill={V.violet} radius={[8, 8, 0, 0]} className="cursor-pointer" onClick={() => go("Offered", { outcome: "offered" })} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty />}
          </Card>
        </div>
      </Section>

      <Section title="Cohorts and monthly outcomes" hint="Same people tracked over time">
        <Card i={18} title="Weekly cohorts" hint="Everyone who registered in a week, and where they stand now · click a row to drill" icon={<Network className="h-4 w-4" />}
          right={cohorts.data && <ExportButton onClick={() => downloadCsv("ats-outcome-cohorts.csv", ["Week", "Registered", "Selected %", "No-show %", "Joined %", "Median days to decision"], cohorts.data!.cohorts.map((c) => [c.week, c.total, c.selRate, c.noShowRate, c.joinRate, c.medianDaysToDecision]))} />}>
          {cohorts.isLoading ? <Skel /> : cohorts.data?.cohorts.some((c) => c.total) ? (
            <HeatTable rows={cohorts.data.cohorts.filter((c) => c.total).slice().reverse().map((c) => ({ ...c, name: `Week of ${c.week}` }))} max={12}
              cols={[
                { key: "t", label: "Registered", get: (r) => r.total },
                { key: "s", label: "Selected %", get: (r) => r.selRate, format: pct, hue: "green" },
                { key: "n", label: "No-show %", get: (r) => r.noShowRate, format: pct, invert: true, hue: "red" },
                { key: "j", label: "Joined %", get: (r) => r.joinRate, format: pct, hue: "green" },
                { key: "d", label: "Days to decide", get: (r) => r.medianDaysToDecision ?? 0, format: (n) => (n ? `${n}d` : "–"), invert: true, hue: "blue" },
              ]}
              onRow={(r) => { const end = new Date(`${r.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); drill.openDrill(r.name, { branch: cc.branch || undefined, from: r.week, to: end.toISOString().slice(0, 10) }); }}
              onCell={(r, c) => { const end = new Date(`${r.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6); drill.openDrill(`${r.name} · ${c.label}`, { branch: cc.branch || undefined, from: r.week, to: end.toISOString().slice(0, 10), ...(c.key === "s" ? { outcome: "selected" } : c.key === "n" ? { outcome: "noShow" } : c.key === "j" ? { outcome: "joined" } : {}) }); }} />
          ) : <Empty text="No registrations in the last 12 weeks" />}
        </Card>
        <Card i={19} title="Monthly outcomes" hint="Stacked outcomes with the selection-rate line · click a segment to drill" icon={<TrendingUp className="h-4 w-4" />}>
          {monthly.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={monthly} margin={{ left: -10, right: 4 }}>
                <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
                <YAxis yAxisId="n" tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="r" orientation="right" unit="%" tick={tick} axisLine={false} tickLine={false} domain={[0, "auto"]} />
                <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                <Bar yAxisId="n" dataKey="selected" name="Selected" stackId="a" fill={V.aqua} stroke="hsl(var(--card))" strokeWidth={2} className="cursor-pointer" onClick={monthDrill("selected", "Selected")} />
                <Bar yAxisId="n" dataKey="rejected" name="Rejected" stackId="a" fill={V.orange} stroke="hsl(var(--card))" strokeWidth={2} className="cursor-pointer" onClick={monthDrill("rejected", "Rejected")} />
                <Bar yAxisId="n" dataKey="noShow" name="No-show" stackId="a" fill={V.red} stroke="hsl(var(--card))" strokeWidth={2} className="cursor-pointer" onClick={monthDrill("noShow", "No-show")} />
                <Bar yAxisId="n" dataKey="other" name="In progress" stackId="a" fill={V.track} radius={[6, 6, 0, 0]} stroke="hsl(var(--card))" strokeWidth={2} className="cursor-pointer" onClick={monthDrill(undefined, "All")} />
                <Line yAxisId="r" type="monotone" dataKey="selRate" name="Selection rate %" stroke={V.blue} strokeWidth={2.5} dot={{ r: 4, stroke: "hsl(var(--card))", strokeWidth: 2, fill: V.blue }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>
      </Section>
    </div>
  );
}

function SalaryRow({ s, onClick }: { s: AtsInsights["salary"][number]; onClick: () => void }) {
  const span = Math.max(1, s.max - s.min), pos = Math.min(100, Math.max(0, ((s.avg - s.min) / span) * 100));
  return (
    <li><button onClick={onClick} aria-label={`${s.process}: average ${inr(s.avg)}, drill down`} className="block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium">{s.process}</span><span className="cc-num text-muted-foreground">{inr(s.avg)} <span className="text-[11px]">· {fmt(s.n)}</span></span></div>
      <div className="relative mt-1.5 h-2 rounded-full" style={{ background: "var(--v-track)" }}><div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${pos}%`, background: V.violet, borderColor: "hsl(var(--card))" }} /></div>
      <div className="cc-num mt-0.5 flex justify-between text-[10px] text-muted-foreground"><span>{inr(s.min)}</span><span>{inr(s.max)}</span></div>
    </button></li>
  );
}
