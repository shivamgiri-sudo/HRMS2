/**
 * Add/remove line-item rows shared by the proforma and credit-note create Sheets.
 * Purely a controlled-input list — qty/rate are typed by the user and sent verbatim
 * to the backend, which computes `amount`/GST/totals server-side (design doc's
 * "frontend formats, never computes" rule applies to display; the backend, not this
 * component, is the only place an amount is derived).
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface LineItemDraft {
  particulars: string;
  qty: string;
  rate: string;
  lineType: "charge" | "deduction";
}

export function emptyLine(): LineItemDraft {
  return { particulars: "", qty: "1", rate: "", lineType: "charge" };
}

interface Props {
  lines: LineItemDraft[];
  onChange: (lines: LineItemDraft[]) => void;
  /** Credit notes have no charge/deduction split — proformas do. */
  showLineType?: boolean;
}

export function LineItemsEditor({ lines, onChange, showLineType = false }: Props) {
  function update(index: number, patch: Partial<LineItemDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }
  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...lines, emptyLine()]);
  }

  const runningTotal = lines.reduce((sum, line) => {
    const amount = (Number(line.qty) || 0) * (Number(line.rate) || 0);
    return line.lineType === "deduction" ? sum - amount : sum + amount;
  }, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Line items *</Label>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={add}>
          <Plus className="mr-1 h-3.5 w-3.5" />Add line
        </Button>
      </div>

      {lines.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          No line items yet — add at least one.
        </p>
      )}

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="rounded-md border p-2">
            <div className="grid grid-cols-12 gap-2">
              <div className={showLineType ? "col-span-5" : "col-span-6"}>
                <Input
                  className="h-8 text-sm"
                  placeholder="Particulars"
                  value={line.particulars}
                  onChange={(e) => update(index, { particulars: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  className="h-8 text-sm"
                  placeholder="Qty"
                  value={line.qty}
                  onChange={(e) => update(index, { qty: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  className="h-8 text-sm"
                  placeholder="Rate"
                  value={line.rate}
                  onChange={(e) => update(index, { rate: e.target.value })}
                />
              </div>
              {showLineType && (
                <div className="col-span-2">
                  <Select
                    value={line.lineType}
                    onValueChange={(v) => update(index, { lineType: v as LineItemDraft["lineType"] })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="charge">Charge</SelectItem>
                      <SelectItem value="deduction">Deduction</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="col-span-1 flex items-center justify-end">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-rose-600 hover:text-rose-700"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {lines.length > 0 && (
        <p className="text-right text-xs text-muted-foreground">
          Running taxable total: <span className="font-medium tabular-nums text-slate-900">
            {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(runningTotal)}
          </span> (GST computed server-side)
        </p>
      )}
    </div>
  );
}
