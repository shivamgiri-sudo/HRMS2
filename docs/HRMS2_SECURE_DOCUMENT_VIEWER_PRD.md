# HRMS2 Secure Document Viewer PRD

## Scope

The secure viewer supports candidate onboarding documents for HR, Payroll HR, BGV, JCLR, and onboarding bridge use cases.

## APIs

- `GET /api/ats/candidates/:candidateId/documents`
- `GET /api/ats/documents/:documentId/metadata`
- `GET /api/ats/documents/:documentId/preview-url`
- `GET /api/ats/documents/:documentId/stream`
- `GET /api/ats/documents/:documentId/download`
- `POST /api/ats/documents/:documentId/verify`
- `POST /api/ats/documents/:documentId/reject`
- `POST /api/ats/documents/:documentId/request-reupload`
- `GET /api/ats/documents/:documentId/audit`

## Frontend

Primary integration is in `/ats/joining-control-room` under Uploaded Documents. Reusable components live under `src/components/documents`.

## Viewer Features

PDF/image preview, unsupported fallback, zoom, rotate, fullscreen, authorized download, verification, rejection, re-upload request, watermark, metadata, and audit timeline.
