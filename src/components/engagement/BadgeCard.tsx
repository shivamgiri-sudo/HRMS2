import { Award } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BadgeDefinition } from "./types";

export function BadgeCard({ badge, earned = false }: { badge: BadgeDefinition; earned?: boolean }) {
  return (
    <Card className={earned ? "border-amber-200 bg-amber-50/50" : "border-slate-200 opacity-70"}>
      <CardContent className="flex gap-3 p-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${earned ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
          <Award className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{badge.badge_name}</p>
            <Badge variant="secondary">{badge.badge_category}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">{badge.badge_description ?? "Recognition badge"}</p>
          <p className="mt-2 text-xs font-medium text-amber-700">+{badge.points_value} points</p>
        </div>
      </CardContent>
    </Card>
  );
}
