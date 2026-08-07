import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vendor Master enrichment (Requirement 16).
 *
 * vendor_master had not been altered since 024_erp.sql created it, so tally name, structured
 * address, GST registration and TDS terms had nowhere to live and were retyped per invoice.
 *
 * The subtle part is not the columns, it is the two different update semantics now living in
 * one statement:
 *
 *   - the original ten keep COALESCE, i.e. "omitted means preserved". VendorSheet has always
 *     sent partial payloads, and flipping these would blank data on every save.
 *   - the new twelve use presence, i.e. "a key in the payload is written, even as null".
 *     Without that there is no way to clear one, and tds_section MUST be clearable — a stale
 *     section left behind after tds_enabled flips to 0 means deducting under a section the
 *     vendor no longer has.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

let vendorService: typeof import("../erp.service.js")["vendorService"];
beforeAll(async () => {
  ({ vendorService } = await import("../erp.service.js"));
}, 120_000);

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

/** The write statement, ignoring the getById round-trip that follows it. */
function writeCall() {
  const hit = execute.mock.calls.find(([sql]) => /^\s*(INSERT|UPDATE)/i.test(String(sql)));
  if (!hit) throw new Error("no write statement was issued");
  return { sql: String(hit[0]).replace(/\s+/g, " "), params: (hit[1] ?? []) as unknown[] };
}

describe("update — the original columns keep COALESCE", () => {
  it("preserves an omitted legacy field rather than nulling it", async () => {
    await vendorService.update("v1", { vendor_name: "New Name" });
    const { sql } = writeCall();
    expect(sql).toContain("payment_terms = COALESCE(?, payment_terms)");
    expect(sql).toContain("address = COALESCE(?, address)");
  });
});

describe("update — the new columns use presence semantics", () => {
  it("does not touch an enrichment column the caller never mentioned", async () => {
    await vendorService.update("v1", { vendor_name: "New Name" });
    const { sql } = writeCall();
    expect(sql).not.toContain("tally_name");
    expect(sql).not.toContain("tds_section");
  });

  it("writes an enrichment column when the caller supplies it", async () => {
    await vendorService.update("v1", { tally_name: "MAS Vendor A/c" });
    const { sql, params } = writeCall();
    expect(sql).toContain("tally_name = ?");
    expect(params).toContain("MAS Vendor A/c");
  });

  it("CLEARS an enrichment column when the caller sends null", async () => {
    // The whole reason these do not use COALESCE.
    await vendorService.update("v1", { tds_section: null });
    const { sql, params } = writeCall();
    expect(sql).toContain("tds_section = ?");
    expect(params).toContain(null);
  });

  it("treats an empty string as a clear, not as an empty value", async () => {
    await vendorService.update("v1", { address_line2: "" });
    const { params } = writeCall();
    expect(params).toContain(null);
  });

  it("coerces the two flags to 0/1 and never to NULL", async () => {
    // Both are NOT NULL DEFAULT 0, so a NULL would be rejected by the column.
    await vendorService.update("v1", { gst_enabled: "1", tds_enabled: "" });
    const { sql, params } = writeCall();
    expect(sql).toContain("gst_enabled = ?");
    expect(sql).toContain("tds_enabled = ?");
    expect(params).toContain(1);
    expect(params).toContain(0);
    expect(params.filter((p) => p === null)).not.toContain(undefined);
  });

  it("keeps a non-numeric tds_rate out of a DECIMAL column", async () => {
    await vendorService.update("v1", { tds_rate: "not a number" });
    const { params } = writeCall();
    expect(params).toContain(null);
  });
});

describe("gst_state_code is derived from the GSTIN", () => {
  it("fills a blank state code from the first two digits", async () => {
    // Those two characters ARE the state code by definition, so deriving means the two can
    // never disagree — the same rule migration 1086 applied to existing rows.
    await vendorService.update("v1", { gst_number: "09AAACH7409R1ZZ" });
    const { sql, params } = writeCall();
    expect(sql).toContain("gst_state_code = ?");
    expect(params).toContain("09");
  });

  it("never overrides an explicitly supplied state code", async () => {
    await vendorService.update("v1", { gst_number: "09AAACH7409R1ZZ", gst_state_code: "27" });
    expect(writeCall().params).toContain("27");
  });

  it("derives nothing from a malformed GSTIN rather than inventing a state", async () => {
    await vendorService.update("v1", { gst_number: "NOTAGSTIN" });
    const { sql } = writeCall();
    expect(sql).not.toContain("gst_state_code = ?");
  });
});

describe("create", () => {
  it("inserts exactly the original columns when no enrichment is supplied", async () => {
    // A caller that knows nothing about the new columns must produce the row it always did.
    await vendorService.create({ vendor_code: "V-1", vendor_name: "Acme" });
    const { sql } = writeCall();
    expect(sql).toContain("INSERT INTO vendor_master");
    expect(sql).not.toContain("tally_name");
    expect(sql).not.toContain("tds_rate");
  });

  it("includes enrichment columns when they are supplied", async () => {
    await vendorService.create({
      vendor_code: "V-2", vendor_name: "Beta", tally_name: "Beta A/c", city: "Noida",
      gst_number: "09AAACH7409R1ZZ",
    });
    const { sql, params } = writeCall();
    expect(sql).toContain("tally_name");
    expect(sql).toContain("city");
    expect(params).toContain("Beta A/c");
    expect(params).toContain("Noida");
    expect(params, "the state code is derived on create too").toContain("09");
  });

  it("keeps placeholder count equal to parameter count", async () => {
    // A mismatch here is a runtime bind error, not a compile error.
    await vendorService.create({ vendor_code: "V-3", vendor_name: "Gamma", pin_code: "201301" });
    const { sql, params } = writeCall();
    const placeholders = (sql.match(/\?/g) ?? []).length;
    expect(placeholders).toBe(params.length);
  });
});
