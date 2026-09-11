"use client";

import { useState } from "react";
import type { ValuePoint } from "@/lib/types";

const W = 720;
const H = 260;
const PAD = { l: 48, r: 18, t: 18, b: 30 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const GOLD = "#F5C542";
const MUTE = "#8b8b98";

function fmtAxis(t: number, spanMs: number): string {
  const d = new Date(t);
  return spanMs <= 36 * 3_600_000
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Full-width ৳/CC history chart with axis labels + a hover tooltip. */
export function ValueChart({ series }: { series: ValuePoint[] }) {
  const [hi, setHi] = useState<number | null>(null);

  if (!series || series.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-mute">
        Not enough history yet — the chart fills in as the group trades.
      </div>
    );
  }

  const vals = series.map((p) => p.value);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const pad = (dataMax - dataMin) * 0.15 || dataMax * 0.15 || 0.1;
  const yMin = Math.max(0, dataMin - pad);
  const yMax = dataMax + pad;
  const yRange = yMax - yMin || 1;
  const n = series.length;
  const spanMs = series[n - 1].t - series[0].t;

  const X = (i: number) => PAD.l + (i / (n - 1)) * IW;
  const Y = (v: number) => PAD.t + IH - ((v - yMin) / yRange) * IH;

  const line = series
    .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${X(n - 1).toFixed(1)} ${(PAD.t + IH).toFixed(1)} L ${X(0).toFixed(1)} ${(PAD.t + IH).toFixed(1)} Z`;
  const yTicks = [yMax, (yMax + yMin) / 2, yMin];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / IW) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, i)));
  }

  const hp = hi != null ? series[hi] : null;
  const tipX = hp ? Math.min(Math.max(X(hi as number), PAD.l + 54), W - PAD.r - 54) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none select-none"
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
      role="img"
      aria-label="Capsule Coin value history"
    >
      <defs>
        <linearGradient id="vc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={GOLD} stopOpacity="0.28" />
          <stop offset="1" stopColor={GOLD} stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="#ffffff" strokeOpacity="0.07" />
          <text x={PAD.l - 8} y={Y(v) + 3} textAnchor="end" fontSize="11" fill={MUTE}>
            ৳{v.toFixed(2)}
          </text>
        </g>
      ))}

      <path d={area} fill="url(#vc-fill)" />
      <path d={line} fill="none" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      <text x={PAD.l} y={H - 9} fontSize="11" fill={MUTE}>
        {fmtAxis(series[0].t, spanMs)}
      </text>
      <text x={W - PAD.r} y={H - 9} textAnchor="end" fontSize="11" fill={MUTE}>
        {fmtAxis(series[n - 1].t, spanMs)}
      </text>

      {hp && (
        <g>
          <line x1={X(hi as number)} x2={X(hi as number)} y1={PAD.t} y2={PAD.t + IH} stroke={GOLD} strokeOpacity="0.4" strokeDasharray="3 3" />
          <circle cx={X(hi as number)} cy={Y(hp.value)} r="4" fill={GOLD} />
          <g transform={`translate(${tipX}, ${PAD.t + 4})`}>
            <rect x="-54" y="-2" width="108" height="38" rx="8" fill="#0f0f14" stroke="#ffffff" strokeOpacity="0.12" />
            <text x="0" y="14" textAnchor="middle" fontSize="13" fontWeight="700" fill={GOLD}>
              ৳{hp.value.toFixed(2)}
            </text>
            <text x="0" y="29" textAnchor="middle" fontSize="10" fill={MUTE}>
              {new Date(hp.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}
