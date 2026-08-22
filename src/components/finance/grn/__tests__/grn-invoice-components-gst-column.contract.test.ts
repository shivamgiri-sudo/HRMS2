import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const formPath = path.resolve(__dirname, "../BudgetLinkedGrnForm.tsx");

function read() {
  return fs.readFileSync(formPath, "utf8");
}

function invoiceComponentsEditorSource() {
  const form = read();
  const start = form.indexOf("function InvoiceComponentsEditor");
  expect(start).toBeGreaterThan(-1);
  // Function runs to end of file in this module.
  return form.slice(start);
}

describe("BudgetLinkedGrnForm — InvoiceComponentsEditor GST Amount column (Group A3)", () => {
  it("adds a GST Amount GrnTh and drops the Note GrnTh in the desktop table header", () => {
    const src = invoiceComponentsEditorSource();
    expect(src).toContain('<GrnTh sticky={false} align="right" className="w-32">GST Amount</GrnTh>');
    expect(src).not.toContain(">Note</GrnTh>");
  });

  it("renders the GST Amount cell using the already-computed tax variable, desktop", () => {
    const src = invoiceComponentsEditorSource();
    expect(src).toContain('<GrnTd align="right">{money(tax)}</GrnTd>');
  });

  it("removes the remarks-bound Input from the desktop table cell", () => {
    const src = invoiceComponentsEditorSource();
    expect(src).not.toContain('<GrnTd className="min-w-[160px]">');
    // No Input anywhere in this function should still bind to component.remarks.
    expect(src).not.toMatch(/<Input[\s\S]{0,200}?value=\{component\.remarks\}/);
  });

  it("shows the GST amount as a read-only value in the mobile stacked card", () => {
    const src = invoiceComponentsEditorSource();
    expect(src).toContain('<Label className="text-[11px] text-grn-ink-soft">GST Amount</Label>');
    const gstAmountLabelIdx = src.indexOf('<Label className="text-[11px] text-grn-ink-soft">GST Amount</Label>');
    const nearby = src.slice(gstAmountLabelIdx, gstAmountLabelIdx + 300);
    expect(nearby).toContain("{money(tax)}");
  });

  it("removes the 'Optional note for this component' Input from the mobile card", () => {
    const src = invoiceComponentsEditorSource();
    expect(src).not.toContain("Optional note for this component");
  });

  it("keeps InvoiceComponentDraft's remarks field and newInvoiceComponent()'s default untouched", () => {
    const form = read();
    const typeIdx = form.indexOf("type InvoiceComponentDraft");
    const typeBlock = form.slice(typeIdx, typeIdx + 400);
    expect(typeBlock).toContain("remarks");

    const factoryIdx = form.indexOf("function newInvoiceComponent()");
    expect(factoryIdx).toBeGreaterThan(-1);
    const factoryBlock = form.slice(factoryIdx, factoryIdx + 400);
    expect(factoryBlock).toContain("remarks");
  });
});

describe("BudgetLinkedGrnForm — Vendor dropdown de-duplication (Group A2)", () => {
  it("de-duplicates vendors by normalized name before building SearchableSelect options", () => {
    const form = read();
    const optionsIdx = form.indexOf("options={Array.from(");
    expect(optionsIdx).toBeGreaterThan(-1);
    const block = form.slice(optionsIdx, optionsIdx + 400);
    expect(block).toContain("new Map(");
    expect(block).toContain(".values()");
    expect(block).toContain(".trim().toUpperCase()");
    // The dedup Map construction must precede the actual options .map(...) that builds
    // {value, label, hint} entries — i.e. it wraps `vendors`, not the other way round.
    const vendorsMapIdx = form.indexOf("vendors.map((vendor) => [", optionsIdx);
    const finalMapIdx = form.indexOf(".map((vendor) => ({", optionsIdx);
    expect(vendorsMapIdx).toBeGreaterThan(-1);
    expect(finalMapIdx).toBeGreaterThan(-1);
    expect(vendorsMapIdx).toBeLessThan(finalMapIdx);
  });
});
