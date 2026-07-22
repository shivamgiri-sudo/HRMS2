import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, AlertTriangle, Copy, CheckCircle2, Lock, ShieldAlert, Eye, EyeOff, WandSparkles } from "lucide-react";

interface AdminPasswordResetDialogProps {
  employee: {
    id: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    email: string;
    employeeCode?: string;
    employee_code?: string;
    designation?: string | null;
    user_id?: string;
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AdminPasswordResetDialog({
  employee,
  open,
  onOpenChange,
}: AdminPasswordResetDialogProps) {
  const queryClient = useQueryClient();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<{
        success: boolean;
        mustChangePassword: boolean;
        message: string;
        error?: string;
      }>("/api/auth/admin-reset-password", {
        employeeId: employee!.id,
        temporaryPassword: password,
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to reset password");
      }

      return res;
    },
    onSuccess: (data) => {
      setTempPassword(password);
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Password reset successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to reset password");
    },
  });

  const handleReset = () => {
    if (password.length < 10) {
      toast.error("Temporary password must be at least 10 characters");
      return;
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      toast.error("Use uppercase, lowercase, number and special character");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Temporary passwords do not match");
      return;
    }
    resetMutation.mutate();
  };

  const generatePassword = () => {
    const generated = `Mas@${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}A7`;
    setPassword(generated);
    setConfirmPassword(generated);
    setShowPassword(true);
  };

  const handleCopyPassword = () => {
    if (tempPassword) {
      navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      toast.success("Password copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setTempPassword(null);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setCopied(false);
    onOpenChange(false);
  };

  if (!employee) return null;

  const employeeName = employee.name
    ?? `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim()
    ?? "Employee";
  const employeeCode = employee.employeeCode ?? employee.employee_code ?? "—";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
              <Lock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle>Reset Password</DialogTitle>
              <DialogDescription>
                Admin password reset for employee
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Employee Info */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium text-muted-foreground">Name</span>
                <span className="text-sm font-semibold">{employeeName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium text-muted-foreground">Employee Code</span>
                <span className="text-sm font-mono">{employeeCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm font-medium text-muted-foreground">Email</span>
                <span className="text-sm">{employee.email}</span>
              </div>
              {employee.designation && (
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Position</span>
                  <span className="text-sm">{employee.designation}</span>
                </div>
              )}
            </div>
          </div>

          {/* Security Warning */}
          {!tempPassword && (
            <Alert className="border-amber-200 bg-amber-50">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900">Security Notice</AlertTitle>
              <AlertDescription className="text-amber-800 text-sm">
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>You create the employee's temporary password</li>
                  <li>Employee will be forced to change password on next login</li>
                  <li>Existing refresh sessions will be revoked</li>
                  <li>Share the password only through an approved secure channel</li>
                  <li>This action will be logged in audit trail</li>
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {!tempPassword && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="admin-temp-password" className="text-sm font-semibold">
                  Temporary password
                </label>
                <Button type="button" variant="outline" size="sm" onClick={generatePassword}>
                  <WandSparkles className="mr-2 h-4 w-4" />
                  Generate secure
                </Button>
              </div>
              <div className="relative">
                <input
                  id="admin-temp-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 pr-10 text-sm"
                  data-gramm="false"
                  data-gramm_editor="false"
                  data-enable-grammarly="false"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-2.5 text-muted-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm temporary password"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-gramm="false"
                data-gramm_editor="false"
                data-enable-grammarly="false"
              />
              <p className="text-xs text-muted-foreground">
                Minimum 10 characters with uppercase, lowercase, number and special character.
              </p>
            </div>
          )}

          {/* Temporary Password Display */}
          {tempPassword && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-900">Password Reset Successful</AlertTitle>
              <AlertDescription className="space-y-3">
                <div className="mt-3 rounded-lg border border-green-300 bg-white p-4">
                  <p className="text-xs font-semibold text-green-700 mb-2">TEMPORARY PASSWORD</p>
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-lg font-mono font-bold text-slate-900">
                      {tempPassword}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyPassword}
                      className="flex-shrink-0"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-green-800">
                  Employee notification sent to <strong>{employee.email}</strong> without exposing the password.
                </p>
                <p className="text-xs text-green-700">
                  Employee must change this password on next login.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Display */}
          {resetMutation.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Access Denied</AlertTitle>
              <AlertDescription>
                {resetMutation.error?.message || "You don't have permission to reset this employee's password."}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          {!tempPassword ? (
            <>
              <Button variant="outline" onClick={handleClose} disabled={resetMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleReset}
                disabled={resetMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {resetMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reset Password
              </Button>
            </>
          ) : (
            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
