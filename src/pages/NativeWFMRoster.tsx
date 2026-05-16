import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function NativeWFMRoster() {
  const [form, setForm] = useState({ shift_code: "", shift_name: "", start_time: "09:00", end_time: "18:00" });
  const { data: shifts = [], refetch } = useQuery({
    queryKey: ["native-wfm-shifts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("wfm_shift_master").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    const { error } = await supabase.from("wfm_shift_master").insert(form);
    if (error) alert(error.message);
    else refetch();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div><h1 className="text-3xl font-bold text-slate-950">Roster Planning</h1><p className="mt-1 text-slate-600">Native WFM shift master foundation.</p></div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm grid gap-3 md:grid-cols-5">
          <input value={form.shift_code} onChange={(e) => setForm({ ...form, shift_code: e.target.value })} placeholder="Shift code" className="rounded-xl border px-4 py-3" />
          <input value={form.shift_name} onChange={(e) => setForm({ ...form, shift_name: e.target.value })} placeholder="Shift name" className="rounded-xl border px-4 py-3" />
          <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="rounded-xl border px-4 py-3" />
          <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="rounded-xl border px-4 py-3" />
          <button onClick={save} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white">Save Shift</button>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Shift Master</h2><div className="mt-4 space-y-2">{shifts.map((s: any) => <div key={s.id} className="rounded-xl border p-3">{s.shift_code} — {s.shift_name} ({s.start_time} - {s.end_time})</div>)}</div></div>
      </div>
    </DashboardLayout>
  );
}
