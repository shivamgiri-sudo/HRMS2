import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbExecute, current } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  current: { status: "approved" as string },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../workflow/workflow.service.js", () => ({ workflowService: {} }));

import { jobRequisitionService as svc } from "../job-requisition.service.js";

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async () => [[{ id: "r1", approval_status: current.status }], []]);
  vi.spyOn(svc, "getRequisition").mockImplementation(async () => ({ id: "r1", requisition_code: "REQ-1", approval_status: current.status } as never));
  vi.spyOn(console, "info").mockImplementation(() => {});
});
const updates = () => dbExecute.mock.calls.filter((c) => String(c[0]).startsWith("UPDATE job_requisition"));

describe("updateRequisition on an approved requisition", () => {
  beforeEach(() => { current.status = "approved"; });

  it("allows bmi_assessment_url alone and stores it trimmed", async () => {
    await svc.updateRequisition("r1", { bmi_assessment_url: "  https://bmi.example.com/a?t=SECRET  " }, "u1");
    expect(updates()).toHaveLength(1);
    expect(updates()[0][1]).toEqual(["https://bmi.example.com/a?t=SECRET", "r1"]);
  });
  it("allows bmi_assessment_url together with owner_recruiter_id", async () => {
    await svc.updateRequisition("r1", { bmi_assessment_url: "https://x.com/a", owner_recruiter_id: "e1" }, "u1");
    expect(updates()).toHaveLength(1);
  });
  it("empty string and null clear the link", async () => {
    await svc.updateRequisition("r1", { bmi_assessment_url: "" }, "u1");
    await svc.updateRequisition("r1", { bmi_assessment_url: null }, "u1");
    expect(updates().map((c) => c[1][0])).toEqual([null, null]);
  });
  it("still 409s any other field, alone or mixed with the link", async () => {
    await expect(svc.updateRequisition("r1", { requested_headcount: 9 }, "u1")).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.updateRequisition("r1", { bmi_assessment_url: "https://x.com/a", salary_max: 1 }, "u1")).rejects.toMatchObject({ statusCode: 409 });
    expect(updates()).toHaveLength(0);
  });
  it.each(["http://x.com/a", "javascript:alert(1)", "https://x.com/a b", "not a url"])("400s an invalid url %s without writing", async (u) => {
    await expect(svc.updateRequisition("r1", { bmi_assessment_url: u }, "u1")).rejects.toMatchObject({ statusCode: 400 });
    expect(updates()).toHaveLength(0);
  });
  it("audit log line records requisition and actor but never the url", async () => {
    const info = vi.spyOn(console, "info");
    await svc.updateRequisition("r1", { bmi_assessment_url: "https://bmi.example.com/a?t=SECRET" }, "u-actor");
    const line = info.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).toContain("r1");
    expect(line).toContain("u-actor");
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("bmi.example.com");
  });
});

describe("updateRequisition on a closed requisition", () => {
  beforeEach(() => { current.status = "closed"; });
  it("409s a link change and writes nothing", async () => {
    await expect(svc.updateRequisition("r1", { bmi_assessment_url: "https://x.com/a" }, "u1")).rejects.toMatchObject({ statusCode: 409 });
    expect(updates()).toHaveLength(0);
  });
});

describe("updateRequisition on a draft", () => {
  it("validates the url too", async () => {
    current.status = "draft";
    await expect(svc.updateRequisition("r1", { bmi_assessment_url: "http://x.com" }, "u1")).rejects.toMatchObject({ statusCode: 400 });
    await svc.updateRequisition("r1", { bmi_assessment_url: "https://x.com/ok", designation_name: "A" }, "u1");
    expect(updates()).toHaveLength(1);
  });
});
