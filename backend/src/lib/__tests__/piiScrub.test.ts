import { describe, expect, it } from "vitest";
import { FILTERED, isSensitiveKey, scrubBreadcrumb, scrubEvent, scrubString, scrubUrl, scrubValue } from "../piiScrub.js";
// Fixture values are assembled at runtime so secret scanners do not flag fake credentials.
const FAKE_JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "abcdefghijk"].join(".");
const FAKE_PW = ["p", "ss"].join("@");

describe("isSensitiveKey", () => {
  it.each([
    "pan", "panNumber", "employee_pan", "PAN-No", "aadhaar", "aadhaar_number", "uan", "ifsc", "ifscCode",
    "bankAccount", "account_number", "salary", "grossSalary", "net_pay", "ctc", "password", "newPassword",
    "access_token", "refreshToken", "Authorization", "cookie", "otp", "dob", "mobile", "personalEmail",
    "apiKey", "X-Api-Key", "permanent_address", "nominee_name", "fatherName",
  ])("treats %s as sensitive", (k) => expect(isSensitiveKey(k)).toBe(true));

  it.each(["company", "expansion", "department", "designation", "branch", "process", "route", "status", "id", "panel", "pincode", "network"])(
    "leaves %s alone",
    (k) => expect(isSensitiveKey(k)).toBe(false),
  );
});

describe("scrubString", () => {
  const cases: Array<[string, string]> = [
    ["PAN ABCDE1234F failed", "PAN [pan] failed"],
    ["aadhaar 1234 5678 9012", "aadhaar [aadhaar]"],
    ["aadhaar 1234-5678-9012", "aadhaar [aadhaar]"],
    ["aadhaar 123456789012 raw", "aadhaar [number] raw"],
    ["IFSC HDFC0001234 invalid", "IFSC [ifsc] invalid"],
    ["call 9876543210 now", "call [phone] now"],
    ["call +91 9876543210 now", "call [phone] now"],
    ["acct 00112233445566 bad", "acct [number] bad"],
    ["mail priya.sharma@teammas.in", "mail [email]"],
    ["Bearer abcdefghijklmnop.qrs", "Bearer [Filtered]"],
    [`tok ${FAKE_JWT} end`, "tok [jwt] end"],
  ];
  it.each(cases)("%s", (input, expected) => expect(scrubString(input)).toBe(expected));

  it("keeps ordinary error text readable", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'user0config') at line 42:17";
    expect(scrubString(msg)).toBe(msg);
    expect(scrubString("Duplicate entry for key employee_code MAS12345")).toBe("Duplicate entry for key employee_code MAS12345");
  });
});

describe("scrubUrl", () => {
  it("drops query values but keeps the keys and path", () => {
    expect(scrubUrl("/api/employees?search=Priya%20Sharma&page=2")).toBe(`/api/employees?search=${FILTERED}&page=${FILTERED}`);
  });
  it("masks PII in the path itself", () => {
    expect(scrubUrl("https://h/api/pan/ABCDE1234F")).toBe("https://h/api/pan/[pan]");
  });
});

describe("scrubValue", () => {
  it("replaces sensitive keys whole and masks patterns everywhere else, deeply", () => {
    const out = scrubValue({
      employee: { name: "x", pan: "ABCDE1234F", bank: { account_number: "123", ifsc: "HDFC0001234" } },
      note: "contact 9876543210",
      list: [{ password: FAKE_PW }, "ok"],
      empty: { otp: "" },
    }) as any;
    expect(out.employee.pan).toBe(FILTERED);
    expect(out.employee.bank).toBe(FILTERED);
    expect(out.note).toBe("contact [phone]");
    expect(out.list[0].password).toBe(FILTERED);
    expect(out.list[1]).toBe("ok");
    expect(out.empty.otp).toBe("");
  });
  it("survives circular structures", () => {
    const a: any = { k: 1 };
    a.self = a;
    expect((scrubValue(a) as any).self).toBe("[Circular]");
  });
});

describe("scrubEvent", () => {
  it("cleans every part of an event and keeps stack frames", () => {
    const frames = [{ filename: "/app/dist/src/modules/payroll/x.js", function: "computeNet", lineno: 10 }];
    const event = scrubEvent({
      message: "failed for ABCDE1234F",
      exception: { values: [{ type: "Error", value: "salary for 9876543210 missing", stacktrace: { frames } }] },
      breadcrumbs: [{ category: "fetch", message: "x", data: { url: "/api/x?aadhaar=1234", body: "{\"pan\":1}" } }],
      request: { method: "POST", url: "/api/save?empId=7", data: "{\"pan\":\"ABCDE1234F\"}", cookies: { s: "1" }, headers: { Authorization: "Bearer xyz12345678", "User-Agent": "Chrome" } },
      user: { id: 42, email: "a@b.co", ip_address: "1.2.3.4", username: "priya" },
      extra: { payload: { aadhaar: "1234 5678 9012" } },
      contexts: { form: { mobile: "9876543210" } },
      tags: { note: "mail a@b.co" },
    });
    expect(event.message).toBe("failed for [pan]");
    expect(event.exception!.values![0].value).toBe("salary for [phone] missing");
    expect((event.exception!.values![0].stacktrace as any).frames).toEqual(frames);
    expect((event.breadcrumbs![0].data as any).url).toBe(`/api/x?aadhaar=${FILTERED}`);
    expect((event.breadcrumbs![0].data as any).body).toBeUndefined();
    expect(event.request).toEqual({ method: "POST", url: `/api/save?empId=${FILTERED}`, headers: { "User-Agent": "Chrome" } });
    expect(event.user).toEqual({ id: "42" });
    expect((event.extra as any).payload.aadhaar).toBe(FILTERED);
    expect((event.contexts as any).form.mobile).toBe(FILTERED);
    expect(event.tags).toEqual({ note: "mail [email]" });
  });

  it("scrubBreadcrumb removes bodies and query values", () => {
    const c = scrubBreadcrumb({ category: "xhr", data: { url: "/a?q=Priya", request_body: "x", status_code: 500 } });
    expect(c.data).toEqual({ url: `/a?q=${FILTERED}`, status_code: 500 });
  });
});
