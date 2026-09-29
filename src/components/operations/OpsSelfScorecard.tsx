import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";

function presentTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 75) return "good";
  if (pct >= 55) return "warn";
  return "bad";
}

interface AttendanceDay {
  date: string;
  status: string;
  lateMark: boolean;
  biometricMinutes: number | null;
  diallerMinutes: number | null;
}

interface AnalystDetailResponse {
  employee: { id: string; fullName: string; employeeCode: string } | null;
  days: AttendanceDay[];
}

const STATUS_COLORS: Record<string, string> = {
  present: "hsl(160 60% 45%)",
  half_day: "hsl(40 90% 55%)",
  absent: "hsl(0 70% 55%)",
  leave_approved: "hsl(220 60% 55%)",
  holiday: "hsl(260 40% 60%)",
  week_off: "hsl(220 10% 60%)",
  missing_punch: "hsl(30 80% 50%)",
  unreconciled: "hsl(0 0% 60%)",
};

export function SelfOperationsScorecard({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["operations-dashboard-v2-self", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystDetailResponse }>(
        `/api/operations-dashboard-v2/analyst/${employeeId}/detail`,
      );
      return res.data;
    },
  });

  const days = data?.days ?? [];
  const present = days.filter((d) => d.status === "present").length;
  const absent = days.filter((d) => d.status === "absent").length;
  const late = days.filter((d) => d.lateMark).length;
  const presentPct = days.length ? Math.round((present / days.length) * 1000) / 10 : null;

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your attendance…</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Days recorded (30d)</p><p className="mt-1 text-2xl font-semibold">{days.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Present rate</p><p className={`mt-1 text-2xl font-semibold ${presentTone(presentPct) === "good" ? "text-emerald-600" : presentTone(presentPct) === "warn" ? "text-amber-600" : presentTone(presentPct) === "bad" ? "text-rose-600" : ""}`}>{presentPct !== null ? `${presentPct}%` : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Late marks</p><p className="mt-1 text-2xl font-semibold">{late}</p></CardContent></Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">Your attendance, last 30 days</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {days.slice(0, 30).map((d) => (
            <div key={d.date} className="flex items-center justify-between text-sm">
              <span>{new Date(d.date).toLocaleDateString()}</span>
              <Badge style={{ backgroundColor: STATUS_COLORS[d.status] ?? undefined }} className="text-white">
                {d.status.replace(/_/g, " ")}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
