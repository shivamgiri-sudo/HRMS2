// src/components/finance/ledger/TallyExportContent.tsx
//
// Tally export for the Finance Ledger: one month of every transaction on this page as a Tally import
// file (masters first, then GRN purchase journals, payments / receipts / contras, journal vouchers and
// bank adjustments). Trial Balance, P&L, Balance Sheet and the party ledgers are not exported: Tally
// builds them from the vouchers, so once these import, Tally's reports match HRMS.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileCode2, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";

type Summary = {
  month: string;
  counts: { grn: number; payments: number; journals: number; exceptions: number };
  totals: { grn: number; payments: number; journals: number };
  masters: { ledgers: number; costCategories: number; costCentres: number; voucherTypes: number };
  exceptions: { kind: string; ref: string; reason: string }[];
};
type Kind = "all" | "masters" | "grn" | "payments" | "journals";
type Format = "xml" | "xlsx";

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thisMonth = () => new Date().toISOString().slice(0, 7);

const FILES: { kind: Kind; title: string; detail: (s?: Summary) => string }[] = [
  { kind: "all", title: "Everything for the month", detail: (s) => s ? `Masters + ${s.counts.grn + s.counts.payments + s.counts.journals} vouchers, in import order` : "" },
  { kind: "masters", title: "Masters", detail: (s) => s ? `${s.masters.ledgers} ledgers, ${s.masters.costCentres} cost centres, ${s.masters.voucherTypes} voucher types` : "" },
  { kind: "grn", title: "GRN purchases (JrnlP / JRNLIMP)", detail: (s) => s ? `${s.counts.grn} vouchers, ₹${INR.format(s.totals.grn)}` : "" },
  { kind: "payments", title: "Payments, receipts, contra", detail: (s) => s ? `${s.counts.payments} vouchers, ₹${INR.format(s.totals.payments)}` : "" },
  { kind: "journals", title: "Journal vouchers & bank adjustments", detail: (s) => s ? `${s.counts.journals} vouchers, ₹${INR.format(s.totals.journals)}` : "" },
];

export function TallyExportContent() {
  const { toast } = useToast();
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ["ledger-tally-summary", month],
    enabled: /^\d{4}-\d{2}$/.test(month),
    queryFn: async () => {
      const response = await hrmsApi.get<any>(`/api/finance/ledger-tally/summary?month=${month}`);
      return ((response as any)?.data ?? response) as Summary;
    },
  });
  const s = summary.data;

  const download = async (kind: Kind, format: Format = "xml") => {
    setBusy(`${kind}:${format}`);
    try {
      const blob = await hrmsApi.getBlob(`/api/finance/ledger-tally/export?month=${month}&kind=${kind}&format=${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Tally_${kind}_${month}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: a.download });
    } catch (error) {
      toast({ title: "Download failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-700">
            Month
            <MonthYearPicker value={month} onChange={setMonth} className="mt-1 w-[240px]" />
          </label>
          <p className="max-w-3xl text-xs text-slate-500">
            Import in TallyPrime with Import → Transactions → XML (masters first, or use “Everything”, which puts the masters
            first). Trial Balance, P&amp;L, Balance Sheet and party ledgers are built by Tally from these vouchers.
            Payroll (Salary Voucher page) and GST sales invoices (GST Export page) have their own Tally files.
            GRNs raised in HRMS only: GRNs imported from the legacy billing system are not exported. Excel carries the same month,
            vouchers and exceptions (Import sheet in the legacy import columns, plus Vouchers, Masters, Summary, Exceptions).
          </p>
        </div>
      </div>

      {summary.isError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Could not build the summary: {(summary.error as Error).message}</div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FILES.map((f) => (
          <div key={f.kind} className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileCode2 className="h-4 w-4 text-slate-500" />{f.title}</div>
              <p className="mt-1 text-xs text-slate-500">{summary.isLoading ? "Counting…" : f.detail(s)}</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant={f.kind === "all" ? "default" : "outline"} disabled={busy !== null || !s} onClick={() => download(f.kind, "xml")}>
                <Download className={`mr-1.5 h-3.5 w-3.5 ${busy === `${f.kind}:xml` ? "animate-pulse" : ""}`} />Tally XML
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null || !s} onClick={() => download(f.kind, "xlsx")}>
                <FileSpreadsheet className={`mr-1.5 h-3.5 w-3.5 ${busy === `${f.kind}:xlsx` ? "animate-pulse" : ""}`} />Excel
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!!s?.exceptions.length && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />{s.exceptions.length} left out of the files</div>
          <p className="mt-1 text-xs text-amber-800">Fix the cause (usually a missing Tally ledger name) and download again.</p>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-amber-900"><tr><th className="py-1 pr-3">Section</th><th className="py-1 pr-3">Voucher / GRN</th><th className="py-1">Why</th></tr></thead>
              <tbody>
                {s.exceptions.map((e, i) => (
                  <tr key={`${e.ref}-${i}`} className="border-t border-amber-200 align-top"><td className="py-1 pr-3">{e.kind}</td><td className="py-1 pr-3 font-mono">{e.ref}</td><td className="py-1">{e.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
