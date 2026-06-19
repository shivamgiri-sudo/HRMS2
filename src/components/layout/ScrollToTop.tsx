import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    // Only scroll to top when the actual path changes, not when query params/hash change
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;

      // Save sidebar scroll position before scrolling, then restore it.
      // This prevents the sidebar from jumping to top when navigating.
      const sidebarNav = document.querySelector<HTMLElement>(".mcn-sidebar-scroll");
      const savedScroll = sidebarNav ? sidebarNav.scrollTop : 0;

      // Scroll the main content area to top
      const mainContent = document.getElementById("main-content-area");
      if (mainContent) {
        mainContent.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);

      // Restore sidebar scroll position
      if (sidebarNav) {
        sidebarNav.scrollTop = savedScroll;
      }
    }
  }, [pathname]);

  return null;
};

export default ScrollToTop;
