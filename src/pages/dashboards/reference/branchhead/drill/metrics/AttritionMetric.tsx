import type { AttritionData } from "../../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, DataTable, LineArea, StackedBar } from "../../viz";
import { buildAttrition } from "../../sections/AttritionVisual";
import { byLabel, selectByName } from "../../sections/shared";
import { SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

/** Attrition: risk tiers, high risk by process (chart + table) and monthly exits. Counts only, no names. */
export function AttritionMetric(props: MetricProps) {
  return (
    <SectionGate<AttritionData> name="Attrition" section={props.overview.attrition} empty="Attrition analysis is not available for this branch right now">
      {(d) => {
        const b = buildAttrition(d, props.overview.date);
        return (
          <div className="space-y-4">
            <ChartFrame title="Risk tiers" table={b.tiersTable} height={72}><StackedBar {...b.tiers} /></ChartFrame>
            <ChartFrame title="High risk by process" table={b.byProcessTable} height={96}>
              <BarList {...b.byProcess} onSelect={byLabel(b.byProcess.items, selectByName(asVisual(props), "attrition"))} />
            </ChartFrame>
            <DataTable table={b.byProcessTable} />
            <ChartFrame title="Monthly exits" subtitle="Dashed point: expected exits in the next 30 days" table={b.exitsTable} height={160}><LineArea {...b.exits} /></ChartFrame>
          </div>
        );
      }}
    </SectionGate>
  );
}
