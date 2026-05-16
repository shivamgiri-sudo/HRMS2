import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function NativeATSRecruiterDashboard() {
  const { data: rows = [], refetch } = useQuery({
    queryKey: ["native-ats-recruiter-queue"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ats_candidate").select("id,candidate_id,full_name,mobile,email,status,source,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("ats_candidate").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) alert(error.message);
    else refetch();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">My Candidate Queue</h1>
          <p className="mt-1 text-slate-600">Native recruiter queue. Stage-wise VOC and offer validation will be added in the next ATS sprint.</p>
        </div>
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-3">Candidate</th><th className="p-3">Mobile</th><th className="p-3">Source</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3"><div className="font-medium">{r.full_name}</div><div className="text-xs text-slate-500">{r.candidate_id}</div></td>
                  <td className="p-3">{r.mobile}</td>
                  <td className="p-3">{r.source || "-"}</td>
                  <td className="p-3">{r.status}</td>
                  <td className="p-3 flex gap-2"><button onClick={() => updateStatus(r.id, "Selected")} className="rounded-lg bg-green-100 px-3 py-1 text-green-800">Selected</button><button onClick={() => updateStatus(r.id, "Rejected")} className="rounded-lg bg-red-100 px-3 py-1 text-red-800">Rejected</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
