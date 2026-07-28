import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell, HrmsBentoTile } from "@/components/ui/hrms-modern";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, FileText, TrendingUp } from "lucide-react";
import { IjpOpportunities } from "@/components/ijp/IjpOpportunities";
import { IjpMyApplications } from "@/components/ijp/IjpMyApplications";
import { useMyIjpApplications, useEligibleIjpPostings } from "@/components/ijp/useIjp";

function IjpEmployeeStats() {
  const { data: eligibleData } = useEligibleIjpPostings();
  const { data: appsData } = useMyIjpApplications();

  const openCount    = eligibleData?.postings?.filter((p: { eligible: boolean }) => p.eligible).length ?? 0;
  const totalPostings = eligibleData?.postings?.length ?? 0;
  const activeApps   = appsData?.applications?.filter((a: { status: string }) =>
    !['rejected','withdrawn','offer_declined'].includes(a.status)
  ).length ?? 0;
  const totalApps    = appsData?.total ?? 0;

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
      <HrmsBentoTile
        title="Open Opportunities"
        value={openCount}
        detail={`${totalPostings} total postings`}
        icon={<Briefcase className="h-5 w-5 text-blue-600" />}
        accentClassName="from-blue-500 to-cyan-500"
      />
      <HrmsBentoTile
        title="Active Applications"
        value={activeApps}
        detail={`${totalApps} submitted total`}
        icon={<FileText className="h-5 w-5 text-violet-600" />}
        accentClassName="from-violet-500 to-purple-500"
      />
      <HrmsBentoTile
        title="Eligible Roles"
        value={openCount}
        detail="roles you can apply to"
        icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
        accentClassName="from-emerald-500 to-teal-500"
        className="col-span-2 sm:col-span-1"
      />
    </div>
  );
}

export default function IjpPage() {
  const [tab, setTab] = useState("opportunities");

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Career Growth"
        title="Internal Opportunities"
        description="Explore open positions across departments, processes and branches. Apply internally and grow your career at MAS Callnet."
        icon={<Briefcase className="h-6 w-6" />}
      >
        <IjpEmployeeStats />

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="h-10 w-full max-w-xs grid grid-cols-2">
            <TabsTrigger value="opportunities" className="gap-1.5 text-xs sm:text-sm">
              <Briefcase className="h-3.5 w-3.5" />
              Opportunities
            </TabsTrigger>
            <TabsTrigger value="applications" className="gap-1.5 text-xs sm:text-sm">
              <FileText className="h-3.5 w-3.5" />
              My Applications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="opportunities" className="mt-4">
            <IjpOpportunities />
          </TabsContent>

          <TabsContent value="applications" className="mt-4">
            <IjpMyApplications />
          </TabsContent>
        </Tabs>
      </HrmsModernShell>
    </DashboardLayout>
  );
}
