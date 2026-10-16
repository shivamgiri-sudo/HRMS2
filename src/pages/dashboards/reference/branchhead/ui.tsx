import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Panel } from "../../kit";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionError } from "./SectionPanels";

/** Shared ok/empty/error handling for one section; the body only runs for status ok with data. */
export function SectionShell<T>({ title, subtitle, section, emptyText, errorName, children }: {
  title: string; subtitle?: ReactNode; section: SectionResult<unknown> | undefined; emptyText: string; errorName?: string; children: (data: T) => ReactNode;
}) {
  if (!section) return <Panel title={title}><p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />Not available yet</p></Panel>;
  let body: ReactNode;
  if (section.status === "error") body = <SectionError name={errorName ?? title} message={section.message} />;
  else if (section.status !== "ok" || section.data == null) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{section.message ?? emptyText}</p>;
  } else body = children(section.data as T);
  return <Panel title={title} subtitle={subtitle ?? (section.status === "ok" ? `As of ${section.asOf}` : undefined)}>{body}</Panel>;
}
