import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CostCentreListView } from "@/components/finance/cost-centre/CostCentreListView";
import { CostCentreApprovalQueue } from "@/components/finance/cost-centre/CostCentreApprovalQueue";
import { CostCentreSheet } from "@/components/finance/cost-centre/CostCentreSheet";
import { useCostCentreDetail, type CostCentreRecord } from "@/hooks/useCostCentreManagement";
import { useAuth } from "@/contexts/AuthContext";

type SheetMode = "create" | "edit" | "view";

export default function CostCentreManagementPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("list");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: selectedCostCentre, refetch } = useCostCentreDetail(selectedId);

  const userRole = String(user?.role ?? "").toLowerCase();
  const canViewQueue = ["finance_head", "accounts_head", "admin", "super_admin"].includes(userRole);

  const openCreate = () => {
    setSelectedId(null);
    setSheetMode("create");
    setSheetOpen(true);
  };

  const openView = (cc: CostCentreRecord) => {
    setSelectedId(cc.id);
    setSheetMode("view");
    setSheetOpen(true);
  };

  const openEdit = (cc: CostCentreRecord) => {
    setSelectedId(cc.id);
    setSheetMode("edit");
    setSheetOpen(true);
  };

  const handleSaved = () => {
    refetch();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Cost Centre Management</h1>
          <p className="text-muted-foreground">
            Create and manage cost centres with approval workflow
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="list">Cost Centres</TabsTrigger>
            {canViewQueue && <TabsTrigger value="queue">Approval Queue</TabsTrigger>}
          </TabsList>

          <TabsContent value="list" className="mt-4">
            <CostCentreListView onView={openView} onEdit={openEdit} onCreate={openCreate} />
          </TabsContent>

          {canViewQueue && (
            <TabsContent value="queue" className="mt-4">
              <CostCentreApprovalQueue onReview={openView} />
            </TabsContent>
          )}
        </Tabs>

        <CostCentreSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          mode={sheetMode}
          costCentre={selectedCostCentre}
          onSaved={handleSaved}
        />
      </div>
    </DashboardLayout>
  );
}
