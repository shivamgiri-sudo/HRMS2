import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, type FilterOption, type OpsFilterOptions, type OpsPeriod, type OpsQuery } from "./opsTypes";

const ALL = "__all__";

interface Props {
  query: OpsQuery;
  options: OpsFilterOptions | undefined;
  period: OpsPeriod | undefined;
  onChange: (next: OpsQuery) => void;
}

/** Period presets are anchored to the latest complete attendance date, not to "today". */
function presets(anchor: string, today: string) {
  const monthStart = `${anchor.slice(0, 7)}-01`;
  const prevMonthEnd = addDays(monthStart, -1);
  return [
    { id: "7", label: "Last 7 days", from: addDays(anchor, -6), to: anchor },
    { id: "14", label: "Last 14 days", from: addDays(anchor, -13), to: anchor },
    { id: "30", label: "Last 30 days", from: addDays(anchor, -29), to: anchor },
    { id: "90", label: "Last 90 days", from: addDays(anchor, -89), to: anchor },
    { id: "mtd", label: "Month to date", from: monthStart, to: anchor },
    { id: "pm", label: "Previous month", from: `${prevMonthEnd.slice(0, 7)}-01`, to: prevMonthEnd },
    { id: "ytd", label: "Year to date", from: `${today.slice(0, 4)}-01-01`, to: anchor },
  ];
}

function FilterSelect({ label, plural, value, items, onChange }: { label: string; plural: string; value: string | undefined; items: FilterOption[]; onChange: (v: string | undefined) => void }) {
  const known = !value || value === "__none__" || items.some((i) => i.id === value);
  return (
    <div className="min-w-[160px] flex-1">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label={label}><SelectValue placeholder={`All ${plural}`} /></SelectTrigger>
        <SelectContent className="max-h-72">
          <SelectItem value={ALL}>All {plural}</SelectItem>
          {!known && <SelectItem value={value!}>Selected {label.toLowerCase()}</SelectItem>}
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>{i.name}{i.sub ? ` · ${i.sub}` : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function OpsFilterBar({ query, options, period, onChange }: Props) {
  const anchor = period?.attendanceThrough ?? period?.to;
  const list = anchor && period ? presets(anchor, period.today) : [];
  const active = list.find((p) => p.from === (query.from ?? period?.from) && p.to === (query.to ?? period?.to));
  const scoped = !!(query.branchId || query.processId || query.lobId || query.managerId);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect label="Branch" plural="branches" value={query.branchId} items={options?.branches ?? []} onChange={(v) => onChange({ ...query, branchId: v, processId: undefined, lobId: undefined, managerId: undefined })} />
        <FilterSelect label="Process" plural="processes" value={query.processId} items={options?.processes ?? []} onChange={(v) => onChange({ ...query, processId: v, lobId: undefined, managerId: undefined })} />
        <FilterSelect label="LOB" plural="LOBs" value={query.lobId} items={options?.lobs ?? []} onChange={(v) => onChange({ ...query, lobId: v, managerId: undefined })} />
        <FilterSelect label="Manager" plural="managers" value={query.managerId} items={options?.managers ?? []} onChange={(v) => onChange({ ...query, managerId: v })} />
        {scoped && (
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => onChange({ from: query.from, to: query.to })}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Period</p>
          <Select value={active?.id ?? "custom"} onValueChange={(id) => { const p = list.find((x) => x.id === id); if (p) onChange({ ...query, from: p.from, to: p.to }); }}>
            <SelectTrigger aria-label="Period"><SelectValue /></SelectTrigger>
            <SelectContent>
              {list.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              <SelectItem value="custom" disabled>Custom range</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">From</p>
          <Input type="date" value={query.from ?? period?.from ?? ""} max={query.to ?? period?.to} onChange={(e) => e.target.value && onChange({ ...query, from: e.target.value })} className="min-h-[44px] w-[150px]" />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">To</p>
          <Input type="date" value={query.to ?? period?.to ?? ""} min={query.from ?? period?.from} onChange={(e) => e.target.value && onChange({ ...query, to: e.target.value })} className="min-h-[44px] w-[150px]" />
        </div>
        {period && (
          <p className="pb-3 text-xs text-muted-foreground">
            Attendance-based metrics are complete through <span className="font-medium text-foreground">{period.attendanceThrough.split("-").reverse().join("/")}</span> (today's punches are still loading).
          </p>
        )}
      </div>
    </div>
  );
}
