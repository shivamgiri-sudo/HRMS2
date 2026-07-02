# Communication Template Deep Audit

## Files inspected

```text
src/pages/NativeTemplateManager.tsx
backend/src/modules/communication/communication.controller.ts
backend/src/modules/communication/communication.validation.ts
```

## Concrete bug found

Frontend default category is:

```text
general
```

Frontend category dropdown also offers values such as:

```text
offboarding
compliance
announcement
```

Backend only accepts:

```text
onboarding
payroll
attendance
leave
performance
alerts
announcements
custom
```

Result:

```text
Create Template can fail validation even when the form looks valid.
```

## Required fix

Update frontend category list to exactly:

```text
custom
onboarding
payroll
attendance
leave
performance
alerts
announcements
```

Also change default category from `general` to `custom`.

## Other findings

```text
No search/filter on template list.
No pagination.
No edit action in table.
No preview action.
No test-send action.
No variable schema editor.
No active/inactive toggle.
No dispatch log link from template.
No template version history.
Native select controls are used.
```

## Backend observations

```text
CreateTemplateSchema already validates category and channel.
RenderTemplateSchema exists.
Dispatch log filters exist.
Provider config validation exists.
```

## Next fixes

```text
Align category dropdown with backend enum.
Add search and category/channel/status filters.
Add preview panel using render endpoint.
Add edit/deactivate actions.
Add test send.
Add variables schema editor.
```
