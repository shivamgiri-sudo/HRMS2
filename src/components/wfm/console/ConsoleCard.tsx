import * as React from "react";
import { cn } from "@/lib/utils";

export type ConsoleAccent = "none" | "blue" | "amber" | "red" | "green";

const ACCENT: Record<ConsoleAccent, string> = {
  none: "",
  blue: "border-l-4 border-l-primary",
  amber: "border-l-4 border-l-amber-600",
  red: "border-l-4 border-l-red-600",
  green: "border-l-4 border-l-emerald-600",
};

export interface ConsoleCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional coloured left rule to flag a card that needs attention. */
  accent?: ConsoleAccent;
}

/**
 * The single card surface for the Roster Command Center: plain white, thin border,
 * no glass/blur. Replaces the per-panel copy-pasted GlassCard wrappers.
 */
export function ConsoleCard({ accent = "none", className, children, ...rest }: ConsoleCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        ACCENT[accent],
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export default ConsoleCard;
