import type { ColumnSpec } from "./report-column-plan.js";

/** The roster sheet whatever it is called: matched by name, synonym or near-match, in any column order. The dialer id is the identity. */
export const SBI_ROSTER_COLUMNS: ColumnSpec[] = [
  { canonical: "DIALER ID", aliases: ["Dialer Id", "Agent ID", "Dialer Code", "Dial ID", "User ID", "Dialer No", "Agent Dialer ID"], required: true },
  { canonical: "Employee ID", aliases: ["Emp ID", "Employee Code", "Emp Code", "Staff ID", "Employee No"] },
  { canonical: "Name", aliases: ["Agent Name", "Employee Name", "Staff Name", "Full Name"], kind: "name" },
  { canonical: "GH", aliases: ["Group Head", "Group Head ID", "GH ID"] },
  { canonical: "TEAM", aliases: ["Team Name", "Process", "Segment", "Pool", "Portfolio"] },
  { canonical: "TEAM LEADER", aliases: ["Team Lead", "TL", "TL Name", "Supervisor", "Team Leader Name", "Reporting To"] },
  { canonical: "MODE", aliases: ["Dialing Mode", "Dialer Mode", "Login Mode"] },
];
