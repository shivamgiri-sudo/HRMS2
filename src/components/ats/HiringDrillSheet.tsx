import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { AXIS_TICK, ChartCard, EmptyState, GRID_PROPS, SERIES, TOOLTIP_STYLE, num } from "@/components/analytics/analytics-kit";

/** Funnel stage -> the flag the existing /recruiter/hiring-activity list endpoint filters on. Shortlisted has no flag, so it is not drillable. */
export const HIRING_STAGE_FLAG: Record<string, Record<string, string> | undefined> = {
  Logged: {}, Contacted: { contacted: "1" }, "Walked In": { walkin: "1" }, Selected: { finalSelection: "1" }, Joined: { joined: "1" },
};

export interface HiringDrill { title: string; extra: Record<string, string> }
type Row = { id: string; candidate_name: string | null; mobile: string | null; recruiter_name_snapshot: string | null; hiring_source: string | null; current_status: string | null; joining_status: string | null; activity_date: string | null; branch_name: string | null; process_name: string | null };
const PAGE = 15;

/**
 * Records behind a Hiring Dashboard number. It calls the same list endpoint with the SAME applied filters as the
 * dashboard, so the rows here are exactly the records being counted, not a re-derivation.
 */
export function HiringDrillSheet({ drill, filters, onClose }: { drill: HiringDrill; filters: Record<string, string>; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [drill]);
  const q = useQuery({
    queryKey: ["hiring-drill", drill, filters, page], placeholderData: keepPreviousData, staleTime: 60_000, refetchOnWindowFocus: false,
    queryFn: async () => {
      const p = new URLSearchParams();
      Object.entries({ ...filters, ...drill.extra }).forEach(([k, v]) => { if (v) p.set(k, v); });
      p.set("page", String(page)); p.set("limit", String(PAGE));
      return hrmsApi.get<{ success: boolean; data: Row[]; total: number }>(`/api/ats/recruiter/hiring-activity?${p}`);
    },
  });
  const total = q.data?.total ?? 0, pages = Math.max(1, Math.ceil(total / PAGE));
  const active = Object.entries({ ...filters, ...drill.extra }).filter(([, v]) => v);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left"><SheetTitle>{drill.title}</SheetTitle></SheetHeader>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Applied filters">
          {active.length === 0 && <span className="text-xs text-slate-500">No filters applied</span>}
          {active.map(([k, v]) => <span key={k} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{k}: {v}</span>)}
        </div>
        {q.isLoading ? <div className="mt-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-64" /></div> : q.isError ? (
          <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">Could not load records.</p>
        ) : (
          <div className={`mt-4 space-y-3 ${q.isFetching ? "opacity-70" : ""}`}>
            <p className="text-sm"><b className="tabular-nums">{num(total)}</b> records</p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2 font-medium">Candidate</th><th className="px-3 font-medium">Recruiter</th><th className="px-3 font-medium">Status</th><th className="px-3 font-medium">Date</th></tr></thead>
                <tbody>
                  {(q.data?.data ?? []).map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2"><div className="font-medium text-slate-900">{r.candidate_name || "-"}</div><div className="text-xs text-slate-500">{r.mobile ?? "-"} · {r.hiring_source ?? "-"}</div></td>
                      <td className="px-3 text-xs">{r.recruiter_name_snapshot || "Unassigned"}<div className="text-slate-500">{r.branch_name ?? ""}</div></td>
                      <td className="px-3 text-xs">{r.current_status ?? "-"}{r.joining_status && <div className="text-slate-500">{r.joining_status}</div>}</td>
                      <td className="px-3 text-xs tabular-nums text-slate-500">{r.activity_date ? new Date(r.activity_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"}</td>
                    </tr>
                  ))}
                  {!q.data?.data?.length && <tr><td colSpan={4}><EmptyState label="No records" /></td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-1 text-xs text-slate-500">
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <span className="px-1 tabular-nums">{page} / {pages}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="ml-2 h-8 w-8" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Daily logged / walked-in / selected, from the existing analytics endpoint and the same applied filters. Click a day to drill. */
export function HiringTrendCard({ filters, onDrill }: { filters: Record<string, string>; onDrill: (d: HiringDrill) => void }) {
  const q = useQuery({
    queryKey: ["hiring-trend", filters], staleTime: 60_000, refetchOnWindowFocus: false, placeholderData: keepPreviousData,
    queryFn: async () => {
      const p = new URLSearchParams();
      ["fromDate", "toDate", "month", "branch", "process", "hiringSource", "recruiter", "gender", "education"].forEach((k) => { if (filters[k]) p.set(k, filters[k]); });
      return (await hrmsApi.get<{ data: { trend: { date: string; logged: number; walkins: number; selected: number }[] } }>(`/api/ats/recruiter/hiring-activity/analytics?${p}`)).data.trend;
    },
  });
  const rows = q.data ?? [];
  return (
    <ChartCard title="Daily trend" subtitle="Logged, walked in and selected per day, same filters as above. Click a day to see its records.">
      {q.isLoading ? <Skeleton className="h-64" /> : rows.length < 2 ? <EmptyState label="Not enough days to chart a trend" /> : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ left: -14, right: 8 }} className="cursor-pointer"
            onClick={(st: { activePayload?: { payload: { date?: string } }[] }) => { const d = st?.activePayload?.[0]?.payload?.date; if (d) onDrill({ title: `Records on ${d}`, extra: { fromDate: d.slice(0, 10), toDate: d.slice(0, 10) } }); }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="date" tick={AXIS_TICK} tickFormatter={(v: string) => String(v).slice(5, 10)} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} /><Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
            <Line type="monotone" dataKey="logged" name="Logged" stroke={SERIES[0]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="walkins" name="Walked in" stroke={SERIES[2]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="selected" name="Selected" stroke={SERIES[5]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
