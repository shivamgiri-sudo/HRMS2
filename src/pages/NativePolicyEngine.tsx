import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Banknote, CalendarOff, BarChart3, Activity, UserPlus,
  CalendarRange, Scale, Clock, Coffee, Lock, Receipt,
  ChevronRight, Edit2, History, AlertCircle, Plus, Trash2,
  RefreshCw,
} from "lucide-react";
import { hrmsApi } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConfigItem {
  config_key: string;
  label: string;
  description: string | null;
  value_type: "integer" | "decimal" | "percentage" | "string" | "boolean" | "json_array" | "json_object";
  current_value: string;
  default_value: string;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  is_readonly: boolean;
  effective_from: string;
  updated_at: string;
}

interface PolicySection {
  section_key: string;
  section_label: string;
  configs: ConfigItem[];
}

interface PolicyDomain {
  domain_key: string;
  label: string;
  description: string;
  icon: string;
  is_editable: boolean;
  sections: PolicySection[];
}

interface DomainSummary {
  domain_key: string;
  label: string;
  description: string;
  icon: string;
  is_editable: boolean;
  section_count: number;
  config_count: number;
}

interface HistoryEntry {
  id: string;
  section_key: string;
  config_key: string;
  old_value: string | null;
  new_value: string;
  reason: string | null;
  actor_name: string | null;
  changed_at: string;
}

interface WeekoffSlab {
  from: number;
  to: number;
  max_weekoffs: number;
}

// ── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ElementType> = {
  Banknote, CalendarOff, BarChart3, Activity, UserPlus,
  CalendarRange, Scale, Clock, Coffee, Lock, Receipt,
};

function DomainIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Settings;
  return <Icon className={className} />;
}

// ── Slab table editor ─────────────────────────────────────────────────────────

function SlabTableEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  let slabs: WeekoffSlab[] = [];
  try { slabs = JSON.parse(value); } catch { slabs = []; }

  const update = (idx: number, field: keyof WeekoffSlab, val: string) => {
    const copy = [...slabs];
    copy[idx] = { ...copy[idx], [field]: Number(val) };
    onChange(JSON.stringify(copy));
  };

  const addRow = () => {
    const last = slabs[slabs.length - 1];
    const newFrom = last ? last.to + 1 : 0;
    onChange(JSON.stringify([...slabs, { from: newFrom, to: newFrom + 5, max_weekoffs: 0 }]));
  };

  const removeRow = (idx: number) => {
    const copy = slabs.filter((_, i) => i !== idx);
    onChange(JSON.stringify(copy));
  };

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">From (days)</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">To (days)</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Max Week-offs</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {slabs.map((slab, idx) => (
              <tr key={idx} className="border-t border-slate-100">
                <td className="px-3 py-1.5">
                  <Input
                    type="number" value={slab.from} min={0}
                    onChange={(e) => update(idx, "from", e.target.value)}
                    className="h-7 w-20 text-xs"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    type="number" value={slab.to} min={0}
                    onChange={(e) => update(idx, "to", e.target.value)}
                    className="h-7 w-20 text-xs"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    type="number" value={slab.max_weekoffs} min={0}
                    onChange={(e) => update(idx, "max_weekoffs", e.target.value)}
                    className="h-7 w-20 text-xs"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => removeRow(idx)}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="outline" size="sm" onClick={addRow} className="h-7 text-xs gap-1">
        <Plus className="h-3 w-3" /> Add Slab
      </Button>
    </div>
  );
}

// ── Config field ──────────────────────────────────────────────────────────────

function ConfigField({
  item,
  editValue,
  onChange,
  readonly,
}: {
  item: ConfigItem;
  editValue: string;
  onChange: (v: string) => void;
  readonly: boolean;
}) {
  if (readonly || item.is_readonly) {
    return (
      <div className="rounded-md bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-600">
        {editValue || <span className="italic text-slate-400">—</span>}
        {item.unit && <span className="ml-1 text-xs text-slate-400">{item.unit}</span>}
      </div>
    );
  }

  if (item.value_type === "json_array") {
    return <SlabTableEditor value={editValue} onChange={onChange} />;
  }

  if (item.value_type === "boolean") {
    return (
      <div className="flex items-center gap-3">
        {["true", "false"].map((opt) => (
          <label key={opt} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              checked={editValue === opt}
              onChange={() => onChange(opt)}
              className="accent-slate-800"
            />
            <span className="text-sm capitalize">{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  const isNumeric = ["integer", "decimal", "percentage"].includes(item.value_type);

  return (
    <div className="flex items-center gap-2">
      <Input
        type={isNumeric ? "number" : "text"}
        value={editValue}
        min={item.min_value ?? undefined}
        max={item.max_value ?? undefined}
        step={item.value_type === "decimal" ? "0.01" : "1"}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-xs"
      />
      {item.unit && <span className="text-sm text-slate-500">{item.unit}</span>}
    </div>
  );
}

// ── History list ──────────────────────────────────────────────────────────────

function PolicyHistoryList({ domainKey }: { domainKey: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["policy-engine", "history", domainKey],
    queryFn: () => hrmsApi.get(`/policy-engine/domains/${domainKey}/history`).then((r) => r.data.data as HistoryEntry[]),
    enabled: !!domainKey,
  });

  if (isLoading) return <div className="text-sm text-slate-500 py-4">Loading history…</div>;
  if (!data?.length) return <div className="text-sm text-slate-400 py-4 italic">No changes recorded yet.</div>;

  return (
    <div className="space-y-3">
      {data.map((entry) => (
        <div key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">{entry.section_key} › {entry.config_key}</span>
            <span className="text-slate-400">{new Date(entry.changed_at).toLocaleString("en-IN")}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-red-600 border-red-200 font-mono">
              {entry.old_value?.slice(0, 40) ?? "—"}
            </Badge>
            <span className="text-slate-400">→</span>
            <Badge variant="outline" className="text-green-600 border-green-200 font-mono">
              {entry.new_value.slice(0, 40)}
            </Badge>
          </div>
          {entry.reason && (
            <div className="text-slate-500 italic">"{entry.reason}"</div>
          )}
          <div className="text-slate-400">by {entry.actor_name ?? "unknown"}</div>
        </div>
      ))}
    </div>
  );
}

// ── Policy edit sheet ─────────────────────────────────────────────────────────

function PolicyEditSheet({
  domain,
  open,
  onClose,
}: {
  domain: PolicyDomain;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localEdits, setLocalEdits] = useState<Map<string, string>>(new Map());
  const [reason, setReason] = useState("");

  const getEditKey = (sectionKey: string, configKey: string) => `${sectionKey}:${configKey}`;

  const getValue = (section: PolicySection, item: ConfigItem) => {
    const key = getEditKey(section.section_key, item.config_key);
    return localEdits.get(key) ?? item.current_value;
  };

  const setValue = (sectionKey: string, configKey: string, val: string) => {
    setLocalEdits((prev) => {
      const next = new Map(prev);
      next.set(getEditKey(sectionKey, configKey), val);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: (payload: { reason: string; updates: Array<{ section_key: string; config_key: string; new_value: string }> }) =>
      hrmsApi.put(`/policy-engine/domains/${domain.domain_key}`, payload),
    onSuccess: () => {
      toast({ title: "Policy updated", description: "Changes saved successfully." });
      queryClient.invalidateQueries({ queryKey: ["policy-engine"] });
      setLocalEdits(new Map());
      setReason("");
      onClose();
    },
    onError: () => {
      toast({ title: "Update failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const updates: Array<{ section_key: string; config_key: string; new_value: string }> = [];
    for (const [key, val] of localEdits) {
      const [sectionKey, ...configParts] = key.split(":");
      updates.push({ section_key: sectionKey, config_key: configParts.join(":"), new_value: val });
    }
    if (!updates.length) {
      toast({ title: "No changes", description: "Modify at least one field before saving." });
      return;
    }
    mutation.mutate({ reason, updates });
  };

  const hasEdits = localEdits.size > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-[700px] max-w-full flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
          <SheetTitle className="flex items-center gap-2">
            <DomainIcon name={domain.icon} className="h-5 w-5 text-slate-600" />
            {domain.label} Policy
          </SheetTitle>
          <p className="text-sm text-slate-500">{domain.description}</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="edit" className="h-full">
            <TabsList className="mx-6 mt-4">
              <TabsTrigger value="edit" className="gap-1.5">
                <Edit2 className="h-3.5 w-3.5" /> Edit
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-3.5 w-3.5" /> History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="px-6 pb-4 mt-4 space-y-5">
              {!domain.is_editable && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  This domain is read-only. Edit through its dedicated module.
                </div>
              )}
              {domain.sections.map((section) => (
                <div key={section.section_key} className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                    {section.section_label}
                  </h3>
                  <div className="space-y-4">
                    {section.configs.map((item) => (
                      <div key={item.config_key} className="space-y-1.5">
                        <label className="text-sm font-medium text-slate-700">
                          {item.label}
                          {item.unit && (
                            <span className="ml-1.5 text-xs font-normal text-slate-400">({item.unit})</span>
                          )}
                        </label>
                        {item.description && (
                          <p className="text-xs text-slate-500">{item.description}</p>
                        )}
                        <ConfigField
                          item={item}
                          editValue={getValue(section, item)}
                          onChange={(v) => setValue(section.section_key, item.config_key, v)}
                          readonly={!domain.is_editable}
                        />
                        {item.min_value !== null && item.max_value !== null && (
                          <p className="text-xs text-slate-400">Range: {item.min_value} – {item.max_value}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="history" className="px-6 pb-4 mt-4">
              <PolicyHistoryList domainKey={domain.domain_key} />
            </TabsContent>
          </Tabs>
        </div>

        {domain.is_editable && (
          <SheetFooter className="px-6 py-4 border-t border-slate-100 flex-col gap-3">
            <div className="w-full">
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                Reason for change <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="Describe why you are changing this policy…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="resize-none text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={handleSave}
                disabled={!hasEdits || !reason.trim() || mutation.isPending}
                className="gap-1.5"
              >
                {mutation.isPending && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Domain content ────────────────────────────────────────────────────────────

function DomainContent({ domainKey }: { domainKey: string }) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["policy-engine", "domain", domainKey],
    queryFn: () => hrmsApi.get(`/policy-engine/domains/${domainKey}`).then((r) => r.data.data as PolicyDomain),
    enabled: !!domainKey,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center gap-2 text-red-500 p-6">
        <AlertCircle className="h-4 w-4" /> Failed to load domain configuration.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
            <DomainIcon name={data.icon} className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{data.label}</h2>
            <p className="text-sm text-slate-500">{data.description}</p>
          </div>
        </div>
        <Button
          onClick={() => setSheetOpen(true)}
          variant={data.is_editable ? "default" : "outline"}
          size="sm"
          className="gap-1.5 shrink-0"
        >
          {data.is_editable ? <Edit2 className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
          {data.is_editable ? "Edit Policy" : "View Config"}
        </Button>
      </div>

      {/* Sections */}
      {data.sections.map((section) => (
        <Card key={section.section_key} className="border-slate-100">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              {section.section_label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.configs.map((item) => (
                <div key={item.config_key} className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1">
                  <div className="text-xs text-slate-500 font-medium">{item.label}</div>
                  <div className="flex items-baseline gap-1.5">
                    {item.value_type === "json_array" ? (
                      <span className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded px-2 py-0.5">
                        {JSON.parse(item.current_value ?? "[]").length} slabs configured
                      </span>
                    ) : (
                      <>
                        <span className="text-base font-semibold text-slate-800">{item.current_value}</span>
                        {item.unit && <span className="text-xs text-slate-400">{item.unit}</span>}
                      </>
                    )}
                  </div>
                  {item.is_readonly && (
                    <Badge variant="secondary" className="text-xs h-4">read-only</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {data.sections.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          No configuration items found for this domain.
        </div>
      )}

      {sheetOpen && <PolicyEditSheet domain={data} open={sheetOpen} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// Import Settings icon used as fallback
import { Settings } from "lucide-react";

export default function NativePolicyEngine() {
  const [selectedDomain, setSelectedDomain] = useState<string>("payroll");

  const { data: domains, isLoading } = useQuery({
    queryKey: ["policy-engine", "domains"],
    queryFn: () => hrmsApi.get("/policy-engine/domains").then((r) => r.data.data as DomainSummary[]),
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Master Policy Engine</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              All business rules and policies — view and edit without code deploys
            </p>
          </div>
          <Badge variant="secondary" className="text-xs gap-1">
            <Lock className="h-3 w-3" /> Super Admin only
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 bg-white border-r border-slate-100 overflow-y-auto">
          <div className="p-3 space-y-0.5">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />
                ))
              : domains?.map((d) => (
                  <button
                    key={d.domain_key}
                    onClick={() => setSelectedDomain(d.domain_key)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      selectedDomain === d.domain_key
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <DomainIcon
                        name={d.icon}
                        className={`h-4 w-4 shrink-0 ${selectedDomain === d.domain_key ? "text-white" : "text-slate-500"}`}
                      />
                      <span className="truncate font-medium">{d.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {d.config_count > 0 && (
                        <Badge
                          variant={selectedDomain === d.domain_key ? "outline" : "secondary"}
                          className={`text-xs h-4 px-1.5 ${selectedDomain === d.domain_key ? "border-white/40 text-white" : ""}`}
                        >
                          {d.config_count}
                        </Badge>
                      )}
                      {!d.is_editable && (
                        <Lock className={`h-3 w-3 ${selectedDomain === d.domain_key ? "text-white/60" : "text-slate-300"}`} />
                      )}
                      <ChevronRight className={`h-3.5 w-3.5 ${selectedDomain === d.domain_key ? "text-white/70" : "text-slate-300"}`} />
                    </div>
                  </button>
                ))}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {selectedDomain ? (
            <DomainContent key={selectedDomain} domainKey={selectedDomain} />
          ) : (
            <div className="flex items-center justify-center flex-1 text-slate-400 text-sm">
              Select a domain from the sidebar
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
