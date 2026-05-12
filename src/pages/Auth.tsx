import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Fingerprint,
  HeartHandshake,
  Loader2,
  LockKeyhole,
  Mail,
  Shield,
  Sparkles,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { z } from "zod";
import hrHubLogo from "@/assets/brand/mcn-logo.png";
import hrHubLogoLight from "@/assets/brand/mcn-logo-light.png";
import { supabase } from "@/integrations/supabase/client";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name is too long"),
    email: z.string().trim().email("Please enter a valid email address"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

const Auth = () => {
  const [isLoading, setIsLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupConfirmPassword, setSignupConfirmPassword] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showSignupConfirmPassword, setShowSignupConfirmPassword] = useState(false);

  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (user) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, navigate]);

  const showSoftAlert = (title: string, description: string) => {
    toast({
      title,
      description,
    });
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({
      email: loginEmail,
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
    const { error } = await signIn(loginEmail, loginPassword);
    setIsLoading(false);

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        showSoftAlert("Login Alert", "Invalid email or password. Please try again.");
      } else if (error.message.includes("Email not confirmed")) {
        showSoftAlert(
          "Email Verification Pending",
          "Please verify your email before signing in."
        );
      } else {
        showSoftAlert("Login Alert", error.message);
      }
    }
  };

  const handleForgotPassword = async (e: FormEvent) => {
    e.preventDefault();

    if (!resetEmail.trim()) {
      showSoftAlert("Reset Password", "Please enter your registered email address.");
      return;
    }

    setIsLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setIsLoading(false);

    if (error) {
      showSoftAlert("Reset Password", error.message);
    } else {
      toast({
        title: "Reset Link Sent",
        description: "Please check your email for the password reset link.",
      });
      setShowForgotPassword(false);
    }
  };

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = signupSchema.safeParse({
      fullName: signupName,
      email: signupEmail,
      password: signupPassword,
      confirmPassword: signupConfirmPassword,
    });

    if (!result.success) {
      const fieldErrors: Record<string, string> = {};

      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[`signup_${err.path[0]}`] = err.message;
        }
      });

      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      const { data: settings } = await supabase
        .from("organization_settings")
        .select("setting_value")
        .eq("setting_key", "domain_whitelist")
        .single();

      if (settings?.setting_value) {
        const whitelist = settings.setting_value as unknown as {
          enabled: boolean;
          domains: string[];
        };

        if (whitelist.enabled && whitelist.domains.length > 0) {
          const emailDomain = signupEmail.split("@")[1]?.toLowerCase();

          const isAllowed = whitelist.domains.some(
            (domain) => emailDomain === domain.toLowerCase()
          );

          if (!isAllowed) {
            setIsLoading(false);
            showSoftAlert(
              "Registration Restricted",
              "Only approved company email domains are allowed. Please contact your administrator."
            );
            return;
          }
        }
      }
    } catch (error) {
      console.error("Error checking domain whitelist:", error);
    }

    const { error } = await signUp(signupEmail, signupPassword, signupName);

    setIsLoading(false);

    if (error) {
      if (error.message.includes("User already registered")) {
        showSoftAlert(
          "Account Already Exists",
          "An account with this email already exists. Please use login instead."
        );
      } else {
        showSoftAlert("Signup Alert", error.message);
      }
    } else {
      toast({
        title: "Account Created",
        description: "Please check your email to verify your account.",
      });
    }
  };

  const experienceCards = [
    {
      icon: <Users className="h-5 w-5" />,
      title: "Employee Self Service",
      text: "Profile, attendance, leave, documents and requests in one place.",
    },
    {
      icon: <CalendarDays className="h-5 w-5" />,
      title: "Attendance & Leave",
      text: "Smart leave tracking, approvals, holidays and attendance visibility.",
    },
    {
      icon: <Wallet className="h-5 w-5" />,
      title: "Payroll Ready",
      text: "Payroll, assets, claims, compliance and employee lifecycle workflows.",
    },
  ];

  const modulePills = [
    "Hiring",
    "Onboarding",
    "Manage HR",
    "Attendance",
    "Payroll",
    "Assets",
    "Reports",
    "Engagement",
  ];

  return (
    <div className="min-h-screen overflow-hidden bg-slate-950 text-slate-900">
      <div className="relative min-h-screen">
        {/* Background */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.32),transparent_28%),radial-gradient(circle_at_85%_18%,rgba(99,102,241,0.26),transparent_28%),radial-gradient(circle_at_55%_90%,rgba(16,185,129,0.18),transparent_34%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(15,23,42,0.93),rgba(30,41,59,0.9))]" />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/10 to-transparent" />

        <div className="relative grid min-h-screen lg:grid-cols-[1.08fr_0.92fr]">
          {/* Left Panel */}
          <section className="hidden px-10 py-8 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/15 bg-white/10 shadow-2xl backdrop-blur-xl">
                  <img
                    src={hrHubLogoLight}
                    alt="Mas Callnet HRMS"
                    className="h-10 w-auto"
                  />
                </div>

                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Mas Callnet HRMS
                  </h1>
                  <p className="text-sm text-cyan-100/80">
                    One portal for every HR action
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-4 py-2 text-xs font-medium text-cyan-100 shadow-lg backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.8)]" />
                Secure Access
              </div>
            </div>

            <div className="max-w-3xl space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm text-slate-100 shadow-xl backdrop-blur-xl">
                <Sparkles className="h-4 w-4 text-cyan-200" />
                Modern HRMS experience for employees, managers and HR teams
              </div>

              <div className="space-y-5">
                <h2 className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight xl:text-6xl">
                  Complete HR solution for a seamless work experience.
                </h2>

                <p className="max-w-2xl text-lg leading-8 text-slate-300">
                  Login to manage attendance, leaves, onboarding, payroll,
                  assets, approvals and HR insights through one intelligent
                  employee workspace.
                </p>
              </div>

              {/* Module Pills */}
              <div className="flex max-w-2xl flex-wrap gap-3">
                {modulePills.map((item) => (
                  <div
                    key={item}
                    className="group rounded-full border border-white/12 bg-white/10 px-4 py-2 text-sm text-slate-100 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-cyan-200/10"
                  >
                    <span className="inline-flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                      {item}
                    </span>
                  </div>
                ))}
              </div>

              {/* Floating Dashboard Preview */}
              <div className="relative max-w-2xl rounded-[2rem] border border-white/12 bg-white/10 p-5 shadow-2xl backdrop-blur-xl">
                <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-400/20 blur-2xl" />
                <div className="absolute -bottom-8 left-14 h-28 w-28 rounded-full bg-indigo-400/20 blur-2xl" />

                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-300">Today&apos;s HR Snapshot</p>
                    <h3 className="mt-1 text-xl font-semibold text-white">
                      Workforce Command Center
                    </h3>
                  </div>

                  <div className="rounded-2xl bg-white/10 p-3 text-cyan-100 ring-1 ring-white/10">
                    <ClipboardCheck className="h-6 w-6" />
                  </div>
                </div>

                <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <p className="text-xs text-slate-400">Attendance</p>
                    <p className="mt-2 text-2xl font-semibold text-white">Live</p>
                    <div className="mt-3 h-2 rounded-full bg-white/10">
                      <div className="h-2 w-4/5 rounded-full bg-cyan-300" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <p className="text-xs text-slate-400">Approvals</p>
                    <p className="mt-2 text-2xl font-semibold text-white">Fast</p>
                    <div className="mt-3 h-2 rounded-full bg-white/10">
                      <div className="h-2 w-3/5 rounded-full bg-emerald-300" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
                    <p className="text-xs text-slate-400">Reports</p>
                    <p className="mt-2 text-2xl font-semibold text-white">Smart</p>
                    <div className="mt-3 h-2 rounded-full bg-white/10">
                      <div className="h-2 w-4/6 rounded-full bg-indigo-300" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid max-w-2xl gap-4 md:grid-cols-3">
                {experienceCards.map((feature) => (
                  <div
                    key={feature.title}
                    className="rounded-3xl border border-white/12 bg-white/10 p-5 shadow-xl backdrop-blur-xl transition hover:-translate-y-1 hover:bg-white/15"
                  >
                    <div className="mb-4 inline-flex rounded-2xl bg-cyan-300/12 p-3 text-cyan-100 ring-1 ring-cyan-100/15">
                      {feature.icon}
                    </div>
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      {feature.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-300">
              <p>© 2026 Mas Callnet HRMS. All rights reserved.</p>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-300" />
                <span>Role-based access enabled</span>
              </div>
            </div>
          </section>

          {/* Right Panel */}
          <section className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
            <div className="w-full max-w-[470px]">
              <div className="mb-6 flex items-center justify-center lg:hidden">
                <div className="flex items-center gap-3 rounded-3xl border border-white/15 bg-white/10 px-5 py-4 text-white shadow-2xl backdrop-blur-xl">
                  <img src={hrHubLogoLight} alt="Mas Callnet HRMS" className="h-10 w-auto" />
                  <div>
                    <h1 className="text-lg font-semibold">Mas Callnet HRMS</h1>
                    <p className="text-xs text-cyan-100/80">Secure HR Portal</p>
                  </div>
                </div>
              </div>

              <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-white/95 shadow-2xl shadow-slate-950/30 backdrop-blur-xl">
                <CardHeader className="relative space-y-5 border-b border-slate-100 bg-gradient-to-br from-white via-slate-50 to-cyan-50/70 pb-6 text-center">
                  <div className="absolute right-0 top-0 h-28 w-28 rounded-bl-full bg-cyan-100/70" />
                  <div className="absolute left-0 top-8 h-16 w-16 rounded-br-full bg-indigo-100/70" />

                  <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 via-sky-500 to-indigo-500 text-white shadow-xl shadow-cyan-500/25">
                    <Fingerprint className="h-8 w-8" />
                  </div>

                  <div className="relative">
                    <CardTitle className="text-3xl font-semibold tracking-tight text-slate-950">
                      Welcome to HRMS
                    </CardTitle>
                    <CardDescription className="mt-2 text-sm leading-6 text-slate-500">
                      Sign in to continue to your employee workspace.
                    </CardDescription>
                  </div>

                  <div className="relative grid grid-cols-3 gap-2 rounded-2xl border border-slate-200 bg-white p-2 text-xs font-medium text-slate-600 shadow-sm">
                    <div className="rounded-xl bg-cyan-50 px-2 py-2 text-cyan-800">
                      HR
                    </div>
                    <div className="rounded-xl bg-indigo-50 px-2 py-2 text-indigo-800">
                      Manager
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-2 py-2 text-emerald-800">
                      Employee
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  <Tabs defaultValue="login" className="w-full">
                    <TabsList className="grid h-13 w-full grid-cols-2 rounded-2xl bg-slate-100 p-1">
                      <TabsTrigger
                        value="login"
                        className="rounded-xl py-2.5 text-sm font-medium text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                      >
                        Login
                      </TabsTrigger>
                      <TabsTrigger
                        value="signup"
                        className="rounded-xl py-2.5 text-sm font-medium text-slate-500 transition data-[state=active]:bg-white data-[state=active]:text-slate-950 data-[state=active]:shadow-sm"
                      >
                        Sign Up
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="login" className="mt-6">
                      <form onSubmit={handleLogin} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="login-email" className="text-sm font-medium text-slate-700">
                            Email ID
                          </Label>

                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="login-email"
                              type="email"
                              placeholder="name@company.com"
                              value={loginEmail}
                              onChange={(e) => setLoginEmail(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 text-slate-900 shadow-sm transition placeholder:text-slate-400 focus-visible:border-cyan-400 focus-visible:ring-cyan-400"
                            />
                          </div>

                          {errors.login_email && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                              {errors.login_email}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="login-password" className="text-sm font-medium text-slate-700">
                            Password
                          </Label>

                          <div className="relative">
                            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="login-password"
                              type={showLoginPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              value={loginPassword}
                              onChange={(e) => setLoginPassword(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 pr-12 text-slate-900 shadow-sm transition placeholder:text-slate-400 focus-visible:border-cyan-400 focus-visible:ring-cyan-400"
                            />

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl p-0 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"
                              onClick={() => setShowLoginPassword(!showLoginPassword)}
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

                        <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                            <Shield className="h-4 w-4 text-emerald-600" />
                            Secure employee access
                          </div>

                          <Button
                            type="button"
                            variant="link"
                            className="h-auto p-0 text-xs font-semibold text-cyan-700 hover:text-indigo-700"
                            onClick={() => {
                              setShowForgotPassword(true);
                              setResetEmail(loginEmail);
                            }}
                          >
                            Forgot Password?
                          </Button>
                        </div>

                        <Button
                          type="submit"
                          className="group h-13 w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-indigo-500 text-base font-semibold text-white shadow-xl shadow-cyan-500/25 transition hover:-translate-y-0.5 hover:from-cyan-600 hover:via-sky-600 hover:to-indigo-600"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Signing in...
                            </>
                          ) : (
                            <>
                              LOGIN
                              <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                            </>
                          )}
                        </Button>
                      </form>

                      {showForgotPassword && (
                        <div className="mt-6 rounded-3xl border border-cyan-100 bg-gradient-to-br from-cyan-50 to-indigo-50 p-5 shadow-sm">
                          <div className="mb-4 flex items-start gap-3">
                            <div className="rounded-2xl bg-white p-3 text-cyan-700 shadow-sm">
                              <Mail className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-950">
                                Reset Password
                              </h3>
                              <p className="mt-1 text-xs leading-5 text-slate-500">
                                Enter your registered email. We will send a secure
                                reset link.
                              </p>
                            </div>
                          </div>

                          <form onSubmit={handleForgotPassword} className="space-y-3">
                            <Input
                              type="email"
                              placeholder="Registered email address"
                              value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              disabled={isLoading}
                              className="h-12 rounded-2xl border-cyan-100 bg-white focus-visible:ring-cyan-400"
                            />

                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                type="submit"
                                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                                disabled={isLoading}
                              >
                                {isLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Send Link"
                                )}
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
                      <div className="mb-4 rounded-3xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">
                        <div className="flex gap-3">
                          <BadgeCheck className="mt-0.5 h-4 w-4" />
                          <p>
                            New registration may be restricted to approved company
                            email domains only.
                          </p>
                        </div>
                      </div>

                      <form onSubmit={handleSignup} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="signup-name" className="text-sm font-medium text-slate-700">
                            Full Name
                          </Label>

                          <div className="relative">
                            <UserRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="signup-name"
                              type="text"
                              placeholder="Employee full name"
                              value={signupName}
                              onChange={(e) => setSignupName(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 shadow-sm focus-visible:ring-cyan-400"
                            />
                          </div>

                          {errors.signup_fullName && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                              {errors.signup_fullName}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="signup-email" className="text-sm font-medium text-slate-700">
                            Email ID
                          </Label>

                          <div className="relative">
                            <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="signup-email"
                              type="email"
                              placeholder="name@company.com"
                              value={signupEmail}
                              onChange={(e) => setSignupEmail(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 shadow-sm focus-visible:ring-cyan-400"
                            />
                          </div>

                          {errors.signup_email && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                              {errors.signup_email}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="signup-password" className="text-sm font-medium text-slate-700">
                            Password
                          </Label>

                          <div className="relative">
                            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="signup-password"
                              type={showSignupPassword ? "text" : "password"}
                              placeholder="Create password"
                              value={signupPassword}
                              onChange={(e) => setSignupPassword(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 pr-12 shadow-sm focus-visible:ring-cyan-400"
                            />

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl p-0 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"
                              onClick={() => setShowSignupPassword(!showSignupPassword)}
                              tabIndex={-1}
                            >
                              {showSignupPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>

                          {errors.signup_password && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                              {errors.signup_password}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="signup-confirm" className="text-sm font-medium text-slate-700">
                            Confirm Password
                          </Label>

                          <div className="relative">
                            <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              id="signup-confirm"
                              type={showSignupConfirmPassword ? "text" : "password"}
                              placeholder="Confirm password"
                              value={signupConfirmPassword}
                              onChange={(e) => setSignupConfirmPassword(e.target.value)}
                              disabled={isLoading}
                              className="h-13 rounded-2xl border-slate-200 bg-white pl-11 pr-12 shadow-sm focus-visible:ring-cyan-400"
                            />

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-xl p-0 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700"
                              onClick={() =>
                                setShowSignupConfirmPassword(!showSignupConfirmPassword)
                              }
                              tabIndex={-1}
                            >
                              {showSignupConfirmPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>

                          {errors.signup_confirmPassword && (
                            <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                              {errors.signup_confirmPassword}
                            </p>
                          )}
                        </div>

                        <Button
                          type="submit"
                          className="group h-13 w-full rounded-2xl bg-slate-950 text-base font-semibold text-white shadow-xl shadow-slate-950/20 transition hover:-translate-y-0.5 hover:bg-slate-800"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Creating account...
                            </>
                          ) : (
                            <>
                              Create Account
                              <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-1" />
                            </>
                          )}
                        </Button>
                      </form>
                    </TabsContent>
                  </Tabs>

                  <div className="mt-6 grid grid-cols-2 gap-3 text-xs font-medium text-slate-600">
                    <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
                      <Building2 className="h-4 w-4 text-cyan-700" />
                      Company HRMS
                    </div>

                    <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3">
                      <HeartHandshake className="h-4 w-4 text-emerald-600" />
                      Employee First
                    </div>
                  </div>
                </CardContent>
              </Card>

              <p className="mt-5 text-center text-xs leading-5 text-slate-300">
                By proceeding, you agree to follow company HRMS access,
                privacy and data security policies.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default Auth;