import { Badge } from "@/components/ui/badge";
import type { Tier } from "./types";

export function TierBadge({ tier }: { tier: Tier | string | null | undefined }) {
  const name = typeof tier === "string" ? tier : tier?.tier_name ?? "Starter";
  const color = typeof tier === "string" ? undefined : tier?.tier_color;

  return (
    <Badge
      className="border-0 px-3 py-1 text-xs font-semibold"
      style={{ backgroundColor: color ?? "#e2e8f0", color: color ? "#ffffff" : "#334155" }}
    >
      {name}
    </Badge>
  );
}
