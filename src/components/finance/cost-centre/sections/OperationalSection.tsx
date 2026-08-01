import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CostCentreInput } from "@/hooks/useCostCentreManagement";

interface OperationalSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
}

export function OperationalSection({ data, onChange, disabled }: OperationalSectionProps) {
  return (
    <div className="grid gap-4 p-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mandated_seats">Mandated Seats</Label>
          <Input
            id="mandated_seats"
            type="number"
            min={0}
            value={data.mandated_seats_value ?? ""}
            onChange={(e) => onChange({ mandated_seats_value: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="100"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="shrinkage">Shrinkage %</Label>
          <Input
            id="shrinkage"
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={data.shrinkage_percentage ?? ""}
            onChange={(e) => onChange({ shrinkage_percentage: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="15.00"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="attrition">Attrition %</Label>
          <Input
            id="attrition"
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={data.attrition_percentage ?? ""}
            onChange={(e) => onChange({ attrition_percentage: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="8.00"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="shift_hours">Shift Hours</Label>
          <Input
            id="shift_hours"
            value={data.shift_hours ?? ""}
            onChange={(e) => onChange({ shift_hours: e.target.value })}
            placeholder="09:00-18:00"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="working_days">Working Days/Week</Label>
          <Input
            id="working_days"
            type="number"
            min={1}
            max={7}
            value={data.working_days_per_week ?? ""}
            onChange={(e) => onChange({ working_days_per_week: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="5"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="training_days">Training Days</Label>
          <Input
            id="training_days"
            type="number"
            min={0}
            value={data.training_days ?? ""}
            onChange={(e) => onChange({ training_days: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="15"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 pt-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="font-medium">Incentive Allowed</Label>
            <p className="text-sm text-muted-foreground">Enable incentive payments for this cost centre</p>
          </div>
          <Switch
            checked={data.incentive_allowed ?? false}
            onCheckedChange={(checked) => onChange({ incentive_allowed: checked })}
            disabled={disabled}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label className="font-medium">Deduction Allowed</Label>
            <p className="text-sm text-muted-foreground">Enable deductions for this cost centre</p>
          </div>
          <Switch
            checked={data.deduction_allowed ?? false}
            onCheckedChange={(checked) => onChange({ deduction_allowed: checked })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
