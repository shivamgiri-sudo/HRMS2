import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Downloads a file that is going to be imported into Tally.
 *
 * The server locks every voucher the moment it is pulled out, so asking for the same vouchers
 * again is refused (importing them twice would duplicate them in Tally). When that happens the
 * person is told why and, if they are a finance head, can type a reason and pull them again — the
 * server checks the role and the reason and audits it.
 */
export type TallyDownloadResult = "downloaded" | "cancelled";

function parseError(raw: string): { code?: string; message: string } {
  try {
    const j = JSON.parse(raw);
    return { code: j.code, message: j.error || j.message || raw };
  } catch {
    return { message: raw };
  }
}

export async function downloadTallyFile(path: string, filename: string): Promise<TallyDownloadResult> {
  const withParams = (extra: string) => `${path}${path.includes("?") ? "&" : "?"}${extra}`;
  let blob: Blob;
  try {
    blob = await hrmsApi.getBlob(path);
  } catch (error) {
    const { code, message } = parseError(error instanceof Error ? error.message : String(error));
    const locked = code === "ALL_LOCKED" || code === "TALLY_EXPORT_LOCKED" || /already pulled out/i.test(message);
    if (!locked) throw new Error(message);
    const reason = window.prompt(`${message}\n\nFinance head only: type a reason (at least 10 characters) to export them again, or press Cancel.`);
    if (!reason) return "cancelled";
    try {
      blob = await hrmsApi.getBlob(withParams(`reexport=true&reason=${encodeURIComponent(reason)}`));
    } catch (retry) {
      throw new Error(parseError(retry instanceof Error ? retry.message : String(retry)).message);
    }
    filename = filename.replace(/(\.[a-z]+)$/i, "-REEXPORT$1");
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
