import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Download, FileCode2, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { money } from "@/components/finance/grn/grn-format";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";
import {
  GrnAlert, GrnCard, GrnCardHeader, GrnMetric, GrnSelect,
} from "@/components/finance/grn/grn-ui";

/**
 * Tally import test export — the screen onto GET /api/finance/grn-tally/download.
 *
 * Only GRNs raised in HRMS that already carry a GRN number (Finance Head approved or later), never
 * drafts or pending GRNs, never rows migrated from the legacy db_bill system. Excel and CSV are the
 * legacy JrnlP import sheet (one row per ledger line, TDS and cost centre included); the XML is the
 * same voucher the Tally connector feed sends; "Check sheet" lists every GRN with its TDS basis and
 * the reason any was left out. The month is the posting month (approved in), as in the legacy file.
 *
 * A download here marks nothing as exported, so it cannot keep a GRN out of the connector feed.
 */

type Format = "xml" | "xlsx" | "csv" | "check";

type Summary = {
  grns: number;
  inXml: number;
  exceptions: number;
  alreadySentToTally: number;
  grossInXml: number;
  tdsInXml?: number;
  truncated: boolean;
  maxRows: number;
};

const FORMATS: { format: Format; label: string; icon: typeof FileCode2 }[] = [
  { format: "xml", label: "Tally XML", icon: FileCode2 },
  { format: "xlsx", label: "Excel (Tally import)", icon: FileSpreadsheet },
  { format: "csv", label: "CSV", icon: FileText },
  { format: "check", label: "Check sheet", icon: ClipboardCheck },
];

const PICKER_CLASS =
  "rounded-[8px] border border-grn-line bg-grn-card px-[10px] text-grn-ink h-[34px] text-[12.5px] focus:border-grn-brand focus:outline-none focus:ring-2 focus:ring-grn-brand/15";

export function GrnTallyDownloadPanel() {
  const { toast } = useToast();
  const [month, setMonth] = useState("");
  const [branchId, setBranchId] = useState("");
  const [grnType, setGrnType] = useState<"vendor" | "imprest" | "all">("vendor");
  const [busy, setBusy] = useState<Format | null>(null);

  const query = () => {
    const params = new URLSearchParams();
    if (month) params.set("month", month);
    if (branchId) params.set("branchId", branchId);
    params.set("grnType", grnType);
    return params;
  };

  const branches = useQuery({
    queryKey: ["org-branches"],
    queryFn: async () => {
      const response = await hrmsApi.get<any>("/api/org/branches?limit=200");
      return ((response as any)?.data?.data ?? (response as any)?.data ?? []) as Array<{
        id: string; branch_name: string;
      }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const summary = useQuery({
    queryKey: ["grn-tally-download-summary", month, branchId, grnType],
    queryFn: async () => {
      const response = await hrmsApi.get<any>(`/api/finance/grn-tally/download/summary?${query()}`);
      return ((response as any)?.data ?? response) as Summary;
    },
  });

  const download = async (format: Format) => {
    setBusy(format);
    try {
      const params = query();
      params.set("format", format);
      const blob = await hrmsApi.getBlob(`/api/finance/grn-tally/download?${params}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `GRN_Tally_${format === "check" ? "Check_" : ""}${month || "all-months"}_${new Date().toISOString().slice(0, 10)}.${format === "check" ? "xlsx" : format}`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: a.download });
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      try { message = JSON.parse(message).error ?? message; } catch { /* plain text */ }
      toast({ title: "Download failed", description: message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const s = summary.data;
  return (
    <GrnCard className="mb-4">
      <GrnCardHeader
        title="Tally Import Test Export"
        description="HRMS GRNs with a GRN number only (Finance Head approved onwards). No drafts, no legacy db_bill rows. Downloading marks nothing as exported."
      />
      <div className="flex flex-wrap items-end gap-2 border-b border-grn-line px-4 py-3">
        <label className="text-[11px] font-semibold text-grn-ink">
          Posting month (approved in)
          <MonthYearPicker
            value={month}
            onChange={setMonth}
            emptyLabel="All months"
            className="mt-1 w-[240px]"
            selectClassName={PICKER_CLASS}
          />
        </label>
        <label className="text-[11px] font-semibold text-grn-ink">
          Branch
          <GrnSelect className="mt-1 block w-[220px]" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All my branches</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.branch_name}</option>
            ))}
          </GrnSelect>
        </label>
        <label className="text-[11px] font-semibold text-grn-ink">
          GRN type
          <GrnSelect className="mt-1 block w-[200px]" value={grnType} onChange={(e) => setGrnType(e.target.value as typeof grnType)}>
            <option value="vendor">Vendor (JrnlP, as legacy)</option>
            <option value="imprest">Imprest (JRNLIMP)</option>
            <option value="all">All</option>
          </GrnSelect>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {FORMATS.map(({ format, label, icon: Icon }) => (
            <Button
              key={format}
              size="sm"
              variant="outline"
              disabled={busy !== null || !s?.grns}
              onClick={() => download(format)}
            >
              {busy === format ? <Download className="mr-1.5 h-3.5 w-3.5 animate-pulse" /> : <Icon className="mr-1.5 h-3.5 w-3.5" />}
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-3 p-4">
        {summary.isError ? (
          <GrnAlert tone="crit">Could not count the GRNs: {(summary.error as Error)?.message}</GrnAlert>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-grn-line-soft sm:grid-cols-3 lg:grid-cols-5">
            <GrnMetric label="Numbered HRMS GRNs" value={summary.isLoading ? "…" : s?.grns ?? 0} />
            <GrnMetric label="In Tally XML" value={summary.isLoading ? "…" : s?.inXml ?? 0} tone="ok" />
            <GrnMetric label="Left out of XML" value={summary.isLoading ? "…" : s?.exceptions ?? 0} tone={s?.exceptions ? "warn" : undefined} />
            <GrnMetric label="Gross / TDS" value={summary.isLoading ? "…" : `${money(s?.grossInXml ?? 0)} / ${money(s?.tdsInXml ?? 0)}`} />
            <GrnMetric label="Already sent by connector" value={summary.isLoading ? "…" : s?.alreadySentToTally ?? 0} tone="info" />
          </div>
        )}
        {!!s?.exceptions && (
          <GrnAlert tone="warn">
            {s.exceptions} GRN{s.exceptions === 1 ? " is" : "s are"} left out of the import (already sent by the legacy system, missing
            sub-head, branch GST state, imprest holder ledger or TDS ledger, or amounts that don't add up). The Check sheet gives the reason for each.
          </GrnAlert>
        )}
        {s?.truncated && (
          <GrnAlert tone="warn">Only the first {s.maxRows} GRNs are included. Pick a month to get the rest.</GrnAlert>
        )}
      </div>
    </GrnCard>
  );
}
