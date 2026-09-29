import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { fmtDate } from "./opsTypes";
import type { FreshFeed } from "./useOpsCommand";

/** One chip per source with its latest date; red when the feed is behind, so stale data cannot pass as "no problems". */
export function OpsFreshness({ feeds }: { feeds: FreshFeed[] | undefined }) {
  if (!feeds) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Data freshness">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">Data as of</span>
      {feeds.map((f) => (
        <Tooltip key={f.feed}>
          <TooltipTrigger asChild>
            <span className={cn("rounded-full border px-2 py-0.5", f.stale ? "border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>
              {f.feed} {f.latest ? fmtDate(f.latest).slice(0, 5) : "—"}
            </span>
          </TooltipTrigger>
          <TooltipContent className="text-xs">{f.note}{f.stale ? " — behind schedule" : ""}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
