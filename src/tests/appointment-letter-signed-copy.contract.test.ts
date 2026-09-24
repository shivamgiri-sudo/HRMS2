import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Owner report: "candidates are e-signing the appointment letter but the signed
 * copy is not visible in HRMS". The employee-signed file was stored on
 * appointment_letter_esign_transaction while every screen read only
 * appointment_letter_issue.signed_file_path (the company-signed original). These
 * pins keep each surface pointed at the signed copy.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const queue = read("src/pages/NativeAppointmentLetterQueue.tsx");
const joining = read("src/pages/EmployeeJoiningDocumentsPage.tsx");

describe("Appointment Letter Queue — signed copy", () => {
  it("uses the shared row buttons instead of a hard-wired PDF button", () => {
    expect(queue).toContain("<IssuedDownloadButtons row={row} onDownload={(copy) => void download(row, copy)} />");
    expect(queue).not.toMatch(/<Download className="h-4 w-4" \/> PDF\s*<\/button>/);
  });

  it("download() defaults to the original, and asks for ?copy=accepted with the -accepted.pdf name only when told to", () => {
    const fn = queue.slice(queue.indexOf("const download = async"), queue.indexOf("const counts"));
    expect(fn).toContain('copy: LetterCopy = "original"');
    expect(fn).toContain('copy === "accepted" ? "?copy=accepted" : ""');
    expect(fn).toContain("-accepted.pdf");
    expect(fn).toContain("hrmsApi.getBlob");
  });

  it("the drawer defaults to the employee-signed copy when there is one, and loads the chosen copy through getBlob", () => {
    expect(queue).toContain('drawer.row.has_accepted_copy ? (copyChoice ?? "accepted") : "original"');
    expect(queue).toContain('download?inline=1${drawerCopy === "accepted" ? "&copy=accepted" : ""}');
    const effect = queue.slice(queue.indexOf("// Fetch PDF whenever the drawer opens"), queue.indexOf("// Resend history for an issued letter"));
    expect(effect).toContain("}, [drawer, drawerCopy]);");
    expect(effect).toContain("hrmsApi.getBlob");
  });

  it("the drawer has the segmented toggle, the accepted timestamp/hash summary and the Accepted badge", () => {
    expect(queue).toContain("<LetterCopyToggle value={drawerCopy} onChange={setCopyChoice} />");
    expect(queue).toContain("<AcceptedCopySummary row={drawer.row} />");
    expect(queue).toMatch(/signed: "Accepted"/);
    expect(queue).toContain("{esignLabel(drawer.row.employee_esign_status)}");
  });

  it("closing the drawer forgets the choice so the next letter starts on its own default", () => {
    const close = queue.slice(queue.indexOf("const closeDrawer"), queue.indexOf("// Fetch PDF whenever"));
    expect(close).toContain("setCopyChoice(null)");
  });

  it("says so when a letter is accepted but the employee's file was not retrieved", () => {
    expect(queue).toContain("their signed file has not been retrieved yet");
  });
});

describe("Employee Joining Documents page — signed appointment letter", () => {
  it("renders the panel from the pack's signed_appointment_letters", () => {
    expect(joining).toContain("signed_appointment_letters?: SignedAppointmentLetter[]");
    expect(joining).toContain("letters={pack?.signed_appointment_letters ?? []}");
  });

  it("the panel calls the employee-scoped signed-copy route", () => {
    const panel = read("src/components/letters/SignedAppointmentLetterPanel.tsx");
    expect(panel).toContain("/api/employees/${employeeId}/joining-documents/appointment-letters/${letter.issue_id}/signed-copy");
    expect(panel).toContain("hrmsApi.getBlob");
  });
});
