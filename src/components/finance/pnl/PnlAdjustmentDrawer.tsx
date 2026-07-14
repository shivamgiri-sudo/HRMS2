import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CreateAdjustmentPayload, PnlReferenceData } from "@/hooks/usePnlConfiguration";

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function PnlAdjustmentDrawer({
  referenceData,
  defaultPeriod,
  onSubmit,
  triggerLabel = "Add adjustment",
}: {
  referenceData?: PnlReferenceData;
  defaultPeriod?: string;
  triggerLabel?: string;
  onSubmit: (payload: CreateAdjustmentPayload) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CreateAdjustmentPayload>({
    process_id: "",
    period_code: defaultPeriod || currentPeriod(),
    metric_key: "operating_profit",
    previous_value: 0,
    adjustment_amount: 0,
    reason: "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      await onSubmit(form);
      setForm({
        process_id: "",
        period_code: defaultPeriod || currentPeriod(),
        metric_key: "operating_profit",
        previous_value: 0,
        adjustment_amount: 0,
        reason: "",
      });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>{triggerLabel}</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Adjustment journal</SheetTitle>
          <SheetDescription>
            Capture a finance-approved change with a metric key, source value and clear reason.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="adjustment-process">Process</Label>
            <select
              id="adjustment-process"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.process_id}
              onChange={(event) => setForm((current) => ({ ...current, process_id: event.target.value }))}
            >
              <option value="">Select process</option>
              {(referenceData?.processes ?? []).map((process) => (
                <option key={process.id} value={process.id}>
                  {process.process_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustment-period">Period</Label>
            <Input
              id="adjustment-period"
              type="month"
              value={form.period_code}
              onChange={(event) => setForm((current) => ({ ...current, period_code: event.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustment-metric">Metric key</Label>
            <Input
              id="adjustment-metric"
              value={form.metric_key}
              onChange={(event) => setForm((current) => ({ ...current, metric_key: event.target.value }))}
              placeholder="operating_profit"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adjustment-previous">Previous value</Label>
              <Input
                id="adjustment-previous"
                type="number"
                value={form.previous_value}
                onChange={(event) => setForm((current) => ({ ...current, previous_value: Number(event.target.value) }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adjustment-delta">Adjustment amount</Label>
              <Input
                id="adjustment-delta"
                type="number"
                value={form.adjustment_amount}
                onChange={(event) => setForm((current) => ({ ...current, adjustment_amount: Number(event.target.value) }))}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustment-reason">Reason</Label>
            <Textarea
              id="adjustment-reason"
              rows={5}
              value={form.reason}
              onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              placeholder="Explain the commercial or accounting reason for this change."
            />
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || !form.process_id || !form.metric_key.trim() || !form.reason.trim()}
          >
            {saving ? "Saving..." : "Save adjustment"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
