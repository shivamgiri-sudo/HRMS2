# Phase 4 gate status — what is built, what is blocked, and who unblocks it

**Status: the code is complete and inert.** Every table, service, guard, workflow and test for
the automated build has shipped. Nothing can dispatch a build, and nothing will until the
eight gates below are attested — six of which require actions only a person with
infrastructure access can take.

This document exists because "it's held behind gates" is a claim that decays. Six months from
now, someone will want to turn this on and will need to know exactly what was deferred and
why. That is what follows.

---

## How the hold is enforced

Not by convention. Three independent mechanisms, and any one of them refuses:

| Mechanism | Where | What it does |
|---|---|---|
| `uat_gate_status` | migration `1106` | Eight rows, `met` defaults to `0`, and the seed supplies only `(gate_key, title, requirement)` — so no row can arrive attested. `assertDispatchAllowed()` refuses while any is unmet. |
| `uat_pipeline_config.builds_enabled` | migration `1104` | Ships `'false'`. An operator can flip it instantly without a deploy. |
| `UAT_BUILDS_ENABLED` | `env.ts` | Defaults `"false"`. Checked alongside the DB row; **either can veto**. |

An **empty** `uat_gate_status` is treated as *all gates unmet*, not as *no gates*. A migration
that failed to seed would otherwise silently unlock the most dangerous feature in the system —
the absent-means-permitted shape this whole pipeline exists to prevent, applied to the
pipeline itself. `uat-build-gates.test.ts` asserts this.

The `/api/uat-internal` router — the only part of the backend reachable without a login —
returns **503** on every route while the gates are unmet. The surface does not exist yet.

---

## The eight gates

### G1 · Leaked credentials remediated — **BLOCKED, and urgent regardless of this project**

Not a Phase 4 problem. The repository is public and contains live credentials in tracked
files; the database password and SSH access are exposed to anyone who has ever cloned it, and
`git` history keeps them even after a file is deleted in `HEAD`.

**Required:** rotate the DB and SSH credentials; purge the secrets from history rather than
deleting them in `HEAD`; close MySQL 3306 and SSH 22 to the internet; scan to confirm no live
secret survives in any tracked file or historical commit.

**Who:** whoever holds infrastructure access. This one should be done whether or not Phase 4
is ever enabled.

### G2 · Repository is private — **BLOCKED**

A hard requirement, not a recommendation. While the repository is public, Actions logs and
artifacts are world-readable, so every structural control in the workflow is load-bearing
rather than defence in depth.

Enforced in two places: as a gate row, and as an OIDC claim check
(`repository_visibility !== "private"` rejects the token). The claim check exists because a
gate someone forgets to re-check after flipping the repository back to public is not a
control.

**Who:** the repository owner.

### G3 · OIDC trust binding proven with a real token — **CODE READY, needs a captured token**

`uat-oidc-verify.service.ts` checks twelve claims, and `uat-oidc-claims.test.ts` proves each
one rejects its specific attack — a fork's `pull_request` run, a different workflow in the
same repository, the right workflow on an attacker's branch, a same-named repository under a
different owner.

**Still required:** capture a real token from a real run and contract-test the actual claim
shape against these expectations. The tests use a synthesised claim set; a real token can
differ in ways nobody predicts.

**Who:** whoever can run the workflow once the repository is private.

### G4 · Runner-to-backend connectivity — **BLOCKED, needs a network decision**

A GitHub-hosted runner cannot reach the HRMS backend: `deploy.yml` uses `self-hosted`
precisely because the runner must sit inside the network. `/api/uat-internal/*` must be
reachable from GitHub Actions egress and nothing else must become reachable with it.

Three options, in preference order:

1. **nginx location restricted to GitHub Actions egress ranges** from
   `https://api.github.com/meta`, refreshed on a schedule, OIDC-verified, rate-limited.
2. **Cloudflare Tunnel** publishing only that path — no inbound firewall change, no new port.
3. ~~Courier split via artifacts~~ — rejected: the jobs could only exchange payloads through
   artifacts, reintroducing exactly the exposure it was meant to avoid.

**Who:** whoever owns the network. This is the largest remaining piece of work.

### G5 · Write authority separated from code execution — **DONE IN CODE, needs a live run**

The four-job split is implemented and `uat-build-workflow.contract.test.ts` asserts 31
structural properties, including that Job A (which executes generated code) has no
`contents: write`, Job C (which executes repository code) has no write permission and no
`id-token`, and Job D (which publishes) never checks out the repository.

**Still required:** observe it on a real run.

### G6 · Egress restricted and sandbox credential-isolated — **DONE IN CODE, needs a live run**

The workflow strips `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and
`GITHUB_TOKEN` before the sandbox starts, and applies an egress block allowing only
`api.anthropic.com:443`. The credential stripping and the network block are the real controls;
the tool denylist is defence in depth.

**Still required:** prove inside a real sandbox that the OIDC variables are absent, the HRMS
host does not resolve, the GitHub API is unreachable, and the Anthropic API works.

### G7 · Branch protection and CODEOWNERS — **BLOCKED, needs repository settings**

`CODEOWNERS` exists and covers the control-plane files. Branch protection does not, and cannot
be set from code.

**Required:** required status checks that re-run on every PR HEAD SHA; domain-owner review on
capability-covered paths; admin bypass disabled where possible.

**Who:** the repository owner.

### G8 · Negative and red-team tests pass — **PARTIALLY DONE**

Passing now, in CI:

- A payroll path in the allowlist is rejected by the guard reading the *trusted* control
  plane, not the supplied allowlist (`uat-guard-script.test.ts`).
- A patch that edits the guard script is rejected, and the guard refuses to run when `--base`
  is the working directory — the configuration where it could be judging its own modification.
- A deleted file, a renamed file, a removed export, a removed route, a removed migration entry,
  a dependency change, introduced DDL and an unbounded `UPDATE` are each rejected with a
  distinct reason.
- The five adversarial requests stop at `scan_blocked` with zero rows in `uat_llm_call`
  (`uat-capability-fixtures.test.ts`, `uat-validator.test.ts`).

Still requiring a live run: the happy path leaving `origin/main` byte-identical; a hand-written
payroll commit pushed onto an open pipeline PR blocking the merge; a tampered patch in storage
rejected by Job B's hash check.

---

## What is complete

| Piece | Where | Tests |
|---|---|---|
| Two-dimensional risk model | `uat/protected-paths.json`, `uat/capability-registry.json` | `uat-capability-fixtures`, `uat-control-plane` |
| Checklist engine, floor cannot be loosened | `uat-checklist.service.ts` | `uat-checklist-floor.contract` |
| Validator (LLM stage 1), fail-closed | `uat-validator.service.ts` | `uat-validator` |
| Change-type governance | `uat-governance.service.ts` | `uat-governance` |
| Prompt writer + fixed template | `uat-prompt-writer.service.ts` | `uat-prompt-writer` |
| OIDC claim verification | `uat-oidc-verify.service.ts` | `uat-oidc-claims` |
| Dispatch + idempotent callbacks | `uat-build-dispatch.service.ts` | `uat-build-gates` |
| Path gate / deletion guard | `backend/scripts/uat-check-diff.mjs` | `uat-guard-script` |
| Four-job workflow | `.github/workflows/uat-build.yml` | `uat-build-workflow.contract` |
| Scale fixtures (synthetic only) | `backend/scripts/uat-seed-scale-fixtures.mjs` | refuses non-local host and non-`_test` database |

---

## When the gates are met

1. Attest each gate: `UPDATE uat_gate_status SET met = 1, evidence = '…', attested_by = '<user id>', attested_at = NOW() WHERE gate_key = 'G1';` — one at a time, each with real evidence and a named person.
2. Seed the allowlist to one or two low-risk **frontend-only** areas:
   `UPDATE uat_pipeline_config SET config_value = 'src/pages/' WHERE config_key = 'allowlisted_modules';`
   It ships empty, and empty means no module is eligible.
3. Turn on the switches in order, watching each: `validator_enabled`, then
   `prompt_writer_enabled`, then `builds_enabled` — and the matching env vars, since **either
   can veto**.
4. Run the eight G8 scenarios against the live pipeline before widening anything.

**Phase 6 entry criteria remain numeric:** ≥ 50 successful low-risk runs · zero guardrail
breaches · retest-failure rate < 5% · zero escaped P0 defects · callback success > 95% ·
revert rate on merged AI PRs < 2%.

---

## The one thing worth repeating

The pipeline stops at a **draft PR**. It never merges, never deploys, and never touches
production. Every path through it ends at a human decision, and the gates above decide only
whether it may reach that point automatically or whether a person does the work by hand.
