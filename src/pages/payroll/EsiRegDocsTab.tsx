import { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import { useBranches } from "@/hooks/useOrgMasters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AuthedImage } from "@/components/ui/AuthedImage";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle2, XCircle, Download, FileText, Users,
  AlertTriangle, Search, FileDown, Loader2, Upload, Camera, Eye, Mail,
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
  aadhaar_ready: boolean;
  photo_ready: boolean;
  photo_url: string | null;
  bank_ready: boolean;
  bank_passbook_ready: boolean;
  bank_passbook_url: string | null;
}

interface ListResponse {
  employees: EsiEmployee[];
  total: number;
  page: number;
  limit: number;
}

/** Last 12 joining months (YYYY-MM), newest first. */
function useMonthOptions() {
  return useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      opts.push({ value, label: d.toLocaleString("en-IN", { month: "short", year: "numeric" }) });
    }
    return opts;
  }, []);
}

function useEsiList(params: { search: string; branchId: string; page: number; dateFrom: string; dateTo: string; activeStatus: string; month: string }) {
  return useQuery<ListResponse>({
    queryKey: ["esi-reg-docs", params],
    queryFn: () => {
      const qs = new URLSearchParams({ page: String(params.page), limit: params.search.trim().split(/[\s,;]+/).length > 1 ? "200" : "50" });
      if (params.search) qs.set("search", params.search);
      if (params.branchId) qs.set("branch_id", params.branchId);
      if (params.dateFrom) qs.set("date_from", params.dateFrom);
      if (params.dateTo) qs.set("date_to", params.dateTo);
      if (params.activeStatus && params.activeStatus !== "1") qs.set("active_status", params.activeStatus);
      if (params.month) qs.set("month", params.month);
      return hrmsApi.get<ListResponse>(`/api/payroll/esi-reg-docs?${qs}`);
    },
    staleTime: 30_000,
  });
}

/**
 * Compress an image File to stay within maxBytes using a canvas resize loop.
 * Starts at quality=0.85, halves quality each attempt until size fits.
 * If quality alone doesn't cut it, the image dimensions are scaled down 20% per pass.
 */
async function compressImage(file: File, maxBytes = 100 * 1024): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      let quality = 0.85;
      let attempt = 0;

      const tryCompress = () => {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("Canvas compression failed"));
            if (blob.size <= maxBytes || attempt >= 12) {
              const ext = file.name.endsWith(".png") ? ".png" : ".jpg";
              resolve(new File([blob], `compressed${ext}`, { type: blob.type }));
            } else {
              attempt++;
              if (quality > 0.2) {
                quality = Math.max(0.2, quality - 0.15);
              } else {
                width = Math.floor(width * 0.8);
                height = Math.floor(height * 0.8);
                quality = 0.7;
              }
              tryCompress();
            }
          },
          "image/jpeg",
          quality,
        );
      };
      tryCompress();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };
    img.src = url;
  });
}

const DOC_KINDS = [
  { kind: "pan", label: "PAN Card" },
  { kind: "aadhaar", label: "Aadhaar" },
  { kind: "photo", label: "Employee Photo" },
  { kind: "passbook", label: "Bank Passbook" },
] as const;

/** Fetch a document with auth and open it in a new tab. */
async function viewEsiDoc(employeeId: string, kind: string): Promise<void> {
  // Open synchronously so the popup blocker treats it as a user gesture.
  const win = window.open("", "_blank");
  try {
    const blob = await hrmsApi.getBlob(`/api/payroll/esi-reg-docs/${employeeId}/doc/${kind}`);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

interface ReminderResponse {
  success: boolean;
  summary: { sent: number; skipped: number; failed: number };
  results: Array<{ employee_code: string | null; status: string; reason?: string }>;
}

const REMINDER_SKIP_TEXT: Record<string, string> = {
  not_pending: "nothing pending",
  no_email: "no email address on file",
  recently_reminded: "reminded in the last 3 days",
  max_reminders_reached: "5 reminders already sent",
  no_valid_link: "no valid link",
};

type DocKey = "pan" | "aadhaar" | "photo" | "passbook" | "declaration";
const DOC_OPTIONS: Array<{ key: DocKey; label: string }> = [
  { key: "photo", label: "Employee Photo" },
  { key: "passbook", label: "Bank Passbook" },
  { key: "pan", label: "PAN Card" },
  { key: "aadhaar", label: "Aadhaar" },
  { key: "declaration", label: "ESI Declaration Form" },
];
const DEFAULT_DOCS: DocKey[] = ["photo", "passbook"];
const DOCS_STORAGE_KEY = "esi-reg-docs:visible-docs";

function loadDocs(): Set<DocKey> {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCS_STORAGE_KEY) ?? "null");
    if (Array.isArray(raw)) {
      const ok = raw.filter((k): k is DocKey => DOC_OPTIONS.some((o) => o.key === k));
      if (ok.length) return new Set(ok);
    }
  } catch { /* storage unavailable — fall through to default */ }
  return new Set(DEFAULT_DOCS);
}

/** Master + per-document check boxes: controls the visible columns AND what the ZIP contains. */
function DocSelector({ docs, onChange }: { docs: Set<DocKey>; onChange: (next: Set<DocKey>) => void }) {
  const all = docs.size === DOC_OPTIONS.length;
  const masterRef = useRef<HTMLInputElement>(null);
  if (masterRef.current) masterRef.current.indeterminate = docs.size > 0 && !all;
  const toggle = (k: DocKey) => {
    const next = new Set(docs);
    next.has(k) ? next.delete(k) : next.add(k);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm">
      <label className="flex items-center gap-2 font-semibold text-slate-800">
        <input
          ref={masterRef}
          type="checkbox"
          checked={all}
          onChange={() => onChange(all ? new Set() : new Set(DOC_OPTIONS.map((o) => o.key)))}
          className="rounded"
        />
        All documents
      </label>
      <span className="h-5 w-px bg-slate-200" />
      {DOC_OPTIONS.map((o) => (
        <label key={o.key} className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" checked={docs.has(o.key)} onChange={() => toggle(o.key)} className="rounded" />
          {o.label}
        </label>
      ))}
      <button
        type="button"
        className="ml-auto text-xs font-semibold text-blue-700 hover:underline"
        onClick={() => onChange(new Set(DEFAULT_DOCS))}
      >
        Photo + Passbook only
      </button>
    </div>
  );
}

function KpiStrip({ employees, total, docs }: { employees: EsiEmployee[]; total: number; docs: Set<DocKey> }) {
  const onPage = employees.length;
  const allReady = employees.filter(
    (e) =>
      (!docs.has("pan") || e.pan_ready) &&
      (!docs.has("aadhaar") || e.aadhaar_ready) &&
      (!docs.has("photo") || e.photo_ready) &&
      (!docs.has("declaration") || e.bank_ready) &&
      (!docs.has("passbook") || e.bank_passbook_ready)
  ).length;
  const missing = onPage - allReady;

  const tiles = [
    { label: "Pending ESI Registration", value: total, icon: Users, tone: "blue" as const },
    { label: `Selected Docs Ready (of ${onPage} shown)`, value: allReady, icon: CheckCircle2, tone: "green" as const },
    { label: `Selected Docs Missing (of ${onPage} shown)`, value: missing, icon: AlertTriangle, tone: "amber" as const },
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
  docs,
}: {
  docs: Set<DocKey>;
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
              {[
                "Emp Code", "Name", "Branch", "ESIC No.",
                ...(docs.has("pan") ? ["PAN"] : []),
                ...(docs.has("aadhaar") ? ["Aadhaar"] : []),
                ...(docs.has("photo") ? ["Photo"] : []),
                ...(docs.has("declaration") ? ["Bank"] : []),
                ...(docs.has("passbook") ? ["Passbook"] : []),
                "Actions",
              ].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={5 + docs.size + 1} className="px-4 py-8 text-center text-slate-400 text-sm">
                  No ESI-eligible employees pending registration.
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
                {docs.has("pan") && <td className="px-4 py-3"><ReadyChip ready={emp.pan_ready} label="PAN" /></td>}
                {docs.has("aadhaar") && <td className="px-4 py-3"><ReadyChip ready={emp.aadhaar_ready} label="Aadhaar" /></td>}
                {docs.has("photo") && <td className="px-4 py-3"><ReadyChip ready={emp.photo_ready} label="Photo" /></td>}
                {docs.has("declaration") && <td className="px-4 py-3"><ReadyChip ready={emp.bank_ready} label="Bank" /></td>}
                {docs.has("passbook") && <td className="px-4 py-3"><ReadyChip ready={emp.bank_passbook_ready} label="Passbook" /></td>}
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                    disabled={downloading === emp.employee_id || docs.size === 0}
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

function ImageUploadBox({
  label,
  hint,
  currentUrl,
  uploading,
  onFile,
}: {
  label: string;
  hint: string;
  currentUrl: string | null | undefined;
  uploading: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {currentUrl ? (
          <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-3 h-3" /> Uploaded
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
            <XCircle className="w-3 h-3" /> Missing
          </span>
        )}
      </div>

      {currentUrl && (
        <div className="relative">
          <AuthedImage
            src={currentUrl}
            alt={label}
            className="w-full max-h-40 object-contain rounded-lg border border-slate-100 bg-slate-50"
          />
        </div>
      )}

      <p className="text-xs text-slate-400">{hint}</p>
      <p className="text-xs text-amber-600 font-medium">Image will be compressed to ≤100 KB before upload.</p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : currentUrl ? (
          <Upload className="w-4 h-4" />
        ) : (
          <Camera className="w-4 h-4" />
        )}
        {uploading ? "Uploading…" : currentUrl ? "Replace" : "Upload"}
      </Button>
    </div>
  );
}

function EsiDrawer({
  emp: initialEmp,
  onClose,
  onDownload,
  downloading,
  onUploaded,
}: {
  emp: EsiEmployee | null;
  onClose: () => void;
  onDownload: (id: string) => void;
  downloading: string | null;
  onUploaded: (id: string, patch: Partial<EsiEmployee>) => void;
}) {
  const { toast } = useToast();
  const [emp, setEmp] = useState<EsiEmployee | null>(initialEmp);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingPassbook, setUploadingPassbook] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  // sync when parent changes (new drawer open)
  if (initialEmp?.employee_id !== emp?.employee_id) {
    setEmp(initialEmp);
  }

  if (!emp) return null;

  const allReady = emp.pan_ready && emp.aadhaar_ready && emp.photo_ready && emp.bank_ready && emp.bank_passbook_ready;

  async function uploadFile(
    endpoint: string,
    file: File,
    setUploading: (v: boolean) => void,
    onSuccess: (data: Record<string, string>) => void,
  ) {
    setUploading(true);
    try {
      const compressed = await compressImage(file, 100 * 1024);
      const formData = new FormData();
      formData.append("photo", compressed);
      const token = getAuthToken();
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`);
      onSuccess(json);
      toast({ title: "Upload successful", description: "Image saved." });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleView(kind: string) {
    setViewing(kind);
    try {
      await viewEsiDoc(emp!.employee_id, kind);
    } catch {
      toast({ title: "Document not available", description: "No readable file found for this document.", variant: "destructive" });
    } finally {
      setViewing(null);
    }
  }

  function handlePhotoFile(file: File) {
    uploadFile(
      `/api/payroll/esi-reg-docs/${emp!.employee_id}/photo`,
      file,
      setUploadingPhoto,
      (data) => {
        const patch = { photo_ready: true, photo_url: data.photo_url };
        setEmp((prev) => prev ? { ...prev, ...patch } : prev);
        onUploaded(emp!.employee_id, patch);
      },
    );
  }

  function handlePassbookFile(file: File) {
    uploadFile(
      `/api/payroll/esi-reg-docs/${emp!.employee_id}/bank-passbook`,
      file,
      setUploadingPassbook,
      (data) => {
        const patch = { bank_passbook_ready: true, bank_passbook_url: data.bank_passbook_url };
        setEmp((prev) => prev ? { ...prev, ...patch } : prev);
        onUploaded(emp!.employee_id, patch);
      },
    );
  }

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
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">View Documents</p>
            <div className="space-y-2">
              {DOC_KINDS.map((d) => (
                <div key={d.kind} className="flex items-center justify-between py-2 border-b border-slate-50">
                  <span className="text-sm font-medium text-slate-700">{d.label}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-blue-200 text-blue-700 hover:bg-blue-50"
                    disabled={viewing === d.kind}
                    onClick={() => handleView(d.kind)}
                  >
                    {viewing === d.kind ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                    View
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Upload Photos</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ImageUploadBox
                label="Employee Photo"
                hint="Clear face photo on white/plain background. JPG, PNG or WebP."
                currentUrl={emp.photo_url}
                uploading={uploadingPhoto}
                onFile={handlePhotoFile}
              />
              <ImageUploadBox
                label="Bank Passbook Photo"
                hint="First page of passbook showing account number, IFSC and holder name. JPG, PNG or WebP."
                currentUrl={emp.bank_passbook_url}
                uploading={uploadingPassbook}
                onFile={handlePassbookFile}
              />
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
              ZIP includes PAN card, Aadhaar, employee photo, bank passbook, and a filled ESI Declaration Form
              (DOB, gender, father's/husband's name, address, nominee &amp; bank details) for ESI portal upload.
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeStatus, setActiveStatus] = useState("1");
  const [month, setMonth] = useState("");
  const monthOptions = useMonthOptions();
  const [docs, setDocsState] = useState<Set<DocKey>>(loadDocs);
  const setDocs = (next: Set<DocKey>) => {
    setDocsState(next);
    try { localStorage.setItem(DOCS_STORAGE_KEY, JSON.stringify([...next])); } catch { /* per-viewer convenience only */ }
  };
  const docsParam = [...docs].join(",");
  // Pasted list of employee codes → report the ones that are not in this queue.
  const pastedCodes = useMemo(() => {
    const t = search.trim().split(/[\s,;]+/).filter(Boolean);
    return t.length > 1 ? Array.from(new Set(t)) : [];
  }, [search]);
  const [page] = useState(1);
  const branches = useBranches().data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerEmp, setDrawerEmp] = useState<EsiEmployee | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [reminding, setReminding] = useState(false);

  const { data, isLoading } = useEsiList({ search, branchId, page, dateFrom, dateTo, activeStatus, month });
  const employees = data?.employees ?? [];
  const notFoundCodes = useMemo(() => {
    if (!pastedCodes.length || !data) return [];
    const have = new Set(employees.map((e) => e.emp_code.toLowerCase()));
    return pastedCodes.filter((c) => !have.has(c.toLowerCase()));
  }, [pastedCodes, data, employees]);
  const [zipProgress, setZipProgress] = useState<string | null>(null);

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
      const blob = await hrmsApi.getBlob(`/api/payroll/esi-reg-docs/${employeeId}/download?docs=${docsParam}`);
      const emp = employees.find((e) => e.employee_id === employeeId);
      const safeName = (emp?.name ?? "").replace(/[^A-Za-z0-9 _-]/g, "").trim();
      triggerBlobDownload(blob, emp ? `${emp.emp_code} - ${safeName}.zip` : `${employeeId}.zip`);
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
        body: JSON.stringify({ employee_ids: Array.from(selected), docs: [...docs] }),
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

  /** One ZIP per selected employee, downloaded one after another. */
  async function downloadSeparate() {
    const list = employees.filter((e) => selected.has(e.employee_id));
    if (list.length === 0 || docs.size === 0) return;
    for (let i = 0; i < list.length; i++) {
      const emp = list[i];
      setZipProgress(`${i + 1}/${list.length}`);
      try {
        const blob = await hrmsApi.getBlob(`/api/payroll/esi-reg-docs/${emp.employee_id}/download?docs=${docsParam}`);
        const safeName = emp.name.replace(/[^A-Za-z0-9 _-]/g, "").trim();
        triggerBlobDownload(blob, `${emp.emp_code} - ${safeName}.zip`);
      } catch {
        toast({ title: `Download failed for ${emp.emp_code}`, variant: "destructive" });
      }
      await new Promise((r) => setTimeout(r, 400)); // let the browser accept each download
    }
    setZipProgress(null);
  }

  async function sendReminders() {
    if (selected.size === 0) return;
    setReminding(true);
    try {
      const res = await hrmsApi.post<ReminderResponse>("/api/payroll/pendency-reminders", {
        kind: "esi_docs",
        employee_ids: Array.from(selected),
      });
      const { sent, skipped, failed } = res.summary;
      const skippedWhy = res.results
        .filter((r) => r.status === "skipped")
        .slice(0, 3)
        .map((r) => `${r.employee_code ?? "?"}: ${REMINDER_SKIP_TEXT[r.reason ?? ""] ?? r.reason}`)
        .join("; ");
      toast({
        title: `Reminders: ${sent} sent${skipped ? `, ${skipped} skipped` : ""}${failed ? `, ${failed} failed` : ""}`,
        description: skipped ? `${skippedWhy}${skipped > 3 ? "…" : ""}` : "Each email links to their profile Documents page.",
        variant: failed ? "destructive" : "default",
      });
      if (sent > 0) setSelected(new Set());
    } catch (err) {
      toast({
        title: "Could not send reminders",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReminding(false);
    }
  }

  async function exportCsv() {
    try {
      const blob = await hrmsApi.getBlob(
        `/api/payroll/esi-reg-docs/export-csv?${new URLSearchParams({ ...(branchId ? { branch_id: branchId } : {}), ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}), ...(activeStatus !== "1" ? { active_status: activeStatus } : {}), ...(month ? { month } : {}) })}`,
      );
      triggerBlobDownload(blob, `ESI_Reg_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      toast({ title: "CSV export failed", variant: "destructive" });
    }
  }

  function handleUploaded(employeeId: string, patch: Partial<EsiEmployee>) {
    queryClient.setQueryData<ListResponse>(
      ["esi-reg-docs", { search, branchId, page, dateFrom, dateTo, activeStatus, month }],
      (old) => {
        if (!old) return old;
        return {
          ...old,
          employees: old.employees.map((e) =>
            e.employee_id === employeeId ? { ...e, ...patch } : e
          ),
        };
      }
    );
    if (drawerEmp?.employee_id === employeeId) {
      setDrawerEmp((prev) => prev ? { ...prev, ...patch } : prev);
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
              Upload employee photo &amp; bank passbook, then download the ESI pack for portal registration.
            </p>
          </div>
        </div>
      </div>

      {notFoundCodes.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {notFoundCodes.length} of {pastedCodes.length} pasted code{pastedCodes.length !== 1 ? "s" : ""} not in the pending-ESI list
          (already registered, not ESI-eligible, other branch or inactive): {notFoundCodes.join(", ")}
        </div>
      )}

      <DocSelector docs={docs} onChange={setDocs} />

      {!isLoading && <KpiStrip employees={employees} total={data?.total ?? employees.length} docs={docs} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search name / emp code — or paste many codes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl border-blue-200"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          Joined
          <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => { setDateFrom(e.target.value); setSelected(new Set()); }}
            aria-label="Joining date from" className="h-10 rounded-xl border border-blue-200 bg-white px-2 text-sm text-slate-700" />
          to
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => { setDateTo(e.target.value); setSelected(new Set()); }}
            aria-label="Joining date to" className="h-10 rounded-xl border border-blue-200 bg-white px-2 text-sm text-slate-700" />
          {(dateFrom || dateTo) && (
            <button type="button" className="text-blue-700 hover:underline" onClick={() => { setDateFrom(""); setDateTo(""); }}>clear</button>
          )}
        </label>
        <select
          value={branchId}
          onChange={(e) => { setBranchId(e.target.value); setSelected(new Set()); }}
          aria-label="Filter by branch"
          className="h-10 rounded-xl border border-blue-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.branch_name ?? b.name}</option>
          ))}
        </select>
        <select
          value={activeStatus}
          onChange={(e) => { setActiveStatus(e.target.value); setSelected(new Set()); }}
          aria-label="Filter by active status"
          className="h-10 rounded-xl border border-blue-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="1">Active</option>
          <option value="0">Inactive</option>
          <option value="all">All status</option>
        </select>
        <select
          value={month}
          onChange={(e) => { setMonth(e.target.value); setSelected(new Set()); }}
          aria-label="Filter by joining month"
          className="h-10 rounded-xl border border-blue-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">All joining months</option>
          {monthOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
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
          disabled={selected.size === 0 || bulkDownloading || docs.size === 0}
          onClick={downloadBulk}
        >
          {bulkDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Bulk ZIP {selected.size > 0 && `(${selected.size})`}
        </Button>
        <Button
          variant="outline"
          className="gap-2 rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          disabled={selected.size === 0 || zipProgress !== null || docs.size === 0}
          onClick={downloadSeparate}
          title="Download one ZIP per selected employee"
        >
          {zipProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {zipProgress ? `Zipping ${zipProgress}` : `Separate ZIPs${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </Button>
        <Button
          variant="outline"
          className="gap-2 rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          disabled={selected.size === 0 || reminding}
          onClick={sendReminders}
          title="Email the selected employees a link to upload what is missing"
        >
          {reminding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          Send reminder {selected.size > 0 && `(${selected.size})`}
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
          docs={docs}
        />
      )}

      {data && (
        <p className="text-xs text-slate-400 text-right">
          {data.total} employee{data.total !== 1 ? "s" : ""} pending ESI registration
        </p>
      )}

      <EsiDrawer
        emp={drawerEmp}
        onClose={() => setDrawerEmp(null)}
        onDownload={downloadSingle}
        downloading={downloading}
        onUploaded={handleUploaded}
      />
    </div>
  );
}
