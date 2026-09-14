import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell, HrmsBentoTile } from "@/components/ui/hrms-modern";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Briefcase, ClipboardList, CheckCircle2, Clock, Users, TrendingUp } from "lucide-react";
import { IjpAdminPostings } from "@/components/ijp/IjpAdminPostings";
import { IjpApplicationsReview } from "@/components/ijp/IjpApplicationsReview";
import { useIjpStats } from "@/components/ijp/useIjp";

function IjpAdminStats() {
  const { data: stats, isLoading } = useIjpStats();

  if (isLoading) {
    return (
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
      <HrmsBentoTile
        title="Total Postings"
        value={stats.total_postings}
        detail="all time"
        icon={<Briefcase className="h-5 w-5 text-slate-600" />}
        accentClassName="from-slate-400 to-slate-500"
      />
      <HrmsBentoTile
        title="Open Now"
        value={stats.open_postings}
        detail="accepting applications"
        icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
        accentClassName="from-emerald-500 to-teal-500"
      />
      <HrmsBentoTile
        title="Total Applications"
        value={stats.total_applications}
        detail="all postings"
        icon={<Users className="h-5 w-5 text-blue-600" />}
        accentClassName="from-blue-500 to-cyan-500"
      />
      <HrmsBentoTile
        title="Pending Review"
        value={stats.pending_review}
        detail="awaiting HR action"
        icon={<Clock className="h-5 w-5 text-amber-600" />}
        accentClassName="from-amber-400 to-orange-500"
      />
      <HrmsBentoTile
        title="Selected (Month)"
        value={stats.selected_this_month}
        detail="this month"
        icon={<TrendingUp className="h-5 w-5 text-violet-600" />}
        accentClassName="from-violet-500 to-purple-500"
        className="col-span-2 sm:col-span-1"
      />
    </div>
  );
}

export default function IjpAdminPage() {
  const [activeTab, setActiveTab] = useState("postings");
  const [viewingPostingId, setViewingPostingId] = useState<string | null>(null);

  const handleViewApplications = (postingId: string) => {
    setViewingPostingId(postingId);
    setActiveTab("applications");
  };

  const handleBackToPostings = () => {
    setViewingPostingId(null);
    setActiveTab("postings");
  };

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Recruitment"
        title="Internal Job Postings"
        description="Create and manage internal career opportunities. Review applications and track selection progress."
        icon={<Briefcase className="h-6 w-6" />}
      >
        <IjpAdminStats />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-10 w-full max-w-xs grid grid-cols-2">
            <TabsTrigger value="postings" className="gap-1.5 text-xs sm:text-sm">
              <Briefcase className="h-3.5 w-3.5" />
              Postings
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-1.5 text-xs sm:text-sm">
              <ClipboardList className="h-3.5 w-3.5" />
              Applications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="postings" className="mt-4">
            <IjpAdminPostings onViewApplications={handleViewApplications} />
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            {viewingPostingId ? (
              <IjpApplicationsReview
                postingId={viewingPostingId}
                onBack={handleBackToPostings}
              />
            ) : (
              <Card className="border-dashed">
                <CardContent className="py-14 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100">
                    <ClipboardList className="h-7 w-7 text-slate-400" />
                  </div>
                  <p className="text-base font-semibold text-slate-700">No posting selected</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Go to the <strong>Postings</strong> tab and click <strong>View Applications</strong> on any posting.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </HrmsModernShell>
    </DashboardLayout>
  );
}
