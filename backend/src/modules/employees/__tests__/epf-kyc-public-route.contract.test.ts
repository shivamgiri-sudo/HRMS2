/**
 * POST /api/public/employee-documents/esign/:token/epf-kyc
 *
 * WHY THIS EXISTS
 *   epfKycCapture.service.ts was written for this and had no callers, while
 *   EmployeeEpfComplianceReviewPage POSTed here the whole time — so every submission of an
 *   employee's bank, PAN, Aadhaar and UAN failed. The route now wires the two together.
 *
 *   Two things about it are easy to break silently, and both are asserted here.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
const applyKyc = vi.fn();

vi.mock("../employeeJoiningDocuments.service.js", async (importOriginal) => ({
  // importOriginal keeps the other exports real: this router imports a dozen of them, and a
  // hand-written stub drifts from the module it replaces.
  ...(await importOriginal<Record<string, unknown>>()),
  getPublicJoiningDocumentEsignSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock("../epfKycCapture.service.js", () => ({
  applyEpfKycAndRegenerate: (...args: unknown[]) => applyKyc(...args),
}));

const { publicEmployeeDocumentRouter } = await import("../employee.compliance.routes.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api/public/employee-documents", publicEmployeeDocumentRouter);
  return a;
}

const PAYLOAD = {
  bank_account_number: "12345678901",
  bank_ifsc: "HDFC0001234",
  bank_account_name: "A Person",
  pan_number: "ABCDE1234F",
  pan_name: "A Person",
  aadhaar_number: "111122223333",
  aadhaar_name: "A Person",
  uan_number: "100200300400",
};

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ checklist_id: "chk-1", employee_id: "emp-1" });
  applyKyc.mockResolvedValue({ regenerated: true, errors: [] });
});

describe("field mapping", () => {
  it("maps every snake_case field the page sends onto the camelCase the service takes", async () => {
    // The page posts snake_case and EpfKycInput is camelCase. A field missed in that mapping
    // does not fail — it arrives as null, the service treats it as "not supplied", and the
    // employee's PAN or Aadhaar quietly never reaches the form. Asserting all eight.
    await request(app()).post("/api/public/employee-documents/esign/tok-1/epf-kyc").send(PAYLOAD).expect(200);

    expect(applyKyc).toHaveBeenCalledTimes(1);
    expect(applyKyc.mock.calls[0][0].input).toEqual({
      panNumber: "ABCDE1234F",
      panNameAsPerKyc: "A Person",
      aadhaarNumber: "111122223333",
      aadhaarNameAsPerKyc: "A Person",
      uanNumber: "100200300400",
      bankAccountNumber: "12345678901",
      bankIfsc: "HDFC0001234",
      bankAccountName: "A Person",
    });
  });

  it("blanks become null rather than empty strings", async () => {
    await request(app())
      .post("/api/public/employee-documents/esign/tok-1/epf-kyc")
      .send({ ...PAYLOAD, uan_number: "   " })
      .expect(200);

    expect(applyKyc.mock.calls[0][0].input.uanNumber).toBeNull();
  });
});

describe("identity", () => {
  it("takes employee and checklist from the token session, never from the body", async () => {
    // Otherwise anyone holding one valid link could write KYC onto another employee's
    // document by adding a field to the request.
    await request(app())
      .post("/api/public/employee-documents/esign/tok-1/epf-kyc")
      .send({ ...PAYLOAD, employee_id: "someone-else", checklist_id: "their-checklist" })
      .expect(200);

    expect(applyKyc.mock.calls[0][0]).toMatchObject({ checklistId: "chk-1", employeeId: "emp-1" });
  });

  it("never reaches the service when the link is invalid or expired", async () => {
    const expired = Object.assign(new Error("This document signing link has expired"), { statusCode: 410 });
    getSession.mockRejectedValue(expired);

    await request(app()).post("/api/public/employee-documents/esign/bad/epf-kyc").send(PAYLOAD);

    expect(applyKyc, "an unresolved token must not reach the KYC service").not.toHaveBeenCalled();
  });
});

describe("validation errors", () => {
  it("returns errors in the {field, message} shape the page parses", async () => {
    // EmployeeEpfComplianceReviewPage does body.errors.map(e => [e.field, e.message]). If the
    // shape changes, the page shows a generic message and the user cannot tell which field is
    // wrong.
    applyKyc.mockResolvedValue({
      regenerated: false,
      errors: [{ field: "panNumber", message: "PAN must look like ABCDE1234F." }],
    });

    const res = await request(app())
      .post("/api/public/employee-documents/esign/tok-1/epf-kyc")
      .send({ ...PAYLOAD, pan_number: "nope" })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.errors[0]).toMatchObject({ field: "panNumber", message: expect.any(String) });
  });
});
