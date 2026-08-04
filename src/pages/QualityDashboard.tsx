import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, PhoneCall, TrendingUp } from "lucide-react";
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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useUserRole } from "@/hooks/useUserRole";

interface QualityApiNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  agentCount: number;
  callsAudited: number;
  avgQualityPct: number | null;
  hasChildren: boolean;
}

interface QualityApiResponse {
  level: DrillLevel;
  parentId: string | null;
  parentLabel: string | null;
  nodes: QualityApiNode[];
  rangeDays: number;
  asOf: string;
}

function qualityTone(pct: number | null): "good" | "warn" | "bad" | "neutral" {
  if (pct === null) return "neutral";
  if (pct >= 70) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

function toDrillNode(n: QualityApiNode): DrillNode {
  return {
    id: n.id,
    name: n.name,
    secondaryLabel: n.secondaryLabel,
    hasChildren: n.hasChildren,
    metrics: [
      { label: "Agents", value: String(n.agentCount) },
      { label: "Calls audited", value: n.callsAudited.toLocaleString() },
      {
        label: "Avg quality",
        value: n.avgQualityPct !== null ? `${n.avgQualityPct}%` : "—",
        tone: qualityTone(n.avgQualityPct),
      },
    ],
  };
}

async function fetchQualityLevel(level: DrillLevel, parentId: string | null): Promise<DrillLevelResponse> {
  const params = new URLSearchParams({ level });
  if (parentId) params.set("id", parentId);
  const res = await hrmsApi.get<{ success: boolean; data: QualityApiResponse }>(
    `/api/quality-dashboard-v2/summary?${params.toString()}`,
  );
  return { ...res.data, nodes: res.data.nodes.map(toDrillNode) };
}

interface AnalystCall {
  id: number;
  callDate: string;
  client: string | null;
  qualityPct: number | null;
  totalScore: number | null;
  maxScore: number | null;
  areasForImprovement: string | null;
}

interface AnalystCallsResponse {
  employee: { id: string; fullName: string; employeeCode: string } | null;
  calls: AnalystCall[];
}

function AnalystDetailSheet({ node, open, onOpenChange }: { node: DrillNode | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quality-dashboard-v2-analyst", node?.id],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystCallsResponse }>(
        `/api/quality-dashboard-v2/analyst/${node!.id}/calls`,
      );
      return res.data;
    },
    enabled: !!node && open,
  });

  const chartData = (data?.calls ?? [])
    .filter((c) => c.qualityPct !== null)
    .slice()
    .reverse()
    .map((c) => ({ date: new Date(c.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }), quality: c.qualityPct }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.employee?.fullName ?? node?.name ?? "Analyst"}</SheetTitle>
          <SheetDescription>Individually audited calls, most recent first</SheetDescription>
        </SheetHeader>

        {isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && data && data.calls.length === 0 && (
          <div className="mt-6">
            <EmptyState title="No audited calls in range" description="This analyst has no scored calls in the selected window." />
          </div>
        )}

        {!isLoading && chartData.length > 1 && (
          <div className="mt-6 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="mt-6 space-y-2">
          {(data?.calls ?? []).slice(0, 50).map((c) => (
            <Card key={c.id} className="border-border/60">
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{new Date(c.callDate).toLocaleString()}</p>
                  {c.areasForImprovement && (
                    <p className="truncate text-xs text-muted-foreground">{c.areasForImprovement}</p>
                  )}
                </div>
                <Badge variant={qualityTone(c.qualityPct) === "bad" ? "destructive" : "secondary"}>
                  {c.qualityPct !== null ? `${c.qualityPct}%` : "Unscored"}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SelfQualityScorecard({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["quality-dashboard-v2-self", employeeId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: AnalystCallsResponse }>(
        `/api/quality-dashboard-v2/analyst/${employeeId}/calls`,
      );
      return res.data;
    },
  });

  const calls = data?.calls ?? [];
  const scored = calls.filter((c) => c.qualityPct !== null);
  const avg = scored.length ? Math.round((scored.reduce((s, c) => s + (c.qualityPct ?? 0), 0) / scored.length) * 10) / 10 : null;
  const chartData = scored.slice().reverse().map((c) => ({
    date: new Date(c.callDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    quality: c.qualityPct,
  }));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading your scorecard…</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Calls audited (30d)</p><p className="mt-1 text-2xl font-semibold">{calls.length}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Average quality</p><p className={`mt-1 text-2xl font-semibold ${qualityTone(avg) === "good" ? "text-emerald-600" : qualityTone(avg) === "warn" ? "text-amber-600" : qualityTone(avg) === "bad" ? "text-rose-600" : ""}`}>{avg !== null ? `${avg}%` : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-5"><p className="text-xs uppercase text-muted-foreground">Scored calls</p><p className="mt-1 text-2xl font-semibold">{scored.length}</p></CardContent></Card>
      </div>
      {chartData.length > 1 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Your quality trend</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="quality" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);

export default function QualityDashboard() {
  const { data: roleData } = useUserRole();
  const [selectedAnalyst, setSelectedAnalyst] = useState<DrillNode | null>(null);
  const isSelfOnly = !!roleData?.primaryRole && SELF_ONLY_ROLES.has(roleData.primaryRole);

  return (
    <DashboardLayout
      subheader={
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold">Quality</p>
            <p className="text-xs text-muted-foreground">
              Call quality scored from {" "}
              <span className="font-medium">db_audit.call_quality_assessment</span> — last 30 days
            </p>
          </div>
        </div>
      }
    >
      <div className="p-4 sm:p-6">
        {isSelfOnly && roleData?.employeeId ? (
          <SelfQualityScorecard employeeId={roleData.employeeId} />
        ) : (
          <DrillDownDashboardShell
            queryKeyPrefix="quality-dashboard-v2"
            accentClassName="from-emerald-500/10 via-primary/5 to-transparent"
            fetchLevel={fetchQualityLevel}
            onSelectAnalyst={setSelectedAnalyst}
            headerRight={
              <Badge variant="outline" className="gap-1.5">
                <PhoneCall className="h-3 w-3" /> Live call audits <TrendingUp className="h-3 w-3" />
              </Badge>
            }
          />
        )}
      </div>

      <AnalystDetailSheet node={selectedAnalyst} open={!!selectedAnalyst} onOpenChange={(v) => !v && setSelectedAnalyst(null)} />
    </DashboardLayout>
  );
}
