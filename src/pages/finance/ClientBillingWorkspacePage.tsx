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
import { useApprovalFocus } from "@/hooks/useApprovalFocus";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Download, Eye, FileText, Loader2, Plus, RefreshCw,
  Search, ThumbsUp, X,
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
import {
  approveCreditNote,
  approveInvoicePo,
  exportInvoiceCsv,
  downloadInvoicePdf,
  exportClientBillingCsv,
  getSummary,
  listCreditNotes,
  listProformas,
  previewInvoicePdfUrl,
  type ClientBillingListFilters,
  type CreditNoteRow,
  type InvoiceRow,
} from "@/lib/clientBillingApi";
import { AuditLogDialog } from "@/components/finance/client-billing/AuditLogDialog";
import { CreateCreditNoteSheet } from "@/components/finance/client-billing/CreateCreditNoteSheet";
import { ProformaEntrySheet } from "@/components/finance/client-billing/ProformaEntrySheet";
import { InvoiceApproveView } from "@/components/finance/client-billing/InvoiceApproveView";
import { DownloadInvoiceList, InvoiceApprovalList, ProformaApprovalList } from "@/components/finance/client-billing/LegacyBillingLists";
import { AddGrnDialog, PoGrnTab } from "@/components/finance/client-billing/PoGrnTab";
import { ReceiptsTab } from "@/components/finance/client-billing/ReceiptsTab";
import { CreditNoteDetailDialog } from "@/components/finance/client-billing/CreditNoteDetailDialog";
import { InvoiceDetailDialog } from "@/components/finance/client-billing/InvoiceDetailDialog";
import { RejectInvoiceDialog } from "@/components/finance/client-billing/RejectInvoiceDialog";
import { CreditStatusBadge, money, moneyCompact } from "@/components/finance/client-billing/shared";
import {
  BillingScopeSelects, costCentreSearchOptions, narrowCostCentres, useBillingFilterOptions,
} from "@/components/finance/client-billing/BillingScopeSelects";
import { BillingSequenceStepper, type BillingTab } from "@/components/finance/client-billing/BillingSequenceStepper";
import { ProvisionsTab } from "@/components/finance/client-billing/ProvisionsTab";
import { ChangeRequestDialog, type ChangeRequestTarget } from "@/components/finance/client-billing/ChangeRequestDialog";
import { ChangeRequestsTab } from "@/components/finance/client-billing/ChangeRequestsTab";
import { SubmitToClientDialog } from "@/components/finance/client-billing/SubmitToClientDialog";

const PAGE_SIZE = 25;


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
  companyName: string;
  branchId: string;
  search: string;
  page: number;
}

const EMPTY_FILTERS = (status: string): ListFilterState => ({
  status, fromDate: "", toDate: "", costCentreId: "", companyName: "", branchId: "", search: "", page: 1,
});

const TABS: Array<BillingTab | "change-requests" | "po" | "receipts"> = ["provisions", "proformas", "invoice-approval", "invoices", "receipts", "po", "credit-notes", "change-requests"];

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
  costCentreOptions: (filters: ListFilterState) => SearchableOption[];
  searchPlaceholder: string;
  onExport: () => void;
  isExporting: boolean;
}) {
  const set = (patch: Partial<ListFilterState>) => onChange({ ...filters, ...patch, page: 1 });
  const hasActiveFilters = Boolean(
    filters.fromDate || filters.toDate || filters.costCentreId || filters.search || filters.companyName || filters.branchId,
  );
  return (
    /*
     * Two explicit groups — filters, then actions — rather than one wrapping row with
     * `ml-auto` on the export button. With a single flex-wrap row, `ml-auto` resolves
     * against whichever line the button lands on, so below ~1280px the search box wrapped
     * to line two on the left and Export/New Proforma sat at the far right of that same
     * line with a wide gap between them. Observed live at 1024px. Grouping keeps the
     * filters together and the actions together at every width.
     */
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Legacy screens open with Company + Branch; picking one narrows the cost centres. */}
        <BillingScopeSelects
          compact
          companyName={filters.companyName}
          branchId={filters.branchId}
          onChange={(next) => set({ ...next, costCentreId: "" })}
        />
        {statusOptions && (
          <Select value={filters.status} onValueChange={(v) => set({ status: v })}>
            <SelectTrigger className="h-8 w-48 text-xs" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Both date boxes rendered an identical bare "dd-mm-yyyy", with the from/to
            distinction only in a `title` tooltip — invisible on keyboard focus and on touch.
            They are one control conceptually, so they live in one non-shrinking group with an
            inline "–" between them: the pair can never be split across two wrapped lines, and
            the captions sit beside the inputs rather than above, which keeps the whole filter
            bar one row tall. (A first attempt stacked a caption over each input separately —
            that doubled the row height and at 1024px pushed To onto its own line below From,
            which read worse than the unlabelled version it replaced.) */}
        <div className="flex shrink-0 items-center gap-1.5 rounded-md border bg-slate-50/60 px-2 py-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">From</span>
          <Input
            type="date"
            className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
            value={filters.fromDate}
            onChange={(e) => set({ fromDate: e.target.value })}
            aria-label="From date"
          />
          <span className="text-slate-400">–</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">To</span>
          <Input
            type="date"
            className="h-6 w-32 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-1"
            value={filters.toDate}
            onChange={(e) => set({ toDate: e.target.value })}
            aria-label="To date"
          />
        </div>
        <div className="w-48">
          <SearchableSelect
            options={costCentreOptions(filters)}
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
            className="h-8 w-44 pl-7 text-xs"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
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
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
        <Button size="icon" variant="ghost" className="h-7 w-7" title="Download PDF" aria-label="Download PDF" disabled={isDownloading}>
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

  const [entry, setEntry] = useState<{ open: boolean; editId: string | null }>({ open: false, editId: null });
  const [approveView, setApproveView] = useState<{ id: string; mode: "proforma" | "invoice" | "view" } | null>(null);
  const [grnTarget, setGrnTarget] = useState<{ id: string; label: string; grnNo?: string | null; grnDate?: string | null } | null>(null);
  // Legacy confirmation, word for word: "Bill No. 09-171/26-27 to Branch NOIDA-2 for amount 778901 for Sep-26 Generated Successfully. And moved to Branch"
  const [billBanner, setBillBanner] = useState<string | null>(null);
  const [creditNoteFilters, setCreditNoteFilters] = useState<ListFilterState>(EMPTY_FILTERS("_all"));

  const [createCreditNoteOpen, setCreateCreditNoteOpen] = useState(false);
  // Approval Center deep link: ?tab=<tab>&approvalId=<id> opens that record's detail.
  const deepLinkParams = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const deepLinkId = deepLinkParams.get("approvalId");
  const rawTab = deepLinkParams.get("tab") as BillingTab | "change-requests" | "po" | "receipts" | null;
  const deepLinkTab = rawTab && TABS.includes(rawTab) ? rawTab : "proformas";
  const [activeTab, setActiveTab] = useState<BillingTab | "change-requests" | "po" | "receipts">(deepLinkTab);
  const [changeRequestTarget, setChangeRequestTarget] = useState<ChangeRequestTarget | null>(null);
  const [submitTarget, setSubmitTarget] = useState<{ id: string; label: string } | null>(null);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(
    deepLinkId && (deepLinkTab === "proformas" || deepLinkTab === "invoice-approval") ? deepLinkId : null,
  );
  const [detailCreditNoteId, setDetailCreditNoteId] = useState<string | null>(deepLinkId && deepLinkTab === "credit-notes" ? deepLinkId : null);
  const [auditInvoice, setAuditInvoice] = useState<{ id: string; label: string } | null>(null);
  const [rejectInvoiceTarget, setRejectInvoiceTarget] = useState<{ id: string; label: string } | null>(null);
  const [approveCreditTarget, setApproveCreditTarget] = useState<{ id: string; label: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ kind: "proforma" | "invoice" | "credit-note"; id: string; label: string } | null>(null);

  // Company / Branch / cost centre options (active MAS cost centres). The cost-centre picker
  // in each toolbar only offers what belongs to that toolbar's chosen company / branch.
  const allCostCentres = useBillingFilterOptions().data?.data.costCentres ?? [];
  const costCentreOptions = (f: ListFilterState): SearchableOption[] => [
    // A synthetic leading option so the filter can be cleared from inside the dropdown
    // itself — SearchableSelect has no built-in clear affordance.
    { value: "", label: "All cost centres" },
    ...costCentreSearchOptions(narrowCostCentres(allCostCentres, f.companyName, f.branchId)),
  ];

  const summaryQuery = useQuery({
    queryKey: ["client-billing", "summary"],
    queryFn: () => getSummary(),
  });
  const summary = summaryQuery.data?.data;

  function toApiFilters(f: ListFilterState, statusOverride?: string): ClientBillingListFilters {
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

  const creditNotesQuery = useQuery({
    queryKey: ["client-billing", "credit-notes", creditNoteFilters],
    queryFn: () => listCreditNotes(toApiFilters(creditNoteFilters)),
  });
  const creditNoteRows: CreditNoteRow[] = creditNotesQuery.data?.data ?? [];
  const creditNoteTotal = creditNotesQuery.data?.total ?? 0;
  useApprovalFocus(!creditNotesQuery.isLoading);

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

  const approvePoMutation = useMutation({
    mutationFn: (id: string) => approveInvoicePo(id),
    onSuccess: () => { toast({ title: "PO approved" }); invalidateAll(); },
    onError: (error: Error) => toast({ title: "Approve PO failed", description: error.message, variant: "destructive" }),
  });

  const approveCreditMutation = useMutation({
    mutationFn: (id: string) => approveCreditNote(id),
    onSuccess: () => {
      toast({ title: "Credit note approved" });
      invalidateAll();
      setApproveCreditTarget(null);
    },
    // Close the dialog on failure too, so the toast is visible (it used to hide behind it).
    onError: (error: Error) => {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      setApproveCreditTarget(null);
    },
  });

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function handleInvoiceExport(row: InvoiceRow) {
    try {
      const name = String(row.bill_no ?? row.proforma_no ?? row.id).replace(/[^A-Za-z0-9._-]+/g, "_");
      await exportInvoiceCsv(row.id, `invoice-${name}.csv`);
    } catch (error) {
      toast({ title: "Export failed", description: error instanceof Error ? error.message : "Unable to export", variant: "destructive" });
    }
  }
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

  const isRefreshing = creditNotesQuery.isFetching || summaryQuery.isFetching;

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
          <Button
            size="sm"
            variant="ghost"
            // Icon-only and previously carried neither text, title nor aria-label, so it was
            // announced as just "button" — the only control on the page with no name at all.
            title="Refresh"
            aria-label="Refresh"
            onClick={() => {
              invalidateAll();
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
              value={moneyCompact(summary.invoices.approved.total)}
              tone="emerald"
              sub={`${summary.invoices.approved.count} invoices`}
            />
            <Metric
              label="Billed This Month"
              value={moneyCompact(summary.thisMonthBilled.total)}
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
              value={moneyCompact(summary.creditNotes.draft.total + summary.creditNotes.approved.total)}
              sub={`${summary.creditNotes.draft.count} draft · ${summary.creditNotes.approved.count} approved`}
            />
          </div>
        )}

        <BillingSequenceStepper
          active={activeTab === "change-requests" || activeTab === "po" ? "invoices" : activeTab}
          onSelect={setActiveTab}
          counts={[
            summary?.pendingProvisionCount,
            undefined,
            summary?.awaitingProformaApprovalCount,
            summary?.awaitingInvoiceApprovalCount,
            undefined,
            undefined,
          ]}
        />

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as BillingTab | "change-requests" | "po" | "receipts")} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 w-fit">
            <TabsTrigger value="provisions">1 · Provision</TabsTrigger>
            <TabsTrigger value="proformas">2–3 · View &amp; Approve Proforma</TabsTrigger>
            <TabsTrigger value="invoice-approval">4 · Invoice Approval</TabsTrigger>
            <TabsTrigger value="invoices">5 · Download Initial Invoice</TabsTrigger>
            <TabsTrigger value="receipts">6 · Receipts</TabsTrigger>
            <TabsTrigger value="po">ADD PO</TabsTrigger>
            <TabsTrigger value="credit-notes">Credit Notes</TabsTrigger>
            <TabsTrigger value="change-requests">Delete / Status Change Approval</TabsTrigger>
          </TabsList>

          {/* ── Legacy "Approval Invoice Delete Request" + "Invoice Status Change Approval" ── */}
          <TabsContent value="change-requests" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <ChangeRequestsTab />
          </TabsContent>

          {/* ── Provision tab (legacy Create / Approve / Upload / View & Edit Provision) ── */}
          <TabsContent value="provisions" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <ProvisionsTab />
          </TabsContent>

          {/* ── Legacy "Initial Invoice/Proforma" + "View & Approve Proforma" ── */}
          <TabsContent value="proformas" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <ProformaApprovalList
              onCreate={() => setEntry({ open: true, editId: null })}
              onEdit={(r) => setEntry({ open: true, editId: r.id })}
              onApprove={(r) => setApproveView({ id: r.id, mode: "proforma" })}
              onReject={(r) => setRejectInvoiceTarget({ id: r.id, label: r.proforma_no ?? r.id })}
              onDownload={(r, lh) => void handleDownload("proforma", r.id, r.proforma_no ?? r.id, lh)}
            />
          </TabsContent>

          {/* ── Legacy "Invoice Approval": view -> Approved generates the bill number ── */}
          <TabsContent value="invoice-approval" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <InvoiceApprovalList
              banner={billBanner}
              onView={(r) => setApproveView({ id: r.id, mode: "invoice" })}
              onEdit={(r) => setEntry({ open: true, editId: r.id })}
            />
          </TabsContent>

          {/* ── Legacy "Download Initial Invoice" ── */}
          <TabsContent value="invoices" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <DownloadInvoiceList
              onDownload={(r, lh) => void handleDownload("invoice", r.id, r.bill_no ?? r.id, lh)}
              onExport={(r) => void handleInvoiceExport(r)}
              onView={(r) => setApproveView({ id: r.id, mode: "view" })}
              onAddGrn={(r) => setGrnTarget({ id: r.id, label: r.bill_no ?? r.id, grnNo: r.grn_no, grnDate: r.grn_date })}
              onApprovePo={(r) => approvePoMutation.mutate(r.id)}
              onSubmit={(r) => setSubmitTarget({ id: r.id, label: r.bill_no ?? r.id })}
              onDeleteRequest={(r) => setChangeRequestTarget({ id: r.id, label: r.bill_no ?? r.id, category: r.category, requestType: "void" })}
              onAudit={(r) => setAuditInvoice({ id: r.id, label: r.bill_no ?? r.id })}
            />
          </TabsContent>

          {/* ── Money received against bills (the only place client receipts are recorded) ── */}
          <TabsContent value="receipts" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <ReceiptsTab />
          </TabsContent>

          {/* ── Legacy "ADD PO" ── */}
          <TabsContent value="po" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
            <PoGrnTab />
          </TabsContent>

          {/* ── Credit Notes tab ── */}
          <TabsContent value="credit-notes" className="flex flex-1 flex-col overflow-hidden px-4 py-3 data-[state=inactive]:hidden">
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
                        <TableRow key={row.id} data-approval-id={row.id}>
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
                                size="icon" variant="ghost" className="h-7 w-7" title="Preview" aria-label="Preview"
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
                                      title="Approve" aria-label="Approve"
                                      onClick={() => setApproveCreditTarget({ id: row.id, label: row.credit_no ?? row.id })}
                                    >
                                      <ThumbsUp className="h-3.5 w-3.5" />
                                    </Button>
                                  )
                              )}
                              <Button
                                size="icon" variant="ghost" className="h-7 w-7"
                                title="View details" aria-label="View details"
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

      <ProformaEntrySheet
        open={entry.open}
        onOpenChange={(open) => !open && setEntry({ open: false, editId: null })}
        onSaved={() => invalidateAll()}
        editInvoiceId={entry.editId}
      />
      <InvoiceApproveView
        invoiceId={approveView?.id ?? null}
        mode={approveView?.mode ?? "view"}
        onClose={() => setApproveView(null)}
        onApproved={(r) => setBillBanner(
          `Bill No. ${r.billNo ?? ""} to Branch ${r.branch ?? ""} for amount ${r.amount} for ${r.month} Generated Successfully. And moved to Branch`,
        )}
      />
      <AddGrnDialog target={grnTarget} onClose={() => setGrnTarget(null)} />
      <CreateCreditNoteSheet
        open={createCreditNoteOpen}
        onOpenChange={setCreateCreditNoteOpen}
        approvedInvoices={approvedInvoicesForSheetQuery.data?.data ?? []}
        onCreated={() => invalidateAll()}
      />
      <ChangeRequestDialog
        target={changeRequestTarget}
        onOpenChange={(open) => !open && setChangeRequestTarget(null)}
      />
      <SubmitToClientDialog
        target={submitTarget}
        onOpenChange={(open) => !open && setSubmitTarget(null)}
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
