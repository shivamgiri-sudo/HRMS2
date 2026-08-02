# Branch protection for `main` — prepared, NOT applied

**Prepared:** 2026-08-03 · **Status:** awaiting owner approval · **Applied:** no

This is the payload and the reasoning. Nothing here has been executed. Applying it is a
GitHub settings change and is explicitly outside the authorisation for this work.

---

## Why this is the load-bearing control

`main` currently has **no protection object at all** — `gh api repos/:owner/:repo/branches/main/protection`
returns 404, meaning not "protection is off" but "no protection has ever been configured".
Two consequences that this release cycle demonstrated:

1. **Five deploys shipped green on 01-Aug while CI was red on the same commits.** `deploy.yml`
   and `ci.yml` are independent workflows both triggered by `push: main`. Deploy does not
   `needs:` CI, so a red CI run and a successful deploy are two unrelated events.
2. **`main` took three pushes during the declared UAT freeze** — `045026c0`, `bb3dc52f`,
   `b9aa8ce3`, all on 02–03 Aug. A freeze that depends on people remembering is not a freeze.

Required status checks turn the first into an impossibility. A required review turns the
second into a deliberate act rather than an accident.

## Do this in two stages, not one

Applying the full payload today would block `main` on checks that are **currently red** —
which is correct in principle and disruptive in practice while the fresh-build repair is
still in flight. So:

**Stage 1 — now.** Apply with `required_status_checks.contexts` limited to the checks that
are green and stable. This stops the deploy-while-red class immediately.

**Stage 2 — when the smoke gate is green twice consecutively.** Add the remaining contexts.

The two payloads differ only in that list.

---

## Stage 1 payload

```bash
gh api -X PUT repos/shivamgiri-sudo/HRMS2/branches/main/protection \
  --input branch-protection-stage1.json
```

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint",
      "Type Check",
      "Build",
      "Deletion Guard",
      "Security and RBAC Tests",
      "Finance API and schema contract"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true
}
```

## Stage 2 — add when green twice

```json
"contexts": [
  "Lint",
  "Type Check",
  "Build",
  "Deletion Guard",
  "Security and RBAC Tests",
  "Finance API and schema contract",
  "Frontend Tests",
  "Backend suite (no new failures)",
  "Build, migrate, seed, login and browser smoke"
]
```

---

## Every field, and why it is set that way

| Field | Value | Reasoning |
| --- | --- | --- |
| `required_status_checks.strict` | `true` | Requires the branch to be up to date before merge. Without it, two PRs that each pass alone can merge into a broken `main` — which is how a lockfile and a dependency change landed separately and broke `Install backend deps` for a day. |
| `contexts` | see above | **These are job `name:` values, not job ids.** GitHub matches the displayed check name. `Finance API and schema contract` only became meaningful today — before the `working-directory` fix it had never executed a test, so requiring it would have required nothing. |
| `enforce_admins` | **`false`** | Deliberate, and the one field I would argue about. `true` is stricter and I am not recommending it yet: production currently has no other break-glass path, and the same freeze that was violated three times is the situation where an admin may genuinely need to push a fix. Revisit once the release candidate is out. |
| `required_approving_review_count` | `1` | The minimum that makes a push to `main` a deliberate act. Note this repo's history is direct-to-`main`; this is the change people will feel, so it is worth announcing rather than just enabling. |
| `dismiss_stale_reviews` | `true` | An approval of an earlier diff is not an approval of the current one. |
| `require_code_owner_reviews` | `false` | There is no `CODEOWNERS` file. Enabling this without one blocks every PR. |
| `restrictions` | `null` | No push allowlist. The review requirement is the control; an allowlist on top adds administration without adding safety here. |
| `allow_force_pushes` | `false` | A force-push to `main` discards history that the deploy pipeline treats as the record of what shipped. |
| `allow_deletions` | `false` | Self-evident for a default branch. |
| `required_linear_history` | `false` | Would force rebase-or-squash. A workflow change, not a safety one — out of scope. |
| `required_conversation_resolution` | `true` | Cheap. Stops a PR merging with an unanswered review comment on it. |

## What this does NOT fix

- **`deploy.yml` still does not `needs:` `ci.yml`.** Branch protection gates *merging*, not the
  `push: main` trigger. A commit that reaches `main` by any means still triggers deploy
  independently. The durable fix is making deploy depend on CI, or collapsing the two
  workflows — a separate change, prepared but not made here.
- **It does not retroactively validate the three freeze-window commits.** They are on `main`
  and only `045026c0` has been reviewed.

## Rollback

```bash
gh api -X DELETE repos/shivamgiri-sudo/HRMS2/branches/main/protection
```

Instant and total. Worth knowing before applying rather than after.
