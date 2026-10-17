import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import "./pages/dashboards/role-dashboard-reference.css";
import { BranchHeadReferenceLayout } from "./pages/dashboards/reference/branchhead/BranchHeadReferenceLayout";
import { richPayload } from "./pages/dashboards/reference/branchhead/__tests__/richFixtures";

const qs = new URLSearchParams(location.search);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><MemoryRouter>
    <main className="role-dashboard-reference" style={{ padding: 16, maxWidth: 1180, margin: "0 auto" }}>
      <BranchHeadReferenceLayout data={richPayload()} initialTab={qs.get("tab") ?? "overview"} initialSub={qs.get("sub") ?? undefined} date="2026-10-15" onRefresh={() => {}} />
    </main>
  </MemoryRouter></QueryClientProvider>,
);
