import { useMemo, useState } from "react";
import { AlertOctagon, CalendarClock, Database, Flame, UserCog, UserMinus, Users, ArrowRight, BellOff } from "lucide-react";
import { ChartSkeleton, EmptyState } from "@/components/analytics/analytics-kit";
import { useHubAlerts } from "./api";
import { AbscondingWatch, FollowupEffect } from "./AlertsExtras";
import { DRILL_FOCUS, ErrorCard, ToggleChip } from "./charts";
import { alertLinkToDrill, useDrill } from "./DrillContext";
import type { AlertLink, AlertSeverity, HubAlert } from "./types";

const SEV: Record<AlertSeverity, { label: string; bar: string; chip: string; dot: string }> = {
  critical: { label: "Critical", bar: "bg-[#e34948]", chip: "text-rose-700", dot: "bg-[#e34948]" },
  warning: { label: "Warning", bar: "bg-[#eda100]", chip: "text-amber-700", dot: "bg-[#eda100]" },
  info: { label: "Info", bar: "bg-[#2a78d6]", chip: "text-blue-700", dot: "bg-[#2a78d6]" },
};
const CAT_ICON: Record<HubAlert["category"], typeof Flame> = {
  risk: AlertOctagon, "early-attrition": UserMinus, hotspot: Flame, manager: UserCog, absence: CalendarClock, data: Database,
};
const CAT_LABEL: Record<HubAlert["category"], string> = {
  risk: "Risk", "early-attrition": "Early attrition", hotspot: "Hotspot", manager: "Manager", absence: "Absence", data: "Data quality",
};

export default function AlertsTab({ onViewPeople }: { onViewPeople: (link: AlertLink) => void }) {
  const q = useHubAlerts();
  const drill = useDrill();
  const [sev, setSev] = useState<AlertSeverity | null>(null);
  const list = useMemo(() => (q.data?.alerts ?? []).filter(a => !sev || a.severity === sev), [q.data, sev]);

  if (q.isLoading) return <div className="space-y-3"><AbscondingWatch /><ChartSkeleton height={60} /><ChartSkeleton height={60} /><ChartSkeleton height={60} /></div>;
  if (q.error || !q.data) return <div className="space-y-4"><AbscondingWatch /><ErrorCard what="attrition alerts" error={q.error} onRetry={() => q.refetch()} /><FollowupEffect /></div>;
  const { counts } = q.data;

  return (
    <div className="space-y-4">
      <AbscondingWatch />
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter alerts by severity">
        {(["critical", "warning", "info"] as AlertSeverity[]).map(s => (
          <ToggleChip key={s} active={sev === s} onClick={() => setSev(sev === s ? null : s)}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${sev === s ? "bg-white" : SEV[s].dot}`} />
            {SEV[s].label}
            <span className="tabular-nums opacity-80">{counts[s] ?? 0}</span>
          </ToggleChip>
        ))}
        {sev && <button type="button" onClick={() => setSev(null)} className="cursor-pointer text-xs font-semibold text-slate-500 underline">Clear</button>}
        <span className="ml-auto text-[11px] text-slate-500">Alerts are generated from live risk scores, exits and data checks.</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white py-6">
          <div className="flex flex-col items-center gap-1">
            <BellOff className="h-6 w-6 text-slate-300" aria-hidden />
            <EmptyState label="No active alerts" hint={sev ? "Nothing at this severity. Clear the filter to see the rest." : "Nothing needs attention right now."} height={80} />
          </div>
        </div>
      ) : (
        <ul className="space-y-2.5" aria-label="Active alerts">
          {list.map(a => {
            const Icon = CAT_ICON[a.category] ?? Flame;
            return (
              <li key={a.id} className="relative flex overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm motion-safe:transition-shadow hover:shadow-md">
                <span aria-hidden className={`w-1.5 shrink-0 ${SEV[a.severity].bar}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="mt-0.5 shrink-0 rounded-lg bg-slate-50 p-2 text-slate-500"><Icon className="h-4 w-4" aria-hidden /></div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${SEV[a.severity].chip}`}>{SEV[a.severity].label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-400">{CAT_LABEL[a.category]}</span>
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{a.title}</h3>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{a.detail}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    {a.metric && (
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                        {a.metric.label} <strong className="tabular-nums text-slate-900">{a.metric.value}</strong>
                      </span>
                    )}
                    {a.employeeCount !== undefined && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums text-slate-600">
                        <Users className="h-3 w-3" aria-hidden /> {a.employeeCount}
                      </span>
                    )}
                    {a.link && (
                      <>
                        <button
                          type="button"
                          onClick={() => drill(alertLinkToDrill(a.link!, a.employeeCount !== undefined ? `${a.title} - ${a.employeeCount} people` : a.title))}
                          aria-label={`View people for alert: ${a.title}`}
                          className={`inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 ${DRILL_FOCUS} focus-visible:ring-offset-1`}
                        >
                          View people <ArrowRight className="h-3 w-3" aria-hidden />
                        </button>
                        <button type="button" onClick={() => onViewPeople(a.link!)} aria-label={`Open in risk board: ${a.title}`}
                          className={`inline-flex items-center rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 ${DRILL_FOCUS}`}>
                          Open in risk board
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <FollowupEffect />
    </div>
  );
}
