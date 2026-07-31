import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2, Clock, FileX2, Download, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The employee's salary TDS certificate for a financial year.
 *
 * A certificate has two parts and only one is produced here. Part B — salary,
 * deductions, tax computed — comes from payroll. Part A — tax deposited,
 * challan and BSR codes, TRACES verification — is issued by TRACES from the
 * quarterly return and uploaded by payroll.
 *
 * This card exists so the employee is told which half they have. Showing Part B
 * alone with no explanation invites someone to file a return without the part
 * that proves the tax was actually deposited.
 */

interface PartAStatus {
  financialYear: number;
  expectedFormNumber: string;
  present: boolean;
  verified: boolean;
  certificateNumber: string | null;
  coversQuarters: string | null;
  status: "verified" | "awaiting_verification" | "not_uploaded";
  message: string;
}

/** FY starting year for a date — Jan–Mar belong to the FY that began last April. */
function currentFinancialYearStart(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

const fyLabel = (start: number) => `FY ${start}–${String(start + 1).slice(2)}`;

export function TaxCertificateCard({ employeeId }: { employeeId: string }) {
  const thisFy = currentFinancialYearStart();
  // The certificate for a year only exists after it ends, so the previous year
  // is the one an employee is usually looking for.
  const [financialYear, setFinancialYear] = useState(thisFy - 1);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const { data, isLoading, isError } = useQuery<PartAStatus | null>({
    queryKey: ["tds-part-a", employeeId, financialYear],
    enabled: !!employeeId,
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PartAStatus }>(
        `/api/payroll/tds-certificate/part-a/${employeeId}/${financialYear}`,
      );
      return res.data ?? null;
    },
  });

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError("");
    try {
      // A short-lived token rather than a durable link: the file route consumes
      // it, logs the access and expires it, which a plain URL would not.
      const res = await hrmsApi.post<{ success: boolean; data: { download_url: string } }>(
        `/api/payroll/tds-certificate/part-a/${employeeId}/${financialYear}/download-token`,
      );
      const url = res.data?.download_url;
      if (!url) throw new Error("No download link was issued.");
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setDownloadError((err as Error).message || "Could not open the certificate.");
    } finally {
      setDownloading(false);
    }
  };

  const years = [thisFy, thisFy - 1, thisFy - 2, thisFy - 3];
  const formName = data ? `Form ${data.expectedFormNumber}` : "Form 16";

  return (
    <div className="rounded-3xl border-2 border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-slate-500">
            <FileCheck2 className="size-4" />
            Tax Certificate
          </div>
          <p className="mt-1 text-lg font-black text-slate-950">
            {formName} · {fyLabel(financialYear)}
          </p>
        </div>
        <select
          className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700"
          value={financialYear}
          onChange={(e) => setFinancialYear(Number(e.target.value))}
          aria-label="Financial year"
        >
          {years.map((y) => (
            <option key={y} value={y}>{fyLabel(y)}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Checking…
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm text-rose-700">Could not load your certificate status.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {/* Part B is always available — it is computed from payroll. */}
          <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-3">
            <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
            <div>
              <p className="text-sm font-bold text-emerald-900">Part B — ready</p>
              <p className="text-xs text-emerald-800">
                Salary, deductions and tax computed, from this year&apos;s actual payroll.
              </p>
            </div>
          </div>

          {data?.status === "verified" ? (
            <div className="flex items-start gap-3 rounded-2xl bg-emerald-50 p-3">
              <FileCheck2 className="mt-0.5 size-4 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-900">Part A — ready</p>
                <p className="text-xs text-emerald-800">
                  Issued by TRACES{data.certificateNumber ? ` · ${data.certificateNumber}` : ""}
                  {data.coversQuarters ? ` · ${data.coversQuarters}` : ""}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-3">
              {data?.status === "awaiting_verification"
                ? <Clock className="mt-0.5 size-4 shrink-0 text-amber-700" />
                : <FileX2 className="mt-0.5 size-4 shrink-0 text-amber-700" />}
              <div>
                <p className="text-sm font-bold text-amber-900">Part A — pending</p>
                <p className="text-xs text-amber-800">{data?.message}</p>
              </div>
            </div>
          )}

          {/* Stated plainly: filing with half a certificate is the mistake this
              card exists to prevent. */}
          {data?.status !== "verified" && (
            <p className="text-xs text-slate-500">
              You need both parts to file your return. Part A proves the tax was deposited and
              can only come from TRACES, after the quarterly returns for the year are filed.
            </p>
          )}

          {data?.status === "verified" && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {downloading ? "Preparing…" : `Download ${formName} Part A`}
            </button>
          )}

          {downloadError && (
            <p className="text-xs font-semibold text-rose-700">{downloadError}</p>
          )}
        </div>
      )}
    </div>
  );
}
