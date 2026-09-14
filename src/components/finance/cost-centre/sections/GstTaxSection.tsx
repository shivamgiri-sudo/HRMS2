import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CostCentreInput } from "@/hooks/useCostCentreManagement";

interface GstTaxSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
}

const stateCodes = [
  { value: "01", label: "01 - Jammu & Kashmir" },
  { value: "02", label: "02 - Himachal Pradesh" },
  { value: "03", label: "03 - Punjab" },
  { value: "04", label: "04 - Chandigarh" },
  { value: "05", label: "05 - Uttarakhand" },
  { value: "06", label: "06 - Haryana" },
  { value: "07", label: "07 - Delhi" },
  { value: "08", label: "08 - Rajasthan" },
  { value: "09", label: "09 - Uttar Pradesh" },
  { value: "10", label: "10 - Bihar" },
  { value: "11", label: "11 - Sikkim" },
  { value: "12", label: "12 - Arunachal Pradesh" },
  { value: "13", label: "13 - Nagaland" },
  { value: "14", label: "14 - Manipur" },
  { value: "15", label: "15 - Mizoram" },
  { value: "16", label: "16 - Tripura" },
  { value: "17", label: "17 - Meghalaya" },
  { value: "18", label: "18 - Assam" },
  { value: "19", label: "19 - West Bengal" },
  { value: "20", label: "20 - Jharkhand" },
  { value: "21", label: "21 - Odisha" },
  { value: "22", label: "22 - Chhattisgarh" },
  { value: "23", label: "23 - Madhya Pradesh" },
  { value: "24", label: "24 - Gujarat" },
  { value: "26", label: "26 - Dadra & Nagar Haveli and Daman & Diu" },
  { value: "27", label: "27 - Maharashtra" },
  { value: "29", label: "29 - Karnataka" },
  { value: "30", label: "30 - Goa" },
  { value: "31", label: "31 - Lakshadweep" },
  { value: "32", label: "32 - Kerala" },
  { value: "33", label: "33 - Tamil Nadu" },
  { value: "34", label: "34 - Puducherry" },
  { value: "35", label: "35 - Andaman & Nicobar" },
  { value: "36", label: "36 - Telangana" },
  { value: "37", label: "37 - Andhra Pradesh" },
  { value: "38", label: "38 - Ladakh" },
];

export function GstTaxSection({ data, onChange, disabled }: GstTaxSectionProps) {
  return (
    <div className="grid gap-4 p-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Two columns exist in cost_centre_master — hsn_code and sac_code — but this section
            offered a single box labelled "HSN / SAC Code" wired to hsn_code alone. So every SAC
            anyone typed went into the HSN column, and the 364 real SAC values carried over from
            db_bill were invisible here and could not be edited. Measured 2026-08-17: sac_code
            populated on 364 of 927 rows, hsn_code on 0 of 927.

            SAC leads because this is a services business: its outward supply is 998593
            (call-centre services, on 343 rows), and this is the value that feeds our own GSTR-1
            HSN/SAC summary. */}
        <div className="space-y-2">
          <Label htmlFor="sac_code">SAC Code (services)</Label>
          <Input
            id="sac_code"
            value={data.sac_code ?? ""}
            onChange={(e) => onChange({ sac_code: e.target.value })}
            placeholder="998593"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            For services supplied from this cost centre. All SAC codes begin 99 — call-centre
            services are 998593.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="hsn_code">HSN Code (goods)</Label>
          <Input
            id="hsn_code"
            value={data.hsn_code ?? ""}
            onChange={(e) => onChange({ hsn_code: e.target.value })}
            placeholder="4802"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Only if goods are supplied. Leave blank for a services-only cost centre.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="service_tax_no">Service Tax No / GSTIN</Label>
          <Input
            id="service_tax_no"
            value={data.service_tax_no ?? ""}
            onChange={(e) => onChange({ service_tax_no: e.target.value.toUpperCase() })}
            placeholder="27AABCU9603R1ZM"
            disabled={disabled}
            maxLength={15}
          />
          <p className="text-xs text-muted-foreground">
            15-digit GSTIN (e.g., 27AABCU9603R1ZM)
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Vendor State Code</Label>
        <Select
          value={data.vendor_state_code ?? ""}
          onValueChange={(v) => onChange({ vendor_state_code: v })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent>
            {stateCodes.map((sc) => (
              <SelectItem key={sc.value} value={sc.value}>
                {sc.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          State code for GST purposes (first 2 digits of GSTIN)
        </p>
      </div>
    </div>
  );
}
