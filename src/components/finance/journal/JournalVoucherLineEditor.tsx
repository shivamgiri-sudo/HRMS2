// src/components/finance/journal/JournalVoucherLineEditor.tsx
//
// The Dr/Cr grid at the heart of a journal voucher. Each row picks ONE account and enters an
// amount on ONE side — the same "a line moves exactly one side" rule journal.service.ts's
// backend enforces, mirrored here so the balance strip updates live instead of only failing at
// submit. Account choices are restricted to expense heads and ledger heads (no bank/vendor —
// those have their own sub-ledgers only Payment Vouchers/GRNs may move), matching
// journal-voucher.validation.ts's JV_ACCOUNT_TYPES exactly.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { money } from "@/lib/finance/journalVoucherStatus";

export type EditableLine = {
  key: string;
  accountKey: string; // "<accountType>::<accountId>"
  debitAmount: string;
  creditAmount: string;
  narration: string;
};

export type JvAccountOption = { accountType: "expense_sub_head" | "payable_account"; id: string; label: string; group: string };

export const emptyLine = (key: string): EditableLine => ({ key, accountKey: "", debitAmount: "", creditAmount: "", narration: "" });

function toOptions(accounts: JvAccountOption[]): SearchableOption[] {
  return accounts.map((a) => ({ value: `${a.accountType}::${a.id}`, label: a.label, hint: a.group }));
}

export function computeLineTotals(lines: EditableLine[]) {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += Number(l.debitAmount || 0);
    credit += Number(l.creditAmount || 0);
  }
  debit = Math.round(debit * 100) / 100;
  credit = Math.round(credit * 100) / 100;
  return { debit, credit, difference: Math.round((debit - credit) * 100) / 100 };
}

export function JournalVoucherLineEditor({
  lines,
  onChange,
  accounts,
  disabled,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  accounts: JvAccountOption[];
  disabled?: boolean;
}) {
  const options = toOptions(accounts);
  const totals = computeLineTotals(lines);
  const balanced = totals.debit > 0 && totals.difference === 0;

  const updateLine = (key: string, patch: Partial<EditableLine>) => {
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const removeLine = (key: string) => {
    if (lines.length <= 2) return;
    onChange(lines.filter((l) => l.key !== key));
  };
  const addLine = () => onChange([...lines, emptyLine(`line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`)]);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 w-[34%]">Account</th>
              <th className="px-3 py-2 text-right w-[15%]">Debit</th>
              <th className="px-3 py-2 text-right w-[15%]">Credit</th>
              <th className="px-3 py-2 w-[28%]">Line Narration</th>
              <th className="w-[8%]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line, index) => (
              <tr key={line.key}>
                <td className="px-3 py-2 align-top">
                  <SearchableSelect
                    options={options}
                    value={line.accountKey}
                    onChange={(v) => updateLine(line.key, { accountKey: v })}
                    placeholder="Select account…"
                    searchPlaceholder="Search expense/ledger heads…"
                    disabled={disabled}
                    aria-label={`Line ${index + 1} account`}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="h-9 text-right text-xs"
                    value={line.debitAmount}
                    disabled={disabled}
                    onChange={(e) => updateLine(line.key, { debitAmount: e.target.value, creditAmount: e.target.value ? "" : line.creditAmount })}
                    placeholder="0.00"
                    aria-label={`Line ${index + 1} debit amount`}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <Input
                    type="number" min="0" step="0.01" inputMode="decimal"
                    className="h-9 text-right text-xs"
                    value={line.creditAmount}
                    disabled={disabled}
                    onChange={(e) => updateLine(line.key, { creditAmount: e.target.value, debitAmount: e.target.value ? "" : line.debitAmount })}
                    placeholder="0.00"
                    aria-label={`Line ${index + 1} credit amount`}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <Input
                    className="h-9 text-xs"
                    value={line.narration}
                    disabled={disabled}
                    onChange={(e) => updateLine(line.key, { narration: e.target.value })}
                    placeholder="Optional — e.g. “TDS @2% withheld”"
                    aria-label={`Line ${index + 1} narration`}
                  />
                </td>
                <td className="px-2 py-2 align-top text-right">
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-9 w-9 cursor-pointer text-slate-400 hover:text-rose-600"
                    disabled={disabled || lines.length <= 2}
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" className="cursor-pointer gap-1.5" onClick={addLine} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" /> Add Line
        </Button>
        <div
          className={`flex items-center gap-4 rounded-lg border px-3 py-2 text-xs font-semibold ${
            balanced ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          <span>Debit: {money(totals.debit)}</span>
          <span>Credit: {money(totals.credit)}</span>
          <span>{balanced ? "Balanced" : `Difference: ${money(Math.abs(totals.difference))}`}</span>
        </div>
      </div>
    </div>
  );
}
