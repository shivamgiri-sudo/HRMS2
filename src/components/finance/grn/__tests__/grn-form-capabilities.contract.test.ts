import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";

/**
 * A safety net for restructuring BudgetLinkedGrnForm into I-Spark's section order.
 *
 * That file is ~2,800 lines with no test coverage, and it owns everything the GRN flow
 * depends on: document upload and hashing, Gemini extraction, duplicate detection, blocking
 * validations, GST components, cost-centre split and budget reservation. Every one of those
 * fails QUIETLY if its call site is dropped during a move — the form still renders, still
 * saves, and simply stops hashing documents or stops revalidating.
 *
 * So this does not assert markup. Markup is supposed to change; that is the point of the
 * restructure. It asserts that the CAPABILITIES survive it — each endpoint is still called
 * from somewhere in the GRN component tree, and the submit sequence still runs in an order
 * where each step's precondition is met.
 *
 * Scanning the whole directory rather than the one file is deliberate: once sections are
 * extracted, a call site legitimately moves into a sibling. Only vanishing entirely fails.
 */

const DIR = new URL("..", import.meta.url);

function grnSources(): string {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
  let combined = "";
  for (const f of files) combined += readFileSync(new URL(f, DIR), "utf8") + "\n";
  // Sections extracted during the restructure live one level down.
  try {
    const sectionsDir = new URL("sections/", DIR);
    for (const f of readdirSync(sectionsDir).filter((n) => n.endsWith(".tsx") || n.endsWith(".ts"))) {
      combined += readFileSync(new URL(f, sectionsDir), "utf8") + "\n";
    }
  } catch {
    // No sections directory yet — expected before the extraction lands.
  }
  return combined;
}

/** Each entry is a capability that fails silently if its call site disappears. */
const REQUIRED_ENDPOINTS: Array<[string, string]> = [
  ["/api/finance/grns", "create the draft GRN"],
  ["/invoice-components", "vendor GST slab components"],
  ["/allocations", "imprest budget-line allocations"],
  ["/documents", "document upload — the only path that computes the sha256 hash"],
  ["/analyze", "Gemini invoice extraction"],
  ["/extraction/confirm", "accepting extracted fields onto the GRN"],
  ["/revalidate", "rebuilds validations and duplicate matches"],
  ["/submit", "submits for approval, enforcing blocking validations"],
  ["/workspace", "reads back validations, documents and allocations"],
  ["/api/finance/pnl/budget-lines/available", "budget lines with headroom"],
];

describe("GRN form capabilities survive restructuring", () => {
  const src = grnSources();

  it.each(REQUIRED_ENDPOINTS)("still calls %s — %s", (endpoint) => {
    expect(src).toContain(endpoint);
  });

  it("keeps the submit sequence in a workable order", () => {
    // Each step depends on the one before: allocations need the created GRN, revalidate needs
    // the allocations and documents, submit needs the validations revalidate produced. A
    // reorder that submits before revalidating would pass every other assertion here and
    // silently stop enforcing blocking validations.
    // Tolerant of the type generic and the line break the call is written across:
    //   hrmsApi.post<{ id: string; grnNumber: string }>(\n  "/api/finance/grns",
    const posCreate = src.search(/hrmsApi\.post(<[^>]*>)?\(\s*"\/api\/finance\/grns"/);
    const posRevalidate = src.indexOf("/revalidate");
    const posSubmit = src.indexOf("/submit");
    expect(posCreate, "the create call must exist").toBeGreaterThan(-1);
    expect(posRevalidate).toBeGreaterThan(-1);
    expect(posSubmit).toBeGreaterThan(-1);
    expect(posRevalidate, "revalidate is declared before submit").toBeLessThan(posSubmit);
  });

  it("still gates submission on the validation result rather than submitting blind", () => {
    expect(src).toMatch(/blocking|is_blocking|canSubmit|readiness/i);
  });

  it("still distinguishes vendor from imprest", () => {
    // The two write to different endpoints; collapsing them would send imprest rows through
    // the vendor GST component path.
    expect(src).toMatch(/grnType\s*===\s*["']vendor["']|isVendor/);
  });

  it("still sends the declared invoice total for reconciliation", () => {
    // The server compares this against the sum of components and refuses a mismatch. Dropping
    // it would remove the only client-side half of that reconciliation.
    expect(src).toContain("declaredInvoiceTotal");
  });

  it("still uploads documents as multipart form data", () => {
    // Anything else reaches the server without a file, and the sha256 hash is computed from
    // the stored file — no file, no hash, no duplicate detection.
    expect(src).toMatch(/FormData/);
  });
  it("keeps the sections in the legacy-skin order", () => {
    // Requirement 3: the raiser keys the invoice header, classifies and splits the spend,
    // attaches the document, lets extraction fill what it can, then checks.
    //
    // Reordered 2026-08-21 for the raiser's explicit requested sequence (legacy-skin re-do +
    // density pass): Save/Submit moved to the true end of the form, past Attachments and the
    // cost-centre split table, which means Budget Allocation now precedes Attachments instead
    // of following it. "Amount" and "Readiness" stopped being their own titled cards in the
    // same pass — Amount is now an inline DenseField label inside the Details grid, and
    // Readiness moved out of the form entirely into the horizontal status strip beside the
    // Vendor/Imprest toggle — so neither is a meaningful in-form ordering marker any more.
    //   "── Proof section (inline within card) ──" -> '<DenseSection title="Attachments" variant="panel" />'
    //   "── Budget Allocation section ──"           -> "── Budget Allocation section (Vendor only now"
    //   title="Amount" / title="Readiness"          -> dropped (no longer distinct sections)
    //
    // Every ordering assertion below still fails if a section is dropped or resequenced —
    // it just now reflects the order the raiser actually asked for.
    const order = [
      "── Details — Dense grid layout ──",
      "── Budget Allocation section (Vendor only now",
      '<DenseSection title="Attachments" variant="panel" />',
      'title="Read from the invoice"',
      'title="Checks"',
    ];
    const positions = order.map((marker) => {
      const at = src.indexOf(marker);
      expect(at, `${marker} must still be present`).toBeGreaterThan(-1);
      return at;
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${order[i]} must follow ${order[i - 1]}`).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("keeps the upload ahead of the extraction that reads it", () => {
    // The section order looks cosmetic and is not. Gemini extraction fills the fields ABOVE the
    // upload, so moving Attachments to the end — which a naive reading of "documents last" would
    // do — leaves auto-fill with nothing to fill.
    //
    // Both positions are asserted present before they are compared. Previously this read
    // `indexOf(A) < indexOf(B)` directly, which passes when A is ABSENT — indexOf returns -1,
    // and -1 is less than any real index. That is exactly what happened when an earlier refactor
    // renamed the Proof anchor: this test kept passing while the marker it names had ceased to
    // exist, so it went silently blind to the very reordering it exists to catch.
    const proofAt = src.indexOf('<DenseSection title="Attachments" variant="panel" />');
    const extractionAt = src.indexOf('title="Read from the invoice"');
    expect(proofAt, "the Attachments/upload section must be present").toBeGreaterThan(-1);
    expect(extractionAt, "the extraction section must be present").toBeGreaterThan(-1);
    expect(proofAt).toBeLessThan(extractionAt);
  });

  it("still offers multi-month recognition on the form", () => {
    // Requirement 5's panel lives inside this form; losing it in a restructure would silently
    // send every invoice back to single-month.
    expect(src).toContain("<MonthSplitPanel");
    expect(src).toContain("recognitionStartPeriod");
  });
});
