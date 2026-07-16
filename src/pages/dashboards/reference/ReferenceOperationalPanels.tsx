import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CalendarDays,
  Clock3,
  FileCheck2,
  FileText,
  Inbox,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { ReferenceEmpty, ReferencePanel } from "../ReferenceDashboardUI";
import { asArray, asRecord, formatValue, type JsonRecord, type Tone } from "../reference-dashboard-model";

export type BriefItem = {
  label?: string;
  text: string;
  value?: unknown;
  icon?: LucideIcon;
  tone?: Tone;
};

const TONE_CLASS: Record<Tone, string> = {
  blue: "bg-[#edf4ff] text-[#0b63e5]",
  green: "bg-[#eaf8ef] text-[#16a34a]",
  amber: "bg-[#fff4e8] text-[#f97316]",
  red: "bg-[#fff0f1] text-[#ef4444]",
  violet: "bg-[#f3efff] text-[#7c3aed]",
  slate: "bg-[#f1f4f8] text-[#475569]",
};

export function ReferenceAIBrief({
  title,
  intro,
  items,
  actionLabel = "View detailed analysis",
  actionHref = "/reports",
}: {
  title: string;
  intro?: string;
  items: BriefItem[];
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <ReferencePanel
      title={title}
      action={<span className="inline-flex items-center gap-1 rounded-md border border-[#dfd4ff] bg-[#f3efff] px-2 py-1 text-[9px] font-bold text-[#7c3aed]"><Sparkles className="h-3 w-3" />AI</span>}
      bodyClassName="p-0"
    >
      {intro ? <p className="border-b border-[#edf1f6] px-4 py-3 text-[10px] leading-5 text-[#61708a]">{intro}</p> : null}
      <div className="divide-y divide-[#edf1f6]">
        {items.map((item, index) => {
          const Icon = item.icon ?? Sparkles;
          const tone = item.tone ?? "violet";
          return (
            <div key={`${item.label ?? "brief"}-${index}`} className="flex min-h-[58px] items-start gap-3 px-4 py-3">
              <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[tone])}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-bold text-[#1d2b45]">{item.label}</p>
                  {item.value !== undefined ? <span className="shrink-0 text-[11px] font-extrabold text-[#0b1f44]">{formatValue(item.value)}</span> : null}
                </div>
                <p className="mt-1 text-[9px] leading-4 text-[#71809a]">{item.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-[#edf1f6] px-4 py-2.5 text-center"><Link to={actionHref} className="text-[10px] font-semibold text-[#0b63e5]">{actionLabel} →</Link></div>
    </ReferencePanel>
  );
}

type InboxItem = {
  id?: string | number;
  title?: string;
  description?: string;
  module_code?: string;
  moduleCode?: string;
  priority?: string;
  due_date?: string;
  dueDate?: string;
  action_url?: string;
  actionUrl?: string;
};

function inboxIcon(moduleCode: string): LucideIcon {
  const code = moduleCode.toLowerCase();
  if (code.includes("attendance") || code.includes("wfm")) return Clock3;
  if (code.includes("leave")) return CalendarDays;
  if (code.includes("bgv") || code.includes("compliance")) return ShieldCheck;
  if (code.includes("employee") || code.includes("team")) return Users;
  if (code.includes("approval") || code.includes("payroll")) return FileCheck2;
  return FileText;
}

function timeAgo(value?: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ReferenceWorkInbox({ maxItems = 5, title = "Work Inbox" }: { maxItems?: number; title?: string }) {
  const query = useQuery({
    queryKey: ["reference-work-inbox"],
    queryFn: async () => {
      const response = await hrmsApi.get<unknown>("/api/work-inbox/my");
      const record = asRecord(response);
      return Array.isArray(response)
        ? asArray(response)
        : asArray(record.data ?? record.items ?? asRecord(record.data).items);
    },
    staleTime: 30_000,
    retry: 1,
  });

  const items = (query.data ?? []).slice(0, maxItems) as InboxItem[];

  return (
    <ReferencePanel title={title} action={<Link to="/work-inbox" className="text-[10px] font-semibold text-[#0b63e5]">View All</Link>} bodyClassName="p-0">
      {query.isLoading ? <div className="px-4 py-10 text-center text-[10px] text-[#94a3b8]">Loading work inbox…</div> : null}
      {query.isError ? <div className="mx-4 my-4 flex items-center gap-2 rounded-lg border border-[#ffdadd] bg-[#fff7f7] p-3 text-[10px] text-[#b91c1c]"><TriangleAlert className="h-4 w-4" />Unable to load work inbox</div> : null}
      {!query.isLoading && !query.isError && items.length === 0 ? <ReferenceEmpty text="Your inbox is clear" /> : null}
      {items.length > 0 ? (
        <div className="divide-y divide-[#edf1f6]">
          {items.map((item, index) => {
            const moduleCode = String(item.module_code ?? item.moduleCode ?? "work");
            const Icon = inboxIcon(moduleCode);
            const tone = String(item.priority ?? "").toLowerCase() === "high" ? "red" : String(item.priority ?? "").toLowerCase() === "medium" ? "amber" : "blue";
            const href = String(item.action_url ?? item.actionUrl ?? "/work-inbox");
            return (
              <Link key={String(item.id ?? index)} to={href} className="flex min-h-[58px] items-center gap-3 px-4 py-3 hover:bg-[#fafcff]">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[tone])}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-[#1d2b45]">{String(item.title ?? "Work item")}</p><p className="mt-0.5 truncate text-[9px] text-[#71809a]">{String(item.description ?? moduleCode)}</p></div>
                <div className="shrink-0 text-right"><span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[9px] font-bold", TONE_CLASS[tone])}>{String(item.priority ?? "Open")}</span><p className="mt-1 text-[8px] text-[#94a3b8]">{timeAgo(item.due_date ?? item.dueDate)}</p></div>
              </Link>
            );
          })}
        </div>
      ) : null}
    </ReferencePanel>
  );
}
