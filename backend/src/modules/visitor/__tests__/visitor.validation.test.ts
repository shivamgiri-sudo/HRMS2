import { describe, expect, it } from "vitest";
import { canTransitionVisit } from "../visitor.types.js";
import {
  publicRegistrationSchema,
  trackingTokenSchema,
  visitListQuerySchema,
} from "../visitor.validation.js";

const validRegistration = {
  visitor: {
    full_name: "Ananya Sharma",
    mobile: "+91 98765 43210",
    email: "ananya@example.com",
    company_name: "Example Services",
  },
  branch_id: "3f7a3a66-413a-4c6c-a54e-7fda57fc8c1e",
  host_employee_code: "MAS00001",
  visit_type: "business",
  purpose: "Quarterly service review",
  scheduled_start: "2026-07-20T10:00:00+05:30",
  scheduled_end: "2026-07-20T11:00:00+05:30",
  consent: {
    accepted: true,
    consent_type: "visitor_privacy",
    consent_version: "2026-07",
  },
};

describe("visitor input validation", () => {
  it("accepts a valid self-registration and requires explicit consent", () => {
    expect(publicRegistrationSchema.safeParse(validRegistration).success).toBe(true);
    expect(publicRegistrationSchema.safeParse({
      ...validRegistration,
      consent: { ...validRegistration.consent, accepted: false },
    }).success).toBe(false);
  });

  it("rejects an inverted visit schedule", () => {
    const result = publicRegistrationSchema.safeParse({
      ...validRegistration,
      scheduled_end: "2026-07-20T09:59:00+05:30",
    });
    expect(result.success).toBe(false);
  });

  it("requires an unguessable 64-character tracking token", () => {
    expect(trackingTokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(trackingTokenSchema.safeParse("short-token").success).toBe(false);
  });

  it("caps internal list pagination and validates dates", () => {
    expect(visitListQuerySchema.safeParse({ limit: "200", offset: "0", date_from: "2026-07-01" }).success).toBe(true);
    expect(visitListQuerySchema.safeParse({ limit: "201", offset: "0" }).success).toBe(false);
    expect(visitListQuerySchema.safeParse({ date_from: "07/01/2026" }).success).toBe(false);
  });
});

describe("visitor state policy", () => {
  it("allows only declared approval and gate transitions", () => {
    expect(canTransitionVisit("pending_approval", "approved")).toBe(true);
    expect(canTransitionVisit("approved", "checked_in")).toBe(true);
    expect(canTransitionVisit("checked_in", "checked_out")).toBe(true);
    expect(canTransitionVisit("pending_approval", "checked_in")).toBe(false);
    expect(canTransitionVisit("checked_out", "checked_in")).toBe(false);
  });
});
