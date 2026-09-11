"use client";

import { useState } from "react";
import type { BalancePoint } from "@/lib/types";

const W = 720;
const H = 260;
const PAD = { l: 52, r: 18, t: 18, b: 30 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

const TEAL = "#34E0C4";
const MUTE = "#8b8b98";

function fmtAxis(t: number, spanMs: number): string {
  const d = new Date(t);
  return spanMs <= 36 * 3_600_000
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function fmtCC(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Full-width CC balance history chart with axis labels, a zero baseline, and a hover tooltip. */
export function BalanceChart({ series }: { series: BalancePoint[] }) {
  const [hi, setHi] = useState<number | null>(null);

  if (!series || series.length < 2) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-mute">
        Not enough history yet — the chart fills in as you trade and mine.
      </div>
    );
  }

  const vals = series.map((p) => p.balance);
  const dataMin = Math.min(...vals);
  const dataMax = Math.max(...vals);
  const pad = (dataMax - dataMin) * 0.15 || Math.abs(dataMax) * 0.15 || 1;
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const yRange = yMax - yMin || 1;
  const n = series.length;
  const spanMs = series[n - 1].t - series[0].t;

  const X = (i: number) => PAD.l + (i / (n - 1)) * IW;
  const Y = (v: number) => PAD.t + IH - ((v - yMin) / yRange) * IH;
  const showZero = yMin < 0 && yMax > 0;

  const line = series
    .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.balance).toFixed(1)}`)
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
  const tipX = hp ? Math.min(Math.max(X(hi as number), PAD.l + 58), W - PAD.r - 58) : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full touch-none select-none"
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
      role="img"
      aria-label="Balance history"
    >
      <defs>
        <linearGradient id="bc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TEAL} stopOpacity="0.28" />
          <stop offset="1" stopColor={TEAL} stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke="#ffffff" strokeOpacity="0.07" />
          <text x={PAD.l - 8} y={Y(v) + 3} textAnchor="end" fontSize="11" fill={MUTE}>
            {fmtCC(Math.round(v))}
          </text>
        </g>
      ))}

      {showZero && (
        <>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(0)} y2={Y(0)} stroke={MUTE} strokeOpacity="0.4" strokeDasharray="4 4" />
          <text x={W - PAD.r} y={Y(0) - 4} textAnchor="end" fontSize="10" fill={MUTE}>
            0
          </text>
        </>
      )}

      <path d={area} fill="url(#bc-fill)" />
      <path d={line} fill="none" stroke={TEAL} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

      <text x={PAD.l} y={H - 9} fontSize="11" fill={MUTE}>
        {fmtAxis(series[0].t, spanMs)}
      </text>
      <text x={W - PAD.r} y={H - 9} textAnchor="end" fontSize="11" fill={MUTE}>
        {fmtAxis(series[n - 1].t, spanMs)}
      </text>

      {hp && (
        <g>
          <line x1={X(hi as number)} x2={X(hi as number)} y1={PAD.t} y2={PAD.t + IH} stroke={TEAL} strokeOpacity="0.4" strokeDasharray="3 3" />
          <circle cx={X(hi as number)} cy={Y(hp.balance)} r="4" fill={TEAL} />
          <g transform={`translate(${tipX}, ${PAD.t + 4})`}>
            <rect x="-58" y="-2" width="116" height="38" rx="8" fill="#0f0f14" stroke="#ffffff" strokeOpacity="0.12" />
            <text x="0" y="14" textAnchor="middle" fontSize="13" fontWeight="700" fill={TEAL}>
              {fmtCC(hp.balance)} CC
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
