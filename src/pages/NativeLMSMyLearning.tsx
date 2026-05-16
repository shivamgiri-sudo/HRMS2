import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";

export default function NativeLMSMyLearning() {
  const { data: contents = [] } = useQuery({
    queryKey: ["native-lms-my-learning"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lms_content_master")
        .select("id,content_title,content_type,content_url,required_completion_percent,lms_module_master(module_name,day_no,lms_classroom_master(classroom_name))")
        .eq("active_status", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">My Learning</h1>
          <p className="mt-1 text-slate-600">Native learner LMS inside HRMS. Every employee can access assigned learning here.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {contents.length === 0 ? (
            <div className="rounded-2xl border bg-white p-6 text-slate-500">No learning content is published yet.</div>
          ) : contents.map((c: any) => (
            <div key={c.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">{c.lms_module_master?.lms_classroom_master?.classroom_name || "Classroom"}</p>
              <h2 className="mt-2 font-semibold text-slate-950">{c.content_title}</h2>
              <p className="mt-1 text-sm text-slate-500">{c.lms_module_master?.module_name || "Module"} • {c.content_type}</p>
              {c.content_url ? <a className="mt-4 inline-block rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white" href={c.content_url} target="_blank" rel="noreferrer">Open Content</a> : <span className="mt-4 inline-block rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-500">Content URL pending</span>}
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
