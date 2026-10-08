import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Fingerprint, ListChecks, Lock, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE, type InsightKpi, type RoleInsights, type Tone } from "../../kit";
import { kpiOf } from "../wfm/insightBits";

interface Stage { key: string; step: string; title: string; icon: typeof Fingerprint; kpi?: InsightKpi; fallbackHref: string; pick?: (k: InsightKpi) => string }

const val = (k: InsightKpi | undefined, suffix = "") =>
  !k || k.value === null || k.value === undefined ? "—" : `${k.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix}`;

/**
 * The attendance pipeline as a left-to-right stepper: punch feed -> processing -> reconciliation -> corrections ->
 * payroll lock. Each stage shows its one number, status colour and links to the page where it is fixed, so the
 * analyst sees WHERE in the chain the record stops being trustworthy.
 */
export function PipelineStrip({ insights, loading }: { insights: RoleInsights | undefined; loading?: boolean }) {
  const stages: Stage[] = [
    { key: "feed", step: "1", title: "Biometric feed", icon: Fingerprint, kpi: kpiOf(insights, "cosec_sync_lag"), fallbackHref: "/wfm/attendance-integrity?tab=biometric", pick: (k) => `${val(k, "h")} old` },
    { key: "process", step: "2", title: "Punched, unprocessed", icon: ScanSearch, kpi: kpiOf(insights, "punch_pipeline"), fallbackHref: "/wfm/attendance-integrity?tab=biometric", pick: (k) => `${val(k)} waiting` },
    { key: "reconcile", step: "3", title: "Missed punches", icon: BadgeCheck, kpi: kpiOf(insights, "missed_punch"), fallbackHref: "/wfm/attendance-integrity?tab=mismatches", pick: (k) => `${val(k)} open` },
    { key: "correct", step: "4", title: "Correction queue", icon: ListChecks, kpi: kpiOf(insights, "reg_median_age"), fallbackHref: "/attendance-regularization", pick: (k) => `${val(k, "d")} median age` },
    { key: "lock", step: "5", title: "Payroll cutoff", icon: Lock, kpi: kpiOf(insights, "payroll_lock"), fallbackHref: "/wfm/attendance-integrity?tab=mismatches", pick: (k) => (k.value === null ? "no cutoff set" : `${val(k)} days left`) },
  ];
  return (
    <ol className="grid gap-2 md:grid-cols-5" aria-label="Attendance data pipeline">
      {stages.map((s, i) => {
        const tone: Tone = s.kpi?.tone ?? "slate";
        const Icon = s.icon;
        return (
          <li key={s.key} className="relative">
            {loading && !s.kpi ? <Skeleton className="h-[104px] rounded-2xl" /> : (
              <Link to={s.kpi?.href ?? s.fallbackHref} title={s.kpi?.formula}
                className="kit-card kit-lift group block h-full p-3.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                <span aria-hidden className={cn("absolute inset-x-3 top-0 h-1 rounded-b-full", TONE[tone].solid)} />
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl", TONE[tone].soft, TONE[tone].text)}><Icon className="h-4 w-4" aria-hidden /></span>
                  <span className="text-xs font-bold text-slate-400">Stage {s.step}</span>
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</p>
                <p className="kit-num mt-0.5 text-[18px] font-extrabold leading-tight text-slate-900">{s.kpi ? (s.pick ? s.pick(s.kpi) : val(s.kpi)) : "—"}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{s.kpi?.unavailable ?? s.kpi?.helper ?? ""}</p>
              </Link>
            )}
            {i < stages.length - 1 ? <ArrowRight aria-hidden className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-slate-300 md:block" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
