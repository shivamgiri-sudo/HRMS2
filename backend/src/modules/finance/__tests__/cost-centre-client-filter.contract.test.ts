import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");
const SERVICE = "src/modules/finance/cost-centre-management.service.ts";
const ROUTES = "src/modules/finance/cost-centre-management.routes.ts";

function read(relativePath: string) {
  return fs.readFileSync(path.join(backendRoot, relativePath), "utf8");
}

/**
 * Filtering the cost centre list by client returned nothing, always: the filter was
 * `cc.client_id = ?` and client_id is NULL on all 927 rows.
 *
 * It cannot be fixed by populating client_id. That FK points at client_master, which is a Client
 * PORTAL TENANT registry — api_key, webhook_url, subscription_status, billing_cycle — holding 12
 * mostly-dead rows ('2', 'UnAllocated', 'CS/IB/AHM/003' which is a cost centre code, plus defunct
 * telecoms). Only 3 of the 12 appear in billing data. Filling it from the 717 billing
 * counterparties in bill_client_snapshot would make every company MAS invoices a portal tenant
 * defaulting to subscription_status = 'ACTIVE'.
 *
 * The billing client is already on the row as text: client_name, 785 populated, 683 distinct.
 */
describe("cost centre list can actually be filtered by client", () => {
  it("filters on client_name, the column that holds data", () => {
    const service = read(SERVICE);
    expect(service).toContain("cc.client_name LIKE ?");
    expect(service).toMatch(/client_name\?: string;/);
  });

  it("keeps client_id as a filter rather than silently repurposing the parameter", () => {
    // An `id` parameter matching a name would be a lie in the API contract. client_id stays a
    // genuine FK filter — correct if the column is ever populated — and client_name is added
    // beside it, so no caller changes meaning.
    const service = read(SERVICE);
    expect(service).toContain("cc.client_id = ?");
    const idIdx = service.indexOf("cc.client_id = ?");
    const nameIdx = service.indexOf("cc.client_name LIKE ?");
    expect(idIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeGreaterThan(idIdx);
  });

  it("records why client_id cannot simply be backfilled", () => {
    const service = read(SERVICE);
    // The reasoning must survive in the file — someone WILL try to "fix" the empty FK.
    expect(service).toMatch(/portal/i);
    expect(service).toMatch(/subscription_status|api_key/);
  });

  it("the route forwards client_name to the service", () => {
    const routes = read(ROUTES);
    expect(routes).toMatch(/client_name,?\s*branch_id/);
    expect(routes).toContain("client_name: client_name as string");
  });

  it("the frontend hook sends client_name as a query parameter", () => {
    const hook = fs.readFileSync(
      path.resolve(backendRoot, "../src/hooks/useCostCentreManagement.ts"), "utf8"
    );
    expect(hook).toContain('params.set("client_name", filters.client_name)');
    expect(hook).toMatch(/client_name\?: string;/);
  });
});
