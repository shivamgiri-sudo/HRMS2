import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle2, XCircle, Download, FileText, Users,
  AlertTriangle, Search, FileDown, Loader2,
} from "lucide-react";

interface EsiEmployee {
  employee_id: string;
  emp_code: string;
  name: string;
  branch: string;
  esic_number: string | null;
  pan_ready: boolean;
  pan_doc_id: string | null;
  pan_file_url: string | null;
  photo_ready: boolean;
  photo_url: string | null;
  bank_ready: boolean;
}

interface ListResponse {
  employees: EsiEmployee[];
  total: number;
  page: number;
  limit: number;
}

function useEsiList(params: { search: string; branchId: string; page: number }) {
  return useQuery<ListResponse>({
    queryKey: ["esi-reg-docs", params],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(params.page), limit: "50" });
      if (params.search) qs.set("search", params.search);
      if (params.branchId) qs.set("branch_id", params.branchId);
      return hrmsApi.get<ListResponse>(`/api/payroll/esi-reg-docs?${qs}`);
    },
    staleTime: 30_000,
  });
}

function KpiStrip({ employees }: { employees: EsiEmployee[] }) {
  const total = employees.length;
  const allReady = employees.filter((e) => e.pan_ready && e.photo_ready && e.bank_ready).length;
  const missing = total - allReady;

  const tiles = [
    { label: "ESI Eligible", value: total, icon: Users, tone: "blue" as const },
    { label: "All Docs Ready", value: allReady, icon: CheckCircle2, tone: "green" as const },
    { label: "Docs Missing", value: missing, icon: AlertTriangle, tone: "amber" as const },
  ];

  const toneMap = {
    blue:  { bg: "bg-[#edf4ff]", text: "text-[#0b63e5]", border: "border-[#dce8fb]", icon: "text-[#0b63e5]" },
    green: { bg: "bg-[#eaf8ef]", text: "text-[#15803d]", border: "border-[#d7f0df]", icon: "text-[#15803d]" },
    amber: { bg: "bg-[#fff4e8]", text: "text-[#ea580c]", border: "border-[#fee3c5]", icon: "text-[#ea580c]" },
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      {tiles.map((t) => {
        const c = toneMap[t.tone];
        const Icon = t.icon;
        return (
          <div key={t.label} className={`rounded-2xl border ${c.border} ${c.bg} px-5 py-4 flex items-center gap-4`}>
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.bg}`}>
              <Icon className={`w-5 h-5 ${c.icon}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t.label}</p>
              <p className={`text-2xl font-bold ${c.text}`}>{t.value}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReadyChip({ ready, label }: { ready: boolean; label: string }) {
  return ready ? (
    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
      <CheckCircle2 className="w-3 h-3" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
      <XCircle className="w-3 h-3" /> {label}
    </span>
  );
}

function EmployeeTable({
  employees,
  selected,
  onToggle,
  onSelectAll,
  onDownload,
  onOpenDrawer,
  downloading,
}: {
  employees: EsiEmployee[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDownload: (id: string) => void;
  onOpenDrawer: (emp: EsiEmployee) => void;
  downloading: string | null;
}) {
  const allSelected = employees.length > 0 && selected.size === employees.length;

  return (
    <div className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="px-4 py-3 text-left w-10">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onSelectAll}
                  className="rounded"
                  aria-label="Select all"
                />
              </th>
              {["Emp Code", "Name", "Branch", "ESIC No.", "PAN", "Photo", "Bank", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-400 text-sm">
                  No ESI-eligible employees found.
                </td>
              </tr>
            )}
            {employees.map((emp) => (
              <tr
                key={emp.employee_id}
                className="border-b border-slate-50 hover:bg-blue-50/40 transition-colors duration-150 cursor-pointer"
                onClick={() => onOpenDrawer(emp)}
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(emp.employee_id)}
                    onChange={() => onToggle(emp.employee_id)}
                    className="rounded"
                    aria-label={`Select ${emp.name}`}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.emp_code}</td>
                <td className="px-4 py-3 font-semibold text-slate-800">{emp.name}</td>
                <td className="px-4 py-3 text-slate-600">{emp.branch}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{emp.esic_number ?? "—"}</td>
                <td className="px-4 py-3"><ReadyChip ready={emp.pan_ready} label="PAN" /></td>
                <td className="px-4 py-3"><ReadyChip ready={emp.photo_ready} label="Photo" /></td>
                <td className="px-4 py-3"><ReadyChip ready={emp.bank_ready} label="Bank" /></td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                    disabled={downloading === emp.employee_id}
                    onClick={() => onDownload(emp.employee_id)}
                  >
                    {downloading === emp.employee_id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Download className="w-3 h-3" />
                    )}
                    ZIP
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EsiDrawer({
  emp,
  onClose,
  onDownload,
  downloading,
}: {
  emp: EsiEmployee | null;
  onClose: () => void;
  onDownload: (id: string) => void;
  downloading: string | null;
}) {
  if (!emp) return null;
  const allReady = emp.pan_ready && emp.photo_ready && emp.bank_ready;

  return (
    <Sheet open={!!emp} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="max-w-2xl w-full overflow-y-auto p-0">
        <div className="bg-gradient-to-r from-purple-600 to-violet-600 text-white px-6 py-5">
          <SheetHeader>
            <SheetTitle className="text-white text-lg font-bold">
              {emp.name}
            </SheetTitle>
          </SheetHeader>
          <div className="flex items-center gap-3 mt-2">
            <span className="font-mono text-sm bg-white/20 px-2 py-0.5 rounded">{emp.emp_code}</span>
            <Badge className={allReady ? "bg-green-400/90 text-white" : "bg-amber-400/90 text-white"}>
              {allReady ? "Docs Ready" : "Docs Incomplete"}
            </Badge>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">ESI Details</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">ESIC Number</p>
                <p className="font-semibold text-slate-800">{emp.esic_number ?? "Not assigned"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Branch</p>
                <p className="font-semibold text-slate-800">{emp.branch}</p>
              </div>
            </div>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Document Readiness</p>
            <div className="space-y-2">
              {[
                { label: "PAN Card", ready: emp.pan_ready, hint: "Upload in employee profile → Documents" },
                { label: "Employee Photo", ready: emp.photo_ready, hint: "Upload via employee profile" },
                { label: "Bank Information", ready: emp.bank_ready, hint: "Add bank details in employee profile" },
              ].map((d) => (
                <div key={d.label} className="flex items-center justify-between py-2 border-b border-slate-50">
                  <div className="flex items-center gap-2">
                    {d.ready ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className="text-sm font-medium text-slate-700">{d.label}</span>
                  </div>
                  {!d.ready && (
                    <span className="text-xs text-slate-400 italic">{d.hint}</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Download Actions</p>
            <div className="flex flex-wrap gap-3">
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2 rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all duration-200"
                disabled={downloading === emp.employee_id}
                onClick={() => onDownload(emp.employee_id)}
              >
                {downloading === emp.employee_id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Download ESI ZIP
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-2">
              ZIP includes PAN card, photo, and bank information PDF for ESI portal upload.
              Missing documents are noted in manifest.txt inside the ZIP.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function EsiRegDocsTab() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerEmp, setDrawerEmp] = useState<EsiEmployee | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  const { data, isLoading } = useEsiList({ search, branchId: "", page });
  const employees = data?.employees ?? [];

  const allSelected = useMemo(
    () => employees.length > 0 && selected.size === employees.length,
    [employees, selected]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(employees.map((e) => e.employee_id)));
    }
  }

  function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadSingle(employeeId: string) {
    setDownloading(employeeId);
    try {
      const blob = await hrmsApi.getBlob(`/api/payroll/esi-reg-docs/${employeeId}/download`);
      const date = new Date().toISOString().slice(0, 10);
      const emp = employees.find((e) => e.employee_id === employeeId);
      triggerBlobDownload(blob, `ESI_Docs_${emp?.emp_code ?? employeeId}_${date}.zip`);
    } catch {
      toast({ title: "Download failed", description: "Could not download ESI documents.", variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  }

  async function downloadBulk() {
    if (selected.size === 0) return;
    setBulkDownloading(true);
    try {
      const token = getAuthToken();
      const res = await fetch("/api/payroll/esi-reg-docs/bulk-download", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ employee_ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      triggerBlobDownload(blob, `ESI_Bulk_Docs_${new Date().toISOString().slice(0, 10)}.zip`);
      setSelected(new Set());
    } catch {
      toast({ title: "Bulk download failed", variant: "destructive" });
    } finally {
      setBulkDownloading(false);
    }
  }

  async function exportCsv() {
    try {
      const blob = await hrmsApi.getBlob("/api/payroll/esi-reg-docs/export-csv");
      triggerBlobDownload(blob, `ESI_Reg_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      toast({ title: "CSV export failed", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4 py-4">
      <div className="rounded-2xl bg-gradient-to-r from-purple-600 to-violet-600 text-white px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">ESI Registration Documents</h2>
            <p className="text-sm text-purple-100 mt-0.5">
              Download PAN Card, Photo &amp; Bank Information for ESI portal registration.
            </p>
          </div>
        </div>
      </div>

      {!isLoading && <KpiStrip employees={employees} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by name or emp code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl border-blue-200"
          />
        </div>
        <Button
          variant="outline"
          className="gap-2 rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50"
          onClick={exportCsv}
        >
          <FileDown className="w-4 h-4" />
          Export CSV
        </Button>
        <Button
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-[0_4px_12px_rgba(37,99,235,0.3)] transition-all duration-200 disabled:opacity-50"
          disabled={selected.size === 0 || bulkDownloading}
          onClick={downloadBulk}
        >
          {bulkDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Bulk ZIP {selected.size > 0 && `(${selected.size})`}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <EmployeeTable
          employees={employees}
          selected={selected}
          onToggle={toggleSelect}
          onSelectAll={toggleSelectAll}
          onDownload={downloadSingle}
          onOpenDrawer={setDrawerEmp}
          downloading={downloading}
        />
      )}

      {data && (
        <p className="text-xs text-slate-400 text-right">
          {data.total} ESI-eligible employee{data.total !== 1 ? "s" : ""}
        </p>
      )}

      <EsiDrawer
        emp={drawerEmp}
        onClose={() => setDrawerEmp(null)}
        onDownload={downloadSingle}
        downloading={downloading}
      />
    </div>
  );
}