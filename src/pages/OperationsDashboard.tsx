import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, TrendingUp, Users2, UserCheck, UserX, Layers } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  DrillDownDashboardShell,
  type DrillLevel,
  type DrillLevelResponse,
  type DrillNode,
} from "@/components/dashboards/DrillDownDashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole } from "@/hooks/useUserRole";
import { DashboardLevelSummary, type HeroTile } from "@/components/dashboards/DashboardLevelSummary";
import { DashboardInsights, computeOpsInsights } from "@/components/dashboards/DashboardInsights";

interface OperationsApiNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  headcount: number;
  presentRatePct: number | null;
  absentRatePct: number | null;
  lateRatePct: number | null;
  avgBiometricMinutes: number | null;
  hasChildren: boolean;
}

interface OperationsApiResponse {
  level: DrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: OperationsApiNode[];
  rangeDays: number;
  asOf: string;
}

function presentTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 75) return "good";
  if (pct >= 55) return "warn";
  return "bad";
}

function toDrillNode(n: OperationsApiNode): DrillNode {
  return {
    id: n.id,
    name: n.name,
    secondaryLabel: n.secondaryLabel,
    hasChildren: n.hasChildren,
    metrics: [
      { label: "Headcount", value: String(n.headcount) },
      {
        label: "Present",
        value: n.presentRatePct !== null ? `${n.presentRatePct}%` : "—",
        tone: presentTone(n.presentRatePct),
      },
      {
        label: "Absent",
        value: n.absentRatePct !== null ? `${n.absentRatePct}%` : "—",
        tone: n.absentRatePct !== null && n.absentRatePct > 20 ? "bad" : "neutral",
      },
      {
        label: "Late",
        value: n.lateRatePct !== null ? `${n.lateRatePct}%` : "—",
        tone: n.lateRatePct !== null && n.lateRatePct > 15 ? "warn" : "neutral",
      },
    ],
  };
}

async function fetchOperationsLevel(level: DrillLevel, parentId: string | null): Promise<DrillLevelResponse> {
  const params = new URLSearchParams({ level });
  if (parentId) params.set("id", parentId);
  const res = await hrmsApi.get<{ success: boolean; data: OperationsApiResponse }>(
    `/api/operations-dashboard-v2/summary?${params.toString()}`,
  );
  return { ...res.data, nodes: res.data.nodes.map(toDrillNode), raw: res.data.nodes };
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

function AnalystDetailSheet({ node, open, onOpenChange }: { node: DrillNode | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["operations-dashboard-v2-analyst", node?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystDetailResponse }>(
        `/api/operations-dashboard-v2/analyst/${node!.id}/detail`,
      );
      return res.data;
    },
    enabled: !!node && open,
  });

  const statusCounts = new Map<string, number>();
  for (const day of data?.days ?? []) statusCounts.set(day.status, (statusCounts.get(day.status) ?? 0) + 1);
  const chartData = [...statusCounts.entries()].map(([status, count]) => ({ status: status.replace(/_/g, " "), count, key: status }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.employee?.fullName ?? node?.name ?? "Analyst"}</SheetTitle>
          <SheetDescription>Day-by-day attendance, last 30 days</SheetDescription>
        </SheetHeader>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && data && data.days.length === 0 && (
          <div className="mt-6">
            <EmptyState title="No attendance records in range" description="No attendance rows found for this employee in the selected window." />
          </div>
        )}

        {!isLoading && chartData.length > 0 && (
          <div className="mt-6 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="status" fontSize={10} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {chartData.map((d) => (
                    <Cell key={d.key} fill={STATUS_COLORS[d.key] ?? "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-6 space-y-2">
          {(data?.days ?? []).slice(0, 60).map((d) => (
            <Card key={d.date} className="border-border/60">
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="text-sm font-medium">{new Date(d.date).toLocaleDateString()}</p>
                  {d.lateMark && <p className="text-xs text-amber-600">Late mark</p>}
                </div>
                <Badge style={{ backgroundColor: STATUS_COLORS[d.status] ?? undefined }} className="text-white">
                  {d.status.replace(/_/g, " ")}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SelfOperationsScorecard({ employeeId }: { employeeId: string }) {
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

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);

function operationsHeroTiles(nodes: OperationsApiNode[]): HeroTile[] {
  const headcount = nodes.reduce((s, n) => s + n.headcount, 0);
  const withRate = nodes.filter((n) => n.presentRatePct !== null);
  const avgPresent = withRate.length
    ? Math.round((withRate.reduce((s, n) => s + (n.presentRatePct ?? 0) * n.headcount, 0) / withRate.reduce((s, n) => s + n.headcount, 0)) * 10) / 10
    : null;
  const withAbsent = nodes.filter((n) => n.absentRatePct !== null);
  const avgAbsent = withAbsent.length
    ? Math.round((withAbsent.reduce((s, n) => s + (n.absentRatePct ?? 0) * n.headcount, 0) / withAbsent.reduce((s, n) => s + n.headcount, 0)) * 10) / 10
    : null;
  return [
    { label: nodes.length === 1 ? "Headcount" : "Headcount (combined)", value: headcount.toLocaleString(), icon: <Users2 className="h-4 w-4" /> },
    { label: "Avg present", value: avgPresent !== null ? `${avgPresent}%` : "—", tone: presentTone(avgPresent), icon: <UserCheck className="h-4 w-4" /> },
    { label: "Avg absent", value: avgAbsent !== null ? `${avgAbsent}%` : "—", tone: avgAbsent !== null && avgAbsent > 20 ? "bad" : "neutral", icon: <UserX className="h-4 w-4" /> },
    { label: nodes.length === 1 ? "In view" : "Shown here", value: String(nodes.length), icon: <Layers className="h-4 w-4" /> },
  ];
}

export default function OperationsDashboard() {
  const { data: roleData } = useUserRole();
  const [selectedAnalyst, setSelectedAnalyst] = useState<DrillNode | null>(null);
  const [levelData, setLevelData] = useState<DrillLevelResponse | null>(null);
  const isSelfOnly = !!roleData?.primaryRole && SELF_ONLY_ROLES.has(roleData.primaryRole);

  const rawNodes = (levelData?.raw as OperationsApiNode[] | undefined) ?? [];
  const levelNoun = levelData ? { branch: "branch", process: "process", team: "team", analyst: "analyst" }[levelData.level] : "branch";

  return (
    <DashboardLayout
      subheader={
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <p className="font-semibold">Operations</p>
        </div>
      }
    >
      <div className="relative p-4 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(60%_50%_at_20%_0%,hsl(var(--primary)/0.10),transparent_70%),radial-gradient(45%_40%_at_85%_10%,hsl(var(--primary)/0.07),transparent_70%)]"
        />
        {isSelfOnly && roleData?.employeeId ? (
          <SelfOperationsScorecard employeeId={roleData.employeeId} />
        ) : (
          <div className="space-y-6">
            <DashboardLevelSummary
              title="Operations"
              subtitle={
                <>Attendance &amp; punctuality from <span className="font-medium">attendance_daily_record</span> — last {levelData?.rangeDays ?? 30} days</>
              }
              heroTiles={rawNodes.length > 0 ? operationsHeroTiles(rawNodes) : []}
              chartData={rawNodes.map((n) => ({ name: n.name, value: n.presentRatePct }))}
              chartTitle={`Present rate by ${levelNoun}`}
              chartValueSuffix="%"
            />
            {rawNodes.length > 0 && <DashboardInsights data={computeOpsInsights(rawNodes, levelNoun)} />}
            <DrillDownDashboardShell
              queryKeyPrefix="operations-dashboard-v2"
              accentClassName="from-sky-500/10 via-primary/5 to-transparent"
              fetchLevel={fetchOperationsLevel}
              onSelectAnalyst={setSelectedAnalyst}
              onData={setLevelData}
              headerRight={
                <Badge variant="outline" className="gap-1.5">
                  <Clock className="h-3 w-3" /> Attendance &amp; punctuality <TrendingUp className="h-3 w-3" />
                </Badge>
              }
            />
          </div>
        )}
      </div>

      <AnalystDetailSheet node={selectedAnalyst} open={!!selectedAnalyst} onOpenChange={(v) => !v && setSelectedAnalyst(null)} />
    </DashboardLayout>
  );
}
