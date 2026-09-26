import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { TONE_CLASSES, TONE_SOLID_CLASSES, TONE_GRADIENT_CLASSES, type Tone } from "@/lib/processPerformanceTones";
import { ChevronRight, BarChart3, FileText, Users, Lightbulb, ExternalLink } from "lucide-react";
import { UploadCoverageLine, useUploadCoverage } from "./UploadCoverage";

export interface UploaderHubItem {
  code: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Per-company uploader landing screen (Company → Uploader). Reused by every
 * company on this page instead of a duplicated grid block per company, so
 * this one design applies everywhere at once. Does NOT touch the separate
 * Company → Dashboards path (including the Inbound tabs) — this is only
 * what renders once "Uploader" is picked.
 */
export function UploaderHub({
  companyLabel, companyIcon: CompanyIcon, tone, uploaders, typeCodes, onSelect,
}: {
  companyLabel: string;
  companyIcon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  uploaders: UploaderHubItem[];
  typeCodes: string[];
  onSelect: (item: { code: string; label: string }) => void;
}) {
  const [stats, setStats] = useState({ totalFilesUploaded: 0, activeUsers: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const coverageQ = useUploadCoverage(uploaders.map((u) => u.code));

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    hrmsApi
      .get<{ success: boolean; data: { totalFilesUploaded: number; activeUsers: number } }>(
        `/api/bulk-upload/process-performance-v2-stats?codes=${encodeURIComponent(typeCodes.join(","))}`,
      )
      .then((res) => { if (!cancelled) setStats(res.data); })
      .catch(() => { /* leave zeros — stat badges show 0 rather than block the page */ })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeCodes.join(",")]);

  return (
    <div className="space-y-4">
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 sm:p-6 ${TONE_GRADIENT_CLASSES[tone]}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${TONE_SOLID_CLASSES[tone]}`}>
              <CompanyIcon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">{companyLabel}</h1>
              <p className="mt-0.5 max-w-md text-sm text-slate-600">
                Manage {companyLabel} data, upload files and view performance insights.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <MiniStat icon={BarChart3} label="Data Modules" value={uploaders.length} />
            <MiniStat icon={FileText} label="Files Uploaded" value={stats.totalFilesUploaded} loading={statsLoading} />
            <MiniStat icon={Users} label="Active Users" value={stats.activeUsers} loading={statsLoading} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {uploaders.map((u) => (
          <button
            key={u.code}
            type="button"
            onClick={() => onSelect({ code: u.code, label: u.label })}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
          >
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${TONE_CLASSES[tone]}`}>
                <u.icon className="h-4.5 w-4.5" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{u.label}</span>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                    Upload
                  </span>
                </div>
                <div className="text-xs text-slate-500">{u.description}</div>
                <div className="mt-0.5"><UploadCoverageLine coverage={coverageQ.data?.[u.code]} loading={coverageQ.isLoading} /></div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
          </button>
        ))}
      </div>

      <div className="flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
            <Lightbulb className="h-4.5 w-4.5" />
          </span>
          <div>
            <div className="text-sm font-bold text-slate-900">Need Help?</div>
            <div className="text-xs text-slate-500">Check the process documentation or contact the MIS team.</div>
          </div>
        </div>
        <Link
          to="/bulk-upload"
          className="flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
        >
          View Documentation <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon, label, value, loading,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; loading?: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 shadow-sm backdrop-blur">
      <Icon className="h-4 w-4 text-slate-500" />
      <div>
        <div className="text-sm font-bold leading-tight text-slate-900">{loading ? "—" : value.toLocaleString()}</div>
        <div className="text-[10px] leading-tight text-slate-500">{label}</div>
      </div>
    </div>
  );
}
