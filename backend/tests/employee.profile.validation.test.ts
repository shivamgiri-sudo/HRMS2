import { describe, expect, it } from "vitest";
import {
  bankDetailsSchema,
  selfProfileUpdateSchema,
  statutoryDetailsSchema,
} from "../src/modules/employees/employee.profile.validation.js";

describe("employee profile sensitive validation", () => {
  it("accepts Aadhaar last four digits only", () => {
    expect(statutoryDetailsSchema.safeParse({ aadhaar_last4: "1234" }).success).toBe(true);
    expect(statutoryDetailsSchema.safeParse({ aadhaar_last4: "123456789012" }).success).toBe(false);
  });

  it("validates PAN, UAN and IFSC formats", () => {
    expect(statutoryDetailsSchema.safeParse({
      pan_number: "ABCDE1234F",
      uan: "123456789012",
    }).success).toBe(true);

    expect(bankDetailsSchema.safeParse({
      bank_name: "HDFC Bank",
      account_holder_name: "Test Employee",
      ifsc_code: "HDFC0001234",
      account_type: "Savings",
      account_number: "123456789012",
    }).success).toBe(true);
  });

  it("normalizes optional blank self-service fields", () => {
    const parsed = selfProfileUpdateSchema.parse({
      phone: "",
      alternate_mobile: "",
      gender: "",
      marital_status: "",
    });
    expect(parsed).toEqual({
      phone: null,
      alternate_mobile: null,
      gender: null,
      marital_status: null,
    });
  });
});
