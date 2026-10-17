import type { ReactNode } from "react";
import { Activity, Inbox } from "lucide-react";
import type { OpsProcessRow, QualityRow } from "../../../../../../backend/src/modules/branch-head-health/ops";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, barListTable, type BarListProps } from "../viz";
import { formatPct } from "../format";
import { BhCard, SectionShell } from "../ui";
import { SectionError } from "../SectionPanels";
import { CallmasterBlock } from "./CallmasterBlock";
import { OpsHeatGrid, opsTable } from "./OpsHeatGrid";
import { selectByName, type VisualProps } from "./shared";

export { heatTint, opsTable, OpsHeatGrid } from "./OpsHeatGrid";
export { DataHealthChips } from "./DataHealthChips";

const TITLE = "Operations and quality";

/** ok + non-empty array -> rows; error -> inline error; otherwise the empty text. Undefined renders nothing. */
function Part<T>({ name, section, emptyText, children }: { name: string; section?: SectionResult<unknown>; emptyText: string; children: (rows: T[]) => ReactNode }) {
  if (!section) return null;
  if (section.status === "error") return <SectionError name={name} message={section.message} />;
  if (!Array.isArray(section.data) || section.data.length === 0) {
    return <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{emptyText}</p>;
  }
  return <>{children(section.data as T[])}</>;
}

export function qualityBars(rows: QualityRow[]): BarListProps {
  return {
    label: "Lowest QA quality processes, lowest first",
    format: formatPct,
    max: 100,
    items: rows.map((r, i) => ({
      // A missing score stays missing: NaN draws no bar and formats as "—" (never a fake 0).
      id: `r${i}`, label: r.processName, value: typeof r.QA_QUALITY_PCT === "number" ? r.QA_QUALITY_PCT : Number.NaN,
      note: r.stale ? `Stale, latest ${r.latestDate ?? "—"}` : `Latest ${r.latestDate ?? "—"}`,
    })),
  };
}

export function OpsQualityVisual(props: VisualProps) {
  const { operations, quality, callmaster } = props.overview;
  if (!operations && !quality && !callmaster) return <SectionShell icon={Activity} tone="teal" title={TITLE} section={undefined} emptyText="">{() => null}</SectionShell>;
  const pick = selectByName(props, "ops");
  return (
    <div className="space-y-4">
      <h2 className="sr-only">{TITLE}</h2>
      {operations ? (
        <BhCard title="Operations by process" tone="teal" subtitle={operations.status === "ok" ? `As of ${operations.asOf}` : undefined}>
          <Part<OpsProcessRow> name="Operations" section={operations} emptyText="No operational metrics for this branch">
            {(rows) => (
              <ChartFrame title="Latest metrics per process" subtitle="Shade = size within each column, not good or bad" table={opsTable(rows)} height={120}>
                <OpsHeatGrid rows={rows} onSelectProcess={pick} />
              </ChartFrame>
            )}
          </Part>
        </BhCard>
      ) : null}
      {quality ? (
        <BhCard title="Lowest quality processes" tone="violet">
          <Part<QualityRow> name="Lowest quality processes" section={quality} emptyText="No quality scores for this branch">
            {(rows) => {
              const bars = qualityBars(rows);
              return (
                <ChartFrame title="QA quality by process" subtitle={`QA quality %, lowest first${quality?.status === "ok" ? ` · As of ${quality.asOf}` : ""}`} table={barListTable(bars)} height={96}>
                  <BarList {...bars} />
                </ChartFrame>
              );
            }}
          </Part>
        </BhCard>
      ) : null}
      {callmaster ? (
        <BhCard title="Callmaster" tone="cyan" subtitle={callmaster.status === "ok" ? `As of ${callmaster.asOf}` : undefined}>
          <CallmasterBlock section={callmaster} />
        </BhCard>
      ) : null}
    </div>
  );
}
