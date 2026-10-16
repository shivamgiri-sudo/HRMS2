import { useState } from "react";
import { Plus, Pencil, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  usePnlCorrections,
  useCreatePnlCorrection,
  useUpdatePnlCorrection,
  useDeletePnlCorrection,
  type PnlCorrection,
  type PnlLineItem,
} from "@/hooks/usePnlCorrections";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";

const LINE_ITEM_LABELS: Record<PnlLineItem, string> = {
  revenue: "Revenue",
  salary: "People Cost",
  grn: "GRN / Indirect Cost",
  ebitda: "EBITDA (direct)",
};

const LINE_ITEM_COLORS: Record<PnlLineItem, string> = {
  revenue: "text-emerald-700 bg-emerald-50 border-emerald-200",
  salary: "text-blue-700 bg-blue-50 border-blue-200",
  grn: "text-orange-700 bg-orange-50 border-orange-200",
  ebitda: "text-purple-700 bg-purple-50 border-purple-200",
};

const WRITE_ROLES = ["finance_head", "super_admin"];

function moneyL(rupees: number) {
  const lakhs = rupees / 100000;
  return `${lakhs >= 0 ? "+" : ""}₹${lakhs.toFixed(2)}L`;
}

type CorrectionFormState = {
  line_item: PnlLineItem;
  amount: string;
  reason: string;
};

function CorrectionForm({
  initial,
  period,
  onClose,
  editId,
}: {
  initial?: CorrectionFormState;
  period: string;
  onClose: () => void;
  editId?: string;
}) {
  const create = useCreatePnlCorrection();
  const update = useUpdatePnlCorrection();
  const [form, setForm] = useState<CorrectionFormState>(
    initial ?? { line_item: "grn", amount: "", reason: "" }
  );

  const isBusy = create.isPending || update.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || isNaN(amount)) return;

    if (editId) {
      await update.mutateAsync({ id: editId, amount, reason: form.reason || undefined });
    } else {
      await create.mutateAsync({
        period_code: period,
        company_name: "Mas Callnet India Pvt Ltd",
        line_item: form.line_item,
        amount,
        reason: form.reason || undefined,
      });
    }
    onClose();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Corrections adjust the computed P&L total for this period. Enter positive values
          to add and negative values to subtract (e.g. −17300 reduces GRN by ₹17,300).
        </span>
      </div>

      {!editId && (
        <div className="space-y-1.5">
          <Label>Line item</Label>
          <Select
            value={form.line_item}
            onValueChange={(v) => setForm((f) => ({ ...f, line_item: v as PnlLineItem }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LINE_ITEM_LABELS) as PnlLineItem[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {LINE_ITEM_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Amount (₹ rupees)</Label>
        <Input
          type="number"
          step="1"
          placeholder="e.g. −17300 or 16000"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          required
        />
        {form.amount && !isNaN(parseFloat(form.amount)) && (
          <p className="text-xs text-slate-500">
            = {moneyL(parseFloat(form.amount))} on the P&L
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label>Reason / note</Label>
        <Textarea
          placeholder="Explain why this correction is needed (reconciliation reference, Finance approval, etc.)"
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          rows={3}
        />
      </div>

      <SheetFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isBusy}>
          {isBusy ? "Saving…" : editId ? "Update" : "Save correction"}
        </Button>
      </SheetFooter>
    </form>
  );
}

type Props = {
  period: string;
  readOnly?: boolean;
};

export function PnlCorrectionPanel({ period, readOnly }: Props) {
  const { data: corrections = [], isLoading } = usePnlCorrections(period, "Mas Callnet India Pvt Ltd");
  const deleteCorrection = useDeletePnlCorrection();
  const { roleKeys } = useWorkforceAccess();
  const canWrite = !readOnly && WRITE_ROLES.some((r) => roleKeys?.includes(r));

  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<PnlCorrection | null>(null);

  if (isLoading) return null;

  const grouped = corrections.reduce<Partial<Record<PnlLineItem, PnlCorrection[]>>>(
    (acc, c) => {
      const k = c.line_item;
      acc[k] = [...(acc[k] ?? []), c];
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">
          P&L Corrections
          {corrections.length > 0 && (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {corrections.length}
            </span>
          )}
        </p>
        {canWrite && (
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add correction
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>New P&L correction</SheetTitle>
                <SheetDescription>
                  Manual Finance adjustment for {period}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <CorrectionForm period={period} onClose={() => setAddOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {corrections.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No corrections for this period.</p>
      ) : (
        <div className="divide-y rounded-md border text-sm">
          {(Object.keys(grouped) as PnlLineItem[]).map((lineItem) =>
            grouped[lineItem]!.map((c) => (
              <div key={c.id} className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("text-xs", LINE_ITEM_COLORS[c.line_item])}
                    >
                      {LINE_ITEM_LABELS[c.line_item]}
                    </Badge>
                    <span
                      className={cn(
                        "font-mono font-semibold",
                        c.amount >= 0 ? "text-emerald-700" : "text-red-600"
                      )}
                    >
                      {moneyL(c.amount)}
                    </span>
                  </div>
                  {c.reason && (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{c.reason}</p>
                  )}
                  {c.creator_name && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      by {c.creator_name} · {new Date(c.created_at).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <Sheet
                      open={editItem?.id === c.id}
                      onOpenChange={(o) => !o && setEditItem(null)}
                    >
                      <SheetTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditItem(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </SheetTrigger>
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>Edit correction</SheetTitle>
                          <SheetDescription>
                            {LINE_ITEM_LABELS[c.line_item]} · {period}
                          </SheetDescription>
                        </SheetHeader>
                        <div className="mt-6">
                          <CorrectionForm
                            period={period}
                            editId={c.id}
                            initial={{
                              line_item: c.line_item,
                              amount: String(c.amount),
                              reason: c.reason ?? "",
                            }}
                            onClose={() => setEditItem(null)}
                          />
                        </div>
                      </SheetContent>
                    </Sheet>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-500 hover:text-red-600"
                      onClick={() => deleteCorrection.mutate(c.id)}
                      disabled={deleteCorrection.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
