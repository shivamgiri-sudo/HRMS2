import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CostCentreInput } from "@/hooks/useCostCentreManagement";

interface BillingSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
}

const revenueTypes = [
  { value: "fixed", label: "Fixed" },
  { value: "variable", label: "Variable" },
  { value: "hybrid", label: "Hybrid (Fixed + Variable)" },
  { value: "per_seat", label: "Per Seat" },
  { value: "per_fte", label: "Per FTE" },
  { value: "per_transaction", label: "Per Transaction" },
];

const paymentModes = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cheque", label: "Cheque" },
  { value: "neft", label: "NEFT" },
  { value: "rtgs", label: "RTGS" },
  { value: "imps", label: "IMPS" },
];

const paymentTerms = [
  { value: "net_15", label: "Net 15 Days" },
  { value: "net_30", label: "Net 30 Days" },
  { value: "net_45", label: "Net 45 Days" },
  { value: "net_60", label: "Net 60 Days" },
  { value: "net_90", label: "Net 90 Days" },
  { value: "immediate", label: "Immediate" },
];

export function BillingSection({ data, onChange, disabled }: BillingSectionProps) {
  return (
    <div className="grid gap-4 p-4">
      <div className="grid grid-cols-2 gap-6">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="font-medium">Revenue Generating</Label>
            <p className="text-sm text-muted-foreground">This cost centre generates revenue</p>
          </div>
          <Switch
            checked={data.revenue_flag ?? false}
            onCheckedChange={(checked) => onChange({ revenue_flag: checked })}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="font-medium">Billing Enabled</Label>
            <p className="text-sm text-muted-foreground">Enable billing for this cost centre</p>
          </div>
          <Switch
            checked={data.billing_flag ?? false}
            onCheckedChange={(checked) => onChange({ billing_flag: checked })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Revenue Type</Label>
          <Select
            value={data.revenue_type ?? ""}
            onValueChange={(v) => onChange({ revenue_type: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select revenue type" />
            </SelectTrigger>
            <SelectContent>
              {revenueTypes.map((rt) => (
                <SelectItem key={rt.value} value={rt.value}>
                  {rt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fixed_amount">Fixed Amount (INR)</Label>
          <Input
            id="fixed_amount"
            type="number"
            step="0.01"
            min={0}
            value={data.fixed_amount ?? ""}
            onChange={(e) => onChange({ fixed_amount: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="0.00"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="variable_base">Variable Base / Formula</Label>
        <Input
          id="variable_base"
          value={data.variable_base ?? ""}
          onChange={(e) => onChange({ variable_base: e.target.value })}
          placeholder="e.g., Per FTE @ INR 25,000"
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Payment Mode</Label>
          <Select
            value={data.payment_mode ?? ""}
            onValueChange={(v) => onChange({ payment_mode: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment mode" />
            </SelectTrigger>
            <SelectContent>
              {paymentModes.map((pm) => (
                <SelectItem key={pm.value} value={pm.value}>
                  {pm.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Payment Terms</Label>
          <Select
            value={data.payment_terms ?? ""}
            onValueChange={(v) => onChange({ payment_terms: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment terms" />
            </SelectTrigger>
            <SelectContent>
              {paymentTerms.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {pt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
