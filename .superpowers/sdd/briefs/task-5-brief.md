# Task 5 Brief — Frontend: Smart Remarks Chips

## Context
Task 5 of 7 in Work Inbox Volume Relief (MAS PeopleOS HRMS).
Only file: `src/pages/NativeWorkInbox.tsx`. No new files, no backend changes.

## CRITICAL SCOPE RULE
Use Edit tool only. Do NOT rewrite the file. Three targeted additions only.

## Changes Required

### Change 1: Add `MODULE_REMARKS` constant
Find the `MODULE_LABELS` constant (a `Record<string, string>` near the top of the file).
Add the following IMMEDIATELY AFTER the closing `};` of `MODULE_LABELS`:

```typescript
const MODULE_REMARKS: Record<string, readonly string[]> = {
  leave_approval:            ["Approved — coverage confirmed", "Declined — insufficient balance", "Approved with conditions"],
  leave_request:             ["Approved — coverage confirmed", "Declined — insufficient balance"],
  attendance_missing_punch:  ["Regularized — supervisor verified", "Declined — records correct"],
  attendance_regularization: ["Regularized — supervisor verified", "Declined — records correct"],
  regularization:            ["Regularized — verified", "Declined — records correct"],
  bgv:                       ["Clear — proceeding", "Document resubmission requested", "Escalated to HR Head"],
  exit_clearance:            ["Cleared", "Pending — asset return outstanding", "Escalated"],
  resignation:               ["Acknowledged — notice period begins", "Escalated to Branch Head"],
  onboarding:                ["Completed — employee notified", "Pending documents — follow-up sent"],
  offboarding:               ["Clearance complete", "Pending — IT access outstanding"],
  it_provisioning:           ["Provisioned", "Deferred — pending approval"],
  asset_return:              ["Assets received and logged", "Partial return — follow-up required"],
  pip_checkpoint:            ["Checkpoint noted — plan on track", "Checkpoint missed — escalating"],
  walkin_feedback_pending:   ["Feedback submitted", "No-show — candidate not reachable"],
  visitor_approval_needed:   ["Approved — visitor registered", "Declined — not authorised"],
};
```

### Change 2: Add `RemarksChips` component
Find the comment `// ── Action Sheet` in the file.
Add the following IMMEDIATELY BEFORE that comment:

```typescript
// ── Remarks Chips ─────────────────────────────────────────────────────────────

function RemarksChips({ module, onSelect }: { module: string; onSelect: (text: string) => void }) {
  const chips = MODULE_REMARKS[module];
  if (!chips?.length) return null;
  return (
    <div className="mb-2">
      <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Quick remarks</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onSelect(chip)}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Change 3: Wire `RemarksChips` into the ActionSheet remarks block
Inside the `ActionSheet` component, find the remarks section that looks like:
```typescript
          {task.source !== "derived" && (
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Remarks (optional)</p>
              <Textarea
```

Replace the opening `<p>` label with `RemarksChips` plus the label. The replacement should be:
```typescript
          {task.source !== "derived" && (
            <div>
              <RemarksChips module={task.module} onSelect={(text) => setRemarks(text)} />
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Remarks (optional)</p>
              <Textarea
```

(Only the first 3 lines of the block change — the Textarea and rest remain exactly as they are.)

## Verification
```bash
npx tsc --noEmit
```
Expected: zero errors.

## Commit
```bash
git add src/pages/NativeWorkInbox.tsx
git commit -m "feat(inbox): add smart remarks chips to ActionSheet"
```

## Report File
Write your report to: `.superpowers/sdd/briefs/task-5-report.md`
Return only: status, commit SHA, one-line tsc summary, concerns.
