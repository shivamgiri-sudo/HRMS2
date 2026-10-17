import type { ReactNode } from "react";
import { Activity } from "lucide-react";
import type { OpsProcessRow, QualityRow } from "../../../../../../backend/src/modules/branch-head-health/ops";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import { SectionShell } from "../ui";
import { SectionError } from "../SectionPanels";
import { AccentCard, ChartCard, Chip, EmptyLine, type Accent } from "../look";
import { formatCount } from "../format";
import { CallmasterBlock } from "./CallmasterBlock";
import { OpsHeatGrid, opsTable } from "./OpsHeatGrid";
import { OpsKpiTiles, QualityCard, opsKpis } from "./opsParts";
import { selectByName, type VisualProps } from "./shared";

export { heatTint, opsTable, OpsHeatGrid } from "./OpsHeatGrid";
export { DataHealthChips } from "./DataHealthChips";
export { qaBand, qualityBars, qualityTable, opsKpis } from "./opsParts";

const TITLE = "Operations and quality";

/** ok + non-empty array -> rows; error -> inline error card; otherwise an empty card. Undefined renders nothing. */
function Part<T>({ title, name, accent, section, emptyText, children }: {
  title: string; name: string; accent: Accent; section?: SectionResult<unknown>; emptyText: string; children: (rows: T[]) => ReactNode;
}) {
  if (!section) return null;
  if (section.status === "error") return <AccentCard title={title} accent={accent}><SectionError name={name} message={section.message} /></AccentCard>;
  if (!Array.isArray(section.data) || section.data.length === 0) return <AccentCard title={title} accent={accent}><EmptyLine text={emptyText} /></AccentCard>;
  return <>{children(section.data as T[])}</>;
}

/** Operations tab: headline tiles, the per-process heat grid, lowest quality processes and Callmaster. */
export function OpsQualityVisual(props: VisualProps) {
  const { operations, quality, callmaster } = props.overview;
  if (!operations && !quality && !callmaster) return <SectionShell icon={Activity} tone="teal" title={TITLE} section={undefined} emptyText="">{() => null}</SectionShell>;
  const pick = selectByName(props, "ops");
  const k = opsKpis(operations, quality);
  return (
    <div className="space-y-4">
      <h2 className="sr-only">{TITLE}</h2>
      {k.total > 0 ? <OpsKpiTiles k={k} onSelect={props.onSelect} /> : null}
      <Part<OpsProcessRow> title="Operations by process" name="Operations" accent="blue" section={operations} emptyText="No operational metrics for this branch">
        {(rows) => (
          <ChartCard title="Operations by process" accent="blue" table={opsTable(rows)}
            chip={`${formatCount(rows.length)} processes${operations?.status === "ok" ? ` · As of ${operations.asOf}` : ""}`}>
            <p className="mb-2 text-[12px] text-slate-700">Latest metrics per process. Shade = size within each column, not good or bad.</p>
            <OpsHeatGrid rows={rows} onSelectProcess={pick} />
          </ChartCard>
        )}
      </Part>
      <Part<QualityRow> title="Lowest quality processes" name="Lowest quality processes" accent="violet" section={quality} emptyText="No quality scores for this branch">
        {(rows) => <QualityCard rows={rows} asOf={quality?.status === "ok" ? quality.asOf : undefined} onProcess={pick} />}
      </Part>
      {callmaster ? (
        <section aria-label="Callmaster" className="space-y-3">
          {callmaster.status === "ok" && callmaster.data ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <h3 className="text-[16px] font-extrabold text-slate-900">Callmaster</h3>
              <Chip tone="info">{`As of ${callmaster.asOf}`}</Chip>
            </div>
          ) : null}
          <CallmasterBlock section={callmaster} />
        </section>
      ) : null}
    </div>
  );
}
