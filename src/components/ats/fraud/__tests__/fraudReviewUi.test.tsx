import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VerdictCard } from "../VerdictCard";
import { SideBySide } from "../SideBySide";
import { DecisionCard } from "../DecisionCard";
import { ReviewChecklist } from "../ReviewRequiredDialog";
import { buildPersonRows, computeVerdict, fraudReviewState, type IdentityComparison } from "@/lib/fraudReview";

const cmp: IdentityComparison = {
  subject: {
    candidateId: "c1", code: "CND-1", displayName: "Rahul Verma", name: "Rahul Verma", dob: "2004-02-18", gender: "Male", fatherName: "Suresh Verma",
    mobileMasked: "XXXXXX3126", aadhaarLast4: "4821", panMasked: "ABCXXXX4E", govt: null, selfieDocId: null,
    hasDigilockerPhoto: false, employee: null,
  },
  other: {
    candidateId: "c2", code: "CND-2", displayName: "Priya Nair", name: "Priya Nair", dob: "2004-02-18", gender: "Male", fatherName: "Suresh Verma",
    mobileMasked: "XXXXXX3126", aadhaarLast4: "4821", panMasked: "ABCXXXX4E",
    govt: { name: "Priya Nair", dob: "2003-09-10", gender: "Female", aadhaarLast4: "6556" },
    selfieDocId: null, hasDigilockerPhoto: true,
    employee: { code: "PN-1042", name: "Priya Nair", status: "Active", joinedOn: "2026-09-11" },
  },
  sharedMobile: true,
  sharedDevice: true,
};

describe("fraud review pieces render", () => {
  it("shows the verdict headline and its reasons", () => {
    const html = renderToStaticMarkup(<VerdictCard verdict={computeVerdict(cmp, { kind: "identity" })} />);
    expect(html).toContain("These look like two different people");
    expect(html).toContain("Strong evidence");
    expect(html).toContain("Date of birth differs");
  });

  it("shows both people, where each fact came from, and whether it matches", () => {
    const html = renderToStaticMarkup(
      <SideBySide
        left={{ title: "This candidate", sub: "Rahul Verma" }}
        right={{ title: "Employee PN-1042", sub: "Priya Nair · Active" }}
        rows={buildPersonRows(cmp)}
      />,
    );
    expect(html).toContain("Employee PN-1042");
    expect(html).toContain("Government verified");
    expect(html).toContain("Typed by candidate");
    expect(html).toContain("Different");
    expect(html).toContain("Same");
    expect(html).toContain("10/09/2003");
  });

  it("offers three plain choices and starts with no decision picked", () => {
    const html = renderToStaticMarkup(
      <DecisionCard
        alertId="a1"
        title="This Aadhaar number is already used by Priya Nair"
        alertType="DUPLICATE_AADHAAR"
        kind="identity"
        verdict={computeVerdict(cmp, { kind: "identity" })}
        saving={false}
        onSave={async () => undefined}
      />,
    );
    expect(html).toContain("False alarm");
    expect(html).toContain("Real problem");
    expect(html).toContain("Need more information");
    expect(html).toContain("This alert was raised in error");
    expect(html).not.toContain("Save decision");
  });
});

describe("fraud review gate", () => {
  const base = { anyUnresolved: 0, blocking: 0, opened: false, acknowledged: false };

  it("never holds up a profile the system did not flag", () => {
    expect(fraudReviewState(base)).toEqual({ needsReview: false, done: false, pending: false });
  });
  it("holds a flagged profile until it is opened, decided and confirmed", () => {
    const flagged = { ...base, anyUnresolved: 1, blocking: 1 };
    expect(fraudReviewState(flagged).pending).toBe(true);
    expect(fraudReviewState({ ...flagged, opened: true, acknowledged: true }).pending).toBe(true); // alert still open
    expect(fraudReviewState({ ...flagged, blocking: 0, opened: true, acknowledged: false }).pending).toBe(true);
    expect(fraudReviewState({ ...flagged, blocking: 0, opened: false, acknowledged: true }).pending).toBe(true);
    expect(fraudReviewState({ ...flagged, blocking: 0, opened: true, acknowledged: true }).pending).toBe(false);
  });
  it("also asks for a look at low-severity flags, without needing a decision on them", () => {
    const minor = { ...base, anyUnresolved: 2, blocking: 0 };
    expect(fraudReviewState(minor).pending).toBe(true);
    expect(fraudReviewState({ ...minor, opened: true, acknowledged: true }).pending).toBe(false);
  });
  it("lists what is still open in the popup", () => {
    const html = renderToStaticMarkup(<ReviewChecklist panelOpened={false} blockingCount={2} acknowledged={false} />);
    expect(html).toContain("Look at the photos and documents");
    expect(html).toContain("(2 still waiting).");
    expect(html).toContain("I have reviewed all fraud flags");
    expect(html.match(/Still to do/g)).toHaveLength(3);
    const done = renderToStaticMarkup(<ReviewChecklist panelOpened blockingCount={0} acknowledged />);
    expect(done.match(/Done/g)).toHaveLength(3);
  });
});

describe("approval is gated on the onboarding requests page", () => {
  const page = readFileSync(path.resolve(__dirname, "../../../../pages/NativeHROnboardingRequests.tsx"), "utf8");

  it("uses the shared gate and only when the system flagged something", () => {
    expect(page).toContain("fraudReviewState({");
    expect(page).toContain("anyUnresolved: fraudAnyCount,");
  });
  it("shows the popup instead of approving, and guards submitReview itself", () => {
    expect(page).toContain("if (status === 'approved' && fraudReviewPending) {");
    expect(page).toContain("setShowReviewDialog(true);");
    expect(page).toContain("<ReviewRequiredDialog");
  });
  it("keeps Approve clickable so it can explain itself", () => {
    expect(page).toContain('disabled={reviewSaving || fraudStatus === "loading" || fraudStatus === "unknown"}');
  });
});
