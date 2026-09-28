import { useState } from "react";
import { Download } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface OnfidoDownloadButtonProps {
  /** API path of a CSV endpoint, e.g. /api/onfido-process/records/ONFIDO_DOC_RAW/export.csv */
  path: string;
  /** The tab's active filters (from/to/tlName/amName...) - the file always matches what is on screen. */
  params: Record<string, string | undefined>;
  filename: string;
  label?: string;
}

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

/** Downloads a server-generated CSV through the authenticated API client (a plain link would carry no token). */
export function OnfidoDownloadButton({ path, params, filename, label = "Download CSV" }: OnfidoDownloadButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const blob = await hrmsApi.getBlob(withQuery(path, params));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button type="button" className="oc-btn-ghost" onClick={download} disabled={busy} aria-busy={busy}>
        <Download className="h-3.5 w-3.5" /> {busy ? "Preparing..." : label}
      </button>
      {error && <span role="alert" style={{ fontSize: 11, color: "var(--red)" }}>{error}</span>}
    </span>
  );
}
