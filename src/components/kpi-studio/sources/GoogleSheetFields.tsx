import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { checkSheetCsvUrl } from "./source-form";
import { Field } from "./form-bits";

/**
 * The published CSV link for a Google Sheet. The check runs as the link is typed and applies the
 * same rules the server does, so "this is the normal share link, not the published one" is said
 * here rather than after a failed save.
 */
export function GoogleSheetFields({
  csvUrl,
  sheetTab,
  onChange,
}: {
  csvUrl: string;
  sheetTab: string;
  onChange: (patch: { csv_url?: string; sheet_tab?: string }) => void;
}) {
  const problem = csvUrl.trim() ? checkSheetCsvUrl(csvUrl) : null;

  return (
    <div className="space-y-3">
      <Field
        id="source-csv-url"
        label="Published CSV link"
        hint={
          <>
            In the sheet: File, Share, Publish to web. Choose the tab, choose "Comma-separated values
            (.csv)", then Publish and paste the link here. It must start with https://docs.google.com.
            The normal "Share" link will not work, and anyone with a published link can read the sheet.
          </>
        }
      >
        <Input
          id="source-csv-url"
          type="url"
          inputMode="url"
          value={csvUrl}
          onChange={(event) => onChange({ csv_url: event.target.value })}
          placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv"
          aria-invalid={Boolean(problem)}
          aria-describedby="source-csv-url-check source-csv-url-hint"
          className="text-xs"
        />
        <p id="source-csv-url-check" aria-live="polite" className="mt-1 min-h-4 text-[11px] leading-snug">
          {problem ? (
            <span className="flex items-start gap-1 text-rose-700">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {problem}
            </span>
          ) : csvUrl.trim() ? (
            <span className="flex items-start gap-1 text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> This looks like a published
              CSV link. Whether the sheet can actually be read is checked when a KPI is calculated.
            </span>
          ) : null}
        </p>
      </Field>

      <Field
        id="source-sheet-tab"
        label="Tab name (optional)"
        hint="Only needed when the link publishes the whole document rather than one tab."
      >
        <Input
          id="source-sheet-tab"
          value={sheetTab}
          onChange={(event) => onChange({ sheet_tab: event.target.value })}
          placeholder="Daily figures"
        />
      </Field>
    </div>
  );
}
