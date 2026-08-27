/**
 * Client Billing workspace (/finance/client-billing) — Proformas / Invoices / Credit Notes.
 *
 * Phase 2 (2026-08-21): rebuilt around server-side filtering + pagination (each tab now
 * queries its own status/date/cost-centre/search-scoped page — the old version fetched the
 * ENTIRE client_invoice table on every load and filtered/paginated nowhere), a summary stat
 * row (`getSummary()` — aggregated in SQL, not summed off a fetched page), an inline PDF
 * preview dialog before download, and a filtered CSV export per tab. Follows
 * `VendorPaymentDispatchPage.tsx`'s established shape for all of this (page/pageSize state,
 * `Input type="date"` range filters, `Metric` stat tiles, Prev/Next pagination footer) rather
 * than inventing new patterns. `DashboardLayout` wrapper, shadcn `Table`/`Tabs`/`Badge`/
 * `Select`, `Sheet`-based create forms split into their own components under
 * `src/components/finance/client-billing/`. Every money/GST figure rendered here comes
 * straight from the API response (`InvoiceRow`/`CreditNoteRow`) — this page only formats it
 * (see `./shared.tsx`'s `money`/`GstBreakdown`), never computes it.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Download, Eye, FileClock, FileText, Loader2, Plus, RefreshCw,
  Search, ThumbsUp, X, XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useCostCentreList } from "@/hooks/useCostCentreManagement";
import {
  approveCreditNote,
  approveInvoice,
  downloadInvoicePdf,
  exportClientBillingCsv,
  getSummary,
  listCreditNotes,
  listProformas,
  previewInvoicePdfUrl,
  type ClientBillingListFilters,
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

const PAGE_SIZE = 25;

const PROFORMA_STATUS_FILTERS: Array<{ value: InvoiceStatus | "_all"; label: string }> = [
  { value: "_all", label: "All statuses" },
  { value: "proforma", label: "Proforma (pending)" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const CREDIT_NOTE_STATUS_FILTERS = [
  { value: "_all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
] as const;

interface ListFilterState {
  status: string;
  fromDate: string;
  toDate: string;
  costCentreId: string;
  search: string;
  page: number;
}

const EMPTY_FILTERS = (status: string): ListFilterState => ({
  status, fromDate: "", toDate: "", costCentreId: "", search: "", page: 1,
});

/**
 * Shown in the actions cell in place of Approve/Reject on a row the live workflow can
 * never act on.
 *
 * Every one of the 10,794 invoices and 144 credit notes currently in this module came from
 * the 2026-08-19 legacy cutover and carries `is_migrated = 1`. Both approval services
 * refuse those rows outright (design §3 — a migrated historical record is read-only through
 * the live workflow), but this page rendered Approve/Reject on them regardless, so the two
 * pending proformas and 23 draft credit notes presented as actionable work that no click
 * could ever clear. Confirmed live 2026-08-27: clicking Approve returned
 * "...is a migrated historical record (is_migrated=1) and cannot be approved through the
 * live workflow" — a developer-facing string, aimed at a finance user, naming an internal
 * column and a raw UUID.
 *
 * The row stays fully visible and readable (Preview / Download PDF / detail are unchanged);
 * only the two buttons that cannot succeed are replaced by an explanation of why.
 */
function HistoricalRecordTag() {
  return (
    <span
      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500"
      title="Migrated from the legacy billing system — historical record, read-only. It cannot be approved or rejected here."
    >
      Historical
    </span>
  );
}

/** Compact stat tile — same visual language as BranchBudgetManagementWorkspace.tsx's
 *  `Metric` (border/tint per tone, uppercase label, bold value), kept file-local to match
 *  that page's own convention of not sharing this across pages. */
function Metric({ label, value, sub, tone = "slate" }: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "blue" | "emerald" | "amber" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    blue: "border-blue-200 bg-blue-50/80",
    emerald: "border-emerald-200 bg-emerald-50/80",
    amber: "border-amber-200 bg-amber-50/80",
    rose: "border-rose-200 bg-rose-50/80",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-base font-bold text-slate-900">{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

/** Reusable filter bar: search, date range, cost-centre picker, optional status select, and
 *  a CSV export button — shared by all three tabs so filter behavior never drifts between
 *  them. Directly bound onChange (no debounce), matching VendorPaymentDispatchPage.tsx's own
 *  filter inputs — the dataset here is small enough that per-keystroke queries are fine. */
function ListToolbar({
  filters, onChange, statusOptions, costCentreOptions, searchPlaceholder, onExport, isExporting,
}: {
  filters: ListFilterState;
  onChange: (next: ListFilterState) => void;
  statusOptions?: ReadonlyArray<{ value: string; label: string }>;
  costCentreOptions: SearchableOption[];
  searchPlaceholder: string;
  onExport: () => void;
  isExporting: boolean;
}) {
  const set = (patch: Partial<ListFilterState>) => onChange({ ...filters, ...patch, page: 1 });
  const hasActiveFilters = Boolean(filters.fromDate || filters.toDate || filters.costCentreId || filters.search);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {statusOptions && (
        <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        value={filters.fromDate}
        onChange={(e) => set({ fromDate: e.target.value })}
        title="From date"
      />
      <Input
        type="date"
        className="h-8 w-36 text-xs"
        value={filters.toDate}
        onChange={(e) => set({ toDate: e.target.value })}
        title="To date"
      />
      <div className="w-56">
        <SearchableSelect
          options={costCentreOptions}
          value={filters.costCentreId}
          onChange={(v) => set({ costCentreId: v })}
          placeholder="All cost centres"
          searchPlaceholder="Search cost centre…"
          emptyText="No cost centre found."
          aria-label="Cost centre"
        />
      </div>
      <div className="relative">
        <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
        <Input
          className="h-8 w-52 pl-7 text-xs"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder={searchPlaceholder}
        />
      </div>
      {hasActiveFilters && (
        <Button
          variant="ghost" size="sm" className="h-8 text-xs"
          onClick={() => onChange(EMPTY_FILTERS(filters.status))}
        >
          <X className="mr-1 h-3 w-3" />Clear
        </Button>
      )}
      <div className="ml-auto">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onExport} disabled={isExporting}>
          {isExporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Export CSV
        </Button>
      </div>
    </div>
  );
}

function PaginationFooter({ page, total, onPageChange }: {
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between border-t px-1 py-2 text-xs">
      <span className="text-slate-500">
        Showing {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}
        –{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />Prev
        </Button>
        <span className="font-semibold">{page} / {totalPages}</span>
        <Button
          variant="outline" size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Next<ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/** Split download button: with-letterhead (branded, for emailing to the client) or without
 *  (for printing onto pre-printed letterhead stationery) — same invoice content either way,
 *  see clientBillingApi.ts's downloadInvoicePdf. Hoisted out of the page component so it
 *  isn't redefined (and remounted) on every render. */
function DownloadPdfButton({
  kind, id, docNumber, downloadingId, onDownload,
}: {
  kind: "proforma" | "invoice" | "credit-note";
  id: string;
  docNumber: string;
  downloadingId: string | null;
  onDownload: (kind: "proforma" | "invoice" | "credit-note", id: string, docNumber: string, letterhead: boolean) => unknown;
}) {
  const isDownloading = downloadingId === id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Download PDF" disabled={isDownloading}>
          {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => { void onDownload(kind, id, docNumber, true); }}>
          With letterhead
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void onDownload(kind, id, docNumber, false); }}>
          Without letterhead (for printed stationery)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Inline PDF preview dialog — fetches the same PDF the download button would, but renders
 *  it in an <iframe> (browsers render application/pdf blobs natively) instead of forcing a
 *  save, so an approver can see exactly what will print before downloading it. Revokes its
 *  object URL on close to avoid leaking blob memory across many previews in one session. */
function PdfPreviewDialog({
  target, onOpenChange,
}: {
  target: { kind: "proforma" | "invoice" | "credit-note"; id: string; label: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [letterhead, setLetterhead] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    previewInvoicePdfUrl(target.kind, target.id, letterhead)
      .then((objectUrl) => { if (!cancelled) setUrl(objectUrl); })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: "Preview failed",
            description: error instanceof Error ? error.message : "Unable to load PDF preview",
            variant: "destructive",
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id, target?.kind, letterhead]);

  useEffect(() => {
    if (!target) {
      if (url) URL.revokeObjectURL(url);
      setUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="flex-row items-center justify-between border-b px-4 py-3">
          <DialogTitle className="text-sm font-semibold">Preview — {target?.label}</DialogTitle>
          <div className="flex items-center gap-1 pr-8 text-xs">
            <Button
              size="sm" variant={letterhead ? "default" : "outline"} className="h-7 text-xs"
              onClick={() => setLetterhead(true)}
            >
              Letterhead
            </Button>
            <Button
              size="sm" variant={!letterhead ? "default" : "outline"} className="h-7 text-xs"
              onClick={() => setLetterhead(false)}
            >
              Plain
            </Button>
          </div>
        </DialogHeader>
        <div className="flex-1 bg-slate-100">
          {loading || !url ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <iframe title="PDF preview" src={url} className="h-full w-full border-0" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientBillingWorkspacePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [proformaFilters, setProformaFilters] = useState<ListFilterState>(EMPTY_FILTERS("proforma"));
  const [invoiceFilters, setInvoiceFilters] = useState<ListFilterState>(EMPTY_FILTERS("approved"));
  const [creditNoteFilters, setCreditNoteFilters] = useState<ListFilterState>(EMPTY_FILTERS("_all"));

  const [createProformaOpen, setCreateProformaOpen] = useState(false);
  const [createCreditNoteOpen, setCreateCreditNoteOpen] = useState(false);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailCreditNoteId, setDetailCreditNoteId] = useState<string | null>(null);
  const [auditInvoice, setAuditInvoice] = useState<{ id: string; label: string } | null>(null);
  const [rejectInvoiceTarget, setRejectInvoiceTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveCreditTarget, setApproveCreditTarget] = useState<{ id: string; label: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ kind: "proforma" | "invoice" | "credit-note"; id: string; label: string } | null>(null);

  // Same hook + label convention as CreateProformaSheet.tsx's own cost-centre picker —
  // cost_centre_name first (billing_client_name is a search keyword only, matching that
  // component exactly rather than inventing a different label rule here).
  const costCentreQuery = useCostCentreList({ status: "active", limit: 500 });
  const costCentreOptions: SearchableOption[] = [
    // A synthetic leading option so the filter can be cleared from inside the dropdown
    // itself, not only via the toolbar's broader "Clear all" button — SearchableSelect has
    // no built-in clear affordance, callers supply one as a real option.
    { value: "", label: "All cost centres" },
    ...(costCentreQuery.data?.data ?? []).map((cc) => ({
      value: cc.id,
      label: cc.cost_centre_name || cc.cost_centre_code || cc.id,
      hint: cc.cost_centre_code,
      keywords: `${cc.client_name ?? ""} ${cc.billing_client_name ?? ""} ${cc.branch_name ?? ""}`,
    })),
  ];

  const summaryQuery = useQuery({
    queryKey: ["client-billing", "summary"],
    queryFn: () => getSummary(),
  });
  const summary = summaryQuery.data?.data;

  function toApiFilters(f: ListFilterState, statusOverride?: string): ClientBillingListFilters {
    return {
      status: statusOverride ?? (f.status === "_all" ? undefined : f.status),
      fromDate: f.fromDate || undefined,
      toDate: f.toDate || undefined,
      costCentreId: f.costCentreId || undefined,
      search: f.search || undefined,
      page: f.page,
      limit: PAGE_SIZE,
    };
  }

  const proformasQuery = useQuery({
    queryKey: ["client-billing", "proformas", proformaFilters],
    queryFn: () => listProformas(toApiFilters(proformaFilters)),
  });
  const proformaRows: InvoiceRow[] = proformasQuery.data?.data ?? [];
  const proformaTotal = proformasQuery.data?.total ?? 0;

  const invoicesQuery = useQuery({
    queryKey: ["client-billing", "invoices", invoiceFilters],
    queryFn: () => listProformas(toApiFilters(invoiceFilters, "approved")),
  });
  const invoiceRows: InvoiceRow[] = invoicesQuery.data?.data ?? [];
  const invoiceTotal = invoicesQuery.data?.total ?? 0;

  const creditNotesQuery = useQuery({
    queryKey: ["client-billing", "credit-notes", creditNoteFilters],
    queryFn: () => listCreditNotes(toApiFilters(creditNoteFilters)),
  });
  const creditNoteRows: CreditNoteRow[] = creditNotesQuery.data?.data ?? [];
  const creditNoteTotal = creditNotesQuery.data?.total ?? 0;

  // A dedicated, unpaginated fetch for the "New Credit Note" picker — it needs every
  // approved invoice to search over, not just whatever page the Invoices tab happens to be
  // showing. Lazy: only fires once the sheet is actually opened.
  const approvedInvoicesForSheetQuery = useQuery({
    queryKey: ["client-billing", "approved-invoices-for-credit-note"],
    queryFn: () => listProformas({ status: "approved", limit: 200 }),
    enabled: createCreditNoteOpen,
  });

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: ["client-billing"] });
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveInvoice(id),
    onSuccess: (res) => {
      toast({ title: "Proforma approved", description: res.data?.billNo ? `Bill no. ${res.data.billNo}` : undefined });
      invalidateAll();
      setApproveTarget(null);
    },
    // Dismiss the confirm dialog on failure too, not only on success. It used to stay open
    // over the toast: the click appeared to do nothing, the error was hidden behind the
    // dialog, and the still-live Approve button invited the user to try again forever.
    // Observed live 2026-08-27 against a migrated proforma.
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      setApproveTarget(null);
    },
  });

  const approveCreditMutation = useMutation({
    mutationFn: (id: string) => approveCreditNote(id),
    onSuccess: () => {
      toast({ title: "Credit note approved" });
      invalidateAll();
      setApproveCreditTarget(null);
    },
    // Same reasoning as approveMutation above — close the dialog so the toast is visible.
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      setApproveCreditTarget(null);
    },
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exportingKind, setExportingKind] = useState<"proformas" | "credit-notes" | null>(null);

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

  async function handleExport(kind: "proformas" | "credit-notes", filters: ListFilterState, statusOverride?: string) {
    setExportingKind(kind);
    try {
      await exportClientBillingCsv(
        kind,
        toApiFilters({ ...filters, page: 1 }, statusOverride),
        `client-billing-${kind}-export.csv`
      );
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

  const isRefreshing = proformasQuery.isFetching || invoicesQuery.isFetching || creditNotesQuery.isFetching || summaryQuery.isFetching;

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
              void invoicesQuery.refetch();
              void creditNotesQuery.refetch();
              void summaryQuery.refetch();
            }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* ── Summary stat row ── */}
        {summary && (
          <div className="grid grid-cols-2 gap-2 border-b bg-slate-50/60 px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
            <Metric
              label="Pending Approval"
              value={String(summary.pendingApprovalCount)}
              tone="amber"
              sub="proformas awaiting review"
            />
            <Metric
              label="Approved (all-time)"
              value={money(summary.invoices.approved.total)}
              tone="emerald"
              sub={`${summary.invoices.approved.count} invoices`}
            />
            <Metric
              label="Billed This Month"
              value={money(summary.thisMonthBilled.total)}
              tone="blue"
              sub={`${summary.thisMonthBilled.count} invoices`}
            />
            <Metric
              label="Rejected"
              value={String(summary.invoices.rejected.count)}
              tone="rose"
            />
            <Metric
              label="Credit Notes"
              value={money(summary.creditNotes.draft.total + summary.creditNotes.approved.total)}
              sub={`${summary.creditNotes.draft.count} draft · ${summary.creditNotes.approved.count} approved`}
            />
          </div>
        )}

        <Tabs defaultValue="proformas" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="proformas">Proformas</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
          </TabsList>

          {/* ── Proformas tab ── */}
          <TabsContent value="proformas" className="flex flex-1 flex-col overflow-hidden px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <ListToolbar
                filters={proformaFilters}
                onChange={setProformaFilters}
                statusOptions={PROFORMA_STATUS_FILTERS}
                costCentreOptions={costCentreOptions}
                searchPlaceholder="Proforma / bill no, client…"
                onExport={() => void handleExport("proformas", proformaFilters)}
                isExporting={exportingKind === "proformas"}
              />
              <Button size="sm" className="h-8 shrink-0" onClick={() => setCreateProformaOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />New Proforma
              </Button>
            </div>

            {proformasQuery.isError && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {proformasQuery.error instanceof Error ? proformasQuery.error.message : "Unable to load proformas"}
              </div>
            )}

            <div className="flex-1 overflow-y-auto rounded-md border">
              {proformasQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : (
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
                          <TableCell className="text-xs text-muted-foreground">
                            {row.cost_centre_display_name || row.cost_centre_code || row.cost_centre_id}
                          </TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><InvoiceStatusBadge status={row.invoice_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7" title="Preview"
                                onClick={() => setPreviewTarget({ kind: "proforma", id: row.id, label: row.proforma_no ?? row.id })}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <DownloadPdfButton kind="proforma" id={row.id} docNumber={row.proforma_no ?? row.id} downloadingId={downloadingId} onDownload={handleDownload} />
                              {row.invoice_status === "proforma" && (
                                row.is_migrated
                                  ? <HistoricalRecordTag />
                                  : (
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
                                  )
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
            <PaginationFooter page={proformaFilters.page} total={proformaTotal} onPageChange={(page) => setProformaFilters((f) => ({ ...f, page }))} />
          </TabsContent>

          {/* ── Invoices tab ── */}
          <TabsContent value="invoices" className="flex flex-1 flex-col overflow-hidden px-4 py-3">
            <ListToolbar
              filters={invoiceFilters}
              onChange={setInvoiceFilters}
              costCentreOptions={costCentreOptions}
              searchPlaceholder="Bill no, client…"
              onExport={() => void handleExport("proformas", invoiceFilters, "approved")}
              isExporting={exportingKind === "proformas"}
            />

            {invoicesQuery.isError && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {invoicesQuery.error instanceof Error ? invoicesQuery.error.message : "Unable to load invoices"}
              </div>
            )}

            <div className="flex-1 overflow-y-auto rounded-md border">
              {invoicesQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : (
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
                          No approved invoices found
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
                          <TableCell className="text-xs text-muted-foreground">
                            {row.cost_centre_display_name || row.cost_centre_code || row.cost_centre_id}
                          </TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><InvoiceStatusBadge status={row.invoice_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7" title="Preview"
                                onClick={() => setPreviewTarget({ kind: "invoice", id: row.id, label: row.bill_no ?? row.id })}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <DownloadPdfButton kind="invoice" id={row.id} docNumber={row.bill_no ?? row.id} downloadingId={downloadingId} onDownload={handleDownload} />
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
              )}
            </div>
            <PaginationFooter page={invoiceFilters.page} total={invoiceTotal} onPageChange={(page) => setInvoiceFilters((f) => ({ ...f, page }))} />
          </TabsContent>

          {/* ── Credit Notes tab ── */}
          <TabsContent value="credit-notes" className="flex flex-1 flex-col overflow-hidden px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <ListToolbar
                filters={creditNoteFilters}
                onChange={setCreditNoteFilters}
                statusOptions={CREDIT_NOTE_STATUS_FILTERS}
                costCentreOptions={costCentreOptions}
                searchPlaceholder="Credit no, client…"
                onExport={() => void handleExport("credit-notes", creditNoteFilters)}
                isExporting={exportingKind === "credit-notes"}
              />
              <Button size="sm" className="h-8 shrink-0" onClick={() => setCreateCreditNoteOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />New Credit Note
              </Button>
            </div>

            {creditNotesQuery.isError && (
              <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {creditNotesQuery.error instanceof Error ? creditNotesQuery.error.message : "Unable to load credit notes"}
              </div>
            )}

            <div className="flex-1 overflow-y-auto rounded-md border">
              {creditNotesQuery.isLoading ? (
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
                    {creditNoteRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                          No credit notes found
                        </TableCell>
                      </TableRow>
                    ) : (
                      creditNoteRows.map((row) => (
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
                          <TableCell className="text-xs text-muted-foreground">
                            {row.against_invoice_number || row.invoice_id}
                          </TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell>{row.month_label} · {row.finance_year}</TableCell>
                          <TableCell>{row.gst_type}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(row.grand_total)}</TableCell>
                          <TableCell><CreditStatusBadge status={row.credit_status} /></TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7" title="Preview"
                                onClick={() => setPreviewTarget({ kind: "credit-note", id: row.id, label: row.credit_no ?? row.id })}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <DownloadPdfButton kind="credit-note" id={row.id} docNumber={row.credit_no ?? row.id} downloadingId={downloadingId} onDownload={handleDownload} />
                              {row.credit_status === "draft" && (
                                row.is_migrated
                                  ? <HistoricalRecordTag />
                                  : (
                                    <Button
                                      size="icon" variant="ghost" className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                                      title="Approve"
                                      onClick={() => setApproveCreditTarget({ id: row.id, label: row.credit_no ?? row.id })}
                                    >
                                      <ThumbsUp className="h-3.5 w-3.5" />
                                    </Button>
                                  )
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
              )}
            </div>
            <PaginationFooter page={creditNoteFilters.page} total={creditNoteTotal} onPageChange={(page) => setCreditNoteFilters((f) => ({ ...f, page }))} />
          </TabsContent>
        </Tabs>
      </div>

      <CreateProformaSheet
        open={createProformaOpen}
        onOpenChange={setCreateProformaOpen}
        onCreated={() => invalidateAll()}
      />
      <CreateCreditNoteSheet
        open={createCreditNoteOpen}
        onOpenChange={setCreateCreditNoteOpen}
        approvedInvoices={approvedInvoicesForSheetQuery.data?.data ?? []}
        onCreated={() => invalidateAll()}
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
        onRejected={() => invalidateAll()}
      />
      <PdfPreviewDialog
        target={previewTarget}
        onOpenChange={(open) => !open && setPreviewTarget(null)}
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
