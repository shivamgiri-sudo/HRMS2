import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    // Only scroll to top when the actual path changes, not when query params/hash change
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;

      // Scroll only the main content container — #main-content-area is the real scroll owner.
      // window.scrollTo is intentionally omitted: the window/body does not scroll in this layout.
      const mainContent = document.getElementById("main-content-area");
      if (mainContent) {
        mainContent.scrollTo({ top: 0, behavior: "instant" });
      }

    }
  }, [pathname]);

  return null;
};

export default ScrollToTop;
