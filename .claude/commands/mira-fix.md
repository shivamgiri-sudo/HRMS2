---
description: Pick up the next triaged Mira complaint and fix it properly — dispatch, fix, verify, close.
---

Fix the next Mira complaint. Optional argument: a specific `work_item.id` — otherwise take the
oldest eligible one.

## Why this is a command and not a pipeline

Mira's triage stage is good at finding and classifying complaints and bad at fixing them: it has
no way to reproduce a defect against the live database, and this codebase's real bugs keep
turning on exactly that (the `/admin/mira-complaints` 500 was a `LIMIT ?` bound as a number,
which no amount of reading the file reveals — it only shows up when you run it against MySQL
8.0.42). So the engine dispatches and records; the fixing is yours.

Decided 2026-08-14, after an auto-apply/auto-deploy path was built and then deliberately left
disarmed. Do not re-enable `MIRA_AUTO_DEPLOY_ENABLED` as part of this workflow.

## Steps

**1. Dispatch.** Get the complaint, the AI's hypothesis, and the candidate files:

```
cd backend && ./node_modules/.bin/tsx scripts/mira-next-complaint.ts $ARGUMENTS
```

Read the diagnosis as a lead, not a finding. It is an unverified hypothesis from a model that
never ran the code — it is right often enough to be worth reading and wrong often enough that
acting on it directly is how you fix the wrong thing.

**2. Reproduce before you change anything.** Confirm the defect exists and that you understand
why. For anything touching data, run the actual query against the live DB read-only first —
schema files lie, and a bug that reproduces is a bug you can prove you fixed. If you cannot
reproduce it, say so and stop rather than shipping a speculative change.

**3. Fix it,** following this repo's rules — `CLAUDE.md` and the working memory both apply.
In particular: never edit payroll arithmetic, migrations, RBAC or encryption to make a
complaint go away; stage files by explicit path; other sessions are editing this tree.

**4. Prove it.** Real output, not assertions:
- the guard failing without the fix, and passing with it
- a scoped `tsc` (never a full backend build — it drags in orphans)
- the relevant test files, actually run
- for a frontend change, a real `vite build` — a green `tsc --noEmit` has shipped unbuildable
  trees here before

**5. Ship it,** commit and push by explicit path, then verify the push landed **by content**,
not by exit status:

```
git fetch origin && git show origin/main:<path> | grep <your marker>
```

**6. Close the loop:**

```
cd backend && ./node_modules/.bin/tsx scripts/mira-close-complaint.ts <workItemId> <commitSha>
```

That script refuses to write unless the commit is an ancestor of `origin/main`, so a push that
silently did not land cannot mark a live bug fixed.

**7. Report** what the complaint was, what actually caused it (versus what the AI guessed), what
you changed, and the evidence. If the diagnosis was wrong, say so — that is the signal for
whether this pipeline's triage is worth trusting.

## When not to fix

If the complaint is a feature request, a training issue, or a question, do not force a code
change. Say so, and leave the item open for a human to reclassify — a wrong fix costs more than
an open ticket.
