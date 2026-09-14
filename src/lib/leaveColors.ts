/** Shared leave type color mapping — import these instead of redefining per component. */

export const leaveTypeColors: Record<string, string> = {
  Annual:           "bg-emerald-500",
  Sick:             "bg-rose-500",
  Casual:           "bg-sky-500",
  Unpaid:           "bg-slate-500",
  Maternity:        "bg-pink-500",
  Paternity:        "bg-indigo-500",
  Bereavement:      "bg-violet-500",
  Compensatory:     "bg-amber-500",
  "Work From Home": "bg-cyan-500",
  Marriage:         "bg-fuchsia-500",
};

export const leaveColorFallbacks = ["bg-teal-500", "bg-orange-500", "bg-lime-500", "bg-purple-500"];

export function getLeaveColor(type: string): string {
  if (leaveTypeColors[type]) return leaveTypeColors[type];
  const hash = type.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return leaveColorFallbacks[hash % leaveColorFallbacks.length];
}
