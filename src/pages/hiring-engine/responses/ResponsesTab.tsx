/**
 * Responses tab: the HR review queue first, then "Confirmed to attend" for the next drive (the arrival checklist), then every recorded
 * answer from every channel with filters (kept in the URL hash), per-channel counts and response rates, and a live list (refreshed every
 * 30 s while the page is visible). A row opens the person's timeline. View-only roles see no write button. ResponsesView is presentational.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, History, Inbox, RefreshCcw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { BTN } from "../command/charts/ChartFrame";
import { useFilterOptions } from "../command/useCommandData";
import { AnswerBadge, ChannelBadge } from "./ResponseBadges";
import ResponseQueue from "./ResponseQueue";
import ConfirmedList from "./ConfirmedList";
import TimelineDrawer from "./TimelineDrawer";
import type { TimelineKey } from "./timelineModel";
import {
  ANSWERS, ANSWER_LABEL, CHANNELS, CHANNEL_LABEL, STATUSES, STATUS_LABEL, TYPE_OPTIONS, activeFilterCount, canWriteHe, channelCounts, defaultResponseFilters, istToday, listPath,
  parseResponsesHash, pct, responsesHash, summaryPath, whenText, type ResponseFilters, type ResponseList, type ResponseRow, type ResponseSummary,
} from "./responsesModel";
import { campaignOptions, nextDrives, type DriveOption } from "./nextDriveModel";

const FIELD = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-9";
const LABEL = "text-xs font-semibold text-slate-700 dark:text-slate-200";
const CARD = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";

export interface FilterOptions { campaigns: Array<{ id: string; label: string }>; requisitions: Array<{ id: string; label: string }>; drives: Array<{ id: string; label: string }> }

function Select({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<{ id: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <select id={id} className={FIELD} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function FiltersBar({ f, options, onChange }: { f: ResponseFilters; options: FilterOptions; onChange: (f: ResponseFilters) => void }) {
  const set = <K extends keyof ResponseFilters>(k: K, v: ResponseFilters[K]) => onChange({ ...f, [k]: v });
  return (
    <form role="search" aria-label="Filter responses" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()}>
      <div className="min-w-0 space-y-0.5"><label htmlFor="rf-from" className={LABEL}>From</label><input id="rf-from" type="date" className={FIELD} value={f.from} max={f.to} onChange={(e) => e.target.value && set("from", e.target.value)} /></div>
      <div className="min-w-0 space-y-0.5"><label htmlFor="rf-to" className={LABEL}>To</label><input id="rf-to" type="date" className={FIELD} value={f.to} min={f.from} onChange={(e) => e.target.value && set("to", e.target.value)} /></div>
      <Select id="rf-campaign" label="Campaign" value={f.campaignId} options={options.campaigns} onChange={(v) => set("campaignId", v)} />
      <Select id="rf-req" label="Requisition" value={f.requisitionId} options={options.requisitions} onChange={(v) => set("requisitionId", v)} />
      <Select id="rf-type" label="Drive type" value={f.driveType} options={TYPE_OPTIONS as Array<{ id: string; label: string }>} onChange={(v) => set("driveType", v as ResponseFilters["driveType"])} />
      <Select id="rf-drive" label="Drive" value={f.driveId} options={options.drives} onChange={(v) => set("driveId", v)} />
      <Select id="rf-channel" label="Channel" value={f.channel} options={CHANNELS.map((c) => ({ id: c, label: CHANNEL_LABEL[c] }))} onChange={(v) => set("channel", v as ResponseFilters["channel"])} />
      <Select id="rf-answer" label="Answer" value={f.answer} options={ANSWERS.map((a) => ({ id: a, label: ANSWER_LABEL[a] }))} onChange={(v) => set("answer", v as ResponseFilters["answer"])} />
      <Select id="rf-status" label="Status" value={f.status} options={STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s] }))} onChange={(v) => set("status", v as ResponseFilters["status"])} />
      <div className="min-w-0 space-y-0.5">
        <label htmlFor="rf-q" className={LABEL}>Mobile (10 digits)</label>
        <input id="rf-q" inputMode="numeric" autoComplete="off" className={FIELD} defaultValue={f.q} key={f.q}
          onBlur={(e) => { const d = e.target.value.replace(/\D/g, ""); if (d.length === 10 || d === "") set("q", d); }} />
      </div>
      <div className="col-span-2 flex items-end sm:col-span-1">
        <button type="button" className={BTN} disabled={activeFilterCount(f) === 0} onClick={() => onChange({ ...defaultResponseFilters(), from: f.from, to: f.to })}>Clear filters</button>
      </div>
    </form>
  );
}

export function ChannelCounts({ summary }: { summary: ResponseSummary | null }) {
  const rows = channelCounts(summary);
  const rate = summary?.rateByChannel;
  return (
    <section aria-labelledby="rc-heading" className={CARD}>
      <h3 id="rc-heading" className="mb-2 text-sm font-bold text-slate-900 dark:text-slate-100">Answers by channel</h3>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm text-slate-800 dark:text-slate-100">
          <caption className="sr-only">Responses, confirms and people per channel in the selected range</caption>
          <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            <tr><th scope="col" className="py-1 pr-3">Channel</th><th scope="col" className="py-1 pr-3 text-right">Answers</th><th scope="col" className="py-1 pr-3 text-right">Will come</th><th scope="col" className="py-1 text-right">People</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.channel}><th scope="row" className="py-1.5 pr-3 font-normal"><ChannelBadge channel={r.channel} /></th>
                <td className="py-1.5 pr-3 text-right tabular-nums">{r.responses}</td><td className="py-1.5 pr-3 text-right tabular-nums">{r.confirms}</td><td className="py-1.5 text-right tabular-nums">{r.people}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-700 dark:text-slate-200" data-rates>
        Response rate (people who answered of people contacted):{" "}
        {rate ? (["email", "whatsapp", "voice_bot"] as const).map((c) => `${c === "email" ? "Email" : c === "whatsapp" ? "WhatsApp" : "Voice bot"} ${rate[c].contacted ? `${pct(rate[c].rate)} (${rate[c].responded} of ${rate[c].contacted})` : "none contacted"}`).join(" · ") : "not available"}
      </p>
    </section>
  );
}

export interface ResponsesViewProps {
  filters: ResponseFilters; options: FilterOptions; summary: ResponseSummary | null; list: ResponseList | null; loading: boolean; error: string | null; updatedAt: string | null;
  onFilters: (f: ResponseFilters) => void; onMore: () => void; onOpen: (r: ResponseRow) => void; onRefresh: () => void; queue?: ReactNode; nextDrive?: ReactNode;
}

export function ResponsesView({ filters, options, summary, list, loading, error, updatedAt, onFilters, onMore, onOpen, onRefresh, queue, nextDrive }: ResponsesViewProps) {
  const rows = list?.rows ?? [];
  return (
    <div className="space-y-4" data-responses-tab>
      {queue}
      {nextDrive}
      <section aria-labelledby="rl-heading" className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="rl-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100">All answers</h3>
          <span className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
            {updatedAt ? `Updated ${updatedAt} · refreshes every 30 seconds` : "Loading…"}
            <button type="button" className={BTN} onClick={onRefresh} aria-label="Refresh the answers"><RefreshCcw className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh</button>
          </span>
        </div>
        <FiltersBar f={filters} options={options} onChange={onFilters} />
      </section>
      <ChannelCounts summary={summary} />
      <section aria-label="Answers" className={`${CARD} space-y-2`}>
        {error && <p role="alert" className="flex items-center gap-2 text-sm text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> Could not load the answers: {error}</p>}
        {loading && !list && <div className="h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" role="status" aria-label="Loading the answers" />}
        {list && rows.length === 0 && (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-700 dark:text-slate-200"><Inbox className="h-4 w-4 shrink-0" aria-hidden />
            {activeFilterCount(filters) ? "No answer matches these filters in this range." : "No answers recorded in this range yet."}</p>
        )}
        {rows.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm text-slate-800 dark:text-slate-100">
              <caption className="sr-only">Answers from every channel, newest first</caption>
              <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                <tr><th scope="col" className="px-2 py-1">When</th><th scope="col" className="px-2 py-1">Person</th><th scope="col" className="px-2 py-1">Channel</th><th scope="col" className="px-2 py-1">Answer</th>
                  <th scope="col" className="px-2 py-1">Status</th><th scope="col" className="px-2 py-1">Requisition · drive</th><th scope="col" className="px-2 py-1">Text</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} data-response={r.id}>
                    <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums">{whenText(r.occurredAt)}</td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => onOpen(r)} className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded text-left font-medium text-blue-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 sm:min-h-0"
                        aria-label={`Timeline of ${r.person.name}`}><History className="h-3.5 w-3.5 shrink-0" aria-hidden />{r.person.name}</button>
                      <div className="text-xs text-slate-600 dark:text-slate-300">{r.person.mobileMasked}</div>
                    </td>
                    <td className="px-2 py-2"><ChannelBadge channel={r.channel} /></td>
                    <td className="px-2 py-2"><AnswerBadge answer={r.answer} />{r.conflict && <div className="mt-0.5 text-xs font-semibold text-amber-900 dark:text-amber-200">Conflicts with an earlier yes</div>}{r.dedupeOf != null && <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Already confirmed earlier</div>}</td>
                    <td className="px-2 py-2 text-xs">{STATUS_LABEL[r.status] ?? r.status}{r.handledBy === "hr" ? " by HR" : ""}</td>
                    <td className="px-2 py-2 text-xs">{r.requisitionCode ?? "–"}{r.driveDate ? ` · ${whenText(r.driveDate)}` : ""}{r.campaignName ? <div className="text-slate-600 dark:text-slate-300">{r.campaignName}</div> : null}</td>
                    <td className="max-w-[260px] break-words px-2 py-2 text-xs">{r.textPreview || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list?.nextCursor && <button type="button" className={BTN} onClick={onMore} disabled={loading}>Show older answers</button>}
      </section>
    </div>
  );
}

export default function ResponsesTab() {
  const { roleKeys, isResolved } = useWorkforceAccess();
  const canWrite = isResolved && canWriteHe(roleKeys);
  const [filters, setFilters] = useState<ResponseFilters>(() => parseResponsesHash(typeof window === "undefined" ? "" : window.location.hash));
  const [list, setList] = useState<ResponseList | null>(null);
  const [summary, setSummary] = useState<ResponseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [open, setOpen] = useState<TimelineKey | null>(null);
  const [queueTick, setQueueTick] = useState(0);
  const [campaigns, setCampaigns] = useState<FilterOptions["campaigns"]>([]);
  const [drives, setDrives] = useState<DriveOption[]>([]);
  const [driveId, setDriveId] = useState<string | null>(null);
  const { requisitions } = useFilterOptions();
  const seq = useRef(0);

  const load = useCallback(async (f: ResponseFilters, more?: string | null) => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const [l, s] = await Promise.all([hrmsApi.get<{ data?: ResponseList }>(listPath(f, more)), more ? Promise.resolve(null) : hrmsApi.get<{ data?: ResponseSummary }>(summaryPath(f))]);
      if (n !== seq.current) return;
      setList((cur) => (more && cur ? { rows: [...cur.rows, ...(l?.data?.rows ?? [])], nextCursor: l?.data?.nextCursor ?? null } : l?.data ?? { rows: [], nextCursor: null }));
      if (s) setSummary(s.data ?? null);
      setError(null); setUpdatedAt(new Date().toLocaleTimeString());
    } catch (e: unknown) { if (n === seq.current) setError(String((e as Error)?.message || "Request failed")); }
    finally { if (n === seq.current) setLoading(false); }
  }, []);

  useEffect(() => { void load(filters); }, [filters, load]);
  useEffect(() => { // live list: every 30 s while the page is visible (the first page only)
    const t = window.setInterval(() => { if (document.visibilityState === "visible") { void load(filters); setQueueTick((x) => x + 1); } }, 30_000);
    return () => window.clearInterval(t);
  }, [filters, load]);
  useEffect(() => {
    hrmsApi.get<{ data?: unknown }>("/api/he/campaign-config").then((r) => setCampaigns(campaignOptions(r?.data))).catch(() => undefined);
    hrmsApi.get<{ data?: unknown }>("/api/he/drives").then((r) => {
      const next = nextDrives(r?.data, istToday());
      setDrives(next); setDriveId((cur) => cur ?? next[0]?.id ?? null);
    }).catch(() => undefined);
  }, []);

  const onFilters = (f: ResponseFilters) => { const h = responsesHash(f); if (window.location.hash !== h) window.history.replaceState(null, "", h); setFilters(f); };
  const options: FilterOptions = useMemo(() => ({ campaigns, requisitions: requisitions.map((r) => ({ id: r.id, label: r.label })), drives: drives.map((d) => ({ id: d.id, label: d.label })) }), [campaigns, requisitions, drives]);

  const nextDrive = (
    <section aria-labelledby="nd-heading" className={`${CARD} space-y-2`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 id="nd-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100">Next drive</h3>
        {drives.length > 1 && (
          <div className="min-w-[220px] space-y-0.5"><label htmlFor="nd-pick" className={LABEL}>Drive</label>
            <select id="nd-pick" className={FIELD} value={driveId ?? ""} onChange={(e) => setDriveId(e.target.value || null)}>{drives.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
        )}
      </div>
      {driveId ? <ConfirmedList driveId={driveId} canWrite={canWrite} headingLevel="h4" /> : <p className="text-sm text-slate-700 dark:text-slate-200">No drive today or in the next 14 days in your branch.</p>}
    </section>
  );
  return (
    <>
      <ResponsesView filters={filters} options={options} summary={summary} list={list} loading={loading} error={error} updatedAt={updatedAt}
        onFilters={onFilters} onMore={() => void load(filters, list?.nextCursor)} onOpen={(r) => setOpen({ responseId: r.id })} onRefresh={() => { void load(filters); setQueueTick((x) => x + 1); }}
        queue={<ResponseQueue canWrite={canWrite} onOpen={(r) => setOpen({ responseId: r.id })} onChanged={() => void load(filters)} refreshSignal={queueTick} />} nextDrive={nextDrive} />
      <TimelineDrawer k={open} onClose={() => setOpen(null)} />
    </>
  );
}
