import { Suspense, lazy, useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Loader2,
  IndianRupee,
  Plus,
  RefreshCcw,
  ShieldCheck,
  UserMinus,
  Users,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { RaiseExitDialog } from "@/components/exit/RaiseExitDialog";
import { NOC_INITIATOR_EVIDENCE, type CenterData } from "./exit/shared";
const AnalyticsTab = lazy(() => import("./exit/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab })));
const ExitTaskBoardTab = lazy(() => import("./exit/ExitTaskBoardTab").then((m) => ({ default: m.ExitTaskBoardTab })));
const BulkActionsTab = lazy(() => import("./exit/BulkActionsTab").then((m) => ({ default: m.BulkActionsTab })));
const FfSettlementPanel = lazy(() => import("./exit/FfSettlementPanel").then((m) => ({ default: m.FfSettlementPanel })));
import { OverviewTab } from "./exit/OverviewTab";
const AonAnalyticsView = lazy(() => import("@/components/reports/views/AonAnalyticsView"));

const TabFallback = () => (
  <div className="flex items-center justify-center py-16 text-slate-400" role="status">
    <Loader2 className="h-5 w-5 animate-spin" />
    <span className="ml-2 text-sm">Loading…</span>
  </div>
);

const MAIN_TABS = ["overview", "task-board", "ff", "insights"] as const;
const INSIGHT_TABS = ["analytics", "aon", "notice", "bulk"] as const;
const NoticePeriodTab = lazy(() => import("./exit/NoticePeriodTab").then((m) => ({ default: m.NoticePeriodTab })));

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function NativeExitCommandCenter() {
  const { hasAnyRole } = useWorkforceAccess();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab") ?? "overview";
  const tab = (MAIN_TABS as readonly string[]).includes(tabParam) ? tabParam : "overview";
  const insightParam = params.get("insight") ?? "analytics";
  const insight = (INSIGHT_TABS as readonly string[]).includes(insightParam) ? insightParam : "analytics";
  const setTab = (value: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set("tab", value); return n; }, { replace: true });
  const setInsight = (value: string) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set("insight", value); return n; }, { replace: true });

  // Cached: revisiting the page paints instantly from cache and revalidates in the background.
  const query = useQuery({
    queryKey: ["exit-command-center"],
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>("/api/exit/command-center");
      return res.data;
    },
  });
  const data = query.data ?? null;
  const loading = query.isLoading;
  const refreshing = query.isFetching;

  // ── Create exit request ──────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const load = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["exit-command-center"] });
  }, [qc]);

  const handleStatusChange = async (
    id: string,
    status: string,
  ): Promise<number> => {
    const res: any = await hrmsApi.patch(`/api/exit/${id}/status`, {
      status,
      remarks: `Moved to ${status}`,
    });
    await load();
    return Number(res?.pendingAtExit ?? res?.data?.pendingAtExit ?? 0);
  };

  const handleGenerateClearance = async (id: string) => {
    await hrmsApi.post(`/api/exit/${id}/clearance/generate`, {});
    await load();
  };

  // Opens (or, harmlessly, re-fetches) the NOC clearance case for one exit. openCase() on
  // the backend is idempotent — a case that already exists for this employee is returned
  // as-is rather than duplicated — so this button is always safe to click again.
  const handleStartNocClearance = async (
    exitRequestId: string,
    employeeId: string,
  ) => {
    const initiatorRole =
      NOC_INITIATOR_EVIDENCE.find((e) => hasAnyRole(...e.roleKeys))?.role ??
      "hr";
    await hrmsApi.post("/api/payroll/noc-cases", {
      employeeId,
      initiatorRole,
      exitRequestId,
    });
  };

  return (
    <DashboardLayout>
      <main className="space-y-6 p-6 lg:p-8">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-rose-600 via-red-600 to-orange-600 text-white p-6 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                <UserMinus className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight leading-tight">
                  Exit Command Center
                </h1>
                <p className="text-rose-200 text-sm mt-0.5">
                  Resignation · Retention · Clearance · F&F · Analytics
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowCreate(true)}
                variant="outline"
                className="bg-white/20 border-white/30 text-white hover:bg-white/30 hover:text-white font-semibold"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Exit Request
              </Button>
              <Button
                onClick={load}
                disabled={refreshing}
                variant="outline"
                className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
              >
                <RefreshCcw
                  className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs: four working areas; secondary tools live under Insights */}
        {query.isError && !data && (
          <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span>Could not load exit data. This is a load failure, not zero exits.</span>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="sticky top-0 z-20 bg-white/95 border border-white/60 backdrop-blur-sm p-1 rounded-xl flex-wrap shadow-sm">
            {[
              { value: "overview", label: "Overview", icon: Users },
              {
                value: "task-board",
                label: "Exit Task Board",
                icon: ShieldCheck,
              },
              { value: "ff", label: "F&F Settlement", icon: IndianRupee },
              { value: "insights", label: "Insights & Tools", icon: BarChart3 },
            ].map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="data-[state=active]:bg-rose-600 data-[state=active]:text-white rounded-lg min-h-[44px] sm:min-h-0"
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab
              data={data}
              loading={loading}
              onStatusChange={handleStatusChange}
              onGenerateClearance={handleGenerateClearance}
              onStartNocClearance={handleStartNocClearance}
            />
          </TabsContent>

          <TabsContent value="task-board">
            <Suspense fallback={<TabFallback />}>
              <ExitTaskBoardTab
                exitRequests={data?.requests ?? []}
                loading={loading}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="ff">
            <Suspense fallback={<TabFallback />}>
              <FfSettlementPanel exitRequests={data?.requests ?? []} />
            </Suspense>
          </TabsContent>

          <TabsContent value="insights">
            <Tabs value={insight} onValueChange={setInsight} className="space-y-4">
              <TabsList className="bg-slate-100 rounded-xl">
                <TabsTrigger value="analytics" className="rounded-lg">
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="aon" className="rounded-lg">
                  AON &amp; Attrition
                </TabsTrigger>
                <TabsTrigger value="notice" className="rounded-lg">
                  Notice Period
                </TabsTrigger>
                <TabsTrigger value="bulk" className="rounded-lg">
                  Bulk Actions
                </TabsTrigger>
              </TabsList>
              <Suspense fallback={<TabFallback />}>
                <TabsContent value="analytics">
                  <AnalyticsTab data={data} loading={loading} />
                </TabsContent>
                <TabsContent value="aon">
                  <AonAnalyticsView />
                </TabsContent>
                <TabsContent value="notice">
                  <NoticePeriodTab />
                </TabsContent>
                <TabsContent value="bulk">
                  <BulkActionsTab
                    exitRequests={data?.requests ?? []}
                    onRefresh={load}
                  />
                </TabsContent>
              </Suspense>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>

      {showCreate && (
        <RaiseExitDialog onClose={() => setShowCreate(false)} onSubmitted={() => void load()} />
      )}
    </DashboardLayout>
  );
}

