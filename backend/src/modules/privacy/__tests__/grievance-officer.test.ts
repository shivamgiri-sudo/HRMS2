import { describe, expect, it } from "vitest";
import { resolveGrievanceOfficer } from "../privacy.public.routes.js";

/**
 * The site footer calls GET /api/privacy/grievance-officer on every page and renders the
 * result to every visitor, signed in or not.
 *
 * dpdp_config seeds the keys with placeholders so a fresh install has rows to edit. Those
 * are not contact details. Publishing them would name "To be configured" as the DPDP
 * Grievance Officer and point complaints at privacy@yourcompany.com, so the statutory
 * obligation would look discharged while nobody receives anything.
 */

const config = (entries: Record<string, string>) => new Map(Object.entries(entries));

const REAL = {
  grievance_officer_name: "Anita Sharma",
  grievance_officer_email: "privacy@teammas.in",
  grievance_officer_designation: "Head of Compliance",
  grievance_response_sla_days: "30",
};

describe("resolveGrievanceOfficer", () => {
  it("returns the officer once real details are configured", () => {
    expect(resolveGrievanceOfficer(config(REAL))).toEqual({
      name: "Anita Sharma",
      email: "privacy@teammas.in",
      designation: "Head of Compliance",
      sla_days: 30,
    });
  });

  it("reports the seeded placeholders as unconfigured", () => {
    // Exactly what production held when this endpoint was written.
    expect(resolveGrievanceOfficer(config({
      grievance_officer_name: "To be configured",
      grievance_officer_email: "privacy@yourcompany.com",
      grievance_officer_designation: "HR Manager",
      grievance_response_sla_days: "30",
    }))).toBeNull();
  });

  it("ignores placeholder casing and surrounding whitespace", () => {
    expect(resolveGrievanceOfficer(config({
      ...REAL,
      grievance_officer_name: "  TO BE CONFIGURED  ",
    }))).toBeNull();
  });

  it("withholds the officer when either the name or the address is missing", () => {
    // A name with no address gives a visitor nobody to write to; an address with no name
    // is not an identified officer. Neither half is publishable alone.
    expect(resolveGrievanceOfficer(config({ ...REAL, grievance_officer_email: "" }))).toBeNull();
    expect(resolveGrievanceOfficer(config({ ...REAL, grievance_officer_name: "" }))).toBeNull();
    expect(resolveGrievanceOfficer(new Map())).toBeNull();
  });

  it("still publishes when only the designation is a placeholder", () => {
    // Designation is descriptive, not a route to a human. A real name and address are
    // enough to raise a grievance, so a stock title must not suppress the whole block.
    const resolved = resolveGrievanceOfficer(config({
      ...REAL,
      grievance_officer_designation: "To be configured",
    }));
    expect(resolved?.name).toBe("Anita Sharma");
    expect(resolved?.designation).toBe("");
  });

  it("falls back to the statutory 30 days rather than advertising an impossible SLA", () => {
    for (const bad of ["0", "-5", "", "not-a-number"]) {
      expect(resolveGrievanceOfficer(config({
        ...REAL,
        grievance_response_sla_days: bad,
      }))?.sla_days).toBe(30);
    }
  });

  it("honours a configured SLA that differs from the default", () => {
    expect(resolveGrievanceOfficer(config({
      ...REAL,
      grievance_response_sla_days: "15",
    }))?.sla_days).toBe(15);
  });
});
