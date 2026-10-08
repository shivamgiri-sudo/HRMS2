/** Campaign mapping: which Meta campaign feeds which requisition, from GET /api/he/meta-recruitment (all time, all Meta campaigns). */
import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { campaignMappingView, type CampaignRecruitmentRow } from "./sourceSectionModel";

export default function CampaignMapping() {
  const [data, setData] = useState<{ campaigns: CampaignRecruitmentRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    hrmsApi.get<{ data?: { campaigns: CampaignRecruitmentRow[] } }>("/api/he/meta-recruitment")
      .then((r) => { if (alive) setData(r?.data ?? null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  if (failed) return null; // supporting detail: never in the way of the section
  const v = campaignMappingView(data);
  return (
    <section aria-labelledby="campaign-mapping-heading" className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" style={{ minHeight: 96 }}>
      <h3 id="campaign-mapping-heading" className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-100"><Link2 className="h-4 w-4" aria-hidden /> Campaign mapping</h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">Which Meta campaign feeds which requisition. All-time counts for every Meta campaign, not limited to the date range above.</p>
      {!data ? <p role="status" className="text-xs text-slate-600 dark:text-slate-300">Loading campaigns</p>
        : v.empty ? <p className="text-sm text-slate-700 dark:text-slate-200">No Meta campaign has leads yet.</p> : (
          <>
            {v.unmapped > 0 && <p className="text-xs font-medium text-amber-900 dark:text-amber-200">{v.unmapped} of {v.total} campaigns are not linked to a requisition.</p>}
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-max border-collapse text-left text-xs text-slate-800 dark:text-slate-100">
                <caption className="sr-only">Meta campaigns with the requisition each feeds and their all-time lead, qualified and joined counts</caption>
                <thead><tr className="border-b border-slate-200 dark:border-slate-700">
                  {["Campaign", "Requisition", "Branch", "Status", "Leads", "Qualified", "Joined"].map((c) => <th key={c} scope="col" className="px-2 py-1 font-semibold">{c}</th>)}
                </tr></thead>
                <tbody>
                  {v.rows.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                      <th scope="row" className="max-w-xs break-words px-2 py-1 font-medium">{r.name}</th>
                      <td className="px-2 py-1">{r.requisition}</td><td className="px-2 py-1">{r.branch}</td><td className="px-2 py-1">{r.status}</td>
                      <td className="px-2 py-1 tabular-nums">{r.leads}</td><td className="px-2 py-1 tabular-nums">{r.qualified}</td><td className="px-2 py-1 tabular-nums">{r.joined}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </section>
  );
}
