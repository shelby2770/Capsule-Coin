/**
 * Capsule Coin mark ("Capsule Token"): a tilted horizontal gold capsule with a
 * milled coin edge, a bold "C", a center seam (the capsule join), and a teal
 * node. Inline SVG so it inherits sizing and can animate.
 */
export function CoinLogo({
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
      aria-label="Capsule Coin"
      style={glow ? { filter: "drop-shadow(0 6px 18px rgba(245,197,66,0.45))" } : undefined}
    >
      <defs>
        <linearGradient id="cc-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE29A" />
          <stop offset="0.55" stopColor="#F5C542" />
          <stop offset="1" stopColor="#E0A82E" />
        </linearGradient>
        <linearGradient id="cc-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7DF0DE" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <g transform="rotate(-18 32 32)">
        <rect x="5" y="20" width="54" height="24" rx="12" fill="url(#cc-gold)" />
        <rect x="5" y="20" width="54" height="24" rx="12" fill="none" stroke="#B9861F" strokeWidth="2" />
        <rect x="9" y="24" width="46" height="16" rx="8" fill="none" stroke="#B9861F" strokeOpacity="0.3" strokeWidth="1" />
        <ellipse cx="22" cy="27" rx="12" ry="4.5" fill="#ffffff" opacity="0.22" />
        <path d="M32 20 v24" stroke="#B9861F" strokeOpacity="0.5" strokeWidth="1.5" />
        <path d="M26 26 A8 8 0 1 0 26 38" fill="none" stroke="#0B0E14" strokeWidth="5" strokeLinecap="round" />
        <circle cx="45" cy="32" r="3.4" fill="url(#cc-teal)" />
      </g>
    </svg>
  );
}
