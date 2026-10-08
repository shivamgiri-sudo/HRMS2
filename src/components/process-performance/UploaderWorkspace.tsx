import { useEffect, useState } from "react";
import { History, Download } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { TONE_SOLID_CLASSES, type Tone } from "@/lib/processPerformanceTones";
import { BellavitaMasmisUploader } from "./BellavitaMasmisUploader";
import type { UploaderHubItem } from "./UploaderHub";

/**
 * Data Uploader workspace (Company → Uploader → one data type). Renders a
 * tab bar across every data type this company has, so switching between
 * e.g. Sale Data / APR Data / Chat Data / Cart Data doesn't require going
 * back to the hub grid. Each tab mounts BellavitaMasmisUploader keyed by
 * its templateCode, so switching tabs cleanly resets that tab's own
 * file/log state rather than leaking one type's staged file into another.
 */
export function UploaderWorkspace({
  companyLabel, uploaders, initialCode, tone,
}: {
  companyLabel: string;
  uploaders: UploaderHubItem[];
  initialCode: string;
  tone: Tone;
}) {
  const [activeCode, setActiveCode] = useState(initialCode);
  const active = uploaders.find((u) => u.code === activeCode) ?? uploaders[0];
  const duCountry = activeCode === "DU_CDR_THAILAND" ? "thailand" : activeCode === "DU_CDR_KOREA" ? "korea" : null;
  const [autoJobId, setAutoJobId] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  useEffect(() => {
    if (!autoJobId) return;
    const timer = setInterval(async () => {
      try {
        const res = await hrmsApi.get<{ success: boolean; data: { status: string; message: string; rows?: number } }>(
          `/api/process-performance/du-digital/auto-cdr/jobs/${autoJobId}`,
        );
        const job = res.data;
        if (job.status === "running") return;
        clearInterval(timer);
        setAutoBusy(false);
        setAutoJobId(null);
        setAutoMessage(job.status === "success" ? `Imported ${job.rows ?? ""} row(s). ${job.message}` : `Failed: ${job.message}`);
      } catch {
        clearInterval(timer);
        setAutoBusy(false);
        setAutoJobId(null);
        setAutoMessage("Could not read the job status. Check the server.");
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [autoJobId]);

  async function startAutoImport() {
    if (!duCountry) return;
    setAutoBusy(true);
    setAutoMessage("Downloading today's report and importing... this can take several minutes.");
    try {
      const res = await hrmsApi.post<{ success: boolean; data: { jobId: string } }>(
        `/api/process-performance/du-digital/${duCountry}/auto-cdr`,
        { date: new Date().toISOString().slice(0, 10) },
      );
      setAutoJobId(res.data.jobId);
    } catch {
      setAutoBusy(false);
      setAutoMessage("Could not start the job. Check that you have access and the server is running.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Data Uploader</h1>
          <p className="text-xs text-slate-500">
            Upload your file for {companyLabel} process. Supported formats: Excel, CSV.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            document.getElementById(`recent-uploads-${activeCode}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="flex items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <History className="h-3.5 w-3.5" /> View Upload History
        </button>
      </div>
      {duCountry && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-600">
            {autoMessage ?? "Download today's CDR from the dialer and import it automatically."}
          </div>
          <button
            type="button"
            onClick={startAutoImport}
            disabled={autoBusy}
            className="flex items-center gap-1.5 self-start rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> {autoBusy ? "Running..." : "Auto download & import"}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {uploaders.map((u) => (
          <button
            key={u.code}
            type="button"
            onClick={() => setActiveCode(u.code)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
              u.code === activeCode ? `${TONE_SOLID_CLASSES[tone]} shadow-sm` : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <u.icon className="h-3.5 w-3.5" />
            {u.label}
          </button>
        ))}
      </div>

      {active && <BellavitaMasmisUploader key={active.code} templateCode={active.code} label={active.label} tone={tone} />}
    </div>
  );
}
