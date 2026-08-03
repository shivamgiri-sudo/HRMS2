# Fresh-schema certification

`backend/scripts/verify-performance-fresh-schema.ts` builds a disposable MySQL database from the canonical migration manifest through `522_performance_governance_audit.sql`.

The verifier is destructive by design but refuses non-loopback hosts and requires a database name beginning with `hrms_migration_test_`. It records every successful migration, validates the Performance Platform tables and lineage columns, and performs a second pass proving that no recorded migration is reapplied.

The GitHub Actions workflow `Performance Fresh Schema Certification` runs this rehearsal before typechecking, focused safety tests and the backend production build. Historical migration defects must be fixed at their source; the verifier must not suppress duplicate-column, missing-table, incompatible-foreign-key or syntax errors.

Canonical journey migrations must create every table they later enhance. Migration 138 now bootstraps its onboarding-profile and ATS-notification tables, and guards MySQL indexes and compatibility columns through `INFORMATION_SCHEMA` rather than unsupported `IF NOT EXISTS` DDL syntax.
