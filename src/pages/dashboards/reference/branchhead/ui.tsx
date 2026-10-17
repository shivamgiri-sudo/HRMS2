import type { ComponentType, ReactNode } from "react";
import { Inbox } from "lucide-react";
import type { KpiTone } from "@/components/process-performance/DashboardKit";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionError } from "./SectionPanels";
import { AccentCard, type Accent } from "./look";

type IconType = ComponentType<{ className?: string }>;

/** Kit tone names (kept for callers) mapped onto the accent stripe colours. */
const ACCENT_OF: Record<string, Accent> = {
  emerald: "emerald", teal: "emerald", green: "emerald", violet: "violet", indigo: "violet", purple: "violet",
  amber: "orange", orange: "orange", rose: "rose", red: "rose", cyan: "cyan", sky: "cyan",
};

/** Section card used by every Branch Head block: accent card (stripe, dot, title) with the subtitle as the right-hand chip. */
export function BhCard({ title, subtitle, tone = "slate", children }: {
  title: string; subtitle?: ReactNode; icon?: IconType; tone?: KpiTone | "slate"; children: ReactNode;
}) {
  return (
    <AccentCard title={title} chip={subtitle} accent={ACCENT_OF[tone] ?? "blue"}>
      <div className="bh-card-body">{children}</div>
    </AccentCard>
  );
}

/** Shared ok/empty/error handling for one section; the body only runs for status ok with data. */
export function SectionShell<T>({ title, subtitle, section, emptyText, errorName, icon, tone, children }: {
  title: string; subtitle?: ReactNode; section: SectionResult<unknown> | undefined; emptyText: string; errorName?: string;
  icon?: IconType; tone?: KpiTone | "slate"; children: (data: T) => ReactNode;
}) {
  const card = { title, icon, tone };
  if (!section) return <BhCard {...card}><p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />Not available yet</p></BhCard>;
  let body: ReactNode;
  if (section.status === "error") body = <SectionError name={errorName ?? title} message={section.message} />;
  else if (section.status !== "ok" || section.data == null) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{section.message ?? emptyText}</p>;
  } else body = children(section.data as T);
  return <BhCard {...card} subtitle={subtitle ?? (section.status === "ok" ? `As of ${section.asOf}` : undefined)}>{body}</BhCard>;
}
