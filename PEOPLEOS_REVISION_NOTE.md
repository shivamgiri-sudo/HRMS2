# PeopleOS Revision Note — 2026-05-29

This repository is the current MAS Callnet HRMS / PeopleOS development baseline with updated project-governance guidance.

## Architecture Decision Incorporated

The internal LMS has already been independently built and deployed. It must be integrated into HRMS through a controlled Integration Hub, SSO/deep-link and/or approved data-sync approach. It must not be rebuilt as a second operational LMS inside this repository.

## Scope of This Revision

This documentation-only update:

- revises `CLAUDE.md` to protect the deployed LMS and existing working flows;
- updates the repository overview and product boundary in `README.md`;
- adds the revised PeopleOS roadmap, LMS integration blueprint and Phase 0 audit prompt under `docs/peopleos-build/`.

No application source, SQL migration or deployment configuration is intentionally changed by this revision.
