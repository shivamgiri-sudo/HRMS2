import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Creating a cost centre must leave process_master.client_id populated.
 *
 * That column is the FK saying which client a process belongs to. It was NULL on all 132 live
 * rows while process_master.client_name carried the real client on 40 of them, because this
 * helper only wrote the client when it CREATED a process row. Every cost centre linked to an
 * existing process had client_id in hand and dropped it.
 *
 * The cost is not cosmetic: the 2026-08-18 RBAC audit cut manager and process_manager from the
 * inbound-quality dashboard precisely because this column was empty and there was no way to
 * scope those roles to a client.
 */
const execute = vi.fn().mockResolvedValue([[]]);
vi.mock("../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { syncCostCentreRelatedTables } = await import("../cost-centre-sync.js");

/** Lookups return a row; writes return nothing. Keyed on the SQL so order does not matter. */
function lookups({ client = "Onfido Limited" }: { client?: string } = {}) {
  execute.mockImplementation((sql: string) => {
    if (sql.includes("FROM branch_master")) return [[{ branch_name: "Noida" }]];
    if (sql.includes("FROM client_master")) return [[{ client_name: client }]];
    if (sql.includes("FROM process_master")) return [[{ process_name: "Onfido" }]];
    return [[]];
  });
}
const writesTo = (table: string) =>
  execute.mock.calls.filter(([sql]) => String(sql).includes(table) && !String(sql).startsWith("SELECT"));

beforeEach(() => { execute.mockReset(); });

describe("cost centre -> process_master client link", () => {
  it("fills client_id on an existing process, instead of discarding it", async () => {
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/001", cost_centre_name: "Onfido Inbound",
      branch_id: "b-1", client_id: "c-onfido", process_id: "p-onfido",
    });

    const upd = writesTo("UPDATE process_master")[0];
    expect(upd, "linking a cost centre to an existing process must set that process's client_id").toBeTruthy();
    expect(upd[1]).toContain("c-onfido");
    expect(upd[1]).toContain("p-onfido");
  });

  it("never re-points a process that already belongs to another client", async () => {
    // Guarded in SQL, not in JS: the UPDATE carries `AND client_id IS NULL`. Without it,
    // creating a cost centre could silently move a process between clients.
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/002", cost_centre_name: "X",
      branch_id: "b-1", client_id: "c-other", process_id: "p-onfido",
    });
    expect(writesTo("UPDATE process_master")[0][0]).toMatch(/client_id\s+IS\s+NULL/i);
  });

  it("does not overwrite an existing client_name with null", async () => {
    // COALESCE(client_name, ?) — a cost centre whose client lookup came back empty must not
    // blank a name that is already there.
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/003", cost_centre_name: "X",
      branch_id: "b-1", client_id: "c-onfido", process_id: "p-onfido",
    });
    expect(writesTo("UPDATE process_master")[0][0]).toMatch(/COALESCE\(client_name/i);
  });

  it("still creates the process row when there is no process yet", async () => {
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/004", cost_centre_name: "New Campaign",
      branch_id: "b-1", client_id: "c-onfido", process_id: null,
    });
    const ins = writesTo("INSERT IGNORE INTO process_master")[0];
    expect(ins).toBeTruthy();
    expect(ins[1]).toContain("c-onfido");            // client_id carried onto the new row
    expect(writesTo("UPDATE process_master")).toHaveLength(0); // nothing to backfill
  });

  it("skips the link when the cost centre names no client", async () => {
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/005", cost_centre_name: "X",
      branch_id: "b-1", client_id: null, process_id: "p-onfido",
    });
    expect(writesTo("UPDATE process_master")).toHaveLength(0);
  });

  it("still mirrors into salary_cost_centre", async () => {
    lookups();
    await syncCostCentreRelatedTables({
      cost_centre_code: "CS/IB/NOI/006", cost_centre_name: "X",
      branch_id: "b-1", client_id: "c-onfido", process_id: "p-onfido",
    });
    expect(writesTo("salary_cost_centre")).toHaveLength(1);
  });
});
