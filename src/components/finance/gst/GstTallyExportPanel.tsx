import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, FileWarning, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { money } from "@/components/finance/grn/grn-format";
import {
  GRN_TR, GrnAlert, GrnCard, GrnCardHeader, GrnChip, GrnEmptyState, GrnIconButton,
  GrnKv, GrnKvList, GrnMetric, GrnMetricStrip, GrnSelect, GrnTable, GrnTd, GrnTh,
} from "@/components/finance/grn/grn-ui";
import {
  listRegistrations, listBatches, generateBatch, getBatch, getExceptions, downloadBatchCsv,
  type GstExportBatch, type GstExportType,
} from "@/lib/gstExportApi";

/**
 * GST / Tally Export — Finance's screen onto gst-export.service.ts.
 *
 * Was API-only until this shipped: the module (schema, worker, validation, CSV hand-off) had
 * been live since migration 1520 with no way to reach it except a direct HTTP call. This is the
 * screen that closes that gap.
 *
 * THE THING THIS PAGE MUST NEVER LET HAPPEN QUIETLY: a batch with exception_rows > 0 downloaded
 * as though it were complete. The backend already refuses that (409 unless includeExceptions is
 * explicitly passed), and this page mirrors that refusal in the UI rather than hiding it behind
 * a plain download button — the exception worklist gets more screen space than a clean batch
 * ever needs, on purpose.
 */

const EXPORT_TYPES: { value: GstExportType; label: string }[] = [
  { value: "TALLY_SALES", label: "Tally sales export" },
  { value: "GSTR1", label: "GSTR-1 (outward)" },
  { value: "GSTR3B_OUTWARD", label: "GSTR-3B (outward)" },
];

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function statusTone(status: GstExportBatch["status"]): "success" | "warn" | "crit" | "neutral" {
  if (status === "exported") return "success";
  if (status === "superseded") return "neutral";
  if (status === "validated") return "warn";
  return "neutral";
}

export function GstTallyExportPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [exportType, setExportType] = useState<GstExportType>("TALLY_SALES");
  const [companyGstin, setCompanyGstin] = useState("");
  const [periodMonth, setPeriodMonth] = useState(currentPeriodMonth());
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  const registrationsQuery = useQuery({
    queryKey: ["gst-registrations"],
    queryFn: listRegistrations,
  });
  const registrations = registrationsQuery.data ?? [];

  const batchesQuery = useQuery({
    queryKey: ["gst-export-batches", exportType, companyGstin, periodMonth],
    queryFn: () => listBatches({ exportType, companyGstin: companyGstin || undefined, limit: 30 }),
  });
  const batches = batchesQuery.data ?? [];

  const generateMutation = useMutation({
    mutationFn: () => generateBatch({ exportType, companyGstin, periodMonth }),
    onSuccess: (result) => {
      toast({
        title: result.exceptionRows > 0 ? "Batch generated — some rows need attention" : "Batch generated",
        description: `${result.totalRows} row(s), ${result.exceptionRows} exception(s). Invoice value ${money(result.totals.invoiceValue)}.`,
        variant: result.exceptionRows > 0 ? "default" : "default",
      });
      setSelectedBatchId(result.batchId);
      void qc.invalidateQueries({ queryKey: ["gst-export-batches"] });
    },
    onError: (error) => {
      toast({
        title: "Could not generate batch",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const detailQuery = useQuery({
    queryKey: ["gst-export-batch", selectedBatchId],
    queryFn: () => getBatch(selectedBatchId as string),
    enabled: Boolean(selectedBatchId),
  });

  const exceptionsQuery = useQuery({
    queryKey: ["gst-export-exceptions", selectedBatchId],
    queryFn: () => getExceptions(selectedBatchId as string),
    enabled: Boolean(selectedBatchId) && (detailQuery.data?.batch.exception_rows ?? 0) > 0,
  });

  const [downloading, setDownloading] = useState(false);
  async function handleDownload(batch: GstExportBatch, includeExceptions: boolean) {
    setDownloading(true);
    try {
      await downloadBatchCsv(batch, { includeExceptions });
      toast({ title: "Downloaded", description: `${batch.export_type}-${batch.company_gstin}-${batch.period_month}.csv` });
      void qc.invalidateQueries({ queryKey: ["gst-export-batch", batch.id] });
      void qc.invalidateQueries({ queryKey: ["gst-export-batches"] });
    } catch (error) {
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Unable to download CSV",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  const selectedRegistration = registrations.find((r) => r.company_gstin === companyGstin);

  return (
    <div className="space-y-4">
      <GrnCard>
        <GrnCardHeader
          title="GST / Tally export"
          description="Generate the outward-supply batch for one registration and month, resolve anything flagged before filing, then download the Tally / preparer hand-off file."
          action={
            <GrnIconButton aria-label="Refresh batches" onClick={() => batchesQuery.refetch()}>
              <RefreshCw className={`h-3.5 w-3.5 ${batchesQuery.isFetching ? "animate-spin" : ""}`} />
            </GrnIconButton>
          }
        />

        <div className="flex flex-wrap items-end gap-2 border-b border-grn-line px-4 py-3">
          <label className="text-[11px] font-semibold text-grn-ink">
            Export type
            <GrnSelect className="mt-1 w-[190px]" value={exportType} onChange={(e) => setExportType(e.target.value as GstExportType)}>
              {EXPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </GrnSelect>
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            Registration
            <GrnSelect className="mt-1 w-[300px]" value={companyGstin} onChange={(e) => setCompanyGstin(e.target.value)}>
              <option value="">— choose a registration —</option>
              {registrations.map((r) => (
                <option key={r.company_gstin} value={r.company_gstin}>
                  {r.company_name ?? "(unnamed)"} · {r.company_gstin} · {r.branch_count} branch{r.branch_count === 1 ? "" : "es"}
                </option>
              ))}
            </GrnSelect>
          </label>
          <label className="text-[11px] font-semibold text-grn-ink">
            Period
            <input
              type="month"
              className="mt-1 block w-[160px] rounded-md border border-grn-line bg-white px-2.5 py-1.5 text-[12.5px] text-grn-ink outline-none focus:border-grn-brand"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
            />
          </label>
          <GrnChip
            active={false}
            onClick={() => {
              if (!companyGstin || !periodMonth) return;
              generateMutation.mutate();
            }}
          >
            {generateMutation.isPending ? "Generating…" : "Generate batch"}
          </GrnChip>
        </div>

        {!companyGstin && registrations.length === 0 && !registrationsQuery.isLoading && (
          <div className="p-4">
            <GrnAlert tone="warn">
              No branch carries a GSTIN yet — nothing can be generated until at least one is set on
              branch_master.
            </GrnAlert>
          </div>
        )}

        {companyGstin && selectedRegistration && !selectedRegistration.latest_invoice_date && (
          <div className="px-4 pt-3">
            <GrnAlert tone="warn">
              This registration has no invoices recorded at all — a generated batch for it will be empty.
            </GrnAlert>
          </div>
        )}
      </GrnCard>

      <GrnCard>
        <GrnCardHeader title="Recent batches" description="Newest first. Select one to review its rows and download." />
        {batches.length === 0 ? (
          <GrnEmptyState
            icon={<FileWarning className="h-full w-full" />}
            title="No batches yet"
            description="Generate one above for a registration and month."
          />
        ) : (
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Period</GrnTh>
                  <GrnTh>Registration</GrnTh>
                  <GrnTh>Type</GrnTh>
                  <GrnTh align="right">Rows</GrnTh>
                  <GrnTh align="right">Exceptions</GrnTh>
                  <GrnTh>Status</GrnTh>
                  <GrnTh>Downloaded</GrnTh>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    className={`${GRN_TR} cursor-pointer ${selectedBatchId === b.id ? "bg-grn-line-soft" : ""}`}
                    onClick={() => setSelectedBatchId(b.id)}
                  >
                    <GrnTd className="font-grn-mono">{b.period_month}</GrnTd>
                    <GrnTd className="font-grn-mono">{b.company_gstin}</GrnTd>
                    <GrnTd>{b.export_type}</GrnTd>
                    <GrnTd align="right" className="tabular-nums">{b.total_rows}</GrnTd>
                    <GrnTd align="right" className="tabular-nums">
                      {b.exception_rows > 0 ? (
                        <span className="font-semibold text-amber-700">{b.exception_rows}</span>
                      ) : "0"}
                    </GrnTd>
                    <GrnTd>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${
                        statusTone(b.status) === "success" ? "bg-emerald-100 text-emerald-800"
                        : statusTone(b.status) === "warn" ? "bg-amber-100 text-amber-800"
                        : "bg-slate-100 text-slate-600"
                      }`}>
                        {b.status}
                      </span>
                    </GrnTd>
                    <GrnTd>{b.downloaded_at ? new Date(b.downloaded_at).toLocaleDateString() : "—"}</GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
        )}
      </GrnCard>

      {selectedBatchId && detailQuery.data && (
        <GrnCard>
          <GrnCardHeader
            title={`${detailQuery.data.batch.export_type} · ${detailQuery.data.batch.company_gstin} · ${detailQuery.data.batch.period_month}`}
            description={
              detailQuery.data.batch.exception_rows > 0
                ? "This batch has rows that cannot legally be filed as-is. Resolve them, or download anyway with the exceptions included."
                : "Filing-ready — every row passed validation."
            }
            action={
              <div className="flex items-center gap-1">
                <GrnChip
                  active={false}
                  onClick={() => handleDownload(detailQuery.data!.batch, false)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {downloading ? "Downloading…" : "Download CSV"}
                </GrnChip>
                {detailQuery.data.batch.exception_rows > 0 && (
                  <GrnChip
                    active={false}
                    onClick={() => handleDownload(detailQuery.data!.batch, true)}
                  >
                    Download with exceptions
                  </GrnChip>
                )}
              </div>
            }
          />

          <GrnMetricStrip>
            <GrnMetric label="Rows" value={String(detailQuery.data.batch.total_rows)} />
            <GrnMetric label="Valid" value={String(detailQuery.data.batch.valid_rows)} />
            <GrnMetric
              label="Exceptions"
              value={String(detailQuery.data.batch.exception_rows)}
              tone={detailQuery.data.batch.exception_rows > 0 ? "warn" : "ok"}
            />
            <GrnMetric
              label="Invoice value"
              value={money(
                detailQuery.data.rows.reduce((sum, r) => sum + Number(r.invoice_value ?? 0), 0)
              )}
            />
          </GrnMetricStrip>

          {detailQuery.data.batch.exception_rows > 0 && (
            <div className="px-4 pt-3">
              <GrnAlert tone="crit">
                <span className="font-semibold">{detailQuery.data.batch.exception_rows} row(s) need attention before this is filed.</span>{" "}
                Shown below with the exact reason for each.
              </GrnAlert>
            </div>
          )}

          {(exceptionsQuery.data?.length ?? 0) > 0 && (
            <div className="border-t border-grn-line-soft">
              <GrnTable>
                <thead>
                  <tr>
                    <GrnTh>Bill / credit no.</GrnTh>
                    <GrnTh>Date</GrnTh>
                    <GrnTh>Client</GrnTh>
                    <GrnTh align="right">Value</GrnTh>
                    <GrnTh>Why</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {exceptionsQuery.data!.map((r) => {
                    let reasons: Array<{ code: string; message: string; severity: string }> = [];
                    try { reasons = JSON.parse(r.validation_errors ?? "[]"); } catch { /* leave empty */ }
                    return (
                      <tr key={r.sequence_no} className={GRN_TR}>
                        <GrnTd className="font-grn-mono">{r.bill_no ?? "—"}</GrnTd>
                        <GrnTd>{r.invoice_date ?? "—"}</GrnTd>
                        <GrnTd>{r.client_name ?? "—"}</GrnTd>
                        <GrnTd align="right" className="tabular-nums">{money(r.invoice_value)}</GrnTd>
                        <GrnTd>
                          <div className="space-y-0.5">
                            {reasons.map((e, i) => (
                              <div key={i} className={`flex items-start gap-1 text-[11.5px] ${e.severity === "error" ? "text-red-700" : "text-amber-700"}`}>
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                <span>{e.message}</span>
                              </div>
                            ))}
                          </div>
                        </GrnTd>
                      </tr>
                    );
                  })}
                </tbody>
              </GrnTable>
            </div>
          )}

          <div className="border-t border-grn-line-soft">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Bill no.</GrnTh>
                  <GrnTh>Date</GrnTh>
                  <GrnTh>Client</GrnTh>
                  <GrnTh>GSTIN</GrnTh>
                  <GrnTh>Place of supply</GrnTh>
                  <GrnTh>Type</GrnTh>
                  <GrnTh align="right">Taxable</GrnTh>
                  <GrnTh align="right">Tax</GrnTh>
                  <GrnTh align="right">Total</GrnTh>
                  <GrnTh>Status</GrnTh>
                </tr>
              </thead>
              <tbody>
                {detailQuery.data.rows.map((r) => (
                  <tr key={r.sequence_no} className={GRN_TR}>
                    <GrnTd className="font-grn-mono">{r.bill_no ?? "—"}</GrnTd>
                    <GrnTd>{r.invoice_date ?? "—"}</GrnTd>
                    <GrnTd>{r.client_name ?? "—"}</GrnTd>
                    <GrnTd className="font-grn-mono">{r.client_gstin ?? "—"}</GrnTd>
                    <GrnTd>{r.place_of_supply ?? "—"}</GrnTd>
                    <GrnTd>{r.source_type === "credit_note" ? "Credit note" : "Invoice"}</GrnTd>
                    <GrnTd align="right" className="tabular-nums">{money(r.taxable_value)}</GrnTd>
                    <GrnTd align="right" className="tabular-nums">
                      {money(Number(r.igst_amount) + Number(r.cgst_amount) + Number(r.sgst_amount))}
                    </GrnTd>
                    <GrnTd align="right" className="tabular-nums">{money(r.invoice_value)}</GrnTd>
                    <GrnTd>
                      {r.validation_status === "exception" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Exception
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Valid
                        </span>
                      )}
                    </GrnTd>
                  </tr>
                ))}
              </tbody>
            </GrnTable>
          </div>

          <div className="border-t border-grn-line-soft px-4 py-3">
            <GrnKvList>
              <GrnKv label="Generated">{new Date(detailQuery.data.batch.generated_at).toLocaleString()}</GrnKv>
              <GrnKv label="Downloaded">
                {detailQuery.data.batch.downloaded_at
                  ? new Date(detailQuery.data.batch.downloaded_at).toLocaleString()
                  : "Not yet"}
              </GrnKv>
            </GrnKvList>
          </div>
        </GrnCard>
      )}
    </div>
  );
}
