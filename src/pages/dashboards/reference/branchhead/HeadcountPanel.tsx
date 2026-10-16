import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import type { PeopleData } from "./panelTypes";
import { formatCount } from "./format";
import { SectionShell, Stat, Stats, SubHead, Table, Td } from "./ui";

/** A zero or missing mandate is "no mandate", never "over". */
function vsMandate(active: number, seats: number | null): string {
  if (seats == null || seats <= 0) return "No mandate";
  return active > seats ? `Over by ${active - seats}` : `Within mandate (${seats - active} open)`;
}

export function HeadcountPanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <SectionShell<PeopleData> title="Headcount" section={section} emptyText="No headcount data for this date">
      {(d) => (
        <>
          <Stats label="Headcount movement">
            <Stat label="Active" value={formatCount(d.totalActive)} />
            <Stat label="Joined today" value={formatCount(d.joinedToday)} hint={`Month to date: ${formatCount(d.joinedMtd)}`} />
            <Stat label="Left today" value={formatCount(d.leftToday)} hint={`Month to date: ${formatCount(d.leftMtd)}`} />
            <Stat label="Mandate seats" value={formatCount(d.mandateSeatsTotal)} />
            <Stat label="Upcoming exits (30 days)" value={formatCount(d.upcomingExits)} />
            <Stat label="Exits not closed" value={formatCount(d.exitsNotClosed)} />
          </Stats>
          <SubHead>By process</SubHead>
          <Table caption="Headcount against mandate by process" cols={[{ label: "Process" }, { label: "Active", right: true }, { label: "Joined MTD", right: true }, { label: "Left MTD", right: true }, { label: "Mandate seats", right: true }, { label: "Vs mandate" }]} minWidth={560}>
            {d.byProcess.map((r) => (
              <tr key={r.process}><Td strong>{r.process}</Td><Td right>{r.active}</Td><Td right>{r.joinedMtd}</Td><Td right>{r.leftMtd}</Td><Td right>{r.mandateSeats && r.mandateSeats > 0 ? r.mandateSeats : "—"}</Td><Td>{vsMandate(r.active, r.mandateSeats)}</Td></tr>
            ))}
          </Table>
          <SubHead>By line of business</SubHead>
          <Table caption="Active headcount by line of business" cols={[{ label: "Line of business" }, { label: "Active", right: true }]} minWidth={240}>
            {d.byLob.map((r) => <tr key={r.lob}><Td strong>{r.lob}</Td><Td right>{r.active}</Td></tr>)}
          </Table>
        </>
      )}
    </SectionShell>
  );
}
