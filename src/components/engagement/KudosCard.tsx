import { Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Kudos } from "./types";

export function KudosCard({ kudos }: { kudos: Kudos }) {
  return (
    <Card className="border-rose-100 bg-white">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <Heart className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{kudos.sender_name}</span> appreciated{" "}
              <span className="font-semibold text-slate-900">{kudos.receiver_name}</span>
            </p>
            <p className="mt-1 font-medium text-rose-700">{kudos.kudos_title ?? "Kudos"}</p>
            {kudos.custom_message && <p className="mt-1 text-sm text-slate-600">{kudos.custom_message}</p>}
            <p className="mt-2 text-xs text-slate-400">{formatISTDate(kudos.sent_at)} · +{kudos.points_awarded} points</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
