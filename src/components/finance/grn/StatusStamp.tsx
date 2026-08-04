import { cn } from "@/lib/utils";

export type StampTone = "ok" | "warn" | "crit" | "info" | "neutral";

const TONE_CLASSES: Record<StampTone, string> = {
  ok: "text-grn-ok bg-grn-ok-bg border-grn-ok-line",
  warn: "text-grn-warn bg-grn-warn-bg border-grn-warn-line",
  crit: "text-grn-crit bg-grn-crit-bg border-grn-crit-line",
  info: "text-grn-info bg-grn-info-bg border-grn-info-line",
  neutral: "text-grn-ink-soft bg-grn-line-soft border-grn-line",
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[.03em]",
        TONE_CLASSES[tone],
        className
      )}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
