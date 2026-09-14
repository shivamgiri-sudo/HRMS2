import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const formPath = path.resolve(__dirname, "../BudgetLinkedGrnForm.tsx");

function read() {
  return fs.readFileSync(formPath, "utf8");
}

describe("BudgetLinkedGrnForm — 'GRN Raised' submit confirmation modal (item 10)", () => {
  it("declares submittedGrn state", () => {
    const form = read();
    expect(form).toContain(
      "const [submittedGrn, setSubmittedGrn] = useState<{ grnNumber: string } | null>(null);"
    );
  });

  it("keeps the edit-resubmit path calling resetForm({ navigateAway: true }) directly, unchanged", () => {
    const form = read();
    const onSuccessIdx = form.indexOf("onSuccess: (result, submit) => {");
    expect(onSuccessIdx).toBeGreaterThan(-1);
    const onSuccessBlock = form.slice(onSuccessIdx, form.indexOf("onError: (error: Error) => {", onSuccessIdx));
    expect(onSuccessBlock).toContain("if (submit && editGrnId) {");
    expect(onSuccessBlock).toContain("resetForm({ navigateAway: true });");
  });

  it("sets submittedGrn instead of calling resetForm for a fresh-create submit (!editGrnId)", () => {
    const form = read();
    const onSuccessIdx = form.indexOf("onSuccess: (result, submit) => {");
    const onSuccessBlock = form.slice(onSuccessIdx, form.indexOf("onError: (error: Error) => {", onSuccessIdx));
    expect(onSuccessBlock).toContain("} else if (submit && !editGrnId) {");
    expect(onSuccessBlock).toContain("setSubmittedGrn({ grnNumber: result.grnNumber });");
    // The fresh-create submit branch must not itself call resetForm — only setSubmittedGrn.
    const freshCreateBranchIdx = onSuccessBlock.indexOf("} else if (submit && !editGrnId) {");
    const freshCreateBranch = onSuccessBlock.slice(freshCreateBranchIdx, onSuccessBlock.indexOf("}", freshCreateBranchIdx + 40) + 1);
    expect(freshCreateBranch).not.toContain("resetForm(");
  });

  it("draft save (!submit) path is untouched — no reset, toast still unconditional for that case", () => {
    const form = read();
    expect(form).toContain("const skipToastForModal = submit && !editGrnId;");
  });

  it("both the 'Create another' and 'Close' handlers call resetForm({ navigateAway: false })", () => {
    const form = read();
    const createAnotherIdx = form.indexOf("function handleCreateAnotherGrn(chosenType: GrnType) {");
    const closeIdx = form.indexOf("function handleCloseSubmittedGrnDialog() {");
    expect(createAnotherIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(-1);

    const createAnotherBlock = form.slice(createAnotherIdx, form.indexOf("\n  }", createAnotherIdx));
    const closeBlock = form.slice(closeIdx, form.indexOf("\n  }", closeIdx));

    expect(createAnotherBlock).toContain("resetForm({ navigateAway: false });");
    expect(closeBlock).toContain("resetForm({ navigateAway: false });");
  });

  it("'Create another' sets grnType strictly after calling resetForm (ordering matters, or the reset would clobber it)", () => {
    const form = read();
    const createAnotherIdx = form.indexOf("function handleCreateAnotherGrn(chosenType: GrnType) {");
    const createAnotherBlock = form.slice(createAnotherIdx, form.indexOf("\n  }", createAnotherIdx));

    const resetOffset = createAnotherBlock.indexOf("resetForm({ navigateAway: false });");
    const grnTypeOffset = createAnotherBlock.indexOf("grnType: chosenType");

    expect(resetOffset).toBeGreaterThan(-1);
    expect(grnTypeOffset).toBeGreaterThan(-1);
    expect(resetOffset).toBeLessThan(grnTypeOffset);
  });

  it("both handlers close the dialog via setSubmittedGrn(null)", () => {
    const form = read();
    const createAnotherIdx = form.indexOf("function handleCreateAnotherGrn(chosenType: GrnType) {");
    const closeIdx = form.indexOf("function handleCloseSubmittedGrnDialog() {");
    const createAnotherBlock = form.slice(createAnotherIdx, form.indexOf("\n  }", createAnotherIdx));
    const closeBlock = form.slice(closeIdx, form.indexOf("\n  }", closeIdx));

    expect(createAnotherBlock).toContain("setSubmittedGrn(null);");
    expect(closeBlock).toContain("setSubmittedGrn(null);");
  });

  it("renders the 'GRN Raised' dialog gated on submittedGrn, stating the GRN number", () => {
    const form = read();
    expect(form).toContain("open={Boolean(submittedGrn)}");
    expect(form).toContain("<DialogTitle>GRN Raised</DialogTitle>");
    expect(form).toContain("GRN {submittedGrn?.grnNumber} has been submitted for Branch Head review.");
  });

  it("offers Vendor/Imprest 'create another' choices calling handleCreateAnotherGrn with each type", () => {
    const form = read();
    expect(form).toContain('handleCreateAnotherGrn("vendor" as GrnType)');
    expect(form).toContain('handleCreateAnotherGrn("imprest" as GrnType)');
  });
});
