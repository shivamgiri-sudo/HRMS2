import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

type DraStatus = "pending" | "verified" | "invalid" | "expired" | "mismatch";
export type DraFilter = DraStatus | "not_uploaded";

export const DRA_LABEL: Record<DraFilter, string> = {
  verified: "Verified",
  pending: "Pending Verification",
  invalid: "Invalid",
  expired: "Expired",
  mismatch: "Mismatch / Verification Failed",
  not_uploaded: "Not uploaded",
};

const TONE: Record<DraFilter, string> = {
  verified: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  invalid: "bg-rose-100 text-rose-800",
  expired: "bg-rose-100 text-rose-800",
  mismatch: "bg-rose-100 text-rose-800",
  not_uploaded: "bg-slate-100 text-slate-700",
};

export const DraBadge = ({ status }: { status: DraFilter }) => (
  <Badge className={`${TONE[status]} hover:${TONE[status]}`}>{DRA_LABEL[status]}</Badge>
);

interface Cert {
  id: string; status: DraStatus; reason: string | null; autoChecksPassed: boolean;
  registrationNo: string | null; serialNo: string | null; securityCode: string | null;
  certificateDate: string | null; validUntil: string | null; extractedName: string | null;
  nameMatchScore: number | null; photoMatchScore: number | null;
  uploadedAt: string; verifiedAt: string | null; verificationSource: string | null; hrNote: string | null;
  detailsEntered: boolean;
  ocr: { registrationNo: string | null; serialNo: string | null; securityCode: string | null; certificateDate: string | null };
}
interface Detail { current: Cert | null; history: Cert[] }

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

/** HR view of one candidate's DRA certificate (SBI Credit Card onboarding): read details, history, verify / reject. */
export function DraCertificatePanel({ candidateId, onChanged }: { candidateId: string; onChanged?: () => void }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ registrationNo: "", serialNo: "", securityCode: "", certificateDate: "", validUntil: "", note: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<{ data: Detail }>(`/api/ats/dra-certificates/${candidateId}`);
      setDetail(res.data);
      const c = res.data.current;
      setForm({
        registrationNo: c?.registrationNo ?? "", serialNo: c?.serialNo ?? "", securityCode: c?.securityCode ?? "",
        certificateDate: c?.certificateDate ?? "", validUntil: c?.validUntil ?? "", note: "",
      });
    } catch { setDetail(null); } finally { setLoading(false); }
  }, [candidateId]);
  useEffect(() => { void load(); }, [load]);

  async function decide(result: "verified" | "invalid" | "mismatch") {
    setSaving(true);
    try {
      await hrmsApi.post(`/api/ats/dra-certificates/${candidateId}/decision`, { result, ...form });
      toast({ title: result === "verified" ? "Certificate marked verified" : "Certificate rejected; the candidate can re-upload" });
      await load();
      onChanged?.();
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  const c = detail?.current;
  if (!c) {
    return <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      No DRA certificate uploaded. It is required only for the SBI Credit Card cost centre (BSS/OB/AHMH-JD/1050).</p>;
  }
  const field = (label: string, key: keyof typeof form, type = "text") => (
    <div className="space-y-1"><Label className="text-xs">{label}</Label>
      <Input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></div>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <DraBadge status={c.status} />
        {c.autoChecksPassed && c.status === "pending" && <Badge variant="outline">Auto-checks passed</Badge>}
        <span className="text-xs text-slate-500">Uploaded {fmt(c.uploadedAt)} · Decided {fmt(c.verifiedAt)}{c.verificationSource ? ` (${c.verificationSource.replace(/_/g, " ")})` : ""}</span>
        {c.reason && <p className="w-full text-sm text-slate-700">{c.reason}</p>}
        <p className="w-full text-xs text-slate-500">
          Name on certificate: <b>{c.extractedName ?? "not read"}</b>
          {c.nameMatchScore != null && ` · name match ${c.nameMatchScore}%`}
          {c.photoMatchScore != null && ` · photo match ${c.photoMatchScore}%`}.
          Open the file in the Documents tab.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-1 text-sm font-semibold">Details to check on the public IIBF website</p>
        <p className="mb-3 text-xs text-slate-500">
          {c.detailsEntered ? "The candidate typed these four details; the right-hand column is what the system read off the file." : "The candidate has not typed the details yet; the right-hand column is what the system read off the file."}
          {" "}Open the IIBF website yourself (<a className="underline" href="https://www.iibf.org.in" target="_blank" rel="noreferrer">iibf.org.in</a>; do not use a link the candidate sends), look the certificate up with these four, then record the result below.
        </p>
        <table className="mb-3 w-full text-xs">
          <thead><tr className="text-left text-slate-500"><th className="py-1">Detail</th><th>Typed by candidate</th><th>Read from certificate</th></tr></thead>
          <tbody>
            {([
              ["Membership / Registration no.", c.registrationNo, c.ocr.registrationNo],
              ["Certificate serial no.", c.serialNo, c.ocr.serialNo],
              ["Security code", c.securityCode, c.ocr.securityCode],
              ["Certificate date", c.certificateDate, c.ocr.certificateDate],
            ] as const).map(([label, typed, read]) => {
              const norm = (v: string | null) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
              const differs = !!typed && !!read && norm(typed) !== norm(read);
              return (
                <tr key={label} className={differs ? "bg-rose-50 font-semibold text-rose-700" : ""}>
                  <td className="py-1 pr-2">{label}</td><td className="pr-2">{c.detailsEntered ? typed ?? "—" : "—"}</td><td>{read ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mb-2 text-xs text-slate-500">Correct any value below if needed, then record the result.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {field("Membership / Registration no.", "registrationNo")}
          {field("Certificate serial no.", "serialNo")}
          {field("Security code", "securityCode")}
          {field("Certificate date", "certificateDate", "date")}
          {field("Valid until (if printed)", "validUntil", "date")}
        </div>
        <div className="mt-3 space-y-1"><Label className="text-xs">Note / reason (required to reject)</Label>
          <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} /></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => decide("verified")} className="bg-emerald-600 hover:bg-emerald-700">Mark verified</Button>
          <Button disabled={saving} variant="outline" onClick={() => decide("mismatch")}>Mark mismatch</Button>
          <Button disabled={saving} variant="destructive" onClick={() => decide("invalid")}>Reject (candidate re-uploads)</Button>
        </div>
      </div>

      {detail!.history.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold">Upload history</p>
          <ul className="space-y-1 text-xs text-slate-600">
            {detail!.history.map((h) => (
              <li key={h.id}>{fmt(h.uploadedAt)} · {DRA_LABEL[h.status]}{h.reason ? ` · ${h.reason}` : ""}{h.verifiedAt ? ` · decided ${fmt(h.verifiedAt)}` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface Row { candidateId: string; candidateName: string; status: DraFilter; uploadedAt: string | null; reason: string | null }

/** Counts by status for every SBI DRA candidate, with a filterable list. Hidden when there are none. */
export function DraOverview({ onSelect }: { onSelect: (candidateId: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<DraFilter | "all">("all");
  useEffect(() => {
    hrmsApi.get<{ data: { rows: Row[] } }>("/api/ats/dra-certificates").then((r) => setRows(r.data.rows)).catch(() => setRows([]));
  }, []);
  if (!rows || rows.length === 0) return null;
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-semibold">SBI Credit Card · DRA certificates ({rows.length})</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All {rows.length}</Button>
        {(Object.keys(DRA_LABEL) as DraFilter[]).map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
            {DRA_LABEL[s]} {counts[s] ?? 0}
          </Button>
        ))}
      </div>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {shown.map((r) => (
          <li key={r.candidateId}>
            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left hover:bg-slate-50" onClick={() => onSelect(r.candidateId)}>
              <span className="min-w-0 flex-1 truncate font-medium">{r.candidateName}</span>
              <DraBadge status={r.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
