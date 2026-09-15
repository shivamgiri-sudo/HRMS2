import { describe, expect, it } from "vitest";
import { detectDiallerProcess } from "@/pages/DiallerLivePanel";
import { detectLiveDashboard } from "../../backend/src/modules/process-live-dashboard/live-dashboard-keys";

/**
 * The frontend picks which live dashboard a process opens (detectDiallerProcess);
 * the backend decides which /api/process-live groups a viewer may read from the
 * same process names (detectLiveDashboard). If they disagree, a user's own
 * dashboard answers 403, or a process opens a dashboard its viewers may not read.
 */

// Active process_master names, 2026-09-15, plus names that must NOT match.
const NAMES = [
  "Bla Bli Blu", "Bluevine Technologies", "INBOUND CUSTOMER SERVICES", "Reginald",
  "Reginald Email", "Molecular Email", "Finnable", "GS1", "GNC", "Bella-Vita Organic",
  "Clovia", "Neemans Private Limited", "Viega", "Exicom", "DU Digital", "Onfido",
  "Dalmia Cement", "Housing Owner", "Domestic Billing", "B-3 IB", "Appriciate Wealth",
];

describe("live dashboard: frontend and backend agree on which process opens which dashboard", () => {
  it.each(NAMES)("%s", (name) => {
    expect(detectLiveDashboard(name)).toBe(detectDiallerProcess(name));
  });

  it("gives the Bla Bli Blu inbound dashboard to Bla Bli Blu only", () => {
    expect(detectDiallerProcess("Bla Bli Blu")).toBe("inbound");
    // Separate processes whose names merely resemble it.
    for (const other of ["Bluevine Technologies", "INBOUND CUSTOMER SERVICES"]) {
      expect(detectDiallerProcess(other)).toBeNull();
      expect(detectLiveDashboard(other)).toBeNull();
    }
  });

  it("maps Dalmia by process code on the backend (the frontend opens it from the Sales view)", () => {
    expect(detectLiveDashboard("Dalmia Cement", "DALMIA_CEMENT")).toBe("dalmia");
  });
});
