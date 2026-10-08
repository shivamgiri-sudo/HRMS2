import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrgMasters } from "@/hooks/useOrgMasters";
import type { CostCentreInput } from "@/hooks/useCostCentreManagement";

interface BasicInfoSectionProps {
  data: Partial<CostCentreInput>;
  onChange: (updates: Partial<CostCentreInput>) => void;
  disabled?: boolean;
  isEdit?: boolean;
}

export function BasicInfoSection({ data, onChange, disabled, isEdit }: BasicInfoSectionProps) {
  const { data: clients } = useOrgMasters("clients");
  const { data: lobs } = useOrgMasters("lobs");
  const { data: branches } = useOrgMasters("branches");
  const { data: processes } = useOrgMasters("processes");

  // Process belongs to the client (process_master.client_id). Show only the selected client's
  // processes plus ones not yet assigned to any client, so a cost centre cannot be filed under
  // one client against another client's process.
  const selectedClient = (clients as any[] | undefined)?.find((c: any) => c.id === data.client_id);
  const clientProcesses = data.client_id
    ? (processes as any[] | undefined)?.filter((p: any) => !p.client_id || p.client_id === data.client_id)
    : [];

  return (
    <div className="grid gap-4 p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Cost Centre Code *</Label>
          <Input
            id="code"
            value={data.cost_centre_code ?? ""}
            onChange={(e) => onChange({ cost_centre_code: e.target.value })}
            placeholder="CC-001"
            disabled={disabled || isEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Cost Centre Name *</Label>
          <Input
            id="name"
            value={data.cost_centre_name ?? ""}
            onChange={(e) => onChange({ cost_centre_name: e.target.value })}
            placeholder="Main Operations Centre"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Client *</Label>
          <Select
            value={data.client_id ?? ""}
            onValueChange={(v) => {
              // Changing client invalidates a process picked for the previous one.
              const keep = (processes as any[] | undefined)?.find((p: any) => p.id === data.process_id);
              onChange({
                client_id: v,
                ...(keep && keep.client_id && keep.client_id !== v ? { process_id: "" } : {}),
              });
            }}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select client" />
            </SelectTrigger>
            <SelectContent>
              {clients?.map((c: any) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.client_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedClient?.legal_entity_name && (
            <p className="text-xs text-muted-foreground">Official name: {selectedClient.legal_entity_name}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label>LOB *</Label>
          <Select
            value={data.lob_id ?? ""}
            onValueChange={(v) => onChange({ lob_id: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select LOB" />
            </SelectTrigger>
            <SelectContent>
              {lobs?.map((l: any) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.lob_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Branch *</Label>
          <Select
            value={data.branch_id ?? ""}
            onValueChange={(v) => onChange({ branch_id: v })}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {branches?.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.branch_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Process *</Label>
          <Select
            value={data.process_id ?? ""}
            onValueChange={(v) => onChange({ process_id: v })}
            disabled={disabled || !data.client_id}
          >
            <SelectTrigger>
              <SelectValue placeholder={data.client_id ? "Select process" : "Select a client first"} />
            </SelectTrigger>
            <SelectContent>
              {clientProcesses?.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.process_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="association_date">Association Date</Label>
        <Input
          id="association_date"
          type="date"
          value={data.association_date ?? ""}
          onChange={(e) => onChange({ association_date: e.target.value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
