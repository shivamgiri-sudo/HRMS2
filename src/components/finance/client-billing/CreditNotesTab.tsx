// src/components/finance/client-billing/CreditNotesTab.tsx
/**
 * Credit Notes tab of the Client Billing workspace: server-filtered, paginated list with the
 * shared toolbar (company / branch / status / dates / cost centre / search / CSV export).
 * Dialogs (detail, preview, approve confirmation, create sheet) stay owned by the page.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Eye, FileText, Loader2, Plus, ThumbsDown, ThumbsUp } from "lucide-react";
import { useApprovalFocus } from "@/hooks/useApprovalFocus";
import { Button } from "@/components/ui/button";
import type { SearchableOption } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCreditNotes, rejectCreditNote, type ClientBillingListFilters, type CreditNoteRow } from "@/lib/clientBillingApi";
import { costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions } from "./BillingScopeSelects";
import type { PdfTarget } from "./PdfPreviewDialog";
import { CreditStatusBadge, InlineError, money } from "./shared";
import {
  DownloadPdfButton, EMPTY_FILTERS, HistoricalRecordTag, ListToolbar, PAGE_SIZE, PaginationFooter,
  type ListFilterState,
} from "./WorkspaceParts";

const CREDIT_NOTE_STATUS_FILTERS = [
  { value: "_all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
] as const;

export function toApiFilters(f: ListFilterState, statusOverride?: string): ClientBillingListFilters {
  return {
    status: statusOverride ?? (f.status === "_all" ? undefined : f.status),
    companyName: f.companyName || undefined,
    branchId: f.branchId || undefined,
    fromDate: f.fromDate || undefined,
    toDate: f.toDate || undefined,
    costCentreId: f.costCentreId || undefined,
    search: f.search || undefined,
    page: f.page,
    limit: PAGE_SIZE,
  };
}

export function CreditNotesTab({
  onCreate, onOpenDetail, onPreview, onApprove, onDownload, downloadingId, onExport, isExporting,
}: {
  onCreate: () => void;
  onOpenDetail: (id: string) => void;
  onPreview: (target: PdfTarget) => void;
  onApprove: (target: { id: string; label: string }) => void;
  onDownload: (kind: "proforma" | "invoice" | "credit-note", id: string, docNumber: string, letterhead: boolean) => unknown;
  downloadingId: string | null;
  onExport: (filters: ListFilterState) => void;
  isExporting: boolean;
}) {
  const [rejecting, setRejecting] = useState<CreditNoteRow | null>(null);
  const [filters, setFilters] = useState<ListFilterState>(EMPTY_FILTERS("_all"));
  const allCostCentres = useBillingFilterOptions().data?.data.costCentres ?? [];
  const costCentreOptions = (f: ListFilterState): SearchableOption[] => [
    // A synthetic leading option so the filter can be cleared from inside the dropdown itself.
    { value: "", label: "All cost centres" },
    ...costCentreSearchOptions(narrowCostCentres(allCostCentres, f.companyName, f.branchId)),
  ];
  const query = useQuery({
    queryKey: ["client-billing", "credit-notes", filters],
    queryFn: () => listCreditNotes(toApiFilters(filters)),
  });
  const rows: CreditNoteRow[] = query.data?.data ?? [];
  useApprovalFocus(!query.isLoading);

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <ListToolbar
          filters={filters}
          onChange={setFilters}
          statusOptions={CREDIT_NOTE_STATUS_FILTERS}
          costCentreOptions={costCentreOptions}
          searchPlaceholder="Credit no, client…"
          onExport={() => onExport(filters)}
          isExporting={isExporting}
        />
        <Button size="sm" className="h-8 shrink-0 cursor-pointer" onClick={onCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />New Credit Note
        </Button>
      </div>

      {query.isError && (
        <div role="alert" className="mb-2 flex items-center justify-between rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {query.error instanceof Error ? query.error.message : "Unable to load credit notes"}
          <Button size="sm" variant="outline" className="h-7 cursor-pointer text-xs" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-md border">
        {query.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
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
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    {query.isError ? "Could not load credit notes" : "No credit notes found"}
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => (
                <TableRow key={row.id} data-approval-id={row.id}>
                  <TableCell className="font-medium">
                    <button type="button" className="cursor-pointer text-left hover:underline" onClick={() => onOpenDetail(row.id)}>
                      {row.credit_no ?? <span className="text-muted-foreground" title="A credit note gets its number when it is approved">Draft — no number yet</span>}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.against_invoice_number || row.invoice_id}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                  <TableCell>{row.gst_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                  <TableCell><CreditStatusBadge status={row.credit_status} /></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" title="Preview" aria-label="Preview"
                        onClick={() => onPreview({ kind: "credit-note", id: row.id, label: row.credit_no ?? row.id })}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <DownloadPdfButton kind="credit-note" id={row.id} docNumber={row.credit_no ?? row.id} downloadingId={downloadingId} onDownload={onDownload} />
                      {row.credit_status === "draft" && (
                        row.is_migrated ? <HistoricalRecordTag /> : (
                          <Button
                            size="icon" variant="ghost" className="h-7 w-7 cursor-pointer text-emerald-600 hover:text-emerald-700"
                            title="Approve" aria-label="Approve"
                            onClick={() => onApprove({ id: row.id, label: row.credit_no ?? row.id })}
                          >
                            <ThumbsUp className="h-3.5 w-3.5" />
                          </Button>
                        )
                      )}
                      {row.credit_status === "draft" && !row.is_migrated && (
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7 cursor-pointer text-rose-600 hover:text-rose-700"
                          title="Reject" aria-label="Reject credit note" onClick={() => setRejecting(row)}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" className="h-7 w-7 cursor-pointer" title="View details" aria-label="View details" onClick={() => onOpenDetail(row.id)}>
                        <FileText className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <PaginationFooter page={filters.page} total={query.data?.total ?? 0} onPageChange={(page) => setFilters((f) => ({ ...f, page }))} />
      <RejectCreditNoteDialog row={rejecting} onClose={() => setRejecting(null)} />
    </>
  );
}

/** Reject / withdraw a draft credit note (reason required, at least 5 characters). */
function RejectCreditNoteDialog({ row, onClose }: { row: CreditNoteRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reject = useMutation({
    mutationFn: () => rejectCreditNote(row!.id, reason.trim()),
    onMutate: () => setError(null),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["client-billing"] }); setReason(""); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => { if (!o) { setReason(""); setError(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Reject draft credit note</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">Against {row?.against_invoice_number || "—"} · {money(row?.grand_total ?? 0)}. It will not get a number.</p>
        <label className="text-xs font-medium text-slate-700" htmlFor="cn-reject-reason">Reason *</label>
        <Textarea id="cn-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[70px]" />
        {error && <InlineError message={error} />}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="destructive" disabled={reason.trim().length < 5 || reject.isPending} onClick={() => reject.mutate()}>
            {reject.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
