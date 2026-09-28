import { useEffect, useRef, useState, type ReactNode } from "react";

type DeferUntilVisibleProps = {
  children: ReactNode;
  /** What occupies the slot until it scrolls near the viewport (keeps layout stable). */
  placeholder: ReactNode;
  /** How far ahead of the viewport to start mounting, so the card is usually ready on arrival. */
  rootMargin?: string;
};

/**
 * Mounts its children only once the slot is on (or near) screen, then keeps them mounted.
 *
 * The Process P&L tabs stack several heavy cards below the fold, each with its own query. Mounting
 * them all on arrival fired every request at once and made the first card wait behind the rest.
 * Wrapping a below-the-fold card here means its query only starts when the reader scrolls to it.
 * Browsers without IntersectionObserver render the children immediately (no behaviour change).
 */
export function DeferUntilVisible({ children, placeholder, rootMargin = "200px" }: DeferUntilVisibleProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (isVisible) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, rootMargin]);

  if (isVisible) return <>{children}</>;
  return <div ref={ref}>{placeholder}</div>;
}
