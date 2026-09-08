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
import EsiRegDocsTab from "./EsiRegDocsTab";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useTabAccess } from "@/components/security/TabGate";

/**
 * Mirrors ESI_ROLES in backend/src/modules/payroll/esi-reg-docs.routes.ts.
 *
 * The tab is hidden rather than shown-and-broken. The page itself admits a wider set of payroll
 * roles because its other four tabs serve them, but every ESI endpoint refuses anyone outside this
 * list — so payroll_hr and payroll users were being offered a tab whose every button returned 403.
 * Hiding it removes a control that never worked; it takes nothing away that anyone could use.
 *
 * The backend guard remains the security boundary. This only stops the UI advertising access the
 * API does not grant.
 */
const ESI_TAB_ROLES = ["payroll_branch", "payroll_head", "super_admin"];

export default function PfManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasAnyRole } = useWorkforceAccess();
  const canSeeEsi = hasAnyRole(...ESI_TAB_ROLES);

  // Creation Queue and Batches were separate routes with their own page codes before this
  // merge; those codes and their grants still exist, so the tabs are gated on them again
  // rather than on PAYROLL_PF_MANAGEMENT alone. ECR Download and Establishments have no
  // page code of their own and stay on the page grant — giving them one would mean
  // inventing a code and a grant, which is a policy decision, not a wiring fix.
  //
  // Controlled rather than defaultValue: an uncontrolled Tabs ignores a later change to
  // the active tab, so the fallback below (requested tab not permitted -> first permitted
  // tab) would not take effect.
  const { canViewTab, activeTab } = useTabAccess(
    { queue: "PAYROLL_PF_CREATION_QUEUE", batches: "PAYROLL_PF_BATCHES" },
    searchParams.get("tab") ?? "queue",
  );
  // Tabs with no page code of their own remain selectable for anyone holding the page.
  const UNGATED_TABS = ["ecr", "establishments", "esi-reg"];
  const requestedTab = searchParams.get("tab") ?? "queue";
  const currentTab = UNGATED_TABS.includes(requestedTab) ? requestedTab : activeTab ?? "ecr";

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">PF / EPFO Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage bulk PF registration — validate new joiner queue entries, create EPFO batches, and track acknowledgements.</p>
        </div>
        <Tabs value={currentTab} onValueChange={v => setSearchParams(v === "queue" ? {} : { tab: v })}>
          <TabsList className="mb-2">
            {canViewTab("queue") && <TabsTrigger value="queue">Creation Queue</TabsTrigger>}
            {canViewTab("batches") && <TabsTrigger value="batches">Batches</TabsTrigger>}
            <TabsTrigger value="ecr">ECR Download</TabsTrigger>
            <TabsTrigger value="establishments">Establishments</TabsTrigger>
            {canSeeEsi && <TabsTrigger value="esi-reg">ESI Reg. Docs</TabsTrigger>}
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
          {canSeeEsi && (
            <TabsContent value="esi-reg" className="mt-0">
              <EsiRegDocsTab />
            </TabsContent>
          )}
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
