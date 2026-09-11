"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated count-up for balances/stats. Eases from the previously shown value to
 * the new one, so updates (mining, trades) animate too. Pass `format` to control
 * how the number renders — e.g. formatCC for 2-decimal CC balances. Without it,
 * values are rounded to whole numbers (the original behavior).
 */
export function CountUp({
  value,
  duration = 900,
  className,
  format,
}: {
  value: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const initial = fromRef.current;
    const delta = value - initial;
    if (delta === 0) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(initial + delta * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const text = format
    ? format(display)
    : Math.round(display).toLocaleString();
  return <span className={className}>{text}</span>;
}
