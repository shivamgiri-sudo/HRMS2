import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlarmClock, Banknote, Brain, GraduationCap, Lightbulb, Repeat, TrendingUp, UserX, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAtsInsights, type AtsInsights } from "@/hooks/useAtsDashboards";
import { useAtsOverview, type OverviewPeriod } from "@/hooks/useAtsOverview";
import { periodFrom } from "@/components/ats/overview/shell";
import { useDrillActions } from "@/components/ats/overview/drill";
import { BarRows, Empty, MiniStat, Panel, V, fmt, tooltipStyle } from "@/components/ats/overview/viz";

const tick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const monthLabel = (m: string) => new Date(`${m}-01`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });

const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`; };
const convRows = (rows: AtsInsights["experience"]) => rows.filter((r) => r.total >= 10 && r.name !== "Not stated").map((r) => ({ label: r.name, value: r.selRate, sub: `${fmt(r.total)} cand.` }));


interface Finding { text: string; drill?: { crumb: string; extra: Record<string, unknown> } }
function buildFindings(d: AtsInsights): Finding[] {
  const out: Finding[] = [];
  const conv = (rows: AtsInsights["experience"]) => rows.filter((r) => r.total >= 30 && r.name !== "Not stated");
  const best = (rows: AtsInsights["experience"]) => [...conv(rows)].sort((a, b) => b.selRate - a.selRate);
  const e = best(d.experience), ed = best(d.education), sh = best(d.shift);
  if (e.length > 1) out.push({ text: `${e[0].name} candidates convert best (${e[0].selRate}% selected) while ${e[e.length - 1].name} convert worst (${e[e.length - 1].selRate}%).`, drill: { crumb: `Experience: ${e[0].name}`, extra: { experience: e[0].name } } });
  if (ed.length > 1) out.push({ text: `By education, ${ed[0].name} leads at ${ed[0].selRate}%; ${ed[ed.length - 1].name} trails at ${ed[ed.length - 1].selRate}%.`, drill: { crumb: `Education: ${ed[0].name}`, extra: { education: ed[0].name } } });
  const hard = [...d.rounds].filter((r) => r.sel + r.rej >= 30).sort((a, b) => a.passRate - b.passRate)[0];
  if (hard) out.push({ text: `${hard.round} is the toughest gate: only ${hard.passRate}% pass (${hard.rej} rejected).` });
  if (d.rejectionReasons[0]) out.push({ text: `"${d.rejectionReasons[0].reason}" drives ${d.rejectionReasons[0].share}% of rejections${d.rejectionReasons[1] ? `, followed by "${d.rejectionReasons[1].reason}" (${d.rejectionReasons[1].share}%)` : ""}.`, drill: { crumb: `Reason: ${d.rejectionReasons[0].reason}`, extra: { voc: d.rejectionReasons[0].reason } } });
  const ivs = d.interviewers.filter((r) => r.interviews >= 20).sort((a, b) => b.passRate - a.passRate);
  if (ivs.length > 1) out.push({ text: `Ops-round pass rates range from ${ivs[ivs.length - 1].passRate}% (${ivs[ivs.length - 1].name}) to ${ivs[0].passRate}% (${ivs[0].name}), a ${Math.round((ivs[0].passRate - ivs[ivs.length - 1].passRate) * 10) / 10}-point spread worth calibrating.`, drill: { crumb: `Interviewer: ${ivs[ivs.length - 1].name}`, extra: { interviewer: ivs[ivs.length - 1].name } } });
  const total = d.decisionSpeed.reduce((a, x) => a + x.n, 0), slow = d.decisionSpeed.slice(3).reduce((a, x) => a + x.n, 0);
  if (total > 50 && slow / total > 0.1) out.push({ text: `${Math.round((slow / total) * 100)}% of candidates wait more than a day for a decision.` });
  if (sh.length > 1 && sh[0].selRate - sh[sh.length - 1].selRate > 5) out.push({ text: `Night-shift stance matters: "${sh[0].name}" candidates are selected ${Math.round((sh[0].selRate - sh[sh.length - 1].selRate) * 10) / 10} points more often than "${sh[sh.length - 1].name}".`, drill: { crumb: `Shift: ${sh[0].name}`, extra: { shift: sh[0].name } } });
  const m = d.monthly;
  if (m.length >= 3) { const a = m[m.length - 2], b = m[m.length - 1]; out.push({ text: `Selection rate moved from ${a.selRate}% to ${b.selRate}% between the last two months (${monthLabel(b.month)} is ${b.registered > a.registered ? "busier" : "quieter"}: ${fmt(b.registered)} vs ${fmt(a.registered)} registrations).` }); }
  return out.slice(0, 8);
}

/** Insights > Analytics: interview quality, rejection reasons, who converts, offer economics, interviewer spread. */
export function InsightsAnalyticsSection({ period, branch }: { period: OverviewPeriod; branch: string }) {
  const { data: d, isLoading, isFetching, isError, error } = useAtsInsights(period, branch);
  const drill = useDrillActions();
  const decided = d?.decisionSpeed.reduce((a, x) => a + x.n, 0) ?? 0;
  const fast = (d?.decisionSpeed.slice(0, 2).reduce((a, x) => a + x.n, 0) ?? 0);
  const ctcN = d?.salary.reduce((a, s) => a + s.n, 0) ?? 0;
  const avgOffer = ctcN ? (d!.salary.reduce((a, s) => a + s.avg * s.n, 0) / ctcN) : 0;
  const top = d?.rejectionReasons[0];
  const base = { from: periodFrom(period), branch: branch || undefined }; const go = (crumb: string, extra: Record<string, unknown> = {}) => drill.openDrill(crumb, { ...base, ...extra }); const findings = d ? buildFindings(d) : [];

  return (
    <>
        {isError && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not load analytics: {(error as Error)?.message}</div>}
        {isLoading || !d ? (
          <div className="space-y-4" aria-busy="true"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>
        ) : (
          <div className={`space-y-4 transition-opacity duration-200 ${isFetching ? "opacity-80" : ""}`}>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <MiniStat i={0} label="HR screening pass rate" icon={<Users className="h-4 w-4" />} color={V.blue} value={`${d.rounds[0]?.passRate ?? 0}%`} sub={`${fmt(d.rounds[0]?.sel ?? 0)} passed · ${fmt(d.rounds[0]?.rej ?? 0)} rejected`} />
              <MiniStat onClick={top ? () => go(`Reason: ${top.reason}`, { voc: top.reason }) : undefined} i={1} label="Top rejection reason" icon={<UserX className="h-4 w-4" />} color={V.orange} value={top ? `${top.share}%` : "-"} sub={top?.reason ?? "No data"} />
              <MiniStat i={2} label="Decided within 3 hours" icon={<AlarmClock className="h-4 w-4" />} color={V.aqua} value={`${decided ? Math.round((fast / decided) * 100) : 0}%`} sub={`${fmt(decided)} interviews measured`} />
              <MiniStat i={3} label="Avg offered salary" icon={<Banknote className="h-4 w-4" />} color={V.violet} value={avgOffer ? inr(avgOffer) : "-"} sub={`${fmt(d.rewalkins)} candidates re-walked-in`} />
            </div>

            <Panel i={3} title="What the data says" hint="Written findings, generated from this period · click one to drill" icon={<Lightbulb className="h-4 w-4" />}>
              {findings.length ? <ul className="grid gap-2 md:grid-cols-2">{findings.map((x, i) => (
                <li key={i}><button onClick={() => x.drill && go(x.drill.crumb, x.drill.extra)} disabled={!x.drill} className={`flex w-full items-start gap-2 rounded-lg bg-muted/40 px-3 py-2 text-left text-sm transition-colors ${x.drill ? "cursor-pointer hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" : ""}`}><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /><span>{x.text}</span></button></li>))}</ul> : <Empty text="Not enough data for findings" />}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={4} className="lg:col-span-7" title="Monthly outcomes" hint="Where each month's registrations ended up" icon={<TrendingUp className="h-4 w-4" />}>
                {d.monthly.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={d.monthly.map((m) => ({ ...m, raw: m.month, month: monthLabel(m.month), other: Math.max(0, m.registered - m.selected - m.rejected - m.noShow) }))} margin={{ left: -14, right: 6 }}>
                      <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                      <Bar dataKey="selected" name="Selected" stackId="a" className="cursor-pointer" onClick={(p: { raw?: string }) => p.raw && drill.openDrill(`Selected · ${monthLabel(p.raw)}`, { branch: branch || undefined, from: `${p.raw}-01`, to: monthEnd(p.raw), outcome: "selected" })} fill={V.aqua} stroke="hsl(var(--card))" strokeWidth={2} />
                      <Bar dataKey="rejected" name="Rejected" stackId="a" className="cursor-pointer" onClick={(p: { raw?: string }) => p.raw && drill.openDrill(`Rejected · ${monthLabel(p.raw)}`, { branch: branch || undefined, from: `${p.raw}-01`, to: monthEnd(p.raw), outcome: "rejected" })} fill={V.orange} stroke="hsl(var(--card))" strokeWidth={2} />
                      <Bar dataKey="noShow" name="No-show" stackId="a" className="cursor-pointer" onClick={(p: { raw?: string }) => p.raw && drill.openDrill(`No-show · ${monthLabel(p.raw)}`, { branch: branch || undefined, from: `${p.raw}-01`, to: monthEnd(p.raw), outcome: "noShow" })} fill={V.red} stroke="hsl(var(--card))" strokeWidth={2} />
                      <Bar dataKey="other" name="In progress" stackId="a" className="cursor-pointer" onClick={(p: { raw?: string }) => p.raw && drill.openDrill(`All · ${monthLabel(p.raw)}`, { branch: branch || undefined, from: `${p.raw}-01`, to: monthEnd(p.raw) })} fill={V.track} radius={[6, 6, 0, 0]} stroke="hsl(var(--card))" strokeWidth={2} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Panel>
              <Panel i={5} className="lg:col-span-5" title="Selection rate by month" hint="Selected as % of registered" icon={<TrendingUp className="h-4 w-4" />}>
                {d.monthly.length ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart className="cursor-pointer" onClick={(st: { activePayload?: { payload: { raw?: string } }[] }) => { const raw = st?.activePayload?.[0]?.payload?.raw; if (raw) drill.openDrill(monthLabel(raw), { branch: branch || undefined, from: `${raw}-01`, to: monthEnd(raw) }); }} data={d.monthly.map((m) => ({ ...m, raw: m.month, month: monthLabel(m.month) }))} margin={{ left: -14, right: 12, top: 8 }}>
                      <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="month" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} unit="%" />
                      <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v}%`, "Selection rate"]} />
                      <Line type="monotone" dataKey="selRate" stroke={V.blue} strokeWidth={2.5} dot={{ r: 5, strokeWidth: 2, stroke: "hsl(var(--card))", fill: V.blue, className: "cursor-pointer" }} activeDot={{ r: 7, className: "cursor-pointer" }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel i={6} title="Interview round pass rates" hint="Selected ÷ (selected + rejected) at each round" icon={<Brain className="h-4 w-4" />}>
                <BarRows rows={d.rounds.map((r) => ({ label: r.round, value: r.passRate, sub: `${fmt(r.sel)} pass · ${fmt(r.rej)} fail · ${fmt(r.noShow)} no-show` }))} max={100} color={V.aqua} format={(n) => `${n}%`} />
              </Panel>
              <Panel i={7} title="Why candidates are rejected" hint="Recorded reason of rejection (VOC)" icon={<UserX className="h-4 w-4" />}>
                <BarRows rows={d.rejectionReasons.slice(0, 8).map((r) => ({ label: r.reason, value: r.n, sub: `${r.share}%` }))} color={V.orange} onSelect={(l) => go(`Reason: ${l}`, { voc: l })} />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={8} className="lg:col-span-5" title="Time from registration to decision" hint="How long candidates wait for an outcome" icon={<AlarmClock className="h-4 w-4" />}>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={d.decisionSpeed} margin={{ left: -18 }}>
                    <XAxis dataKey="bucket" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} />
                    <Bar dataKey="n" name="Interviews" radius={[8, 8, 0, 0]}>{d.decisionSpeed.map((x, i) => <Cell key={x.bucket} fill={i >= 3 ? V.orange : V.blue} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel i={9} className="lg:col-span-7" title="Skill test averages by process" hint="Typing speed (WPM) and AI assessment score" icon={<Brain className="h-4 w-4" />}>
                {d.skill.length ? (
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={d.skill} margin={{ left: -14 }}>
                      <CartesianGrid stroke={V.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="process" tick={{ ...tick, fontSize: 10 }} interval={0} tickFormatter={(v: string) => v.slice(0, 9)} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} />
                      <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                      <Bar dataKey="typing" name="Typing" fill={V.blue} radius={[6, 6, 0, 0]} /><Bar dataKey="ai" name="AI score" fill={V.aqua} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <Empty />}
              </Panel>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Panel i={10} title="Selection rate by experience" hint="Who converts" icon={<GraduationCap className="h-4 w-4" />}><BarRows rows={convRows(d.experience)} max={100} color={V.blue} format={(n) => `${n}%`} onSelect={(l) => go(`Experience: ${l}`, { experience: l })} /></Panel>
              <Panel i={11} title="Selection rate by education" icon={<GraduationCap className="h-4 w-4" />}><BarRows rows={convRows(d.education)} max={100} color={V.aqua} format={(n) => `${n}%`} onSelect={(l) => go(`Education: ${l}`, { education: l })} /></Panel>
              <Panel i={12} title="Selection rate by night-shift stance" icon={<Repeat className="h-4 w-4" />}><BarRows rows={convRows(d.shift)} max={100} color={V.violet} format={(n) => `${n}%`} onSelect={(l) => go(`Shift: ${l}`, { shift: l })} /></Panel>
              <Panel i={13} title="Selection rate by age" hint="Where date of birth is recorded" icon={<Users className="h-4 w-4" />}><BarRows rows={convRows(d.ageBands)} max={100} color={V.orange} format={(n) => `${n}%`} onSelect={(l) => go(`Age ${l}`, { age: l.slice(0, 2) })} /></Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-12">
              <Panel i={14} className="lg:col-span-7" title="Offered salary by process" hint="Average with min–max range (submissions with a numeric offer)" icon={<Banknote className="h-4 w-4" />}>
                {d.salary.length ? (
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Process</th><th className="text-right font-medium">Offers</th><th className="text-right font-medium">Avg</th><th className="pl-4 text-left font-medium">Range</th></tr></thead>
                    <tbody>{d.salary.map((s) => {
                      const span = Math.max(1, s.max - s.min), avgPos = ((s.avg - s.min) / span) * 100;
                      return <tr key={s.process} tabIndex={0} role="button" aria-label={`Drill into ${s.process}`} onClick={() => go(`Process: ${s.process}`, { process: s.process })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(`Process: ${s.process}`, { process: s.process })} className="cursor-pointer border-t text-card-foreground transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"><td className="py-2 font-medium">{s.process}</td><td className="text-right tabular-nums">{fmt(s.n)}</td><td className="text-right tabular-nums">{inr(s.avg)}</td>
                        <td className="w-48 pl-4"><div className="relative h-2 rounded-full" style={{ background: "var(--v-track)" }} title={`${inr(s.min)} – ${inr(s.max)}`}><div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ left: `${avgPos}%`, background: V.violet, borderColor: "hsl(var(--card))" }} /></div>
                          <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground"><span>{inr(s.min)}</span><span>{inr(s.max)}</span></div></td></tr>;
                    })}</tbody></table></div>
                ) : <Empty />}
              </Panel>
              <Panel i={15} className="lg:col-span-5" title="Approved offer bands" hint="Offered CTC per month" icon={<Banknote className="h-4 w-4" />}>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={d.ctcBands} margin={{ left: -18 }}>
                    <XAxis dataKey="band" tick={tick} axisLine={false} tickLine={false} /><YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip {...tooltipStyle} cursor={{ fill: V.track }} /><Bar dataKey="n" name="Offers" fill={V.violet} radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>

            <Panel i={16} title="Second-round interviewer effectiveness" hint="Ops-round interviewers with at least 3 interviews" icon={<Users className="h-4 w-4" />}>
              {d.interviewers.length ? (
                <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1.5 text-left font-medium">Interviewer</th><th className="text-right font-medium">Interviews</th><th className="text-right font-medium">Selected</th><th className="text-right font-medium">Rejected</th><th className="w-40 pl-4 text-left font-medium">Pass rate</th></tr></thead>
                  <tbody>{d.interviewers.map((r) => (
                    <tr key={r.name} tabIndex={0} role="button" aria-label={`Drill into ${r.name}`} onClick={() => go(`Interviewer: ${r.name}`, { interviewer: r.name })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(`Interviewer: ${r.name}`, { interviewer: r.name })} className="cursor-pointer border-t text-card-foreground transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"><td className="py-2 font-medium">{r.name}</td><td className="text-right tabular-nums">{fmt(r.interviews)}</td><td className="text-right tabular-nums">{fmt(r.selected)}</td><td className="text-right tabular-nums">{fmt(r.rejected)}</td>
                      <td className="pl-4"><div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--v-track)" }}><div className="h-full rounded-full" style={{ width: `${r.passRate}%`, background: V.aqua }} /></div><span className="w-11 text-right text-xs tabular-nums">{r.passRate}%</span></div></td></tr>))}</tbody></table></div>
              ) : <Empty />}
            </Panel>
          </div>
        )}
    </>
  );
}
