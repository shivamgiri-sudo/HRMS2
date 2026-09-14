import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function EmployeeCell({
  name,
  code,
  email,
  role,
  avatar,
}: {
  name: string;
  code?: string;
  email?: string;
  role?: string;
  avatar?: string;
}) {
  const initials = name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "EM";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage src={avatar} />
        <AvatarFallback className="bg-[var(--brand-50)] text-xs font-semibold text-[var(--brand-700)]">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{name}</p>
        <p className="truncate text-xs text-[var(--text-muted)]">{code || email || role}</p>
        {(code && email) || role ? <p className="truncate text-xs text-[var(--text-muted)]">{email || role}</p> : null}
      </div>
    </div>
  );
}
