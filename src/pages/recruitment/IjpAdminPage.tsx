import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, ClipboardList, BarChart3 } from "lucide-react";
import { IjpAdminPostings } from "@/components/ijp/IjpAdminPostings";
import { IjpApplicationsReview } from "@/components/ijp/IjpApplicationsReview";
import { useIjpStats } from "@/components/ijp/useIjp";
import { Skeleton } from "@/components/ui/skeleton";

function IjpStatsCards() {
  const { data: stats, isLoading } = useIjpStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Postings</CardDescription>
          <CardTitle className="text-3xl">{stats.total_postings}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Open Postings</CardDescription>
          <CardTitle className="text-3xl text-green-600">{stats.open_postings}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total Applications</CardDescription>
          <CardTitle className="text-3xl">{stats.total_applications}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Pending Review</CardDescription>
          <CardTitle className="text-3xl text-amber-600">{stats.pending_review}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Selected (Month)</CardDescription>
          <CardTitle className="text-3xl text-blue-600">{stats.selected_this_month}</CardTitle>
        </CardHeader>
      </Card>
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
      <div className="container py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Internal Job Postings</h1>
          <p className="text-muted-foreground">
            Create and manage internal career opportunities
          </p>
        </div>

        <IjpStatsCards />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="postings" className="gap-2">
              <Briefcase className="h-4 w-4" />
              Postings
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Applications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="postings" className="mt-6">
            <IjpAdminPostings onViewApplications={handleViewApplications} />
          </TabsContent>

          <TabsContent value="applications" className="mt-6">
            {viewingPostingId ? (
              <IjpApplicationsReview postingId={viewingPostingId} onBack={handleBackToPostings} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-lg font-medium">Select a Posting</p>
                  <p className="text-muted-foreground">
                    Go to Postings tab and click "View Applications" on any posting
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
