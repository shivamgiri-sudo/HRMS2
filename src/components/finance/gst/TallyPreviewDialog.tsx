import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, FileCode2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { dateLabel, money } from "@/components/finance/grn/grn-format";
import {
  GrnAlert,
  GrnChip,
  GrnMetric,
  GrnMetricStrip,
  GrnTable,
  GrnTd,
  GrnTh,
  GRN_TR,
} from "@/components/finance/grn/grn-ui";
import {
  downloadTallyBatchXml,
  generateTallyBatch,
  saveXmlText,
  type TallyPreview,
  type TallyVoucherRow,
} from "@/lib/tallyVoucherApi";
import { ExportStatusBadge } from "@/components/finance/gst/TallyExportStatusBadge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  error: string | null;
  preview: TallyPreview | null;
  request: {
    companyGstin: string;
    periodMonth: string;
    voucherKinds: string[];
  };
  onOpenVoucher: (row: TallyVoucherRow) => void;
}

/** 60vw preview (capped at 1200px), full-screen below the md breakpoint. */
const DIALOG_CLASS =
  "w-[min(60vw,1200px)] max-w-none max-h-[90vh] overflow-y-auto " +
  "max-md:left-0 max-md:top-0 max-md:h-screen max-md:max-h-screen max-md:w-screen max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none";

export function TallyPreviewDialog({
  open,
  onOpenChange,
  isLoading,
  error,
  preview,
  request,
  onOpenVoucher,
}: Props) {
  const qc = useQueryClient();
  const [showXml, setShowXml] = useState(false);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const batch = await generateTallyBatch(request);
      await downloadTallyBatchXml(
        {
          id: batch.batchId,
          company_gstin: request.companyGstin,
          period_month: request.periodMonth,
        },
        { skipExceptions: batch.exceptionVouchers > 0 },
      );
      return batch;
    },
    onSuccess: (batch) => {
      toast({
        title: "Batch generated and downloaded",
        description: `${batch.cleanVouchers} voucher(s) in the XML${batch.exceptionVouchers ? `, ${batch.exceptionVouchers} skipped for exceptions` : ""}.`,
      });
      void qc.invalidateQueries({ queryKey: ["tally-batches"] });
      onOpenChange(false);
    },
    onError: (e) =>
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const s = preview?.summary;
  const flagged = (preview?.vouchers ?? []).filter((v) => v.errors.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={DIALOG_CLASS}
        data-testid="tally-preview-dialog"
      >
        <DialogHeader>
          <DialogTitle>Tally vouchers - preview</DialogTitle>
          <DialogDescription>
            {preview
              ? `${preview.companyName ?? "(no Tally company name)"} · ${preview.periodMonth}. Nothing is saved until you export.`
              : "Building the voucher list from approved invoices and credit notes."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <p className="py-8 text-center text-sm text-slate-500">
            Building preview…
          </p>
        )}
        {error && <GrnAlert tone="crit">{error}</GrnAlert>}

        {preview && s && (
          <div className="space-y-4">
            <GrnMetricStrip>
              <GrnMetric label="Vouchers" value={String(s.totalVouchers)} />
              <GrnMetric
                label="Clean"
                value={String(s.cleanVouchers)}
                tone="ok"
              />
              <GrnMetric
                label="Exceptions"
                value={String(s.exceptionVouchers)}
                tone={s.exceptionVouchers > 0 ? "warn" : "ok"}
              />
              <GrnMetric
                label="Debit = Credit"
                value={
                  s.totalDebit === s.totalCredit
                    ? money(s.totalDebit)
                    : "UNBALANCED"
                }
                tone={s.totalDebit === s.totalCredit ? "ok" : "warn"}
              />
            </GrnMetricStrip>

            {s.exceptionVouchers > 0 && (
              <GrnAlert tone="crit">
                <span className="font-semibold">
                  {s.exceptionVouchers} voucher(s) cannot be imported as they
                  are.
                </span>{" "}
                Exporting now includes only the {s.cleanVouchers} clean
                voucher(s); fix the rest at source and export again.
              </GrnAlert>
            )}

            <section aria-label="Exceptions" data-testid="tally-exceptions">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                Exceptions and warnings
              </h3>
              {flagged.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <div className="space-y-1">
                  {flagged.map((v) => (
                    <button
                      key={`${v.sourceType}:${v.sourceId}`}
                      type="button"
                      onClick={() => onOpenVoucher(v)}
                      className="block w-full rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50"
                    >
                      <div className="text-[12px] font-semibold">
                        <span className="font-grn-mono">
                          {v.voucherNumber || "(no number)"}
                        </span>{" "}
                        · {v.partyLedger || "(no party)"}
                      </div>
                      {v.errors.map((e, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-1 text-[11.5px] ${e.severity === "error" ? "text-red-700" : "text-amber-700"}`}
                        >
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{e.message}</span>
                        </div>
                      ))}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section aria-label="Vouchers">
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">
                Vouchers
              </h3>
              <div className="overflow-x-auto">
                <GrnTable>
                  <thead>
                    <tr>
                      <GrnTh>Number</GrnTh>
                      <GrnTh>Type</GrnTh>
                      <GrnTh>Date</GrnTh>
                      <GrnTh>Party ledger</GrnTh>
                      <GrnTh align="right">Amount</GrnTh>
                      <GrnTh>On export</GrnTh>
                      <GrnTh>Tally status</GrnTh>
                      <GrnTh>Check</GrnTh>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.vouchers.map((v) => (
                      <tr
                        key={`${v.sourceType}:${v.sourceId}`}
                        className={`${GRN_TR} cursor-pointer`}
                        onClick={() => onOpenVoucher(v)}
                        data-testid="tally-voucher-row"
                      >
                        <GrnTd className="font-grn-mono">
                          {v.voucherNumber || "—"}
                        </GrnTd>
                        <GrnTd>{v.voucherType}</GrnTd>
                        <GrnTd>{dateLabel(v.date)}</GrnTd>
                        <GrnTd>{v.partyLedger || "—"}</GrnTd>
                        <GrnTd align="right" className="tabular-nums">
                          {money(v.amount)}
                        </GrnTd>
                        <GrnTd>{v.blocked ? "Skipped" : v.action}</GrnTd>
                        <GrnTd>
                          <ExportStatusBadge status={v.exportStatus} />
                        </GrnTd>
                        <GrnTd>
                          {v.blocked ? (
                            <span className="text-[11px] font-semibold text-red-700">
                              Exception
                            </span>
                          ) : v.errors.length > 0 ? (
                            <span className="text-[11px] font-semibold text-amber-700">
                              Warning
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-700">
                              OK
                            </span>
                          )}
                        </GrnTd>
                      </tr>
                    ))}
                  </tbody>
                </GrnTable>
              </div>
            </section>

            {showXml && (
              <pre
                className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-snug"
                data-testid="tally-xml-preview"
              >
                {preview.xml}
              </pre>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <GrnChip active={false} onClick={() => setShowXml((x) => !x)}>
                <FileCode2 className="mr-1 h-3.5 w-3.5" />
                {showXml ? "Hide XML" : "Show XML"}
              </GrnChip>
              <GrnChip
                active={false}
                onClick={() =>
                  saveXmlText(
                    preview.xml,
                    `TALLY-PREVIEW-${preview.companyGstin}-${preview.periodMonth}.xml`,
                  )
                }
              >
                Save draft XML (not tracked)
              </GrnChip>
              <GrnChip
                active
                onClick={() => {
                  if (s.cleanVouchers === 0 || exportMutation.isPending) return;
                  exportMutation.mutate();
                }}
              >
                <Download className="mr-1 h-3.5 w-3.5" />
                {exportMutation.isPending
                  ? "Exporting…"
                  : `Export ${s.cleanVouchers} voucher(s) & mark as sent to Tally`}
              </GrnChip>
            </div>
            <p className="text-[11px] text-slate-500">
              Vouchers already exported are sent again as <b>Alter</b> with the
              same GUID, so Tally updates them instead of duplicating. This XML
              has not been test-imported into a Tally Prime company.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
