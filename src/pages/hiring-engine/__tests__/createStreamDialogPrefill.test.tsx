/** "Map it" opens Open-a-stream at the right step: requisition, source and origin prefilled (WS3 C4). */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import { CreateStreamForm } from "../command/CreateStreamDialog";
import { prefillCreateForm, withPrefilledOrigin } from "../command/streamActionsModel";

const TODAY = "2026-10-09";
const R = "11111111-1111-4111-8111-111111111111", C = "22222222-2222-4222-8222-222222222222";

describe("prefill helpers", () => {
  it("the form starts on the requisition, source and origin of the cell", () => {
    expect(prefillCreateForm(TODAY, { requisitionId: R, sourceType: "meta_live", originId: C })).toMatchObject({ requisitionId: R, sourceType: "meta_live", originId: C, openFrom: "2026-10-10" });
    expect(prefillCreateForm(TODAY, { requisitionId: R, sourceType: "he", originId: "pool" }).originId).toBe("pool");
    expect(prefillCreateForm(TODAY, { requisitionId: R, sourceType: "meta_old", originId: null }).originId).toBe("");
  });
  it("a campaign linked as a non-primary requisition is offered even though the campaign list files it under its primary", () => {
    expect(withPrefilledOrigin([], "meta_live", C, "AHM multi campaign")).toEqual([{ id: C, label: "AHM multi campaign" }]);
    expect(withPrefilledOrigin([{ id: C, label: "Known" }], "meta_live", C, "x")).toEqual([{ id: C, label: "Known" }]);
    expect(withPrefilledOrigin([], "meta_old", null, "x")).toEqual([]);
    expect(withPrefilledOrigin([{ id: "pool", label: "Pool" }], "he", "pool", "x")).toEqual([{ id: "pool", label: "Pool" }]);
  });
});

describe("the form opened from Map it", () => {
  it("shows the requisition locked, the source checked and the campaign selected", () => {
    const f = prefillCreateForm(TODAY, { requisitionId: R, sourceType: "meta_live", originId: C });
    const html = renderToStaticMarkup(<CreateStreamForm form={{ ...f, openDays: String(f.openDays), dailyInvites: "" }} requisitions={[{ id: R, label: "AHM-SBI-01", branch: "AHMEDABAD", code: "AHM-SBI-01" }]}
      lockRequisition today={TODAY} origins={withPrefilledOrigin([], "meta_live", C, "AHM multi campaign")} originsLoading={false} originsError={null}
      readiness={{ loading: false, error: null, problems: [], neverOverride: [] }} errors={[]} showErrors={false} serverError={null} busy={false} onChange={() => undefined} idPrefix="t" />);
    expect(html).toContain("AHM-SBI-01");
    expect(html).toContain(`checked="" value="meta_live"`);
    expect(html).toMatch(/<option value="22222222-2222-4222-8222-222222222222" selected="">AHM multi campaign<\/option>/);
  });
});
