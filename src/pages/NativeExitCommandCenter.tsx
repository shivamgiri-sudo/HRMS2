import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
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
import { AnalyticsTab } from "./exit/AnalyticsTab";
import { ExitTaskBoardTab } from "./exit/ExitTaskBoardTab";
import { BulkActionsTab } from "./exit/BulkActionsTab";
import { FfSettlementPanel } from "./exit/FfSettlementPanel";
import { OverviewTab } from "./exit/OverviewTab";
import { NoticePeriodTab } from "./exit/NoticePeriodTab";

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function NativeExitCommandCenter() {
  const [data, setData] = useState<CenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const { hasAnyRole } = useWorkforceAccess();

  // ── Create exit request ──────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: CenterData }>(
        "/api/exit/command-center",
      );
      setData(res.data);
    } catch (err: any) {
      console.error("Exit command center load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
                disabled={loading}
                variant="outline"
                className="bg-white/10 border-white/30 text-white hover:bg-white/20 hover:text-white"
              >
                <RefreshCcw
                  className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Tabs: four working areas; secondary tools live under Insights */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="bg-white/95 border border-white/60 backdrop-blur-sm p-1 rounded-xl flex-wrap">
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
            <ExitTaskBoardTab
              exitRequests={data?.requests ?? []}
              loading={loading}
            />
          </TabsContent>

          <TabsContent value="ff">
            <FfSettlementPanel exitRequests={data?.requests ?? []} />
          </TabsContent>

          <TabsContent value="insights">
            <Tabs defaultValue="analytics" className="space-y-4">
              <TabsList className="bg-slate-100 rounded-xl">
                <TabsTrigger value="analytics" className="rounded-lg">
                  Analytics
                </TabsTrigger>
                <TabsTrigger value="notice" className="rounded-lg">
                  Notice Period
                </TabsTrigger>
                <TabsTrigger value="bulk" className="rounded-lg">
                  Bulk Actions
                </TabsTrigger>
              </TabsList>
              <TabsContent value="analytics">
                <AnalyticsTab data={data} loading={loading} />
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

