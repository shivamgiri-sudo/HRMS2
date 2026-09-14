/**
 * The eSign completion path passed the WRONG identifiers to the provider.
 *
 * downloadESignDocument was called with the checklist UUID as `clientTransactionId`
 * and our own employee_document_esign_transaction primary key as `transactionId`.
 * Luckpay has never seen either value, so every download failed, every signature
 * was recorded as 'aadhaar_esign_pending_artefact', and no signed artefact was
 * ever stored — verified on production: an employee completed a genuine Aadhaar
 * eSign and the row still read status=PENDING, signed_file_id=NULL.
 *
 * The provider's identifiers are:
 *   clientTransactionId -> the `client_transaction_id` column ("joining-doc-<uuid>")
 *   transactionId       -> the `provider_reference_id` column, its gatewayId ("APIB…")
 *
 * These are source-level contracts: they fail against the pre-fix code.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const SERVICE = path.resolve(__dirname, "../employeeJoiningDocuments.service.ts");
const source = fs.readFileSync(SERVICE, "utf8");

/** Body of finalizeChecklistEsign, where the provider download happens. */
function finalizeBody() {
  const start = source.indexOf("async function finalizeChecklistEsign");
  expect(start, "finalizeChecklistEsign must exist").toBeGreaterThan(-1);
  // Far enough to cover the download block without running into later functions.
  return source.slice(start, start + 4000);
}

/** Body of the webhook handler, which resolves the transaction row. */
function webhookBody() {
  const start = source.indexOf("export async function handleJoiningDocumentEsignWebhook");
  expect(start, "handleJoiningDocumentEsignWebhook must exist").toBeGreaterThan(-1);
  return source.slice(start, start + 6000);
}

describe("eSign provider identifiers", () => {
  it("never passes the checklist id to downloadESignDocument", () => {
    const body = finalizeBody();
    const call = body.slice(body.indexOf("downloadESignDocument"), body.indexOf("downloadESignDocument") + 400);
    expect(call).not.toContain("params.checklist.id");
  });

  it("never passes our own transaction primary key as the provider transaction id", () => {
    const body = finalizeBody();
    const idx = body.indexOf("downloadESignDocument");
    const call = body.slice(idx, idx + 400);
    // `transactionId: params.transactionId` was the bug. Our PK is still used for
    // the UPDATE ... WHERE id = ? further down, which is correct — so this
    // assertion is deliberately scoped to the download call only.
    expect(call).not.toMatch(/transactionId:\s*params\.transactionId/);
  });

  it("passes the provider's own identifiers to downloadESignDocument", () => {
    const body = finalizeBody();
    const idx = body.indexOf("downloadESignDocument");
    const call = body.slice(idx, idx + 400);
    expect(call).toMatch(/clientTransactionId:\s*params\.clientTransactionId/);
    expect(call).toMatch(/transactionId:\s*params\.providerReferenceId/);
  });

  it("accepts both provider identifiers as parameters", () => {
    const body = finalizeBody();
    expect(body).toMatch(/clientTransactionId\?:\s*string \| null/);
    expect(body).toMatch(/providerReferenceId\?:\s*string \| null/);
  });

  it("selects the provider identifier columns in the webhook lookup", () => {
    // Without these columns in the SELECT, the fix above has nothing to pass on.
    const body = webhookBody();
    expect(body).toContain("client_transaction_id");
    expect(body).toContain("provider_reference_id");
  });

  it("scopes the webhook transaction lookup to the luckpay provider", () => {
    expect(webhookBody()).toMatch(/provider\s*=\s*'luckpay'/);
  });

  it("forwards the resolved identifiers from the webhook into finalisation", () => {
    const body = webhookBody();
    expect(body).toMatch(/clientTransactionId:\s*tx\.client_transaction_id/);
    expect(body).toMatch(/providerReferenceId:\s*tx\.provider_reference_id/);
  });
});

describe("signed artefact retrieval", () => {
  const STATUS = path.resolve(
    __dirname,
    "../../integrations/luckpay/luckpay-status.service.ts",
  );
  const statusSource = fs.readFileSync(STATUS, "utf8");

  it("stores joining-document artefacts in the joining-document tree", () => {
    // persistDocument's default is the onboarding tree; a joining document
    // written there is invisible to every joining-document reader.
    expect(statusSource).toContain("joiningDocumentStorageDir");
    expect(statusSource).toContain("private-storage/employee-joining-documents");
  });

  it("recalculates document progress after marking a document signed", () => {
    // Without this the employee is stuck below 100% with every document signed.
    expect(statusSource).toContain("recalculateDocumentProgress");
  });

  it("writes fill_status and signature_mode alongside status", () => {
    // status alone leaves the document reading signed on one screen and unsigned
    // on another.
    expect(statusSource).toMatch(/fill_status\s*=\s*'esign_completed'/);
    expect(statusSource).toContain("signature_mode");
  });

  it("only claims a verified signature when the artefact was actually retrieved", () => {
    expect(statusSource).toContain("aadhaar_esign_pending_artefact");
  });
});
