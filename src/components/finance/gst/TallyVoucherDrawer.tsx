import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  dateLabel,
  dateTimeLabel,
  money,
} from "@/components/finance/grn/grn-format";
import {
  GrnAlert,
  GrnKv,
  GrnKvList,
  GrnTable,
  GrnTd,
  GrnTh,
  GRN_TR,
} from "@/components/finance/grn/grn-ui";
import { getTallyVoucherDetail } from "@/lib/tallyVoucherApi";
import { ExportStatusBadge } from "@/components/finance/gst/TallyExportStatusBadge";

const SECTION = "text-xs font-bold uppercase tracking-wide text-slate-400";

interface Props {
  target: { sourceType: string; sourceId: string } | null;
  onClose: () => void;
}

/** Right-side slide-over drill-down for one voucher (CLAUDE.md drill-down mandate). */
export function TallyVoucherDrawer({ target, onClose }: Props) {
  const q = useQuery({
    queryKey: ["tally-voucher-detail", target?.sourceType, target?.sourceId],
    queryFn: () => getTallyVoucherDetail(target!.sourceType, target!.sourceId),
    enabled: Boolean(target),
  });
  const d = q.data;

  return (
    <Sheet open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
        data-testid="tally-voucher-drawer"
      >
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-10">
            <span className="font-grn-mono">
              {d?.voucher.voucherNumber ?? "Voucher"}
            </span>
            {d && <ExportStatusBadge status={d.voucher.exportStatus} />}
          </SheetTitle>
          {d && (
            <p className="text-xs text-slate-500">
              {d.voucher.voucherType} · {dateLabel(d.voucher.date)} ·{" "}
              {d.voucher.action} on next export
            </p>
          )}
        </SheetHeader>

        {q.isLoading && (
          <p className="mt-6 text-sm text-slate-500">Loading voucher…</p>
        )}
        {q.isError && (
          <div className="mt-6">
            <GrnAlert tone="crit">
              {q.error instanceof Error
                ? q.error.message
                : "Failed to load voucher"}
            </GrnAlert>
          </div>
        )}

        {d && (
          <div className="mt-5 space-y-6">
            <section className="space-y-2">
              <h3 className={SECTION}>Voucher</h3>
              <GrnKvList>
                <GrnKv label="Party ledger">
                  {d.voucher.partyLedger || "—"}
                </GrnKv>
                <GrnKv label="Client GSTIN">{d.partyGstin ?? "—"}</GrnKv>
                <GrnKv label="Place of supply">{d.placeOfSupply ?? "—"}</GrnKv>
                <GrnKv label="Cost centre">
                  {d.voucher.costCentreCode ?? "—"}
                </GrnKv>
                <GrnKv label="Taxable">{money(d.voucher.taxable)}</GrnKv>
                <GrnKv label="Tax">{money(d.voucher.tax)}</GrnKv>
                <GrnKv label="Total">{money(d.voucher.amount)}</GrnKv>
                <GrnKv label="Tally GUID">
                  <span className="font-grn-mono text-[11px]">
                    {d.voucher.guid}
                  </span>
                </GrnKv>
                <GrnKv label="Narration">{d.narration || "—"}</GrnKv>
              </GrnKvList>
            </section>

            <section className="space-y-2">
              <h3 className={SECTION}>Ledger entries</h3>
              <GrnTable>
                <thead>
                  <tr>
                    <GrnTh>Ledger</GrnTh>
                    <GrnTh>Dr / Cr</GrnTh>
                    <GrnTh align="right">Amount</GrnTh>
                    <GrnTh>Bill reference</GrnTh>
                  </tr>
                </thead>
                <tbody>
                  {d.entries.map((e, i) => (
                    <tr key={i} className={GRN_TR}>
                      <GrnTd>
                        {e.ledgerName || (
                          <span className="text-red-700">(missing)</span>
                        )}
                      </GrnTd>
                      <GrnTd>{e.side}</GrnTd>
                      <GrnTd align="right" className="tabular-nums">
                        {money(e.amount)}
                      </GrnTd>
                      <GrnTd className="font-grn-mono">
                        {e.billAllocations
                          ?.map((b) => `${b.type}: ${b.name || "—"}`)
                          .join(", ") || "—"}
                      </GrnTd>
                    </tr>
                  ))}
                </tbody>
              </GrnTable>
            </section>

            <section className="space-y-2">
              <h3 className={SECTION}>Exceptions</h3>
              {d.voucher.errors.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                d.voucher.errors.map((e, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-1 text-[12px] ${e.severity === "error" ? "text-red-700" : "text-amber-700"}`}
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{e.message}</span>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-2">
              <h3 className={SECTION}>Export history</h3>
              <p className="text-xs text-slate-500">
                {d.voucher.exportCount > 0
                  ? `Exported ${d.voucher.exportCount} time(s); last ${dateTimeLabel(d.voucher.lastExportedAt) ?? "—"}.`
                  : "Never exported to Tally."}
              </p>
              {d.history.length === 0 ? (
                <p className="text-sm text-slate-500">None</p>
              ) : (
                <GrnTable>
                  <thead>
                    <tr>
                      <GrnTh>Generated</GrnTh>
                      <GrnTh>Period</GrnTh>
                      <GrnTh>Batch status</GrnTh>
                      <GrnTh>Downloaded</GrnTh>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.map((h) => (
                      <tr key={h.batch_id} className={GRN_TR}>
                        <GrnTd>{dateTimeLabel(h.generated_at) ?? "—"}</GrnTd>
                        <GrnTd className="font-grn-mono">
                          {h.period_month}
                        </GrnTd>
                        <GrnTd>{h.status}</GrnTd>
                        <GrnTd>{dateTimeLabel(h.downloaded_at) ?? "—"}</GrnTd>
                      </tr>
                    ))}
                  </tbody>
                </GrnTable>
              )}
            </section>

            <section className="space-y-2">
              <h3 className={SECTION}>Tally XML</h3>
              <pre className="max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-snug">
                {d.xml}
              </pre>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
