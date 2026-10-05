/**
 * Buttons offered on an increment request, by status. There is no Finance step: the Payroll Head's "Approve & Apply"
 * approves and applies in one click (the server chains approve -> implement). "finance_validated" is a legacy status
 * on old requests and can still be approved or rejected. The server enforces who may press which button.
 */
export interface IncrementActionButton {
  action: string;
  label: string;
  variant?: "default" | "destructive" | "outline";
}

const APPROVE: IncrementActionButton = { action: "approve", label: "Approve & Apply" };
const REJECT: IncrementActionButton = { action: "reject", label: "Reject", variant: "destructive" };
const CANCEL: IncrementActionButton = { action: "cancel", label: "Cancel", variant: "outline" };

export const INCREMENT_ACTIONS_FOR_STATUS: Record<string, IncrementActionButton[]> = {
  submitted: [{ action: "hr_validate", label: "HR Validate", variant: "outline" }, APPROVE, REJECT, CANCEL],
  hr_validated: [APPROVE, REJECT, CANCEL],
  finance_validated: [APPROVE, REJECT],
  approved: [{ action: "implement", label: "Apply" }],
};
