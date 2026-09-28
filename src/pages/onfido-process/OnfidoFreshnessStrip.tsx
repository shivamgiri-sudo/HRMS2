import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

interface FreshnessRow {
  key: string;
  label: string;
  latestDate: string | null;
  gapMonths: string[];
}

/** A source this many days (or more) behind today is flagged, so users do not act on stale numbers. */
const STALE_AFTER_DAYS = 3;
const MS_PER_DAY = 86_400_000;

function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(ym: string): string {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym}-${ym.slice(2, 4)}`;
}

function daysBehind(iso: string): number {
  return Math.floor((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * Data freshness for every source behind the dashboard. Each report file is uploaded on its own
 * schedule, so one tab can be current while another stops weeks ago - this shows which.
 */
export default function OnfidoFreshnessStrip() {
  const query = useQuery({
    queryKey: ["onfido-process", "data-freshness"],
    queryFn: () => hrmsApi.get<{ data: FreshnessRow[] }>("/api/onfido-process/data-freshness"),
    staleTime: 10 * 60 * 1000,
  });
  const rows = query.data?.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexWrap: "wrap", gap: 12 }} data-testid="onfido-freshness">
      <strong style={{ color: "var(--text)" }}>Data available up to:</strong>
      {rows.map((r) => {
        const stale = r.latestDate === null || daysBehind(r.latestDate) >= STALE_AFTER_DAYS || r.gapMonths.length > 0;
        return (
          <span key={r.key} title={r.latestDate ? `${r.label}: latest day ${r.latestDate}` : `${r.label}: no data`} style={{ color: stale ? "var(--orange, #b45309)" : undefined }}>
            {r.label} {r.latestDate ? ddmm(r.latestDate) : "no data"}
            {stale && r.latestDate ? " (behind)" : ""}
            {r.gapMonths.length > 0 ? ` - no data for ${r.gapMonths.map(monthLabel).join(", ")}` : ""}
          </span>
        );
      })}
    </div>
  );
}
