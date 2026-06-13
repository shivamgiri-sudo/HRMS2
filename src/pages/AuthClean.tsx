import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail, ShieldCheck, Users, Clock, BarChart3, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const companyLogo = "/mcn-logo.png?v=999";

const FEATURES = [
  { icon: Users, label: "Employee Management", desc: "Manage your entire workforce in one place" },
  { icon: Clock, label: "Attendance Tracking", desc: "Real-time presence and work-hour monitoring" },
  { icon: BarChart3, label: "Advanced Analytics", desc: "Actionable insights for smarter HR decisions" },
  { icon: CheckCircle2, label: "Leave & Payroll", desc: "Streamlined approvals and payroll processing" },
];

export default function AuthClean() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, forgotPassword, user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      toast({ title: "Login Alert", description: "Enter email/employee code and password." });
      return;
    }
    setLoading(true);
    const { error } = await signIn(identifier.trim(), password);
    setLoading(false);
    if (error) toast({ title: "Login Alert", description: error.message });
  };

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetEmail.trim()) {
      toast({ title: "Reset Password", description: "Enter your registered official email." });
      return;
    }
    setLoading(true);
    const { error } = await forgotPassword(resetEmail.trim());
    setLoading(false);
    if (error) {
      toast({ title: "Reset Password", description: error.message });
      return;
    }
    toast({ title: "Reset Link Sent", description: "If this email is registered, a reset link has been sent." });
    setShowForgot(false);
  };

  return (
    <div className="flex min-h-screen">
      {/* ── Left Panel — MAS Branding ──────────────────────────────── */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:w-[52%] xl:w-[58%]"
        style={{
          background: "linear-gradient(135deg, #071428 0%, #0c1d3a 40%, #0f2a4d 70%, #071428 100%)",
        }}
      >
        {/* Colorful blobs */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full blur-3xl" style={{ background: "rgba(27,106,181,0.35)" }} />
        <div className="pointer-events-none absolute right-0 top-1/3 h-80 w-80 rounded-full blur-3xl" style={{ background: "rgba(59,173,73,0.20)" }} />
        <div className="pointer-events-none absolute bottom-0 left-1/4 h-72 w-72 rounded-full blur-3xl" style={{ background: "rgba(232,35,26,0.15)" }} />
        <div className="pointer-events-none absolute -bottom-10 right-1/4 h-64 w-64 rounded-full blur-3xl" style={{ background: "rgba(27,106,181,0.25)" }} />

        {/* Grid dot overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/95 p-1.5 shadow-lg">
              <img src={companyLogo} alt="MAS Callnet" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-lg font-black text-white">MAS Callnet</p>
              <p className="text-xs font-bold" style={{ color: "#5aa0dd" }}>HRMS Platform</p>
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="relative z-10 my-auto">
          <div
            className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold"
            style={{ borderColor: "rgba(27,106,181,0.4)", background: "rgba(27,106,181,0.15)", color: "#5aa0dd" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#3BAD49] animate-pulse" />
            Enterprise HR Suite
          </div>

          <h1 className="text-4xl font-black leading-tight tracking-tight text-white xl:text-5xl">
            Your Complete
            <span className="block mt-1" style={{ color: "#5aa0dd" }}>
              Workforce Hub
            </span>
          </h1>

          <p className="mt-4 max-w-md text-base leading-7 text-slate-300">
            Manage employees, attendance, payroll, leaves and performance — all from one powerful, beautiful platform.
          </p>

          {/* Feature list */}
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-2xl border p-4"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
              >
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(27,106,181,0.25)" }}
                >
                  <Icon className="h-4 w-4" style={{ color: "#5aa0dd" }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="relative z-10">
          <p className="text-xs text-slate-500">
            © 2025 MAS Callnet · Secure · Reliable · Enterprise-Grade
          </p>
        </div>
      </div>

      {/* ── Right Panel — Login Form ────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#f3f6fb] px-6 py-10">
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white p-1.5 shadow-md">
            <img src={companyLogo} alt="MAS Callnet" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="font-black text-slate-950">MAS Callnet HRMS</p>
            <p className="text-xs font-semibold text-slate-400">Employee Portal</p>
          </div>
        </div>

        <div className="w-full max-w-[400px]">
          {/* Card */}
          <div className="overflow-hidden rounded-3xl border border-white bg-white shadow-2xl shadow-slate-200/80">
            {/* Top accent strip — 3 MAS colors */}
            <div className="flex h-1.5">
              <div className="flex-1" style={{ background: "#1B6AB5" }} />
              <div className="flex-1" style={{ background: "#3BAD49" }} />
              <div className="flex-1" style={{ background: "#E8231A" }} />
            </div>

            <div className="px-7 pb-8 pt-7">
              {!showForgot ? (
                <>
                  <div className="mb-7">
                    <h2 className="text-2xl font-black tracking-tight text-slate-950">Welcome Back</h2>
                    <p className="mt-1.5 text-sm text-slate-500">Sign in with your official email or employee code</p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-5">
                    {/* Email / Employee code */}
                    <div className="space-y-1.5">
                      <Label htmlFor="identifier" className="text-sm font-bold text-slate-700">
                        Email or Employee Code
                      </Label>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="identifier"
                          value={identifier}
                          onChange={(e) => setIdentifier(e.target.value)}
                          placeholder="name@company.com or EMP001"
                          className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                          disabled={loading}
                        />
                      </div>
                    </div>

                    {/* Password */}
                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-sm font-bold text-slate-700">
                        Password
                      </Label>
                      <div className="relative">
                        <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          id="password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 pr-11 focus:bg-white focus:border-[#1B6AB5] focus:ring-[#1B6AB5]/20"
                          disabled={loading}
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          onClick={() => setShowPassword((v) => !v)}
                          tabIndex={-1}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Secure row */}
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <ShieldCheck className="h-4 w-4 text-[#3BAD49]" />
                        256-bit encrypted
                      </div>
                      <button
                        type="button"
                        className="text-xs font-bold hover:underline"
                        style={{ color: "#1B6AB5" }}
                        onClick={() => {
                          setShowForgot(true);
                          setResetEmail(identifier.includes("@") ? identifier : "");
                        }}
                      >
                        Forgot password?
                      </button>
                    </div>

                    {/* Submit */}
                    <button
                      type="submit"
                      disabled={loading}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-black text-white transition-all hover:opacity-90 disabled:opacity-60"
                      style={{
                        background: "linear-gradient(135deg, #1B6AB5 0%, #155e9f 100%)",
                        boxShadow: "0 4px 16px rgba(27,106,181,0.35)",
                      }}
                    >
                      {loading ? (
                        <><Loader2 className="h-4 w-4 animate-spin" />Please wait...</>
                      ) : (
                        <>Sign In <ArrowRight className="h-4 w-4" /></>
                      )}
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <div className="mb-6">
                    <h2 className="text-xl font-black text-slate-950">Reset Password</h2>
                    <p className="mt-1.5 text-sm text-slate-500">Enter your registered official email address.</p>
                  </div>

                  <form onSubmit={handleForgot} className="space-y-4">
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="email"
                        value={resetEmail}
                        onChange={(e) => setResetEmail(e.target.value)}
                        placeholder="official.email@company.com"
                        className="h-11 rounded-xl border-slate-200 bg-slate-50 pl-10 focus:bg-white"
                        disabled={loading}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl font-bold text-white"
                        style={{ background: "#1B6AB5" }}
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Link"}
                      </button>
                      <button
                        type="button"
                        className="h-11 rounded-xl border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50"
                        onClick={() => setShowForgot(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            MAS Callnet HRMS · All rights reserved
          </p>
        </div>
      </div>
    </div>
  );
}
