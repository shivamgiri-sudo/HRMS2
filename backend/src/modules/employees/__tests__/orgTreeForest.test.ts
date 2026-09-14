import { describe, it, expect } from "vitest";
import { buildOrgForest, type OrgTreeServiceNode } from "../employee.service";

type Row = Pick<OrgTreeServiceNode, "id" | "name" | "reporting_manager_id"> & Partial<OrgTreeServiceNode>;

function row(id: string, managerId: string | null): OrgTreeServiceNode {
  return {
    id,
    employee_code: `MAS${id}`,
    name: `Person ${id}`,
    designation: null,
    process_name: null,
    branch_name: null,
    department_name: null,
    avatar_url: null,
    reporting_manager_id: managerId,
    role_key: null,
    active_status: 1,
    children: [],
  };
}

/** Every id that ended up somewhere in the rendered forest. */
function idsInForest(nodes: OrgTreeServiceNode[]): Set<string> {
  const seen = new Set<string>();
  const walk = (list: OrgTreeServiceNode[]) => {
    for (const n of list) {
      seen.add(n.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return seen;
}

describe("buildOrgForest", () => {
  it("places every employee exactly once when the data is clean", () => {
    const rows: Row[] = [row("1", null), row("2", "1"), row("3", "1"), row("4", "2")];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    expect(built.renderedCount).toBe(4);
    expect(idsInForest(built.roots)).toEqual(new Set(["1", "2", "3", "4"]));
    expect(built.dataIssues).toHaveLength(0);
  });

  it("keeps a self-reporting manager and their whole subtree in the chart", () => {
    // This is the live defect: three employees are recorded as their own manager. The
    // previous builder never made them roots (their manager was in scope) and no root could
    // reach them, so they and everyone beneath them were dropped with no error while the
    // header still counted them — 900 of 1,120 active employees.
    const rows: Row[] = [
      row("boss", "boss"),
      row("a", "boss"),
      row("b", "a"),
      row("c", "b"),
    ];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    expect(built.renderedCount).toBe(4);
    expect(idsInForest(built.roots)).toEqual(new Set(["boss", "a", "b", "c"]));
    expect(built.dataIssues).toContainEqual(
      expect.objectContaining({ type: "self_manager", employeeId: "boss" }),
    );
  });

  it("breaks a multi-node reporting cycle instead of dropping it", () => {
    const rows: Row[] = [
      row("x", "z"),
      row("y", "x"),
      row("z", "y"),
      row("leaf", "z"),
    ];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    expect(built.renderedCount).toBe(4);
    expect(idsInForest(built.roots)).toEqual(new Set(["x", "y", "z", "leaf"]));
    expect(built.dataIssues.some((i) => i.type === "cycle")).toBe(true);
  });

  it("breaks a cycle at one edge, leaving the subtree below it intact", () => {
    // The subtlety that matters on live data: 897 people sit under the three self-reporting
    // managers. Cutting the parent edge of every node whose chain merely passes through the
    // cycle would promote all 897 to roots — a 950-wide flat row, which destroys the chart
    // just as thoroughly as dropping them did.
    const rows: Row[] = [
      row("boss", "boss"),
      row("m1", "boss"),
      row("m2", "m1"),
      row("e1", "m2"),
      row("e2", "m2"),
    ];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    expect(built.roots).toHaveLength(1);
    expect(built.roots[0].id).toBe("boss");
    expect(built.roots[0].total_reports).toBe(4);
    expect(built.dataIssues).toHaveLength(1);
  });

  it("moves managerless, reportless employees into the unplaced tray", () => {
    const rows: Row[] = [row("1", null), row("2", "1"), row("orphan", null)];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    expect(built.roots.map((r) => r.id)).toEqual(["1"]);
    expect(built.unassigned.map((u) => u.id)).toEqual(["orphan"]);
    // renderedCount counts the hierarchy; the tray is reported separately so the header
    // cannot claim to be showing people it is not showing.
    expect(built.renderedCount).toBe(3);
    expect(built.dataIssues).toContainEqual(
      expect.objectContaining({ type: "missing_manager", employeeId: "orphan" }),
    );
  });

  it("keeps the viewer on the canvas even when they have no manager and no reports", () => {
    const rows: Row[] = [row("1", null), row("2", "1"), row("me", null)];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], "me");

    expect(built.roots.map((r) => r.id)).toContain("me");
    expect(built.unassigned).toHaveLength(0);
  });

  it("reports direct and total headcount for each manager", () => {
    const rows: Row[] = [row("1", null), row("2", "1"), row("3", "1"), row("4", "2"), row("5", "4")];
    const built = buildOrgForest(rows as OrgTreeServiceNode[], null);

    const top = built.roots.find((r) => r.id === "1")!;
    expect(top.direct_reports).toBe(2);
    expect(top.total_reports).toBe(4);
  });
});
