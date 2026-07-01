# Agent Skills & Workflows Reference

## Skills (9)

Each skill is a set of instructions loaded on demand. All live under `.agent/skills/<name>/SKILL.md`.

| Skill | When Used | What It Does |
|---|---|---|
| **superpowers-brainstorm** | Before any non-trivial feature, refactor, or complex debug | Produces structured output: Goal → Constraints → Known Context → Risks → Options (2–4) → Recommendation → Acceptance Criteria |
| **superpowers-debug** | Runtime errors, flaky tests, regressions, performance issues | Workflow: Reproduce → Minimize → Hypotheses (2–5 ranked) → Instrument → Fix → Prevent (regression test) → Verify |
| **superpowers-finish** | End of any non-trivial change set | Runs verification commands, summarises changes by area/file, lists follow-ups and rollback notes |
| **superpowers-plan** | Any multi-file change or behavior/data/auth impact | Writes implementation plan with small steps (2–10 min each), exact files to touch, verification commands per step, risk mitigations, rollback plan |
| **superpowers-python-automation** | Writing Python scripts that call REST APIs (ETL, sync, CLI tools) | Provides patterns: httpx/requests with retries/timeouts, typed models (dataclass/pydantic), pagination helpers, idempotency (SQLite/JSONL), structured logging, pytest+respx tests, dry-run flag |
| **superpowers-rest-automation** | Calling external REST APIs, integrating 2+ systems, webhooks, ETL | Enforces 11-point checklist: contract definition, auth/secrets, idempotency, pagination + incremental sync, retry/backoff, rate limits, data mapping/validation, error handling (skip/retry/quarantine/fail), observability, webhooks, safety controls (dry-run, kill switch) |
| **superpowers-review** | Before delivering or merging changes | Severity-graded review: Blockers (wrong behavior/security/data loss) → Major (likely bugs/edge cases) → Minor (style/clarity) → Nit (polish). Checklist: correctness, edge cases, tests, security, performance, readability, docs |
| **superpowers-tdd** | New features, bug fixes, refactors | Red → Green → Refactor cycle. One behavior per test. Regression tests for bugs. Tests named by behavior, not implementation |
| **superpowers-workflow** | Almost any non-trivial code/debug/refactor/automation task | Default workflow: Brainstorm → Write Plan → Implement (TDD preferred) → Review → Finish. Decision tree for tiny vs non-trivial vs high-risk. Activation marker: runs `record_activation.py` on load |
| **ui-ux-pro-max** | UI/UX design and implementation | Python-based search over 50+ styles, 96 color palettes, 57 font pairings, 25 chart types across 13 stacks. Workflow: Analyze requirements → `search.py --design-system` for complete system → optional domain-specific searches → stack guidelines. Has pre-delivery checklist for visual quality, interaction, light/dark mode, layout, accessibility |

---

## Workflows (8)

Workflows are executable sequences that coordinate skills. All live under `.agent/workflows/<name>.md`.

| Workflow | Trigger | What It Does |
|---|---|---|
| **superpowers-brainstorm** | User task input | Reads `{{input}}`, produces structured brainstorm (Goal/Constraints/Known Context/Risks/Options/Recommendation/Acceptance Criteria), persists to `artifacts/superpowers/brainstorm.md` via `write_artifact.py`. Stops after persistence — does NOT implement. |
| **superpowers-debug** | Debug request | Loads `superpowers-debug` skill, produces Symptom → Repro → Root Cause → Fix → Regression → Verification report, persists to `artifacts/superpowers/debug.md`. Stops after persistence. |
| **superpowers-execute-plan** | `/superpowers-execute-plan` command | Reads approved plan from `artifacts/superpowers/plan.md`. Executes one step at a time with verification after each. On failure, switches to debug mode and stops. Applies TDD/debug/review/finish skills as needed. Persists execution log to `execution.md` and final summary to `finish.md`. |
| **superpowers-execute-plan-parallel** | `/superpowers-execute-plan-parallel` command | Same as sequential execute-plan, but identifies independent steps and runs them in parallel batches via isolated subagents (`spawn_subagent.py`). Consolidates results after each batch. Falls back to sequential on conflicts. Reports time savings. |
| **superpowers-finish** | End of implementation | Loads `superpowers-finish` skill, produces Verification/Summary/Follow-ups/Manual validation, persists to `artifacts/superpowers/finish.md`. Stops after persistence. |
| **superpowers-reload** | `/superpowers-reload` command | Re-reads `.agent/rules/`, `.agent/workflows/`, `.agent/skills/` from disk and confirms the latest versions will be followed. |
| **superpowers-review** | `/superpowers-review` command | Loads `superpowers-review` skill, produces severity-graded review (Blocker/Major/Minor/Nit), persists to `artifacts/superpowers/review.md`. Stops after persistence. |
| **superpowers-write-plan** | User task input | Reads `{{input}}`, produces implementation plan (Goal/Assumptions/Plan with files+verify per step/Risks/Rollback), persists to `artifacts/superpowers/plan.md`. Asks for approval. Does NOT implement — instructs user to run `/superpowers-execute-plan`. |

---

## How Skills & Workflows Interact

```
User Request
     │
     ▼
superpowers-workflow (meta-skill) ─── activates via record_activation.py
     │
     ├─ superpowers-brainstorm ──► artifacts/superpowers/brainstorm.md
     │
     ├─ superpowers-write-plan  ──► artifacts/superpowers/plan.md
     │                                   │
     │                              [User approves]
     │                                   │
     ├─ superpowers-execute-plan ◄───────┘
     │   (or execute-plan-parallel)
     │   Applies: tdd, debug, review, finish
     │                                   │
     ├─ superpowers-review ───────► artifacts/superpowers/review.md
     │
     └─ superpowers-finish ───────► artifacts/superpowers/finish.md
```

All artifacts are persisted to `artifacts/superpowers/` via `write_artifact.py`.

---

## Scripts (under `.agent/skills/superpowers-workflow/scripts/`)

| Script | Purpose |
|---|---|
| `record_activation.py` | Records which skill was activated (marker for workflow compliance) |
| `spawn_subagent.py` | Spawns an isolated subagent for parallel execution of a plan step, passing a skill name and task description |
| `write_artifact.py` | Persists content from stdin to a specified file path under `artifacts/` |

---

## Rules (under `.agent/rules/`)

| Rule File | Scope |
|---|---|
| `superpowers.md` | Always-on rules: plan gate for non-trivial work, mandatory verification, prefer TDD, review pass required, safety, artifact persistence |
| `test-audit-fix.md` | SOP for diagnosing and fixing test failures using real database connections |
