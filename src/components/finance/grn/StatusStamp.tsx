import { cn } from "@/lib/utils";

export type StampTone = "ok" | "warn" | "crit" | "info" | "neutral";

const TONE_CLASSES: Record<StampTone, string> = {
  ok: "text-emerald-700 bg-emerald-50 border-emerald-200",
  warn: "text-amber-700 bg-amber-50 border-amber-200",
  crit: "text-rose-700 bg-rose-50 border-rose-200",
  info: "text-violet-700 bg-violet-50 border-violet-200",
  neutral: "text-slate-600 bg-slate-50 border-slate-200",
};

/**
 * The GRN page's one signature visual element: a status badge shaped like an approval
 * stamp (dot + bold uppercase label) rather than a flat outline pill — this page is
 * literally a document approval chain, so the badge should read like one. Shared across
 * every GRN surface (History, Approval Queue, LOB Attribution) so the same status always
 * looks the same regardless of which screen it's shown on.
 */
export function StatusStamp({
  tone,
  children,
  className,
}: {
  tone: StampTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide",
        TONE_CLASSES[tone],
        className
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
