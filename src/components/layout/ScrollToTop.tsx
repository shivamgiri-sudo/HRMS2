import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    // Only scroll to top when the actual path changes, not when query params/hash change
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;

      // Save sidebar scroll position so it is not disturbed by page navigation
      const sidebarNav = document.querySelector<HTMLElement>(".mcn-sidebar-scroll");
      const savedScroll = sidebarNav ? sidebarNav.scrollTop : 0;

      // Scroll only the main content container — #main-content-area is the real scroll owner.
      // window.scrollTo is intentionally omitted: the window/body does not scroll in this layout.
      const mainContent = document.getElementById("main-content-area");
      if (mainContent) {
        mainContent.scrollTo({ top: 0, behavior: "instant" });
      }

      // Restore sidebar scroll position after browser paint
      if (sidebarNav) {
        requestAnimationFrame(() => {
          sidebarNav.scrollTop = savedScroll;
        });
      }
    }
  }, [pathname]);

  return null;
};

export default ScrollToTop;
