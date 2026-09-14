import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { hrmsApi } from "@/lib/hrmsApi";

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TeamRosterWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-team-roster"],
    queryFn: () => hrmsApi.get("/api/wfm/live"),
    staleTime: 1000 * 60 * 2,
  });

  const roster = (data?.data?.live_roster ?? []).slice(0, 8);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Team Roster Today</CardTitle>
            <p className="text-[10px] text-slate-500">Live roster status</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : roster.length === 0 ? (
          <div className="text-center text-sm text-slate-400 py-4">No roster data</div>
        ) : (
          roster.map((r: any, i: number) => (
            <div key={i} className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg transition">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-slate-200 text-slate-700 text-[10px] font-semibold">
                  {getInitials(r.name ?? "??")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">{r.name}</p>
                <p className="text-[10px] text-slate-500">{r.shift ?? "—"}</p>
              </div>
              <div
                className={`px-2 py-0.5 rounded-full text-[9px] font-semibold ${
                  r.status === "present" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}
              >
                {r.status ?? "unknown"}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
