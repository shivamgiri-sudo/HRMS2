# Task 2 Report: Backend — Single Employee ZIP Download Endpoint

## Status: DONE

## Commit SHA
`ed4b332db8785e89a96510ec047cffa902db9ac5`

## Test Result
4/4 passed — `npx vitest run src/modules/payroll/__tests__/esi-reg-docs.test.ts` — Duration: 1.29s

## What Was Done
1. Added `requireAuth` middleware fix (`esiRegDocsRouter.use(requireAuth)`) — Task 1 review gap resolved.
2. Added imports: `requireAuth`, `path`, `fs`, `pdfkit`, `archiver` with CJS compat pattern.
3. Added `UPLOADS_ROOT` path resolver with Windows drive-letter fix.
4. Added helpers: `generateBankInfoPdf`, `urlToLocalPath`, `fileExists`, `writeAuditLog`.
5. Added `GET /esi-reg-docs/:employeeId/download` route — streams ZIP via archiver, writes audit log.
6. Added `vi.mock("archiver")` with stream-aware mock (pipe captures dest, finalize calls `dest.end()`).
7. Added `vi.mock("authMiddleware")` bypass.
8. Added 2 new tests (404 case + ZIP stream case).

## Concerns
- The archiver mock's `finalize()` calls `dest.end()` directly on the response. This bypasses the real ZIP content but correctly closes the HTTP response so supertest doesn't hang. Real integration requires a running filesystem and actual archiver.
- `writeAuditLog` uses `payroll_audit_trail` — this table must exist in production schema (confirmed created in earlier migrations).
