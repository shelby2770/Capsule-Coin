/**
 * Dark Capsule Coin mark: an obsidian capsule with a milled ember edge and a
 * flame burning at its core — the "elite, forged" counterpart to the gold
 * CoinLogo. Inline SVG so it inherits sizing and can glow.
 */
export function DarkCoinLogo({
  size = 40,
  className = "",
  glow = false,
}: {
  size?: number;
  className?: string;
  glow?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Dark Capsule Coin"
      style={glow ? { filter: "drop-shadow(0 6px 20px rgba(249,115,22,0.55))" } : undefined}
    >
      <defs>
        <linearGradient id="dc-ember" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FDBA74" />
          <stop offset="0.55" stopColor="#F97316" />
          <stop offset="1" stopColor="#C2410C" />
        </linearGradient>
        <linearGradient id="dc-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#20232E" />
          <stop offset="1" stopColor="#0B0E14" />
        </linearGradient>
        <radialGradient id="dc-flame" cx="0.5" cy="0.62" r="0.6">
          <stop offset="0" stopColor="#FFE29A" />
          <stop offset="0.45" stopColor="#FB923C" />
          <stop offset="1" stopColor="#EA580C" />
        </radialGradient>
      </defs>
      <g transform="rotate(-18 32 32)">
        {/* obsidian capsule body with an ember rim */}
        <rect x="5" y="20" width="54" height="24" rx="12" fill="url(#dc-body)" />
        <rect x="5" y="20" width="54" height="24" rx="12" fill="none" stroke="url(#dc-ember)" strokeWidth="2.5" />
        <rect x="9" y="24" width="46" height="16" rx="8" fill="none" stroke="#F97316" strokeOpacity="0.25" strokeWidth="1" />
        {/* center seam */}
        <path d="M32 20 v24" stroke="#F97316" strokeOpacity="0.45" strokeWidth="1.5" />
        {/* flame at the core */}
        <path
          d="M32 24.5c3.2 2.4 4.8 5 4.8 7.9 0 3.1-2.2 5.6-4.8 5.6s-4.8-2.3-4.8-5.3c0-1.4.5-2.5 1.4-3.6.2 1.1.8 1.8 1.7 2.1-.3-2.4.5-4.6 1.7-6.7z"
          fill="url(#dc-flame)"
        />
        <circle cx="32" cy="33.5" r="1.7" fill="#FFE29A" opacity="0.9" />
      </g>
    </svg>
  );
}
