import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const SEVERITY_DOT: Record<AmbientChip["severity"], string> = {
  critical: "bg-red-400 animate-pulse",
  warning:  "bg-amber-400",
  info:     "bg-slate-400",
};

const SEVERITY_TEXT: Record<AmbientChip["severity"], string> = {
  critical: "text-red-300",
  warning:  "text-amber-300",
  info:     "text-slate-300",
};

export function AmbientStrip({
  contextType,
  onOpen,
}: {
  contextType: string;
  onOpen: () => void;
}) {
  const { chips, loading } = useAmbientInsights(contextType);

  return (
    <div
      role="complementary"
      aria-label="AI Copilot insights"
      className="fixed bottom-[58px] left-0 right-0 z-50 flex h-10 items-center gap-3 border-t border-slate-700/80 bg-slate-950/95 px-4 shadow-[0_-8px_24px_rgba(15,23,42,0.16)] backdrop-blur-sm select-none lg:bottom-0 lg:left-[var(--sidebar-width)]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 text-xs font-bold text-white transition-colors hover:bg-white/10"
      >
        <Sparkles className="h-3.5 w-3.5 text-sky-300" />
        <span>PeopleOS Copilot</span>
      </button>

      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-500">Loading insights…</span>
      ) : chips.length > 0 ? (
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          {chips.map((chip, i) => (
            <button
              key={i}
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity flex-shrink-0"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", SEVERITY_DOT[chip.severity])} />
              <span className={cn(SEVERITY_TEXT[chip.severity])}>{chip.label}</span>
            </button>
          ))}
          {chips.length > 0 && <span className="text-slate-600 text-xs flex-shrink-0">·</span>}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpen}
        className="ml-auto flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
      >
        Ask anything
        <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-slate-700 bg-slate-800 px-1.5 font-mono text-[10px] text-slate-400">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
