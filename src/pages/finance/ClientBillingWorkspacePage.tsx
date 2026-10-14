/**
 * Client Billing workspace (/finance/client-billing) — the legacy I-Spark sequence
 * (Provision -> Proforma -> Approve Proforma -> Invoice Approval -> Download -> Receipts) plus
 * Rejected / Void, ADD PO, Credit Notes and the delete / status-change approvals.
 *
 * Each tab is its own component under `src/components/finance/client-billing/` with its own
 * server-filtered, paginated query; this page owns the cross-tab state: which record's detail
 * drawer / approve screen / PDF preview / reject / send / change-request dialog is open, the
 * summary tiles and step counts, PDF downloads and the filtered CSV exports. Every money / GST
 * figure comes straight from the API (`InvoiceRow` / `CreditNoteRow`) — formatted, never
 * computed here.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  approveCreditNote,
  approveInvoicePo,
  exportInvoiceCsv,
  downloadInvoicePdf,
  exportClientBillingCsv,
  getSummary,
  listOutstandingBills,
  type ClientBillingListFilters,
  type InvoiceDetail,
  type InvoiceRow,
} from "@/lib/clientBillingApi";
import { AuditLogDialog } from "@/components/finance/client-billing/AuditLogDialog";
import { CreateCreditNoteSheet } from "@/components/finance/client-billing/CreateCreditNoteSheet";
import { ProformaEntrySheet } from "@/components/finance/client-billing/ProformaEntrySheet";
import { InvoiceApproveView } from "@/components/finance/client-billing/InvoiceApproveView";
import { DownloadInvoiceList, InvoiceApprovalList, ProformaApprovalList } from "@/components/finance/client-billing/LegacyBillingLists";
import { RejectedInvoiceList } from "@/components/finance/client-billing/RejectedInvoiceList";
import { AddGrnDialog, PoGrnTab } from "@/components/finance/client-billing/PoGrnTab";
import { ReceiptsTab } from "@/components/finance/client-billing/ReceiptsTab";
import { CreditNoteDetailDialog } from "@/components/finance/client-billing/CreditNoteDetailDialog";
import { CreditNotesTab, toApiFilters } from "@/components/finance/client-billing/CreditNotesTab";
import { InvoiceDetailDialog, type InvoiceDetailActions } from "@/components/finance/client-billing/InvoiceDetailDialog";
import { RejectInvoiceDialog } from "@/components/finance/client-billing/RejectInvoiceDialog";
import { ConfirmActionDialog } from "@/components/finance/client-billing/ConfirmActionDialog";
import { PdfPreviewDialog, type PdfTarget } from "@/components/finance/client-billing/PdfPreviewDialog";
import { Metric, type ListFilterState } from "@/components/finance/client-billing/WorkspaceParts";
import { moneyCompact } from "@/components/finance/client-billing/shared";
import { BillingSequenceStepper, type BillingTab } from "@/components/finance/client-billing/BillingSequenceStepper";
import { ProvisionsTab } from "@/components/finance/client-billing/ProvisionsTab";
import { ChangeRequestDialog, type ChangeRequestTarget } from "@/components/finance/client-billing/ChangeRequestDialog";
import { ChangeRequestsTab } from "@/components/finance/client-billing/ChangeRequestsTab";
import { SubmitToClientDialog } from "@/components/finance/client-billing/SubmitToClientDialog";

type WorkspaceTab = BillingTab | "change-requests" | "po" | "receipts" | "rejected";
const TABS: WorkspaceTab[] = ["provisions", "proformas", "invoice-approval", "invoices", "receipts", "rejected", "po", "credit-notes", "change-requests"];
const tabContent = "flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden";
const numberOf = (r: Pick<InvoiceRow, "bill_no" | "proforma_no" | "id">) => r.bill_no ?? r.proforma_no ?? r.id;

export default function ClientBillingWorkspacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [entry, setEntry] = useState<{ open: boolean; editId: string | null; cloneFromId?: string | null }>({ open: false, editId: null });
  const [approveView, setApproveView] = useState<{ id: string; mode: "proforma" | "invoice" | "view"; initialEdit?: boolean } | null>(null);
  const [grnTarget, setGrnTarget] = useState<{ id: string; label: string; grnNo?: string | null; grnDate?: string | null } | null>(null);
  // Legacy confirmation, word for word: "Bill No. 09-171/26-27 to Branch NOIDA-2 for amount 778901 for Sep-26 Generated Successfully. And moved to Branch"
  const [billBanner, setBillBanner] = useState<string | null>(null);
  const [creditNoteSheet, setCreditNoteSheet] = useState<{ open: boolean; invoice?: InvoiceRow | null }>({ open: false });
  // Approval Center deep link: ?tab=<tab>&approvalId=<id> opens that record's detail.
  const deepLinkParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const deepLinkId = deepLinkParams.get("approvalId");
  const rawTab = deepLinkParams.get("tab") as WorkspaceTab | null;
  const deepLinkTab = rawTab && TABS.includes(rawTab) ? rawTab : "proformas";
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(deepLinkTab);
  const [changeRequestTarget, setChangeRequestTarget] = useState<ChangeRequestTarget | null>(null);
  const [submitTarget, setSubmitTarget] = useState<{ id: string; label: string } | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(
    deepLinkId && (deepLinkTab === "proformas" || deepLinkTab === "invoice-approval") ? deepLinkId : null,
  );
  const [detailCreditNoteId, setDetailCreditNoteId] = useState<string | null>(deepLinkId && deepLinkTab === "credit-notes" ? deepLinkId : null);
  const [auditInvoice, setAuditInvoice] = useState<{ id: string; label: string } | null>(null);
  const [rejectInvoiceTarget, setRejectInvoiceTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveCreditTarget, setApproveCreditTarget] = useState<{ id: string; label: string } | null>(null);
  const [approvePoTarget, setApprovePoTarget] = useState<{ id: string; label: string; po: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PdfTarget | null>(null);

  const summaryQuery = useQuery({ queryKey: ["client-billing", "summary"], queryFn: () => getSummary() });
  const summary = summaryQuery.data?.data;
  // Step 6 count: overdue bills. Same query key as RecordReceiptSheet's client list, so the
  // register is fetched once and shared; cached for 5 minutes.
  const outstandingQuery = useQuery({
    queryKey: ["client-billing", "outstanding", "all"],
    queryFn: () => listOutstandingBills(),
    staleTime: 5 * 60_000,
  });
  const overdueBills = outstandingQuery.data ? outstandingQuery.data.data.filter((b) => b.days_past_due > 0).length : undefined;

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
  }

  const approvePoMutation = useMutation({
    mutationFn: (id: string) => approveInvoicePo(id),
    onSuccess: () => { toast({ title: "PO approved" }); setApprovePoTarget(null); invalidateAll(); },
    onError: (error: Error) => toast({ title: "Approve PO failed", description: error.message, variant: "destructive" }),
  });

  const approveCreditMutation = useMutation({
    mutationFn: (id: string) => approveCreditNote(id),
    onSuccess: () => {
      toast({ title: "Credit note approved" });
      invalidateAll();
      setApproveCreditTarget(null);
    },
    onError: (error: Error) => toast({ title: "Approval failed", description: error.message, variant: "destructive" }),
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportingKind, setExportingKind] = useState<"proformas" | "credit-notes" | null>(null);

  async function handleInvoiceExport(row: InvoiceRow) {
    try {
      const name = String(row.bill_no ?? row.proforma_no ?? row.id).replace(/[^A-Za-z0-9._-]+/g, "_");
      await exportInvoiceCsv(row.id, `invoice-${name}.csv`);
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Unable to export", variant: "destructive" });
    }
  }

  async function handleDownload(
    kind: "proforma" | "invoice" | "credit-note",
    id: string,
    docNumber: string,
    letterhead: boolean
  ) {
    setDownloadingId(id);
    try {
      const suffix = letterhead ? "" : "-plain";
      await downloadInvoicePdf(kind, id, `${docNumber || id}${suffix}.pdf`, letterhead);
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unable to download PDF",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  /** Filtered CSV export for any list: same filters as the screen, all pages (server export route). */
  async function handleListExport(kind: "proformas" | "credit-notes", filters: ClientBillingListFilters, filename: string) {
    setExportingKind(kind);
    try {
      await exportClientBillingCsv(kind, { ...filters, page: undefined, limit: undefined }, filename);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to export CSV",
        variant: "destructive",
      });
    } finally {
      setExportingKind(null);
    }
  }

  function handleExport(kind: "proformas" | "credit-notes", filters: ListFilterState, statusOverride?: string) {
    return handleListExport(kind, toApiFilters({ ...filters, page: 1 }, statusOverride), `client-billing-${kind}-export.csv`);
  }
  const exportProformas = (filters: ClientBillingListFilters, filename: string) => handleListExport("proformas", filters, filename);

  const openDetail = (r: Pick<InvoiceRow, "id">) => setDetailInvoiceId(r.id);
  const previewOf = (inv: InvoiceRow) => setPreviewTarget({ kind: inv.invoice_status === "approved" ? "invoice" : "proforma", id: inv.id, label: numberOf(inv) });
  const detailActions: InvoiceDetailActions = {
    onPreview: previewOf,
    onApprove: (inv, mode) => setApproveView({ id: inv.id, mode }),
    onReject: (inv) => setRejectInvoiceTarget({ id: inv.id, label: numberOf(inv) }),
    onEditNarration: (inv) => setApproveView({ id: inv.id, mode: "view", initialEdit: true }),
    onSendToClient: (inv) => setSubmitTarget({ id: inv.id, label: numberOf(inv) }),
    onClone: (inv) => { setDetailInvoiceId(null); setEntry({ open: true, editId: null, cloneFromId: inv.id }); },
  };

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Client Billing</h1>
            <p className="text-xs text-muted-foreground">
              Provision → Proforma → Approve Proforma → Invoice Approval → Download, same order as I-Spark.
            </p>
          </div>
          <Button size="sm" variant="ghost" title="Refresh" aria-label="Refresh" className="cursor-pointer" onClick={invalidateAll}>
            <RefreshCw className={`h-3.5 w-3.5 ${summaryQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* ── Summary stat row ── */}
        {summary && (
          <div className="grid grid-cols-2 gap-2 border-b bg-slate-50/60 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric label="Pending Approval" value={String(summary.pendingApprovalCount)} tone="amber" sub="proformas awaiting review" />
            <Metric label="Approved (all-time)" value={moneyCompact(summary.invoices.approved.total)} tone="emerald" sub={`${summary.invoices.approved.count} invoices`} />
            <Metric label="Billed This Month" value={moneyCompact(summary.thisMonthBilled.total)} tone="blue" sub={`${summary.thisMonthBilled.count} invoices`} />
            <Metric label="Rejected / Void" value={String(summary.invoices.rejected.count)} tone="rose" />
            <Metric
              label="Credit Notes"
              value={moneyCompact(summary.creditNotes.draft.total + summary.creditNotes.approved.total)}
              sub={`${summary.creditNotes.draft.count} draft · ${summary.creditNotes.approved.count} approved`}
            />
          </div>
        )}

        <BillingSequenceStepper
          active={activeTab === "change-requests" || activeTab === "po" || activeTab === "rejected" ? "invoices" : activeTab}
          onSelect={setActiveTab}
          counts={[
            summary?.pendingProvisionCount,
            undefined,
            summary?.awaitingProformaApprovalCount,
            summary?.awaitingInvoiceApprovalCount,
            undefined,
            overdueBills,
          ]}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as WorkspaceTab)} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit flex-wrap">
            <TabsTrigger value="provisions">1 · Provision</TabsTrigger>
            <TabsTrigger value="proformas">2–3 · View &amp; Approve Proforma</TabsTrigger>
            <TabsTrigger value="invoice-approval">4 · Invoice Approval</TabsTrigger>
            <TabsTrigger value="invoices">5 · Download Initial Invoice</TabsTrigger>
            <TabsTrigger value="receipts">6 · Receipts</TabsTrigger>
            <TabsTrigger value="rejected">Rejected / Void</TabsTrigger>
            <TabsTrigger value="po">ADD PO</TabsTrigger>
            <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
            <TabsTrigger value="change-requests">Delete / Status Change Approval</TabsTrigger>
          </TabsList>

          {/* ── Legacy "Approval Invoice Delete Request" + "Invoice Status Change Approval" ── */}
          <TabsContent value="change-requests" className={tabContent}>
            <ChangeRequestsTab />
          </TabsContent>

          {/* ── Provision tab (legacy Create / Approve / Upload / View & Edit Provision) ── */}
          <TabsContent value="provisions" className={tabContent}>
            <ProvisionsTab />
          </TabsContent>

          {/* ── Legacy "Initial Invoice/Proforma" + "View & Approve Proforma" ── */}
          <TabsContent value="proformas" className={tabContent}>
            <ProformaApprovalList
              onCreate={() => setEntry({ open: true, editId: null })}
              onEdit={(r) => setEntry({ open: true, editId: r.id })}
              onApprove={(r) => setApproveView({ id: r.id, mode: "proforma" })}
              onReject={(r) => setRejectInvoiceTarget({ id: r.id, label: r.proforma_no ?? r.id })}
              onDownload={(r, lh) => void handleDownload("proforma", r.id, r.proforma_no ?? r.id, lh)}
              onOpen={openDetail}
              onExportCsv={exportProformas}
            />
          </TabsContent>

          {/* ── Legacy "Invoice Approval": view -> Approved generates the bill number ── */}
          <TabsContent value="invoice-approval" className={tabContent}>
            <InvoiceApprovalList
              banner={billBanner}
              onView={(r) => setApproveView({ id: r.id, mode: "invoice" })}
              onEdit={(r) => setEntry({ open: true, editId: r.id })}
              onReject={(r) => setRejectInvoiceTarget({ id: r.id, label: r.proforma_no ?? r.id })}
              onOpen={openDetail}
              onExportCsv={exportProformas}
            />
          </TabsContent>

          {/* ── Legacy "Download Initial Invoice" ── */}
          <TabsContent value="invoices" className={tabContent}>
            <DownloadInvoiceList
              onDownload={(r, lh) => void handleDownload("invoice", r.id, r.bill_no ?? r.id, lh)}
              onExport={(r) => void handleInvoiceExport(r)}
              onView={(r) => setApproveView({ id: r.id, mode: "view" })}
              onOpen={openDetail}
              onAddGrn={(r) => setGrnTarget({ id: r.id, label: r.bill_no ?? r.id, grnNo: r.grn_no, grnDate: r.grn_date })}
              onApprovePo={(r) => { approvePoMutation.reset(); setApprovePoTarget({ id: r.id, label: r.bill_no ?? r.id, po: r.po_numbers ?? "" }); }}
              onSubmit={(r) => setSubmitTarget({ id: r.id, label: r.bill_no ?? r.id })}
              onCreditNote={(r) => setCreditNoteSheet({ open: true, invoice: r })}
              onDeleteRequest={(r) => setChangeRequestTarget({ id: r.id, label: r.bill_no ?? r.id, category: r.category, requestType: "void" })}
              onAudit={(r) => setAuditInvoice({ id: r.id, label: r.bill_no ?? r.id })}
              onExportCsv={exportProformas}
            />
          </TabsContent>

          {/* ── Money received against bills (the only place client receipts are recorded) ── */}
          <TabsContent value="receipts" className={tabContent}>
            <ReceiptsTab onOpenInvoice={(id) => setDetailInvoiceId(id)} />
          </TabsContent>

          {/* ── Rejected proformas and voided invoices ── */}
          <TabsContent value="rejected" className={tabContent}>
            <RejectedInvoiceList
              onOpen={openDetail}
              onClone={(r) => setEntry({ open: true, editId: null, cloneFromId: r.id })}
              onExportCsv={exportProformas}
            />
          </TabsContent>

          {/* ── Legacy "ADD PO" ── */}
          <TabsContent value="po" className={tabContent}>
            <PoGrnTab />
          </TabsContent>

          {/* ── Credit Notes tab ── */}
          <TabsContent value="credit-notes" className={tabContent}>
            <CreditNotesTab
              onCreate={() => setCreditNoteSheet({ open: true })}
              onOpenDetail={setDetailCreditNoteId}
              onPreview={setPreviewTarget}
              onApprove={(t) => { approveCreditMutation.reset(); setApproveCreditTarget(t); }}
              onDownload={handleDownload}
              downloadingId={downloadingId}
              onExport={(filters) => void handleExport("credit-notes", filters)}
              isExporting={exportingKind === "credit-notes"}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ProformaEntrySheet
        open={entry.open}
        onOpenChange={(open) => !open && setEntry({ open: false, editId: null })}
        onSaved={() => invalidateAll()}
        editInvoiceId={entry.editId}
        cloneFromInvoiceId={entry.cloneFromId ?? null}
      />
      <InvoiceDetailDialog
        invoiceId={detailInvoiceId}
        onOpenChange={(open) => !open && setDetailInvoiceId(null)}
        {...detailActions}
      />
      <InvoiceApproveView
        invoiceId={approveView?.id ?? null}
        mode={approveView?.mode ?? "view"}
        initialEdit={approveView?.initialEdit ?? false}
        onClose={() => setApproveView(null)}
        onApproved={(r) => setBillBanner(
          `Bill No. ${r.billNo ?? ""} to Branch ${r.branch ?? ""} for amount ${r.amount} for ${r.month} Generated Successfully. And moved to Branch`,
        )}
        onReject={(inv: InvoiceDetail) => setRejectInvoiceTarget({ id: inv.id, label: numberOf(inv) })}
        onPreview={previewOf}
        onSendAgain={(inv: InvoiceDetail) => setSubmitTarget({ id: inv.id, label: numberOf(inv) })}
      />
      <AddGrnDialog target={grnTarget} onClose={() => setGrnTarget(null)} />
      <CreateCreditNoteSheet
        open={creditNoteSheet.open}
        onOpenChange={(open) => setCreditNoteSheet(open ? { ...creditNoteSheet, open } : { open: false })}
        initialInvoice={creditNoteSheet.invoice ?? null}
        onCreated={() => invalidateAll()}
      />
      <ChangeRequestDialog target={changeRequestTarget} onOpenChange={(open) => !open && setChangeRequestTarget(null)} />
      <SubmitToClientDialog target={submitTarget} onOpenChange={(open) => !open && setSubmitTarget(null)} />
      <CreditNoteDetailDialog creditNoteId={detailCreditNoteId} onOpenChange={(open) => !open && setDetailCreditNoteId(null)} />
      <AuditLogDialog
        invoiceId={auditInvoice?.id ?? null}
        label={auditInvoice?.label ?? ""}
        onOpenChange={(open) => !open && setAuditInvoice(null)}
      />
      <RejectInvoiceDialog
        invoiceId={rejectInvoiceTarget?.id ?? null}
        label={rejectInvoiceTarget?.label ?? ""}
        onOpenChange={(open) => !open && setRejectInvoiceTarget(null)}
        onRejected={() => { invalidateAll(); setApproveView(null); }}
      />
      <PdfPreviewDialog target={previewTarget} onOpenChange={(open) => !open && setPreviewTarget(null)} />

      <ConfirmActionDialog
        open={Boolean(approvePoTarget)}
        title={`Approve PO on ${approvePoTarget?.label ?? ""}?`}
        description={<>Confirms PO {approvePoTarget?.po} against this bill. The approval is recorded in the audit trail and cannot be withdrawn here.</>}
        confirmLabel="Approve PO"
        pending={approvePoMutation.isPending}
        error={approvePoMutation.isError ? approvePoMutation.error.message : null}
        onConfirm={() => approvePoTarget && approvePoMutation.mutate(approvePoTarget.id)}
        onCancel={() => setApprovePoTarget(null)}
      />

      <AlertDialog open={Boolean(approveCreditTarget)} onOpenChange={(open) => !open && setApproveCreditTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve credit note {approveCreditTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
          {approveCreditMutation.isError && (
            <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              Approval failed: {approveCreditMutation.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={approveCreditMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (approveCreditTarget) approveCreditMutation.mutate(approveCreditTarget.id);
              }}
            >
              {approveCreditMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
