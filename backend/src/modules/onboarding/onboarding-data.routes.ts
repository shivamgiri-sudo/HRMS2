import { Router } from "express";
import { OnboardingDataService } from "./onboarding-data.service.js";

const router = Router();

// No auth required for master data endpoints (public lookup)

router.get("/banks", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getBanks() });
});

router.get("/address-proof-types", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getAddressProofTypes() });
});

router.get("/states", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getStates() });
});

router.get("/qualifications", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getQualifications() });
});

router.get("/designations", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getDesignations() });
});

router.get("/account-types", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getAccountTypes() });
});

router.get("/employment-types", (_req, res) => {
  res.json({ success: true, data: OnboardingDataService.getEmploymentTypes() });
});

// IFSC lookup — return branch details for a given IFSC code
router.get("/ifsc/:code", async (req, res) => {
  const { code } = req.params;
  if (!code || code.length < 4) {
    return res.status(400).json({ success: false, error: "Invalid IFSC code" });
  }
  try {
    const data = await OnboardingDataService.lookupIFSC(code);
    res.json({ success: !!data, data: data ?? null });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// Cheque OCR — extract name from uploaded cheque image
router.post("/cheque-ocr", async (req, res) => {
  const { fileUrl } = req.body;
  if (!fileUrl) {
    return res.status(400).json({ success: false, error: "fileUrl required" });
  }
  try {
    const name = await OnboardingDataService.extractChequeOCR(fileUrl);
    res.json({ success: !!name, data: { extractedName: name ?? null } });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

export { router as onboardingDataRouter };
