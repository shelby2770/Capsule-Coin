"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into a detached node on <body>, so a fixed-position overlay
 * escapes any ancestor that establishes a containing block (e.g. AppShell's
 * `main.animate-rise`, whose transform would otherwise trap `position: fixed`
 * inside the content column and clip full-screen modals).
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [el] = useState<HTMLDivElement | null>(() =>
    typeof document !== "undefined" ? document.createElement("div") : null,
  );

  useEffect(() => {
    if (!el) return;
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [el]);

  if (!el) return null;
  return createPortal(children, el);
}
