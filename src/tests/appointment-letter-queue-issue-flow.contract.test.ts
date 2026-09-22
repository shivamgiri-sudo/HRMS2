import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * BUGS.docx: "I have released 3 appointment letters, but it is still showing
 * 0 issued." Confirmed against the live database — appointment_letter_issue
 * had zero rows org-wide. Root cause: the drawer's "Issue" button called
 * issue(row, ...) and then closeDrawer() unconditionally. issue() swallows its
 * own errors into a page-level `error` string instead of throwing (so a
 * cancelled override-reason prompt, or any API failure — e.g. a warning that
 * needed force=true, or a blocker) still let the drawer close as if the
 * letter had gone out. The drawer is a `fixed inset-0` full-screen overlay,
 * so the page's error banner underneath was invisible while it was open —
 * the only visible feedback was the drawer disappearing, which reads as
 * success by the same convention every other modal in this app uses.
 */
const page = readFileSync(
  resolve(process.cwd(), "src/pages/NativeAppointmentLetterQueue.tsx"),
  "utf8",
);

describe("Appointment Letter Queue — issue drawer only closes on success", () => {
  it("issue() reports success/failure to its caller instead of only setting page state", () => {
    const fn = page.slice(page.indexOf("const issue = async"), page.indexOf("const revoke = async"));
    expect(fn).toContain("Promise<boolean>");
    expect(fn).toContain("return true;");
    expect(fn).toContain("return false;");
  });

  it("the drawer's Issue button closes only when issue() succeeded", () => {
    const button = page.slice(
      page.indexOf('onClick={async () => {\n                      const row = drawer.row;'),
      page.indexOf("Issue with override"),
    );
    expect(button).toContain("const succeeded = await issue(row");
    expect(button).toContain("if (succeeded) closeDrawer();");
    expect(button).not.toMatch(/await issue\(row[^;]*\);\s*closeDrawer\(\);/);
  });

  it("a failed or cancelled issue attempt is visible inside the drawer itself, not only on the page underneath", () => {
    // The drawer overlay is `fixed inset-0`, which covers the page-level error
    // banner entirely, so the drawer needs its own copy of that feedback.
    expect(page).toContain('className="fixed inset-0 z-50 flex justify-end"');
    expect(page.slice(page.indexOf("{/* Footer actions */}"))).toContain('drawer.mode === "preview" && error &&');
  });
});

/**
 * Second pass on the same bug: window.prompt() for the override reason is
 * itself a plausible reason issuance never succeeded even once — every
 * eligible candidate carries at least one warning today, so every issuance
 * needs this reason, and a native prompt is trivial to dismiss without
 * realizing an action was waiting on it, with zero trace either way if it is.
 * Replaced with an inline field the Issue button's own disabled state depends
 * on, so the button simply cannot be clicked with no reason recorded.
 */
describe("Appointment Letter Queue — override reason is an inline field, not window.prompt()", () => {
  it("issue() takes the reason as a parameter instead of calling window.prompt() itself", () => {
    const fn = page.slice(page.indexOf("const issue = async"), page.indexOf("const markLeft = async"));
    expect(fn).not.toContain("window.prompt");
    expect(fn).toContain("overrideReason: string | null");
  });

  it("the drawer renders a bound textarea for the reason when warnings are present", () => {
    expect(page).toContain('id="override-reason"');
    expect(page).toContain("value={overrideReasonInput}");
    expect(page).toContain("onChange={(e) => setOverrideReasonInput(e.target.value)}");
  });

  it("the Issue button is disabled until a reason is typed, for a candidate with warnings", () => {
    const button = page.slice(page.indexOf('type="button"\n                    disabled={busy'), page.indexOf("Issue with override"));
    expect(button).toContain("drawer.row.warnings.length > 0 && !overrideReasonInput.trim()");
  });

  it("closing the drawer clears the reason field, so it cannot leak into the next candidate", () => {
    const closeDrawerFn = page.slice(page.indexOf("const closeDrawer = useCallback"), page.indexOf("}, []);"));
    expect(closeDrawerFn).toContain('setOverrideReasonInput("");');
  });
});
