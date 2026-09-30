import { useQuery } from "@tanstack/react-query";
import { DrawerSection } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { hrmsApi } from "@/lib/hrmsApi";
import { CaseStatus } from "./InterventionTable";
import { OWNER_LABEL, TIER_LABEL, TIER_TONE, adaptCase, fmtDate, topRecommendation, type Bucket, type CaseApiRow, type CaseRow } from "./calc";

export interface Segment { title: string; bucket: Bucket; tier?: string; owner?: string; weekStart?: string; scope: string }

/** Lists the cases behind a KPI tile / chart segment; a row opens that case's own drawer. */
export function SegmentBody({ segment, onOpen }: { segment: Segment; onOpen: (r: CaseRow) => void }) {
  const q = useQuery({
    queryKey: ["interventions", "segment", segment],
    queryFn: async () => {
      const p = new URLSearchParams(segment.scope);
      p.set("bucket", segment.bucket);
      p.set("limit", "200");
      if (segment.tier) p.set("tier", segment.tier);
      if (segment.owner) p.set("owner", segment.owner);
      if (segment.weekStart) p.set("weekStart", segment.weekStart);
      const raw = await hrmsApi.get<{ data?: CaseApiRow[] }>(`/api/analytics/intervention-recommendations/cases?${p}`);
      return (raw?.data ?? []).map(adaptCase);
    },
    staleTime: 30_000,
  });
  if (q.isLoading) return <div className="h-32 animate-pulse rounded-md bg-slate-100" role="status" aria-label="Loading cases" />;
  if (q.isError) return <p className="text-sm text-red-700" role="alert">Could not load these cases.</p>;
  const rows = q.data ?? [];
  return (
    <DrawerSection label={`${rows.length} case${rows.length === 1 ? "" : "s"}${rows.length === 200 ? " (first 200)" : ""}`}>
      {rows.length ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((r) => {
            const top = topRecommendation(r.recommendations);
            return (
              <li key={r.id}>
                <button type="button" onClick={() => onOpen(r)} className="flex min-h-[44px] w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{r.employeeName || "—"} <span className="font-normal text-slate-600">{r.employeeCode}</span></span>
                    <span className="block truncate text-xs text-slate-600">{[r.processName, top ? OWNER_LABEL[top.owner] : null, fmtDate(r.generatedAt)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusPill tone={TIER_TONE[r.riskTier]}>{TIER_LABEL[r.riskTier]}</StatusPill>
                    <CaseStatus row={r} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </DrawerSection>
  );
}
