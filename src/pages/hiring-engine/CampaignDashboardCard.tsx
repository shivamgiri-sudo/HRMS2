/**
 * Campaign dashboard (Master tab, top): the numbers for the three ways walk-ins are driven, side by side.
 *   1 Live Meta campaigns   2 Old Meta data re-runs   3 Saved data (uploads and every other pool source)
 * and the drives for the next few days. Read-only, from GET /api/he/campaign-dashboard (cached a minute on the server).
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BarChart3, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";
import { GroupList } from "./command/DriveTypeSection";
import { sortGroups } from "./command/driveGroupModel";
import { istTodayClient } from "./command/driveCommandModel";
import type { DriveGroup } from "./command/driveCommandTypes";

interface Live { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null; owner: "meta" | "he";
  leads: number; qualified: number; inPool: number; emailed: number; whatsapped: number; called: number; replied: number; confirmed: number; arrived: number; walkedIn: number; selected: number; joined: number }
interface Launch { driveId: string; label: string; kind: string; date: string; status: string; requisition: string; role: string; branch: string; reinvite: boolean; audienceNames: string[];
  lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number; emailed: number; whatsapped: number; called: number; replied: number }
interface Source { source: string; people: number; contacted: number; invited: number; confirmed: number; arrived: number; noShow: number }
interface Batch { id: string; label: string; source: string; consentAttested: boolean; created: number; enriched: number; rejected: number; createdAt: string; byStatus: Record<string, number>; launches: number }
interface Drive { driveId: string; date: string; branch: string; requisition: string; role: string; status: string; wanted: number; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number }
interface Data { generatedAt: string; live: Live[]; reruns: Launch[]; saved: { batches: Batch[]; sources: Source[]; batchLaunches: Launch[] }; drives: Drive[]; driveGroups?: DriveGroup[]; failedSections?: string[] }

const th = "px-3 py-2 text-right";
const td = "px-3 py-2 text-right tabular-nums";
const Head = ({ cols }: { cols: string[] }) => <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2 text-left">{cols[0]}</th>{cols.slice(1).map((c) => <th key={c} className={th}>{c}</th>)}</tr></thead>;
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const Box = ({ tone, title, sub, children }: { tone: string; title: string; sub: string; children: React.ReactNode }) => (
  <div className={`rounded-lg border ${tone} p-3`}><h3 className="text-sm font-semibold text-slate-900">{title}</h3><p className="mb-2 text-xs text-slate-600">{sub}</p><div className="overflow-x-auto rounded-md border border-slate-200 bg-white">{children}</div></div>
);

/** Drives of the next days as grouped rows (one per requisition and drive type), compact. Without driveGroups only a message shows. */
export function DrivesBox({ groups, failed, today }: { groups: DriveGroup[] | undefined; failed: boolean; today: string }) {
  const usable = Array.isArray(groups) && !failed;
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Drives: requisition by requisition</h3>
          <p className="mb-2 text-xs text-slate-600">One row per requisition and drive type with totals across the window. Open a row for the day-by-day trend.</p>
        </div>
        <button type="button" onClick={() => { window.location.hash = "drives:summary"; }}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-blue-700 bg-white px-3 text-xs font-semibold text-blue-800 transition-colors duration-150 hover:bg-blue-50 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-8">
          Open full comparison <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {usable
        ? <GroupList groups={sortGroups(groups)} today={today} compact emptyText="No open drives in this window." />
        : <p role="status" className="rounded-md border border-dashed border-slate-300 px-3 py-5 text-center text-sm text-slate-700">Drive rows are not available right now. Open the full comparison to see the drives.</p>}
    </div>
  );
}

export default function CampaignDashboardCard() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => { setErr(false); hrmsApi.get<{ data: Data }>("/api/he/campaign-dashboard").then((r) => setD(r.data)).catch(() => setErr(true)); }, []);
  useEffect(() => { load(); }, [load]);
  if (err) return <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-rose-700" role="alert">Could not load the campaign dashboard. <button className="underline" onClick={load}>Retry</button></section>;
  if (!d) return <div className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50 motion-reduce:animate-none" aria-hidden />;
  const sum = (xs: Launch[], k: keyof Launch) => xs.reduce((a, x) => a + Number(x[k] ?? 0), 0);
  const today = istTodayClient();
  return (
    <section aria-label="Campaign dashboard" className="rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><BarChart3 className="h-4 w-4 text-blue-600" aria-hidden /> Campaign dashboard: live Meta, old Meta data, saved data</h2>
          <p className="mt-1 text-xs text-slate-600">Updated {new Date(d.generatedAt).toLocaleTimeString()}. A person is counted once per row. "Walked in", "selected" and "joined" come from branch and requisition records.</p></div>
        <button type="button" onClick={load} aria-label="Refresh the dashboard" className="cursor-pointer rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><RefreshCw className="h-4 w-4" aria-hidden /></button>
      </div>

      <div className="mt-3 space-y-4">
        <DrivesBox groups={d.driveGroups} failed={d.failedSections?.includes("driveGroups") === true} today={today} />

        <Box tone="border-blue-200" title="1 · Live Meta campaigns" sub="Form fill to joined, per campaign. 'Outreach by' shows who messages the leads.">
          <table className="w-full min-w-[1100px] text-sm"><Head cols={["Campaign", "Outreach by", "Form fills", "Qualified", "In engine", "Emailed", "WhatsApp", "Called", "Replied", "Confirmed", "Arrived", "Walked in", "Selected", "Joined"]} />
            <tbody className="divide-y divide-slate-100">{d.live.map((c) => (
              <tr key={c.campaignId}><td className="px-3 py-2"><div className="font-medium text-slate-900">{c.campaignName}</div><div className="text-xs text-slate-500">{c.status}{c.requisitionCode ? ` · ${c.requisitionCode}` : ""}{c.branchName ? ` · ${c.branchName}` : ""}</div></td>
                <td className="px-3 py-2 text-right text-xs">{c.owner === "he" ? "Hiring Engine" : "Old Meta flow"}</td>
                <td className={td}>{num(c.leads)}</td><td className={td}>{num(c.qualified)} <span className="text-xs text-slate-400">{pct(c.qualified, c.leads)}</span></td>
                {[c.inPool, c.emailed, c.whatsapped, c.called, c.replied, c.confirmed, c.arrived, c.walkedIn, c.selected, c.joined].map((v, i) => <td key={i} className={td}>{num(v)}</td>)}</tr>))}</tbody></table>
        </Box>

        <Box tone="border-amber-200" title="2 · Old Meta data re-runs" sub={`${num(d.reruns.length)} launches: ${num(sum(d.reruns, "lined"))} people lined up, ${num(sum(d.reruns, "confirmed"))} confirmed, ${num(sum(d.reruns, "arrived"))} arrived. Each launch is its own row.`}>
          <table className="w-full min-w-[980px] text-sm"><Head cols={["Launch", "Date", "Lined up", "Emailed", "WhatsApp", "Called", "Replied", "Confirmed", "Arrived", "Did not come"]} />
            <tbody className="divide-y divide-slate-100">{d.reruns.map((l) => (
              <tr key={l.driveId}><td className="px-3 py-2"><div className="font-medium text-slate-900">{l.label || "Launch"}</div><div className="max-w-[300px] truncate text-xs text-slate-500" title={l.audienceNames.join(", ")}>{l.requisition} · {l.branch} · {l.audienceNames.join(", ")}</div></td>
                <td className={td}>{l.date}</td>{[l.lined, l.emailed, l.whatsapped, l.called, l.replied, l.confirmed, l.arrived, l.noShow].map((v, i) => <td key={i} className={td}>{num(v)}</td>)}</tr>))}
              {d.reruns.length === 0 && <tr><td colSpan={10} className="px-3 py-5 text-center text-slate-500">No re-run launched yet. Use "Launch a campaign" below.</td></tr>}</tbody></table>
        </Box>

        <Box tone="border-violet-200" title="3 · Saved data: every source in the pool" sub="Everyone in the pool by where they came from, and how far each source has got.">
          <table className="w-full min-w-[820px] text-sm"><Head cols={["Source", "People", "Contacted", "Invited", "Confirmed", "Arrived", "Did not come"]} />
            <tbody className="divide-y divide-slate-100">{d.saved.sources.map((s) => (
              <tr key={s.source}><td className="px-3 py-2 font-medium text-slate-900">{s.source.replace(/_/g, " ")}</td>{[s.people, s.contacted, s.invited, s.confirmed, s.arrived, s.noShow].map((v, i) => <td key={i} className={td}>{num(v)}</td>)}</tr>))}</tbody></table>
        </Box>
        <Box tone="border-violet-200" title="3 · Saved data: uploaded files" sub="Each upload is a batch you can launch on its own.">
          <table className="w-full min-w-[820px] text-sm"><Head cols={["Upload", "Source", "New people", "Already known", "Skipped rows", "Launches"]} />
            <tbody className="divide-y divide-slate-100">{d.saved.batches.map((b) => (
              <tr key={b.id}><td className="px-3 py-2"><div className="font-medium text-slate-900">{b.label}</div><div className="text-xs text-slate-500">{b.createdAt.slice(0, 10)}{b.consentAttested ? " · consent recorded" : ""}</div></td>
                <td className="px-3 py-2 text-right text-xs">{b.source}</td>{[b.created, b.enriched, b.rejected, b.launches].map((v, i) => <td key={i} className={td}>{num(v)}</td>)}</tr>))}
              {d.saved.batches.length === 0 && <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-500">No file uploaded yet. Use "Add candidates" on this tab.</td></tr>}</tbody></table>
        </Box>
      </div>
    </section>
  );
}
