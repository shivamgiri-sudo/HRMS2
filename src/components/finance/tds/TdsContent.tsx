// src/components/finance/tds/TdsContent.tsx
//
// TDS for Accounts and Finance heads: what the rules say should have been deducted on vendor payments
// against what was, a monthly register by vendor and section, and the section rules in use. Advisory:
// it reads the records the payment flow writes and changes no payment.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, IdCard, Percent, ReceiptText, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hrmsApi } from "@/lib/hrmsApi";

const INR = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees = (v: unknown) => `₹${INR.format(Number(v ?? 0))}`;

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(name: string, rows: unknown[][]) {
  const text = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

type Tone = "blue" | "red" | "green" | "amber";
const TONES: Record<Tone, string> = {
  blue: "bg-[#edf4ff] text-[#0b63e5] border-[#dce8fb]",
  red: "bg-[#fff0f1] text-[#dc2626] border-[#ffdadd]",
  green: "bg-[#eaf8ef] text-[#15803d] border-[#d7f0df]",
  amber: "bg-[#fff4e8] text-[#b45309] border-[#fee3c5]",
};
function Tile({ label, value, helper, tone, icon: Icon }: { label: string; value: string; helper: string; tone: Tone; icon: typeof Scale }) {
  const [bg, text, border] = TONES[tone].split(" ");
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border ${border} bg-white p-3 shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)]`}>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bg} ${text}`} aria-hidden><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`truncate text-lg font-bold tabular-nums ${text}`}>{value}</div>
        <div className="truncate text-[11px] text-slate-500">{helper}</div>
      </div>
    </div>
  );
}

const TABLE_WRAP = "overflow-x-auto rounded-2xl border border-blue-200 bg-white shadow-[0_1px_3px_rgba(37,99,235,0.08),0_4px_12px_rgba(37,99,235,0.06)]";
const TH = "bg-blue-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-600";
const TD = "border-t border-slate-100 px-3 py-2 align-top text-sm";
const NUM = "text-right font-mono tabular-nums";

type Exception = {
  id: string; vendor_name: string | null; vendor_id: string | null; sub_head_name: string | null; section_code: string | null; confidence: string | null;
  payment_amount: number; base_amount: number; rate_pct: number; expected_tds: number; deducted_tds: number; shortfall: number; pan_valid: number; reason: string; created_at: string;
};
type RegisterRow = {
  vendor_id: string | null; vendor_name: string | null; pan_number: string | null; section_code: string | null; payments: number;
  paid: number; base: number; expected_tds: number; deducted_tds: number; shortfall: number; any_invalid_pan: number;
};
type SectionRow = { section_code: string; nature: string; rate_individual: number; rate_other: number; rate_no_pan: number; single_limit: number | null; annual_limit: number | null };
type DefaultRow = { sub_head_name: string; section_code: string; confidence: "firm" | "review"; note: string | null };

function ExceptionsTab() {
  const q = useQuery({
    queryKey: ["tds-exceptions"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: { days: number; rows: Exception[] } }>("/api/finance/tds/exceptions?days=90")).data,
  });
  const rows = q.data?.rows ?? [];
  const total = rows.reduce((s, r) => s + Number(r.shortfall), 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Payments with a shortfall" value={String(rows.length)} helper="Last 90 days, largest first" tone="amber" icon={AlertTriangle} />
        <Tile label="TDS short" value={rupees(total)} helper="Expected less deducted" tone="red" icon={Percent} />
        <Tile label="No valid PAN" value={String(rows.filter((r) => !r.pan_valid).length)} helper="Higher rate applies" tone="blue" icon={IdCard} />
      </div>
      {q.isLoading && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading the exceptions.</p>}
      {q.isError && <p className="py-8 text-center text-sm text-rose-700" role="alert">The exceptions could not be loaded.</p>}
      {q.data && rows.length === 0 && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">
          No payment in the last 90 days has a TDS shortfall on record. Payments made before this was switched on are not assessed.
        </p>
      )}
      {rows.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[860px]">
            <caption className="sr-only">Payments where the TDS that should have been deducted is more than what was</caption>
            <thead><tr>
              <th className={TH}>Vendor</th><th className={TH}>Sub-head</th><th className={TH}>Section</th>
              <th className={`${TH} text-right`}>Base (before GST)</th><th className={`${TH} text-right`}>Rate</th>
              <th className={`${TH} text-right`}>Expected</th><th className={`${TH} text-right`}>Deducted</th><th className={`${TH} text-right`}>Short</th><th className={TH}>Why</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-blue-50/50">
                  <td className={TD}>{r.vendor_name ?? "Unknown vendor"}{!r.pan_valid && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">No PAN</span>}</td>
                  <td className={TD}>{r.sub_head_name ?? "-"}</td>
                  <td className={TD}>{r.section_code ?? "-"}{r.confidence === "review" && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Review</span>}</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.base_amount))}</td>
                  <td className={`${TD} ${NUM}`}>{Number(r.rate_pct)}%</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.expected_tds))}</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.deducted_tds))}</td>
                  <td className={`${TD} ${NUM} font-bold text-rose-700`}>{INR.format(Number(r.shortfall))}</td>
                  <td className={`${TD} max-w-[320px] text-xs text-slate-600`}>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegisterTab() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const q = useQuery({
    queryKey: ["tds-register", month],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: { month: string; rows: RegisterRow[] } }>(`/api/finance/tds/register?month=${encodeURIComponent(month)}`)).data,
  });
  const rows = q.data?.rows ?? [];
  const sum = (k: keyof RegisterRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const exportCsv = () =>
    downloadCsv(`tds-register-${month}.csv`, [
      ["Vendor", "PAN", "Section", "Payments", "Paid", "Base before GST", "Expected TDS", "Deducted TDS", "Short"],
      ...rows.map((r) => [r.vendor_name ?? "", r.pan_number ?? "", r.section_code ?? "", r.payments, r.paid, r.base, r.expected_tds, r.deducted_tds, r.shortfall]),
    ]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-auto">
          <Label htmlFor="tds-month" className="text-xs font-semibold">Month</Label>
          <Input id="tds-month" type="month" className="h-11 w-full rounded-xl text-sm sm:h-8 sm:w-44 sm:text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Button type="button" variant="outline" size="sm" className="h-11 w-full cursor-pointer gap-1.5 rounded-xl sm:h-8 sm:w-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Paid" value={rupees(sum("paid"))} helper={`${rows.length} vendor and section lines`} tone="blue" icon={ReceiptText} />
        <Tile label="Should be deducted" value={rupees(sum("expected_tds"))} helper="Under the section rules" tone="amber" icon={Percent} />
        <Tile label="Deducted" value={rupees(sum("deducted_tds"))} helper="As recorded on payments" tone="green" icon={Scale} />
        <Tile label="Short" value={rupees(sum("shortfall"))} helper="Expected less deducted" tone="red" icon={AlertTriangle} />
      </div>
      {q.isLoading && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading the register.</p>}
      {q.isError && <p className="py-8 text-center text-sm text-rose-700" role="alert">The register could not be loaded.</p>}
      {q.data && rows.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No assessed vendor payments in {month}.</p>}
      {rows.length > 0 && (
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[820px]">
            <caption className="sr-only">TDS register for {month}</caption>
            <thead><tr>
              <th className={TH}>Vendor</th><th className={TH}>PAN</th><th className={TH}>Section</th>
              <th className={`${TH} text-right`}>Payments</th><th className={`${TH} text-right`}>Base</th>
              <th className={`${TH} text-right`}>Expected</th><th className={`${TH} text-right`}>Deducted</th><th className={`${TH} text-right`}>Short</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.vendor_id}-${r.section_code}-${i}`} className="hover:bg-blue-50/50">
                  <td className={TD}>{r.vendor_name ?? "Unknown vendor"}</td>
                  <td className={`${TD} font-mono text-xs`}>{r.pan_number ? r.pan_number : <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">Missing</span>}</td>
                  <td className={TD}>{r.section_code ?? "-"}</td>
                  <td className={`${TD} ${NUM}`}>{r.payments}</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.base))}</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.expected_tds))}</td>
                  <td className={`${TD} ${NUM}`}>{INR.format(Number(r.deducted_tds))}</td>
                  <td className={`${TD} ${NUM} font-semibold ${Number(r.shortfall) > 0 ? "text-rose-700" : ""}`}>{INR.format(Number(r.shortfall))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RulesTab() {
  const q = useQuery({
    queryKey: ["tds-sections"],
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: { sections: SectionRow[]; subHeadDefaults: DefaultRow[] } }>("/api/finance/tds/sections")).data,
  });
  const sections = q.data?.sections ?? [];
  const defaults = q.data?.subHeadDefaults ?? [];
  const bySection = useMemo(() => {
    const m = new Map<string, DefaultRow[]>();
    defaults.forEach((d) => m.set(d.section_code, [...(m.get(d.section_code) ?? []), d]));
    return m;
  }, [defaults]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">The rules the check applies. Rates and limits follow the Income Tax Department's tables; your CA should confirm them. Sub-heads marked <b>Review</b> depend on what the bill is for (labour or goods), so Accounts decides.</p>
      {q.isLoading && <p className="py-8 text-center text-sm text-slate-500" role="status">Loading the rules.</p>}
      {q.isError && <p className="py-8 text-center text-sm text-rose-700" role="alert">The rules could not be loaded.</p>}
      {sections.map((s) => (
        <section key={s.section_code} className={TABLE_WRAP}>
          <header className="flex flex-wrap items-baseline justify-between gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white">
            <h3 className="text-sm font-semibold">{s.section_code} <span className="font-normal text-blue-100">· {s.nature}</span></h3>
            <p className="text-xs text-blue-100">
              Individual {Number(s.rate_individual)}% · Others {Number(s.rate_other)}% · No PAN {Number(s.rate_no_pan)}%
              {s.single_limit != null && ` · per payment over ₹${INR.format(Number(s.single_limit))}`}
              {s.annual_limit != null && ` · or year total over ₹${INR.format(Number(s.annual_limit))}`}
            </p>
          </header>
          <ul className="divide-y divide-slate-100">
            {(bySection.get(s.section_code) ?? []).map((d) => (
              <li key={d.sub_head_name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-1.5 text-sm">
                <span className="font-medium text-slate-800">{d.sub_head_name}</span>
                {d.confidence === "review" && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">Review</span>}
                <span className="text-xs text-slate-500">{d.note}</span>
              </li>
            ))}
            {(bySection.get(s.section_code) ?? []).length === 0 && <li className="px-4 py-2 text-xs text-slate-500">No sub-head mapped to this section.</li>}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function TdsContent() {
  return (
    <Tabs defaultValue="exceptions">
      <TabsList>
        <TabsTrigger value="exceptions" className="cursor-pointer">Exceptions</TabsTrigger>
        <TabsTrigger value="register" className="cursor-pointer">Monthly register</TabsTrigger>
        <TabsTrigger value="rules" className="cursor-pointer">Rules in use</TabsTrigger>
      </TabsList>
      <TabsContent value="exceptions"><ExceptionsTab /></TabsContent>
      <TabsContent value="register"><RegisterTab /></TabsContent>
      <TabsContent value="rules"><RulesTab /></TabsContent>
    </Tabs>
  );
}
