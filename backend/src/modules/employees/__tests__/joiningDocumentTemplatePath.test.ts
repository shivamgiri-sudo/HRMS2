import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";

import {
  TEMPLATE_STORAGE_ROOT,
  resolveTemplateFile,
  templateFileExists,
  toStorableTemplatePath,
} from "../joiningDocumentTemplatePath.js";

/**
 * Production stores template paths that were written on a developer's Windows
 * machine, e.g.
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\document-templates\NDA_CONFIDENTIALITY-v1.docx
 *
 * Eight of nine live templates look like that — including all eight requiring an
 * e-signature. fs.existsSync() on the Linux server returns false for every one,
 * so assertTemplateConfiguredForEsign throws 409 and no signing link can be
 * issued. 44 employees sit in pending_candidate_esign and 6 in esign_initiated
 * because of it.
 */

const FIXTURE = "NDA_CONFIDENTIALITY-v1.docx";
const WINDOWS_PATH = String.raw`C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private-storage\document-templates\${FIXTURE}`
  .replace("${FIXTURE}", FIXTURE);

let createdDir = false;
let createdFile = false;

beforeAll(() => {
  if (!fs.existsSync(TEMPLATE_STORAGE_ROOT)) {
    fs.mkdirSync(TEMPLATE_STORAGE_ROOT, { recursive: true });
    createdDir = true;
  }
  const target = path.join(TEMPLATE_STORAGE_ROOT, FIXTURE);
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, "fixture");
    createdFile = true;
  }
});

afterAll(() => {
  const target = path.join(TEMPLATE_STORAGE_ROOT, FIXTURE);
  if (createdFile && fs.existsSync(target)) fs.unlinkSync(target);
  if (createdDir && fs.existsSync(TEMPLATE_STORAGE_ROOT)) {
    try { fs.rmdirSync(TEMPLATE_STORAGE_ROOT); } catch { /* other templates present */ }
  }
});

describe("joining-document template path resolution", () => {
  it("resolves a Windows absolute path to the local file by name", () => {
    const resolved = resolveTemplateFile(WINDOWS_PATH);
    expect(resolved, "a foreign absolute path must still find the file").not.toBeNull();
    expect(path.basename(String(resolved))).toBe(FIXTURE);
    expect(fs.existsSync(String(resolved))).toBe(true);
  });

  it("reports the template as configured, which is what unblocks e-signing", () => {
    // This is the exact predicate assertTemplateConfiguredForEsign uses.
    expect(templateFileExists(WINDOWS_PATH)).toBe(true);
  });

  it("still honours a correct absolute path", () => {
    const direct = path.join(TEMPLATE_STORAGE_ROOT, FIXTURE);
    expect(resolveTemplateFile(direct)).toBe(direct);
  });

  it("returns null for a template that genuinely is not present", () => {
    expect(resolveTemplateFile(String.raw`C:\somewhere\NOT_A_REAL_TEMPLATE-v9.docx`)).toBeNull();
    expect(templateFileExists("")).toBe(false);
    expect(templateFileExists(null)).toBe(false);
  });

  it("persists only the file name so the row stays portable across machines", () => {
    expect(toStorableTemplatePath(WINDOWS_PATH)).toBe(FIXTURE);
    expect(toStorableTemplatePath(path.join(TEMPLATE_STORAGE_ROOT, FIXTURE))).toBe(FIXTURE);
  });

  it("does not treat a directory as a usable template", () => {
    expect(resolveTemplateFile(TEMPLATE_STORAGE_ROOT)).toBeNull();
  });
});
