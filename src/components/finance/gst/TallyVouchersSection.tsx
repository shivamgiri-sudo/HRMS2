import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileCode2, Settings2 } from "lucide-react";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { dateTimeLabel } from "@/components/finance/grn/grn-format";
import {
  GrnAlert,
  GrnCard,
  GrnCardHeader,
  GrnChip,
  GrnEmptyState,
  GrnInput,
  GrnTable,
  GrnTd,
  GrnTh,
  GRN_TR,
} from "@/components/finance/grn/grn-ui";
import { listRegistrations } from "@/lib/gstExportApi";
import {
  downloadTallyBatchXml,
  getTallyConfig,
  listTallyBatches,
  listTallyKinds,
  previewTallyVouchers,
  saveTallyConfig,
  type TallyBatch,
  type TallyPreview,
  type TallyVoucherRow,
} from "@/lib/tallyVoucherApi";
import { TallyPreviewDialog } from "@/components/finance/gst/TallyPreviewDialog";
import { TallyVoucherDrawer } from "@/components/finance/gst/TallyVoucherDrawer";

const ALL_KINDS = "all";
const MONTHS_BACK = 36;
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const CONFIG_LABELS: Record<string, string> = {
  tally_company_name: "Tally company name (this registration only)",
  sales_ledger: "Sales ledger (default)",
  credit_note_sales_ledger: "Credit note sales-return ledger",
  igst_ledger: "Output IGST ledger",
  cgst_ledger: "Output CGST ledger",
  sgst_ledger: "Output SGST ledger",
  round_off_ledger: "Round-off ledger",
  tds_receivable_ledger: "TDS receivable ledger (receipts)",
  sales_voucher_type: "Sales voucher type",
  credit_note_voucher_type: "Credit note voucher type",
  receipt_voucher_type: "Receipt voucher type",
};

function periodOptions(): SearchableOption[] {
  const now = new Date();
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      value,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
      keywords: value,
    };
  });
}

/** "Tally Vouchers (XML)": sales + credit-note vouchers for Tally Prime import. */
export function TallyVouchersSection() {
  const qc = useQueryClient();
  const periods = useMemo(periodOptions, []);
  const [companyGstin, setCompanyGstin] = useState("");
  const [periodMonth, setPeriodMonth] = useState(periods[0].value);
  const [kindChoice, setKindChoice] = useState(ALL_KINDS);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<TallyPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [drawer, setDrawer] = useState<{
    sourceType: string;
    sourceId: string;
  } | null>(null);

  const registrations = useQuery({
    queryKey: ["gst-registrations"],
    queryFn: listRegistrations,
  });
  const kinds = useQuery({
    queryKey: ["tally-kinds"],
    queryFn: listTallyKinds,
  });
  const batches = useQuery({
    queryKey: ["tally-batches", companyGstin],
    queryFn: () =>
      listTallyBatches({ companyGstin: companyGstin || undefined, limit: 30 }),
  });

  const companyOptions: SearchableOption[] = (registrations.data ?? []).map(
    (r) => ({
      value: r.company_gstin,
      label: r.company_name ?? "(unnamed)",
      hint: r.company_gstin,
      keywords: r.company_gstin,
    }),
  );
  const kindOptions: SearchableOption[] = [
    { value: ALL_KINDS, label: "All voucher types" },
    ...(kinds.data ?? []).map((k) => ({ value: k.kind, label: k.label })),
  ];
  const voucherKinds =
    kindChoice === ALL_KINDS
      ? (kinds.data ?? []).map((k) => k.kind)
      : [kindChoice];
  const request = { companyGstin, periodMonth, voucherKinds };

  const previewMutation = useMutation({
    mutationFn: () => previewTallyVouchers(request),
    onSuccess: (p) => setPreview(p),
    onError: (e) =>
      setPreviewError(
        e instanceof Error ? e.message : "Unable to build preview",
      ),
  });

  function openPreview() {
    if (!companyGstin || voucherKinds.length === 0) return;
    setPreview(null);
    setPreviewError(null);
    setPreviewOpen(true);
    previewMutation.mutate();
  }

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  async function downloadBatch(b: TallyBatch) {
    setDownloadingId(b.id);
    try {
      await downloadTallyBatchXml(b, {
        skipExceptions: b.exception_vouchers > 0,
      });
      toast({
        title: "Downloaded",
        description: `${b.clean_vouchers} voucher(s) in the XML.`,
      });
      void qc.invalidateQueries({ queryKey: ["tally-batches"] });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  const openVoucher = (v: TallyVoucherRow) =>
    setDrawer({ sourceType: v.sourceType, sourceId: v.sourceId });

  return (
    <>
      <GrnCard>
        <GrnCardHeader
          title="Tally Vouchers (XML)"
          description="Sales and credit-note vouchers from approved client invoices, as a Tally Prime import file. Re-exporting an already-sent voucher updates it in Tally instead of duplicating it."
          action={
            <GrnChip active={false} onClick={() => setConfigOpen(true)}>
              <Settings2 className="mr-1 h-3.5 w-3.5" /> Ledger names
            </GrnChip>
          }
        />
        <div className="flex flex-wrap items-end gap-3 border-b border-grn-line px-4 py-3">
          <div className="w-[280px] text-[11px] font-semibold text-grn-ink">
            Company
            <SearchableSelect
              className="mt-1"
              options={companyOptions}
              value={companyGstin}
              onChange={setCompanyGstin}
              placeholder="Choose a registration"
              searchPlaceholder="Search company or GSTIN"
              loading={registrations.isLoading}
              aria-label="Company registration"
            />
          </div>
          <div className="w-[180px] text-[11px] font-semibold text-grn-ink">
            Period
            <SearchableSelect
              className="mt-1"
              options={periods}
              value={periodMonth}
              onChange={setPeriodMonth}
              placeholder="Choose a month"
              aria-label="Period"
            />
          </div>
          <div className="w-[220px] text-[11px] font-semibold text-grn-ink">
            Voucher type
            <SearchableSelect
              className="mt-1"
              options={kindOptions}
              value={kindChoice}
              onChange={setKindChoice}
              placeholder="Voucher type"
              aria-label="Voucher type"
            />
          </div>
          <GrnChip active onClick={openPreview}>
            <FileCode2 className="mr-1 h-3.5 w-3.5" /> Preview vouchers
          </GrnChip>
        </div>
        {!companyGstin && (
          <p className="px-4 py-3 text-[12px] text-grn-ink-soft">
            Choose a company to preview its Tally vouchers.
          </p>
        )}
      </GrnCard>

      <GrnCard>
        <GrnCardHeader
          title="Voucher batches"
          description="Newest first. A batch is frozen when generated; its XML is built at download."
        />
        {(batches.data ?? []).length === 0 ? (
          <GrnEmptyState
            icon={<FileCode2 className="h-full w-full" />}
            title="No Tally voucher batches yet"
            description="Preview vouchers above, then export."
          />
        ) : (
          <div className="overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Period</GrnTh>
                  <GrnTh>Registration</GrnTh>
                  <GrnTh>Types</GrnTh>
                  <GrnTh align="right">Vouchers</GrnTh>
                  <GrnTh align="right">Exceptions</GrnTh>
                  <GrnTh>Status</GrnTh>
                  <GrnTh>Downloaded</GrnTh>
                  <GrnTh> </GrnTh>
                </tr>
              </thead>
              <tbody>
                {(batches.data ?? []).map((b) => (
                  <tr
                    key={b.id}
                    className={GRN_TR}
                    data-testid="tally-batch-row"
                  >
                    <GrnTd className="font-grn-mono">{b.period_month}</GrnTd>
                    <GrnTd className="font-grn-mono">{b.company_gstin}</GrnTd>
                    <GrnTd>{b.voucher_kinds.replace(",", " + ")}</GrnTd>
                    <GrnTd align="right" className="tabular-nums">
                      {b.total_vouchers}
                    </GrnTd>
                    <GrnTd align="right" className="tabular-nums">
                      {b.exception_vouchers > 0 ? (
                        <span className="font-semibold text-amber-700">
                          {b.exception_vouchers}
                        </span>
                      ) : (
                        "0"
                      )}
                    </GrnTd>
                    <GrnTd>{b.status}</GrnTd>
                    <GrnTd>{dateTimeLabel(b.downloaded_at) ?? "—"}</GrnTd>
                    <GrnTd>
                      {b.status !== "superseded" && b.clean_vouchers > 0 && (
                        <GrnChip
                          active={false}
                          onClick={() => void downloadBatch(b)}
                        >
                          <Download className="mr-1 h-3.5 w-3.5" />
                          {downloadingId === b.id ? "Downloading…" : "XML"}
                        </GrnChip>
                      )}
                    </GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
          </div>
        )}
      </GrnCard>

      <TallyPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        isLoading={previewMutation.isPending}
        error={previewError}
        preview={preview}
        request={request}
        onOpenVoucher={openVoucher}
      />
      <TallyVoucherDrawer target={drawer} onClose={() => setDrawer(null)} />
      <TallyConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        companyGstin={companyGstin}
      />
    </>
  );
}

function TallyConfigDialog({
  open,
  onOpenChange,
  companyGstin,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyGstin: string;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const cfg = useQuery({
    queryKey: ["tally-config", companyGstin],
    queryFn: () => getTallyConfig(companyGstin),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: () => saveTallyConfig(companyGstin, draft),
    onSuccess: () => {
      toast({ title: "Ledger names saved" });
      setDraft({});
      void qc.invalidateQueries({ queryKey: ["tally-config"] });
      onOpenChange(false);
    },
    onError: (e) =>
      toast({
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      }),
  });
  const rows = [
    ...(companyGstin && cfg.data
      ? [
          {
            key: "tally_company_name",
            value: cfg.data.companyName ?? "",
            source: cfg.data.companyNameSource,
          },
        ]
      : []),
    ...(cfg.data?.fields ?? []),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(60vw,1200px)] max-w-none overflow-y-auto max-md:left-0 max-md:top-0 max-md:h-screen max-md:max-h-screen max-md:w-screen max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none">
        <DialogHeader>
          <DialogTitle>Tally ledger names</DialogTitle>
          <DialogDescription>
            {companyGstin
              ? `Overrides for ${companyGstin}; anything left alone keeps the default.`
              : "Defaults for every company. Choose a company first to override one."}{" "}
            Names must match the ledgers in your Tally company exactly.
          </DialogDescription>
        </DialogHeader>
        {!companyGstin && (
          <GrnAlert tone="warn">Editing the all-company defaults.</GrnAlert>
        )}
        <div className="space-y-2">
          {rows.map((r) => (
            <label
              key={r.key}
              className="block text-[11px] font-semibold text-grn-ink"
            >
              {CONFIG_LABELS[r.key] ?? r.key}{" "}
              <span className="font-normal text-slate-400">({r.source})</span>
              <GrnInput
                className="mt-1"
                value={draft[r.key] ?? r.value}
                onChange={(e) =>
                  setDraft({ ...draft, [r.key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <GrnChip
            active
            onClick={() =>
              Object.keys(draft).length > 0 && !save.isPending && save.mutate()
            }
          >
            {save.isPending ? "Saving…" : "Save ledger names"}
          </GrnChip>
        </div>
      </DialogContent>
    </Dialog>
  );
}
