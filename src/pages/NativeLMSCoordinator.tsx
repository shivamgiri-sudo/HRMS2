import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function NativeLMSCoordinator() {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const { data: classrooms = [], refetch } = useQuery({
    queryKey: ["native-lms-classrooms"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lms_classroom_master").select("id,classroom_code,classroom_name,active_status,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createClassroom = async () => {
    if (!name.trim()) return;
    const code = `CLS-${Date.now()}`;
    const { error } = await supabase.from("lms_classroom_master").insert({ classroom_code: code, classroom_name: name.trim() });
    if (error) setMessage(error.message);
    else { setMessage(`Classroom created: ${code}`); setName(""); refetch(); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">LMS Coordinator</h1>
          <p className="mt-1 text-slate-600">Native coordinator foundation for classrooms, batches, trainee onboarding and handover workflow.</p>
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Create Classroom</h2>
          <div className="mt-4 flex gap-3"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Classroom name" className="flex-1 rounded-xl border px-4 py-3" /><button onClick={createClassroom} className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white">Create</button></div>
          {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-950">Classrooms</h2>
          <div className="mt-4 space-y-2">{classrooms.map((c: any) => <div key={c.id} className="rounded-xl border p-3"><div className="font-medium">{c.classroom_name}</div><div className="text-xs text-slate-500">{c.classroom_code}</div></div>)}</div>
        </div>
      </div>
    </DashboardLayout>
  );
}
