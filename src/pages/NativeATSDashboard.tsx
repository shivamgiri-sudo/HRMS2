import { useQuery } from "@tanstack/react-query";
import { Briefcase, Users, UserCheck, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

const StatCard = ({ title, value, icon }: { title: string; value: number | string; icon: React.ReactNode }) => (
  <div className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-500">{title}</p>
        <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
      </div>
      <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
    </div>
  </div>
);

export default function NativeATSDashboard() {
  const { data: candidates = [] } = useQuery({
    queryKey: ["native-ats-dashboard"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ats_candidate").select("id,status,created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const total = candidates.length;
  const waiting = candidates.filter((c: any) => c.status === "Waiting").length;
  const selected = candidates.filter((c: any) => c.status === "Selected").length;
  const risk = candidates.filter((c: any) => ["No Show", "Hold", "Rejected"].includes(c.status)).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">ATS Dashboard</h1>
          <p className="mt-1 text-slate-600">Native recruitment command center inside HRMS.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total Candidates" value={total} icon={<Users className="h-5 w-5" />} />
          <StatCard title="Waiting" value={waiting} icon={<Briefcase className="h-5 w-5" />} />
          <StatCard title="Selected" value={selected} icon={<UserCheck className="h-5 w-5" />} />
          <StatCard title="Risk / Closed" value={risk} icon={<AlertTriangle className="h-5 w-5" />} />
        </div>
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Latest Candidates</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">Status</th><th className="py-2">Created</th></tr></thead>
              <tbody>{candidates.slice(0, 10).map((c: any) => <tr key={c.id} className="border-t"><td className="py-2">{c.status}</td><td className="py-2 text-slate-500">{new Date(c.created_at).toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
