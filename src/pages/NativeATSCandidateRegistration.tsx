import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function NativeATSCandidateRegistration() {
  const [form, setForm] = useState({ full_name: "", mobile: "", email: "", source: "", sub_source: "" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const candidateId = `CAN-${Date.now()}`;
      const { error } = await supabase.from("ats_candidate").insert({
        candidate_id: candidateId,
        full_name: form.full_name.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || null,
        source: form.source.trim() || null,
        sub_source: form.sub_source.trim() || null,
        status: "Waiting",
      });
      if (error) throw error;
      setMessage(`Candidate registered successfully: ${candidateId}`);
      setForm({ full_name: "", mobile: "", email: "", source: "", sub_source: "" });
    } catch (err: any) {
      setMessage(err.message || "Unable to register candidate");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl rounded-3xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">Candidate Registration</h1>
        <p className="mt-1 text-sm text-slate-600">Native ATS intake form. Resume/selfie upload will be added in the next ATS build phase.</p>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <input required value={form.full_name} onChange={(e) => update("full_name", e.target.value)} placeholder="Candidate full name" className="rounded-xl border px-4 py-3" />
          <input required value={form.mobile} onChange={(e) => update("mobile", e.target.value)} placeholder="Mobile number" className="rounded-xl border px-4 py-3" />
          <input value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="Email" className="rounded-xl border px-4 py-3" />
          <div className="grid gap-4 md:grid-cols-2">
            <input value={form.source} onChange={(e) => update("source", e.target.value)} placeholder="Source" className="rounded-xl border px-4 py-3" />
            <input value={form.sub_source} onChange={(e) => update("sub_source", e.target.value)} placeholder="Sub-source" className="rounded-xl border px-4 py-3" />
          </div>
          <button disabled={saving} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-60">{saving ? "Saving..." : "Register Candidate"}</button>
        </form>
        {message && <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</div>}
      </div>
    </DashboardLayout>
  );
}
