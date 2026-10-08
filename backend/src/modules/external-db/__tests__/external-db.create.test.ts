import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Creating a connector at runtime.
 *
 * Before this route, integration_config rows could only be edited (PUT /:key),
 * never added — so connecting a genuinely new client database required shipping
 * a migration. These assertions pin the three properties that make the create
 * path safe:
 *
 *   1. It exists at all.
 *   2. The password reaches encrypted_credentials only. config_json is echoed
 *      back to the browser by the list and detail routes in this same file, so
 *      a secret placed there would be handed out in clear text.
 *   3. A connector attached to a process is scope-checked, so a process manager
 *      cannot register one against a process that is not theirs.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/modules/external-db/external-db.routes.ts"),
  "utf8",
);
const createRoute = source.slice(source.indexOf("router.post('/'"));

describe("external-db create route", () => {
  it("exposes POST / to create a connector", () => {
    expect(source).toMatch(/router\.post\(\s*'\/'/);
    expect(createRoute.length).toBeGreaterThan(0);
  });

  it("encrypts credentials rather than storing them in config_json", () => {
    expect(createRoute).toMatch(/encryptCredentials/);
    expect(createRoute).toMatch(/encrypted_credentials/);
    // The config object built for config_json must not carry the password.
    const configBlock = createRoute.slice(createRoute.indexOf("const config"), createRoute.indexOf("await db.execute"));
    expect(configBlock).not.toMatch(/password/);
  });

  it("scope-checks the process a connector is attached to", () => {
    expect(createRoute).toMatch(/assertProcessWritable/);
  });

  it("keeps estate-wide connectors admin-only", () => {
    // A connector with no process_id spans the whole estate (COSEC, dialer,
    // db_bill); a process manager must not be able to create one.
    expect(createRoute).toMatch(/super_admin|admin/);
    expect(createRoute).toMatch(/estate-wide/i);
  });
});
