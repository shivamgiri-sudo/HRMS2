import { useState } from "react";
import { History } from "lucide-react";
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
