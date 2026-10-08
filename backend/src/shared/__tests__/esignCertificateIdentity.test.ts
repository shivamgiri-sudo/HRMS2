import { describe, expect, it } from "vitest";
import {
  extractEsignCertificateIdentity,
  extractLatestEsignCertificateIdentity,
} from "../esignCertificateIdentity.js";
import { appendSignature, basePdf } from "./esignFixtures.js";

const COMPANY = { cn: "Mas Callnet India Pvt. Ltd." };
const EMPLOYEE = { cn: "SUJEET VISHWAKARMA", issuerCn: "e-Mudhra Sub CA for eKYC" };
const OTHER = { cn: "Shivam Shiv Giri", issuerCn: "e-Mudhra Sub CA for eKYC" };

const companySigned = () => appendSignature(basePdf(), COMPANY);
const twoSignature = () => appendSignature(companySigned(), EMPLOYEE);

describe("extractLatestEsignCertificateIdentity", () => {
  it("returns the employee (last) identity when the company signed first", () => {
    const id = extractLatestEsignCertificateIdentity(twoSignature());
    expect(id?.commonName).toBe("SUJEET VISHWAKARMA");
    expect(id?.issuerCommonName).toBe("e-Mudhra Sub CA for eKYC");
  });

  it("the old first-signature extractor really does return the company here (the bug)", () => {
    expect(extractEsignCertificateIdentity(twoSignature())?.commonName).toBe("Mas Callnet India Pvt. Ltd.");
  });

  it("returns null for a company-only file, so the caller reports 'unverifiable'", () => {
    expect(extractLatestEsignCertificateIdentity(companySigned())).toBeNull();
  });

  it("skips a named company CN even when its certificate is CA-issued", () => {
    const caCompany = { cn: "Mas Callnet India Pvt. Ltd.", issuerCn: "Some Licensed CA" };
    const pdf = appendSignature(appendSignature(basePdf(), caCompany), EMPLOYEE);
    expect(extractLatestEsignCertificateIdentity(pdf, { excludeCommonNames: ["mas callnet india pvt. ltd."] })?.commonName)
      .toBe("SUJEET VISHWAKARMA");
    expect(extractLatestEsignCertificateIdentity(appendSignature(basePdf(), caCompany), {
      excludeCommonNames: ["Mas Callnet India Pvt. Ltd."],
    })).toBeNull();
  });

  it("picks the signature covering the most bytes, not the one earliest in the file", () => {
    // Employee signature sits first in the file but its /ByteRange reaches furthest.
    const first = appendSignature(basePdf(), OTHER, { coversUpTo: 900_000 });
    const pdf = appendSignature(first, EMPLOYEE, { coversUpTo: 500_000 });
    expect(extractLatestEsignCertificateIdentity(pdf)?.commonName).toBe("Shivam Shiv Giri");
  });

  it("falls back to file order when there is no usable /ByteRange", () => {
    const pdf = twoSignature().toString("latin1").replace(/\/ByteRange \[[^\]]*\]/g, "/ByteRange [x]");
    expect(extractLatestEsignCertificateIdentity(Buffer.from(pdf, "latin1"))?.commonName).toBe("SUJEET VISHWAKARMA");
  });

  it("never throws on malformed input", () => {
    for (const bad of [
      Buffer.alloc(0),
      Buffer.from("not a pdf"),
      Buffer.from("%PDF /Contents <" + "zz".repeat(300) + ">"),
      Buffer.from("%PDF /Contents <" + "ab".repeat(300) + ">"),
      Buffer.from("%PDF /ByteRange [0 1 2 /Contents <"),
    ]) {
      expect(() => extractLatestEsignCertificateIdentity(bad)).not.toThrow();
      expect(extractLatestEsignCertificateIdentity(bad)).toBeNull();
    }
  });
});

describe("extractEsignCertificateIdentity (joining kit) is unchanged", () => {
  it("a single-signature PDF returns that signer", () => {
    const pdf = appendSignature(basePdf(), OTHER);
    expect(extractEsignCertificateIdentity(pdf)?.commonName).toBe("Shivam Shiv Giri");
    expect(extractLatestEsignCertificateIdentity(pdf)?.commonName).toBe("Shivam Shiv Giri");
  });

  it("returns null for an unsigned PDF and for garbage", () => {
    expect(extractEsignCertificateIdentity(basePdf())).toBeNull();
    expect(extractEsignCertificateIdentity(Buffer.from("junk"))).toBeNull();
  });
});
