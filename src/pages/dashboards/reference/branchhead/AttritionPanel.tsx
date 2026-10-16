import type { AttritionData, SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { formatCount, formatPct } from "./format";
import { Note, SectionShell, Stat, Stats, SubHead, Table, Td } from "./ui";

/** Counts and tables only: no person is named at branch level. */
export function AttritionPanel({ section }: { section?: SectionResult<AttritionData> }) {
  return (
    <SectionShell<AttritionData> title="Attrition and retention" section={section} emptyText="Attrition analysis is not available for this branch right now">
      {(d) => (
        <>
          <Stats label="Attrition risk">
            <Stat label="Critical risk" value={formatCount(d.critical)} />
            <Stat label="High risk" value={formatCount(d.high)} />
            <Stat label="Medium risk" value={formatCount(d.medium)} />
            <Stat label="Expected exits (30 days)" value={formatCount(d.expectedExits30)} />
            <Stat label="Absent streak" value={formatCount(d.absentStreak)} />
            <Stat label="New joiner risk" value={formatCount(d.newJoinerRisk)} />
            <Stat label="Low risk" value={formatCount(d.low)} />
            <Stat label="Exits, last 30 days" value={formatCount(d.exits30)} hint={`Previous 30 days: ${formatCount(d.exitsPrev30)}`} />
            <Stat label="Exits, last 90 days" value={formatCount(d.exits90)} />
            <Stat label="Early exit share" value={formatPct(d.earlyExitSharePct)} />
          </Stats>
          <Note>{formatCount(d.topRiskCount)} people are flagged as top risk. Names are available in the process drill-down.</Note>
          {d.calibrationNote ? <Note>{d.calibrationNote}</Note> : null}
          <SubHead>Monthly exits</SubHead>
          <Table caption="Exits per month" cols={[{ label: "Month" }, { label: "Exits", right: true }]} minWidth={240}>
            {d.monthlyExits.map((m) => <tr key={m.month}><Td>{m.month}</Td><Td right>{m.exits}</Td></tr>)}
          </Table>
          <SubHead>By process</SubHead>
          <Table caption="Attrition risk by process" cols={[{ label: "Process" }, { label: "Headcount", right: true }, { label: "High risk", right: true }, { label: "Absent streak", right: true }]}>
            {d.byProcess.map((p) => <tr key={p.process}><Td strong>{p.process}</Td><Td right>{p.headcount}</Td><Td right>{p.highRisk}</Td><Td right>{p.absentStreak}</Td></tr>)}
          </Table>
        </>
      )}
    </SectionShell>
  );
}
