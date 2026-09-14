import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Lock, Eye, EyeOff, CheckCircle2, XCircle, ShieldAlert, Info } from "lucide-react";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PasswordStrength {
  score: number;
  label: string;
  color: string;
  feedback: string[];
}

function checkPasswordStrength(password: string): PasswordStrength {
  let score = 0;
  const feedback: string[] = [];

  // Length check
  if (password.length >= 8) score++;
  else feedback.push("At least 8 characters");

  if (password.length >= 12) score++;

  // Uppercase check
  if (/[A-Z]/.test(password)) score++;
  else feedback.push("At least one uppercase letter");

  // Lowercase check
  if (/[a-z]/.test(password)) score++;
  else feedback.push("At least one lowercase letter");

  // Number check
  if (/\d/.test(password)) score++;
  else feedback.push("At least one number");

  // Special character check
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score++;
  else feedback.push("At least one special character");

  // Common patterns check
  if (/(.)\1{2,}/.test(password)) {
    score--;
    feedback.push("Avoid repeated characters");
  }

  if (score <= 2) return { score, label: "Weak", color: "text-red-600", feedback };
  if (score <= 4) return { score, label: "Fair", color: "text-amber-600", feedback };
  if (score <= 5) return { score, label: "Good", color: "text-blue-600", feedback };
  return { score, label: "Strong", color: "text-green-600", feedback };
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = checkPasswordStrength(newPassword);

  const changeMutation = useMutation({
    mutationFn: async () => {
      // Validation
      if (!currentPassword || !newPassword || !confirmPassword) {
        throw new Error("All fields are required");
      }

      if (newPassword !== confirmPassword) {
        throw new Error("New passwords do not match");
      }

      if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters long");
      }

      if (newPassword === currentPassword) {
        throw new Error("New password must be different from current password");
      }

      if (strength.score < 3) {
        throw new Error("Password is too weak. Please choose a stronger password.");
      }

      const res = await hrmsApi.post<{ success: boolean; message?: string; error?: string }>(
        "/api/auth/change-password",
        {
          currentPassword,
          newPassword,
        }
      );

      if (!res.success) {
        throw new Error(res.error || "Failed to change password");
      }

      return res;
    },
    onSuccess: () => {
      toast.success("Password changed successfully");
      handleClose();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to change password");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    changeMutation.mutate();
  };

  const handleClose = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    onOpenChange(false);
  };

  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;
  const passwordsDontMatch = confirmPassword && newPassword !== confirmPassword;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <Lock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle>Change Password</DialogTitle>
              <DialogDescription>Update your account password</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {/* Security Guidelines */}
          <Alert className="border-blue-200 bg-blue-50">
            <ShieldAlert className="h-4 w-4 text-blue-600" />
            <AlertTitle className="text-blue-900 text-sm font-semibold">
              Password Security Guidelines
            </AlertTitle>
            <AlertDescription className="text-blue-800 text-xs space-y-1 mt-2">
              <ul className="list-disc list-inside space-y-0.5">
                <li>Never share your password with anyone</li>
                <li>Change your password regularly (every 90 days)</li>
                <li>Use a unique password - don't reuse old passwords</li>
                <li>Use a mix of letters, numbers, and symbols</li>
                <li>Avoid common words, names, or dates</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password">Current Password *</Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                disabled={changeMutation.isPending}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password *</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 8 characters)"
                disabled={changeMutation.isPending}
                required
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Password Strength Indicator */}
            {newPassword && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Password Strength:</span>
                  <span className={`text-xs font-semibold ${strength.color}`}>{strength.label}</span>
                </div>
                <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      strength.score <= 2
                        ? "bg-red-500"
                        : strength.score <= 4
                        ? "bg-amber-500"
                        : strength.score <= 5
                        ? "bg-blue-500"
                        : "bg-green-500"
                    }`}
                    style={{ width: `${(strength.score / 6) * 100}%` }}
                  />
                </div>
                {strength.feedback.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <div className="flex items-start gap-1">
                      <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <div className="space-y-0.5">
                        {strength.feedback.map((fb, i) => (
                          <div key={i}>• {fb}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm New Password *</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                disabled={changeMutation.isPending}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Password Match Indicator */}
            {confirmPassword && (
              <div className="flex items-center gap-2 text-xs">
                {passwordsMatch ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-green-600 font-medium">Passwords match</span>
                  </>
                ) : passwordsDontMatch ? (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span className="text-red-600 font-medium">Passwords do not match</span>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* Warning about password sharing */}
          <Alert className="border-amber-200 bg-amber-50">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-900 text-sm font-semibold">Important</AlertTitle>
            <AlertDescription className="text-amber-800 text-xs">
              <strong>Never share your password</strong> with colleagues, managers, or IT support.
              Legitimate staff will never ask for your password.
            </AlertDescription>
          </Alert>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={changeMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              changeMutation.isPending ||
              !currentPassword ||
              !newPassword ||
              !confirmPassword ||
              !passwordsMatch ||
              strength.score < 3
            }
          >
            {changeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Change Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
