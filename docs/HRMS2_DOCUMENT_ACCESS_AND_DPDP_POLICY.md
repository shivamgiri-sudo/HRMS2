# HRMS2 Document Access and DPDP Policy

## Access

Candidate documents are accessed only through protected `/api/ats/documents/*` endpoints. Raw file paths are not returned to the UI.

## Audit

Every list, metadata, preview, stream, download, verify, reject, re-upload, and audit action is recorded in `candidate_document_access_log`.

## Masking

Sensitive document names are masked in API responses. The viewer fetches secure streams using the logged-in bearer token and renders object URLs in memory.

## DPDP

Document review requires purpose-wise consent for `document_review`. Withdrawal is tracked and reflected in the Joining Control Room readiness gate.
