import type { BacklogsData, SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionShell, Table, Td } from "./ui";

export function BacklogPanel({ section }: { section?: SectionResult<BacklogsData> }) {
  return (
    <SectionShell<BacklogsData> title="Backlogs" section={section} emptyText="No backlog data for this branch">
      {(d) => (
        <Table caption="Pending requests by age" cols={[{ label: "Request" }, { label: "Pending", right: true }, { label: "Oldest (days)", right: true }, { label: "Over 3 days", right: true }, { label: "Over 7 days", right: true }, { label: "Other", right: true }]}>
          <tr><Td strong>Regularization</Td><Td right>{d.regularization.pending}</Td><Td right>{d.regularization.oldestDays}</Td><Td right>{d.regularization.over3Days}</Td><Td right>{d.regularization.over7Days}</Td><Td right>Escalated {d.regularization.escalated}</Td></tr>
          <tr><Td strong>Leave</Td><Td right>{d.leaveAging.pending}</Td><Td right>{d.leaveAging.oldestDays}</Td><Td right>{d.leaveAging.over3Days}</Td><Td right>{d.leaveAging.over7Days}</Td><Td right>Stale {d.leaveAging.staleOlderThanWindow}</Td></tr>
        </Table>
      )}
    </SectionShell>
  );
}
