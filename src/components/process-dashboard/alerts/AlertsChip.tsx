import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FOCUS } from "../ui";
import { alertsKey, fetchAlertSummary } from "./api";

/** Bell chip for the dashboard header: open (unacknowledged) alert count, links to the Alerts tab. Silent when the reader cannot load alerts. */
export function AlertsChip({ processId }: { processId: string }) {
  const [sp] = useSearchParams();
  const q = useQuery({ queryKey: alertsKey(processId, "summary"), queryFn: () => fetchAlertSummary(processId), refetchInterval: 60_000, staleTime: 30_000, retry: false });
  if (q.isError) return null;
  const open = q.data?.open ?? 0;
  const next = new URLSearchParams(sp); next.set("view", "alerts");
  return (
    <div className="flex justify-end">
      <Link to={`?${next.toString()}`} aria-label={open > 0 ? `Alerts: ${open} open` : "Alerts: none open"}
        className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${FOCUS} ${open > 0 ? "border-red-300 bg-red-50 text-red-900 hover:bg-red-100" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        <span aria-hidden="true">{open > 0 ? `${open} open alert${open === 1 ? "" : "s"}` : "Alerts"}</span>
      </Link>
    </div>
  );
}
