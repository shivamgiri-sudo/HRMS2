import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

type MovementPoint = { period: string; joins: number; exits: number };

export function MovementChart() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-workforce-movement"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const points: MovementPoint[] = (data?.data?.movement ?? []).slice(-8);

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <CardTitle className="text-base font-bold text-slate-900">Workforce Movement</CardTitle>
          <p className="mt-0.5 text-xs text-slate-500">Joins & exits — last 8 periods</p>
        </div>
        <Badge className="rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 text-[11px]">Live</Badge>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : points.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-slate-400">No movement data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={points} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="period" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "10px", color: "#f1f5f9", fontSize: 12 }}
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
              />
              <Legend wrapperStyle={{ color: "#64748b", fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="joins" name="Joins" fill="#3BAD49" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="exits" name="Exits" fill="#E8231A" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
