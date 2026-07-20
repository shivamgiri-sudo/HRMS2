import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AICommandBar } from "@/components/ai/AICommandBar";
import CookieConsent from "@/components/layout/CookieConsent";
import { OfflineFallback } from "@/components/layout/OfflineFallback";
import ScrollToTop from "@/components/layout/ScrollToTop";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";

import { appRouteElements } from "./config/routes";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PageLoader = () => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                {appRouteElements}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          <CookieConsent />
          <OfflineFallback />
          <AICommandBar />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
