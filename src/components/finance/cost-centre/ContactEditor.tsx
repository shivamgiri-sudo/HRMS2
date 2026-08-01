import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CostCentreContact } from "@/hooks/useCostCentreManagement";

interface ContactEditorProps {
  contactType: "client" | "scm" | "finance";
  contacts: CostCentreContact[];
  onChange: (contacts: CostCentreContact[]) => void;
  disabled?: boolean;
}

const typeLabels: Record<string, string> = {
  client: "Client Contacts",
  scm: "SCM Contacts",
  finance: "Finance Contacts",
};

export function ContactEditor({ contactType, contacts, onChange, disabled }: ContactEditorProps) {
  const typeContacts = [1, 2, 3].map((seq) => {
    const existing = contacts.find((c) => c.contact_type === contactType && c.contact_sequence === seq);
    return (
      existing ?? {
        contact_type: contactType,
        contact_sequence: seq,
        contact_name: "",
        contact_email: "",
        contact_phone: "",
        contact_designation: "",
        is_primary: false,
      }
    );
  });

  const handleChange = (seq: number, field: keyof CostCentreContact, value: string | boolean) => {
    const updated = contacts.filter((c) => !(c.contact_type === contactType && c.contact_sequence === seq));
    const current = typeContacts.find((c) => c.contact_sequence === seq)!;
    updated.push({ ...current, [field]: value });
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-sm">{typeLabels[contactType]}</h4>
      <div className="grid gap-4">
        {typeContacts.map((contact, idx) => (
          <div key={idx} className="grid grid-cols-5 gap-2 items-end border-b pb-3">
            <div>
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={contact.contact_name ?? ""}
                onChange={(e) => handleChange(contact.contact_sequence, "contact_name", e.target.value)}
                placeholder={`Contact ${idx + 1}`}
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={contact.contact_email ?? ""}
                onChange={(e) => handleChange(contact.contact_sequence, "contact_email", e.target.value)}
                placeholder="email@example.com"
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input
                value={contact.contact_phone ?? ""}
                onChange={(e) => handleChange(contact.contact_sequence, "contact_phone", e.target.value)}
                placeholder="+91 9876543210"
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Designation</Label>
              <Input
                value={contact.contact_designation ?? ""}
                onChange={(e) => handleChange(contact.contact_sequence, "contact_designation", e.target.value)}
                placeholder="Manager"
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={contact.is_primary ?? false}
                onCheckedChange={(checked) => handleChange(contact.contact_sequence, "is_primary", checked)}
                disabled={disabled}
              />
              <Label className="text-xs">Primary</Label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
