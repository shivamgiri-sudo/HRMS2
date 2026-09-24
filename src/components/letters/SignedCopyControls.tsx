/**
 * The two copies of an issued appointment letter, and the controls that pick
 * between them.
 *
 *  - "original"  the company-signed letter HR issued.
 *  - "accepted"  the copy the employee signed with Aadhaar eSign.
 *
 * Kept out of NativeAppointmentLetterQueue.tsx so the row buttons, the drawer
 * toggle and the accepted-copy summary can be rendered and pinned on their own.
 */
import { Download, FileCheck2 } from "lucide-react";

export type LetterCopy = "accepted" | "original";

export type SignedCopyRow = {
  letter_number: string;
  has_accepted_copy?: boolean;
  accepted_copy_sha256?: string | null;
  employee_esign_at?: string | null;
};

const BTN =
  "inline-flex min-h-[44px] items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold transition-colors";

/** DD/MM/YYYY HH:mm, 24-hour, as the drill-down mandate asks. */
export function formatAcceptedAt(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).replace(",", "");
}

/** First 12 hex characters of the stored file's sha256. */
export const shortHash = (sha256: string | null | undefined): string =>
  sha256 ? String(sha256).slice(0, 12) : "";

/**
 * Row download buttons. A letter with an employee-signed copy leads with it and
 * keeps the company-signed original as a secondary action; a letter without one
 * keeps the single "PDF" button it always had.
 */
export function IssuedDownloadButtons({
  row, onDownload,
}: { row: SignedCopyRow; onDownload: (copy: LetterCopy) => void }) {
  if (!row.has_accepted_copy) {
    return (
      <button type="button" onClick={() => onDownload("original")}
        className={`${BTN} border-blue-300 text-blue-700 hover:bg-blue-50`}>
        <Download className="h-4 w-4" /> PDF
      </button>
    );
  }
  return (
    <>
      <button type="button" onClick={() => onDownload("accepted")}
        title="The copy the employee signed with Aadhaar eSign"
        className={`${BTN} border-emerald-300 text-emerald-700 hover:bg-emerald-50`}>
        <FileCheck2 className="h-4 w-4" /> Signed copy
      </button>
      <button type="button" onClick={() => onDownload("original")}
        title="The company-signed letter, before the employee signed"
        className={`${BTN} border-slate-300 text-slate-700 hover:bg-slate-50`}>
        <Download className="h-4 w-4" /> Original
      </button>
    </>
  );
}

const TOGGLE_LABEL: Record<LetterCopy, string> = {
  accepted: "Employee-signed copy",
  original: "Company-signed original",
};

/** Segmented control shown in the drawer when both copies exist. */
export function LetterCopyToggle({
  value, onChange,
}: { value: LetterCopy; onChange: (copy: LetterCopy) => void }) {
  return (
    <div role="group" aria-label="Which copy of the letter to show"
      className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
      {(["accepted", "original"] as const).map((copy) => (
        <button key={copy} type="button" aria-pressed={value === copy} onClick={() => onChange(copy)}
          className={`min-h-[36px] rounded-[10px] px-3 text-xs font-semibold transition-colors ${
            value === copy ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}>
          {TOGGLE_LABEL[copy]}
        </button>
      ))}
    </div>
  );
}

/** Accepted timestamp and short hash, under the toggle. Renders nothing without a signed copy. */
export function AcceptedCopySummary({ row }: { row: SignedCopyRow }) {
  if (!row.has_accepted_copy) return null;
  const at = formatAcceptedAt(row.employee_esign_at);
  const hash = shortHash(row.accepted_copy_sha256);
  return (
    <p className="text-xs text-slate-500">
      {at ? <>Signed by employee {at}</> : <>Signed by employee</>}
      {hash ? <> · SHA-256 <span className="font-mono text-slate-700">{hash}</span></> : null}
    </p>
  );
}
