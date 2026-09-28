/**
 * Roster Upload Tracker — which branch × process has uploaded the weekly roster.
 * Every roster for the week starting Monday W is due by the Sunday before, 18:00 IST.
 * Data: GET /api/wfm/roster-upload-tracker (backend/src/modules/wfm/roster-upload-tracker.service.ts).
 */
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrackerGrid, type SelectedCell } from "./TrackerGrid";
import { TrackerCellDrawer } from "./TrackerCellDrawer";
import { formatShortDate, STATUS_META } from "./trackerFormat";
import { STATUS_ORDER, type TrackerFilters, type TrackerResponse, type UploadStatus } from "./trackerTypes";

const WEEKS_SHOWN = 6;
const ALL = "all";
const REFRESH_MS = 60_000;

const DEFAULT_FILTERS: TrackerFilters = { branchId: ALL, processId: ALL, managerId: ALL, status: ALL, offset: 0 };

const STATUS_CHIPS: { value: TrackerFilters["status"]; label: string }[] = [
  { value: ALL, label: "All" },
  { value: "missing", label: "Missing" },
  { value: "delayed", label: "Delayed" },
  { value: "partial", label: "Partial" },
  { value: "due", label: "Due soon" },
  { value: "uploaded", label: "Uploaded" },
];

const LADDER: { when: string; trigger: string; who: string }[] = [
  { when: "Fri 10:00 · D-2", trigger: "Roster for next W/C not fully uploaded", who: "Branch WFM (reminder)" },
  { when: "Sun 12:00 · D-1", trigger: "Still incomplete, 6 h to the deadline", who: "Branch WFM + process manager (heads-up)" },
  { when: "Sun 18:00 · deadline", trigger: "Cell turns Missing (or stays Partial)", who: "Process manager + branch WFM" },
  { when: "Mon 10:00 · +16 h", trigger: "Still incomplete, the week has started", who: "Above + manager's manager / branch head" },
  { when: "On upload", trigger: "Upload lands after the deadline → Delayed", who: "Process manager + branch WFM told it was late; alerts stop" },
];

function buildUrl(filters: TrackerFilters): string {
  const params = new URLSearchParams({ weeks: String(WEEKS_SHOWN), offset: String(filters.offset) });
  if (filters.branchId !== ALL) params.set("branchId", filters.branchId);
  if (filters.processId !== ALL) params.set("processId", filters.processId);
  if (filters.managerId !== ALL) params.set("managerId", filters.managerId);
  if (filters.status !== ALL) params.set("status", filters.status);
  return `/api/wfm/roster-upload-tracker?${params.toString()}`;
}

function initialFilters(): TrackerFilters {
  const params = new URLSearchParams(window.location.search);
  return {
    ...DEFAULT_FILTERS,
    branchId: params.get("branchId") ?? ALL,
    processId: params.get("processId") ?? ALL,
  };
}

function SummaryTile({ status, count, caption }: { status: UploadStatus; count: number; caption: string }) {
  const meta = STATUS_META[status];
  return (
    <div className="rounded-lg border bg-white px-3 py-2.5">
      <div className={`font-mono text-2xl font-medium leading-tight ${meta.pill.split(" ").find((c) => c.startsWith("text-"))}`}>{count}</div>
      <div className="text-xs text-slate-600">{caption}</div>
    </div>
  );
}

export default function RosterUploadTracker() {
  const [filters, setFilters] = useState<TrackerFilters>(initialFilters);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const patch = (next: Partial<TrackerFilters>) => setFilters((prev) => ({ ...prev, ...next }));

  const query = useQuery({
    queryKey: ["roster-upload-tracker", filters],
    queryFn: () => hrmsApi.get<TrackerResponse>(buildUrl(filters)),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const data = query.data;

  // Process options follow the branch choice; a stale process choice is dropped, not left dangling.
  const processOptions = useMemo(
    () => (data?.filters.processes ?? []).filter((p) => filters.branchId === ALL || p.branchId === filters.branchId),
    [data, filters.branchId],
  );
  const uniqueProcesses = useMemo(
    () => [...new Map(processOptions.map((p) => [p.id, p])).values()],
    [processOptions],
  );

  const thisWeek = data?.weeks.find((w) => w.isCurrent);
  const windowLabel = data && data.weeks.length
    ? `${formatShortDate(data.weeks[0].weekStart)} – ${formatShortDate(data.weeks[data.weeks.length - 1].weekStart)}`
    : "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filters.branchId} onValueChange={(v) => patch({ branchId: v, processId: ALL })}>
          <SelectTrigger className="w-[190px]" aria-label="Branch"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All branches</SelectItem>
            {(data?.filters.branches ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.processId} onValueChange={(v) => patch({ processId: v })}>
          <SelectTrigger className="w-[210px]" aria-label="Process"><SelectValue placeholder="All processes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All processes</SelectItem>
            {uniqueProcesses.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.managerId} onValueChange={(v) => patch({ managerId: v })}>
          <SelectTrigger className="w-[230px]" aria-label="Reporting manager"><SelectValue placeholder="All reporting managers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All reporting managers</SelectItem>
            {(data?.filters.managers ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap items-center gap-2" role="group" aria-label="Status filter">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={filters.status === chip.value}
              onClick={() => patch({ status: chip.value })}
              className={`min-h-[32px] rounded-full border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
                filters.status === chip.value ? "border-slate-500 bg-slate-100 text-slate-900" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => patch({ offset: filters.offset - WEEKS_SHOWN })} aria-label="Earlier weeks">
          <ChevronLeft className="h-4 w-4" /> Earlier
        </Button>
        <Button size="sm" variant="outline" disabled={filters.offset === 0} onClick={() => patch({ offset: 0 })}>This week</Button>
        <Button size="sm" variant="outline" onClick={() => patch({ offset: filters.offset + WEEKS_SHOWN })} aria-label="Later weeks">
          Later <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="font-mono text-xs text-slate-500">W/C {windowLabel}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {query.isError && !data && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {query.error instanceof Error ? query.error.message : "Could not load the upload tracker."}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            <SummaryTile status="uploaded" count={data.summary.currentWeek.uploaded} caption={`Uploaded · W/C ${thisWeek ? formatShortDate(thisWeek.weekStart) : "this week"}`} />
            <SummaryTile status="delayed" count={data.summary.currentWeek.delayed} caption="Delayed" />
            <SummaryTile status="partial" count={data.summary.currentWeek.partial} caption="Partial" />
            <SummaryTile status="missing" count={data.summary.currentWeek.missing} caption="Missing — escalated" />
            <SummaryTile status="due" count={data.summary.nextWeek.due + data.summary.nextWeek.partial} caption="Next W/C still to upload" />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600" aria-label="Legend">
            {STATUS_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-3.5 w-3.5 rounded-[3px] border ${STATUS_META[s].swatch}`} />
                <b className="font-semibold text-slate-800">{STATUS_META[s].glyph} {STATUS_META[s].label}</b> {STATUS_META[s].meaning}
              </span>
            ))}
          </div>

          <TrackerGrid data={data} statusFilter={filters.status} selected={selected} onSelect={setSelected} />

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Escalation ladder</h2>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-[11.5px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">When (IST)</th>
                    <th className="px-3 py-2 font-medium">Trigger</th>
                    <th className="px-3 py-2 font-medium">Who is notified</th>
                  </tr>
                </thead>
                <tbody>
                  {LADDER.map((row) => (
                    <tr key={row.when} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.when}</td>
                      <td className="px-3 py-2 text-slate-700">{row.trigger}</td>
                      <td className="px-3 py-2 text-slate-700">{row.who}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 max-w-3xl text-xs text-slate-500">
              An upload counts only once its batch is committed and covers every active employee of the process for the whole Monday–Sunday week.
              One whole-branch sheet can turn several processes green at once.
            </p>
          </section>
        </>
      )}

      <TrackerCellDrawer selected={selected} canRemind onClose={() => setSelected(null)} />
    </div>
  );
}
