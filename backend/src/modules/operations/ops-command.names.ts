import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { NONE_ID, type OpsDimension } from "./ops-command.context.js";

export interface GroupLabel {
  name: string;
  sub: string | null;
}

const UNASSIGNED: Record<string, string> = {
  branch: "No branch",
  process: "No process",
  lob: "No LOB",
  manager: "No reporting manager",
  employee: "Unknown",
  all: "All in scope",
};

/** Display names for group ids (one indexed lookup per dimension, ids bound as parameters). */
export async function resolveNames(
  dim: OpsDimension,
  ids: string[],
): Promise<Map<string, GroupLabel>> {
  const out = new Map<string, GroupLabel>();
  for (const id of ids)
    if (id === NONE_ID)
      out.set(id, { name: UNASSIGNED[dim] ?? "Unassigned", sub: null });
  if (dim === "all") {
    out.set("all", { name: UNASSIGNED.all, sub: null });
    return out;
  }
  const real = ids.filter((i) => i !== NONE_ID);
  if (!real.length) return out;
  const marks = real.map(() => "?").join(",");
  let sql: string;
  switch (dim) {
    case "branch":
      sql = `SELECT id, branch_name AS name, branch_code AS sub FROM branch_master WHERE id IN (${marks})`;
      break;
    case "process":
      sql = `SELECT p.id, p.process_name AS name, b.branch_name AS sub
               FROM process_master p LEFT JOIN branch_master b ON b.id = p.branch_id WHERE p.id IN (${marks})`;
      break;
    case "lob":
      sql = `SELECT id, lob_name AS name, lob_code AS sub FROM lob_master WHERE id IN (${marks})`;
      break;
    default:
      sql = `SELECT e.id, e.full_name AS name,
                    CONCAT_WS(' · ', e.employee_code, p.process_name) AS sub
               FROM employees e LEFT JOIN process_master p ON p.id = e.process_id WHERE e.id IN (${marks})`;
  }
  const [rows] = await db.execute<RowDataPacket[]>(sql, real);
  for (const r of rows)
    out.set(String(r.id), {
      name: String(r.name ?? "—"),
      sub: r.sub ? String(r.sub) : null,
    });
  return out;
}
