import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Building2, Settings2, CreditCard, MapPin, Users, Receipt, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

const NAV_TABS = [
  { value: "basic",       label: "Basic Info",    icon: Building2  },
  { value: "operational", label: "Operations",    icon: Settings2  },
  { value: "billing",     label: "Billing",       icon: CreditCard },
  { value: "addresses",   label: "Addresses",     icon: MapPin     },
  { value: "contacts",    label: "Contacts",      icon: Users      },
  { value: "gst",         label: "GST / Tax",     icon: Receipt    },
];

export function CostCentreSheet({ open, onOpenChange, mode, costCentre, onSaved }: CostCentreSheetProps) {
  const [activeTab, setActiveTab] = useState("basic");
  const [data, setData] = useState<Partial<CostCentreInput>>(emptyInput);
  const [actionDialog, setActionDialog] = useState<{ type: string; title: string } | null>(null);
  const [actionReason, setActionReason] = useState("");

  const createMutation   = useCreateCostCentre();
  const updateMutation   = useUpdateCostCentre();
  const submitMutation   = useSubmitCostCentre();
  const approveL1Mutation = useApproveL1CostCentre();
  const approveL2Mutation = useApproveL2CostCentre();
  const rejectMutation   = useRejectCostCentre();
  const revisionMutation = useRequestRevisionCostCentre();
  const activateMutation = useActivateCostCentre();
  const closeMutation    = useCloseCostCentre();

  const isLoading =
    createMutation.isPending || updateMutation.isPending || submitMutation.isPending ||
    approveL1Mutation.isPending || approveL2Mutation.isPending || rejectMutation.isPending ||
    revisionMutation.isPending || activateMutation.isPending || closeMutation.isPending;

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
          bill_to_address4: costCentre.bill_to_address4,
          bill_to_address5: costCentre.bill_to_address5,
          bill_to_city: costCentre.bill_to_city,
          bill_to_pincode: costCentre.bill_to_pincode,
          ship_to_address1: costCentre.ship_to_address1,
          ship_to_address2: costCentre.ship_to_address2,
          ship_to_address3: costCentre.ship_to_address3,
          ship_to_address4: costCentre.ship_to_address4,
          ship_to_address5: costCentre.ship_to_address5,
          ship_to_city: costCentre.ship_to_city,
          ship_to_pincode: costCentre.ship_to_pincode,
          tally_head: costCentre.tally_head,
          group_cost_center: costCentre.group_cost_center,
          cost_center_type: costCentre.cost_center_type,
          dialdee_type: costCentre.dialdee_type,
          jcc_no: costCentre.jcc_no,
          grn: costCentre.grn,
          po_required: !!costCentre.po_required,
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
    if (!data.cost_centre_code?.trim()) { toast.error("Cost Centre Code is required"); return false; }
    if (!data.cost_centre_name?.trim()) { toast.error("Cost Centre Name is required"); return false; }
    if (!data.client_id)  { toast.error("Client is required");  return false; }
    if (!data.lob_id)     { toast.error("LOB is required");     return false; }
    if (!data.branch_id)  { toast.error("Branch is required");  return false; }
    if (!data.process_id) { toast.error("Process is required"); return false; }
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
          toast.success("L1 approval granted"); break;
        case "approve_l2":
          await approveL2Mutation.mutateAsync({ id: costCentre.id, remarks: actionReason || undefined });
          toast.success("L2 approval granted"); break;
        case "reject":
          if (!actionReason.trim()) { toast.error("Rejection reason is required"); return; }
          await rejectMutation.mutateAsync({ id: costCentre.id, reason: actionReason });
          toast.success("Cost centre rejected"); break;
        case "revision":
          if (!actionReason.trim()) { toast.error("Revision reason is required"); return; }
          await revisionMutation.mutateAsync({ id: costCentre.id, reason: actionReason });
          toast.success("Revision requested"); break;
        case "activate":
          await activateMutation.mutateAsync(costCentre.id);
          toast.success("Cost centre activated"); break;
        case "close":
          await closeMutation.mutateAsync({ id: costCentre.id, reason: actionReason || undefined });
          toast.success("Cost centre closed"); break;
      }
      setActionDialog(null);
      setActionReason("");
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "Action failed");
    }
  };

  const isFinanceApprover = useHasRole("finance_head", "accounts_head", "admin", "super_admin");
  const isAdmin = useHasRole("admin", "super_admin");

  const canEdit     = mode !== "view" && ["draft", "revision_required"].includes(costCentre?.status ?? "draft");
  const canSubmit   = costCentre && ["draft", "revision_required"].includes(costCentre.status);
  const canApproveL1 = costCentre?.status === "pending_l1" && isFinanceApprover;
  const canApproveL2 = costCentre?.status === "pending_l2" && isAdmin;
  const canActivate = costCentre?.status === "approved" && isAdmin;
  const canClose    = costCentre?.status === "active" && isFinanceApprover;

  const pageTitle =
    mode === "create" ? "New Cost Centre" :
    mode === "edit"   ? "Edit Cost Centre" :
                        "View Cost Centre";

  const activeNavItem = NAV_TABS.find((t) => t.value === activeTab);

  return (
    <>
      {/* ── Full-screen page dialog ── */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          hideDefaultClose
          className="fixed inset-4 translate-x-0 translate-y-0 left-0 top-0 max-w-none w-auto h-auto rounded-2xl p-0 gap-0 flex flex-col overflow-hidden shadow-2xl border-0"
          style={{ margin: "1rem", width: "calc(100vw - 2rem)", height: "calc(100vh - 2rem)" }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 py-4 bg-slate-950 text-white shrink-0 rounded-t-2xl">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-base font-bold text-white">{pageTitle}</h1>
                  {costCentre && <StatusBadge status={costCentre.status} />}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs text-white/50">Finance</span>
                  <ChevronRight className="h-3 w-3 text-white/30" />
                  <span className="text-xs text-white/50">Cost Centres</span>
                  <ChevronRight className="h-3 w-3 text-white/30" />
                  <span className="text-xs text-white/80">{pageTitle}</span>
                </div>
              </div>
            </div>

            {costCentre && (
              <div className="hidden sm:flex items-center gap-3 mx-4">
                <div className="text-right">
                  <p className="text-xs text-white/50 font-medium uppercase tracking-wider">Code</p>
                  <p className="text-sm font-bold text-white">{costCentre.cost_centre_code}</p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-right">
                  <p className="text-xs text-white/50 font-medium uppercase tracking-wider">Name</p>
                  <p className="text-sm font-bold text-white truncate max-w-[200px]">{costCentre.cost_centre_name}</p>
                </div>
              </div>
            )}

            <button
              onClick={() => onOpenChange(false)}
              className="h-8 w-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors ml-auto"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-white" />
            </button>
          </div>

          {/* ── Body: left nav + content ── */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left sidebar navigation */}
            <div className="w-52 border-r border-slate-200 bg-white shrink-0 flex flex-col py-3">
              <p className="px-4 mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Sections</p>
              {NAV_TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors w-full text-left",
                      isActive
                        ? "bg-slate-950 text-white"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-slate-400")} />
                    {tab.label}
                    {isActive && <ChevronRight className="h-3.5 w-3.5 ml-auto text-white/60" />}
                  </button>
                );
              })}

              {/* Progress indicator for create mode */}
              {mode === "create" && (
                <div className="mt-auto px-4 pb-3 pt-4 border-t border-slate-100">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Progress</p>
                  <div className="space-y-1.5">
                    {[
                      { label: "Basic Info",  required: true,  filled: !!(data.cost_centre_code && data.cost_centre_name && data.client_id && data.branch_id) },
                      { label: "Operations", required: false, filled: !!(data.mandated_seats_value) },
                      { label: "Billing",    required: false, filled: !!(data.revenue_type) },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-2">
                        <div className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          item.filled ? "bg-emerald-500" : item.required ? "bg-amber-400" : "bg-slate-200"
                        )} />
                        <span className="text-xs text-slate-500">{item.label}</span>
                        {item.required && !item.filled && (
                          <span className="text-xs text-amber-500 ml-auto">Required</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Main content area */}
            <div className="flex-1 overflow-y-auto bg-slate-50">
              {/* Section heading bar */}
              <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-2 shrink-0">
                {activeNavItem && (
                  <>
                    <activeNavItem.icon className="h-4 w-4 text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">{activeNavItem.label}</span>
                  </>
                )}
              </div>

              <div className="p-6">
                {activeTab === "basic" && (
                  <BasicInfoSection data={data} onChange={handleChange} disabled={!canEdit} isEdit={mode === "edit"} />
                )}
                {activeTab === "operational" && (
                  <OperationalSection data={data} onChange={handleChange} disabled={!canEdit} />
                )}
                {activeTab === "billing" && (
                  <BillingSection data={data} onChange={handleChange} disabled={!canEdit} />
                )}
                {activeTab === "addresses" && (
                  <AddressesSection data={data} onChange={handleChange} disabled={!canEdit} />
                )}
                {activeTab === "contacts" && (
                  <ContactsSection data={data} onChange={handleChange} disabled={!canEdit} />
                )}
                {activeTab === "gst" && (
                  <GstTaxSection data={data} onChange={handleChange} disabled={!canEdit} />
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-4 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between rounded-b-2xl">
            <div className="flex gap-2">
              {canClose && (
                <Button
                  variant="outline"
                  className="border-rose-200 text-rose-600 hover:bg-rose-50"
                  onClick={() => setActionDialog({ type: "close", title: "Close Cost Centre" })}
                >
                  Close Cost Centre
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {canApproveL1 && (
                <>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "reject", title: "Reject" })}>
                    Reject
                  </Button>
                  <Button variant="outline" onClick={() => setActionDialog({ type: "revision", title: "Request Revision" })}>
                    Request Revision
                  </Button>
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setActionDialog({ type: "approve_l1", title: "Approve L1" })}>
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
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setActionDialog({ type: "approve_l2", title: "Approve L2" })}>
                    Approve L2
                  </Button>
                </>
              )}
              {canActivate && (
                <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setActionDialog({ type: "activate", title: "Activate" })}>
                  Activate
                </Button>
              )}
              {canEdit && (
                <>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  {mode === "create" ? (
                    <Button
                      className="bg-slate-950 hover:bg-slate-800 text-white"
                      onClick={handleSave}
                      disabled={isLoading}
                    >
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Cost Centre
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        className="border-slate-300"
                        onClick={handleSave}
                        disabled={isLoading}
                      >
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Draft
                      </Button>
                      {canSubmit && (
                        <Button
                          className="bg-slate-950 hover:bg-slate-800 text-white"
                          onClick={handleSubmit}
                          disabled={isLoading}
                        >
                          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Submit for Approval
                        </Button>
                      )}
                    </>
                  )}
                </>
              )}
              {mode === "view" && !canApproveL1 && !canApproveL2 && !canActivate && !canClose && (
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Action confirmation dialog ── */}
      <Dialog open={!!actionDialog} onOpenChange={(o) => !o && setActionDialog(null)}>
        <DialogContent className="max-w-md">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Building2 className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{actionDialog?.title}</h3>
              {costCentre && (
                <p className="text-sm text-slate-500 mt-0.5">{costCentre.cost_centre_code} — {costCentre.cost_centre_name}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              {actionDialog?.type === "reject"   ? "Rejection Reason *" :
               actionDialog?.type === "revision" ? "Revision Reason *"  :
               actionDialog?.type === "close"    ? "Close Reason"       :
                                                   "Remarks (optional)"}
            </label>
            <Textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Enter reason..."
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setActionDialog(null)}>
              Cancel
            </Button>
            <Button
              className="bg-slate-950 hover:bg-slate-800 text-white"
              onClick={handleAction}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}