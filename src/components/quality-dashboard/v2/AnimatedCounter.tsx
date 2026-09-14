import { useState, useEffect, useRef } from "react";

/**
 * Count-up animation that always settles to the true value.
 * rAF is suspended in hidden tabs and headless captures; the settle timer
 * ensures the correct number appears regardless of animation frame delivery.
 */
export function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const duration = 800;
    if (typeof requestAnimationFrame !== "function") {
      setVal(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * target));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    const settle = setTimeout(() => setVal(target), duration + 150);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      clearTimeout(settle);
    };
  }, [target]);

  return <>{val.toLocaleString()}{suffix}</>;
}
