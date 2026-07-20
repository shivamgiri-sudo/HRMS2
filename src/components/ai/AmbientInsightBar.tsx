import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAmbientInsights, type AmbientChip } from "@/hooks/useAmbientInsights";

const CHIP_CLASS: Record<AmbientChip["severity"], string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  warning:  "border-amber-200 bg-amber-50 text-amber-700",
  info:     "border-slate-200 bg-slate-50 text-slate-600",
};

const ChipIcon = ({ severity }: { severity: AmbientChip["severity"] }) => {
  if (severity === "critical" || severity === "warning") return <AlertTriangle className="h-3 w-3 flex-shrink-0" />;
  return <Info className="h-3 w-3 flex-shrink-0" />;
};

export function AmbientInsightBar({
  contextType,
  onOpenPalette,
}: {
  contextType: string;
  onOpenPalette: () => void;
}) {
  const navigate = useNavigate();
  const { chips, loading } = useAmbientInsights(contextType);

  if (!loading && chips.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="flex items-center gap-1 text-xs text-violet-600 font-semibold flex-shrink-0">
        <Sparkles className="h-3 w-3" />
        AI
      </span>
      {loading && chips.length === 0 ? (
        <span className="text-xs text-slate-400">Loading insights…</span>
      ) : (
        chips.map((chip, i) => (
          <button
            key={i}
            type="button"
            onClick={chip.action_url
              ? () => {
                  const url = chip.action_url!;
                  if (url.startsWith("/")) { navigate(url); }
                  else { onOpenPalette(); }
                }
              : onOpenPalette}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition hover:opacity-80",
              CHIP_CLASS[chip.severity]
            )}
          >
            <ChipIcon severity={chip.severity} />
            {chip.label}
          </button>
        ))
      )}
    </div>
  );
}
