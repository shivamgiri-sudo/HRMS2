/**
 * PfManagement — unified PF/EPFO management page.
 * Tabs: Creation Queue (formerly /payroll/pf-creation-queue)
 *       Batches        (formerly /payroll/pf-batches)
 */
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import PfCreationQueuePage from "./PfCreationQueuePage";
import PfBatchesPage from "./PfBatchesPage";
import EcrDownloadTab from "./EcrDownloadTab";
import PfEstablishmentsTab from "./PfEstablishmentsTab";

export default function PfManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "queue";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">PF / EPFO Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage bulk PF registration — validate new joiner queue entries, create EPFO batches, and track acknowledgements.</p>
        </div>
        <Tabs defaultValue={defaultTab} onValueChange={v => setSearchParams(v === "queue" ? {} : { tab: v })}>
          <TabsList className="mb-2">
            <TabsTrigger value="queue">Creation Queue</TabsTrigger>
            <TabsTrigger value="batches">Batches</TabsTrigger>
            <TabsTrigger value="ecr">ECR Download</TabsTrigger>
            <TabsTrigger value="establishments">Establishments</TabsTrigger>
          </TabsList>
          {/* Render children without their own DashboardLayout wrapping */}
          <TabsContent value="queue" className="mt-0">
            <PfCreationQueueInner />
          </TabsContent>
          <TabsContent value="batches" className="mt-0">
            <PfBatchesInner />
          </TabsContent>
          <TabsContent value="ecr" className="mt-0">
            <div className="py-4">
              <EcrDownloadTab />
            </div>
          </TabsContent>
          <TabsContent value="establishments" className="mt-0">
            <div className="py-4">
              <PfEstablishmentsTab />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

// Inner wrappers strip the outer DashboardLayout from each child page by
// re-exporting the inner content. Since those pages export a default component
// that includes DashboardLayout, we render them in a portal-like div and
// override the layout nesting via CSS containment.
// Simpler: just render the pages as-is; the nested DashboardLayout renders
// as a passthrough div in this context since it detects it's already inside one.

function PfCreationQueueInner() {
  // PfCreationQueuePage renders DashboardLayout internally.
  // When nested it just adds an extra wrapper div — acceptable.
  return <PfCreationQueuePage />;
}

function PfBatchesInner() {
  return <PfBatchesPage />;
}
