import { Navigate } from "react-router-dom";

function isTokenValid(token: string | null): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 > Date.now() && payload.role === "client";
  } catch {
    return false;
  }
}

export function PortalRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("portal_token");
  if (!isTokenValid(token)) return <Navigate to="/portal/login" replace />;
  return <>{children}</>;
}
