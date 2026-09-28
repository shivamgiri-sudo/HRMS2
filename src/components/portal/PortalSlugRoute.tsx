import { useParams } from "react-router-dom";
import PortalLogin from "@/pages/portal/PortalLogin";
import NotFound from "@/pages/NotFound";

/**
 * Backs the owner-specified URL shape mcnhrms.teammas.in/processname_clientportal.
 *
 * React Router v6 route params can't carry a static suffix inside the same segment
 * (":slug_clientportal" would just make "_clientportal" part of the param name, not a
 * literal string to match) -- see the public.routes.tsx registration, which mounts this at
 * the single dynamic segment "/:portalSlug" instead. Route specificity ranking in v6 means
 * every literal top-level path (e.g. /pricing, /features) still wins over this dynamic one
 * regardless of declaration order, so this cannot shadow the rest of the app's routes.
 *
 * This component enforces the "_clientportal" suffix itself: only a URL actually ending in
 * that suffix renders the login page; anything else falls through to the app's normal 404,
 * so "/:portalSlug" does not silently become a catch-all for every unmatched single-segment
 * URL on the site.
 */
export default function PortalSlugRoute() {
  const { portalSlug } = useParams<{ portalSlug: string }>();

  if (!portalSlug || !portalSlug.endsWith("_clientportal")) {
    return <NotFound />;
  }

  return <PortalLogin />;
}
