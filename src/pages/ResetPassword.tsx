import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Lock } from "lucide-react";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import { hrmsApi } from "@/lib/hrmsApi";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    setToken(searchParams.get("token"));
  }, [searchParams]);

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!token) {
      toast({ title: "Error", description: "This reset link is invalid or expired.", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Error", description: "Password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords don't match.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      await hrmsApi.post<{ success: boolean }>("/api/auth/reset-password", { token, password });
      toast({ title: "Password Updated", description: "Your password has been reset. Please log in." });
      navigate("/auth", { replace: true });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reset password.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md border-border">
          <CardHeader className="text-center">
            <img src={hrHubLogo} alt="Mas Callnet HRMS" className="mx-auto mb-4 h-12 w-auto" />
            <CardTitle className="text-2xl">Invalid or Expired Link</CardTitle>
            <CardDescription>This password reset link is invalid or has expired. Please request a new one.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/auth")}>Back to Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="text-center">
          <img src={hrHubLogo} alt="Mas Callnet HRMS" className="mx-auto mb-4 h-12 w-auto" />
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Set New Password</CardTitle>
          <CardDescription>Use at least 8 characters for your new password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isLoading} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isLoading} />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>) : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
