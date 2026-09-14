import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * The Joining Documents Tracker, and the drill-down it navigates to.
 *
 * Three symptoms reported from live, all pinned here:
 *
 *  1. "Name search is not working." It was: the box fed the react-query key
 *     directly, so every keystroke fired a request, and `keepPreviousData` held
 *     the old rows on screen while seven of them raced. With the backend query
 *     also taking ~6s each, the page looked like it was ignoring the search.
 *  2. Onboarding, joining and salary dates were absent from a page whose job is
 *     to say how far along someone's joining formalities are.
 *  3. Opening an e-signed document showed the browser's blocked-content
 *     placeholder — an <iframe> was handed a Word file, which no browser
 *     renders, with no message and no way forward.
 */
const trackerPage = readFileSync(
  resolve(process.cwd(), "src/pages/JoiningDocumentsTrackerPage.tsx"),
  "utf8",
);
const documentsPage = readFileSync(
  resolve(process.cwd(), "src/pages/EmployeeJoiningDocumentsPage.tsx"),
  "utf8",
);

describe("Joining Documents Tracker — search", () => {
  it("queries on the debounced value, never on the raw input", () => {
    expect(trackerPage).toContain("appliedSearch");
    // The query key and the request must both read the debounced state. If the
    // raw box reached either one, the debounce is decoration.
    expect(trackerPage).toMatch(/queryKey:\s*\["joining-documents-tracker",\s*\{\s*search:\s*appliedSearch/);
    expect(trackerPage).toMatch(/params\.set\("search",\s*appliedSearch\)/);
    expect(trackerPage).not.toMatch(/params\.set\("search",\s*search\)/);
  });

  it("debounces through a timer that is cleared on the next keystroke", () => {
    expect(trackerPage).toMatch(/setTimeout\(\(\)\s*=>\s*\{[\s\S]*setAppliedSearch/);
    expect(trackerPage).toContain("clearTimeout(t)");
  });
});

describe("Joining Documents Tracker — milestone dates", () => {
  it("renders the onboarding, joining and salary dates as columns", () => {
    for (const header of ["Onboarding", "Joining", "Salary"]) {
      expect(trackerPage).toContain(`>${header}</th>`);
    }
    expect(trackerPage).toContain("row.onboarding_submitted_at");
    expect(trackerPage).toContain("row.date_of_joining");
    expect(trackerPage).toContain("row.salary_assigned_at");
  });

  it("shows a dash for a milestone that has not happened, not an empty cell", () => {
    const cell = trackerPage.slice(trackerPage.indexOf("function MilestoneDateCell"));
    expect(cell).toContain("—");
    // IST, so a timestamp stored at IST midnight is not rendered as the day before.
    expect(cell).toContain("formatISTDate(value)");
  });
});

describe("Employee joining documents — preview", () => {
  it("does not frame a file the browser cannot render", () => {
    expect(documentsPage).toContain("previewKind");
    // The iframe must sit behind the type check, not before it.
    const modal = documentsPage.slice(documentsPage.indexOf("{previewUrl && ("));
    expect(modal).toContain('previewKind === "unsupported"');
    expect(modal.indexOf('previewKind === "unsupported"')).toBeLessThan(modal.indexOf("<iframe"));
  });

  it("offers a download instead of a blank frame for an unsupported type", () => {
    const modal = documentsPage.slice(documentsPage.indexOf("{previewUrl && ("));
    expect(modal).toContain("downloadFile(previewSource?.id");
  });

  it("treats a missing Content-Type as a PDF rather than as an unnamed download", () => {
    expect(documentsPage).toContain('blob.type || "application/pdf"');
  });
});
