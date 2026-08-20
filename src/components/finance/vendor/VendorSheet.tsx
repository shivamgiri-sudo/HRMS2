import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { VendorExpenseMappingTab } from "./VendorExpenseMappingTab";
import { VendorApplicabilityTab } from "./VendorApplicabilityTab";

export interface Vendor {
  id?: string;
  vendor_code?: string;
  vendor_name: string;
  vendor_type?: string;
  payment_terms?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  gst_number?: string;
  pan_number?: string;
  address?: string;
  is_active?: number;
  // Added by migration 1086.
  tally_name?: string;
  address_line1?: string;
  address_line2?: string;
  address_line3?: string;
  city?: string;
  state?: string;
  pin_code?: string;
  gst_enabled?: number;
  gst_state_code?: string;
  tds_enabled?: number;
  tds_section?: string;
  tds_rate?: number | string;
}

interface Props {
  vendor: Vendor | null;
  mode: "create" | "edit" | "detail";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  initialTab?: "identity" | "address" | "tax" | "commercial" | "mapping" | "applicability";
}

type FieldDef = { key: keyof Vendor; label: string; span?: number; placeholder?: string };

const IDENTITY_FIELDS: FieldDef[] = [
  { key: "vendor_name", label: "Vendor name *", span: 2 },
  { key: "tally_name", label: "Tally name", span: 2, placeholder: "Name as it appears in Tally" },
  { key: "vendor_code", label: "Vendor code" },
  { key: "vendor_type", label: "Type" },
  { key: "contact_name", label: "Contact name" },
  { key: "contact_email", label: "Contact email" },
  { key: "contact_phone", label: "Contact phone" },
];

const ADDRESS_FIELDS: FieldDef[] = [
  { key: "address_line1", label: "Address line 1", span: 2 },
  { key: "address_line2", label: "Address line 2", span: 2 },
  { key: "address_line3", label: "Address line 3", span: 2 },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "pin_code", label: "PIN code" },
];

export function VendorSheet({ vendor, mode, open, onOpenChange, onSaved, initialTab }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Vendor>({ vendor_name: "" });

  useEffect(() => {
    if (vendor) setForm(vendor);
    else setForm({ vendor_name: "" });
  }, [vendor, open]);

  const set = (key: keyof Vendor) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const setFlag = (key: keyof Vendor) => (checked: boolean) =>
    setForm(f => ({ ...f, [key]: checked ? 1 : 0 }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return await hrmsApi.post<any>("/api/erp/vendors", form);
      }
      return await hrmsApi.put<any>(`/api/erp/vendors/${vendor!.id}`, form);
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Vendor created" : "Vendor updated" });
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isReadOnly = mode === "detail";
  const gstEnabled = Number(form.gst_enabled ?? 0) === 1;
  const tdsEnabled = Number(form.tds_enabled ?? 0) === 1;

  const renderFields = (fields: FieldDef[]) => (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(({ key, label, span, placeholder }) => (
        <div key={key} className={span === 2 ? "col-span-2" : ""}>
          <Label className="text-xs" htmlFor={`vendor-${key}`}>{label}</Label>
          <Input
            id={`vendor-${key}`}
            className="mt-1 h-8 text-sm"
            placeholder={placeholder}
            value={(form[key] as string | undefined) ?? ""}
            onChange={set(key)}
            readOnly={isReadOnly}
            disabled={isReadOnly}
          />
        </div>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Wider than the old 420px: five tabs of master data do not fit a narrow rail, and the
          mapping table needs room for two columns plus an action. */}
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {mode === "create" ? "Add Vendor" : mode === "edit" ? "Edit Vendor" : "Vendor Details"}
          </SheetTitle>
          {vendor?.vendor_code && (
            <Badge variant="outline" className="w-fit text-xs">{vendor.vendor_code}</Badge>
          )}
        </SheetHeader>

        <Tabs defaultValue={initialTab ?? "identity"} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-6">
            <TabsTrigger value="identity" className="text-xs">Identity</TabsTrigger>
            <TabsTrigger value="address" className="text-xs">Address</TabsTrigger>
            <TabsTrigger value="tax" className="text-xs">GST &amp; Tax</TabsTrigger>
            <TabsTrigger value="commercial" className="text-xs">Commercial</TabsTrigger>
            {/* A mapping belongs to a saved vendor, so it cannot be edited before one exists. */}
            <TabsTrigger value="mapping" className="text-xs" disabled={!vendor?.id}>
              Mapping
            </TabsTrigger>
            {/* Separate from identity, and separate from each other: which companies may
                transact with this vendor, and which branches may raise a GRN against it. */}
            <TabsTrigger value="applicability" className="text-xs" disabled={!vendor?.id}>
              Where
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            <TabsContent value="identity" className="mt-0">{renderFields(IDENTITY_FIELDS)}</TabsContent>

            <TabsContent value="address" className="mt-0 space-y-3">
              {renderFields(ADDRESS_FIELDS)}
              <div>
                <Label className="text-xs" htmlFor="vendor-address">Address (legacy free text)</Label>
                <Textarea
                  id="vendor-address"
                  className="mt-1 min-h-[60px] text-sm"
                  value={form.address ?? ""}
                  onChange={set("address")}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                />
                {/* Kept because every existing vendor's address still lives here; the
                    structured lines above are additive, not a replacement. */}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Where existing vendors' addresses are held. Use the lines above for new entries.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="tax" className="mt-0 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="vendor-gst-enabled"
                  checked={gstEnabled}
                  onCheckedChange={setFlag("gst_enabled")}
                  disabled={isReadOnly}
                />
                <Label htmlFor="vendor-gst-enabled" className="text-xs">GST registered</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="vendor-gst_number">GSTIN</Label>
                  <Input
                    id="vendor-gst_number"
                    className="mt-1 h-8 font-mono text-sm"
                    value={form.gst_number ?? ""}
                    onChange={set("gst_number")}
                    readOnly={isReadOnly}
                    disabled={isReadOnly}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    The state code is taken from the first two digits when left blank.
                  </p>
                </div>
                <div>
                  <Label className="text-xs" htmlFor="vendor-gst_state_code">GST state code</Label>
                  <Input
                    id="vendor-gst_state_code"
                    className="mt-1 h-8 font-mono text-sm"
                    value={form.gst_state_code ?? ""}
                    onChange={set("gst_state_code")}
                    readOnly={isReadOnly}
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="vendor-pan_number">PAN</Label>
                  <Input
                    id="vendor-pan_number"
                    className="mt-1 h-8 font-mono text-sm"
                    value={form.pan_number ?? ""}
                    onChange={set("pan_number")}
                    readOnly={isReadOnly}
                    disabled={isReadOnly}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id="vendor-tds-enabled"
                  checked={tdsEnabled}
                  onCheckedChange={setFlag("tds_enabled")}
                  disabled={isReadOnly}
                />
                <Label htmlFor="vendor-tds-enabled" className="text-xs">TDS applicable</Label>
              </div>
              {/* Hidden rather than merely ignored when TDS is off: a visible section and rate
                  that do not apply is what leads to deducting under a stale section. */}
              {tdsEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs" htmlFor="vendor-tds_section">TDS section</Label>
                    <Input
                      id="vendor-tds_section"
                      className="mt-1 h-8 text-sm"
                      placeholder="194C"
                      value={form.tds_section ?? ""}
                      onChange={set("tds_section")}
                      readOnly={isReadOnly}
                      disabled={isReadOnly}
                    />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="vendor-tds_rate">TDS rate %</Label>
                    <Input
                      id="vendor-tds_rate"
                      className="mt-1 h-8 text-right text-sm tabular-nums"
                      inputMode="decimal"
                      value={form.tds_rate ?? ""}
                      onChange={set("tds_rate")}
                      readOnly={isReadOnly}
                      disabled={isReadOnly}
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="commercial" className="mt-0">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="vendor-payment_terms">Payment terms</Label>
                  <Input
                    id="vendor-payment_terms"
                    className="mt-1 h-8 text-sm"
                    placeholder="e.g. 30 days"
                    value={form.payment_terms ?? ""}
                    onChange={set("payment_terms")}
                    readOnly={isReadOnly}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Checkbox
                    id="vendor-is-active"
                    checked={Number(form.is_active ?? 1) === 1}
                    onCheckedChange={setFlag("is_active")}
                    disabled={isReadOnly}
                  />
                  <Label htmlFor="vendor-is-active" className="text-xs">Active</Label>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="mapping" className="mt-0">
              {vendor?.id && <VendorExpenseMappingTab vendorId={vendor.id} readOnly={isReadOnly} />}
            </TabsContent>

            <TabsContent value="applicability" className="mt-0">
              {vendor?.id && <VendorApplicabilityTab vendorId={vendor.id} readOnly={isReadOnly} />}
            </TabsContent>
          </div>
        </Tabs>

        {!isReadOnly && (
          <SheetFooter className="border-t px-4 py-3">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={saveMutation.isPending || !form.vendor_name}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {mode === "create" ? "Create" : "Save"}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
