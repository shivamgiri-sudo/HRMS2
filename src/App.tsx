import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import CookieConsent from "@/components/layout/CookieConsent";
import { OfflineFallback } from "@/components/layout/OfflineFallback";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import ScrollToTop from "@/components/layout/ScrollToTop";
import Landing from "./pages/Landing";
import Features from "./pages/Features";
import HowItWorks from "./pages/HowItWorks";
import Pricing from "./pages/Pricing";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import Security from "./pages/Security";
import Index from "./pages/Index";
import Employees from "./pages/Employees";
import Onboarding from "./pages/Onboarding";
import Leaves from "./pages/Leaves";
import Assets from "./pages/Assets";
import Payroll from "./pages/Payroll";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Performance from "./pages/Performance";
import ReviewsManagement from "./pages/ReviewsManagement";

import Attendance from "./pages/Attendance";
import AttendanceRegularization from "./pages/AttendanceRegularization";
import Departments from "./pages/Departments";
import CompanyCalendar from "./pages/CompanyCalendar";
import NotificationPreferences from "./pages/NotificationPreferences";
import Changelog from "./pages/Changelog";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <Routes>
            {/* Public marketing pages */}
            <Route path="/" element={<Navigate to="/auth" replace />} />
            <Route path="/features" element={<Features />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/security" element={<Security />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Protected app pages */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Index />
                </ProtectedRoute>
              }
            />

            <Route
              path="/employees"
              element={
                <ProtectedRoute>
                  <Employees />
                </ProtectedRoute>
              }
            />

            <Route
              path="/onboarding"
              element={
                <ProtectedRoute>
                  <Onboarding />
                </ProtectedRoute>
              }
            />

            {/* Redirect old onboarding-requests route to onboarding with requests tab */}
            <Route
              path="/onboarding-requests"
              element={<Navigate to="/onboarding?tab=requests" replace />}
            />

            <Route
              path="/leaves"
              element={
                <ProtectedRoute>
                  <Leaves />
                </ProtectedRoute>
              }
            />

            {/* Redirect old leave-approvals route to leaves */}
            <Route
              path="/leave-approvals"
              element={<Navigate to="/leaves" replace />}
            />

            <Route
              path="/assets"
              element={
                <ProtectedRoute>
                  <Assets />
                </ProtectedRoute>
              }
            />

            <Route
              path="/payroll"
              element={
                <ProtectedRoute>
                  <Payroll />
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute>
                  <Settings />
                </ProtectedRoute>
              }
            />

            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />

            <Route
              path="/performance"
              element={
                <ProtectedRoute>
                  <Performance />
                </ProtectedRoute>
              }
            />

            <Route
              path="/reviews-management"
              element={
                <ProtectedRoute>
                  <ReviewsManagement />
                </ProtectedRoute>
              }
            />

            <Route
              path="/attendance"
              element={
                <ProtectedRoute>
                  <Attendance />
                </ProtectedRoute>
              }
            />

            <Route
              path="/attendance-regularization"
              element={
                <ProtectedRoute>
                  <AttendanceRegularization />
                </ProtectedRoute>
              }
            />

            <Route
              path="/departments"
              element={
                <ProtectedRoute>
                  <Departments />
                </ProtectedRoute>
              }
            />

            <Route
              path="/calendar"
              element={
                <ProtectedRoute>
                  <CompanyCalendar />
                </ProtectedRoute>
              }
            />

            <Route
              path="/notification-preferences"
              element={
                <ProtectedRoute>
                  <NotificationPreferences />
                </ProtectedRoute>
              }
            />

            <Route
              path="/changelog"
              element={
                <ProtectedRoute>
                  <Changelog />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
          <CookieConsent />
          <OfflineFallback />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
