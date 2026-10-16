import type { ComponentType, ReactNode } from "react";
import { Inbox, LayoutGrid } from "lucide-react";
import { SectionCard, type KpiTone } from "@/components/process-performance/DashboardKit";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionError } from "./SectionPanels";

type IconType = ComponentType<{ className?: string }>;

/** Section card used by every Branch Head block: kit SectionCard look, the subtitle as a right-aligned note. */
export function BhCard({ title, subtitle, icon = LayoutGrid, tone = "slate", children }: {
  title: string; subtitle?: ReactNode; icon?: IconType; tone?: KpiTone | "slate"; children: ReactNode;
}) {
  return (
    <SectionCard icon={icon} title={title} tone={tone}
      action={subtitle ? <span className="shrink-0 whitespace-nowrap text-right text-[11px] text-slate-500">{subtitle}</span> : undefined}>
      <div className="bh-card-body">{children}</div>
    </SectionCard>
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
