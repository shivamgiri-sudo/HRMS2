import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { BasicInfoSection } from "./sections/BasicInfoSection";
import { OperationalSection } from "./sections/OperationalSection";
import { BillingSection } from "./sections/BillingSection";
import { AddressesSection } from "./sections/AddressesSection";
import { ContactsSection } from "./sections/ContactsSection";
import { GstTaxSection } from "./sections/GstTaxSection";
import {
  useCreateCostCentre,
  useUpdateCostCentre,
  useSubmitCostCentre,
  useApproveL1CostCentre,
  useApproveL2CostCentre,
  useRejectCostCentre,
  useRequestRevisionCostCentre,
  useActivateCostCentre,
  useCloseCostCentre,
  type CostCentreRecord,
  type CostCentreInput,
} from "@/hooks/useCostCentreManagement";
import { useHasRole } from "@/hooks/useUserRole";

type SheetMode = "create" | "edit" | "view";

interface CostCentreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SheetMode;
  costCentre?: CostCentreRecord | null;
  onSaved?: () => void;
}

const emptyInput: CostCentreInput = {
  cost_centre_code: "",
  cost_centre_name: "",
  client_id: "",
  lob_id: "",
  branch_id: "",
  process_id: "",
  contacts: [],
};

export function CostCentreSheet({ open, onOpenChange, mode, costCentre, onSaved }: CostCentreSheetProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [data, setData] = useState<Partial<CostCentreInput>>(emptyInput);
  const [actionDialog, setActionDialog] = useState<{ type: string; title: string } | null>(null);
  const [actionReason, setActionReason] = useState("");

  const createMutation = useCreateCostCentre();
  const updateMutation = useUpdateCostCentre();
  const submitMutation = useSubmitCostCentre();
  const approveL1Mutation = useApproveL1CostCentre();
  const approveL2Mutation = useApproveL2CostCentre();
  const rejectMutation = useRejectCostCentre();
  const revisionMutation = useRequestRevisionCostCentre();
  const activateMutation = useActivateCostCentre();
  const closeMutation = useCloseCostCentre();

  const isLoading =
    createMutation.isPending ||
    updateMutation.isPending ||
    submitMutation.isPending ||
    approveL1Mutation.isPending ||
    approveL2Mutation.isPending ||
    rejectMutation.isPending ||
    revisionMutation.isPending ||
    activateMutation.isPending ||
    closeMutation.isPending;

  useEffect(() => {
    if (open) {
      if (mode === "create") {
        setData(emptyInput);
      } else if (costCentre) {
        setData({
          cost_centre_code: costCentre.cost_centre_code,
          cost_centre_name: costCentre.cost_centre_name,
          client_id: costCentre.client_id,
          lob_id: costCentre.lob_id,
          branch_id: costCentre.branch_id,
          process_id: costCentre.process_id,
          department_id: costCentre.department_id,
          mandated_seats_value: costCentre.mandated_seats_value,
          shrinkage_percentage: costCentre.shrinkage_percentage,
          attrition_percentage: costCentre.attrition_percentage,
          shift_hours: costCentre.shift_hours,
          working_days_per_week: costCentre.working_days_per_week,
          training_days: costCentre.training_days,
          incentive_allowed: !!costCentre.incentive_allowed,
          deduction_allowed: !!costCentre.deduction_allowed,
          revenue_flag: !!costCentre.revenue_flag,
          billing_flag: !!costCentre.billing_flag,
          revenue_type: costCentre.revenue_type,
          fixed_amount: costCentre.fixed_amount,
          variable_base: costCentre.variable_base,
          payment_mode: costCentre.payment_mode,
          payment_terms: costCentre.payment_terms,
          hsn_code: costCentre.hsn_code,
          sac_code: costCentre.sac_code,
          service_tax_no: costCentre.service_tax_no,
          vendor_state_code: costCentre.vendor_state_code,
          bill_to_address1: costCentre.bill_to_address1,
          bill_to_address2: costCentre.bill_to_address2,
          bill_to_address3: costCentre.bill_to_address3,
          bill_to_city: costCentre.bill_to_city,
          bill_to_pincode: costCentre.bill_to_pincode,
          ship_to_address1: costCentre.ship_to_address1,
          ship_to_address2: costCentre.ship_to_address2,
          ship_to_address3: costCentre.ship_to_address3,
          ship_to_city: costCentre.ship_to_city,
          ship_to_pincode: costCentre.ship_to_pincode,
          association_date: costCentre.association_date,
          contacts: costCentre.contacts ?? [],
        });
      }
      setActiveTab("basic");
    }
  }, [open, mode, costCentre]);

  const handleChange = (updates: Partial<CostCentreInput>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const validate = (): boolean => {
    if (!data.cost_centre_code?.trim()) {
      toast.error("Cost Centre Code is required");
      return false;
    }
    if (!data.cost_centre_name?.trim()) {
      toast.error("Cost Centre Name is required");
      return false;
    }
    if (!data.client_id) {
      toast.error("Client is required");
      return false;
    }
    if (!data.lob_id) {
      toast.error("LOB is required");
      return false;
    }
    if (!data.branch_id) {
      toast.error("Branch is required");
      return false;
    }
    if (!data.process_id) {
      toast.error("Process is required");
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      if (mode === "create") {
        await createMutation.mutateAsync(data as CostCentreInput);
        toast.success("Cost centre created as draft");
      } else if (costCentre) {
        await updateMutation.mutateAsync({ id: costCentre.id, data });
        toast.success("Cost centre updated");
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to save");
    }
  };

  const handleSubmit = async () => {
    if (!costCentre) return;
    try {
      await submitMutation.mutateAsync(costCentre.id);
      toast.success("Cost centre submitted for approval");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Failed to submit");
    }
  };

  const handleAction = async () => {
    if (!costCentre || !actionDialog) return;

    try {
      switch (actionDialog.type) {
        case "approve_l1":
          await approveL1Mutation.mutateAsync({ id: costCentre.id, remarks: actionReason || undefined });
          toast.success("L1 approval granted");
          break;
        case "approve_l2":
          await approveL2Mutation.mutateAsync({ id: costCentre.id, remarks: actionReason || undefined });
          toast.success("L2 approval granted");
          break;
        case "reject":
          if (!actionReason.trim()) {
            toast.error("Rejection reason is required");
            return;
          }
          await rejectMutation.mutateAsync({ id: costCentre.id, reason: actionReason });
          toast.success("Cost centre rejected");
          break;
        case "revision":
          if (!actionReason.trim()) {
            toast.error("Revision reason is required");
            return;
          }
          await revisionMutation.mutateAsync({ id: costCentre.id, reason: actionReason });
          toast.success("Revision requested");
          break;
        case "activate":
          await activateMutation.mutateAsync(costCentre.id);
          toast.success("Cost centre activated");
          break;
        case "close":
          await closeMutation.mutateAsync({ id: costCentre.id, reason: actionReason || undefined });
          toast.success("Cost centre closed");
          break;
      }
      setActionDialog(null);
      setActionReason("");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Action failed");
    }
  };

  // useHasRole, not user.role: HrmsUser carries only { id, email, isReadOnly },
  // so `user?.role` was always undefined and every approval action below was
  // permanently hidden — the cost-centre workflow could never leave draft.
  const isFinanceApprover = useHasRole("finance_head", "accounts_head", "admin", "super_admin");
  const isAdmin = useHasRole("admin", "super_admin");

  const canEdit = mode !== "view" && ["draft", "revision_required"].includes(costCentre?.status ?? "draft");
  const canSubmit = costCentre && ["draft", "revision_required"].includes(costCentre.status);
  const canApproveL1 = costCentre?.status === "pending_l1" && isFinanceApprover;
  const canApproveL2 = costCentre?.status === "pending_l2" && isAdmin;
  const canActivate = costCentre?.status === "approved" && isAdmin;
  const canClose = costCentre?.status === "active" && isFinanceApprover;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[720px] max-w-full p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle>
                {mode === "create" ? "New Cost Centre" : mode === "edit" ? "Edit Cost Centre" : "View Cost Centre"}
              </SheetTitle>
              {costCentre && <StatusBadge status={costCentre.status} />}
            </div>
            {costCentre && (
              <p className="text-sm text-muted-foreground">
                {costCentre.cost_centre_code} - {costCentre.cost_centre_name}
              </p>
            )}
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="px-6 pt-2 shrink-0">
              <TabsTrigger value="basic">Basic</TabsTrigger>
              <TabsTrigger value="operational">Operations</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
              <TabsTrigger value="addresses">Addresses</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="gst">GST/Tax</TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="basic" className="m-0">
                <BasicInfoSection data={data} onChange={handleChange} disabled={!canEdit} isEdit={mode === "edit"} />
              </TabsContent>
              <TabsContent value="operational" className="m-0">
                <OperationalSection data={data} onChange={handleChange} disabled={!canEdit} />
              </TabsContent>
              <TabsContent value="billing" className="m-0">
                <BillingSection data={data} onChange={handleChange} disabled={!canEdit} />
              </TabsContent>
              <TabsContent value="addresses" className="m-0">
                <AddressesSection data={data} onChange={handleChange} disabled={!canEdit} />
              </TabsContent>
              <TabsContent value="contacts" className="m-0">
                <ContactsSection data={data} onChange={handleChange} disabled={!canEdit} />
              </TabsContent>
              <TabsContent value="gst" className="m-0">
                <GstTaxSection data={data} onChange={handleChange} disabled={!canEdit} />
              </TabsContent>
            </div>
          </Tabs>

          <SheetFooter className="px-6 py-4 border-t shrink-0 flex-row gap-2 justify-between">
            <div className="flex gap-2">
              {canClose && (
                <Button variant="outline" onClick={() => setActionDialog({ type: "close", title: "Close Cost Centre" })}>
                  Close
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {canApproveL1 && (
                <>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "reject", title: "Reject" })}>
                    Reject
                  </Button>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "revision", title: "Request Revision" })}>
                    Request Revision
                  </Button>
                  <Button onClick={() => setActionDialog({ type: "approve_l1", title: "Approve L1" })}>
                    Approve L1
                  </Button>
                </>
              )}
              {canApproveL2 && (
                <>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "reject", title: "Reject" })}>
                    Reject
                  </Button>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "revision", title: "Request Revision" })}>
                    Request Revision
                  </Button>
                  <Button onClick={() => setActionDialog({ type: "approve_l2", title: "Approve L2" })}>
                    Approve L2
                  </Button>
                </>
              )}
              {canActivate && (
                <Button onClick={() => setActionDialog({ type: "activate", title: "Activate" })}>
                  Activate
                </Button>
              )}
              {canEdit && (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Draft
                  </Button>
                  {canSubmit && (
                    <Button onClick={handleSubmit} disabled={isLoading}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Submit for Approval
                    </Button>
                  )}
                </>
              )}
              {mode === "view" && !canApproveL1 && !canApproveL2 && !canActivate && !canClose && (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              )}
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{actionDialog?.title}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {["reject", "revision", "close"].includes(actionDialog?.type ?? "") ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {actionDialog?.type === "reject" ? "Rejection Reason *" : actionDialog?.type === "revision" ? "Revision Reason *" : "Close Reason"}
                </label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Enter reason..."
                  rows={3}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Remarks (optional)</label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Enter remarks..."
                  rows={3}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleAction} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
