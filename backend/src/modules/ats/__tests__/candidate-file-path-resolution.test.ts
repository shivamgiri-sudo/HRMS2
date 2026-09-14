import fs from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CANDIDATE_FILES_ROOT, resolveCandidateFilePath } from "../candidate-file.service.js";

/**
 * A candidate file must remain downloadable even when storage_path names a machine
 * that is not this one.
 *
 * WHY
 * storage_path is written absolute at upload time, so a file uploaded from a
 * developer's Windows box against the shared database records
 *   C:\Users\ADMIN\Desktop\HRMS2-latest\backend\private\ats-candidate-files\<id>\<file>
 * which cannot exist on the Linux production server. Verified live 2026-08-16:
 * 5 of 2,238 ats_candidate_file rows carry such a path.
 *
 * The download route used storage_path raw, so those rows failed fs.existsSync and
 * returned 404 "File not found" — indistinguishable from a deleted file, and the
 * access audit recorded "Stored file missing on disk", so the log corroborated the
 * wrong conclusion. The bytes were on disk the whole time.
 *
 * This is the same defect class that blocked joining-document e-signing for three
 * weeks, already solved for templates by resolveTemplateFile(). These tests use the
 * real filesystem under CANDIDATE_FILES_ROOT so the Windows-path case is exercised
 * on a POSIX runner, which is the only place it actually reproduces.
 */
const CANDIDATE_ID = "test-cand-0000-1111-2222-333344445555";
const STORED_NAME = "aaaabbbb-cccc-dddd-eeee-ffff00001111.pdf";
const dir = path.join(CANDIDATE_FILES_ROOT, CANDIDATE_ID);
const realPath = path.join(dir, STORED_NAME);

beforeAll(() => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(realPath, "test bytes");
});

afterAll(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("resolveCandidateFilePath", () => {
  it("uses storage_path when it resolves on this machine", () => {
    expect(
      resolveCandidateFilePath({
        storage_path: realPath,
        candidate_id: CANDIDATE_ID,
        stored_filename: STORED_NAME,
      }),
    ).toBe(realPath);
  });

  it("recovers a file whose storage_path is a foreign Windows absolute path", () => {
    // The shape found in production is C:\Users\ADMIN\Desktop\HRMS2-latest\... —
    // but that is THIS machine's real root when the suite runs on the Windows dev
    // box, so using it verbatim makes the test tautological here and meaningful
    // only on the POSIX CI runner. A different user directory keeps it honest on
    // both: the path is unreachable everywhere, so only the fallback can satisfy it.
    const foreign = `C:\\Users\\SomeoneElse\\HRMS2\\backend\\private\\ats-candidate-files\\${CANDIDATE_ID}\\${STORED_NAME}`;
    expect(
      resolveCandidateFilePath({
        storage_path: foreign,
        candidate_id: CANDIDATE_ID,
        stored_filename: STORED_NAME,
      }),
    ).toBe(realPath);
  });

  it("recovers a file whose storage_path is a foreign POSIX absolute path", () => {
    expect(
      resolveCandidateFilePath({
        storage_path: `/home/someoneelse/app/private/ats-candidate-files/${CANDIDATE_ID}/${STORED_NAME}`,
        candidate_id: CANDIDATE_ID,
        stored_filename: STORED_NAME,
      }),
    ).toBe(realPath);
  });

  it("returns null when the file genuinely is not on disk", () => {
    // A real deletion must still read as missing — the fallback must not invent a path.
    expect(
      resolveCandidateFilePath({
        storage_path: path.join(dir, "not-here.pdf"),
        candidate_id: CANDIDATE_ID,
        stored_filename: "not-here.pdf",
      }),
    ).toBeNull();
  });

  it("returns null when the identifying columns are absent", () => {
    expect(resolveCandidateFilePath({ storage_path: "C:\\nope\\x.pdf" })).toBeNull();
    expect(resolveCandidateFilePath({})).toBeNull();
  });

  it("cannot escape the candidate's own directory", () => {
    // stored_filename derives from an uploaded name, so traversal segments must not
    // reach another candidate's files. They are neutralised by taking only the last
    // path segment, which means the result is the file INSIDE this candidate's
    // directory — not null, and never a path outside it. Asserting the resolved
    // location is the point; asserting null would pass for the wrong reason.
    const resolved = resolveCandidateFilePath({
      storage_path: "",
      candidate_id: CANDIDATE_ID,
      stored_filename: `../../${STORED_NAME}`,
    });
    expect(resolved).toBe(realPath);
    expect(path.resolve(resolved!).startsWith(path.resolve(dir))).toBe(true);
  });

  it("cannot escape via a Windows-style traversal either", () => {
    // On Linux "\" is an ordinary filename character, so a naive path.basename()
    // would return the whole string and defeat the guard.
    const resolved = resolveCandidateFilePath({
      storage_path: "",
      candidate_id: CANDIDATE_ID,
      stored_filename: `..\\..\\${STORED_NAME}`,
    });
    expect(resolved).toBe(realPath);
  });
});
