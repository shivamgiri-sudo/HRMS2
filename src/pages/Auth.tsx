import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { DEMO_CREDENTIALS } from "@/lib/demoCreds";

import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const companyLogo = "/mcn-logo.png?v=999";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Please enter your email or employee code"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showDemoPanel, setShowDemoPanel] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const showAlert = (title: string, description: string) => {
    toast({
      title,
      description,
    });
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({
      identifier: loginIdentifier,
      password: loginPassword,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};

      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[`login_${err.path[0]}`] = err.message;
        }
      });

      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    const { error } = await signIn(loginIdentifier, loginPassword);

    setIsLoading(false);

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        showAlert("Login Alert", "Invalid email or password. Please try again.");
      } else if (error.message.includes("Email not confirmed")) {
        showAlert(
          "Email Verification Pending",
          "Please verify your email before signing in."
        );
      } else {
        showAlert("Login Alert", error.message);
      }
    }
  };

  const handleForgotPassword = (e: FormEvent) => {
    e.preventDefault();
    showAlert(
      "Password Reset",
      "Password reset is managed by your HR Admin. Please contact hr@mascallnet.com"
    );
    setShowForgotPassword(false);
  };

  return (
    <div className="min-h-screen bg-[#f3f6fb]">
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.12),transparent_35%)]" />
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white to-transparent" />

        <div className="relative w-full max-w-md">
          <Card className="overflow-hidden rounded-[2rem] border border-white bg-white/95 shadow-2xl shadow-slate-200/80 backdrop-blur">
            <CardHeader className="space-y-5 px-7 pb-4 pt-8 text-center">
              <div className="mx-auto w-full max-w-[315px] rounded-2xl border border-white/10 bg-white/[0.04] p-3 shadow-xl shadow-slate-950/10">
                <div className="flex h-[82px] items-center justify-center rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-200 px-4 py-3 shadow-lg">
                  <img
                    src={companyLogo}
                    alt="Mas Callnet Logo"
                    className="block h-16 w-full max-w-[215px] object-contain drop-shadow-md"
                  />
                </div>
              </div>

              <div>
                <CardTitle className="text-2xl font-semibold tracking-tight text-slate-950">
                  Welcome Back
                </CardTitle>

                <CardDescription className="mt-2 text-sm text-slate-500">
                  Sign in to continue to your HRMS portal
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="px-7 pb-7">
              <Tabs defaultValue="login" className="w-full">
                <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl bg-slate-100 p-1">
                  <TabsTrigger
                    value="login"
                    className="rounded-xl text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                  >
                    Login
                  </TabsTrigger>

                  <TabsTrigger
                    value="signup"
                    className="rounded-xl text-sm font-medium text-slate-500 data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                  >
                    Sign Up
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="mt-6">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label
                        htmlFor="login-identifier"
                        className="text-sm font-medium text-slate-700"
                      >
                        Email or Employee Code
                      </Label>

                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <Input
                          id="login-identifier"
                          type="text"
                          placeholder="name@company.com or EMP-001"
                          value={loginIdentifier}
                          onChange={(e) => setLoginIdentifier(e.target.value)}
                          disabled={isLoading}
                          className="h-12 rounded-2xl border-slate-200 bg-white pl-11 text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-sky-400"
                        />
                      </div>

                      {errors.login_identifier && (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                          {errors.login_identifier}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label
                        htmlFor="login-password"
                        className="text-sm font-medium text-slate-700"
                      >
                        Password
                      </Label>

                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                        <Input
                          id="login-password"
                          type={showLoginPassword ? "text" : "password"}
                          placeholder="Enter password"
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          disabled={isLoading}
                          className="h-12 rounded-2xl border-slate-200 bg-white pl-11 pr-12 text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:border-sky-400 focus-visible:ring-sky-400"
                        />

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl p-0 text-slate-500 hover:bg-slate-100"
                          onClick={() =>
                            setShowLoginPassword(!showLoginPassword)
                          }
                          tabIndex={-1}
                        >
                          {showLoginPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>

                      {errors.login_password && (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                          {errors.login_password}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        Secure access
                      </div>

                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-xs font-semibold text-sky-700 hover:text-slate-950"
                        onClick={() => {
                          setShowForgotPassword(true);
                          setResetEmail(loginIdentifier.includes('@') ? loginIdentifier : '');
                        }}
                      >
                        Forgot password?
                      </Button>
                    </div>

                    <Button
                      type="submit"
                      className="h-12 w-full rounded-2xl bg-slate-950 text-base font-semibold text-white shadow-lg shadow-slate-300/60 transition hover:-translate-y-0.5 hover:bg-slate-800"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        <>
                          Sign In
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </form>

                  <div className="relative mt-6">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-white px-2 text-slate-400 font-bold tracking-wider">OR</span>
                    </div>
                  </div>

                  {/* Demo Role Quick-Login Panel */}
                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={() => setShowDemoPanel(p => !p)}
                      className="group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-indigo-50/50 to-purple-50 p-4 text-left transition duration-300 hover:-translate-y-0.5 hover:border-sky-400 hover:shadow-lg hover:shadow-sky-100/50"
                    >
                      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-sky-200/20 blur-xl transition group-hover:scale-150" />
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 tracking-tight">Test Credentials by Role</p>
                          <p className="text-[11px] font-medium text-slate-500">Click any role below to auto-fill &amp; sign in</p>
                        </div>
                      </div>
                      {showDemoPanel
                        ? <ChevronUp className="h-4 w-4 text-sky-600" />
                        : <ChevronDown className="h-4 w-4 text-sky-600" />}
                    </button>

                    {showDemoPanel && (
                      <div className="mt-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-1.5">
                        {DEMO_CREDENTIALS.filter(c => c.email !== "demo@mascallnet.com").map(cred => (
                          <button
                            key={cred.email}
                            type="button"
                            disabled={isLoading}
                            onClick={async () => {
                              setLoginIdentifier(cred.email);
                              setLoginPassword(cred.password);
                              setIsLoading(true);
                              await signIn(cred.email, cred.password);
                              setIsLoading(false);
                            }}
                            className="flex w-full items-center justify-between rounded-xl border border-transparent bg-white px-3 py-2 text-left text-xs shadow-sm transition hover:border-sky-200 hover:shadow-md disabled:opacity-60"
                          >
                            <div>
                              <span className="font-semibold text-slate-800">{cred.label}</span>
                              <span className="ml-2 text-slate-400">{cred.email}</span>
                            </div>
                            <span className="font-mono text-slate-500">{cred.password}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {showForgotPassword && (
                    <div className="mt-5 rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
                      <form
                        onSubmit={handleForgotPassword}
                        className="space-y-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-950">
                            Reset Password
                          </p>

                          <p className="mt-1 text-xs text-slate-500">
                            Password reset is managed by your HR Admin.
                          </p>
                        </div>

                        <Input
                          type="email"
                          placeholder="Registered email"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          disabled={isLoading}
                          className="h-11 rounded-2xl border-sky-100 bg-white focus-visible:ring-sky-400"
                        />

                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="submit"
                            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                            disabled={isLoading}
                          >
                            Contact HR
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl border-slate-200"
                            onClick={() => setShowForgotPassword(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="signup" className="mt-6">
                  <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-md">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        New accounts are created by HR Admin
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Please contact your HR team to get access.
                      </p>
                      <p className="mt-2 text-xs font-medium text-sky-700">
                        hr@mascallnet.com
                      </p>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <p className="mt-6 text-center text-xs leading-5 text-slate-400">
                Authorized access only
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Auth;
