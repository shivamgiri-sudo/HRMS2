import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/onfidoDb.js", () => ({ getOnfidoPool: vi.fn() }));

import {
  dimensionExpr,
  externalStageCells,
  internalStageCells,
  pct2,
  stageCell,
} from "../onfido-quality-pages.service.js";

describe("quality pages pure helpers", () => {
  it("pct2 rounds to two decimals and is null without audits", () => {
    expect(pct2(1, 400)).toBe(0.25);
    expect(pct2(0, 0)).toBeNull();
  });

  it("stageCell with null source is unavailable, not zero", () => {
    const c = stageCell("labelling", "Labeling", null, null);
    expect(c.available).toBe(false);
    expect(c.errorPct).toBeNull();
  });

  it("internal stages use err/(err+ok); POA cell comes from the POA table", () => {
    const cells = internalStageCells(
      { audits: 200, errors: 4, s_extraction_err: 1, s_extraction_ok: 99, s_ewys_err: 0, s_ewys_ok: 50,
        s_labelling_err: 2, s_labelling_ok: 98, s_classification_err: 0, s_classification_ok: 0 },
      { errors: 3, audits: 100 },
    );
    const by = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(by.overall.errorPct).toBe(2);
    expect(by.extraction.errorPct).toBe(1);
    expect(by.rawExtraction.errorPct).toBe(0);
    expect(by.labelling.errorPct).toBe(2);
    expect(by.poa.errorPct).toBe(3);
    expect(by.classification.errorPct).toBeNull();
  });

  it("external labelling is N/A and stages use flag/total", () => {
    const cells = externalStageCells(
      { audits: 100, errors: 1, x_extraction_err: 2, x_extraction_tot: 100, x_ewys_err: 1, x_ewys_tot: 200,
        x_classification_err: 0, x_classification_tot: 100 },
      { errors: 0, audits: 0 },
    );
    const by = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(by.labelling.available).toBe(false);
    expect(by.extraction.errorPct).toBe(2);
    expect(by.rawExtraction.errorPct).toBe(0.5);
    expect(by.poa.errorPct).toBeNull();
  });

  it("dimension expressions read real columns on external and JSON on internal", () => {
    expect(dimensionExpr("external", "client")).toContain("ims_client_name");
    expect(dimensionExpr("internal", "client")).toContain("raw_data");
    expect(dimensionExpr("external", "taskType")).toContain('$."Task Type"');
    expect(dimensionExpr("internal", "tl")).toContain("tl_name");
  });
});
