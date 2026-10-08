// src/components/finance/ledger/DayBookContent.tsx
//
// Day book: every posted journal entry in a date range with its debit and credit totals. Selecting a
// row opens the voucher in the Particulars / Debit / Credit layout used in Tally, with the narration,
// the source (GRN, payment voucher, journal voucher and so on) and a reversed marker.
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BookOpen, Download, Landmark, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hrmsApi } from "@/lib/hrmsApi";

type Entry = {
  id: string; entryDate: string; narration: string; sourceType: string; sourceLabel: string; sourceId: string | null;
  postedAt: string | null; reversed: boolean; branchName: string | null; debit: number; credit: number; lines: number;
};
type DayBook = { from: string; to: string; hasMore: boolean; entries: Entry[] };
type VoucherLine = { accountType: string; accountName: string; accountNote: string | null; debit: number; credit: number; narration: string | null };
type Voucher = {
  id: string; entryDate: string; narration: string; sourceLabel: string; sourceId: string | null; postedAt: string | null;
  reversed: boolean; branchName: string | null; lines: VoucherLine[]; totals: { debit: number; credit: number; balanced: boolean };
};

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (n: number) => (Math.abs(n) < 0.005 ? "" : INR.format(n));
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const ALL = "__all__";
const SOURCES = [
  { value: "grn", label: "GRN" },
  { value: "payment_voucher", label: "Payment voucher" },
  { value: "manual", label: "Journal voucher" },
  { value: "imprest", label: "Imprest" },
  { value: "bank_reconciliation_adjustment", label: "Bank reconciliation" },
  { value: "payroll", label: "Payroll" },
];

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function VoucherSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["journal-voucher-view", id],
    enabled: Boolean(id),
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: Voucher }>(`/api/finance/ledger-reports/voucher/${encodeURIComponent(id as string)}`)).data,
  });
  const v = q.data;
  return (
    <Sheet open={Boolean(id)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-blue-600" aria-hidden /> {v ? `${v.sourceLabel} voucher` : "Voucher"}
          </SheetTitle>
        </SheetHeader>
        {q.isLoading && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading the voucher.</p>}
        {q.isError && <p className="py-8 text-center text-sm text-rose-700" role="alert">The voucher could not be loaded, or it is outside your branch.</p>}
        {v && (
          <div className="mt-4 space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
              <dt className="text-xs text-slate-500">Date</dt><dd className="text-right font-semibold">{shortDate(v.entryDate)}</dd>
              <dt className="text-xs text-slate-500">Type</dt><dd className="text-right font-semibold">{v.sourceLabel}</dd>
              <dt className="text-xs text-slate-500">Branch</dt><dd className="text-right font-semibold">{v.branchName ?? "-"}</dd>
              <dt className="text-xs text-slate-500">Posted</dt><dd className="text-right">{v.postedAt ? new Date(v.postedAt).toLocaleString("en-IN") : "-"}</dd>
              <dt className="text-xs text-slate-500">Reference</dt><dd className="break-all text-right font-mono text-[11px]">{v.sourceId ?? v.id}</dd>
            </dl>
            {v.reversed && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900" role="status">This entry has been reversed. It is excluded from the trial balance.</p>}
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[420px]">
                <caption className="sr-only">Voucher lines</caption>
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-600">
                    <th className="px-3 py-2 text-left">Particulars</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {v.lines.map((l, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <span className="mr-1.5 inline-block w-6 text-xs font-bold text-slate-500">{l.debit > 0 ? "Dr" : "Cr"}</span>
                        <span className={l.credit > 0 ? "pl-4" : ""}>{l.accountName}</span>
                        {l.accountNote && <div className="pl-7 text-[11px] text-slate-500">{l.accountNote}</div>}
                        {l.narration && <div className="pl-7 text-[11px] italic text-slate-500">{l.narration}</div>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{amount(l.debit)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{amount(l.credit)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-y-4 border-double border-slate-800 font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{INR.format(v.totals.debit)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{INR.format(v.totals.credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Narration</div>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{v.narration || "-"}</p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function DayBookContent() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [source, setSource] = useState(ALL);
  const [open, setOpen] = useState<string | null>(null);

  const q = useInfiniteQuery({
    queryKey: ["day-book", from, to, source],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ from, to, limit: "100", offset: String(pageParam) });
      if (source !== ALL) params.set("sourceType", source);
      return (await hrmsApi.get<{ success: boolean; data: DayBook }>(`/api/finance/ledger-reports/day-book?${params}`)).data;
    },
    getNextPageParam: (last, all) => (last.hasMore ? all.reduce((n, p) => n + p.entries.length, 0) : undefined),
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  const debit = entries.reduce((s, e) => s + e.debit, 0);
  const credit = entries.reduce((s, e) => s + e.credit, 0);

  const exportCsv = () => {
    const rows = [["Date", "Type", "Branch", "Narration", "Debit", "Credit", "Reversed"], ...entries.map((e) => [e.entryDate, e.sourceLabel, e.branchName ?? "", e.narration, e.debit.toFixed(2), e.credit.toFixed(2), e.reversed ? "Yes" : ""])];
    const url = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `day-book-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <Label htmlFor="db-from" className="text-xs font-semibold">From</Label>
          <Input id="db-from" type="date" className="h-11 w-full rounded-xl text-sm sm:h-8 sm:w-40 sm:text-xs" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-full sm:w-auto">
          <Label htmlFor="db-to" className="text-xs font-semibold">To</Label>
          <Input id="db-to" type="date" className="h-11 w-full rounded-xl text-sm sm:h-8 sm:w-40 sm:text-xs" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="w-full sm:w-52">
          <Label className="text-xs font-semibold">Type</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-11 rounded-xl text-sm sm:h-8 sm:text-xs" aria-label="Voucher type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-11 w-full cursor-pointer gap-1.5 rounded-xl sm:h-8 sm:w-auto" onClick={exportCsv} disabled={!entries.length}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Entries shown", value: String(entries.length), helper: q.data?.pages.at(-1)?.hasMore ? "More below" : "All in range", icon: BookOpen },
          { label: "Debit", value: INR.format(debit), helper: "Of the entries shown", icon: Landmark },
          { label: "Credit", value: INR.format(credit), helper: Math.abs(debit - credit) < 0.005 ? "Equals debit" : "Differs from debit", icon: Scale },
        ].map((t) => (
          <div key={t.label} className="flex items-center gap-3 rounded-2xl border border-[#dce8fb] bg-white p-3 shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)]">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf4ff] text-[#0b63e5]" aria-hidden><t.icon className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</div>
              <div className="truncate text-lg font-bold tabular-nums text-[#0b63e5]">{t.value}</div>
              <div className="text-[11px] text-slate-500">{t.helper}</div>
            </div>
          </div>
        ))}
      </div>

      {q.isLoading && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading the day book.</p>}
      {q.isError && <p className="py-8 text-center text-sm text-rose-700" role="alert">The day book could not be loaded.</p>}
      {q.data && entries.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No entries were posted in this range.</p>}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-blue-200 bg-white shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)]">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Day book from {from} to {to}</caption>
            <thead>
              <tr className="bg-blue-50 text-[11px] uppercase tracking-wider text-slate-600">
                <th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Narration</th>
                <th className="px-3 py-2 text-left">Branch</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 transition-colors duration-200 hover:bg-blue-50/60">
                  <td className="whitespace-nowrap px-3 py-0 align-middle">
                    <button type="button" className="min-h-11 w-full cursor-pointer text-left font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:min-h-8" onClick={() => setOpen(e.id)} aria-label={`Open voucher of ${shortDate(e.entryDate)}, ${e.sourceLabel}`}>
                      {shortDate(e.entryDate)}
                    </button>
                  </td>
                  <td className="px-3 py-2">{e.sourceLabel}{e.reversed && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Reversed</span>}</td>
                  <td className="max-w-[360px] px-3 py-2 text-slate-700"><span className="line-clamp-2">{e.narration}</span></td>
                  <td className="px-3 py-2 text-slate-600">{e.branchName ?? "-"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{amount(e.debit)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{amount(e.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && (
        <div className="text-center">
          <Button type="button" variant="outline" className="h-11 cursor-pointer rounded-xl sm:h-9" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Loading more" : "Load more entries"}
          </Button>
        </div>
      )}

      <VoucherSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
