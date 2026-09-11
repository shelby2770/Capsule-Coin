import type { ValuePoint } from "@/lib/types";

/** Compact area sparkline for the value trend. */
export function Sparkline({
  series,
  width = 140,
  height = 40,
  stroke = "#F5C542",
  id = "spark",
}: {
  series: ValuePoint[];
  width?: number;
  height?: number;
  stroke?: string;
  id?: string;
}) {
  const vals = series.map((p) => p.value);
  const hasShape = series.length >= 2 && Math.max(...vals) > 0;

  if (!hasShape) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        <line
          x1="0"
          y1={height - 2}
          x2={width}
          y2={height - 2}
          stroke={stroke}
          strokeOpacity="0.4"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const n = series.length;
  const pts = series.map((p, i) => {
    const x = (i / (n - 1)) * width;
    const y = height - ((p.value - min) / range) * (height - 6) - 3;
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}
