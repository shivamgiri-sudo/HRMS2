import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Download, Printer, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";
import { money } from "@/components/finance/grn/grn-format";

/**
 * Vendor ledger in the shape Tally prints a Sundry Creditor: a period, an opening balance, one
 * row per voucher (Date / Particulars To|By / Vch Type / Vch No / Debit / Credit), period totals
 * and a closing balance shown Dr or Cr. Plus Tally's other two views of the same ledger: the
 * month-wise summary and the outstanding bills with ageing.
 */

type StatementRow = {
  date: string; particulars: string; vchType: string; vchNo: string; reference: string; narration: string;
  branchName: string | null; debit: number; credit: number; balance: number; balanceSide: string;
};
type Statement = {
  vendor: { id: string; code: string; name: string };
  from: string | null; to: string | null;
  opening: { amount: number; side: string };
  rows: StatementRow[];
  totals: { debit: number; credit: number };
  closing: { amount: number; side: string };
};
type Outstanding = {
  bills: { id: string; grnNumber: string; invoiceNumber: string; billDate: string | null; dueDate: string | null; ageDays: number | null; bucket: string; billAmount: number; paidAmount: number; balance: number; status: string; branchName: string | null }[];
  buckets: Record<string, number>;
  total: number;
};
type VendorOption = { id: string; vendor_code: string; vendor_name: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (d: string | null) => (d ? d.split("-").reverse().join("-") : "");
const drCr = (b: { amount: number; side: string }) => `${money(b.amount)} ${b.side}`;

/** Indian financial year (1 Apr - 31 Mar) containing `d`, offset by `back` years. */
function fy(d: Date, back = 0): [string, string] {
  const startYear = (d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1) - back;
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: "fy", label: "This FY", range: () => fy(new Date()) },
  { key: "lastfy", label: "Last FY", range: () => fy(new Date(), 1) },
  { key: "month", label: "This month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 0))]; } },
  { key: "lastmonth", label: "Last month", range: () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { key: "all", label: "All time", range: () => ["", ""] },
];

/** One search box that is also the result list: typing queries the server, picking fills it. */
function VendorPicker({ value, onChange }: { value: VendorOption | null; onChange: (v: VendorOption | null) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(text.trim()), 250); return () => clearTimeout(t); }, [text]);

  const results = useQuery({
    queryKey: ["vendor-ledger-picker", debounced],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await hrmsApi.get<any>(`/api/erp/vendors?q=${encodeURIComponent(debounced)}&limit=50`);
      const body = (res as any)?.data ?? res;
      const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      return rows as VendorOption[];
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-9 w-[340px] justify-between text-xs font-normal">
          <span className="truncate">{value ? `${value.vendor_code} — ${value.vendor_name}` : "Search vendor by name or code…"}</span>
          <span className="flex items-center gap-1">
            {value && (
              <span role="button" aria-label="Clear vendor" className="rounded p-0.5 hover:bg-slate-100"
                onClick={(e) => { e.stopPropagation(); onChange(null); }}>
                <X className="h-3.5 w-3.5 text-slate-400" />
              </span>
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {/* shouldFilter off: the server already filtered; cmdk's own filter would hide good rows. */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a vendor name or code…" value={text} onValueChange={setText} />
          <CommandList>
            {results.isLoading && <div className="px-3 py-4 text-center text-xs text-slate-400">Searching…</div>}
            {!results.isLoading && (results.data ?? []).length === 0 && <CommandEmpty>No vendor found</CommandEmpty>}
            <CommandGroup>
              {(results.data ?? []).map((v) => (
                <CommandItem key={v.id} value={v.id} onSelect={() => { onChange(v); setOpen(false); }} className="text-xs">
                  <Check className={`mr-2 h-3.5 w-3.5 ${value?.id === v.id ? "opacity-100" : "opacity-0"}`} />
                  <span className="mr-2 font-mono text-[10px] text-slate-500">{v.vendor_code}</span>
                  <span className="truncate">{v.vendor_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function monthly(st: Statement) {
  const byMonth = new Map<string, { debit: number; credit: number }>();
  for (const r of st.rows) {
    const key = r.date.slice(0, 7);
    const m = byMonth.get(key) ?? { debit: 0, credit: 0 };
    m.debit += r.debit; m.credit += r.credit;
    byMonth.set(key, m);
  }
  let running = st.opening.side === "Cr" ? -st.opening.amount : st.opening.amount;
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
    const opening = running;
    running = Math.round((running + m.debit - m.credit) * 100) / 100;
    return { month, opening, debit: m.debit, credit: m.credit, closing: running };
  });
}
const signed = (v: number) => `${money(Math.abs(v))} ${v < 0 ? "Cr" : "Dr"}`;
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleString("en-IN", { month: "long", year: "numeric" });

export function VendorLedgerView() {
  const [vendor, setVendor] = useState<VendorOption | null>(null);
  const [preset, setPreset] = useState("fy");
  const [from, setFrom] = useState(PRESETS[0].range()[0]);
  const [to, setTo] = useState(PRESETS[0].range()[1]);
  const [filter, setFilter] = useState("");
  const [type, setType] = useState<"all" | "Purchase" | "Payment" | "Journal">("all");
  const [showNarration, setShowNarration] = useState(true);

  const pickPreset = (key: string) => {
    setPreset(key);
    const [f, t] = PRESETS.find((p) => p.key === key)!.range();
    setFrom(f); setTo(t);
  };

  const vendorId = vendor?.id ?? "";
  const statement = useQuery({
    queryKey: ["ledger-reports-vendor-statement", vendorId, from, to],
    enabled: !!vendorId,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await hrmsApi.get<{ success: boolean; data: Statement }>(`/api/finance/ledger-reports/vendor-statement/${vendorId}?${qs.toString()}`);
      return res.data;
    },
  });
  const outstanding = useQuery({
    queryKey: ["ledger-reports-vendor-outstanding", vendorId, to],
    enabled: !!vendorId,
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (to) qs.set("asOf", to);
      const res = await hrmsApi.get<{ success: boolean; data: Outstanding }>(`/api/finance/ledger-reports/vendor-outstanding/${vendorId}?${qs.toString()}`);
      return res.data;
    },
  });

  const st = statement.data;
  const needle = filter.trim().toLowerCase();
  const rows = useMemo(() => (st?.rows ?? []).filter((r) =>
    (type === "all" || r.vchType === type) &&
    (!needle || [r.particulars, r.vchNo, r.reference, r.narration].some((x) => x.toLowerCase().includes(needle)))), [st, type, needle]);
  const months = useMemo(() => (st ? monthly(st) : []), [st]);

  const downloadCsv = () => {
    if (!st) return;
    const esc = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines: unknown[][] = [
      [`Ledger: ${st.vendor.name} (${st.vendor.code})`],
      [`Period: ${st.from ? fmtDay(st.from) : "beginning"} to ${st.to ? fmtDay(st.to) : "today"}`],
      ["Date", "Particulars", "Vch Type", "Vch No", "Reference", "Narration", "Debit", "Credit", "Balance"],
      ["", "Opening Balance", "", "", "", "", "", "", drCr(st.opening)],
      ...rows.map((r) => [fmtDay(r.date), r.particulars, r.vchType, r.vchNo, r.reference, r.narration, r.debit || "", r.credit || "", drCr({ amount: r.balance, side: r.balanceSide })]),
      ["", "Total", "", "", "", "", st.totals.debit, st.totals.credit, ""],
      ["", "Closing Balance", "", "", "", "", "", "", drCr(st.closing)],
    ];
    const blob = new Blob([lines.map((l) => l.map(esc).join(",")).join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vendor-ledger-${st.vendor.code}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div><Label>Vendor</Label><div className="mt-1"><VendorPicker value={vendor} onChange={setVendor} /></div></div>
        <div>
          <Label>Period</Label>
          <div className="mt-1 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <Button key={p.key} size="sm" variant={preset === p.key ? "default" : "outline"} className="h-9 text-xs" onClick={() => pickPreset(p.key)}>{p.label}</Button>
            ))}
          </div>
        </div>
        <div><Label>From</Label><Input type="date" className="mt-1 h-9 text-xs" value={from} onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} /></div>
        <div><Label>To</Label><Input type="date" className="mt-1 h-9 text-xs" value={to} onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} /></div>
      </div>

      {!vendor && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-10 text-center text-sm text-slate-400">
          Search and pick a vendor to open its ledger.
        </div>
      )}

      {vendor && (
        <Tabs defaultValue="vouchers">
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <TabsList>
              <TabsTrigger value="vouchers">Ledger Vouchers</TabsTrigger>
              <TabsTrigger value="monthly">Monthly Summary</TabsTrigger>
              <TabsTrigger value="outstanding">Outstanding Bills</TabsTrigger>
            </TabsList>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={downloadCsv} disabled={!st}><Download className="mr-1 h-3.5 w-3.5" />Download CSV</Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => window.print()}><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
            </div>
          </div>

          {st && (
            <div className="mt-3">
              <div className="text-base font-bold text-gray-800">{st.vendor.name}</div>
              <div className="text-xs text-gray-500">Ledger {st.vendor.code} · {st.from ? fmtDay(st.from) : "beginning"} to {st.to ? fmtDay(st.to) : "today"}</div>
            </div>
          )}

          <TabsContent value="vouchers" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input className="h-8 w-56 pl-7 text-xs" placeholder="Filter vouchers…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              {(["all", "Purchase", "Payment", "Journal"] as const).map((t) => (
                <Button key={t} size="sm" variant={type === t ? "default" : "outline"} className="h-8 text-xs" onClick={() => setType(t)}>{t === "all" ? "All vouchers" : t}</Button>
              ))}
              <label className="ml-2 flex items-center gap-1 text-xs text-slate-600">
                <input type="checkbox" checked={showNarration} onChange={(e) => setShowNarration(e.target.checked)} /> Narration
              </label>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
                    <tr>
                      <th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Particulars</th><th className="px-3 py-2.5">Vch Type</th>
                      <th className="px-3 py-2.5">Vch No.</th><th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th>
                      <th className="px-3 py-2.5 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {statement.isLoading && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
                    {statement.isError && <tr><td colSpan={7} className="px-3 py-6 text-center text-rose-500">Could not load this ledger.</td></tr>}
                    {st && (
                      <tr className="bg-slate-50/70 font-semibold text-gray-700">
                        <td className="px-3 py-2" /><td className="px-3 py-2" colSpan={5}>Opening Balance</td>
                        <td className="px-3 py-2 text-right tabular-nums">{drCr(st.opening)}</td>
                      </tr>
                    )}
                    {st && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">No vouchers in this period</td></tr>}
                    {rows.map((r, i) => (
                      <tr key={`${r.date}-${r.vchNo}-${i}`} className="align-top hover:bg-blue-50/40">
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDay(r.date)}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{r.particulars}</div>
                          {showNarration && (r.reference || r.narration) && (
                            <div className="max-w-md text-[11px] text-gray-500">{[r.reference, r.narration].filter(Boolean).join(" · ")}</div>
                          )}
                        </td>
                        <td className="px-3 py-2"><Badge variant="outline" className="text-[10px]">{r.vchType}</Badge></td>
                        <td className="px-3 py-2 text-gray-600">{r.vchNo || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-600">{r.debit ? money(r.debit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.credit ? money(r.credit) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">{drCr({ amount: r.balance, side: r.balanceSide })}</td>
                      </tr>
                    ))}
                  </tbody>
                  {st && (
                    <tfoot>
                      <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                        <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(st.totals.debit)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(st.totals.credit)}</td><td />
                      </tr>
                      <tr className="bg-blue-50/70 font-bold text-gray-900">
                        <td colSpan={6} className="px-3 py-2 text-right">Closing Balance</td>
                        <td className="px-3 py-2 text-right tabular-nums">{drCr(st.closing)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="monthly">
            <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
                  <tr><th className="px-3 py-2.5">Particulars</th><th className="px-3 py-2.5 text-right">Opening</th><th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th><th className="px-3 py-2.5 text-right">Closing</th></tr>
                </thead>
                <tbody className="divide-y divide-blue-100">
                  {st && months.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No vouchers in this period</td></tr>}
                  {months.map((m) => (
                    <tr key={m.month} className="hover:bg-blue-50/40">
                      <td className="px-3 py-2 font-medium text-gray-800">{monthLabel(m.month)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{signed(m.opening)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-600">{m.debit ? money(m.debit) : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{m.credit ? money(m.credit) : ""}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-800">{signed(m.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                {st && (
                  <tfoot>
                    <tr className="border-t-2 border-blue-100 bg-blue-50/40 font-bold text-gray-800">
                      <td className="px-3 py-2">Grand Total</td><td />
                      <td className="px-3 py-2 text-right tabular-nums">{money(st.totals.debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(st.totals.credit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{drCr(st.closing)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </TabsContent>

          <TabsContent value="outstanding" className="space-y-3">
            {outstanding.data && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Object.entries(outstanding.data.buckets).map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-white/60 bg-white/95 p-3 shadow-sm">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">{k} days</div>
                    <div className="text-sm font-bold tabular-nums text-gray-800">{money(v)}</div>
                  </div>
                ))}
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase text-blue-700">Total pending</div>
                  <div className="text-sm font-bold tabular-nums text-gray-900">{money(outstanding.data.total)}</div>
                </div>
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50/60 text-left text-[11px] font-bold uppercase tracking-wide text-blue-800">
                    <tr><th className="px-3 py-2.5">Bill date</th><th className="px-3 py-2.5">Ref. No (GRN)</th><th className="px-3 py-2.5">Invoice</th><th className="px-3 py-2.5 text-right">Bill amount</th><th className="px-3 py-2.5 text-right">Paid</th><th className="px-3 py-2.5 text-right">Pending</th><th className="px-3 py-2.5">Due on</th><th className="px-3 py-2.5 text-right">Age (days)</th></tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {outstanding.isLoading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Loading…</td></tr>}
                    {outstanding.data && outstanding.data.bills.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">No outstanding bills</td></tr>}
                    {outstanding.data?.bills.map((b) => (
                      <tr key={b.id} className="hover:bg-blue-50/40">
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDay(b.billDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{b.grnNumber || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{b.invoiceNumber || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(b.billAmount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{b.paidAmount ? money(b.paidAmount) : ""}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(b.balance)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-gray-600">{fmtDay(b.dueDate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{b.ageDays ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
