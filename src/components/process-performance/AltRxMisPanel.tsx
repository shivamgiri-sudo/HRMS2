import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthToken, hrmsApi } from "@/lib/hrmsApi";
import { apiUrl } from "@/lib/apiBase";
import { DateRangeInputs, errorMessage } from "./AltRxShared";

/**
 * ALT RX MIS page: export only. The workbook is built from the saved Dump (db_masmis.altdump),
 * for the chosen created-day range. The range defaults to the whole Dump.
 */

const MIS_SHEETS = ["Dashboard", "Agent Wise", "Sheet1", "Brand Wise", "Dump"] as const;

export function AltRxMisPanel() {
  const [busy, setBusy] = useState<"load" | "export" | null>(null);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [available, setAvailable] = useState<{ from: string | null; to: string | null } | null>(null);

  // Read the Dump's first and last day, so the range inputs start on the full span.
  useEffect(() => {
    let cancelled = false;
    setBusy("load");
    hrmsApi.get<{
      available: { from: string | null; to: string | null } | null;
      selected: { from: string | null; to: string | null } | null;
    }>("/api/process-performance/alt-rx/data")
      .then((res) => {
        if (cancelled || !res.available) return;
        setAvailable(res.available);
        // Starts on the current month (or the whole Dump when this month has no tickets).
        setFrom(res.selected?.from ?? res.available.from ?? "");
        setTo(res.selected?.to ?? res.available.to ?? "");
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "The Dump could not be read."); })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, []);

  const exportMis = async () => {
    setBusy("export");
    setError("");
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await fetch(apiUrl(`/api/process-performance/alt-rx/mis-export${suffix}`), {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "The MIS could not be created."));
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "AltRx Dashboard.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The MIS could not be created.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <div>
              <p className="text-sm font-bold text-slate-800">AltRx Dashboard MIS</p>
              <p className="text-xs text-slate-500">Built from the latest uploaded ALT RX Dump, for the selected date range.</p>
            </div>
          </div>
          <Button onClick={() => void exportMis()} disabled={busy !== null || !available}>
            {busy === "export" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Export MIS
          </Button>
        </div>

        <div className="mt-4">
          <DateRangeInputs
            from={from}
            to={to}
            min={available?.from ?? undefined}
            max={available?.to ?? undefined}
            onFrom={setFrom}
            onTo={setTo}
            onReset={() => { setFrom(available?.from ?? ""); setTo(available?.to ?? ""); }}
          />
        </div>
        <p className="mt-3 text-xs text-slate-500">The workbook contains: {MIS_SHEETS.join(", ")}.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
