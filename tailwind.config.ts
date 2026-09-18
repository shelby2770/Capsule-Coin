import type { Config } from "tailwindcss";

/**
 * Capsule Coin design tokens.
 * Mood: dark, rich, high-value crypto-exchange feel.
 * Base = near-black navy. Accent = gold "coin". Secondary = electric teal.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0B0E14",
          900: "#0B0E14",
          800: "#0E1320",
          700: "#121826",
          600: "#161D2E",
          500: "#1B2334",
        },
        edge: "#263149",
        gold: {
          300: "#FFE29A",
          400: "#FFD666",
          500: "#F5C542",
          600: "#E0A82E",
          700: "#B9861F",
        },
        teal: {
          300: "#7DF0DE",
          400: "#34E0C4",
          500: "#2DD4BF",
          600: "#14B8A6",
        },
        // True green — the Wordle "right spot" tile. Deliberately distinct from
        // the teal secondary so a correct letter reads unmistakably as green.
        grass: {
          300: "#86E29A",
          400: "#57C46A",
          500: "#3FA35B",
          600: "#2F8547",
        },
        // Dark Capsule Coin (DC): ember / fire on obsidian.
        ember: {
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
        },
        mute: "#9AA6BF",
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        capsule: "999px",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(245,197,66,0.15), 0 8px 40px -8px rgba(245,197,66,0.25)",
        "glow-teal": "0 0 0 1px rgba(45,212,191,0.15), 0 8px 40px -8px rgba(45,212,191,0.25)",
        "glow-ember": "0 0 0 1px rgba(249,115,22,0.18), 0 8px 40px -8px rgba(249,115,22,0.35)",
        panel: "0 20px 60px -20px rgba(0,0,0,0.7)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        float: "float 7s ease-in-out infinite",
        "glow-pulse": "glow-pulse 4s ease-in-out infinite",
        shimmer: "shimmer 2.5s linear infinite",
        "spin-slow": "spin-slow 14s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
