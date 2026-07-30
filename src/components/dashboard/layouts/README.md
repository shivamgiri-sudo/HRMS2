# Legacy dashboard layouts — superseded, not in use

These seven files (~2,555 lines) have **zero import sites anywhere in `src/`**. Verified
2026-07-30 by searching for both `layouts/<Name>` and `from "./<Name>"`.

Every role dashboard now renders through:

- `src/pages/dashboards/ReferenceRoleDashboard.tsx` — the single fan-out engine
- `src/pages/dashboards/reference/*ReferenceLayout.tsx` — the 12 role layouts

## Why they are still here

`CLAUDE.md` rule 3 forbids deleting existing page flows to simplify implementation.
They are retained for reference and account for a share of the repository's frontend
typecheck errors (`FinanceLayout.tsx` references an undefined `payrollData`;
`HrAdminLayout.tsx` treats query results as `unknown`).

## Why they must not be revived as-is

Several contain fabricated figures rather than sourced data, which breaches rule 10
("no mock metrics in production flows"). Examples:

- derived headcounts of the form `Math.round(totalEmployees * 0.92)`
- hardcoded targets and percentages with no backing query

If any panel here is worth keeping, port the **panel** into the corresponding
`*ReferenceLayout.tsx` and wire it to a real metric or endpoint — do not re-mount these
files.

## Removal

Deleting them is a separate, approved change. Until then nothing imports them and they
have no runtime effect.
