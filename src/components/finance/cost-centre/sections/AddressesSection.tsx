import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy } from "lucide-react";
import type { CostCentreInput } from "@/hooks/useCostCentreManagement";

interface AddressesSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
}

export function AddressesSection({ data, onChange, disabled }: AddressesSectionProps) {
  const copyBillToShip = () => {
    onChange({
      ship_to_address1: data.bill_to_address1,
      ship_to_address2: data.bill_to_address2,
      ship_to_address3: data.bill_to_address3,
      ship_to_address4: data.bill_to_address4,
      ship_to_address5: data.bill_to_address5,
      ship_to_city: data.bill_to_city,
      ship_to_pincode: data.bill_to_pincode,
    });
  };

  return (
    <div className="grid gap-6 p-4">
      <div className="space-y-4">
        <h4 className="font-medium text-sm border-b pb-2">Bill-To Address</h4>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="bill_to_address1">Address Line 1</Label>
            <Input
              id="bill_to_address1"
              value={data.bill_to_address1 ?? ""}
              onChange={(e) => onChange({ bill_to_address1: e.target.value })}
              placeholder="Building Name, Floor"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill_to_address2">Address Line 2</Label>
            <Input
              id="bill_to_address2"
              value={data.bill_to_address2 ?? ""}
              onChange={(e) => onChange({ bill_to_address2: e.target.value })}
              placeholder="Street, Area"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill_to_address3">Address Line 3</Label>
            <Input
              id="bill_to_address3"
              value={data.bill_to_address3 ?? ""}
              onChange={(e) => onChange({ bill_to_address3: e.target.value })}
              placeholder="Landmark"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill_to_address4">Address Line 4</Label>
            <Input
              id="bill_to_address4"
              value={data.bill_to_address4 ?? ""}
              onChange={(e) => onChange({ bill_to_address4: e.target.value })}
              placeholder="Additional details"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bill_to_address5">Address Line 5</Label>
            <Input
              id="bill_to_address5"
              value={data.bill_to_address5 ?? ""}
              onChange={(e) => onChange({ bill_to_address5: e.target.value })}
              placeholder="Additional details"
              disabled={disabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bill_to_city">City</Label>
              <Input
                id="bill_to_city"
                value={data.bill_to_city ?? ""}
                onChange={(e) => onChange({ bill_to_city: e.target.value })}
                placeholder="City"
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bill_to_pincode">Pincode</Label>
              <Input
                id="bill_to_pincode"
                value={data.bill_to_pincode ?? ""}
                onChange={(e) => onChange({ bill_to_pincode: e.target.value })}
                placeholder="110001"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyBillToShip}
          disabled={disabled}
          className="gap-2"
        >
          <Copy className="h-4 w-4" />
          Copy Bill-To to Ship-To
        </Button>
      </div>

      <div className="space-y-4">
        <h4 className="font-medium text-sm border-b pb-2">Ship-To Address</h4>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="ship_to_address1">Address Line 1</Label>
            <Input
              id="ship_to_address1"
              value={data.ship_to_address1 ?? ""}
              onChange={(e) => onChange({ ship_to_address1: e.target.value })}
              placeholder="Building Name, Floor"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship_to_address2">Address Line 2</Label>
            <Input
              id="ship_to_address2"
              value={data.ship_to_address2 ?? ""}
              onChange={(e) => onChange({ ship_to_address2: e.target.value })}
              placeholder="Street, Area"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship_to_address3">Address Line 3</Label>
            <Input
              id="ship_to_address3"
              value={data.ship_to_address3 ?? ""}
              onChange={(e) => onChange({ ship_to_address3: e.target.value })}
              placeholder="Landmark"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship_to_address4">Address Line 4</Label>
            <Input
              id="ship_to_address4"
              value={data.ship_to_address4 ?? ""}
              onChange={(e) => onChange({ ship_to_address4: e.target.value })}
              placeholder="Additional details"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ship_to_address5">Address Line 5</Label>
            <Input
              id="ship_to_address5"
              value={data.ship_to_address5 ?? ""}
              onChange={(e) => onChange({ ship_to_address5: e.target.value })}
              placeholder="Additional details"
              disabled={disabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ship_to_city">City</Label>
              <Input
                id="ship_to_city"
                value={data.ship_to_city ?? ""}
                onChange={(e) => onChange({ ship_to_city: e.target.value })}
                placeholder="City"
                disabled={disabled}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship_to_pincode">Pincode</Label>
              <Input
                id="ship_to_pincode"
                value={data.ship_to_pincode ?? ""}
                onChange={(e) => onChange({ ship_to_pincode: e.target.value })}
                placeholder="110001"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}