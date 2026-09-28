import { useEffect, useState, type ReactNode } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { X, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  type DetailData, type DetailKind, PALETTE, STATUS_COLORS, TOOLTIP_PROPS,
  fmtDate, fmtN, fmtShortDay, hourLabel, secToHms, secToShort,
} from "./lpCallShared";

export interface DrawerTarget { kind: DetailKind; key: string }

const KIND_LABEL: Record<DetailKind, string> = {
  agent: "Agent", service: "Lead-source", week: "Week", day: "Day",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}

const None = () => <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">None</p>;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold tracking-tight text-slate-800">{value}</p>
      {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function Bar100({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: color }} />
    </div>
  );
}

export function LpCallDrawer({
  apiPath, target, from, to, onClose,
}: { apiPath: string; target: DrawerTarget; from: string; to: string; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    hrmsApi
      .get<{ success: boolean; data: DetailData }>(
        `${apiPath}/detail?kind=${target.kind}&key=${encodeURIComponent(target.key)}&from=${from}&to=${to}`,
      )
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load the detail."); });
    return () => { cancelled = true; };
  }, [apiPath, target.kind, target.key, from, to]);

  const tu = data?.timeUse ?? null;
  const avgDay = (sec: number): number => (tu && tu.agentDays > 0 ? Math.round(sec / tu.agentDays) : 0);
  const dailyChart = data?.daily ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${KIND_LABEL[target.kind]} detail`}>
      <button
        type="button" aria-label="Close detail" onClick={onClose}
        className={`absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-blue-700 via-indigo-700 to-blue-800 px-5 py-4 text-white">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/75">
              {KIND_LABEL[target.kind]} detail
            </p>
            <h3 className="truncate text-lg font-bold">
              {target.kind === "day" ? fmtDate(target.key) : target.key}
            </h3>
            <p className="mt-0.5 text-[11px] text-white/75">{fmtDate(from)} to {fmtDate(to)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data && (
              <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold">
                {data.kpis.connectedPct}% connected
              </span>
            )}
            <button
              type="button" onClick={onClose} aria-label="Close"
              className="rounded-lg p-1.5 text-white/85 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {!data && !error && (
            <div className="flex items-center justify-center py-24 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          {error && <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

          {data && (
            <>
              <Section title="Summary">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="Calls" value={fmtN(data.kpis.calls)} />
                  <Stat label="Unique leadset" value={fmtN(data.kpis.uniqueLeads)} sub="first call per lead per day" />
                  <Stat label="Connected" value={fmtN(data.kpis.connected)} sub={`${data.kpis.connectedPct}% of calls`} />
                  <Stat label="Unique connectivity" value={`${data.kpis.uniqueConnectivityPct}%`} sub={`${fmtN(data.kpis.uniqueConnected)} leads reached`} />
                  <Stat label="First-call connect" value={`${data.kpis.firstCallConnectedPct}%`} />
                  <Stat label="Attempts / lead" value={String(data.kpis.avgAttemptsPerLead)} sub={`avg talk ${secToShort(data.kpis.avgTalkPerConnectedSec)}`} />
                </div>
              </Section>

              <Section title="Daily trend">
                {dailyChart.length === 0 ? <None /> : (
                  <ResponsiveContainer width="100%" height={190}>
                    <ComposedChart data={dailyChart} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 9 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(v) => fmtDate(String(v))} />
                      <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#bfdbfe" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.emerald} strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Section>

              <Section title="Time of day (calls and connect rate)">
                {data.byHour.length === 0 ? <None /> : (
                  <ResponsiveContainer width="100%" height={170}>
                    <ComposedChart data={data.byHour} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="hour" tickFormatter={(h) => `${h}h`} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(h) => `${hourLabel(Number(h))} hr`} />
                      <Bar yAxisId="l" dataKey="calls" name="Calls" fill="#c7d2fe" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.emerald} strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Section>

              <Section title="Call outcome">
                {data.byStatus.length === 0 ? <None /> : (
                  <div className="space-y-2">
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      {data.byStatus.map((s) => (
                        <div key={s.status} title={`${s.status}: ${fmtN(s.calls)}`} style={{ width: `${s.pct}%`, backgroundColor: STATUS_COLORS[s.status] ?? PALETTE.slate }} />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {data.byStatus.map((s) => (
                        <span key={s.status} className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[s.status] ?? PALETTE.slate }} />
                          {s.status} <b className="text-slate-700">{fmtN(s.calls)}</b> ({s.pct}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </Section>

              <Section title="Top dispositions">
                {data.byDisposition.length === 0 ? <None /> : (
                  <ul className="space-y-2">
                    {data.byDisposition.slice(0, 8).map((d) => (
                      <li key={d.disposition}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                          <span className="truncate text-slate-600" title={d.disposition}>{d.disposition}</span>
                          <span className="shrink-0 font-semibold text-slate-700">{fmtN(d.calls)} <span className="font-normal text-slate-400">({d.pct}%)</span></span>
                        </div>
                        <Bar100 pct={d.pct} color={PALETTE.indigo} />
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title="Connect rate by attempt">
                {data.byAttempt.length === 0 ? <None /> : (
                  <ResponsiveContainer width="100%" height={150}>
                    <ComposedChart data={data.byAttempt} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="attempt" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="l" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip {...TOOLTIP_PROPS} labelFormatter={(a) => `Attempt ${a}`} />
                      <Bar yAxisId="l" dataKey="calls" name="Calls" radius={[3, 3, 0, 0]}>
                        {data.byAttempt.map((a) => <Cell key={a.attempt} fill="#bae6fd" />)}
                      </Bar>
                      <Line yAxisId="r" type="monotone" dataKey="connectedPct" name="Connected %" stroke={PALETTE.rose} strokeWidth={2} dot={{ r: 2 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </Section>

              <Section title="Time utilisation (average per agent per day)">
                {!tu ? <None /> : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Stat label="Avg login / day" value={secToHms(avgDay(tu.loginSec))} sub="per agent" />
                      <Stat label="Avg talk / day" value={secToHms(avgDay(tu.talkSec))} sub="per agent" />
                      <Stat label="Shrinkage" value={`${data.shrinkagePct ?? 0}%`} />
                      <Stat label="Occupancy" value={`${data.occupancyPct ?? 0}%`} />
                    </div>
                    <ul className="space-y-1.5 text-xs">
                      {([
                        ["Talk", tu.talkSec, PALETTE.blue], ["Wrap-up", tu.wrapupSec, PALETTE.violet],
                        ["Idle", tu.idleSec, PALETTE.amber], ["Break", tu.breakSec, PALETTE.rose],
                        ["Unaccounted", tu.otherSec, "#cbd5e1"],
                      ] as Array<[string, number, string]>).map(([label, sec, color]) => (
                        <li key={label} className="grid grid-cols-[88px_1fr_64px] items-center gap-2">
                          <span className="text-slate-500">{label}</span>
                          <Bar100 pct={tu.loginSec > 0 ? (sec / tu.loginSec) * 100 : 0} color={color} />
                          <span className="text-right font-medium text-slate-700">{secToHms(avgDay(sec))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>

              <Section title={data.breakdownLabel}>
                {data.breakdown.length === 0 ? <None /> : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">Name</th>
                          <th className="px-3 py-2 text-right font-semibold">Calls</th>
                          <th className="px-3 py-2 text-right font-semibold">Connected</th>
                          <th className="px-3 py-2 text-right font-semibold">Connected %</th>
                          <th className="px-3 py-2 text-right font-semibold">Unique</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.breakdown.map((b) => (
                          <tr key={b.name} className="border-t border-slate-50">
                            <td className="px-3 py-2 font-medium text-slate-700">{b.name}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmtN(b.calls)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmtN(b.connected)}</td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800">{b.connectedPct}%</td>
                            <td className="px-3 py-2 text-right text-slate-600">{fmtN(b.uniqueLeads)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              <Section title={`Latest calls (${data.recentCalls.length})`}>
                {data.recentCalls.length === 0 ? <None /> : (
                  <div className="overflow-x-auto rounded-xl border border-slate-100">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold">Lead</th>
                          <th className="px-3 py-2 font-semibold">Attempt</th>
                          <th className="px-3 py-2 font-semibold">Outcome</th>
                          <th className="px-3 py-2 text-right font-semibold">Talk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentCalls.map((c, i) => (
                          <tr key={`${c.reportDate}-${c.leadId}-${i}`} className="border-t border-slate-50 align-top">
                            <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                              {fmtDate(c.reportDate)}{c.hour !== null && <span className="text-slate-400"> {hourLabel(c.hour)}</span>}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {c.leadId || "—"}
                              {data.kind !== "agent" && <div className="text-[10px] text-slate-400">{c.agent}</div>}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{c.attempt || "—"}</td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[c.status] ?? PALETTE.slate }} />
                                {c.status}
                              </span>
                              <div className="max-w-[220px] truncate text-[10px] text-slate-400" title={c.disposition}>{c.disposition}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">{c.talkSec ? secToHms(c.talkSec) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
