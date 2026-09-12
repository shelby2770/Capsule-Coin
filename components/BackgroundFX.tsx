"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  r: number;
  sp: number;
  a: number;
  tw: number;
};

/**
 * "Gold Rush" backdrop — golden flecks falling through soft light rays over the
 * dark base, with a gentle sideways sway. Tuned subtle so app content stays
 * readable on top. Honors prefers-reduced-motion (renders one static frame).
 */
export function BackgroundFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let raf = 0;
    let W = 0;
    let H = 0;
    let parts: Particle[] = [];

    const seed = () => {
      const count = Math.min(90, Math.max(30, Math.floor(W / 22)));
      parts = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 2 + 0.6,
        sp: Math.random() * 0.8 + 0.35, // px/frame downward — visible drift
        a: Math.random() * 0.4 + 0.14,
        tw: Math.random() * Math.PI * 2,
      }));
    };

    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.shadowColor = "rgba(245,197,66,0.7)";
      ctx.shadowBlur = 7;
      for (const p of parts) {
        p.y += p.sp; // fall downward
        p.tw += 0.02;
        p.x += Math.sin(p.tw) * 0.25; // gentle sideways sway
        if (p.y > H + 4) {
          p.y = -4;
          p.x = Math.random() * W;
        }
        const flick = 0.6 + 0.4 * Math.sin(p.tw);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245,197,66,${(p.a * flick).toFixed(3)})`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    if (reduce) draw();
    else raf = requestAnimationFrame(draw);

    let rt: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(resize, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* warm gold wash from the top + faint teal on the side */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -15%, rgba(245,197,66,0.11), transparent 55%)," +
            "radial-gradient(1000px 700px at 100% 6%, rgba(45,212,191,0.05), transparent 55%)",
        }}
      />
      {/* soft light rays fanning from the top */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "conic-gradient(from 208deg at 50% -10%, transparent 0deg, rgba(245,197,66,0.06) 18deg, transparent 44deg, rgba(255,226,154,0.05) 66deg, transparent 92deg)",
          WebkitMaskImage: "linear-gradient(#000, transparent 72%)",
          maskImage: "linear-gradient(#000, transparent 72%)",
        }}
      />
      {/* drifting gold particles */}
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
