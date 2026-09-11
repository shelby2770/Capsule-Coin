"use client";

import { useValue } from "@/lib/useValue";
import { formatBdt } from "@/lib/format";
import { TrendingUp, TrendingDown } from "lucide-react";

/** CC index chip for the top bar. `compact` = a minimal ৳-only pill for mobile. */
export function ValueTicker({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const { data } = useValue();
  if (!data) return null;

  const ch = data.change24h;
  const up = ch !== null && ch > 0;
  const down = ch !== null && ch < 0;
  const color = up ? "text-teal-300" : down ? "text-red-300" : "text-mute";
  const Icon = up ? TrendingUp : down ? TrendingDown : null;

  if (compact) {
    return (
      <span className={`chip ${className}`} title="Live CC value — 1 CC in ৳, updates after every transaction">
        <span className="font-semibold text-gold-300 tabular-nums">
          ৳{formatBdt(data.bdtPerCC)}
        </span>
        {Icon && <Icon size={12} className={color} />}
      </span>
    );
  }

  return (
    <span className={`chip ${className}`} title="Live CC value — updates after every transaction">
      <span className="text-mute">1 CC</span>
      <span className="font-semibold text-gold-300 tabular-nums">
        ৳{formatBdt(data.bdtPerCC)}
      </span>
      <span className="text-white tabular-nums">${data.usdPerCC.toFixed(4)}</span>
      <span className={`inline-flex items-center gap-0.5 ${color}`}>
        {Icon && <Icon size={12} />}
        {ch === null ? "new" : `${ch > 0 ? "+" : ""}${ch}%`}
      </span>
    </span>
  );
}
