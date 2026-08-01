import { ContactEditor } from "../ContactEditor";
import type { CostCentreContact, CostCentreInput } from "@/hooks/useCostCentreManagement";

interface ContactsSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
}

export function ContactsSection({ data, onChange, disabled }: ContactsSectionProps) {
  const contacts = data.contacts ?? [];

  const handleContactChange = (updatedContacts: CostCentreContact[]) => {
    onChange({ contacts: updatedContacts });
  };

  return (
    <div className="grid gap-6 p-4">
      <ContactEditor
        contactType="client"
        contacts={contacts}
        onChange={handleContactChange}
        disabled={disabled}
      />
      <ContactEditor
        contactType="scm"
        contacts={contacts}
        onChange={handleContactChange}
        disabled={disabled}
      />
      <ContactEditor
        contactType="finance"
        contacts={contacts}
        onChange={handleContactChange}
        disabled={disabled}
      />
    </div>
  );
}
