/**
 * Client Billing workspace (/finance/client-billing) — Proformas / Invoices / Credit Notes.
 *
 * Follows `VendorPaymentDispatchPage.tsx`'s shape: React Query for data, `hrmsApi`-backed
 * `clientBillingApi.ts` for the HTTP calls, `DashboardLayout` wrapper, shadcn `Table`/`Tabs`/
 * `Badge`/`Select`, `Sheet`-based create forms split into their own components under
 * `src/components/finance/client-billing/` (mirrors how `PaymentDispatchSheet.tsx` was split
 * out of its page). Every money/GST figure rendered here comes straight from the API response
 * (`InvoiceRow`/`CreditNoteRow`) — this page only formats it (see `./shared.tsx`'s `money`/
 * `GstBreakdown`), never computes it.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileClock, FileText, Loader2, Plus, RefreshCw, ThumbsUp, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  approveCreditNote,
  approveInvoice,
  downloadInvoicePdf,
  listCreditNotes,
  listProformas,
  type CreditNoteRow,
  type InvoiceRow,
  type InvoiceStatus,
} from "@/lib/clientBillingApi";
import { AuditLogDialog } from "@/components/finance/client-billing/AuditLogDialog";
import { CreateCreditNoteSheet } from "@/components/finance/client-billing/CreateCreditNoteSheet";
import { CreateProformaSheet } from "@/components/finance/client-billing/CreateProformaSheet";
import { CreditNoteDetailDialog } from "@/components/finance/client-billing/CreditNoteDetailDialog";
import { InvoiceDetailDialog } from "@/components/finance/client-billing/InvoiceDetailDialog";
import { RejectInvoiceDialog } from "@/components/finance/client-billing/RejectInvoiceDialog";
import { CreditStatusBadge, InvoiceStatusBadge, money } from "@/components/finance/client-billing/shared";

const PROFORMA_STATUS_FILTERS: Array<{ value: InvoiceStatus | "_all"; label: string }> = [
  { value: "_all", label: "All statuses" },
  { value: "proforma", label: "Proforma (pending)" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

export default function ClientBillingWorkspacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "_all">("proforma");
  const [createProformaOpen, setCreateProformaOpen] = useState(false);
  const [createCreditNoteOpen, setCreateCreditNoteOpen] = useState(false);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailCreditNoteId, setDetailCreditNoteId] = useState<string | null>(null);
  const [auditInvoice, setAuditInvoice] = useState<{ id: string; label: string } | null>(null);
  const [rejectInvoiceTarget, setRejectInvoiceTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveCreditTarget, setApproveCreditTarget] = useState<{ id: string; label: string } | null>(null);

  // GET /api/client-billing/proformas returns every client_invoice row regardless of status
  // (no status query param on the backend route) — the Proformas/Invoices tab split and the
  // status filter dropdown both happen client-side over this one query, matching
  // clientBillingApi.ts's own documented contract.
  const proformasQuery = useQuery({
    queryKey: ["client-billing", "proformas"],
    queryFn: () => listProformas(),
  });
  const allInvoices: InvoiceRow[] = proformasQuery.data?.data ?? [];

  const creditNotesQuery = useQuery({
    queryKey: ["client-billing", "credit-notes"],
    queryFn: () => listCreditNotes(),
  });
  const creditNotes: CreditNoteRow[] = creditNotesQuery.data?.data ?? [];

  const proformaRows = useMemo(
    () => allInvoices.filter((inv) => statusFilter === "_all" || inv.invoice_status === statusFilter),
    [allInvoices, statusFilter]
  );
  const invoiceRows = useMemo(
    () => allInvoices.filter((inv) => inv.invoice_status === "approved"),
    [allInvoices]
  );

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveInvoice(id),
    onSuccess: (res) => {
      toast({ title: "Proforma approved", description: res.data?.billNo ? `Bill no. ${res.data.billNo}` : undefined });
      void queryClient.invalidateQueries({ queryKey: ["client-billing", "proformas"] });
      setApproveTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const approveCreditMutation = useMutation({
    mutationFn: (id: string) => approveCreditNote(id),
    onSuccess: () => {
      toast({ title: "Credit note approved" });
      void queryClient.invalidateQueries({ queryKey: ["client-billing", "credit-notes"] });
      setApproveCreditTarget(null);
    },
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
    },
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleDownload(kind: "proforma" | "invoice", row: InvoiceRow) {
    setDownloadingId(row.id);
    try {
      await downloadInvoicePdf(kind, row.id, `${row.bill_no || row.proforma_no || row.id}.pdf`);
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

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Client Billing</h1>
            <p className="text-xs text-muted-foreground">
              Proformas, approved invoices and credit notes for client cost centres.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void proformasQuery.refetch();
              void creditNotesQuery.refetch();
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${proformasQuery.isFetching || creditNotesQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <Tabs defaultValue="proformas" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="proformas">Proformas</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
          </TabsList>

          {/* ── Proformas tab ── */}
          <TabsContent value="proformas" className="flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as InvoiceStatus | "_all")}>
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFORMA_STATUS_FILTERS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => setCreateProformaOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />New Proforma
              </Button>
            </div>

            {proformasQuery.isError && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {proformasQuery.error instanceof Error ? proformasQuery.error.message : "Unable to load proformas"}
              </div>
            )}

            {proformasQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proforma no.</TableHead>
                      <TableHead>Cost centre</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>GST type</TableHead>
                      <TableHead className="text-right">Grand total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proformaRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          No proformas found
                        </TableCell>
                      </TableRow>
                    ) : (
                      proformaRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => setDetailInvoiceId(row.id)}
                            >
                              {row.proforma_no ?? "—"}
                            </button>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.cost_centre_id}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><InvoiceStatusBadge status={row.invoice_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="Download PDF"
                                disabled={downloadingId === row.id}
                                onClick={() => void handleDownload("proforma", row)}
                              >
                                {downloadingId === row.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Download className="h-3.5 w-3.5" />}
                              </Button>
                              {row.invoice_status === "proforma" && (
                                <>
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                    title="Approve"
                                    onClick={() => setApproveTarget({ id: row.id, label: row.proforma_no ?? row.id })}
                                  >
                                    <ThumbsUp className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="icon" variant="ghost" className="h-7 w-7 text-rose-600 hover:text-rose-700"
                                    title="Reject"
                                    onClick={() => setRejectInvoiceTarget({ id: row.id, label: row.proforma_no ?? row.id })}
                                  >
                                    <XCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Invoices tab ── */}
          <TabsContent value="invoices" className="flex-1 overflow-y-auto px-4 py-3">
            {proformasQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill no.</TableHead>
                      <TableHead>Cost centre</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>GST type</TableHead>
                      <TableHead className="text-right">Grand total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          No approved invoices yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      invoiceRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => setDetailInvoiceId(row.id)}
                            >
                              {row.bill_no ?? "—"}
                            </button>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.cost_centre_id}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><InvoiceStatusBadge status={row.invoice_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="Download PDF"
                                disabled={downloadingId === row.id}
                                onClick={() => void handleDownload("invoice", row)}
                              >
                                {downloadingId === row.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Download className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="Audit log"
                                onClick={() => setAuditInvoice({ id: row.id, label: row.bill_no ?? row.id })}
                              >
                                <FileClock className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* ── Credit Notes tab ── */}
          <TabsContent value="credit-notes" className="flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-3 flex items-center justify-end">
              <Button size="sm" onClick={() => setCreateCreditNoteOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />New Credit Note
              </Button>
            </div>

            {creditNotesQuery.isError && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {creditNotesQuery.error instanceof Error ? creditNotesQuery.error.message : "Unable to load credit notes"}
              </div>
            )}

            {creditNotesQuery.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Credit no.</TableHead>
                      <TableHead>Against invoice</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>GST type</TableHead>
                      <TableHead className="text-right">Grand total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditNotes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          No credit notes found
                        </TableCell>
                      </TableRow>
                    ) : (
                      creditNotes.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="text-left hover:underline"
                              onClick={() => setDetailCreditNoteId(row.id)}
                            >
                              {row.credit_no ?? "—"}
                            </button>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{row.invoice_id}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><CreditStatusBadge status={row.credit_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              {row.credit_status === "draft" && (
                                <Button
                                  size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                  title="Approve"
                                  onClick={() => setApproveCreditTarget({ id: row.id, label: row.credit_no ?? row.id })}
                                >
                                  <ThumbsUp className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="View details"
                                onClick={() => setDetailCreditNoteId(row.id)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <CreateProformaSheet
        open={createProformaOpen}
        onOpenChange={setCreateProformaOpen}
        onCreated={() => void proformasQuery.refetch()}
      />
      <CreateCreditNoteSheet
        open={createCreditNoteOpen}
        onOpenChange={setCreateCreditNoteOpen}
        approvedInvoices={invoiceRows}
        onCreated={() => void creditNotesQuery.refetch()}
      />
      <InvoiceDetailDialog
        invoiceId={detailInvoiceId}
        onOpenChange={(open) => !open && setDetailInvoiceId(null)}
      />
      <CreditNoteDetailDialog
        creditNoteId={detailCreditNoteId}
        onOpenChange={(open) => !open && setDetailCreditNoteId(null)}
      />
      <AuditLogDialog
        invoiceId={auditInvoice?.id ?? null}
        label={auditInvoice?.label ?? ""}
        onOpenChange={(open) => !open && setAuditInvoice(null)}
      />
      <RejectInvoiceDialog
        invoiceId={rejectInvoiceTarget?.id ?? null}
        label={rejectInvoiceTarget?.label ?? ""}
        onOpenChange={(open) => !open && setRejectInvoiceTarget(null)}
        onRejected={() => void proformasQuery.refetch()}
      />

      <AlertDialog open={Boolean(approveTarget)} onOpenChange={(open) => !open && setApproveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve {approveTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              This assigns a permanent bill number and moves the proforma to Invoices. This
              cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={approveMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (approveTarget) approveMutation.mutate(approveTarget.id);
              }}
            >
              {approveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(approveCreditTarget)} onOpenChange={(open) => !open && setApproveCreditTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve credit note {approveCreditTarget?.label}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone from here.</AlertDialogDescription>
          </AlertDialogHeader>
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
