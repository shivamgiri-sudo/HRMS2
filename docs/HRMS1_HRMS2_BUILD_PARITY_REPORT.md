# HRMS1 / HRMS2 Build Parity Report

Audit date: 2026-06-26

## Local State Caveats

- HRMS1 local checkout: `main`, clean, behind `origin/main` by 16 commits.
- HRMS2 local checkout: `main`, at `origin/main`, dirty due to untracked `backend/debug-ncosec-schema.ts`.
- HRMS2 was not pulled because the working tree was dirty.

## Build Results

| Check | HRMS1 | HRMS2 | Parity |
| --- | --- | --- | --- |
| Backend `npm run build` | failed | passed | mismatch |
| Frontend `npm run build` | passed | failed | mismatch |
| `npm run phase2:smoke:static` | passed after frontend build | not run because frontend build failed | mismatch |

## Failure Summary

### HRMS1 Backend

`npm run build` failed. Representative errors included missing modules/types such as `mssql`, `compression`, `helmet`, `morgan`, `express-rate-limit`, `nodemailer`, `multer`, `axios`, `jsonwebtoken`, `pdfkit`, `twilio`, and many TypeScript type errors around `string | string[]`.

### HRMS2 Frontend

`npm run build` failed because Vite could not be resolved from the local install:

```txt
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite'
```

### HRMS1 Frontend

`npm run build` completed. The version update step skipped because `bash` is not available on this Windows shell, but the Vite build completed and `phase2:smoke:static` passed.

### HRMS2 Backend

`npm run build` completed successfully.

## Conclusion

Build parity does not pass.
