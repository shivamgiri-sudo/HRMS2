import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type DraDetails = { registrationNo: string; serialNo: string; securityCode: string; certificateDate: string };

/**
 * The four details printed on the IIBF DRA certificate. HR looks the certificate up on IIBF's public verification
 * site with exactly these, so they are asked for next to the upload (SBI Credit Card process only).
 */
export function DraDetailsForm({
  saved, onSave,
}: {
  saved: (Partial<DraDetails> & { detailsEntered?: boolean }) | null;
  onSave: (d: DraDetails) => Promise<void>;
}) {
  const [f, setF] = useState<DraDetails>({ registrationNo: "", serialNo: "", securityCode: "", certificateDate: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Prefill with what is already saved (typed earlier), once.
  useEffect(() => {
    if (saved?.detailsEntered) {
      setF({
        registrationNo: saved.registrationNo ?? "", serialNo: saved.serialNo ?? "",
        securityCode: saved.securityCode ?? "", certificateDate: saved.certificateDate ?? "",
      });
    }
  }, [saved?.detailsEntered]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = (label: string, key: keyof DraDetails, opts: { type?: string; hint?: string } = {}) => (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-slate-700">{label} <span className="text-rose-500">*</span></Label>
      <Input
        type={opts.type ?? "text"} value={f[key]} max={opts.type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
        placeholder={opts.hint} onChange={(e) => { setF({ ...f, [key]: e.target.value }); setOk(false); }}
      />
    </div>
  );

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    try { await onSave(f); setOk(true); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-800">
      <p className="text-xs">
        Type these exactly as printed on your certificate. HR checks them on the public IIBF verification website, so a wrong character will fail the check.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {input("Membership / Registration number", "registrationNo")}
        {input("Certificate serial number", "serialNo")}
        {input("Security code", "securityCode")}
        {input("Certificate date", "certificateDate", { type: "date" })}
      </div>
      {err && <p className="text-xs font-semibold text-rose-600">{err}</p>}
      {ok && <p className="text-xs font-semibold text-emerald-600">Details saved.</p>}
      <Button type="button" size="sm" disabled={busy} onClick={save}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {saved?.detailsEntered ? "Update details" : "Save details"}
      </Button>
    </div>
  );
}
