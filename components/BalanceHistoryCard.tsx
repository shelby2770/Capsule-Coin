"use client";

import { useState } from "react";
import { Loader2, LineChart } from "lucide-react";
import { BalanceChart } from "@/components/BalanceChart";
import { useBalanceHistory, type BalanceRange } from "@/lib/useBalanceHistory";

const RANGES: { key: BalanceRange; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];

/** Card wrapping the CC balance history chart with range toggles, for a member `slug`. */
export function BalanceHistoryCard({
  slug,
  title = "Balance history",
}: {
  slug: string;
  title?: string;
}) {
  const [range, setRange] = useState<BalanceRange>("30d");
  const { series, loading } = useBalanceHistory(slug, range);

  return (
    <section className="capsule-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-white">
          <LineChart size={16} className="text-teal-400" /> {title}
        </h2>
        <div className="flex gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                range === r.key
                  ? "bg-teal-500/15 text-teal-300 shadow-glow-teal"
                  : "border border-edge text-mute hover:text-white"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {loading && !series ? (
          <div className="flex h-56 items-center justify-center gap-2 text-mute">
            <Loader2 size={18} className="animate-spin text-teal-400" /> Loading…
          </div>
        ) : (
          <BalanceChart series={series ?? []} />
        )}
      </div>
    </section>
  );
}
