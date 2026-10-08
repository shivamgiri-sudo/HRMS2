import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, Printer } from "lucide-react";
import { fmtDate } from "./lpCallShared";
import type { SbiAgentTime, SbiCapacity, SbiCollections, SbiTeam } from "./sbiCardTypes";
import { deriveInsights } from "./sbiCardInsights";
import { ActNow, CompliancePanel, ContactabilityPanel, DepthYield, DimensionExplorer, DispositionBars, Funnel, HourYield, InsightGrid, PositionBar } from "./SbiCardOpsCharts";
import { SbiCardAgentTimePanel } from "./SbiCardAgentTimePanel";
import { CapacityPanel } from "./SbiCardCapacityPanel";
import { TeamPanel } from "./SbiCardTeamPanel";
import { FOCUS, PAL, inrC } from "./sbiViz";
import { Empty, nz, pctTxt } from "./SbiCardShared";

/**
 * Collections Ops: a briefing, top to bottom. Hero numbers, the critical insights, then six chapters
 * (position, where it sits, effort vs yield, contactability, act now, the floor). Insights and the "so what" lines are computed from the same
 * figures as the charts. "Present" goes full screen for a stand-up or review; "Print" gives a clean paper copy.
 */
function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 38; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, pct));
  return (
    <div role="img" aria-label={`${label} ${v.toFixed(1)} percent`} className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 96 96" className="h-24 w-24 -rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="9" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={PAL.aqua} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-white"><b className="text-lg tabular-nums">{v.toFixed(1)}%</b><span className="text-[10px] opacity-80">{label}</span></span>
    </div>
  );
}

function Hero({ ops }: { ops: SbiCollections }) {
  const h = ops.headline;
  const big = (label: string, value: string, sub: string, warn = false) => (
    <div className="min-w-[140px]">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-100/80">{label}</p>
      <p className={`mt-0.5 text-3xl font-bold tabular-nums leading-tight sm:text-4xl ${warn ? "text-amber-300" : "text-white"}`}>{value}</p>
      <p className="text-xs text-blue-100/80">{sub}</p>
    </div>
  );
  return (
    <section aria-label="Executive brief" className="rounded-3xl bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 p-5 text-white shadow-lg sm:p-7 print:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-200">Account file snapshot · {ops.snapshotDate ? fmtDate(ops.snapshotDate) : "—"}</p>
          <p className="mt-1 max-w-xl text-base font-semibold leading-snug text-blue-50 sm:text-lg">
            {nz(h.accounts)} accounts, {inrC(h.exposure)} to collect. {h.untouched > 0 ? `${nz(h.untouched)} not yet dialled, ` : ""}{nz(h.overduePtp)} promises lapsed.
          </p>
        </div>
        <Ring pct={h.coveragePct} label="coverage" />
      </div>
      <div className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/10 pt-5">
        {big("Amount due", inrC(h.exposure), `${nz(h.worked)} accounts worked`)}
        {big("Promised", inrC(h.ptpExposure), `${pctTxt(h.ptpPct)} of worked accounts`)}
        {big("Lapsed promises", inrC(h.overduePtpExposure), `${nz(h.overduePtp)} accounts`, h.overduePtp > 0)}
        {big("Untouched", inrC(h.untouchedExposure), `${nz(h.untouched)} accounts`, h.untouched > 0)}
        {big("Attempts / account", String(h.attemptsPerAccount), `${h.attemptsPerWorked} per worked account`)}
      </div>
    </section>
  );
}

function Chapter({ n, title, takeaway, children }: { n: string; title: string; takeaway?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`sbi-ch-${n}`} className="break-inside-avoid rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white" aria-hidden>{n}</span>
        <div>
          <h3 id={`sbi-ch-${n}`} className="text-base font-bold text-slate-900">{title}</h3>
          {takeaway && <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{takeaway}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function SbiCardCollectionsTab({ ops, time, capacity, team, range }: { ops: SbiCollections; time: SbiAgentTime; capacity: SbiCapacity; team: SbiTeam; range: { from: string; to: string } }) {
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const insights = useMemo(() => deriveInsights(ops, time, 14, capacity, team), [ops, time, capacity, team]);
  const h = ops.headline;
  if (!h.accounts) return <Empty>No account file loaded for this range. Upload the Account File (collection export) to see coverage, promises and exposure by bucket.</Empty>;

  const present = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void root.current?.requestFullscreen?.().catch(() => undefined); };
  const worst = [...ops.dimensions.delq].filter((r) => r.worked > 0).sort((a, b) => a.ptpPct - b.ptpPct)[0];
  const bestHour = [...ops.byHour].filter((x) => x.attempts >= 5).sort((a, b) => b.ptpPct - a.ptpPct)[0];
  const btn = `inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors duration-200 hover:bg-slate-50 ${FOCUS}`;

  return (
    <div ref={root} className={`space-y-4 ${full ? "overflow-y-auto bg-slate-50 p-6" : ""}`}>
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className={btn}><Printer className="h-3.5 w-3.5" aria-hidden />Print</button>
        <button type="button" onClick={present} className={btn} aria-pressed={full}>
          {full ? <Minimize2 className="h-3.5 w-3.5" aria-hidden /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden />}{full ? "Exit present" : "Present"}
        </button>
      </div>

      <Hero ops={ops} />

      <section aria-labelledby="sbi-insights">
        <h3 id="sbi-insights" className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-500">What needs attention</h3>
        <InsightGrid insights={insights} />
      </section>

      <Chapter n="1" title="Where the money stands"
        takeaway={`${((ops.position.find((p) => p.stage === "promised")?.exposure ?? 0) / (h.exposure || 1) * 100).toFixed(1)}% of the amount due is promised and holding; ${((h.overduePtpExposure + h.exhaustedExposure + h.untouchedExposure) / (h.exposure || 1) * 100).toFixed(1)}% is lapsed, exhausted or untouched.`}>
        <div className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
          <PositionBar ops={ops} />
          <div><p className="mb-2 text-xs font-bold text-slate-700">Funnel: loaded to still holding</p><Funnel ops={ops} /></div>
        </div>
      </Chapter>

      <Chapter n="2" title="Where it sits and where it converts"
        takeaway={worst ? `Weakest bucket by yield is ${worst.key}: ${pctTxt(worst.ptpPct)} PTP against ${pctTxt(h.ptpPct)} overall, ${inrC(worst.exposure)} due.` : "Slice the book by bucket, region, product, score or call table."}>
        <DimensionExplorer ops={ops} />
      </Chapter>

      <Chapter n="3" title="Effort versus yield"
        takeaway={bestHour ? `Dialling at ${String(bestHour.hour).padStart(2, "0")}:00 yields ${pctTxt(bestHour.ptpPct)} PTP, the best hour with meaningful volume.` : "How attempts convert by hour and by depth."}>
        <div className="grid gap-6 lg:grid-cols-3">
          <div><p className="mb-2 text-xs font-bold text-slate-700">By hour of day</p><HourYield ops={ops} /></div>
          <div><p className="mb-2 text-xs font-bold text-slate-700">By number of attempts</p><DepthYield ops={ops} /></div>
          <div><p className="mb-2 text-xs font-bold text-slate-700">Disposition mix (all attempts)</p><DispositionBars ops={ops} /></div>
        </div>
      </Chapter>

      <Chapter n="4" title="Penetration and capacity"
        takeaway={capacity.total.accounts ? `${capacity.total.penetration.toFixed(2)} dials per account against a target of ${capacity.target}: ${nz(capacity.total.shortfallDials)} dials short${capacity.capacity ? `, about ${capacity.capacity.extraHoursToCloseGap} login hours at the current dial rate` : ""}.` : "Dials per account against the client's target, and the agent hours that needs."}>
        <CapacityPanel cap={capacity} />
      </Chapter>

      <Chapter n="5" title="Contactability"
        takeaway={`${pctTxt(ops.contactability.noConversationPct)} of attempts reached nobody; ${nz(ops.contactability.stuck.accounts)} accounts have had 3+ attempts and never a conversation (${inrC(ops.contactability.stuck.exposure)}).`}>
        <ContactabilityPanel ops={ops} />
      </Chapter>

      <Chapter n="6" title="Compliance and customer treatment"
        takeaway={`${nz(ops.compliance.window.outside)} calls outside ${ops.compliance.windowLabel}; ${nz(ops.compliance.redialedAfterExclusion.accounts)} accounts dialled again after they should have left the list.`}>
        <CompliancePanel ops={ops} />
      </Chapter>

      <Chapter n="7" title="Act now" takeaway="The call lists to clear first, largest amount due on top. Each downloads as an account-number-only file for the dialer team.">
        <ActNow ops={ops} range={range} />
      </Chapter>

      <Chapter n="8" title="The floor" takeaway="Is the dialer feeding agents, and are they using their time? From the dialer Agent Time (APR) export.">
        <SbiCardAgentTimePanel time={time} bare />
        <div className="mt-6 border-t border-slate-100 pt-5">
          <h4 className="mb-3 text-sm font-bold text-slate-900">Teams and team leaders</h4>
          <TeamPanel team={team} />
        </div>
      </Chapter>
    </div>
  );
}
