import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";

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
}

interface Props {
  vendor: Vendor | null;
  mode: "create" | "edit" | "detail";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function VendorSheet({ vendor, mode, open, onOpenChange, onSaved }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<Vendor>({ vendor_name: "" });

  useEffect(() => {
    if (vendor) setForm(vendor);
    else setForm({ vendor_name: "" });
  }, [vendor, open]);

  const set = (key: keyof Vendor) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return (await hrmsApi.post("/api/erp/vendors", form)).data;
      }
      return (await hrmsApi.put(`/api/erp/vendors/${vendor!.id}`, form)).data;
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

  const fields: { key: keyof Vendor; label: string; span?: number }[] = [
    { key: "vendor_name", label: "Vendor name *", span: 2 },
    { key: "vendor_code", label: "Vendor code" },
    { key: "vendor_type", label: "Type" },
    { key: "payment_terms", label: "Payment terms" },
    { key: "contact_name", label: "Contact name" },
    { key: "contact_email", label: "Contact email" },
    { key: "contact_phone", label: "Contact phone" },
    { key: "gst_number", label: "GST number" },
    { key: "pan_number", label: "PAN number" },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[420px] flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm font-semibold">
            {mode === "create" ? "Add Vendor" : mode === "edit" ? "Edit Vendor" : "Vendor Details"}
          </SheetTitle>
          {vendor?.vendor_code && (
            <Badge variant="outline" className="w-fit text-xs">{vendor.vendor_code}</Badge>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-2 gap-3">
            {fields.map(({ key, label, span }) => (
              <div key={key} className={span === 2 ? "col-span-2" : ""}>
                <Label className="text-xs">{label}</Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  value={(form[key] as string | undefined) ?? ""}
                  onChange={set(key)}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                />
              </div>
            ))}
            <div className="col-span-2">
              <Label className="text-xs">Address</Label>
              <Textarea
                className="mt-1 min-h-[60px] text-sm"
                value={form.address ?? ""}
                onChange={set("address")}
                readOnly={isReadOnly}
                disabled={isReadOnly}
              />
            </div>
          </div>
        </div>

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
