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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { VendorExpenseMappingTab } from "./VendorExpenseMappingTab";
import { VendorApplicabilityTab } from "./VendorApplicabilityTab";

// ── Static option lists ────────────────────────────────────────────────────────

const VENDOR_TYPES = [
  { value: "supplier", label: "Supplier" },
  { value: "service",  label: "Service Provider" },
  { value: "contractor", label: "Contractor" },
  { value: "other",    label: "Other" },
] as const;

const PAYMENT_TERMS_OPTIONS = [
  "Net 7", "Net 15", "Net 30", "Net 45", "Net 60", "Immediate", "Advance", "Custom",
] as const;

const TDS_SECTIONS = [
  "194C – Contractors",
  "194J – Professional Services",
  "194H – Commission / Brokerage",
  "194I – Rent",
  "194A – Interest (other than Securities)",
  "194M – Professionals (Individual / HUF)",
  "194Q – Purchase of Goods",
  "Other",
] as const;

const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam",
  "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh",
  "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala",
  "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra",
  "Manipur", "Meghalaya", "Mizoram", "Nagaland",
  "Odisha", "Puducherry", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

// ── Types ──────────────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────────

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

  const setVal = (key: keyof Vendor) => (value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  const setFlag = (key: keyof Vendor) => (checked: boolean) =>
    setForm(f => ({ ...f, [key]: checked ? 1 : 0 }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return await hrmsApi.post<any>("/api/erp/vendors", form);
      }
      return await hrmsApi.put<any>(`/api/erp/vendors/${vendor!.id}`, form);
    },
    onSuccess: (response: any) => {
      const data = response?.data ?? response;
      if (data?.approval === true) {
        toast({
          title: "Request submitted",
          description: "Your vendor request has been sent to the Finance Head for approval.",
        });
      } else {
        toast({ title: mode === "create" ? "Vendor created" : "Vendor updated" });
      }
      queryClient.invalidateQueries({ queryKey: ["erp-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-mapping-summary"] });
      onSaved();
      onOpenChange(false);
    },
    onError: (e: any) => {
      const status = e?.status ?? e?.response?.status;
      const body = e?.data ?? e?.response?.data ?? e;
      if (status === 409 || body?.conflict) {
        const code = body?.conflict?.vendor_code;
        toast({
          title: "Duplicate vendor name",
          description: code
            ? `A vendor with this name already exists (code: ${code}). Use a different name or edit the existing vendor.`
            : body?.error ?? "A vendor with this name already exists.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Error", description: e?.message ?? "Failed to save vendor", variant: "destructive" });
      }
    },
  });

  const isReadOnly = mode === "detail";
  const gstEnabled = Number(form.gst_enabled ?? 0) === 1;
  const tdsEnabled = Number(form.tds_enabled ?? 0) === 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {mode === "create" ? "Add Vendor" : mode === "edit" ? "Edit Vendor" : "Vendor Details"}
          </SheetTitle>
          {vendor?.vendor_code && (
            <Badge variant="outline" className="w-fit text-xs font-mono">{vendor.vendor_code}</Badge>
          )}
        </SheetHeader>

        <Tabs defaultValue={initialTab ?? "identity"} className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-6">
            <TabsTrigger value="identity"      className="text-xs">Identity</TabsTrigger>
            <TabsTrigger value="address"       className="text-xs">Address</TabsTrigger>
            <TabsTrigger value="tax"           className="text-xs">GST &amp; Tax</TabsTrigger>
            <TabsTrigger value="commercial"    className="text-xs">Commercial</TabsTrigger>
            <TabsTrigger value="mapping"       className="text-xs" disabled={!vendor?.id}>Mapping</TabsTrigger>
            <TabsTrigger value="applicability" className="text-xs" disabled={!vendor?.id}>Where</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {/* ── Identity tab ── */}
            <TabsContent value="identity" className="mt-0">
              <div className="grid grid-cols-2 gap-3">
                {/* Vendor name */}
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-vendor_name">Vendor name *</Label>
                  <Input id="v-vendor_name" className="mt-1 h-8 text-sm" value={form.vendor_name ?? ""} onChange={set("vendor_name")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>

                {/* Tally name */}
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-tally_name">Tally name</Label>
                  <Input id="v-tally_name" className="mt-1 h-8 text-sm" placeholder="Name as it appears in Tally" value={form.tally_name ?? ""} onChange={set("tally_name")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>

                {/* Vendor code — hidden in create (auto-generated), read-only in edit/detail */}
                {mode !== "create" && (
                  <div>
                    <Label className="text-xs" htmlFor="v-vendor_code">Vendor code</Label>
                    <Input id="v-vendor_code" className="mt-1 h-8 text-sm font-mono" value={form.vendor_code ?? ""} readOnly disabled />
                    <p className="mt-1 text-[11px] text-muted-foreground">Auto-generated. Cannot be changed.</p>
                  </div>
                )}

                {/* Vendor type — Select dropdown */}
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={form.vendor_type ?? "supplier"} onValueChange={setVal("vendor_type")} disabled={isReadOnly}>
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {VENDOR_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Contact fields */}
                <div>
                  <Label className="text-xs" htmlFor="v-contact_name">Contact name</Label>
                  <Input id="v-contact_name" className="mt-1 h-8 text-sm" value={form.contact_name ?? ""} onChange={set("contact_name")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="v-contact_email">Contact email</Label>
                  <Input id="v-contact_email" className="mt-1 h-8 text-sm" type="email" value={form.contact_email ?? ""} onChange={set("contact_email")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="v-contact_phone">Contact phone</Label>
                  <Input id="v-contact_phone" className="mt-1 h-8 text-sm" type="tel" value={form.contact_phone ?? ""} onChange={set("contact_phone")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
              </div>
            </TabsContent>

            {/* ── Address tab ── */}
            <TabsContent value="address" className="mt-0 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-address_line1">Address line 1</Label>
                  <Input id="v-address_line1" className="mt-1 h-8 text-sm" value={form.address_line1 ?? ""} onChange={set("address_line1")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-address_line2">Address line 2</Label>
                  <Input id="v-address_line2" className="mt-1 h-8 text-sm" value={form.address_line2 ?? ""} onChange={set("address_line2")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-address_line3">Address line 3</Label>
                  <Input id="v-address_line3" className="mt-1 h-8 text-sm" value={form.address_line3 ?? ""} onChange={set("address_line3")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>

                {/* City */}
                <div>
                  <Label className="text-xs" htmlFor="v-city">City</Label>
                  <Input id="v-city" className="mt-1 h-8 text-sm" value={form.city ?? ""} onChange={set("city")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>

                {/* State — dropdown of all Indian states & UTs */}
                <div>
                  <Label className="text-xs">State / UT</Label>
                  <Select value={form.state ?? ""} onValueChange={setVal("state")} disabled={isReadOnly}>
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {INDIAN_STATES.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs" htmlFor="v-pin_code">PIN code</Label>
                  <Input id="v-pin_code" className="mt-1 h-8 text-sm font-mono" maxLength={6} value={form.pin_code ?? ""} onChange={set("pin_code")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
              </div>

              {/* Legacy address field */}
              <div>
                <Label className="text-xs" htmlFor="v-address">Address (legacy free text)</Label>
                <Textarea id="v-address" className="mt-1 min-h-[60px] text-sm" value={form.address ?? ""} onChange={set("address")} readOnly={isReadOnly} disabled={isReadOnly} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Existing vendors' addresses are held here. Use the structured lines above for new entries.
                </p>
              </div>
            </TabsContent>

            {/* ── GST & Tax tab ── */}
            <TabsContent value="tax" className="mt-0 space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox id="v-gst-enabled" checked={gstEnabled} onCheckedChange={setFlag("gst_enabled")} disabled={isReadOnly} />
                <Label htmlFor="v-gst-enabled" className="text-xs">GST registered</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="v-gst_number">GSTIN</Label>
                  <Input id="v-gst_number" className="mt-1 h-8 font-mono text-sm uppercase" value={form.gst_number ?? ""} onChange={set("gst_number")} readOnly={isReadOnly} disabled={isReadOnly} />
                  <p className="mt-1 text-[11px] text-muted-foreground">State code is taken from the first two digits when left blank.</p>
                </div>
                <div>
                  <Label className="text-xs" htmlFor="v-gst_state_code">GST state code</Label>
                  <Input id="v-gst_state_code" className="mt-1 h-8 font-mono text-sm" maxLength={2} value={form.gst_state_code ?? ""} onChange={set("gst_state_code")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="v-pan_number">PAN</Label>
                  <Input id="v-pan_number" className="mt-1 h-8 font-mono text-sm uppercase" value={form.pan_number ?? ""} onChange={set("pan_number")} readOnly={isReadOnly} disabled={isReadOnly} />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Checkbox id="v-tds-enabled" checked={tdsEnabled} onCheckedChange={setFlag("tds_enabled")} disabled={isReadOnly} />
                <Label htmlFor="v-tds-enabled" className="text-xs">TDS applicable</Label>
              </div>

              {tdsEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">TDS section</Label>
                    <Select value={form.tds_section ?? ""} onValueChange={setVal("tds_section")} disabled={isReadOnly}>
                      <SelectTrigger className="mt-1 h-8 text-sm">
                        <SelectValue placeholder="Select section" />
                      </SelectTrigger>
                      <SelectContent>
                        {TDS_SECTIONS.map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="v-tds_rate">TDS rate %</Label>
                    <Input id="v-tds_rate" className="mt-1 h-8 text-right text-sm tabular-nums" inputMode="decimal" value={form.tds_rate ?? ""} onChange={set("tds_rate")} readOnly={isReadOnly} disabled={isReadOnly} />
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Commercial tab ── */}
            <TabsContent value="commercial" className="mt-0">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Payment terms</Label>
                  <Select value={form.payment_terms ?? ""} onValueChange={setVal("payment_terms")} disabled={isReadOnly}>
                    <SelectTrigger className="mt-1 h-8 text-sm">
                      <SelectValue placeholder="Select terms" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERMS_OPTIONS.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <Checkbox id="v-is_active" checked={Number(form.is_active ?? 1) === 1} onCheckedChange={setFlag("is_active")} disabled={isReadOnly} />
                  <Label htmlFor="v-is_active" className="text-xs">Active</Label>
                </div>
              </div>
            </TabsContent>

            {/* ── Mapping tab ── */}
            <TabsContent value="mapping" className="mt-0">
              {vendor?.id && <VendorExpenseMappingTab vendorId={vendor.id} readOnly={isReadOnly} />}
            </TabsContent>

            {/* ── Applicability tab ── */}
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
