/**
 * Agent Quality Dashboard
 * Main page for individual agent self-monitoring and quality tracking
 *
 * Auth Gate: Agent/Employee role only
 * Layout: Hero → 2x2 Grid (Weakness + Trends) → Full-width Calls Table → Modal
 * Responsive: Desktop 2-col, Mobile stacked
 * Empty States: NoCalls, ScoringPending, DataError
 */
import { useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAgentQualityData, useCallDetail } from "@/hooks/useAgentQualityData";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HeroCard } from "@/components/quality-dashboard/HeroCard";
import { QuickWins } from "@/components/quality-dashboard/QuickWins";
import { WeaknessPanel } from "@/components/quality-dashboard/WeaknessPanel";
import { TrendPanel } from "@/components/quality-dashboard/TrendPanel";
import { CallsTable } from "@/components/quality-dashboard/CallsTable";
import { CallDetailModal } from "@/components/quality-dashboard/CallDetailModal";
import { NoCalls } from "@/components/quality-dashboard/empty-states/NoCalls";
import { ScoringPending } from "@/components/quality-dashboard/empty-states/ScoringPending";
import { DataError } from "@/components/quality-dashboard/empty-states/DataError";
import { Card } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";

export default function AgentQualityDashboard() {
  const { user } = useAuth();
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Fetch all quality data in parallel
  const {
    cqScore,
    weakness,
    callsReview,
    isLoading,
    error,
    refetch,
    cqScoreLoading,
    weaknessLoading,
    callsLoading,
  } = useAgentQualityData(user?.id);

  // Lazy load call detail when modal opens
  const { data: callDetail } = useCallDetail(isModalOpen ? selectedCallId : null);

  // Check if we have no calls at all
  const hasNoCalls = useMemo(() => {
    return !isLoading && callsReview && callsReview.total_calls === 0;
  }, [isLoading, callsReview]);

  // Check if we have calls but they're pending scoring
  const hasPendingScoring = useMemo(() => {
    return (
      !isLoading &&
      callsReview &&
      callsReview.total_calls > 0 &&
      callsReview.calls.length === 0
    );
  }, [isLoading, callsReview]);

  // Determine which empty state to show
  const showEmptyState = useMemo(() => {
    if (error) return "error";
    if (hasNoCalls) return "no-calls";
    if (hasPendingScoring) return "scoring-pending";
    return null;
  }, [error, hasNoCalls, hasPendingScoring]);

  // Loading skeleton for hero card
  const HeroSkeleton = () => (
    <Card className="p-6 md:p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-200 rounded w-1/3"></div>
        <div className="h-64 bg-slate-200 rounded"></div>
      </div>
    </Card>
  );

  // Loading skeleton for panel
  const PanelSkeleton = () => (
    <Card className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-slate-200 rounded w-1/2"></div>
        <div className="h-40 bg-slate-200 rounded"></div>
      </div>
    </Card>
  );

  // Loading skeleton for table
  const TableSkeleton = () => (
    <Card className="p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-200 rounded"></div>
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-slate-200 rounded"></div>
          ))}
        </div>
      </div>
    </Card>
  );

  // Auth gate - only agents/employees can view
  if (!user) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Quality Dashboard</h1>
          <p className="text-slate-600 mt-2">
            Monitor your call quality metrics and identify areas for improvement
          </p>
        </div>

        {/* Error State */}
        {showEmptyState === "error" && (
          <DataError onRetry={refetch} />
        )}

        {/* No Calls State */}
        {showEmptyState === "no-calls" && <NoCalls />}

        {/* Scoring Pending State */}
        {showEmptyState === "scoring-pending" && <ScoringPending />}

        {/* Main Content (shown when not in empty state) */}
        {!showEmptyState && (
          <>
            {/* Hero Card - Full Width */}
            <div className="w-full">
              {cqScoreLoading ? (
                <HeroSkeleton />
              ) : cqScore ? (
                <HeroCard data={cqScore} isLoading={false} />
              ) : (
                <Card className="p-6 border-yellow-200 bg-yellow-50">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="h-5 w-5 text-yellow-600 mt-1 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold text-yellow-900">
                        Quality Score Unavailable
                      </h3>
                      <p className="text-sm text-yellow-700 mt-1">
                        Your CQ score could not be loaded. Please refresh the page.
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Quick Wins Card */}
            <div className="w-full">
              {cqScoreLoading ? (
                <PanelSkeleton />
              ) : cqScore ? (
                <QuickWins data={cqScore} />
              ) : null}
            </div>

            {/* 2x2 Grid - Weakness + Trends */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Weakness Panel */}
              <div>
                {weaknessLoading ? (
                  <PanelSkeleton />
                ) : weakness ? (
                  <WeaknessPanel data={weakness} />
                ) : (
                  <Card className="p-6 text-center text-slate-500">
                    No weakness data available
                  </Card>
                )}
              </div>

              {/* Trend Panel */}
              <div>
                {cqScoreLoading ? (
                  <PanelSkeleton />
                ) : cqScore ? (
                  <TrendPanel data={cqScore} />
                ) : (
                  <Card className="p-6 text-center text-slate-500">
                    No trend data available
                  </Card>
                )}
              </div>
            </div>

            {/* Calls Table - Full Width */}
            <div className="w-full">
              {callsLoading ? (
                <TableSkeleton />
              ) : callsReview && callsReview.calls.length > 0 ? (
                <CallsTable
                  data={callsReview}
                  onRowClick={(call) => {
                    setSelectedCallId(call.call_id);
                    setIsModalOpen(true);
                  }}
                />
              ) : (
                <Card className="p-6 text-center text-slate-500">
                  No calls available yet
                </Card>
              )}
            </div>
          </>
        )}

        {/* Call Detail Modal */}
        <CallDetailModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedCallId(null);
          }}
          callDetail={callDetail}
          isLoading={!callDetail && isModalOpen}
        />
      </div>
    </DashboardLayout>
  );
}
