import * as React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

const EmbeddedInConsoleContext = React.createContext(false);

/** Wrap console tab bodies so standalone pages skip their own DashboardLayout when embedded. */
export function EmbeddedInConsole({ children }: { children: React.ReactNode }) {
  return <EmbeddedInConsoleContext.Provider value>{children}</EmbeddedInConsoleContext.Provider>;
}

/** Drop-in for DashboardLayout: renders children bare when hosted inside the Roster Command Center. */
export function EmbeddableLayout({ children }: { children: React.ReactNode }) {
  const embedded = React.useContext(EmbeddedInConsoleContext);
  return embedded ? <>{children}</> : <DashboardLayout>{children}</DashboardLayout>;
}

export default EmbeddableLayout;
